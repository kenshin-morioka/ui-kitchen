import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const created: string[] = [];

/**
 * OS の一時ディレクトリを取る。mkdtemp の結果を realpath に通すのは、macOS の
 * /var が /private/var への symlink で実パスと食い違うため (CLI は出力先を
 * realpath で検証するので、通さないと期待値がローカルでだけ合う)。
 */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `ui-kitchen-cli-${prefix}-`)));
  created.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function write(root: string, relativePath: string, content: string): Promise<string> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

export interface RecipeOptions {
  requires?: string[];
  dependencies?: Record<string, string>;
  /** files[].to のテンプレート。既定は componentsDir 配下。 */
  to?: string;
  /** files[].from の中身。 */
  content?: string;
  variants?: string[];
}

/** カタログに primitive の recipe を 1 件作る。 */
export async function writeRecipe(root: string, name: string, options: RecipeOptions = {}): Promise<string> {
  const dir = join(root, "web", "primitives", name);
  await mkdir(join(dir, "files"), { recursive: true });
  await writeFile(
    join(dir, "files", `${name}.tsx`),
    options.content ?? `export const ${name} = 1;\n`,
    "utf8",
  );

  const lines = [
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
    `    to: "${options.to ?? `{{@componentsDir}}/${name}.tsx`}"`,
    `requires: [${(options.requires ?? []).join(", ")}]`,
    // 空のキー (`dependencies:`) は YAML では null になり、スキーマの既定値が効かない。
    // 中身があるときだけ書く。
    ...renderBlock(
      "dependencies",
      Object.entries(options.dependencies ?? {}).map(([pkg, range]) => `  "${pkg}": "${range}"`),
    ),
    ...renderBlock(
      "variants",
      (options.variants ?? []).flatMap((variant) => [
        `  - name: ${variant}`,
        `    description: ${variant} を足す`,
      ]),
    ),
    "ai:",
    `  use_when: ${name} が必要なとき`,
    "  do_not:",
    "    - 色を直書きしない",
  ];
  await writeFile(join(dir, "recipe.yaml"), `${lines.join("\n")}\n`, "utf8");
  return dir;
}

function renderBlock(key: string, body: string[]): string[] {
  return body.length === 0 ? [] : [`${key}:`, ...body];
}

export const PROJECT_CONFIG = {
  platform: "web",
  stack: { framework: "react", language: "typescript", styling: "tailwind", ui: "shadcn" },
  paths: {
    componentsDir: "src/components/ui",
    hooksDir: "src/hooks",
    libDir: "src/lib",
    stylesDir: "src/styles",
  },
  importAlias: "@/",
} as const;

/** 対象プロジェクト (ui-kitchen.json + package.json) を作る。 */
export async function writeProject(
  root: string,
  options: { dependencies?: Record<string, string>; config?: unknown } = {},
): Promise<void> {
  await write(root, "ui-kitchen.json", `${JSON.stringify(options.config ?? PROJECT_CONFIG, null, 2)}\n`);
  await write(
    root,
    "package.json",
    `${JSON.stringify({ name: "target", private: true, dependencies: options.dependencies ?? {} }, null, 2)}\n`,
  );
}
