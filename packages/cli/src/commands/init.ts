import { access } from "node:fs/promises";
import { join } from "node:path";
import { detectWebProject } from "@ui-kitchen/adapter-web";
import { CONFIG_FILENAME, writeConfig } from "@ui-kitchen/core";
import { parse, printJson, projectDirFrom, showHelp } from "../shared.ts";

const HELP = `uikit init — 対象プロジェクトに ui-kitchen.json を作成する

使い方: uikit init [options]

オプション:
  --cwd <path>   対象プロジェクトのディレクトリ (既定: カレント)
  --force        既存の ui-kitchen.json を上書きする
  --json         機械可読な形式で出力する
`;

export async function runInit(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    cwd: { type: "string" },
    force: { type: "boolean" },
    json: { type: "boolean" },
  });
  if (showHelp(values, HELP)) return 0;

  const projectRoot = projectDirFrom(values);
  const configPath = join(projectRoot, CONFIG_FILENAME);

  if ((await exists(configPath)) && values.force !== true) {
    console.error(`${configPath} は既に存在する。上書きするなら --force を付ける。`);
    return 1;
  }

  const detected = await detectWebProject(projectRoot);
  await writeConfig(configPath, detected.config);

  if (values.json === true) {
    printJson({ path: configPath, config: detected.config, notes: detected.notes });
    return 0;
  }

  console.log(`${configPath} を作成した`);
  console.log("\n推測した内容:");
  for (const note of detected.notes) {
    console.log(`  - ${note}`);
  }
  console.log("\n出力先が意図と違う場合は ui-kitchen.json の paths を直す。");
  return 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
