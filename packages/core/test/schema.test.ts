import { describe, expect, test } from "bun:test";
import { UiKitchenError, UnknownRecipeError } from "../src/errors.ts";
import { recipeSchema } from "../src/schema.ts";

function recipeWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "web/primitives/button",
    name: "Button",
    kind: "primitive",
    platform: "web",
    description: "ボタン",
    stack: { framework: "react", language: "typescript", styling: "tailwind" },
    files: [{ from: "files/button.tsx", to: "{{@componentsDir}}/ui/button.tsx" }],
    ai: { use_when: "ボタンが必要なとき" },
    ...overrides,
  };
}

describe("recipeSchema.files のパス検証", () => {
  test("正しい recipe を受け入れる", () => {
    expect(recipeSchema.safeParse(recipeWith({})).success).toBe(true);
  });

  test.each([
    ["POSIX の traversal", "../../etc/passwd"],
    ["Windows の traversal", "..\\..\\etc\\passwd"],
    ["途中の traversal", "files/../../secret.ts"],
    ["POSIX の絶対パス", "/etc/passwd"],
    ["Windows の絶対パス", "C:\\Users\\me\\.ssh\\id_rsa"],
    ["Windows の区切りで始まるパス", "\\\\server\\share\\x.ts"],
    ["ホーム起点", "~/.ssh/id_rsa"],
    ["カレントディレクトリ", "."],
    ["ディレクトリ指定", "files/"],
  ])("from に %s を許可しない: %s", (_label, from) => {
    expect(recipeSchema.safeParse(recipeWith({ files: [{ from, to: "a.ts" }] })).success).toBe(false);
  });

  test("同じ出力先を複数の files で指定できない", () => {
    const files = [
      { from: "files/a.tsx", to: "{{@componentsDir}}/ui/x.tsx" },
      { from: "files/b.tsx", to: "{{@componentsDir}}/ui/x.tsx" },
    ];
    expect(recipeSchema.safeParse(recipeWith({ files })).success).toBe(false);
  });
});

describe("recipe ID の検証", () => {
  test.each([
    ["未知の platform", "ios/primitives/button"],
    ["未知の kind ディレクトリ", "web/bar/button"],
    ["階層が足りない", "web/button"],
    ["kebab-case でない", "web/primitives/Button"],
  ])("%s を許可しない: %s", (_label, id) => {
    expect(recipeSchema.safeParse(recipeWith({ id })).success).toBe(false);
    // requires 側も同じ検証を通す (typo が UnknownRecipeError まで遅延しないこと)。
    expect(recipeSchema.safeParse(recipeWith({ requires: [id] })).success).toBe(false);
  });

  test("すべての kind ディレクトリを受け入れる", () => {
    for (const [id, kind] of [
      ["web/tokens/base", "tokens"],
      ["web/lib/cn", "lib"],
      ["web/primitives/button", "primitive"],
      ["web/components/data-table", "component"],
      ["web/blocks/auth-card", "block"],
      ["web/layouts/app-shell", "layout"],
      ["web/pages/dashboard", "page"],
    ] as const) {
      expect(recipeSchema.safeParse(recipeWith({ id, kind })).success).toBe(true);
    }
  });
});

describe("既定値", () => {
  test("省略した配列とオブジェクトを空で埋める", () => {
    const parsed = recipeSchema.parse(recipeWith({}));
    expect(parsed.tags).toEqual([]);
    expect(parsed.requires).toEqual([]);
    expect(parsed.variants).toEqual([]);
    expect(parsed.dependencies).toEqual({});
    expect(parsed.ai.do_not).toEqual([]);
  });
});

describe("エラー", () => {
  test("サブクラスのクラス名が name に出る", () => {
    const error = new UnknownRecipeError("web/lib/nope", []);
    expect(error.name).toBe("UnknownRecipeError");
    expect(error.code).toBe("RECIPE_NOT_FOUND");
    expect(error).toBeInstanceOf(UiKitchenError);
  });

  test("候補が多い場合は 10 件までに切り詰める", () => {
    const available = Array.from({ length: 30 }, (_, index) => `web/lib/x${index}`);
    const message = new UnknownRecipeError("web/lib/nope", available).message;
    expect(message).toContain("web/lib/x9");
    expect(message).not.toContain("web/lib/x10");
  });
});
