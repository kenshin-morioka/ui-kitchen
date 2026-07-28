import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "@ui-kitchen/core";
import {
  findIncompatibleDependencies,
  findMissingDependencies,
  type InstalledDependencies,
  installCommandFor,
  readInstalledDependencies,
} from "../src/dependencies.ts";

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

/** macOS の /var は /private/var への symlink なので realpath を通す (CI との差を消す)。 */
async function tempDir(): Promise<string> {
  await mkdir(tmpdir(), { recursive: true });
  const dir = await realpath(await mkdtemp(join(tmpdir(), "adapter-web-deps-")));
  created.push(dir);
  return dir;
}

async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function installedOf(partial: Partial<InstalledDependencies>): InstalledDependencies {
  return { resolved: {}, peer: {}, ...partial };
}

describe("readInstalledDependencies", () => {
  test("dependencies と devDependencies だけを resolved に入れ、peer は分けて返す", async () => {
    const dir = await tempDir();
    await writeManifest(dir, {
      dependencies: { react: "^19.0.0" },
      devDependencies: { typescript: "^5.9.0" },
      peerDependencies: { "react-dom": "^19.0.0" },
    });

    const installed = await readInstalledDependencies(dir);
    expect(installed.resolved).toEqual({ react: "^19.0.0", typescript: "^5.9.0" });
    expect(installed.peer).toEqual({ "react-dom": "^19.0.0" });
  });

  test("package.json が無い場合は空", async () => {
    const dir = await tempDir();
    expect(await readInstalledDependencies(dir)).toEqual({ resolved: {}, peer: {} });
  });

  test("壊れた package.json は空へフォールバックせず ConfigError", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "package.json"), "{ oops", "utf8");
    // 空を返すと「全依存が不足」という嘘の結果になる。
    await expect(readInstalledDependencies(dir)).rejects.toBeInstanceOf(ConfigError);
  });

  test("package.json がディレクトリ (EISDIR) でも生の例外は出さない", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "package.json"));
    await expect(readInstalledDependencies(dir)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("findMissingDependencies", () => {
  test("peerDependencies だけの宣言は充足扱いにしない (a)", () => {
    // ライブラリ用プロジェクト: peer に react があるが node_modules には入らない。
    const installed = installedOf({ resolved: { typescript: "^5.9.0" }, peer: { react: "^19" } });

    const missing = findMissingDependencies({ react: "^19.0.0" }, installed);
    expect(missing).toEqual([{ name: "react", range: "^19.0.0", onlyPeerDeclared: true }]);
  });

  test("dependencies にあるものは不足にしない", () => {
    const installed = installedOf({ resolved: { react: "^19.0.0" } });
    expect(findMissingDependencies({ react: "^19.0.0" }, installed)).toEqual([]);
  });

  test("並びはロケール非依存で安定する", () => {
    const missing = findMissingDependencies(
      { zod: "^4", "react-hook-form": "^7", clsx: "^2" },
      installedOf({}),
    );
    expect(missing.map((entry) => entry.name)).toEqual(["clsx", "react-hook-form", "zod"]);
  });
});

describe("findIncompatibleDependencies", () => {
  test("メジャーが明確に食い違う宣言を報告する (b)", () => {
    // 名前の存在だけを見ると充足扱いになり、React 19 の API を使った生成物が
    // ビルド時に初めて壊れる。
    const installed = installedOf({ resolved: { react: "^18.2.0" } });

    expect(findIncompatibleDependencies({ react: "^19.0.0" }, installed)).toEqual([
      { name: "react", required: "^19.0.0", declared: "^18.2.0" },
    ]);
    // 未宣言のものは不足側の担当なので、こちらには出さない。
    expect(findIncompatibleDependencies({ zod: "^4" }, installed)).toEqual([]);
  });

  test("~ / >= / 素のバージョンも比較できる", () => {
    expect(
      findIncompatibleDependencies({ react: "~19.0.0" }, installedOf({ resolved: { react: "18.3.1" } })),
    ).toHaveLength(1);
    // >=18 は 19 を許容するので食い違いとは言えない。
    expect(
      findIncompatibleDependencies({ react: "^19.0.0" }, installedOf({ resolved: { react: ">=18.0.0" } })),
    ).toEqual([]);
    // 逆向き: >=19 要求に対し ^18 宣言は明確に足りない。
    expect(
      findIncompatibleDependencies({ react: ">=19.0.0" }, installedOf({ resolved: { react: "^18.2.0" } })),
    ).toHaveLength(1);
  });

  test("パースできない range は判定不能として黙って通す", () => {
    const cases = [
      "workspace:*",
      "git+https://example.com/react.git",
      "^18 || ^19",
      "*",
      "19.0.0-rc.1",
      ">=18 <20",
    ];
    for (const declared of cases) {
      expect(
        findIncompatibleDependencies({ react: "^19.0.0" }, installedOf({ resolved: { react: declared } })),
      ).toEqual([]);
    }
    // recipe 側が複合 range を書いている場合も同様。
    expect(
      findIncompatibleDependencies({ react: "^18 || ^19" }, installedOf({ resolved: { react: "^18.2.0" } })),
    ).toEqual([]);
  });

  test("メジャーが同じなら誤検知しない", () => {
    expect(
      findIncompatibleDependencies({ react: "^19.2.0" }, installedOf({ resolved: { react: "^19.0.0" } })),
    ).toEqual([]);
  });
});

describe("installCommandFor", () => {
  test("不足が無ければ undefined", () => {
    expect(installCommandFor([])).toBeUndefined();
  });

  test("range をクォートしてシェルのリダイレクトを防ぐ", () => {
    const command = installCommandFor([{ name: "react", range: ">=19.0.0", onlyPeerDeclared: false }]);
    expect(command).toBe('pnpm add "react@>=19.0.0"');
  });
});
