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
  // ファイルシステムから見た既定の基準。エイリアスが別のディレクトリを指していれば
  // 後で上書きする (出力先は必ず importAlias の配下に置く必要がある)。
  const filesystemBase = hasSrc ? "src" : ".";

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

  const detected = await detectImportAlias(projectRoot, filesystemBase);
  notes.push(...detected.notes);
  if (detected.alias === undefined) {
    notes.push(
      `importAlias=${FALLBACK_IMPORT_ALIAS} は検出できず仮置きした。違っていると生成されるファイルの import が解決できないので ui-kitchen.json を直す`,
    );
  }

  // エイリアスが指すディレクトリ。検出できなかった場合はファイルシステム側の基準に
  // 合わせる (src/ 構成なら "@/" は src/ を指すのが慣例)。ここを取り違えると
  // import が "@/src/lib/cn" のように二重になって解決できない。
  const aliasBase = detected.base ?? filesystemBase;
  // 出力先は必ず aliasBase 配下に置く。ここが食い違うと import を組めない
  // (例: "@/*" -> "./app/*" なのにルート直下へ出力すると "@/components" が
  // app/components を指し、実際の出力先と一致しない)。
  const base = aliasBase;

  if (detected.base === undefined) {
    notes.push(
      `importAlias が指すディレクトリを ${aliasBase} と仮置きした。import が解決できない場合はここを疑う`,
    );
  } else if (detected.base !== filesystemBase) {
    notes.push(
      `importAlias が ${aliasBase} を指しているので、出力先も ${aliasBase} 配下にした (ファイルシステム上の既定は ${filesystemBase})`,
    );
  } else {
    notes.push(`importAlias が指すディレクトリは ${aliasBase}`);
  }
  notes.push(base === "." ? "出力先はルート直下にした" : `出力先を ${base}/ 配下にした`);

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
