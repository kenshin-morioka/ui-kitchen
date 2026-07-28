import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface MissingDependency {
  name: string;
  /** recipe が要求している semver range。 */
  range: string;
}

/**
 * package.json の dependencies / devDependencies / peerDependencies を
 * まとめて読む。存在しない場合は空を返す (プロジェクト側の判断に委ねる)。
 */
export async function readInstalledDependencies(projectRoot: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(join(projectRoot, "package.json"), "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const manifest = parsed as Record<string, unknown>;
  return {
    ...asRecord(manifest.peerDependencies),
    ...asRecord(manifest.devDependencies),
    ...asRecord(manifest.dependencies),
  };
}

/**
 * 不足している npm 依存を返す。判定は「宣言されているか」のみで、
 * semver の範囲比較はしない (バージョン整合はプロジェクト側の責務)。
 */
export function findMissingDependencies(
  required: Record<string, string>,
  installed: Record<string, string>,
): MissingDependency[] {
  return Object.entries(required)
    .filter(([name]) => !(name in installed))
    .map(([name, range]) => ({ name, range }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 人間 / AI がそのまま実行できる install コマンドを組み立てる。 */
export function installCommandFor(missing: MissingDependency[], packageManager = "pnpm"): string | undefined {
  if (missing.length === 0) return undefined;
  const specs = missing.map(({ name, range }) => `${name}@${range}`).join(" ");
  return `${packageManager} add ${specs}`;
}

function asRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
