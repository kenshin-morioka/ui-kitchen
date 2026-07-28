import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { RecipeValidationError } from "./errors.ts";
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

  for (const platform of await listDirectories(root)) {
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
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw new RecipeValidationError(
      `${manifestPath} を読み込めない: ${cause instanceof Error ? cause.message : String(cause)}`,
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

  return { recipe, dir };
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
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
    .sort((a, b) => a.id.localeCompare(b.id));

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
    .sort((a, b) => a.recipe.id.localeCompare(b.recipe.id));
}
