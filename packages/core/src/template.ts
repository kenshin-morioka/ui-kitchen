import { TemplateError } from "./errors.ts";
import { TEMPLATE_VARIABLES, type TemplateVariable } from "./schema.ts";

export type TemplateVars = Record<TemplateVariable, string>;

export interface ExpandOptions {
  vars: TemplateVars;
  /** 有効な variant 名。テンプレート側の条件ブロックの採否を決める。 */
  enabledVariants?: Iterable<string>;
  /** recipe が宣言している variant 名。未宣言の variant 参照はエラーにする。 */
  declaredVariants?: Iterable<string>;
  /** エラーメッセージに出す識別子。 */
  source?: string;
}

/**
 * 行頭のコメント記号を許容して条件ブロックを書けるようにしている。
 * テンプレート自体が構文的に壊れないため、実ファイルとして編集・確認できる。
 *   // {{#if variant.with-loading}}
 *   {{/if}}
 * 末尾の `\r?` は CRLF 改行の recipe でも一致させるため。
 */
const IF_LINE =
  /^[ \t]*(?:\/\/|#|\/\*|\{\/\*|<!--)?[ \t]*\{\{#if[ \t]+variant\.([a-z0-9-]+)[ \t]*\}\}[ \t]*(?:\*\/|\*\/\}|-->)?[ \t]*\r?$/;
const END_LINE = /^[ \t]*(?:\/\/|#|\/\*|\{\/\*|<!--)?[ \t]*\{\{\/if\}\}[ \t]*(?:\*\/|\*\/\}|-->)?[ \t]*\r?$/;

/**
 * 変数参照は `{{@name}}` と書く。`@` を必須にしているのは JSX の二重波括弧
 * (`style={{ color: "red" }}` や `animate={{opacity}}`) と衝突させないため。
 * `@` 無しにすると、これらを変数参照と誤認して展開が壊れる。
 */
const PLACEHOLDER = /\{\{[ \t]*@([A-Za-z][A-Za-z0-9]*)?[ \t]*\}\}/g;

/** 条件ブロックの取捨をすり抜けた `{{#if}}` / `{{/if}}` の痕跡。 */
const LEFTOVER_MARKER = /\{\{[ \t]*[#/]/;

/**
 * テンプレートを展開する。処理は「variant 条件ブロックの取捨」と
 * 「固定名の変数置換」の 2 つだけで、任意の式は評価しない。
 */
export function expandTemplate(source: string, options: ExpandOptions): string {
  const label = options.source ?? "template";
  const enabled = new Set(options.enabledVariants ?? []);
  const declared = options.declaredVariants ? new Set(options.declaredVariants) : undefined;

  const lines = source.split("\n");
  const output: string[] = [];
  /** 現在開いている条件ブロック。ネストは許可しない。 */
  let open: { variant: string; keep: boolean; line: number } | undefined;

  for (const [index, line] of lines.entries()) {
    const ifMatch = line.match(IF_LINE);
    const variant = ifMatch?.[1];
    if (variant !== undefined) {
      if (open) {
        throw new TemplateError(
          `${label}:${index + 1} 条件ブロックはネストできない (${open.variant} の中に ${variant})`,
        );
      }
      if (declared && !declared.has(variant)) {
        throw new TemplateError(
          `${label}:${index + 1} recipe が宣言していない variant を参照している: ${variant}`,
        );
      }
      open = { variant, keep: enabled.has(variant), line: index + 1 };
      continue;
    }

    if (END_LINE.test(line)) {
      if (!open) {
        throw new TemplateError(`${label}:${index + 1} 対応する {{#if}} のない {{/if}}`);
      }
      open = undefined;
      continue;
    }

    // 破棄する行でも変数名だけは検証する。そうしないと、無効な variant の
    // ブロックに書かれた typo が variant を有効にした瞬間まで見つからない。
    assertKnownVariables(line, label, index + 1);

    if (!open || open.keep) {
      output.push(line);
    }
  }

  if (open) {
    throw new TemplateError(`${label}:${open.line} 閉じられていない {{#if variant.${open.variant}}}`);
  }

  const expanded = output.join("\n");
  const leftover = expanded.split("\n").findIndex((line) => LEFTOVER_MARKER.test(line));
  if (leftover >= 0) {
    throw new TemplateError(
      `${label}:${leftover + 1} 条件ブロックの記法が壊れている。{{#if variant.<name>}} と {{/if}} はそれぞれ独立した行に書く`,
    );
  }

  return substituteVariables(expanded, options.vars, label);
}

/** `{{@name}}` を置換する。未知の変数名はエラーにして黙って残さない。 */
export function substituteVariables(source: string, vars: TemplateVars, label = "template"): string {
  return source.replace(PLACEHOLDER, (match, rawName: string | undefined) => {
    const name = rawName ?? "";
    if (isTemplateVariable(name)) {
      return vars[name];
    }
    throw new TemplateError(unknownVariableMessage(label, match, name));
  });
}

/** 行内の `{{@name}}` が既知の変数かどうかだけを検査する (置換はしない)。 */
function assertKnownVariables(line: string, label: string, lineNumber: number): void {
  for (const match of line.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    if (!isTemplateVariable(name)) {
      throw new TemplateError(unknownVariableMessage(`${label}:${lineNumber}`, match[0], name));
    }
  }
}

function unknownVariableMessage(label: string, raw: string, name: string): string {
  const shown = name === "" ? raw : `{{@${name}}}`;
  return `${label} に未知のテンプレート変数がある: ${shown}\n使用できる変数: ${TEMPLATE_VARIABLES.map(
    (variable) => `{{@${variable}}}`,
  ).join(", ")}`;
}

function isTemplateVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}
