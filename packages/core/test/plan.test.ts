import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Catalog, LoadedRecipe } from "../src/catalog.ts";
import { ApplyBlockedError, ConfigError, FileSystemError, UiKitchenError } from "../src/errors.ts";
import { applyPlan, buildPlan, templateVarsFor } from "../src/plan.ts";
import type { ProjectConfig } from "../src/schema.ts";

/** CI ランナーでも動くよう OS の一時ディレクトリを使う。 */
const SCRATCH = tmpdir();

const config: ProjectConfig = {
  platform: "web",
  stack: { framework: "next", language: "ts", styling: "tailwind" },
  paths: {
    componentsDir: "src/components",
    hooksDir: "src/hooks",
    libDir: "src/lib",
    stylesDir: "src/styles",
  },
  importAlias: "@/",
  aliasBase: "src",
};

interface RecipeInput {
  id: string;
  files: { from: string; to: string; source: string }[];
  requires?: string[];
  variants?: string[];
  dependencies?: Record<string, string>;
}

let workspace: string;
let projectRoot: string;

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(join(SCRATCH, "plan-")));
  projectRoot = join(workspace, "project");
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function makeRecipe(input: RecipeInput): Promise<LoadedRecipe> {
  const dir = join(workspace, "catalog", input.id);
  for (const file of input.files) {
    await mkdir(dirname(join(dir, file.from)), { recursive: true });
    await writeFile(join(dir, file.from), file.source, "utf8");
  }

  return {
    dir,
    recipe: {
      id: input.id,
      name: input.id,
      kind: "primitive",
      platform: "web",
      description: input.id,
      tags: [],
      stack: { framework: "next", language: "ts", styling: "tailwind" },
      files: input.files.map(({ from, to }) => ({ from, to })),
      requires: input.requires ?? [],
      dependencies: input.dependencies ?? {},
      variants: (input.variants ?? []).map((name) => ({ name, description: name })),
      ai: { use_when: "test", do_not: [] },
    },
  };
}

function catalogOf(...entries: LoadedRecipe[]): Catalog {
  return {
    root: join(workspace, "catalog"),
    recipes: new Map(entries.map((entry) => [entry.recipe.id, entry])),
  };
}

async function plan(catalog: Catalog, recipeIds: string[], variants?: string[]) {
  return await buildPlan({ catalog, config, projectRoot, recipeIds, variants });
}

const buttonTemplate = [
  "export const Button = () => null;",
  "// {{#if variant.with-loading}}",
  "export const Spinner = () => null;",
  "// {{/if}}",
  "",
].join("\n");

describe("applyPlan の conflict 扱い", () => {
  const recipe = () =>
    makeRecipe({
      id: "web/primitives/button",
      files: [
        { from: "a.ts", to: "{{@libDir}}/a.ts", source: "export const a = 1;\n" },
        { from: "b.ts", to: "{{@libDir}}/b.ts", source: "export const b = 1;\n" },
        { from: "c.ts", to: "{{@libDir}}/c.ts", source: "export const c = 1;\n" },
      ],
    });

  test("conflict が 1 件でもあれば 1 ファイルも書かない", async () => {
    const catalog = catalogOf(await recipe());
    await mkdir(join(projectRoot, "src/lib"), { recursive: true });
    await writeFile(join(projectRoot, "src/lib/b.ts"), "// ユーザーが編集した\n", "utf8");

    const built = await plan(catalog, ["web/primitives/button"]);
    expect(built.files.map((file) => file.status)).toEqual(["create", "conflict", "create"]);

    await expect(applyPlan(built)).rejects.toThrow(ApplyBlockedError);
    expect(existsSync(join(projectRoot, "src/lib/a.ts"))).toBe(false);
    expect(existsSync(join(projectRoot, "src/lib/c.ts"))).toBe(false);
    expect(await readFile(join(projectRoot, "src/lib/b.ts"), "utf8")).toBe("// ユーザーが編集した\n");
  });

  test("force なら conflict を上書きして全件書く", async () => {
    const catalog = catalogOf(await recipe());
    await mkdir(join(projectRoot, "src/lib"), { recursive: true });
    await writeFile(join(projectRoot, "src/lib/b.ts"), "// ユーザーが編集した\n", "utf8");

    const result = await applyPlan(await plan(catalog, ["web/primitives/button"]), { force: true });
    expect(result.written).toHaveLength(3);
    expect(await readFile(join(projectRoot, "src/lib/b.ts"), "utf8")).toBe("export const b = 1;\n");
  });

  test("すべて unchanged なら書き込まない (冪等)", async () => {
    const catalog = catalogOf(await recipe());
    await applyPlan(await plan(catalog, ["web/primitives/button"]));

    const second = await applyPlan(await plan(catalog, ["web/primitives/button"]));
    expect(second.written).toEqual([]);
    expect(second.skipped).toHaveLength(3);
  });
});

