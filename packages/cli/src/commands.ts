import { PLATFORMS, RECIPE_KINDS } from "@ui-kitchen/core";
import { formatOption, type OptionSpec, type OptionSpecs } from "./args.ts";

export const COMMAND_NAMES = ["init", "list", "show", "add"] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export interface CommandDefinition {
  summary: string;
  usage: string;
  options: OptionSpecs;
  /** HELP の末尾に出す補足。決定性や運用上の注意はここに書く。 */
  notes: string[];
}

/** すべてのコマンドが持つオプション。 */
const COMMON_OPTIONS: OptionSpecs = {
  json: { type: "boolean", description: "結果を JSON で出力する (エラーも JSON になる)" },
  help: { type: "boolean", short: "h", description: "このヘルプを表示する" },
};

/** 対象プロジェクトを引数に取るコマンドのオプション。 */
const PROJECT_OPTIONS: OptionSpecs = {
  cwd: {
    type: "string",
    placeholder: "dir",
    description: "対象プロジェクトのディレクトリ (既定: カレント)。指定した場合は上位を探索しない",
  },
};

export const COMMANDS: Record<CommandName, CommandDefinition> = {
  init: {
    summary: "プロジェクトを覗いて ui-kitchen.json を作成する",
    usage: "uikit init [options]",
    options: {
      ...PROJECT_OPTIONS,
      force: { type: "boolean", description: "既存の ui-kitchen.json を上書きする" },
      ...COMMON_OPTIONS,
    },
    notes: [
      "検出できなかった項目は仮置きし、その理由を「確認」として出す。生成される import が解決できない場合はまず importAlias を疑う。",
    ],
  },
  list: {
    summary: "カタログの recipe を一覧する",
    usage: "uikit list [options]",
    options: {
      kind: {
        type: "string",
        placeholder: "kind",
        description: `kind で絞り込む (${RECIPE_KINDS.join(" | ")})。ディレクトリ名 (primitives 等) でも指定できる`,
      },
      tag: { type: "string", placeholder: "tag", description: "tag で絞り込む" },
      platform: {
        type: "string",
        placeholder: "platform",
        description: `platform で絞り込む (${PLATFORMS.join(" | ")})`,
      },
      ...COMMON_OPTIONS,
    },
    notes: [],
  },
  show: {
    summary: "recipe のメタ情報・生成されるファイル・依存を表示する",
    usage: "uikit show <recipe-id> [options]",
    options: { ...COMMON_OPTIONS },
    notes: ["出力先はテンプレート変数のまま表示する。展開後のパスは 'uikit add --dry-run' で確認する。"],
  },
  add: {
    summary: "recipe を解決してプロジェクトにファイルを生成する",
    usage: "uikit add <recipe-id...> [options]",
    options: {
      ...PROJECT_OPTIONS,
      variant: {
        type: "string",
        short: "v",
        multiple: true,
        placeholder: "name",
        description: "variant を有効にする。依存 recipe に効かせるなら <recipe-id>:<variant>",
      },
      "dry-run": { type: "boolean", description: "書き込まずに生成計画だけを出す" },
      force: { type: "boolean", description: "内容の異なる既存ファイルを上書きする" },
      ...COMMON_OPTIONS,
    },
    notes: [
      "内容の異なる既存ファイル (conflict) が 1 件でもあれば何も書き込まない。部分適用は壊れた状態を残すため。",
      "--dry-run でも conflict があれば終了コードは 1 (JSON では blocked: true)。適用可能かを終了コードで判定できるようにするため。",
      "npm 依存は install しない。不足を報告するだけなので、提示されたコマンドは自分で実行する。",
    ],
  },
};

export function isCommandName(value: string): value is CommandName {
  return (COMMAND_NAMES as readonly string[]).includes(value);
}

const GLOBAL_NOTES = [
  "カタログの場所は UI_KITCHEN_CATALOG で上書きできる。",
  '想定内のエラーは終了コード 1。JSON 指定時のエラーは stderr に {"error":{...}} で出す (stdout は常に有効な JSON か空)。',
];

export function renderCommandHelp(name: CommandName): string {
  const command = COMMANDS[name];
  const lines = [`uikit ${name} — ${command.summary}`, "", "使い方:", `  ${command.usage}`];

  const options = Object.entries(command.options);
  if (options.length > 0) {
    const labels = options.map(([optionName, spec]) => formatOption(optionName, spec));
    const width = Math.max(...labels.map((label) => label.length));
    lines.push("", "オプション:");
    for (const [index, [, spec]] of options.entries()) {
      lines.push(`  ${(labels[index] ?? "").padEnd(width)}  ${spec.description}`);
    }
  }

  const notes = [...command.notes, ...GLOBAL_NOTES];
  lines.push("", "備考:", ...notes.map((note) => `  - ${note}`));
  return lines.join("\n");
}

export function renderRootHelp(): string {
  const width = Math.max(...COMMAND_NAMES.map((name) => name.length));
  return [
    "uikit — カタログの recipe を決定的にプロジェクトへ生成する",
    "",
    "使い方:",
    "  uikit <command> [options]",
    "",
    "コマンド:",
    ...COMMAND_NAMES.map((name) => `  ${name.padEnd(width)}  ${COMMANDS[name].summary}`),
    "",
    "備考:",
    ...GLOBAL_NOTES.map((note) => `  - ${note}`),
    "  - 各コマンドの詳細は 'uikit <command> --help'。",
  ].join("\n");
}

export interface HelpJson {
  command: CommandName | null;
  summary: string;
  usage: string;
  options: { flag: string; name: string; type: OptionSpec["type"]; description: string }[];
  notes: string[];
  commands?: { name: CommandName; summary: string }[];
}

export function helpJson(name: CommandName | null): HelpJson {
  if (name === null) {
    return {
      command: null,
      summary: "カタログの recipe を決定的にプロジェクトへ生成する",
      usage: "uikit <command> [options]",
      options: [],
      notes: GLOBAL_NOTES,
      commands: COMMAND_NAMES.map((command) => ({ name: command, summary: COMMANDS[command].summary })),
    };
  }

  const command = COMMANDS[name];
  return {
    command: name,
    summary: command.summary,
    usage: command.usage,
    options: Object.entries(command.options).map(([optionName, spec]) => ({
      flag: formatOption(optionName, spec),
      name: optionName,
      type: spec.type,
      description: spec.description,
    })),
    notes: [...command.notes, ...GLOBAL_NOTES],
  };
}
