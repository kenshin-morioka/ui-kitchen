import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError } from "@ui-kitchen/core";

export interface MissingDependency {
  name: string;
  /** recipe が要求している semver range。 */
  range: string;
  /**
   * peerDependencies にだけ宣言されている場合に true。
   * 「書いてあるのに不足扱い」の理由を提示側が説明できるようにするため。
   */
  onlyPeerDeclared: boolean;
}

export interface IncompatibleDependency {
  name: string;
  /** recipe が要求している range。 */
  required: string;
  /** プロジェクトの package.json に書かれている range。 */
  declared: string;
}

export interface InstalledDependencies {
  /**
   * dependencies + devDependencies。install すれば node_modules に入るので、
   * 充足判定の根拠にできるのはこれだけ。
   */
  resolved: Record<string, string>;
  /**
   * peerDependencies。利用側が入れる前提の宣言であって自動 install されない。
   * 充足の根拠にはしないが、不足理由の説明に使うので捨てずに持つ。
   */
  peer: Record<string, string>;
}

/**
 * プロジェクトの package.json から依存の宣言を読む。
 *
 * package.json が無い場合だけ空を返す (これから作るプロジェクトもありうる)。
 * 壊れている場合に空へフォールバックすると「全部不足」という嘘の結果になるため、
 * 読めた上で解釈できないケースは ConfigError にする。
 */
export async function readInstalledDependencies(projectRoot: string): Promise<InstalledDependencies> {
  const path = join(projectRoot, "package.json");

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if (isNotFound(cause)) return { resolved: {}, peer: {} };
    // EISDIR / EACCES などもここに来る。生の例外を投げない。
    throw new ConfigError(`${path} を読めない: ${messageOf(cause)}`);
  }

  // package.json は npm 側の仕様で厳密な JSON。tsconfig と違い JSONC を許さない。
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(`${path} が JSON として壊れている: ${messageOf(cause)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${path} の中身がオブジェクトではない`);
  }

  const manifest = parsed as Record<string, unknown>;
  return {
    // 同名が両方にある場合は dependencies を優先する (実際に解決されるのはこちら)。
    resolved: { ...asRecord(manifest.devDependencies), ...asRecord(manifest.dependencies) },
    peer: asRecord(manifest.peerDependencies),
  };
}

/**
 * 宣言されていない npm 依存を返す。
 *
 * peerDependencies は「利用側が入れてくれ」という宣言なので、書いてあっても
 * node_modules には無い。これを充足扱いするとライブラリ用プロジェクトで
 * 不足ゼロと報告され、生成コードが import を解決できずに壊れる。
 */
export function findMissingDependencies(
  required: Record<string, string>,
  installed: InstalledDependencies,
): MissingDependency[] {
  return Object.entries(required)
    .filter(([name]) => !(name in installed.resolved))
    .map(([name, range]) => ({ name, range, onlyPeerDeclared: name in installed.peer }))
    .sort(byName);
}

/**
 * 宣言はあるが recipe の要求 range を満たさない可能性が高い依存を返す。
 * 未宣言 (findMissingDependencies) とは別枠にする。install ではなく
 * バージョン更新という別の対処が必要で、混ぜると提示するコマンドを誤る。
 */
export function findIncompatibleDependencies(
  required: Record<string, string>,
  installed: InstalledDependencies,
): IncompatibleDependency[] {
  const result: IncompatibleDependency[] = [];
  for (const [name, range] of Object.entries(required)) {
    const declared = installed.resolved[name];
    if (declared === undefined) continue; // 未宣言は不足側の担当。
    if (majorRangesConflict(range, declared)) result.push({ name, required: range, declared });
  }
  return result.sort(byName);
}

/** 人間 / AI がそのまま実行できる install コマンドを組み立てる。 */
export function installCommandFor(missing: MissingDependency[], packageManager = "pnpm"): string | undefined {
  if (missing.length === 0) return undefined;
  // range に `>=` が入るとクォート無しではリダイレクトになる。必ず引用する。
  const specs = missing.map(({ name, range }) => `"${name}@${range}"`).join(" ");
  return `${packageManager} add ${specs}`;
}

/**
 * 2 つの range が「メジャーバージョンとして両立しない」ことを確実に言えるか判定する。
 *
 * 前提として厳密な判定は原理的にできない。package.json に書かれているのは range 同士で、
 * 実際に node_modules へ入っているバージョンとは別物だからだ (lock ファイルが正本)。
 * そのため semver の完全実装は持ち込まず、**確実に食い違うときだけ** true を返す:
 *
 * - どちらかがパースできない形 (`workspace:*` / git URL / `||` を含む複合 range /
 *   prerelease 付き / `*` や `x` 混じり) なら判定不能として false
 * - 両方が単純な形なら「許容されるメジャーの集合」を出し、交差が空のときだけ true
 *
 * 限界: メジャーが同じなら常に false。`^19.2.0` 要求に対する `^19.0.0` 宣言のような
 * マイナー不足は検出しない。`^0.x` 系はキャレットが実質マイナー固定なので、
 * `^0.1` と `^0.2` の非互換も見逃す。誤検知を出さない側に倒した結果。
 */
function majorRangesConflict(required: string, declared: string): boolean {
  const a = allowedMajors(required);
  const b = allowedMajors(declared);
  if (a === undefined || b === undefined) return false;

  // 上限なし同士は必ず交差する。片方だけ上限なしなら下限の大小で判定できる。
  if (a.openEnded && b.openEnded) return false;
  if (a.openEnded) return b.major < a.major;
  if (b.openEnded) return a.major < b.major;
  return a.major !== b.major;
}

interface AllowedMajors {
  /** 許容される最小のメジャー。 */
  major: number;
  /** true なら major 以上すべてを許容する (`>=` `>` 系)。 */
  openEnded: boolean;
}

/** 単純な range だけを解釈する。解釈できない形は undefined。 */
function allowedMajors(range: string): AllowedMajors | undefined {
  const trimmed = range.trim();
  // 複合 range / prerelease / ワイルドカードは解釈しない。空白区切りの
  // `>=1 <2` もここで落ちる (単一の comparator しか扱わない)。
  if (trimmed === "" || /[\s|*x-]/i.test(trimmed)) return undefined;

  const matched = /^(\^|~|>=|>|=|v)?v?(\d+)(?:\.\d+)?(?:\.\d+)?$/.exec(trimmed);
  if (matched === null) return undefined;

  const operator = matched[1] ?? "";
  return { major: Number(matched[2]), openEnded: operator === ">=" || operator === ">" };
}

function byName(a: { name: string }, b: { name: string }): number {
  // ロケール依存の並びを避けるため localeCompare は使わない。
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function asRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
