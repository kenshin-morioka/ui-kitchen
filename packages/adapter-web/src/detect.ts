import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "@ui-kitchen/core";
import { readInstalledDependencies } from "./dependencies.ts";
import { detectImportAlias } from "./tsconfig.ts";

/** 検出できなかったときに使う import エイリアス。shadcn/ui の既定に合わせている。 */
export const FALLBACK_IMPORT_ALIAS = "@/";

export interface DetectedProject {
  config: ProjectConfig;
  /**
   * 推測に使った根拠。init 時に表示して人間 / AI が確認できるようにする。
   * 「検出した」と「仮置きした」を必ず書き分ける。AI はここを読んで
   * 生成後の import を直すか判断するので、区別できないと意味がない。
   */
  notes: string[];
}

/**
 * プロジェクトを覗いて ui-kitchen.json の初期値を推測する。
 * 推測が外れても後から手で直せる前提で、確度の低い項目は notes に理由を残す。
 */
export async function detectWebProject(projectRoot: string): Promise<DetectedProject> {
  const notes: string[] = [];
  const installed = await readInstalledDependencies(projectRoot);
  // スタックの判定材料としては peerDependencies も有効 (実行時には利用側が入れる)。
  // 依存の充足判定と違い、ここで見たいのは「何のプロジェクトか」だけ。
  const declared = { ...installed.peer, ...installed.resolved };

  const hasSrc = await exists(join(projectRoot, "src"));
  const base = hasSrc ? "src" : ".";
  notes.push(
    hasSrc ? "src/ を検出したので出力先を src/ 配下にした" : "src/ が無いのでルート直下を出力先にした",
  );

  // 現状カタログは react + tailwind 前提しか持たないので、検出できなくても
  // その値を仮置きし、根拠が無いことだけを notes で伝える。
  if (!("react" in declared)) {
    notes.push("package.json に react が無い。framework=react を仮置きしたので、違う場合は書き換える");
  }
  if (!("tailwindcss" in declared)) {
    notes.push("package.json に tailwindcss が無い。styling=tailwind を仮置きした");
  }
  if (!(await exists(join(projectRoot, "components.json")))) {
    notes.push("components.json が無い。ui=shadcn を仮置きした (shadcn/ui 前提の recipe が多いため)");
  }

  const detected = await detectImportAlias(projectRoot, base);
  notes.push(...detected.notes);
  if (detected.alias === undefined) {
    notes.push(
      `importAlias=${FALLBACK_IMPORT_ALIAS} は検出できず仮置きした。違っていると生成されるファイルの import が解決できないので ui-kitchen.json を直す`,
    );
  }
  // エイリアスが指すディレクトリ。検出できなかった場合は出力先の基準に合わせる
  // (src/ 構成なら "@/" は src/ を指すのが慣例)。ここを取り違えると import が
  // "@/src/lib/cn" のように二重になって解決できない。
  const aliasBase = detected.base ?? base;
  notes.push(
    detected.base !== undefined
      ? `importAlias が指すディレクトリは ${aliasBase}`
      : `importAlias が指すディレクトリを ${aliasBase} と仮置きした。import が解決できない場合はここを疑う`,
  );

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
      importAlias: detected.alias ?? FALLBACK_IMPORT_ALIAS,
      aliasBase,
    },
    notes,
  };
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
