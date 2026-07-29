import { UiKitchenError } from "@ui-kitchen/core";
import { runAdd } from "./add.ts";
import { flag, list, type ParsedArgs, parseArgs, UsageError, value } from "./args.ts";
import {
  COMMANDS,
  type CommandName,
  helpJson,
  isCommandName,
  renderCommandHelp,
  renderRootHelp,
} from "./commands.ts";
import { runInit } from "./init.ts";
import { runList } from "./list.ts";
import { projectTarget } from "./project.ts";
import type { CommandResult } from "./result.ts";
import { runShow } from "./show.ts";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliContext {
  io: CliIo;
  /** --cwd 未指定時の対象ディレクトリ。 */
  cwd: string;
}

/**
 * 引数を解釈してコマンドを実行し、終了コードを返す。
 * 出力形式 (--json) はエラー側にも効かせる。片方だけ JSON だと、JSON を
 * 期待している呼び出し側が失敗時に結果を解釈できない。
 */
export async function runCli(argv: string[], context: CliContext): Promise<number> {
  // パースが失敗した場合でも形式を揃える必要があるので、先に生の argv から判定する。
  const json = wantsJson(argv);
  const command = commandOf(argv);

  try {
    const result = await dispatch(argv, command, context);
    if (json) context.io.out(JSON.stringify(result.data, null, 2));
    else if (result.lines.length > 0) context.io.out(result.lines.join("\n"));
    return result.blocked ? 1 : 0;
  } catch (error) {
    // 想定外の例外は原因の特定にスタックトレースが必要なのでそのまま投げる。
    if (!(error instanceof UiKitchenError)) throw error;
    reportError(error, { json, command, io: context.io });
    return 1;
  }
}

function reportError(
  error: UiKitchenError,
  options: { json: boolean; command: CommandName | undefined; io: CliIo },
): void {
  // 使い方の誤りだけ HELP を添える。他のエラー (conflict 等) に添えても情報が埋もれる。
  const withHelp = error instanceof UsageError;

  if (options.json) {
    const help = withHelp ? { help: helpJson(options.command ?? null) } : {};
    options.io.err(JSON.stringify({ error: { code: error.code, message: error.message, ...help } }, null, 2));
    return;
  }

  options.io.err(`error[${error.code}] ${error.message}`);
  if (withHelp) {
    options.io.err(
      `\n${options.command === undefined ? renderRootHelp() : renderCommandHelp(options.command)}`,
    );
  }
}

async function dispatch(
  argv: string[],
  command: CommandName | undefined,
  context: CliContext,
): Promise<CommandResult> {
  const first = argv[0];

  if (command === undefined) {
    // コマンド無しで許すのは HELP の表示だけ。引数なしの実行を成功扱いにすると、
    // 呼び出し側の書き間違いが終了コードに出ない。
    if (first === "--help" || first === "-h") {
      return { lines: [renderRootHelp()], data: helpJson(null) };
    }
    if (first === undefined) {
      throw new UsageError("コマンドを指定する");
    }
    if (first.startsWith("-")) {
      // --json だけを渡された場合もここに来る。HELP を JSON で返すより、
      // 「コマンドが無い」と明示した方が呼び出し側が直しやすい。
      throw new UsageError(`コマンドより先にオプションは書けない: ${first}`);
    }
    throw new UsageError(`未知のコマンド: ${first}`);
  }

  const args = parseArgs(argv.slice(1), COMMANDS[command].options);
  if (flag(args, "help")) {
    return { lines: [renderCommandHelp(command)], data: helpJson(command) };
  }

  switch (command) {
    case "init":
      expectPositionals(args, command, 0);
      return await runInit({
        target: projectTarget(value(args, "cwd"), context.cwd),
        force: flag(args, "force"),
      });
    case "list":
      expectPositionals(args, command, 0);
      return await runList({
        kind: value(args, "kind"),
        tag: value(args, "tag"),
        platform: value(args, "platform"),
      });
    case "show": {
      expectPositionals(args, command, 1);
      const [recipeId] = args.positionals;
      return await runShow(recipeId ?? "");
    }
    case "add":
      if (args.positionals.length === 0) {
        throw new UsageError(`recipe ID を 1 つ以上指定する (${COMMANDS[command].usage})`);
      }
      return await runAdd({
        target: projectTarget(value(args, "cwd"), context.cwd),
        recipeIds: args.positionals,
        variants: list(args, "variant"),
        dryRun: flag(args, "dry-run"),
        force: flag(args, "force"),
      });
  }
}

/** 余分な位置引数を黙って無視すると、typo したオプションが値として飲まれる。 */
function expectPositionals(args: ParsedArgs, command: CommandName, expected: number): void {
  if (args.positionals.length === expected) return;
  const detail =
    args.positionals.length > expected
      ? `余分な引数: ${args.positionals.slice(expected).join(" ")}`
      : "引数が足りない";
  throw new UsageError(`${detail} (${COMMANDS[command].usage})`);
}

/** `--` より後ろは位置引数なので、そこに現れた --json は文字列として扱う。 */
function wantsJson(argv: string[]): boolean {
  for (const token of argv) {
    if (token === "--") return false;
    if (token === "--json") return true;
  }
  return false;
}

function commandOf(argv: string[]): CommandName | undefined {
  const first = argv[0];
  // コマンドは必ず先頭。オプションの値と位置引数を見分けるために走査すると、
  // `--cwd list` のような並びで誤検出する。
  return first !== undefined && isCommandName(first) ? first : undefined;
}
