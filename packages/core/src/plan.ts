import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import type { Catalog, LoadedRecipe } from "./catalog.ts";
import { ConfigError, StackMismatchError, UiKitchenError } from "./errors.ts";
import { resolveRecipes } from "./resolve.ts";
import type { ProjectConfig, Recipe } from "./schema.ts";
import { expandTemplate, type TemplateVars } from "./template.ts";

export type PlanFileStatus = "create" | "unchanged" | "conflict";

export interface PlanFile {
  recipeId: string;
  /** recipe ディレクトリからの相対パス。 */
  from: string;
  /** プロジェクトルートからの相対パス。 */
  to: string;
  absolutePath: string;
  content: string;
  status: PlanFileStatus;
}

export interface Plan {
  projectRoot: string;
  /** 依存解決後の recipe ID (依存が先)。 */
  recipes: string[];
  /** 明示的に指定された recipe ID。 */
  requested: string[];
  files: PlanFile[];
  /** 全 recipe から集約した npm 依存。install は行わない。 */
  requiredDependencies: Record<string, string>;
  enabledVariants: string[];
}

export interface BuildPlanOptions {
  catalog: Catalog;
  config: ProjectConfig;
  projectRoot: string;
  recipeIds: string[];
  variants?: string[];
}

export async function buildPlan(options: BuildPlanOptions): Promise<Plan> {
  const { catalog, config, recipeIds } = options;
  const projectRoot = resolvePath(options.projectRoot);
  const resolved = resolveRecipes(recipeIds, catalog);
  const requestedVariants = options.variants ?? [];

  assertVariantsExist(requestedVariants, resolved);

  const vars = templateVarsFor(config);
  const files: PlanFile[] = [];
  const requiredDependencies: Record<string, string> = {};

  for (const { recipe, dir } of resolved) {
    assertStackCompatible(recipe, config);

    const declaredVariants = recipe.variants.map((variant) => variant.name);
    const enabledVariants = requestedVariants.filter((variant) => declaredVariants.includes(variant));

    for (const file of recipe.files) {
      const source = await readFile(join(dir, file.from), "utf8");
      const content = expandTemplate(source, {
        vars,
        enabledVariants,
        declaredVariants,
        source: `${recipe.id}:${file.from}`,
      });

      const to = normalizeTarget(file.to, vars, recipe.id);
      const absolutePath = join(projectRoot, to);
      assertInsideProject(absolutePath, projectRoot, recipe.id);

      files.push({
        recipeId: recipe.id,
        from: file.from,
        to,
        absolutePath,
        content,
        status: await statusFor(absolutePath, content),
      });
    }

    for (const [name, range] of Object.entries(recipe.dependencies)) {
      requiredDependencies[name] ??= range;
    }
  }

  assertNoDuplicateTargets(files);

  return {
    projectRoot,
    recipes: resolved.map(({ recipe }) => recipe.id),
    requested: recipeIds,
    files,
    requiredDependencies,
    enabledVariants: requestedVariants,
  };
}

export interface ApplyOptions {
  /** conflict (内容が異なる既存ファイル) を上書きする。 */
  force?: boolean;
}

export interface ApplyResult {
  written: string[];
  skipped: PlanFile[];
}

/** plan をファイルシステムに反映する。plan が同じなら結果は常に同じ (冪等)。 */
export async function applyPlan(plan: Plan, options: ApplyOptions = {}): Promise<ApplyResult> {
  const written: string[] = [];
  const skipped: PlanFile[] = [];

  for (const file of plan.files) {
    if (file.status === "unchanged") {
      skipped.push(file);
      continue;
    }
    if (file.status === "conflict" && !options.force) {
      skipped.push(file);
      continue;
    }
    await mkdir(dirname(file.absolutePath), { recursive: true });
    await writeFile(file.absolutePath, file.content, "utf8");
    written.push(file.to);
  }

  return { written, skipped };
}

export function templateVarsFor(config: ProjectConfig): TemplateVars {
  return {
    componentsDir: stripTrailingSlash(config.paths.componentsDir),
    hooksDir: stripTrailingSlash(config.paths.hooksDir),
    libDir: stripTrailingSlash(config.paths.libDir),
    stylesDir: stripTrailingSlash(config.paths.stylesDir),
    importAlias: config.importAlias,
  };
}

export function assertStackCompatible(recipe: Recipe, config: ProjectConfig): void {
  if (recipe.platform !== config.platform) {
    throw new StackMismatchError(recipe.id, "platform", recipe.platform, config.platform);
  }
  for (const field of ["framework", "language", "styling"] as const) {
    if (recipe.stack[field] !== config.stack[field]) {
      throw new StackMismatchError(recipe.id, field, recipe.stack[field], config.stack[field]);
    }
  }
  // recipe 側が ui 基盤を要求している場合のみ突き合わせる。
  if (recipe.stack.ui && recipe.stack.ui !== config.stack.ui) {
    throw new StackMismatchError(recipe.id, "ui", recipe.stack.ui, config.stack.ui ?? "(未設定)");
  }
}

function assertVariantsExist(variants: string[], resolved: LoadedRecipe[]): void {
  const declared = new Set(resolved.flatMap(({ recipe }) => recipe.variants.map((variant) => variant.name)));
  for (const variant of variants) {
    if (!declared.has(variant)) {
      throw new UiKitchenError(
        "VARIANT_NOT_FOUND",
        `どの recipe も宣言していない variant: ${variant}${
          declared.size > 0 ? `\n使用できる variant: ${[...declared].sort().join(", ")}` : ""
        }`,
      );
    }
  }
}

/** 出力先を組み立てるとき `src/components//ui` のような二重区切りを作らないため。 */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeTarget(target: string, vars: TemplateVars, recipeId: string): string {
  const expanded = expandTemplate(target, { vars, source: `${recipeId}:to` });
  const cleaned = expanded.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
  if (isAbsolute(cleaned)) {
    throw new ConfigError(`${recipeId} の出力先が絶対パスになった: ${cleaned}`);
  }
  return cleaned;
}

function assertInsideProject(absolutePath: string, projectRoot: string, recipeId: string): void {
  const rel = relative(projectRoot, absolutePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ConfigError(`${recipeId} の出力先がプロジェクト外を指している: ${absolutePath}`);
  }
}

function assertNoDuplicateTargets(files: PlanFile[]): void {
  const seen = new Map<string, string>();
  for (const file of files) {
    const owner = seen.get(file.to);
    if (owner && owner !== file.recipeId) {
      throw new UiKitchenError(
        "TARGET_CONFLICT",
        `${owner} と ${file.recipeId} が同じファイルを出力しようとしている: ${file.to}`,
      );
    }
    seen.set(file.to, file.recipeId);
  }
}

async function statusFor(absolutePath: string, content: string): Promise<PlanFileStatus> {
  try {
    const existing = await readFile(absolutePath, "utf8");
    return existing === content ? "unchanged" : "conflict";
  } catch (cause) {
    if (isNotFound(cause)) return "create";
    throw cause;
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}
