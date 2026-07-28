import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  CatalogNotFoundError,
  FileSystemError,
  RecipeValidationError,
  UiKitchenError,
} from "@ui-kitchen/core";
import {
  catalogIndexPath,
  catalogRootCandidates,
  checkCatalogIndex,
  renderCatalogIndex,
  repositoryCatalogRoot,
  writeCatalogIndex,
} from "../src/index.ts";
import { cleanupTempCatalogs, tempCatalog, writeInvalidRecipe, writeRecipe } from "./helpers.ts";

const ENV = "UI_KITCHEN_CATALOG";

const original = process.env[ENV];

afterEach(async () => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
  await cleanupTempCatalogs();
});

/** 結果と失敗を同じ土俵で比較するため、例外はメッセージに畳む。 */
function outcome(): string {
  try {
    return repositoryCatalogRoot();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("catalogRootCandidates", () => {
  test("パッケージルート起点で、同梱カタログ → リポジトリのカタログの順に探す", () => {
    delete process.env[ENV];

    // ソースの階層数ではなくパッケージ自身の package.json を起点にしていることを、
    // 候補の形で確認する (固定段数だと配布時に node_modules/catalog を指してしまう)。
    const packageRoot = resolve(import.meta.dir, "..");
    expect(catalogRootCandidates()).toEqual([
      join(packageRoot, "catalog"),
      join(packageRoot, "..", "..", "catalog"),
    ]);
    expect(catalogRootCandidates()[0]).toEndWith(join("packages", "registry", "catalog"));
    // 2 番目はリポジトリルート直下。node_modules 直下のような中途半端な位置にならない。
    expect(catalogRootCandidates()[1]).not.toContain(`${sep}packages${sep}`);
  });

  test("UI_KITCHEN_CATALOG を指定すると候補はそれだけになる", async () => {
    const root = await tempCatalog();
    process.env[ENV] = root;

    expect(catalogRootCandidates()).toEqual([root]);
  });

  test("相対パスの指定は絶対パスに正規化される", () => {
    process.env[ENV] = "tmp-catalog";

    expect(catalogRootCandidates()).toEqual([resolve("tmp-catalog")]);
  });

  test("空文字列は未指定として扱う", () => {
    delete process.env[ENV];
    const unsetCandidates = catalogRootCandidates();
    const unsetOutcome = outcome();

    process.env[ENV] = "";

    // resolve("") はカレントディレクトリを返すので、素通しすると無関係な場所を指す。
    expect(catalogRootCandidates()).toEqual(unsetCandidates);
    expect(outcome()).toBe(unsetOutcome);
  });
});

describe("repositoryCatalogRoot", () => {
  test("存在するディレクトリを返す", async () => {
    const root = await tempCatalog();
    process.env[ENV] = root;

    expect(repositoryCatalogRoot()).toBe(root);
  });

  test("見つからない場合は CatalogNotFoundError で探索したパスを示す", async () => {
    const root = await tempCatalog();
    const missing = join(root, "missing");
    process.env[ENV] = missing;

    // AI がログだけで「UI_KITCHEN_CATALOG の誤指定」と判断できる必要がある。
    expect(() => repositoryCatalogRoot()).toThrow(CatalogNotFoundError);
    expect(outcome()).toContain(missing);
    expect(outcome()).toContain(ENV);
  });

  test("権限エラーを「存在しない」に潰さない", async () => {
    // ENOENT 以外を false に潰すと、権限の問題なのに「どこにも存在しない」と
    // 誤診断され、本当の原因が見えなくなる。
    const root = await tempCatalog();
    const locked = join(root, "locked");
    await mkdir(join(locked, "catalog"), { recursive: true });
    await chmod(locked, 0o000);
    process.env[ENV] = join(locked, "catalog");

    try {
      if (process.getuid?.() === 0) return; // root では権限が効かない
      expect(() => repositoryCatalogRoot()).toThrow(FileSystemError);
    } finally {
      await chmod(locked, 0o700);
    }
  });
});

describe("renderCatalogIndex", () => {
  test("同じカタログなら 2 回呼んでもバイト単位で同一", async () => {
    const root = await tempCatalog();
    // 走査順と並び順が独立していることを見るため、あえて逆順に作る。
    await writeRecipe(root, "zebra");
    await writeRecipe(root, "alpha", ["web/primitives/zebra"]);

    const first = await renderCatalogIndex(root);
    expect(await renderCatalogIndex(root)).toBe(first);

    const ids = (JSON.parse(first) as { recipes: { id: string }[] }).recipes.map((entry) => entry.id);
    expect(ids).toEqual(["web/primitives/alpha", "web/primitives/zebra"]);
    // 揺れる値が混ざっていないこと。日付らしい文字列が出ないのを直接見る。
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("recipe.yaml のスキーマ違反は RecipeValidationError", async () => {
    const root = await tempCatalog();
    await writeInvalidRecipe(root, "button");

    await expect(renderCatalogIndex(root)).rejects.toBeInstanceOf(RecipeValidationError);
    await expect(renderCatalogIndex(root)).rejects.toThrow(/kind/);
  });

  test("存在しない recipe を requires していると RECIPE_NOT_FOUND", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button", ["web/primitives/missing"]);

    // 判定は core の resolveRecipes に任せている。registry では重複実装しない。
    const error = await renderCatalogIndex(root).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UiKitchenError);
    expect((error as UiKitchenError).code).toBe("RECIPE_NOT_FOUND");
  });

  test("カタログが存在しない場合は CatalogNotFoundError", async () => {
    const root = await tempCatalog();

    await expect(renderCatalogIndex(join(root, "missing"))).rejects.toBeInstanceOf(CatalogNotFoundError);
  });
});

describe("checkCatalogIndex", () => {
  test("未生成なら CATALOG_INDEX_MISSING、生成後は一致する", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button");

    const missing = await checkCatalogIndex(root).catch((cause: unknown) => cause);
    expect((missing as UiKitchenError).code).toBe("CATALOG_INDEX_MISSING");

    expect(await writeCatalogIndex(root)).toBe(catalogIndexPath(root));
    expect(await checkCatalogIndex(root)).toBe(catalogIndexPath(root));
  });

  test("recipe を変えてインデックスを再生成していなければ CATALOG_INDEX_STALE", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button");
    await writeCatalogIndex(root);

    await writeRecipe(root, "card");

    const stale = await checkCatalogIndex(root).catch((cause: unknown) => cause);
    expect((stale as UiKitchenError).code).toBe("CATALOG_INDEX_STALE");
  });
});

describe("writeCatalogIndex", () => {
  test("カタログが壊れている場合は既存のインデックスを潰さない", async () => {
    const root = await tempCatalog();
    await writeRecipe(root, "button");
    await writeCatalogIndex(root);
    const before = await readFile(catalogIndexPath(root), "utf8");

    await writeFile(
      join(root, "web", "primitives", "button", "recipe.yaml"),
      "id: [web/primitives/button\n",
      "utf8",
    );

    await expect(writeCatalogIndex(root)).rejects.toBeInstanceOf(RecipeValidationError);
    expect(await readFile(catalogIndexPath(root), "utf8")).toBe(before);
  });
});
