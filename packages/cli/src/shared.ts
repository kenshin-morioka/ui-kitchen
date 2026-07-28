import { resolve } from "node:path";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { type Catalog, findConfig, type LoadedConfig, loadCatalog, UiKitchenError } from "@ui-kitchen/core";
import { repositoryCatalogRoot } from "@ui-kitchen/registry";

/**
 * parseArgs の薄いラッパ。未知のオプションを黙って無視せずエラーにする
 * (AI が誤ったフラグを使ったときに気付けるようにするため)。
 */
export function parse<T extends ParseArgsConfig["options"]>(
  argv: string[],
  options: T,
): { values: Record<string, unknown>; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { ...options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Record<string, unknown>, positionals };
  } catch (cause) {
    throw new UiKitchenError("ARGS_INVALID", cause instanceof Error ? cause.message : String(cause));
  }
}

export function openCatalog(): Promise<Catalog> {
  return loadCatalog(repositoryCatalogRoot());
}

export function projectDirFrom(values: Record<string, unknown>): string {
  const cwd = values.cwd;
  return typeof cwd === "string" ? resolve(cwd) : process.cwd();
}

export function openProject(values: Record<string, unknown>): Promise<LoadedConfig> {
  return findConfig(projectDirFrom(values));
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function showHelp(values: Record<string, unknown>, text: string): boolean {
  if (values.help !== true) return false;
  console.log(text);
  return true;
}
