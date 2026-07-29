import {
  findIncompatibleDependencies,
  findMissingDependencies,
  type IncompatibleDependency,
  installCommandFor,
  type MissingDependency,
  readInstalledDependencies,
} from "@ui-kitchen/adapter-web";
import { applyPlan, buildPlan, loadCatalog, type Plan } from "@ui-kitchen/core";
import { repositoryCatalogRoot } from "@ui-kitchen/registry";
import { loadProjectConfig, type ProjectTarget } from "./project.ts";
import type { CommandResult } from "./result.ts";

export interface AddOptions {
  target: ProjectTarget;
  recipeIds: string[];
  variants: string[];
  dryRun: boolean;
  force: boolean;
}

interface DependencyReport {
  required: Record<string, string>;
  missing: MissingDependency[];
  incompatible: IncompatibleDependency[];
  installCommand?: string;
}

export async function runAdd(options: AddOptions): Promise<CommandResult> {
  const { config, path: configPath, projectRoot } = await loadProjectConfig(options.target);
  const catalog = await loadCatalog(repositoryCatalogRoot());

  const plan = await buildPlan({
    catalog,
    config,
    projectRoot,
    recipeIds: options.recipeIds,
    variants: options.variants,
  });
  const dependencies = await inspectDependencies(plan, projectRoot);
  const conflicts = plan.files.filter((file) => file.status === "conflict").map((file) => file.to);

  const head = [
    `プロジェクト: ${projectRoot}`,
    `設定: ${configPath}`,
    `解決した recipe (依存が先): ${plan.recipes.join(" -> ")}`,
    ...renderVariants(plan),
  ];
  const files = plan.files.map((file) => ({ recipeId: file.recipeId, to: file.to, status: file.status }));
  const base = {
    projectRoot,
    configPath,
    requested: plan.requested,
    recipes: plan.recipes,
    enabledVariants: plan.enabledVariants,
    files,
    conflicts,
    dependencies,
  };

  if (options.dryRun) {
    // conflict があるのに終了コード 0 だと、dry-run を挟む運用で「適用できる」と
    // 誤判断される。JSON にも blocked を明示して両方の判定手段を揃える。
    const blocked = conflicts.length > 0 && !options.force;
    const lines = [
      ...head,
      "",
      "生成計画 (--dry-run なので書き込んでいない):",
      ...files.map((file) => `  ${file.status.padEnd(9)} ${file.to}`),
      ...renderDependencies(dependencies),
      "",
      ...renderConflictNote(conflicts, options.force),
    ];
    return { lines, data: { ...base, mode: "dry-run", blocked }, blocked };
  }

  const applied = await applyPlan(plan, { force: options.force });
  const lines = [
    ...head,
    "",
    applied.written.length > 0 ? "書き込んだ:" : "書き込むファイルは無かった。",
    ...applied.written.map((path) => `  ${path}`),
  ];
  if (applied.skipped.length > 0) {
    lines.push("既存と同一なので触っていない:", ...applied.skipped.map((file) => `  ${file.to}`));
  }
  if (conflicts.length > 0 && options.force) {
    lines.push("--force により上書きした:", ...conflicts.map((path) => `  ${path}`));
  }
  lines.push(...renderDependencies(dependencies));

  return {
    lines,
    data: {
      ...base,
      mode: "apply",
      written: applied.written,
      unchanged: applied.skipped.map((file) => file.to),
      overwritten: options.force ? conflicts : [],
    },
  };
}

/**
 * npm 依存の充足を見る。install はしない (ロックファイルを勝手に触らせない)。
 * platform ごとに依存の宣言場所が違うので、web 以外を足すときは adapter を切り替える。
 */
async function inspectDependencies(plan: Plan, projectRoot: string): Promise<DependencyReport> {
  const installed = await readInstalledDependencies(projectRoot);
  const missing = findMissingDependencies(plan.requiredDependencies, installed);
  return {
    required: plan.requiredDependencies,
    missing,
    // 未宣言と範囲不一致は対処が違う (install / バージョン更新) ので分けて出す。
    incompatible: findIncompatibleDependencies(plan.requiredDependencies, installed),
    installCommand: installCommandFor(missing),
  };
}

function renderVariants(plan: Plan): string[] {
  const entries = Object.entries(plan.enabledVariants);
  if (entries.length === 0) return [];
  // variant は recipe スコープなので、どの recipe に効いたのかまで出す。
  return [
    "有効な variant:",
    ...entries.map(([recipeId, variants]) => `  ${recipeId}: ${variants.join(", ")}`),
  ];
}

function renderDependencies(report: DependencyReport): string[] {
  const lines: string[] = [];

  if (report.missing.length > 0) {
    lines.push("", "宣言されていない npm 依存 (自動 install はしない):");
    for (const dependency of report.missing) {
      const reason = dependency.onlyPeerDeclared
        ? " (peerDependencies にだけ宣言されている。node_modules には入らない)"
        : "";
      lines.push(`  ${dependency.name} ${dependency.range}${reason}`);
    }
    if (report.installCommand !== undefined) lines.push(`  → ${report.installCommand}`);
  }

  if (report.incompatible.length > 0) {
    lines.push("", "recipe の要求と食い違う npm 依存 (バージョンを上げる):");
    for (const dependency of report.incompatible) {
      lines.push(
        `  ${dependency.name}: recipe は ${dependency.required}、package.json は ${dependency.declared}`,
      );
    }
  }

  return lines;
}

function renderConflictNote(conflicts: string[], force: boolean): string[] {
  if (conflicts.length === 0) return ["このまま適用できる。"];
  if (force) return [`内容の異なる既存ファイルが ${conflicts.length} 件あるが、--force なので上書きする。`];
  return [
    `内容の異なる既存ファイルが ${conflicts.length} 件あるため適用できない (何も書き込まれない):`,
    ...conflicts.map((path) => `  ${path}`),
    "上書きするなら --force を付ける。",
  ];
}
