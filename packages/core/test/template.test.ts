import { describe, expect, test } from "bun:test";
import { TemplateError } from "../src/errors.ts";
import { expandTemplate } from "../src/template.ts";

const vars = {
  componentsDir: "src/components",
  hooksDir: "src/hooks",
  libDir: "src/lib",
  stylesDir: "src/styles",
  importAlias: "@/",
};

describe("expandTemplate", () => {
  test("変数を置換する", () => {
    expect(expandTemplate('import { cn } from "{{importAlias}}lib/cn";', { vars })).toBe(
      'import { cn } from "@/lib/cn";',
    );
  });

  test("未知の変数はエラーにする", () => {
    expect(() => expandTemplate("{{unknownVar}}", { vars })).toThrow(TemplateError);
  });

  test("有効な variant のブロックだけを残す", () => {
    const source = ["a", "// {{#if variant.with-loading}}", "spinner", "// {{/if}}", "b"].join("\n");

    expect(expandTemplate(source, { vars, enabledVariants: ["with-loading"] })).toBe(
      ["a", "spinner", "b"].join("\n"),
    );
    expect(expandTemplate(source, { vars, enabledVariants: [] })).toBe(["a", "b"].join("\n"));
  });

  test("コメント記号なしの条件ブロックも扱える", () => {
    const source = ["{{#if variant.x}}", "yes", "{{/if}}"].join("\n");
    expect(expandTemplate(source, { vars, enabledVariants: ["x"] })).toBe("yes");
  });

  test("recipe が宣言していない variant の参照はエラーにする", () => {
    const source = ["// {{#if variant.ghost}}", "x", "// {{/if}}"].join("\n");
    expect(() => expandTemplate(source, { vars, declaredVariants: ["with-loading"] })).toThrow(
      /宣言していない variant/,
    );
  });

  test("閉じ忘れ・対応しない閉じタグ・ネストを弾く", () => {
    expect(() => expandTemplate("// {{#if variant.x}}\na", { vars, enabledVariants: ["x"] })).toThrow(
      /閉じられていない/,
    );
    expect(() => expandTemplate("// {{/if}}", { vars })).toThrow(/対応する/);
    expect(() =>
      expandTemplate(["{{#if variant.a}}", "{{#if variant.b}}", "{{/if}}", "{{/if}}"].join("\n"), {
        vars,
      }),
    ).toThrow(/ネスト/);
  });

  test("同じ入力からは常に同じ出力を得る (決定性)", () => {
    const source = ["{{importAlias}}lib/cn", "// {{#if variant.x}}", "y", "// {{/if}}"].join("\n");
    const first = expandTemplate(source, { vars, enabledVariants: ["x"] });
    const second = expandTemplate(source, { vars, enabledVariants: ["x"] });
    expect(first).toBe(second);
  });
});
