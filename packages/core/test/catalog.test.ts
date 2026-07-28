import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { buildCatalogIndex, filterRecipes, loadCatalog } from "../src/catalog.ts";
import { CatalogNotFoundError, RecipeValidationError } from "../src/errors.ts";

/** CI ランナーでも動くよう OS の一時ディレクトリを使う。 */
const SCRATCH = tmpdir();

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  await mkdir(SCRATCH, { recursive: true });
  const dir = await realpath(await mkdtemp(join(SCRATCH, "catalog-")));
  created.push(dir);
  return dir;
}

interface RecipeOptions {
  kindDir?: string;
  files?: { from: string; to: string }[];
  tags?: string[];
  requires?: string[];
  /** 実際に配置するソースファイル。省略時は files の from をそのまま作る。 */
  sources?: Record<string, string>;
}

/** カタログに 1 件 recipe を作り、その recipe ディレクトリを返す。 */
async function writeRecipe(root: string, name: string, options: RecipeOptions = {}): Promise<string> {
  const kindDir = options.kindDir ?? "primitives";
  const kind = kindDir === "primitives" ? "primitive" : kindDir === "lib" ? "lib" : "component";
  const files = options.files ?? [{ from: "files/index.tsx", to: "{{@componentsDir}}/index.tsx" }];
  const dir = join(root, "web", kindDir, name);
  await mkdir(dir, { recursive: true });

  const sources = options.sources ?? Object.fromEntries(files.map((file) => [file.from, "export {};\n"]));
  for (const [path, content] of Object.entries(sources)) {
    const target = join(dir, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  await writeFile(
    join(dir, "recipe.yaml"),
    stringifyYaml({
      id: `web/${kindDir}/${name}`,
      name,
      kind,
      platform: "web",
      description: `${name} の説明`,
      tags: options.tags ?? [],
      stack: { framework: "next", language: "ts", styling: "tailwind" },
      files,
      requires: options.requires ?? [],
      ai: { use_when: "テスト用" },
    }),
    "utf8",
  );

  return dir;
}

describe("loadCatalog", () => {
  test("カタログのディレクトリ自体が無い場合は CatalogNotFoundError", async () => {
    const root = await tempDir();
    await expect(loadCatalog(join(root, "missing"))).rejects.toBeInstanceOf(CatalogNotFoundError);
  });

  test("未知の kind ディレクトリを拒否する", async () => {
    const root = await tempDir();
    await mkdir(join(root, "web", "widgets", "x"), { recursive: true });
    await expect(loadCatalog(root)).rejects.toBeInstanceOf(RecipeValidationError);
  });

  test("recipe.yaml が無い場合と YAML が壊れている場合でメッセージが異なる", async () => {
    const missingRoot = await tempDir();
    await mkdir(join(missingRoot, "web", "primitives", "button"), { recursive: true });
    await expect(loadCatalog(missingRoot)).rejects.toThrow(/recipe\.yaml が無い/);

    const brokenRoot = await tempDir();
    const dir = join(brokenRoot, "web", "primitives", "button");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "recipe.yaml"), "id: [web/primitives/button\n", "utf8");
    await expect(loadCatalog(brokenRoot)).rejects.toThrow(/YAML として壊れている/);
  });

  test("files[].from が存在しない場合は読み込み時に弾く", async () => {
    const root = await tempDir();
    await writeRecipe(root, "button", {
      files: [{ from: "files/cn.ts", to: "{{@libDir}}/cn.ts" }],
      sources: { "files/cn.tsx": "export {};\n" },
    });

    await expect(loadCatalog(root)).rejects.toThrow(/files\[\]\.from が存在しない: files\/cn\.ts/);
  });

  test("files[].from が symlink で recipe ディレクトリの外を指す場合は弾く", async () => {
    const root = await tempDir();
    const outside = join(root, "outside.ts");
    await writeFile(outside, "export const secret = 1;\n", "utf8");

    const dir = await writeRecipe(root, "button", {
      files: [{ from: "files/leak.ts", to: "{{@libDir}}/leak.ts" }],
      sources: {},
    });
    await mkdir(join(dir, "files"), { recursive: true });
    await symlink(outside, join(dir, "files", "leak.ts"));

    await expect(loadCatalog(root)).rejects.toThrow(/recipe ディレクトリの外を指している/);
  });

  test("recipe ディレクトリ内の symlink は許容する", async () => {
    const root = await tempDir();
    const dir = await writeRecipe(root, "button", {
      files: [{ from: "files/index.tsx", to: "{{@componentsDir}}/index.tsx" }],
      sources: { "shared/index.tsx": "export {};\n" },
    });
    await mkdir(join(dir, "files"), { recursive: true });
    await symlink(join(dir, "shared", "index.tsx"), join(dir, "files", "index.tsx"));

    const catalog = await loadCatalog(root);
    expect([...catalog.recipes.keys()]).toEqual(["web/primitives/button"]);
  });

  test("symlink された recipe ディレクトリも一覧に含む", async () => {
    const root = await tempDir();
    const external = await tempDir();
    await writeRecipe(root, "button");
    // 別リポジトリの recipe を symlink して並べるケース。
    const externalRecipe = await writeRecipe(external, "card");
    await symlink(externalRecipe, join(root, "web", "primitives", "card"));

    const catalog = await loadCatalog(root);
    expect([...catalog.recipes.keys()].sort()).toEqual(["web/primitives/button", "web/primitives/card"]);
  });

  test("ID とディレクトリ位置の不一致を検出する", async () => {
    const root = await tempDir();
    const dir = await writeRecipe(root, "button");
    await symlink(dir, join(root, "web", "primitives", "renamed"));

    await expect(loadCatalog(root)).rejects.toThrow(/ディレクトリ位置/);
  });
});

