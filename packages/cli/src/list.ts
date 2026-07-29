import {
  buildCatalogIndex,
  type CatalogIndexEntry,
  DIRECTORY_KINDS,
  KIND_DIRECTORIES,
  loadCatalog,
  PLATFORMS,
  type Platform,
  RECIPE_KINDS,
  type RecipeKind,
} from "@ui-kitchen/core";
import { repositoryCatalogRoot } from "@ui-kitchen/registry";
import { UsageError } from "./args.ts";
import type { CommandResult } from "./result.ts";

export interface ListOptions {
  kind?: string;
  tag?: string;
  platform?: string;
}

export async function runList(options: ListOptions): Promise<CommandResult> {
  const kind = options.kind === undefined ? undefined : parseKind(options.kind);
  const platform = options.platform === undefined ? undefined : parsePlatform(options.platform);

  const catalog = await loadCatalog(repositoryCatalogRoot());
  // 並び順とエントリの形は core のインデックス生成に任せる。catalog.json と
  // list の出力が食い違うと「どちらが正か」の判断が必要になるため。
  const recipes = buildCatalogIndex(catalog).recipes.filter((entry) => {
    if (kind !== undefined && entry.kind !== kind) return false;
    if (platform !== undefined && entry.platform !== platform) return false;
    if (options.tag !== undefined && !entry.tags.includes(options.tag)) return false;
    return true;
  });

  return {
    lines: renderLines(recipes, catalog.recipes.size),
    data: { catalogRoot: catalog.root, count: recipes.length, recipes },
  };
}

function renderLines(recipes: CatalogIndexEntry[], total: number): string[] {
  if (recipes.length === 0) {
    return total === 0
      ? ["カタログに recipe が 1 件も無い。"]
      : [
          "条件に一致する recipe が無い。",
          `カタログ全体では ${total} 件ある (--kind / --tag / --platform を外す)。`,
        ];
  }

  const lines: string[] = [];
  for (const entry of recipes) {
    lines.push(`${entry.id}  [${entry.kind}]  ${entry.name}`);
    lines.push(`  ${entry.description}`);
    if (entry.tags.length > 0) lines.push(`  tags: ${entry.tags.join(", ")}`);
    if (entry.requires.length > 0) lines.push(`  requires: ${entry.requires.join(", ")}`);
    if (entry.variants.length > 0) lines.push(`  variants: ${entry.variants.join(", ")}`);
  }
  lines.push("", `${recipes.length} 件 (カタログ全体 ${total} 件)`);
  return lines;
}

/** kind は列挙値 (primitive) でもディレクトリ名 (primitives) でも受け取る。 */
function parseKind(value: string): RecipeKind {
  if ((RECIPE_KINDS as readonly string[]).includes(value)) return value as RecipeKind;
  // 所有プロパティだけを見る。DIRECTORY_KINDS は Object.fromEntries 由来の通常の
  // オブジェクトなので、素の添字アクセスでは `constructor` や `__proto__` が
  // 継承値を返し、USAGE エラーにならずに「0 件」という誤った結果になる。
  const fromDirectory = Object.hasOwn(DIRECTORY_KINDS, value) ? DIRECTORY_KINDS[value] : undefined;
  if (fromDirectory !== undefined) return fromDirectory;
  throw new UsageError(
    `未知の kind: ${value}\n使用できる kind: ${RECIPE_KINDS.join(", ")}\nディレクトリ名でも指定できる: ${Object.values(KIND_DIRECTORIES).join(", ")}`,
  );
}

function parsePlatform(value: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(value)) return value as Platform;
  throw new UsageError(`未知の platform: ${value}\n使用できる platform: ${PLATFORMS.join(", ")}`);
}
