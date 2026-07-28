#!/usr/bin/env bun
import { UiKitchenError } from "@ui-kitchen/core";
import { runAdd } from "./commands/add.ts";
import { runInit } from "./commands/init.ts";
import { runList } from "./commands/list.ts";
import { runShow } from "./commands/show.ts";

interface Command {
  summary: string;
  run: (argv: string[]) => Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  init: { summary: "対象プロジェクトに ui-kitchen.json を作成する", run: runInit },
  list: { summary: "カタログの recipe を一覧する", run: runList },
  show: { summary: "recipe の詳細と使い方を表示する", run: runShow },
  add: { summary: "recipe を依存ごとプロジェクトに生成する", run: runAdd },
};

function printUsage(): void {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const lines = Object.entries(COMMANDS).map(
    ([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`,
  );
  console.log(
    [
      "uikit — UI recipe を決定的にプロジェクトへ取り込む",
      "",
      "使い方: uikit <command> [options]",
      "",
      "コマンド:",
      ...lines,
      "",
      "各コマンドの詳細: uikit <command> --help",
      "カタログの場所を上書きする: UI_KITCHEN_CATALOG=<path>",
    ].join("\n"),
  );
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;

  if (!name || name === "--help" || name === "-h" || name === "help") {
    printUsage();
    return 0;
  }
  if (name === "--version" || name === "-v") {
    console.log("0.0.0");
    return 0;
  }

  const command = COMMANDS[name];
  if (!command) {
    console.error(`未知のコマンド: ${name}\n`);
    printUsage();
    return 1;
  }

  return command.run(rest);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (cause) {
  // 想定内のエラーはスタックトレースを出さない (AI が読むログを汚さないため)。
  if (cause instanceof UiKitchenError) {
    console.error(`error[${cause.code}] ${cause.message}`);
    process.exitCode = 1;
  } else {
    throw cause;
  }
}
