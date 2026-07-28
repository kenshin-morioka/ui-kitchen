import { type Stats, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalogIndex,
  CatalogNotFoundError,
  FileSystemError,
  loadCatalog,
  resolveRecipes,
  UiKitchenError,
} from "@ui-kitchen/core";

export const CATALOG_INDEX_FILENAME = "catalog.json";

const CATALOG_DIRNAME = "catalog";

const CATALOG_ENV = "UI_KITCHEN_CATALOG";

/**
 * カタログの探索候補を優先順で返す。
 *
 * 起点は「このパッケージ自身の package.json があるディレクトリ」。
 * import.meta.url からの固定段数で辿ると、ソースツリー (packages/registry/src) では
 * 当たってもパッケージとして配布された場合 (node_modules/@ui-kitchen/registry、
 * pnpm ストア経由なら更に別の実体) に存在しないパスを指す。
 */
export function catalogRootCandidates(): string[] {
  const override = process.env[CATALOG_ENV];
  // 空文字列は「変数を設定したが値を入れていない」= 未指定として扱う。
  // resolve("") はカレントディレクトリを返すので、素通しすると無関係な場所を指す。
  if (override !== undefined && override !== "") return [resolve(override)];

  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return [
    // パッケージに同梱されたカタログ (配布物として使う場合)
    join(packageRoot, CATALOG_DIRNAME),
    // モノレポのルートにあるカタログ (このリポジトリで開発する場合)
    join(packageRoot, "..", "..", CATALOG_DIRNAME),
  ];
}

/** カタログの場所を解決する。UI_KITCHEN_CATALOG で上書きできる。 */
export function repositoryCatalogRoot(): string {
  const candidates = catalogRootCandidates();
  const found = candidates.find(isDirectory);
  if (found) return found;

  // どこを探したかを出さないと、UI_KITCHEN_CATALOG の誤指定なのか配置の問題なのかを
  // ログだけでは切り分けられない。
  throw new CatalogNotFoundError(
    `次のいずれにも存在しない${candidates.map((path) => `\n  - ${path}`).join("")}`,
  );
}

export function catalogIndexPath(catalogRoot: string): string {
  return join(catalogRoot, CATALOG_INDEX_FILENAME);
}

/**
 * インデックスの JSON 文字列。同じカタログなら常にバイト単位で同一になる
 * (CI がコミット済み catalog.json との差分で鮮度を判定するため)。
 */
export async function renderCatalogIndex(catalogRoot: string): Promise<string> {
  const catalog = await loadCatalog(catalogRoot);
  // requires が存在するか / 循環していないかの判定は core の resolveRecipes が持つ。
  // 全 recipe を起点に一度通し、参照が壊れたままのインデックスを配らないようにする。
  resolveRecipes([...catalog.recipes.keys()], catalog);
  // 並び順は buildCatalogIndex がロケール非依存に確定させているので、ここで再ソートしない。
  return `${JSON.stringify(buildCatalogIndex(catalog), null, 2)}\n`;
}

/** インデックスを生成して書き出す。書き出したパスを返す。 */
export async function writeCatalogIndex(catalogRoot: string): Promise<string> {
  const path = catalogIndexPath(catalogRoot);
  // 検証を通してから書く。壊れたカタログで既存のインデックスを潰さないため。
  const body = await renderCatalogIndex(catalogRoot);

  try {
    await writeFile(path, body, "utf8");
  } catch (cause) {
    throw new FileSystemError(`${path} に書き込めない: ${describe(cause)}`);
  }

  return path;
}

/**
 * recipe.yaml のスキーマ検証と、コミット済みインデックスの鮮度チェックを兼ねる。
 * 想定内の失敗はすべて UiKitchenError で返し、整形は呼び出し側 (runCommand) に任せる。
 */
export async function checkCatalogIndex(catalogRoot: string): Promise<string> {
  const path = catalogIndexPath(catalogRoot);
  const expected = await renderCatalogIndex(catalogRoot);

  let actual: string;
  try {
    actual = await readFile(path, "utf8");
  } catch (cause) {
    // 「未生成」と「読めない」は直し方が違うので分ける。
    if (isNotFound(cause)) {
      throw new UiKitchenError(
        "CATALOG_INDEX_MISSING",
        `${path} が無い。'pnpm catalog:build' で生成してコミットする。`,
      );
    }
    throw new FileSystemError(`${path} を読めない: ${describe(cause)}`);
  }

  if (actual !== expected) {
    throw new UiKitchenError(
      "CATALOG_INDEX_STALE",
      `${path} が recipe の内容と一致しない。'pnpm catalog:build' を実行してコミットする。`,
    );
  }

  return path;
}

/** パッケージルート = 自身より上で最初に見つかる package.json のあるディレクトリ。 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;

  while (true) {
    if (isFile(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    // ファイルシステムのルートまで来た。
    if (parent === dir) break;
    dir = parent;
  }

  throw new CatalogNotFoundError(`${startDir} から上位に package.json が見つからない`);
}

/**
 * ENOENT 以外 (EACCES など) を「存在しない」に潰さない。
 * 潰すと権限の問題なのに「どこにも存在しない」という誤った診断になり、
 * 本当の原因が見えなくなる。
 */
function isDirectory(path: string): boolean {
  return statKind(path)?.isDirectory() ?? false;
}

function isFile(path: string): boolean {
  return statKind(path)?.isFile() ?? false;
}

function statKind(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch (cause) {
    if (isNotFound(cause)) return undefined;
    throw new FileSystemError(
      `${path} の状態を確認できない: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/** EACCES / EISDIR など ENOENT 以外の理由も残す。 */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
