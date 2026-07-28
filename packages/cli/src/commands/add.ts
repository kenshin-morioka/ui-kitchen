import {
  findMissingDependencies,
  installCommandFor,
  readInstalledDependencies,
} from "@ui-kitchen/adapter-web";
import { applyPlan, buildPlan } from "@ui-kitchen/core";
import { openCatalog, openProject, parse, printJson, showHelp } from "../shared.ts";

const HELP = `uikit add — recipe を依存ごとプロジェクトに生成する

使い方: uikit add <recipe-id...> [options]

オプション:
  --variant <name>   variant を有効にする (複数指定可)
  --dry-run          書き込まず生成計画だけを表示する
  --force            既存ファイルと内容が異なる場合も上書きする
  --cwd <path>       対象プロジェクトのディレクトリ (既定: カレント)
  --json             機械可読な形式で出力する

npm 依存は自動 install しない。不足があれば実行するコマンドを提示する。
`;

export async function runAdd(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    variant: { type: "string", multiple: true },
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    cwd: { type: "string" },
    json: { type: "boolean" },
  });
  if (showHelp(values, HELP)) return 0;

  if (positionals.length === 0) {
    console.error("recipe ID を 1 つ以上指定する\n");
    console.error(HELP);
    return 1;
  }

  const [catalog, project] = await Promise.all([openCatalog(), openProject(values)]);
  const plan = await buildPlan({
    catalog,
    config: project.config,
    projectRoot: project.projectRoot,
    recipeIds: positionals,
    variants: Array.isArray(values.variant) ? (values.variant as string[]) : [],
  });

  const installed = await readInstalledDependencies(project.projectRoot);
  const missing = findMissingDependencies(plan.requiredDependencies, installed);
  const installCommand = installCommandFor(missing);
  const dryRun = values["dry-run"] === true;
  const force = values.force === true;

  const result = dryRun ? { written: [], skipped: [] } : await applyPlan(plan, { force });
  const conflicts = plan.files.filter((file) => file.status === "conflict");
  const blocked = !force && conflicts.length > 0;

  if (values.json === true) {
    printJson({
      dryRun,
      recipes: plan.recipes,
      files: plan.files.map(({ recipeId, to, status }) => ({ recipeId, to, status })),
      written: result.written,
      missingDependencies: missing,
      installCommand,
    });
    return blocked && !dryRun ? 1 : 0;
  }

  console.log(`recipe: ${plan.recipes.join(", ")}`);
  if (plan.enabledVariants.length > 0) {
    console.log(`variant: ${plan.enabledVariants.join(", ")}`);
  }
  console.log("");
  for (const file of plan.files) {
    console.log(`  ${LABELS[file.status]}  ${file.to}`);
  }

  if (missing.length > 0) {
    console.log("\n不足している npm 依存 (install は行っていない):");
    for (const dependency of missing) {
      console.log(`  ${dependency.name}@${dependency.range}`);
    }
    console.log(`\n  ${installCommand}`);
  }

  if (dryRun) {
    console.log("\n--dry-run のため書き込んでいない");
    return 0;
  }

  console.log(`\n${result.written.length} ファイルを書き込んだ`);
  if (blocked) {
    console.log(
      `内容の異なる既存ファイルがあるためスキップした (${conflicts
        .map((file) => file.to)
        .join(", ")})。上書きするなら --force を付ける。`,
    );
    return 1;
  }
  return 0;
}

const LABELS = {
  create: "create   ",
  unchanged: "unchanged",
  conflict: "conflict ",
} as const;