describe("プロジェクト外への書き込み", () => {
  test("symlink 経由でプロジェクト外に出る出力先を弾く", async () => {
    const outside = join(workspace, "outside");
    await mkdir(outside, { recursive: true });
    // proj/src がプロジェクト外への symlink。字句上の relative 比較では検出できない。
    await symlink(outside, join(projectRoot, "src"));

    const catalog = catalogOf(
      await makeRecipe({
        id: "web/lib/cn",
        files: [{ from: "cn.ts", to: "{{@libDir}}/cn.ts", source: "export const cn = 1;\n" }],
      }),
    );

    await expect(applyPlan(await plan(catalog, ["web/lib/cn"]))).rejects.toThrow(FileSystemError);
    expect(existsSync(join(outside, "lib/cn.ts"))).toBe(false);
  });

  test("出力先ファイル自体が外向き symlink でも弾く", async () => {
    const outside = join(workspace, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "cn.ts"), "// 外部ファイル\n", "utf8");
    await mkdir(join(projectRoot, "src/lib"), { recursive: true });
    await symlink(join(outside, "cn.ts"), join(projectRoot, "src/lib/cn.ts"));

    const catalog = catalogOf(
      await makeRecipe({
        id: "web/lib/cn",
        files: [{ from: "cn.ts", to: "{{@libDir}}/cn.ts", source: "export const cn = 1;\n" }],
      }),
    );

    await expect(applyPlan(await plan(catalog, ["web/lib/cn"]), { force: true })).rejects.toThrow(
      FileSystemError,
    );
    expect(await readFile(join(outside, "cn.ts"), "utf8")).toBe("// 外部ファイル\n");
  });
});

describe("出力先の重複検出", () => {
  test("`./` を含む等価な別表記も重複として弾く", async () => {
    const catalog = catalogOf(
      await makeRecipe({
        id: "web/lib/cn",
        files: [{ from: "cn.ts", to: "{{@libDir}}/cn.ts", source: "export const cn = 1;\n" }],
      }),
      await makeRecipe({
        id: "web/lib/other",
        files: [{ from: "cn.ts", to: "{{@libDir}}/./cn.ts", source: "export const cn = 2;\n" }],
      }),
    );

    await expect(plan(catalog, ["web/lib/cn", "web/lib/other"])).rejects.toThrow(
      /同じファイルを出力しようとしている/,
    );
  });

  test("大文字小文字しか違わない出力先も弾く", async () => {
    const catalog = catalogOf(
      await makeRecipe({
        id: "web/primitives/button",
        files: [{ from: "b.tsx", to: "{{@componentsDir}}/Button.tsx", source: "export const a = 1;\n" }],
      }),
      await makeRecipe({
        id: "web/components/button",
        files: [{ from: "b.tsx", to: "{{@componentsDir}}/button.tsx", source: "export const b = 1;\n" }],
      }),
    );

    await expect(plan(catalog, ["web/primitives/button", "web/components/button"])).rejects.toThrow(
      /大文字小文字しか違わない/,
    );
  });
});

