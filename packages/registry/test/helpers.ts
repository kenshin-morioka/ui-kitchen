import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/**
 * OS の一時ディレクトリに空のカタログを作る。
 * mkdtemp の結果を realpath に通すのは、macOS の /var が /private/var への symlink で
 * 実パスと食い違うため (ローカル固有の絶対パスを期待値に焼き込むと CI で落ちる)。
 */
export async function tempCatalog(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ui-kitchen-registry-")));
  created.push(dir);
  return dir;
}

export async function cleanupTempCatalogs(): Promise<void> {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

/** カタログに primitive の recipe を 1 件作る。 */
export async function writeRecipe(root: string, name: string, requires: string[] = []): Promise<string> {
  const dir = join(root, "web", "primitives", name);
  await mkdir(join(dir, "files"), { recursive: true });
  await writeFile(join(dir, "files", `${name}.tsx`), "export {};\n", "utf8");
  await writeFile(join(dir, "recipe.yaml"), recipeYaml(name, requires), "utf8");
  return dir;
}

/** kind がスキーマの列挙に無い recipe。スキーマ違反時のエラー形を見るために使う。 */
export async function writeInvalidRecipe(root: string, name: string): Promise<void> {
  const dir = await writeRecipe(root, name);
  await writeFile(
    join(dir, "recipe.yaml"),
    recipeYaml(name, []).replace("kind: primitive", "kind: widget"),
    "utf8",
  );
}

function recipeYaml(name: string, requires: string[]): string {
  return `${[
    `id: web/primitives/${name}`,
    `name: ${name}`,
    "kind: primitive",
    "platform: web",
    `description: ${name} の説明`,
    "tags: [form]",
    "stack:",
    "  framework: react",
    "  language: typescript",
    "  styling: tailwind",
    "files:",
    `  - from: files/${name}.tsx`,
    // テンプレート変数は @ 付き。@ 無しは JSX の二重波括弧と衝突する。
    `    to: "{{@componentsDir}}/${name}.tsx"`,
    `requires: [${requires.join(", ")}]`,
    "ai:",
    `  use_when: ${name} が必要なとき`,
  ].join("\n")}\n`;
}
