import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseJsonc } from "./jsonc.ts";

export interface ImportAliasDetection {
  /** 検出できたエイリアス (例: "@/")。検出できなければ undefined。 */
  alias?: string;
  /** 検出元 / 検出できなかった理由。呼び出し側が notes に流す。 */
  notes: string[];
}

/** 探索の起点。tsconfig を優先し、無ければ jsconfig を見る。 */
const ENTRY_FILENAMES = ["tsconfig.json", "jsconfig.json"];

/**
 * extends / references を辿る深さの上限。
 * Vite の生成物は paths を tsconfig.app.json 側に持つので 1 段は必要だが、
 * 共有 base config を無制限に辿ると無関係な paths を拾いやすいので 1 段で止める。
 */
const MAX_DEPTH = 1;

/**
 * tsconfig の paths から import エイリアスを検出する。
 *
 * 見つからない場合は例外にせず undefined を返す。init は設定ファイルを作り切るのが仕事で、
 * 「検出できなかったので仮置きした」と伝えられれば人間 / AI が直せる。
 *
 * @param preferredBase 出力先の基準ディレクトリ ("src" もしくは ".")。
 *   `@/*` が複数候補あるときに、プロジェクトの構成に合う方を選ぶために使う。
 */
export async function detectImportAlias(
  projectRoot: string,
  preferredBase: string,
): Promise<ImportAliasDetection> {
  const notes: string[] = [];
  const visited = new Set<string>();
  let sawAnyConfig = false;

  for (const filename of ENTRY_FILENAMES) {
    const queue: { path: string; depth: number }[] = [{ path: join(projectRoot, filename), depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift() as { path: string; depth: number };
      // extends と references が同じファイルを指すこと (循環含む) があるので既読は飛ばす。
      if (visited.has(current.path)) continue;
      visited.add(current.path);

      const raw = await readMaybe(current.path);
      if (raw === undefined) continue;
      sawAnyConfig = true;

      let parsed: unknown;
      try {
        parsed = parseJsonc(raw, current.path);
      } catch (cause) {
        // ここで黙って既定値に落ちると、生成した import が全部解決不能なのに成功扱いになる。
        notes.push(`${label(projectRoot, current.path)} を解釈できなかった: ${messageOf(cause)}`);
        continue;
      }

      const config = asRecord(parsed);
      const compilerOptions = asRecord(config?.compilerOptions);
      const paths = asRecord(compilerOptions?.paths);

      if (paths !== undefined) {
        const picked = pickRootAlias(paths, preferredBase);
        if (picked !== undefined) {
          notes.push(
            `importAlias=${picked.alias} を ${label(projectRoot, current.path)} の paths から検出した ("${picked.key}" -> "${picked.target}")`,
          );
          return { alias: picked.alias, notes };
        }
        notes.push(
          `${label(projectRoot, current.path)} の paths にプロジェクトルートへ 1:1 対応するエントリが無い (${Object.keys(paths).join(", ")})`,
        );
      }

      if (current.depth < MAX_DEPTH) {
        for (const next of referencedConfigs(current.path, config)) {
          queue.push({ path: next, depth: current.depth + 1 });
        }
      }
    }
  }

  if (!sawAnyConfig) notes.push(`${ENTRY_FILENAMES.join(" / ")} が見つからなかった`);
  return { notes };
}

interface PickedAlias {
  alias: string;
  key: string;
  target: string;
}

/**
 * paths のうち「プロジェクトルートへ 1:1 で対応する」エントリを選ぶ。
 *
 * `@components/* -> ./src/components/*` のような部分エイリアスを採用すると、
 * 生成される import が `@components/components/ui/button` になって解決できない。
 * 対応先がルート (`./*`) か src ルート (`./src/*`) のものだけを候補にする。
 */
function pickRootAlias(paths: Record<string, unknown>, preferredBase: string): PickedAlias | undefined {
  const candidates: PickedAlias[] = [];

  for (const [key, value] of Object.entries(paths)) {
    if (!key.endsWith("/*")) continue;
    // 対応先が複数あるものは、どちらへ解決されるか決められないので候補にしない。
    if (!Array.isArray(value) || value.length !== 1) continue;
    const target = value[0];
    if (typeof target !== "string") continue;

    const base = rootBaseOf(target);
    if (base === undefined) continue;
    const picked: PickedAlias = { alias: key.slice(0, -1), key, target };
    // 出力先の基準と一致するものを最優先する (src/ 構成なら ./src/* 側)。
    if (base === normalizeBase(preferredBase)) return picked;
    candidates.push(picked);
  }

  return candidates[0];
}

/** 対応先がルート相当なら、その基準 ("" もしくは "src") を返す。それ以外は undefined。 */
function rootBaseOf(target: string): string | undefined {
  if (!target.endsWith("/*") && target !== "*" && target !== "./*") return undefined;
  const normalized = target.replace(/^\.\//, "").replace(/\/\*$/, "").replace(/^\*$/, "");
  return normalized === "" || normalized === "src" ? normalized : undefined;
}

function normalizeBase(base: string): string {
  return base === "." ? "" : base;
}

/** extends と references (1 段分) の参照先を絶対パスで返す。 */
function referencedConfigs(fromPath: string, config: Record<string, unknown> | undefined): string[] {
  const result: string[] = [];
  const dir = dirname(fromPath);

  const extendsValue = config?.extends;
  // 文字列以外 (TS 5 の配列形式) と パッケージ名 ("@tsconfig/..." 等) は追わない。
  // 後者は node の解決が必要で、外部依存なしでは正確に辿れない。
  if (typeof extendsValue === "string" && isRelativeSpecifier(extendsValue)) {
    result.push(withJsonExtension(resolve(dir, extendsValue)));
  }

  const references = config?.references;
  if (Array.isArray(references)) {
    for (const reference of references) {
      const path = asRecord(reference)?.path;
      if (typeof path !== "string" || path === "") continue;
      const resolved = resolve(dir, path);
      // references の path はディレクトリでもファイルでもよい。
      result.push(resolved.endsWith(".json") ? resolved : join(resolved, "tsconfig.json"));
    }
  }

  return result;
}

function isRelativeSpecifier(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || isAbsolute(value);
}

function withJsonExtension(path: string): string {
  return path.endsWith(".json") ? path : `${path}.json`;
}

/** notes に絶対パスを並べると読みにくいので、プロジェクトからの相対で表示する。 */
function label(projectRoot: string, path: string): string {
  const rel = relative(projectRoot, path);
  return rel === "" || rel.startsWith("..") ? path : rel;
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // 無い / 読めないの区別は notes には出さない。どちらも「辿れなかった」で扱いは同じ。
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