describe("既存ファイルの状態判定", () => {
  test("出力先がディレクトリなら FileSystemError にする", async () => {
    await mkdir(join(projectRoot, "src/lib/cn.ts"), { recursive: true });
    const catalog = catalogOf(
      await makeRecipe({
        id: "web/lib/cn",
        files: [{ from: "cn.ts", to: "{{@libDir}}/cn.ts", source: "export const cn = 1;\n" }],
      }),
    );

    const promise = plan(catalog, ["web/lib/cn"]);
    await expect(promise).rejects.toThrow(FileSystemError);
    await expect(promise).rejects.toThrow(/同名のディレクトリが存在する/);
  });

  test("途中の要素がファイルなら FileSystemError にする", async () => {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src/lib"), "// ファイルになっている\n", "utf8");
    const catalog = catalogOf(
      await makeRecipe({
        id: "web/lib/cn",
        files: [{ from: "cn.ts", to: "{{@libDir}}/cn.ts", source: "export const cn = 1;\n" }],
      }),
    );

    await expect(plan(catalog, ["web/lib/cn"])).rejects.toThrow(/途中のディレクトリがファイルになっている/);
  });
});

describe("variant のスコープ", () => {
  const catalogWithDependency = async (formVariants: string[] = []) =>
    catalogOf(
      await makeRecipe({
        id: "web/primitives/button",
        files: [{ from: "button.tsx", to: "{{@componentsDir}}/button.tsx", source: buttonTemplate }],
        variants: ["with-loading"],
      }),
      await makeRecipe({
        id: "web/blocks/form",
        files: [{ from: "form.tsx", to: "{{@componentsDir}}/form.tsx", source: buttonTemplate }],
        requires: ["web/primitives/button"],
        variants: formVariants,
      }),
    );

  test("スコープなしの variant は依存 recipe に適用しない", async () => {
    const catalog = await catalogWithDependency();

    const promise = plan(catalog, ["web/blocks/form"], ["with-loading"]);
    await expect(promise).rejects.toThrow(UiKitchenError);
    await expect(promise).rejects.toThrow(/依存 recipe \(web\/primitives\/button\) だけ/);
  });

  test("スコープ付きなら依存 recipe にだけ適用する", async () => {
    const catalog = await catalogWithDependency(["with-loading"]);

    const built = await plan(catalog, ["web/blocks/form"], ["web/primitives/button:with-loading"]);
    expect(built.enabledVariants).toEqual({ "web/primitives/button": ["with-loading"] });

    const byRecipe = new Map(built.files.map((file) => [file.recipeId, file.content]));
    expect(byRecipe.get("web/primitives/button")).toContain("Spinner");
    expect(byRecipe.get("web/blocks/form")).not.toContain("Spinner");
  });

  test("スコープなしは明示指定した recipe にだけ適用する", async () => {
    const catalog = await catalogWithDependency(["with-loading"]);

    const built = await plan(catalog, ["web/blocks/form"], ["with-loading"]);
    expect(built.enabledVariants).toEqual({ "web/blocks/form": ["with-loading"] });

    const byRecipe = new Map(built.files.map((file) => [file.recipeId, file.content]));
    expect(byRecipe.get("web/blocks/form")).toContain("Spinner");
    expect(byRecipe.get("web/primitives/button")).not.toContain("Spinner");
  });

  test("どの対象にも当たらない variant はエラーにする", async () => {
    const catalog = await catalogWithDependency();

    await expect(plan(catalog, ["web/blocks/form"], ["nope"])).rejects.toThrow(
      /どの recipe も宣言していない variant: nope/,
    );
    await expect(plan(catalog, ["web/blocks/form"], ["web/primitives/button:nope"])).rejects.toThrow(
      /variant nope を宣言していない/,
    );
    await expect(plan(catalog, ["web/blocks/form"], ["web/lib/cn:with-loading"])).rejects.toThrow(
      /今回の対象に含まれていない/,
    );
  });

  test("variant を指定しなければ enabledVariants は空", async () => {
    const catalog = await catalogWithDependency(["with-loading"]);
    expect((await plan(catalog, ["web/blocks/form"])).enabledVariants).toEqual({});
  });
});

