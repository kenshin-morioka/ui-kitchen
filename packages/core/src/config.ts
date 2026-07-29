import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ConfigError, ConfigExistsError, ConfigNotFoundError } from "./errors.ts";
import { type ProjectConfig, projectConfigSchema } from "./schema.ts";

export const CONFIG_FILENAME = "ui-kitchen.json";

export interface LoadedConfig {
  config: ProjectConfig;
  /** 設定ファイルの絶対パス。 */
  path: string;
  /** 設定ファイルのあるディレクトリ = プロジェクトルート。 */
  projectRoot: string;
}

/** カレントから上方向に ui-kitchen.json を探す。 */
export async function findConfig(startDir: string): Promise<LoadedConfig> {
  // 相対パスのままだと dirname が "src" -> "." -> "." で停留し、
  // ルート到達の判定が永遠に成立せずハングする。
  const from = resolve(startDir);
  let dir = from;

  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    try {
      return await loadConfig(candidate);
    } catch (cause) {
      // 「存在しない」以外 (権限なし等) で探索を続けると、読めない設定を
      // 飛び越えて祖先の別プロジェクトの設定を採用してしまう。
      if (!(cause instanceof ConfigNotFoundError)) throw cause;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 「無い」ことを CONFIG_INVALID として返すと、設定が壊れている場合と区別できない。
  throw new ConfigNotFoundError(
    `${CONFIG_FILENAME} が見つからない (${from} から上位を探索した)。'uikit init' で作成する。`,
  );
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if (isNotFound(cause)) throw new ConfigNotFoundError(`${path} が存在しない`);
    throw new ConfigError(`${path} を読めない: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(
      `${path} が JSON として壊れている: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const parsed = projectConfigSchema.safeParse(stripSchemaKey(parsedJson));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`${path} の内容が不正:\n${issues}`);
  }

  return { config: parsed.data, path, projectRoot: dirname(path) };
}

export interface WriteConfigOptions {
  /** 既存ファイルを上書きする。既定は排他的作成 (既存なら CONFIG_EXISTS)。 */
  overwrite?: boolean;
}

/**
 * 設定を書き出す。overwrite を渡さない限り**排他的に作成する** (`wx`)。
 * 「存在を確認してから書く」形にすると確認と書き込みの間に他プロセスが作った
 * ファイルを消してしまう。上書きの可否は呼び出し側の明示に委ねる。
 */
export async function writeConfig(
  path: string,
  config: ProjectConfig,
  options: WriteConfigOptions = {},
): Promise<void> {
  // 意図しない場所にプロジェクトを作らないため mkdir はせず、存在しないことを伝える。
  const dir = dirname(resolve(path));
  if (!(await isDirectory(dir))) {
    throw new ConfigError(`${CONFIG_FILENAME} の書き込み先ディレクトリが存在しない: ${dir}`);
  }

  const body = { $schema: "https://kenshin-morioka.github.io/ui-kitchen/config.schema.json", ...config };
  const text = `${JSON.stringify(body, null, 2)}\n`;

  // 上書きと新規作成で書き方を変える。上書きは原子的な置換 (一時ファイル + rename)
  // でなければならない。`w` は open した時点で既存ファイルを切り詰めるので、
  // 途中で失敗すると手で直した設定が空や壊れた JSON になって残る。
  // 新規作成は逆に rename にできない。rename は宛先を無条件に置き換えるため、
  // 「既存なら失敗する」という保証 (wx) が失われる。
  if (options.overwrite) await replaceAtomically(path, text);
  else await createExclusively(path, text);
}

async function createExclusively(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, { encoding: "utf8", flag: "wx" });
  } catch (cause) {
    if (isAlreadyExists(cause)) throw new ConfigExistsError(path);
    throw new ConfigError(`${path} に書き込めない: ${describe(cause)}`);
  }
}

/**
 * 同じディレクトリに書き切ってから rename で置き換える。
 * 別ファイルシステムを跨がないので rename は原子的で、宛先は常に
 * 「置換前の内容」か「置換後の内容」のどちらかになる。
 *
 * path が symlink の場合、`w` はリンク先を書き換えるがこちらは symlink 自体を
 * 置き換える。プロジェクト外に書き込まないという方針からはこちらが望ましい。
 */
async function replaceAtomically(path: string, text: string): Promise<void> {
  // 同一プロセスの並行実行で衝突しないよう pid を含める。乱数は使わない。
  const temporary = `${path}.${process.pid}.tmp`;

  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  } catch (cause) {
    throw new ConfigError(
      `${path} を置き換えるための一時ファイルを作れない (${temporary}): ${describe(cause)}`,
    );
  }

  try {
    await rename(temporary, path);
  } catch (cause) {
    // 残すとプロジェクトに .tmp が散る。消せなくても元の失敗を優先して報告する。
    await rm(temporary, { force: true }).catch(() => {});
    throw new ConfigError(`${path} を置き換えられない: ${describe(cause)}`);
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function isNotFound(cause: unknown): boolean {
  return codeOf(cause) === "ENOENT";
}

function isAlreadyExists(cause: unknown): boolean {
  return codeOf(cause) === "EEXIST";
}

function codeOf(cause: unknown): string | undefined {
  if (typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return undefined;
}

function stripSchemaKey(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const { $schema: _ignored, ...rest } = value as Record<string, unknown>;
  return rest;
}
