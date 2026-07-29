import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { detectWebProject } from "@ui-kitchen/adapter-web";
import { CONFIG_FILENAME, FileSystemError, UiKitchenError, writeConfig } from "@ui-kitchen/core";
import type { ProjectTarget } from "./project.ts";
import type { CommandResult } from "./result.ts";

export interface InitOptions {
  target: ProjectTarget;
  force: boolean;
}

/**
 * プロジェクトを覗いて ui-kitchen.json を作る。
 * 出力先は常に target.cwd 直下。上位に既存の設定があっても、そこを書き換えると
 * 「monorepo の別プロジェクトの設定を壊す」ことになるので探索はしない。
 */
export async function runInit(options: InitOptions): Promise<CommandResult> {
  const { target, force } = options;
  const path = join(target.cwd, CONFIG_FILENAME);
  const existed = await exists(path);

  if (existed && !force) {
    throw new UiKitchenError(
      "CONFIG_EXISTS",
      `${path} は既に存在する。作り直すなら --force を付ける (推測値で上書きされるので手で直した内容は失われる)。`,
    );
  }

  const detected = await detectWebProject(target.cwd);
  await writeConfig(path, detected.config);

  const { config, notes } = detected;
  const lines = [
    existed ? `${CONFIG_FILENAME} を上書きした: ${path}` : `${CONFIG_FILENAME} を作成した: ${path}`,
    "",
    `platform: ${config.platform}`,
    `stack: ${[config.stack.framework, config.stack.language, config.stack.styling, config.stack.ui]
      .filter((value) => value !== undefined)
      .join(" / ")}`,
    `importAlias: ${config.importAlias}`,
    "出力先:",
    ...Object.entries(config.paths).map(([key, value]) => `  ${key}: ${value}`),
  ];
  if (notes.length > 0) {
    lines.push("", "確認 (検出できた項目と仮置きした項目):", ...notes.map((note) => `  - ${note}`));
  }

  return { lines, data: { path, overwritten: existed, config, notes } };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (isNotFound(cause)) return false;
    // EACCES などを「無い」に潰すと、直後の writeConfig が別の理由で失敗して混乱する。
    throw new FileSystemError(
      `${path} の有無を確認できない: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}
