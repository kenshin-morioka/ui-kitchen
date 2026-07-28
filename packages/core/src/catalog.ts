import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { CatalogNotFoundError, RecipeValidationError } from "./errors.ts";
import {
  DIRECTORY_KINDS,
  KIND_DIRECTORIES,
  type Platform,
  type Recipe,
  type RecipeKind,
  recipeSchema,
} from "./schema.ts";

export const RECIPE_MANIFEST = "recipe.yaml";

export interface LoadedRecipe {
  recipe: Recipe;
  /** recipe ディレクトリの絶対パス。 */
  dir: string;
}

export interface Catalog {
  root: string;
  recipes: Map<string, LoadedRecipe>;
}

/**
 * catalog/<platform>/<kind-dir>/<name>/recipe.yaml を走査して読み込む。
 * ID とディレクトリ位置の一致もここで検証する (正本が 2 つに割れるのを防ぐ)。
 */
export async function loadCatalog(root: string): Promise<Catalog> {
  const recipes = new Map<string, LoadedRecipe>();

  let platforms: string[];
  try {
    platforms = await listDirectories(root);
  } catch (cause) {
    // カタログの場所そのものが違うのに raw ENOENT だと原因に気付けない。
    if (isNotFound(cause)) throw new CatalogNotFoundError(root);
    throw cause;
  }

  for (const platform of platforms) {
    const platformDir = join(root, platform);
    for (const kindDir of await listDirectories(platformDir)) {
      const kind = DIRECTORY_KINDS[kindDir];
      if (!kind) {
        throw new RecipeValidationError(
          `未知の kind ディレクトリ: ${platform}/${kindDir}\n使用できる: ${Object.values(KIND_DIRECTORIES).join(", ")}`,
        );
      }
      const kindPath = join(platformDir, kindDir);
      for (const name of await listDirectories(kindPath)) {
        const dir = join(kindPath, name);
        const loaded = await loadRecipe(dir, { platform, kind, name });
        if (recipes.has(loaded.recipe.id)) {
          throw new RecipeValidationError(`recipe ID が重複している: ${loaded.recipe.id}`);
        }
        recipes.set(loaded.recipe.id, loaded);
      }
    }
  }

  return { root, recipes };
}

interface ExpectedLocation {
  platform: string;
  kind: RecipeKind;
  name: string;
}

async function loadRecipe(dir: string, expected: ExpectedLocation): Promise<LoadedRecipe> {
  const manifestPath = join(dir, RECIPE_MANIFEST);
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (cause) {
    // 「manifest が無い」と「manifest が壊れている」は直し方が違うので文言を分ける。
    if (isNotFound(cause)) {
      throw new RecipeValidationError(`${dir} に ${RECIPE_MANIFEST} が無い`);
    }
    throw new RecipeValidationError(
      `${manifestPath} を読み込めない: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    throw new RecipeValidationError(
      `${manifestPath} が YAML として壊れている: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const parsed = recipeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new RecipeValidationError(`${manifestPath} の内容が不正:\n${issues}`);
  }

  const recipe = parsed.data;
  const expectedId = `${expected.platform}/${KIND_DIRECTORIES[expected.kind]}/${expected.name}`;
  if (recipe.id !== expectedId) {
    throw new RecipeValidationError(
      `${manifestPath} の id (${recipe.id}) がディレクトリ位置 (${expectedId}) と一致しない`,
    );
  }
  if (recipe.platform !== expected.platform) {
    throw new RecipeValidationError(
      `${manifestPath} の platform (${recipe.platform}) がディレクトリ位置 (${expected.platform}) と一致しない`,
    );
  }
  if (recipe.kind !== expected.kind) {
    throw new RecipeValidationError(
      `${manifestPath} の kind (${recipe.kind}) がディレクトリ位置 (${expected.kind}) と一致しない`,
    );
  }

  await assertSourceFilesExist(dir, recipe, manifestPath);

  return { recipe, dir };
}

/**
 * files[].from を読み込み時に検証する。ここで見ないと `from` の typo は
 * ユーザーが add した瞬間の raw ENOENT になり、カタログ側の検証でも捕まらない。
 * symlink で recipe ディレクトリの外に出ていないかも realpath で確認する。
 */
async function assertSourceFilesExist(dir: string, recipe: Recipe, manifestPath: string): Promise<void> {
  const realDir = await realpath(dir);

  for (const file of recipe.files) {
    const source = join(dir, file.from);
    let realSource: string;
    try {
      realSource = await realpath(source);
    } catch (cause) {
      if (isNotFound(cause)) {
        throw new RecipeValidationError(`${manifestPath} の files[].from が存在しない: ${file.from}`);
      }
      throw new RecipeValidationError(
        `${manifestPath} の files[].from (${file.from}) を読めない: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }

    const rel = relative(realDir, realSource);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new RecipeValidationError(
        `${manifestPath} の files[].from (${file.from}) が recipe ディレクトリの外を指している: ${realSource}`,
      );
    }

    if (!(await stat(realSource)).isFile()) {
      throw new RecipeValidationError(`${manifestPath} の files[].from (${file.from}) がファイルではない`);
    }
  }
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const names: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      names.push(entry.name);
      continue;
    }
    // isDirectory() は symlink に対して false。別リポジトリの recipe を
    // symlink して並べる使い方があるので、辿った先がディレクトリなら受け入れる。
    if (entry.isSymbolicLink() && (await isDirectory(join(path, entry.name)))) {
      names.push(entry.name);
    }
  }

  return names.sort(compareStrings);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // 壊れた symlink は無視する (辿れない先を recipe として扱えない)。
    return false;
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/** localeCompare はロケール依存で、コミットされる catalog.json に偽の差分を生む。 */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export interface CatalogIndexEntry {
  id: string;
  name: string;
  kind: RecipeKind;
  platform: Platform;
  description: string;
  tags: string[];
  requires: string[];
  variants: string[];
  use_when: string;
}

/**
 * 検索用のフラットなインデックス。list / search はこれだけを読むので、
 * カタログが増えても検索コストが recipe 数に対して線形の読み込みにならない。
 * 決定性のためタイムスタンプ等の揺れる値は含めない。
 */
export function buildCatalogIndex(catalog: Catalog): { recipes: CatalogIndexEntry[] } {
  const recipes = [...catalog.recipes.values()]
    .map(
      ({ recipe }): CatalogIndexEntry => ({
        id: recipe.id,
        name: recipe.name,
        kind: recipe.kind,
        platform: recipe.platform,
        description: recipe.description,
        tags: [...recipe.tags].sort(),
        requires: [...recipe.requires].sort(),
        variants: recipe.variants.map((variant) => variant.name),
        use_when: recipe.ai.use_when,
      }),
    )
    .sort((a, b) => compareStrings(a.id, b.id));

  return { recipes };
}

export interface CatalogFilter {
  kind?: RecipeKind;
  tag?: string;
  platform?: Platform;
}

export function filterRecipes(catalog: Catalog, filter: CatalogFilter): LoadedRecipe[] {
  return [...catalog.recipes.values()]
    .filter(({ recipe }) => {
      if (filter.kind && recipe.kind !== filter.kind) return false;
      if (filter.platform && recipe.platform !== filter.platform) return false;
      if (filter.tag && !recipe.tags.includes(filter.tag)) return false;
      return true;
    })
    .sort((a, b) => compareStrings(a.recipe.id, b.recipe.id));
}
