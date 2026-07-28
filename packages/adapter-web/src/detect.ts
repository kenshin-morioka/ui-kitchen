import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "@ui-kitchen/core";
import { readInstalledDependencies } from "./dependencies.ts";

export interface DetectedProject {
  config: ProjectConfig;
  /** 推測に使った根拠。init 時に表示して人間が確認できるようにする。 */
  notes: string[];
}

/**
 * プロジェクトを覗いて ui-kitchen.json の初期値を推測する。
 * 推測が外れても後から手で直せる前提で、確度の低い項目は notes に理由を残す。
 */
export async function detectWebProject(projectRoot: string): Promise<DetectedProject> {
  const notes: string[] = [];
  const installed = await readInstalledDependencies(projectRoot);

  const hasSrc = await exists(join(projectRoot, "src"));
  const base = hasSrc ? "src" : ".";
  notes.push(
    hasSrc ? "src/ を検出したので出力先を src/ 配下にした" : "src/ が無いのでルート直下を出力先にした",
  );

  // 現状カタログは react + tailwind 前提しか持たないので、検出できなくても
  // その値を仮置きし、根拠が無いことだけを notes で伝える。
  if (!("react" in installed)) {
    notes.push("package.json に react が無い。framework=react を仮置きしたので、違う場合は書き換える");
  }
  if (!("tailwindcss" in installed)) {
    notes.push("package.json に tailwindcss が無い。styling=tailwind を仮置きした");
  }

  const hasShadcn = await exists(join(projectRoot, "components.json"));
  if (!hasShadcn) {
    notes.push("components.json が無い。ui=shadcn を仮置きした (shadcn/ui 前提の recipe が多いため)");
  }

  const importAlias = (await detectImportAlias(projectRoot)) ?? "@/";
  notes.push(`importAlias=${importAlias}`);

  return {
    config: {
      platform: "web",
      stack: { framework: "react", language: "typescript", styling: "tailwind", ui: "shadcn" },
      paths: {
        componentsDir: joinRelative(base, "components"),
        hooksDir: joinRelative(base, "hooks"),
        libDir: joinRelative(base, "lib"),
        stylesDir: joinRelative(base, "styles"),
      },
      importAlias,
    },
    notes,
  };
}

/** tsconfig.json の paths から `@/*` 形式のエイリアスを拾う。 */
async function detectImportAlias(projectRoot: string): Promise<string | undefined> {
  for (const filename of ["tsconfig.json", "jsconfig.json"]) {
    let raw: string;
    try {
      raw = await readFile(join(projectRoot, filename), "utf8");
    } catch {
      continue;
    }
    // tsconfig はコメントを含みうるので、素の JSON.parse で失敗しても諦めて次に進む。
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const paths = (parsed as { compilerOptions?: { paths?: Record<string, unknown> } })?.compilerOptions
      ?.paths;
    if (!paths) continue;
    const wildcard = Object.keys(paths).find((key) => key.endsWith("/*"));
    if (wildcard) return wildcard.slice(0, -1);
  }
  return undefined;
}

function joinRelative(base: string, segment: string): string {
  return base === "." ? segment : `${base}/${segment}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
