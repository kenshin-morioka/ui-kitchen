import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectWebProject, FALLBACK_IMPORT_ALIAS } from "../src/detect.ts";
import { detectImportAlias } from "../src/tsconfig.ts";

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

/** macOS の /var は /private/var への symlink なので realpath を通す (CI との差を消す)。 */
async function tempDir(): Promise<string> {
  await mkdir(tmpdir(), { recursive: true });
  const dir = await realpath(await mkdtemp(join(tmpdir(), "adapter-web-detect-")));
  created.push(dir);
  return dir;
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/** Vite が実際に生成する tsconfig.app.json に近い形 (コメント + 末尾カンマ)。 */
const VITE_TSCONFIG_APP = `{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "moduleResolution": "bundler",

    /* Bundler mode */
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",

    // Linting
    "strict": true,
    "noUnusedLocals": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
    },
  },
  "include": ["src"],
}`;

const VITE_TSCONFIG_ROOT = `{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
  ],
}`;

function notesText(notes: string[]): string {
  return notes.join("\n");
}

describe("detectWebProject", () => {
  test("コメント + 末尾カンマ入りの tsconfig からエイリアスを検出する (c)", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"));
    await write(
      root,
      "tsconfig.json",
      `{
  // Vite の生成物は既定でコメント入り
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"],
    },
  },
}`,
    );

    const detected = await detectWebProject(root);
    expect(detected.config.importAlias).toBe("~/");
    // エイリアスの指す先も一緒に取る。これが無いと import のパスを組めない。
    expect(detected.config.aliasBase).toBe("src");
    expect(notesText(detected.notes)).toContain("検出した");
  });

  test("references 経由で tsconfig.app.json の paths を辿る (e)", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"));
    await write(root, "tsconfig.json", VITE_TSCONFIG_ROOT);
    await write(root, "tsconfig.app.json", VITE_TSCONFIG_APP);

    const detected = await detectWebProject(root);
    expect(detected.config.importAlias).toBe("@/");
    expect(notesText(detected.notes)).toContain("tsconfig.app.json");
  });

  test("extends 経由でも 1 段だけ辿る (e)", async () => {
    const root = await tempDir();
    await write(
      root,
      "tsconfig.json",
      `{ "extends": "./tsconfig.base", "compilerOptions": { "strict": true } }`,
    );
    // 拡張子省略された extends も解決する。
    await write(root, "tsconfig.base.json", `{ "compilerOptions": { "paths": { "#/*": ["./*"] } } }`);

    const detected = await detectWebProject(root);
    expect(detected.config.importAlias).toBe("#/");
  });

  test("部分エイリアスしか無い場合は採用せず、仮置きしたことを notes に書く (d, f)", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"));
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          paths: { "@components/*": ["./src/components/*"], "@lib/*": ["./src/lib/*"] },
        },
      }),
    );

    const detected = await detectWebProject(root);
    // @components/ を採用すると import が @components/components/ui/button になる。
    expect(detected.config.importAlias).toBe(FALLBACK_IMPORT_ALIAS);
    const notes = notesText(detected.notes);
    expect(notes).toContain("1:1 対応するエントリが無い");
    expect(notes).toContain("仮置き");
    expect(notes).not.toContain("paths から検出した");
  });

  test("部分エイリアスと併記されていてもルート対応のエントリを選ぶ (d)", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"));
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          paths: { "@components/*": ["./src/components/*"], "@/*": ["./src/*"] },
        },
      }),
    );

    expect((await detectWebProject(root)).config.importAlias).toBe("@/");
  });

  test("tsconfig が無い場合は仮置きと理由を notes に書く (f)", async () => {
    const root = await tempDir();
    const detected = await detectWebProject(root);

    expect(detected.config.importAlias).toBe(FALLBACK_IMPORT_ALIAS);
    const notes = notesText(detected.notes);
    expect(notes).toContain("tsconfig.json / jsconfig.json が見つからなかった");
    expect(notes).toContain("仮置き");
  });

  test("JSONC でも解釈できない tsconfig は理由を notes に残す (f)", async () => {
    const root = await tempDir();
    await write(root, "tsconfig.json", "{ compilerOptions: ");

    const detected = await detectWebProject(root);
    expect(detected.config.importAlias).toBe(FALLBACK_IMPORT_ALIAS);
    expect(notesText(detected.notes)).toContain("解釈できなかった");
  });

  test("peerDependencies だけの react / tailwindcss はスタック判定の材料にする", async () => {
    const root = await tempDir();
    await write(
      root,
      "package.json",
      JSON.stringify({ peerDependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } }),
    );

    const notes = notesText((await detectWebProject(root)).notes);
    expect(notes).not.toContain("react が無い");
    expect(notes).not.toContain("tailwindcss が無い");
  });

  test("src/ の有無で出力先が変わる", async () => {
    const withoutSrc = await tempDir();
    expect((await detectWebProject(withoutSrc)).config.paths.componentsDir).toBe("components");

    const withSrc = await tempDir();
    await mkdir(join(withSrc, "src"));
    expect((await detectWebProject(withSrc)).config.paths.componentsDir).toBe("src/components");
  });
});

describe("detectImportAlias", () => {
  test("自分自身を extends しても無限に辿らない", async () => {
    const root = await tempDir();
    await write(root, "tsconfig.json", `{ "extends": "./tsconfig.json" }`);

    expect((await detectImportAlias(root, "src")).alias).toBeUndefined();
  }, 5000);

  test("2 段先の paths は辿らない", async () => {
    const root = await tempDir();
    await write(root, "tsconfig.json", `{ "extends": "./a.json" }`);
    await write(root, "a.json", `{ "extends": "./b.json" }`);
    await write(root, "b.json", `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`);

    expect((await detectImportAlias(root, "src")).alias).toBeUndefined();
  }, 5000);

  test("出力先の基準に合う候補を優先する", async () => {
    const root = await tempDir();
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"], "@/*": ["./src/*"] } } }),
    );

    expect((await detectImportAlias(root, "src")).alias).toBe("@/");
    expect((await detectImportAlias(root, ".")).alias).toBe("~/");
  });

  test("対応先が複数あるエントリは採用しない", async () => {
    const root = await tempDir();
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*", "./generated/*"] } } }),
    );

    expect((await detectImportAlias(root, "src")).alias).toBeUndefined();
  });

  test("tsconfig が無ければ jsconfig を見る", async () => {
    const root = await tempDir();
    await write(
      root,
      "jsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );

    expect((await detectImportAlias(root, "src")).alias).toBe("@/");
  });
});

describe("aliasBase の検出", () => {
  test("エイリアスがルートを指す構成では aliasBase も '.'", async () => {
    const root = await tempDir();
    await write(root, "tsconfig.json", '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }');

    const detected = await detectWebProject(root);
    expect(detected.config.importAlias).toBe("@/");
    expect(detected.config.aliasBase).toBe(".");
    // src/ が無いので出力先もルート直下になり、import は "@/lib" で解決する。
    expect(detected.config.paths.libDir).toBe("lib");
  });

  test("検出できない場合は出力先の基準に合わせて仮置きし、その旨を残す", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"));

    const detected = await detectWebProject(root);
    expect(detected.config.importAlias).toBe(FALLBACK_IMPORT_ALIAS);
    // src/ 構成なら "@/" は src/ を指すのが慣例。ここを "." にすると
    // import が "@/src/lib/cn" になって解決できない。
    expect(detected.config.aliasBase).toBe("src");
    expect(notesText(detected.notes)).toContain("仮置き");
  });
});
