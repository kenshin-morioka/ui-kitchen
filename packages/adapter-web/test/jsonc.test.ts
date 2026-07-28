import { describe, expect, test } from "bun:test";
import { ConfigError } from "@ui-kitchen/core";
import { parseJsonc } from "../src/jsonc.ts";

describe("parseJsonc", () => {
  test("行コメント・ブロックコメント・末尾カンマを許容する", () => {
    const source = `{
  // Linting
  "strict": true,
  /* Bundler mode */
  "paths": {
    "@/*": ["./src/*"],
  },
}`;
    // 素の JSON.parse では落ちる入力であることを明示しておく。
    expect(() => JSON.parse(source)).toThrow();
    expect(parseJsonc(source, "tsconfig.json")).toEqual({
      strict: true,
      paths: { "@/*": ["./src/*"] },
    });
  });

  test("文字列リテラル内のスラッシュやカンマを壊さない", () => {
    const source = `{
  "url": "https://example.com/a/b", // 末尾のコメント
  "block": "/* not a comment */",
  "commaLike": "trailing, ]",
  "escaped": "say \\"hi\\" // still text"
}`;
    expect(parseJsonc(source, "tsconfig.json")).toEqual({
      url: "https://example.com/a/b",
      block: "/* not a comment */",
      commaLike: "trailing, ]",
      escaped: 'say "hi" // still text',
    });
  });

  test("配列の末尾カンマも落とす", () => {
    expect(parseJsonc('{ "a": [1, 2, ], }', "tsconfig.json")).toEqual({ a: [1, 2] });
  });

  test("それでも壊れている場合は ConfigError (黙って既定値に落とさない)", () => {
    expect(() => parseJsonc("{ oops", "tsconfig.json")).toThrow(ConfigError);
    // 閉じられていないブロックコメントで無限ループしないこと。
    expect(() => parseJsonc('{ "a": 1 /* unterminated', "tsconfig.json")).toThrow(ConfigError);
    // 閉じられていない文字列でも同様。
    expect(() => parseJsonc('{ "a": "unterminated', "tsconfig.json")).toThrow(ConfigError);
  });
});
