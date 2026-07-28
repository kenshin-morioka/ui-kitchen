import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILENAME, findConfig, loadConfig, writeConfig } from "../src/config.ts";
import { ConfigError, ConfigNotFoundError } from "../src/errors.ts";
import type { ProjectConfig } from "../src/schema.ts";

/** CI ランナーでも動くよう OS の一時ディレクトリを使う。 */
const SCRATCH = tmpdir();

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    // chmod 000 のファイルを残すと削除に失敗するので戻してから消す。
    await chmod(dir, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function tempDir(): Promise<string> {
  await mkdir(SCRATCH, { recursive: true });
  const dir = await realpath(await mkdtemp(join(SCRATCH, "config-")));
  created.push(dir);
  return dir;
}

function configOf(componentsDir: string): ProjectConfig {
  return {
    platform: "web",
    stack: { framework: "next", language: "ts", styling: "tailwind" },
    paths: {
      componentsDir,
      hooksDir: "src/hooks",
      libDir: "src/lib",
      stylesDir: "src/styles",
    },
    importAlias: "@/",
  };
}

async function writeProjectConfig(dir: string, componentsDir: string): Promise<string> {
  const path = join(dir, CONFIG_FILENAME);
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(configOf(componentsDir)), "utf8");
  return path;
}

const isRoot = process.getuid?.() === 0;

describe("loadConfig", () => {
  test("存在しない場合は ConfigNotFoundError", async () => {
    const dir = await tempDir();
    await expect(loadConfig(join(dir, CONFIG_FILENAME))).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  test("同名ディレクトリ (EISDIR) は ConfigNotFoundError にしない", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, CONFIG_FILENAME));

    const error = await loadConfig(join(dir, CONFIG_FILENAME)).catch((cause) => cause);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error).not.toBeInstanceOf(ConfigNotFoundError);
  });

  test("JSON が壊れている場合と内容が不正な場合は ConfigError", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, CONFIG_FILENAME), "{", "utf8");
    await expect(loadConfig(join(dir, CONFIG_FILENAME))).rejects.toThrow(/JSON として壊れている/);

    await writeFile(join(dir, CONFIG_FILENAME), JSON.stringify({ platform: "web" }), "utf8");
    await expect(loadConfig(join(dir, CONFIG_FILENAME))).rejects.toThrow(/内容が不正/);
  });

  test("$schema は無視して読み込む", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, CONFIG_FILENAME),
      JSON.stringify({ $schema: "https://example.com/x.json", ...configOf("src/components") }),
      "utf8",
    );

    const loaded = await loadConfig(join(dir, CONFIG_FILENAME));
    expect(loaded.config.paths.componentsDir).toBe("src/components");
    expect(loaded.projectRoot).toBe(dir);
  });
});

describe("findConfig", () => {
  test("相対パスを渡してもハングせず解決する", async () => {
    const dir = await tempDir();
    await writeProjectConfig(dir, "src/components");
    await mkdir(join(dir, "src", "deep"), { recursive: true });

    const cwd = process.cwd();
    try {
      process.chdir(dir);
      const loaded = await findConfig("src/deep");
      expect(loaded.path).toBe(join(dir, CONFIG_FILENAME));
    } finally {
      process.chdir(cwd);
    }
  }, 5000);

  test("見つからない場合はルートまで探索して ConfigError", async () => {
    const dir = await tempDir();
    await expect(findConfig(join(dir, "a", "b"))).rejects.toBeInstanceOf(ConfigError);
  }, 5000);

  test.skipIf(isRoot)("読めない設定ファイルを飛び越えて祖先の設定を採用しない", async () => {
    const parent = await tempDir();
    await writeProjectConfig(parent, "parent/components");
    const project = join(parent, "proj");
    const projectConfig = await writeProjectConfig(project, "proj/components");
    await chmod(projectConfig, 0o000);

    const error = await findConfig(project).catch((cause) => cause);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error).not.toBeInstanceOf(ConfigNotFoundError);
    expect((error as ConfigError).message).toContain(projectConfig);

    await chmod(projectConfig, 0o644);
  });

  test("同名ディレクトリでも祖先を採用しない", async () => {
    const parent = await tempDir();
    await writeProjectConfig(parent, "parent/components");
    const project = join(parent, "proj");
    await mkdir(join(project, CONFIG_FILENAME), { recursive: true });

    await expect(findConfig(project)).rejects.toBeInstanceOf(ConfigError);
  });

  test("設定が無いディレクトリからは祖先の設定を見つける", async () => {
    const parent = await tempDir();
    await writeProjectConfig(parent, "parent/components");
    const nested = join(parent, "apps", "web");
    await mkdir(nested, { recursive: true });

    const loaded = await findConfig(nested);
    expect(loaded.projectRoot).toBe(parent);
  });
});

describe("writeConfig", () => {
  test("$schema 付きで書き出し、そのまま読み戻せる", async () => {
    const dir = await tempDir();
    const path = join(dir, CONFIG_FILENAME);
    await writeConfig(path, configOf("src/components"));

    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.$schema).toBe("https://kenshin-morioka.github.io/ui-kitchen/config.schema.json");
    expect((await loadConfig(path)).config).toEqual(configOf("src/components"));
  });

  test("書き込み先ディレクトリが無い場合は ConfigError", async () => {
    const dir = await tempDir();
    const missing = join(dir, "does-not-exist");

    await expect(
      writeConfig(join(missing, CONFIG_FILENAME), configOf("src/components")),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
