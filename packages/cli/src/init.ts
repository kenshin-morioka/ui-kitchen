import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { detectWebProject } from "@ui-kitchen/adapter-web";
import { CONFIG_FILENAME, FileSystemError, writeConfig } from "@ui-kitchen/core";
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
  // 既存判定は「作成した」と「上書きした」を書き分けるためだけに使う。
  // 上書きを止める判定は writeConfig の排他的作成に任せる。ここで判定して
  // 弾く形にすると、判定と書き込みの間に他プロセスが作ったファイルを消す。
  const existed = force ? await exists(path) : false;

  const detected = await detectWebProject(target.cwd);
  await writeConfig(path, detected.config, { overwrite: force });

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