describe("requiredDependencies の集約", () => {
  const catalogWith = async (buttonRange: string, formRange: string) =>
    catalogOf(
      await makeRecipe({
        id: "web/primitives/button",
        files: [{ from: "b.tsx", to: "{{@componentsDir}}/button.tsx", source: "export const b = 1;\n" }],
        dependencies: { react: buttonRange },
      }),
      await makeRecipe({
        id: "web/blocks/form",
        files: [{ from: "f.tsx", to: "{{@componentsDir}}/form.tsx", source: "export const f = 1;\n" }],
        requires: ["web/primitives/button"],
        dependencies: { react: formRange, zod: "^4.0.0" },
      }),
    );

  test("range が競合したらエラーにする", async () => {
    const promise = plan(await catalogWith("^18.0.0", "^19.0.0"), ["web/blocks/form"]);
    await expect(promise).rejects.toThrow(UiKitchenError);
    await expect(promise).rejects.toThrow(
      /react.*web\/primitives\/button が \^18\.0\.0.*web\/blocks\/form が \^19\.0\.0/s,
    );
  });

  test("range が同じなら 1 件に集約する", async () => {
    const built = await plan(await catalogWith("^19.0.0", "^19.0.0"), ["web/blocks/form"]);
    expect(built.requiredDependencies).toEqual({ react: "^19.0.0", zod: "^4.0.0" });
  });
});

describe("import 用テンプレート変数", () => {
  test("aliasBase 配下の出力先をエイリアス相対に直す", () => {
    // "@/" + "src/lib" と単純に繋ぐと "@/src/lib" になり解決できない。
    expect(templateVarsFor(config).libImport).toBe("@/lib");
    expect(templateVarsFor(config).componentsImport).toBe("@/components");
    expect(templateVarsFor(config).stylesImport).toBe("@/styles");
  });

  test("エイリアスがプロジェクトルートを指す構成", () => {
    const vars = templateVarsFor({
      ...config,
      aliasBase: ".",
      paths: { ...config.paths, libDir: "lib" },
    });
    expect(vars.libImport).toBe("@/lib");
  });

  test("出力先が aliasBase 自身のときは余分な区切りを付けない", () => {
    const vars = templateVarsFor({ ...config, aliasBase: "src", paths: { ...config.paths, libDir: "src" } });
    // "{{@libImport}}/cn" が "@/cn" になること ("@//cn" にしない)。
    expect(vars.libImport).toBe("@");
  });

  test("エイリアスの末尾が / でなくても区切りは 1 つ", () => {
    expect(templateVarsFor({ ...config, importAlias: "~" }).libImport).toBe("~/lib");
    expect(templateVarsFor({ ...config, importAlias: "@app/" }).libImport).toBe("@app/lib");
  });

  test("区切りが \\ の設定でも import は / で組む", () => {
    const vars = templateVarsFor({
      ...config,
      aliasBase: "src",
      paths: { ...config.paths, libDir: "src\\lib\\util" },
    });
    expect(vars.libImport).toBe("@/lib/util");
  });

  test("aliasBase の外を指す出力先はエラーにする", () => {
    // 黙って "@/../packages/ui" のような壊れた import を生むより早く落とす。
    expect(() =>
      templateVarsFor({ ...config, aliasBase: "src", paths: { ...config.paths, libDir: "packages/ui" } }),
    ).toThrow(ConfigError);
  });

  test("前方一致でも別ディレクトリなら弾く", () => {
    // "src" と "srclib" は文字列としては前方一致するが別のディレクトリ。
    expect(() =>
      templateVarsFor({ ...config, aliasBase: "src", paths: { ...config.paths, libDir: "srclib" } }),
    ).toThrow(ConfigError);
  });
});
