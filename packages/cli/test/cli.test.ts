import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupTempDirs, tempDir, write, writeProject, writeRecipe } from "./helpers.ts";

afterEach(cleanupTempDirs);

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

/**
 * CLI を別プロセスで動かす。stdout/stderr をパイプにするのは、書き込みが
 * flush されずにメッセージが消える回帰をここで踏めるようにするため。
 */
async function uikit(args: string[], options: { catalog: string; cwd?: string }): Promise<Result> {
  const proc = Bun.spawn([process.execPath, MAIN, ...args], {
    cwd: options.cwd,
    env: { ...process.env, UI_KITCHEN_CATALOG: options.catalog },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

/** 想定内エラーはスタックトレースを出さない (CI ログで原因行が埋もれる)。 */
function expectError(result: Result, code: string): void {
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toStartWith(`error[${code}] `);
  expect(result.stderr).not.toMatch(/\n\s+at /);
}

async function catalogWith(...names: string[]): Promise<string> {
  const catalog = await tempDir("catalog");
  for (const name of names) await writeRecipe(catalog, name);
  return catalog;
}

describe("引数の扱い", () => {
  test("コマンド無しは使い方エラー", async () => {
    const catalog = await catalogWith();
    const result = await uikit([], { catalog });
    expectError(result, "USAGE");
    // HELP を添える。何が使えるか分からないままでは直せない。
    expect(result.stderr).toContain("uikit <command>");
  });

  test("未知のオプションは HELP 付きで失敗する", async () => {
    const catalog = await catalogWith();
    const result = await uikit(["list", "--kinds", "primitive"], { catalog });
    expectError(result, "USAGE");
    expect(result.stderr).toContain("未知のオプション: --kinds");
    expect(result.stderr).toContain("使い方:");
    expect(result.stderr).toContain("--kind <kind>");
  });

  test("--json のときはエラーも JSON で、HELP も構造化して返す", async () => {
    const catalog = await catalogWith();
    const result = await uikit(["list", "--kinds", "primitive", "--json"], { catalog });
    expect(result.exitCode).toBe(1);
    // stdout は常に有効な JSON か空。エラーは stderr 側に出す。
    expect(result.stdout).toBe("");
    const payload = JSON.parse(result.stderr) as {
      error: { code: string; message: string; help?: { command: string; options: { name: string }[] } };
    };
    expect(payload.error.code).toBe("USAGE");
    expect(payload.error.help?.command).toBe("list");
    expect(payload.error.help?.options.map((option) => option.name)).toContain("kind");
  });

  test("--help と --json を同時指定しても JSON で返る", async () => {
    const catalog = await catalogWith();
    const result = await uikit(["add", "--help", "--json"], { catalog });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { command: string; usage: string };
    expect(payload.command).toBe("add");
    expect(payload.usage).toContain("uikit add");
  });

  test("値の無い string オプションは書き忘れとして弾く", async () => {
    const catalog = await catalogWith();
    // 後続が別のオプションの場合も「値がある」と誤認しないこと。
    const result = await uikit(["list", "--kind"], { catalog });
    expectError(result, "USAGE");
    expect(result.stderr).toContain("--kind には値が必要");
  });
});

describe("init", () => {
  test("--cwd 直下に設定を作り、仮置きした項目を報告する", async () => {
    const catalog = await catalogWith();
    const project = await tempDir("project");
    await mkdir(join(project, "src"));

    const result = await uikit(["init", "--cwd", project], { catalog });
    expect(result.exitCode).toBe(0);

    const config = JSON.parse(await readFile(join(project, "ui-kitchen.json"), "utf8")) as {
      paths: { componentsDir: string };
    };
    expect(config.paths.componentsDir).toBe("src/components");
    // 検出できなかった項目は「仮置きした」と分かる形で出す。
    expect(result.stdout).toContain("確認");
    expect(result.stdout).toContain("importAlias");
  });

  test("既存の設定は --force なしで上書きしない", async () => {
    const catalog = await catalogWith();
    const project = await tempDir("project");
    await writeProject(project);

    const before = await readFile(join(project, "ui-kitchen.json"), "utf8");
    const blocked = await uikit(["init", "--cwd", project], { catalog });
    expectError(blocked, "CONFIG_EXISTS");
    // 弾いたときに書き込みが起きていないこと (排他的作成に任せている)。
    expect(await readFile(join(project, "ui-kitchen.json"), "utf8")).toBe(before);

    const forced = await uikit(["init", "--cwd", project, "--force"], { catalog });
    expect(forced.exitCode).toBe(0);
    expect(forced.stdout).toContain("上書きした");
  });
});

describe("list", () => {
  test("kind はディレクトリ名でも指定でき、一致しない条件では空になる", async () => {
    const catalog = await catalogWith("button", "input");

    const all = await uikit(["list"], { catalog });
    expect(all.exitCode).toBe(0);
    expect(all.stdout).toContain("web/primitives/button");
    expect(all.stdout).toContain("web/primitives/input");

    const byDirectory = await uikit(["list", "--kind", "primitives", "--json"], { catalog });
    const payload = JSON.parse(byDirectory.stdout) as { count: number; recipes: { id: string }[] };
    expect(payload.count).toBe(2);
    expect(payload.recipes.map((recipe) => recipe.id)).toEqual([
      "web/primitives/button",
      "web/primitives/input",
    ]);

    const empty = await uikit(["list", "--tag", "nope"], { catalog });
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout).toContain("一致する recipe が無い");
  });

  test("未知の kind は候補を添えて弾く", async () => {
    const catalog = await catalogWith("button");
    const result = await uikit(["list", "--kind", "widget"], { catalog });
    expectError(result, "USAGE");
    expect(result.stderr).toContain("使用できる kind");
  });

  test("Object.prototype 由来の名前を kind として受理しない", async () => {
    const catalog = await catalogWith("button");
    // 素の添字アクセスだと継承値が返り、USAGE エラーにならず「0 件」になる。
    for (const name of ["constructor", "__proto__", "toString"]) {
      const result = await uikit(["list", "--kind", name], { catalog });
      expectError(result, "USAGE");
    }
  });
});

describe("show", () => {
  test("依存の解決順とファイルの対応を出す", async () => {
    const catalog = await tempDir("catalog");
    await writeRecipe(catalog, "cn");
    await writeRecipe(catalog, "button", { requires: ["web/primitives/cn"], variants: ["with-loading"] });

    const result = await uikit(["show", "web/primitives/button"], { catalog });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("web/primitives/cn -> web/primitives/button");
    expect(result.stdout).toContain("{{@componentsDir}}/button.tsx");
    expect(result.stdout).toContain("with-loading");
  });

  test("存在しない ID は候補付きで失敗する", async () => {
    const catalog = await catalogWith("button");
    const result = await uikit(["show", "web/primitives/nope"], { catalog });
    expectError(result, "RECIPE_NOT_FOUND");
    expect(result.stderr).toContain("web/primitives/button");
  });

  test("引数が多いときは使い方エラー", async () => {
    const catalog = await catalogWith("button");
    const result = await uikit(["show", "web/primitives/button", "extra"], { catalog });
    expectError(result, "USAGE");
    expect(result.stderr).toContain("余分な引数: extra");
  });
});

describe("add", () => {
  test("dry-run は書き込まず、適用は冪等", async () => {
    const catalog = await catalogWith("button");
    const project = await tempDir("project");
    await writeProject(project);

    const planned = await uikit(["add", "web/primitives/button", "--dry-run"], {
      catalog,
      cwd: project,
    });
    expect(planned.exitCode).toBe(0);
    expect(planned.stdout).toContain("create    src/components/ui/button.tsx");
    expect(await exists(join(project, "src/components/ui/button.tsx"))).toBe(false);

    const applied = await uikit(["add", "web/primitives/button"], { catalog, cwd: project });
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain("src/components/ui/button.tsx");
    const written = await readFile(join(project, "src/components/ui/button.tsx"), "utf8");

    const again = await uikit(["add", "web/primitives/button"], { catalog, cwd: project });
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("既存と同一なので触っていない");
    expect(await readFile(join(project, "src/components/ui/button.tsx"), "utf8")).toBe(written);
  });

  test("conflict があれば dry-run でも終了コード 1 と blocked を返す", async () => {
    const catalog = await catalogWith("button");
    const project = await tempDir("project");
    await writeProject(project);
    await write(project, "src/components/ui/button.tsx", "手で書いた内容\n");

    const planned = await uikit(["add", "web/primitives/button", "--dry-run", "--json"], {
      catalog,
      cwd: project,
    });
    // 終了コードだけを見る呼び出し側が「適用できる」と誤判断しないこと。
    expect(planned.exitCode).toBe(1);
    const payload = JSON.parse(planned.stdout) as { blocked: boolean; conflicts: string[] };
    expect(payload.blocked).toBe(true);
    expect(payload.conflicts).toEqual(["src/components/ui/button.tsx"]);

    const applied = await uikit(["add", "web/primitives/button"], { catalog, cwd: project });
    expectError(applied, "APPLY_BLOCKED");
    expect(await readFile(join(project, "src/components/ui/button.tsx"), "utf8")).toBe("手で書いた内容\n");

    const forced = await uikit(["add", "web/primitives/button", "--force"], { catalog, cwd: project });
    expect(forced.exitCode).toBe(0);
    expect(await readFile(join(project, "src/components/ui/button.tsx"), "utf8")).not.toBe(
      "手で書いた内容\n",
    );
  });

  test("不足している npm 依存を install コマンド付きで報告する (install はしない)", async () => {
    const catalog = await tempDir("catalog");
    await writeRecipe(catalog, "button", { dependencies: { clsx: "^2.1.0", react: "^19.0.0" } });
    const project = await tempDir("project");
    await writeProject(project, { dependencies: { react: "^18.2.0" } });

    const result = await uikit(["add", "web/primitives/button", "--dry-run", "--json"], {
      catalog,
      cwd: project,
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      dependencies: {
        missing: { name: string }[];
        incompatible: { name: string }[];
        installCommand: string;
      };
    };
    expect(payload.dependencies.missing.map((dependency) => dependency.name)).toEqual(["clsx"]);
    // 未宣言と範囲不一致は対処が違うので別枠で出る。
    expect(payload.dependencies.incompatible.map((dependency) => dependency.name)).toEqual(["react"]);
    expect(payload.dependencies.installCommand).toBe('pnpm add "clsx@^2.1.0"');
    expect(await exists(join(project, "node_modules"))).toBe(false);
  });

  test("--cwd を指定したら上位の設定を拾わない", async () => {
    const catalog = await catalogWith("button");
    const root = await tempDir("monorepo");
    await writeProject(root);
    const nested = join(root, "apps", "web");
    await mkdir(nested, { recursive: true });

    const result = await uikit(["add", "web/primitives/button", "--cwd", nested], { catalog });
    // 「壊れている」ではなく「無い」と分かるコードで返す。
    expectError(result, "CONFIG_NOT_FOUND");
    expect(result.stderr).toContain("上位ディレクトリは探索しない");
    // 祖先の設定を使って生成してしまわないこと。
    expect(await exists(join(root, "src/components/ui/button.tsx"))).toBe(false);
  });

  test("--cwd 無しならカレントから上位の設定を探す", async () => {
    const catalog = await catalogWith("button");
    const root = await tempDir("project");
    await writeProject(root);
    const nested = join(root, "src", "features");
    await mkdir(nested, { recursive: true });

    const result = await uikit(["add", "web/primitives/button"], { catalog, cwd: nested });
    expect(result.exitCode).toBe(0);
    expect(await exists(join(root, "src/components/ui/button.tsx"))).toBe(true);
  });

  test("recipe ID を省略したら使い方エラー", async () => {
    const catalog = await catalogWith("button");
    const project = await tempDir("project");
    await writeProject(project);

    const result = await uikit(["add"], { catalog, cwd: project });
    expectError(result, "USAGE");
    expect(result.stderr).toContain("recipe ID を 1 つ以上指定する");
  });
});

/** ディレクトリも対象にするので Bun.file().exists() ではなく lstat で見る。 */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