describe("buildCatalogIndex", () => {
  test("ロケールに依存しないコードポイント順で並ぶ", async () => {
    const root = await tempDir();
    // 挿入順 (走査順) と無関係に並ぶことを確認するため、あえて逆順の名前を使う。
    await writeRecipe(root, "zebra", { kindDir: "lib" });
    await writeRecipe(root, "alpha", { kindDir: "primitives", tags: ["form"] });
    await writeRecipe(root, "a-b", { kindDir: "primitives" });

    const ids = buildCatalogIndex(await loadCatalog(root)).recipes.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1)));
    expect(ids).toEqual(["web/lib/zebra", "web/primitives/a-b", "web/primitives/alpha"]);
  });

  test("タイムスタンプ等の揺れる値を含まない", async () => {
    const root = await tempDir();
    await writeRecipe(root, "button", { tags: ["z-tag", "a-tag"] });

    const [entry] = buildCatalogIndex(await loadCatalog(root)).recipes;
    expect(entry).toEqual({
      id: "web/primitives/button",
      name: "button",
      kind: "primitive",
      platform: "web",
      description: "button の説明",
      tags: ["a-tag", "z-tag"],
      requires: [],
      variants: [],
      use_when: "テスト用",
    });
  });
});

describe("filterRecipes", () => {
  test("kind / tag で絞り込み、コードポイント順で返す", async () => {
    const root = await tempDir();
    await writeRecipe(root, "cn", { kindDir: "lib" });
    await writeRecipe(root, "zebra", { kindDir: "primitives", tags: ["form"] });
    await writeRecipe(root, "alpha", { kindDir: "primitives", tags: ["form"] });

    const catalog = await loadCatalog(root);
    expect(filterRecipes(catalog, { kind: "primitive" }).map(({ recipe }) => recipe.id)).toEqual([
      "web/primitives/alpha",
      "web/primitives/zebra",
    ]);
    expect(filterRecipes(catalog, { tag: "form" })).toHaveLength(2);
    expect(filterRecipes(catalog, { tag: "none" })).toHaveLength(0);
    expect(filterRecipes(catalog, { platform: "web" })).toHaveLength(3);
  });
});
