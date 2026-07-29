import { describe, expect, test } from "bun:test";
import { flag, list, type OptionSpecs, parseArgs, UsageError, value } from "../src/args.ts";

const SPECS: OptionSpecs = {
  cwd: { type: "string", placeholder: "dir", description: "対象ディレクトリ" },
  variant: { type: "string", short: "v", multiple: true, placeholder: "name", description: "variant" },
  json: { type: "boolean", description: "JSON" },
};

describe("parseArgs", () => {
  test("位置引数・値・フラグを分けて取る", () => {
    const args = parseArgs(["web/primitives/button", "--cwd", "/tmp/app", "-v", "a", "--json"], SPECS);
    expect(args.positionals).toEqual(["web/primitives/button"]);
    expect(value(args, "cwd")).toBe("/tmp/app");
    expect(list(args, "variant")).toEqual(["a"]);
    expect(flag(args, "json")).toBe(true);
  });

  test("--name=value 形式と複数指定", () => {
    const args = parseArgs(["--cwd=/tmp/app", "--variant=a", "-v=b"], SPECS);
    expect(value(args, "cwd")).toBe("/tmp/app");
    expect(list(args, "variant")).toEqual(["a", "b"]);
  });

  test("-- の後ろは値として扱う", () => {
    const args = parseArgs(["--", "--json", "-v"], SPECS);
    expect(args.positionals).toEqual(["--json", "-v"]);
    expect(flag(args, "json")).toBe(false);
  });

  test("値が '-' 始まりなら書き忘れとして弾く", () => {
    expect(() => parseArgs(["--cwd", "--json"], SPECS)).toThrow(UsageError);
    // 意図して渡したい場合の書き方は = 形式で通ること。
    expect(value(parseArgs(["--cwd=-weird"], SPECS), "cwd")).toBe("-weird");
  });

  test("boolean に値は渡せない", () => {
    expect(() => parseArgs(["--json=true"], SPECS)).toThrow(UsageError);
  });

  test("multiple でない string の重複は弾く", () => {
    expect(() => parseArgs(["--cwd", "a", "--cwd", "b"], SPECS)).toThrow(UsageError);
  });

  test("未知のオプションは候補を添えて弾く", () => {
    // Node の parseArgs の英語メッセージではなく、使える形を提示する。
    expect(() => parseArgs(["--cwdd", "a"], SPECS)).toThrow(/使用できるオプション: --cwd <dir>/);
    expect(() => parseArgs(["-x"], SPECS)).toThrow(UsageError);
  });

  test("連結した短縮オプションは解釈しない", () => {
    expect(() => parseArgs(["-vj"], SPECS)).toThrow(/1 つずつ/);
  });
});
