import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse as parsePath } from "node:path";
import { ConfigError, ConfigNotFoundError } from "./errors.ts";
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
  const root = parsePath(startDir).root;
  let dir = startDir;

  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    try {
      return await loadConfig(candidate);
    } catch (cause) {
      if (!(cause instanceof ConfigNotFoundError)) throw cause;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  throw new ConfigError(
    `${CONFIG_FILENAME} が見つからない (${startDir} から上位を探索した)。'uikit init' で作成する。`,
  );
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new ConfigNotFoundError(`${path} が読めない`);
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

export async function writeConfig(path: string, config: ProjectConfig): Promise<void> {
  const body = { $schema: "https://kenshin-morioka.github.io/ui-kitchen/config.schema.json", ...config };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function stripSchemaKey(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const { $schema: _ignored, ...rest } = value as Record<string, unknown>;
  return rest;
}
