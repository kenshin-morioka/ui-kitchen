import { readFile, stat, writeFile } from "node:fs/promises";
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
  try {
    await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, {
      encoding: "utf8",
      flag: options.overwrite ? "w" : "wx",
    });
  } catch (cause) {
    if (isAlreadyExists(cause)) throw new ConfigExistsError(path);
    throw new ConfigError(
      `${path} に書き込めない: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
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
