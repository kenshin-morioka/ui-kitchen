import { join, resolve } from "node:path";
import {
  CONFIG_FILENAME,
  ConfigNotFoundError,
  findConfig,
  type LoadedConfig,
  loadConfig,
} from "@ui-kitchen/core";

export interface ProjectTarget {
  /** 対象ディレクトリの絶対パス。 */
  cwd: string;
  /** --cwd で明示されたか。明示されたときは上位探索をしない。 */
  explicit: boolean;
}

export function projectTarget(cwd: string | undefined, defaultCwd: string): ProjectTarget {
  return { cwd: resolve(cwd ?? defaultCwd), explicit: cwd !== undefined };
}

/**
 * 設定を読む。--cwd が明示されたときは上位を探索しない。
 * 探索すると monorepo のルートに設定があるだけで --cwd apps/web が無視され、
 * 意図しないプロジェクトの出力先へ生成してしまう (init は --cwd 直下に作るので食い違う)。
 */
export async function loadProjectConfig(target: ProjectTarget): Promise<LoadedConfig> {
  if (!target.explicit) return await findConfig(target.cwd);

  const path = join(target.cwd, CONFIG_FILENAME);
  try {
    return await loadConfig(path);
  } catch (cause) {
    if (!(cause instanceof ConfigNotFoundError)) throw cause;
    // 探索しなかったことを message に書く。--cwd を付けた側は「なぜ祖先の設定を
    // 使わないのか」を知らないと、init を打つべきだと判断できない。
    throw new ConfigNotFoundError(
      `${path} が無い。--cwd を指定したので上位ディレクトリは探索しない。'uikit init --cwd ${target.cwd}' で作成する。`,
    );
  }
}
