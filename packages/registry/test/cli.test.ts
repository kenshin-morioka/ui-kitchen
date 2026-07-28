import { afterEach, describe, expect, test } from "bun:test";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogIndexPath } from "../src/index.ts";
import { cleanupTempCatalogs, tempCatalog, writeInvalidRecipe, writeRecipe } from "./helpers.ts";

afterEach(cleanupTempCatalogs);

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * スクリプトを別プロセスで動かす。
 * stdout/stderr をパイプにするのは、process.exit で flush されずに
 * メッセージが消える回帰をここで踏めるようにするため。
 */
async function run(script: "build.ts" | "validate.ts", catalogRoot: string): Promise<Result> {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", script)], {
    env: { ...process.env, UI_KITCHEN_CATALOG: catalogRoot },
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

/** スタックトレースが出ていないこと。CI ログで原因行が埋もれるのを防ぐため。 */
function expectSingleLineError(stderr: string, code: string): void {
  expect(stderr).toStartWith(`error[${code}] `);
  expect(stderr).not.toMatch(/\n\s+at /);
}

describe("build", () => {
  test("インデックスを生成し、validate が通る状態にする", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button");

    const built = await run("build.ts", root);
    expect(built.exitCode).toBe(0);
    expect(built.stdout).toContain(catalogIndexPath(root));

    const validated = await run("validate.ts", root);
    expect(validated.exitCode).toBe(0);
    expect(validated.stderr).toBe("");
  });

  test("スキーマ違反は 1 行のエラーと終了コード 1", async () => {
    const root = await tempCatalog();
    await writeInvalidRecipe(root, "button");

    const result = await run("build.ts", root);
    expect(result.exitCode).toBe(1);
    expectSingleLineError(result.stderr, "RECIPE_INVALID");
  });
});

describe("validate", () => {
  test("カタログが存在しなければ探索したパス付きで失敗する", async () => {
    const root = await tempCatalog();
    const missing = join(root, "missing");

    // catalog/ を持たない状態 (recipe 追加前) でもスタックトレースにならないこと。
    const result = await run("validate.ts", missing);
    expect(result.exitCode).toBe(1);
    expectSingleLineError(result.stderr, "CATALOG_NOT_FOUND");
    expect(result.stderr).toContain(missing);
    expect(result.stderr).toContain("UI_KITCHEN_CATALOG");
  });

  test("インデックス未生成なら build を促して失敗する", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button");

    const result = await run("validate.ts", root);
    expect(result.exitCode).toBe(1);
    expectSingleLineError(result.stderr, "CATALOG_INDEX_MISSING");
    expect(result.stderr).toContain("catalog:build");
  });

  test("インデックスが recipe と一致しなければ失敗する", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button");
    await run("build.ts", root);
    await appendFile(catalogIndexPath(root), "\n", "utf8");

    const result = await run("validate.ts", root);
    expect(result.exitCode).toBe(1);
    expectSingleLineError(result.stderr, "CATALOG_INDEX_STALE");
  });

  test("スキーマ違反は 1 行のエラーと終了コード 1", async () => {
    const root = await tempCatalog();
    await writeInvalidRecipe(root, "button");

    const result = await run("validate.ts", root);
    expect(result.exitCode).toBe(1);
    expectSingleLineError(result.stderr, "RECIPE_INVALID");
  });
});
