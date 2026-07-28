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
 */
const IF_LINE =
  /^[ \t]*(?:\/\/|#|\/\*|\{\/\*|<!--)?[ \t]*\{\{#if[ \t]+variant\.([a-z0-9-]+)[ \t]*\}\}[ \t]*(?:\*\/|\*\/\}|-->)?[ \t]*$/;
const END_LINE = /^[ \t]*(?:\/\/|#|\/\*|\{\/\*|<!--)?[ \t]*\{\{\/if\}\}[ \t]*(?:\*\/|\*\/\}|-->)?[ \t]*$/;
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

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

    if (!open || open.keep) {
      output.push(line);
    }
  }

  if (open) {
    throw new TemplateError(`${label}:${open.line} 閉じられていない {{#if variant.${open.variant}}}`);
  }

  return substituteVariables(output.join("\n"), options.vars, label);
}

/** `{{name}}` を置換する。未知の変数名はエラーにして黙って残さない。 */
export function substituteVariables(source: string, vars: TemplateVars, label = "template"): string {
  return source.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim();
    if (isTemplateVariable(name)) {
      return vars[name];
    }
    throw new TemplateError(
      `${label} に未知のテンプレート変数がある: {{${name}}}\n使用できる変数: ${TEMPLATE_VARIABLES.join(", ")}`,
    );
  });
}

function isTemplateVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}
