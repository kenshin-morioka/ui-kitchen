import { UiKitchenError } from "@ui-kitchen/core";

/**
 * 使い方の誤り。呼び出し側 (main) が HELP を添えて表示する。
 * node:util の parseArgs を使わないのは、未知オプションのメッセージが英語で
 * かつ「`--` を使え」という無関係な助言が付き、CLI の他のエラーと形が揃わないため。
 */
export class UsageError extends UiKitchenError {
  constructor(message: string) {
    super("USAGE", message);
  }
}

export interface OptionSpec {
  type: "boolean" | "string";
  /** 1 文字の別名 (`-v` など)。 */
  short?: string;
  /** 同じオプションを複数回指定できるか。string のみ意味を持つ。 */
  multiple?: boolean;
  /** HELP に出す値のプレースホルダ。 */
  placeholder?: string;
  description: string;
}

export type OptionSpecs = Record<string, OptionSpec>;

export interface ParsedArgs {
  positionals: string[];
  /** 指定された boolean オプションの名前。 */
  flags: Set<string>;
  /** 指定された string オプション。値は指定順。 */
  values: Map<string, string[]>;
}

export function parseArgs(argv: string[], specs: OptionSpecs): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  let positionalsOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (positionalsOnly) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      positionalsOnly = true;
      continue;
    }
    // `-` 単体は「標準入力」の慣習的な意味を持つ値なのでオプション扱いしない。
    if (token === "-" || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const { name, inline } = splitToken(token, specs);
    const spec = specs[name];
    if (!spec) throw new UsageError(`未知のオプション: ${token}${optionHint(specs)}`);

    if (spec.type === "boolean") {
      if (inline !== undefined) throw new UsageError(`--${name} は値を取らない (${token})`);
      flags.add(name);
      continue;
    }

    let given = inline;
    if (given === undefined) {
      // 次のトークンが別のオプションなら値の書き忘れ。`-` 始まりの値を渡したい
      // ケースは `--name=値` で表現できるので、そちらへ誘導する。
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-")) {
        throw new UsageError(`--${name} には値が必要 (値が '-' で始まるなら --${name}=値 と書く)`);
      }
      given = next;
      index += 1;
    }

    const current = values.get(name);
    if (current === undefined) {
      values.set(name, [given]);
      continue;
    }
    if (!spec.multiple) throw new UsageError(`--${name} は 1 回だけ指定できる`);
    current.push(given);
  }

  return { positionals, flags, values };
}

/** `--name=value` / `--name` / `-n` を名前と値に分ける。 */
function splitToken(token: string, specs: OptionSpecs): { name: string; inline?: string } {
  const body = token.startsWith("--") ? token.slice(2) : token.slice(1);
  const separator = body.indexOf("=");
  const rawName = separator < 0 ? body : body.slice(0, separator);
  const inline = separator < 0 ? undefined : body.slice(separator + 1);

  if (token.startsWith("--")) return { name: rawName, inline };

  // 短縮形。`-abc` のような連結は解釈しない (どの組み合わせが有効か曖昧になる)。
  if (rawName.length !== 1) {
    throw new UsageError(`短縮オプションは 1 つずつ指定する: ${token}`);
  }
  const matched = Object.entries(specs).find(([, spec]) => spec.short === rawName);
  if (!matched) throw new UsageError(`未知のオプション: ${token}${optionHint(specs)}`);
  return { name: matched[0], inline };
}

function optionHint(specs: OptionSpecs): string {
  const names = Object.entries(specs).map(([name, spec]) => formatOption(name, spec));
  return names.length > 0 ? `\n使用できるオプション: ${names.join(", ")}` : "";
}

/** HELP とエラーメッセージで同じ表記を使う。 */
export function formatOption(name: string, spec: OptionSpec): string {
  const short = spec.short ? `-${spec.short}, ` : "";
  const value = spec.type === "string" ? ` <${spec.placeholder ?? "value"}>` : "";
  return `${short}--${name}${value}`;
}

export function flag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

/** 最後に指定された値。multiple なオプションには list を使う。 */
export function value(args: ParsedArgs, name: string): string | undefined {
  return args.values.get(name)?.at(-1);
}

export function list(args: ParsedArgs, name: string): string[] {
  return args.values.get(name) ?? [];
}
