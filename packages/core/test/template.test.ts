import { describe, expect, test } from "bun:test";
import { TemplateError } from "../src/errors.ts";
import { expandTemplate, substituteVariables } from "../src/template.ts";

const vars = {
  componentsDir: "src/components",
  hooksDir: "src/hooks",
  libDir: "src/lib",
  stylesDir: "src/styles",
  // import 系は aliasBase ("src") からの相対で組まれた結果を入れる。
  componentsImport: "@/components",
  hooksImport: "@/hooks",
  libImport: "@/lib",
  stylesImport: "@/styles",
};

describe("変数の置換", () => {
  test("{{@name}} を置換する", () => {
    expect(expandTemplate('import { cn } from "{{@libImport}}/cn";', { vars })).toBe(
      'import { cn } from "@/lib/cn";',
    );
  });

  test("波括弧の内側の空白を許容する", () => {
    expect(expandTemplate("{{ @libDir }}/cn.ts", { vars })).toBe("src/lib/cn.ts");
  });

  test("未知の変数はエラーにする", () => {
    expect(() => expandTemplate("{{@unknownVar}}", { vars })).toThrow(TemplateError);
    expect(() => expandTemplate("{{@}}", { vars })).toThrow(TemplateError);
  });

  test("置換した値の中身は再スキャンしない", () => {
    // 設定値が "{{@libDir}}" のような文字列でも二重置換されないこと。
    expect(substituteVariables("{{@libImport}}", { ...vars, libImport: "{{@libDir}}" })).toBe("{{@libDir}}");
  });
});

// JSX / CSS-in-JS の二重波括弧を変数参照と誤認すると、React の recipe が
// ほぼ全て展開時に落ちる。@ を必須にしているのはこのため。
describe("JSX の二重波括弧との衝突", () => {
  test("style={{ ... }} をそのまま残す", () => {
    const source = '<div style={{ color: "red" }} />';
    expect(expandTemplate(source, { vars })).toBe(source);
  });

  test("短縮記法 animate={{opacity}} をそのまま残す", () => {
    const source = "<motion.div animate={{opacity}} />";
    expect(expandTemplate(source, { vars })).toBe(source);
  });

  test("複数行にまたがる二重波括弧をそのまま残す", () => {
    const source = ["<div style={{", '  color: "red",', "}} />"].join("\n");
    expect(expandTemplate(source, { vars })).toBe(source);
  });

  test("同じ行に JSX の波括弧と変数参照が混在しても変数だけ置換する", () => {
    expect(expandTemplate('<img src="{{@libDir}}/x.png" style={{ width: 1 }} />', { vars })).toBe(
      '<img src="src/lib/x.png" style={{ width: 1 }} />',
    );
  });
});

describe("variant の条件ブロック", () => {
  const source = ["a", "// {{#if variant.with-loading}}", "spinner", "// {{/if}}", "b"].join("\n");

  test("有効な variant のブロックだけを残す", () => {
    expect(expandTemplate(source, { vars, enabledVariants: ["with-loading"] })).toBe(
      ["a", "spinner", "b"].join("\n"),
    );
    expect(expandTemplate(source, { vars, enabledVariants: [] })).toBe(["a", "b"].join("\n"));
  });

  test("CRLF 改行でもブロックを認識する", () => {
    const crlf = source.replaceAll("\n", "\r\n");
    expect(expandTemplate(crlf, { vars, enabledVariants: ["with-loading"] })).toBe(
      ["a", "spinner", "b"].join("\r\n"),
    );
    expect(expandTemplate(crlf, { vars, enabledVariants: [] })).toBe(["a", "b"].join("\r\n"));
  });

  test("コメント記号なし・ブロックコメント・HTML コメントを扱える", () => {
    for (const [start, end] of [
      ["{{#if variant.x}}", "{{/if}}"],
      ["/* {{#if variant.x}} */", "/* {{/if}} */"],
      ["<!-- {{#if variant.x}} -->", "<!-- {{/if}} -->"],
    ] as const) {
      expect(expandTemplate([start, "yes", end].join("\n"), { vars, enabledVariants: ["x"] })).toBe("yes");
    }
  });

  test("recipe が宣言していない variant の参照はエラーにする", () => {
    const unknown = ["// {{#if variant.ghost}}", "x", "// {{/if}}"].join("\n");
    expect(() => expandTemplate(unknown, { vars, declaredVariants: ["with-loading"] })).toThrow(
      /宣言していない variant/,
    );
  });

  test("無効な variant のブロック内にある変数の誤りも検出する", () => {
    // 破棄されるブロックを検証しないと、variant を有効にした瞬間に初めて壊れる。
    const typo = ["// {{#if variant.x}}", "{{@componenstDir}}", "// {{/if}}", "ok"].join("\n");
    expect(() => expandTemplate(typo, { vars, enabledVariants: [] })).toThrow(/未知のテンプレート変数/);
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

  test("行の途中に書かれた条件ブロックは黙って残さずエラーにする", () => {
    expect(() => expandTemplate("const a = 1; {{#if variant.x}}", { vars, enabledVariants: ["x"] })).toThrow(
      /条件ブロックの記法が壊れている/,
    );
  });

  test("末尾の改行を保つ", () => {
    expect(expandTemplate("a\n", { vars })).toBe("a\n");
  });
});
