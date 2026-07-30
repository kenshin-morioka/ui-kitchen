import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve as resolvePath, sep } from "node:path";
import type { Catalog, LoadedRecipe } from "./catalog.ts";
import {
  ApplyBlockedError,
  ConfigError,
  FileSystemError,
  StackMismatchError,
  UiKitchenError,
} from "./errors.ts";
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
  /**
   * 実際に variant が適用された recipe ID → variant 名 (昇順)。
   * variant は recipe スコープなので、リクエスト文字列そのままでは
   * どの recipe の出力が変わったのか分からない。
   */
  enabledVariants: Record<string, string[]>;
}

export interface BuildPlanOptions {
  catalog: Catalog;
  config: ProjectConfig;
  projectRoot: string;
  recipeIds: string[];
  /**
   * `<variant>` または `<recipe-id>:<variant>`。スコープなしの指定は
   * recipeIds に含まれる recipe にだけ効く (依存 recipe には効かない)。
   */
  variants?: string[];
}

export async function buildPlan(options: BuildPlanOptions): Promise<Plan> {
  const { catalog, config, recipeIds } = options;
  const projectRoot = resolvePath(options.projectRoot);
  const resolved = resolveRecipes(recipeIds, catalog);
  const variantsByRecipe = resolveVariantScopes(options.variants ?? [], resolved, recipeIds);

  const vars = templateVarsFor(config);
  const files: PlanFile[] = [];
  /** 依存の要求元を覚えておき、range が食い違ったときに双方を示す。 */
  const dependencies = new Map<string, { range: string; recipeId: string }>();

  for (const { recipe, dir } of resolved) {
    assertStackCompatible(recipe, config);

    const declaredVariants = recipe.variants.map((variant) => variant.name);
    const enabledVariants = [...(variantsByRecipe.get(recipe.id) ?? [])].sort();

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
      const previous = dependencies.get(name);
      if (previous && previous.range !== range) {
        throw new UiKitchenError(
          "DEPENDENCY_CONFLICT",
          `npm 依存 ${name} の要求 range が競合している: ${previous.recipeId} が ${previous.range}、${recipe.id} が ${range}`,
        );
      }
      dependencies.set(name, { range, recipeId: recipe.id });
    }
  }

  assertNoDuplicateTargets(files);

  return {
    projectRoot,
    recipes: resolved.map(({ recipe }) => recipe.id),
    requested: recipeIds,
    files,
    requiredDependencies: Object.fromEntries([...dependencies].map(([name, { range }]) => [name, range])),
    enabledVariants: Object.fromEntries(
      [...variantsByRecipe]
        .map(([recipeId, variants]): [string, string[]] => [recipeId, [...variants].sort()])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
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

/**
 * plan をファイルシステムに反映する。plan が同じなら結果は常に同じ (冪等)。
 * conflict が 1 件でもあれば (force なしなら) 何も書かない。一部だけ更新すると
 * 新しいファイルが古いファイルを参照する壊れた状態が残るため。
 */
export async function applyPlan(plan: Plan, options: ApplyOptions = {}): Promise<ApplyResult> {
  const conflicts = plan.files.filter((file) => file.status === "conflict");
  if (conflicts.length > 0 && !options.force) {
    throw new ApplyBlockedError(conflicts.map((file) => file.to));
  }

  const pending = plan.files.filter((file) => file.status !== "unchanged");
  const skipped = plan.files.filter((file) => file.status === "unchanged");

  // 書き込みは全件の検証を終えてから行う。途中で弾くと部分適用になる。
  const projectRootReal = await realpathOrThrow(plan.projectRoot);
  for (const file of pending) {
    await assertRealTargetInsideProject(file, projectRootReal);
  }

  const written: string[] = [];
  for (const file of pending) {
    try {
      await mkdir(dirname(file.absolutePath), { recursive: true });
      await writeFile(file.absolutePath, file.content, "utf8");
    } catch (cause) {
      throw new FileSystemError(`${file.to} を書き込めない: ${describe(cause)}`);
    }
    written.push(file.to);
  }

  return { written, skipped };
}

export function templateVarsFor(config: ProjectConfig): TemplateVars {
  const dirs = {
    componentsDir: stripTrailingSlash(config.paths.componentsDir),
    hooksDir: stripTrailingSlash(config.paths.hooksDir),
    libDir: stripTrailingSlash(config.paths.libDir),
    stylesDir: stripTrailingSlash(config.paths.stylesDir),
  };

  return {
    ...dirs,
    componentsImport: importPathFor(config, dirs.componentsDir, "componentsDir"),
    hooksImport: importPathFor(config, dirs.hooksDir, "hooksDir"),
    libImport: importPathFor(config, dirs.libDir, "libDir"),
    stylesImport: importPathFor(config, dirs.stylesDir, "stylesDir"),
  };
}

/**
 * 出力先を import に書けるパスへ変換する。
 *
 * importAlias が指すディレクトリ (aliasBase) から見た相対パスに直してから繋ぐ。
 * 直接繋ぐと `@/` + `src/lib` = "@/src/lib" のように、エイリアスが src/ を
 * 指している構成 (最も一般的) で解決できないパスになる。
 */
function importPathFor(config: ProjectConfig, dir: string, field: string): string {
  const base = segmentsOf(config.aliasBase);
  const target = segmentsOf(dir);

  if (!startsWithSegments(target, base)) {
    throw new ConfigError(
      `paths.${field} (${dir}) が importAlias の指す ${config.aliasBase} の外にある。` +
        `import のパスを組めないので、出力先を ${config.aliasBase} 配下にするか aliasBase を直す。`,
    );
  }

  // 区切りは常に "/"。import のパスに OS のセパレータは使えない。
  const rest = target.slice(base.length).join("/");
  const prefix = stripTrailingSlash(config.importAlias.replace(/\\/g, "/"));
  return rest === "" ? prefix : `${prefix}/${rest}`;
}

/** "." と空のセグメントを落として比較可能にする。区切りは / と \ の両方を受ける。 */
function segmentsOf(value: string): string[] {
  return value.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
}

function startsWithSegments(target: string[], base: string[]): boolean {
  if (base.length > target.length) return false;
  // 大文字小文字だけが違う指定も同じディレクトリを指しうるが、ここで畳むと
  // import のパスが実際のディレクトリ名と食い違う。厳密一致にする。
  return base.every((segment, index) => target[index] === segment);
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

/**
 * variant のリクエストを recipe 単位に割り当てる。
 * スコープなしの指定を解決済み recipe 全体に適用すると、依存 recipe の出力が
 * 意図せず変わって既存ファイルと conflict する。そのため明示指定した recipe に限定し、
 * 依存側に効かせたい場合は `<recipe-id>:<variant>` を要求する。
 */
function resolveVariantScopes(
  requests: string[],
  resolved: LoadedRecipe[],
  requestedIds: string[],
): Map<string, Set<string>> {
  const declaredBy = new Map<string, Set<string>>(
    resolved.map(({ recipe }) => [recipe.id, new Set(recipe.variants.map((variant) => variant.name))]),
  );
  const explicit = requestedIds.filter((id) => declaredBy.has(id));
  const enabled = new Map<string, Set<string>>();

  const enable = (recipeId: string, variant: string): void => {
    const current = enabled.get(recipeId);
    if (current) current.add(variant);
    else enabled.set(recipeId, new Set([variant]));
  };

  for (const request of requests) {
    const { recipeId, variant } = parseVariantRequest(request);

    if (recipeId !== undefined) {
      const declared = declaredBy.get(recipeId);
      if (!declared) {
        throw new UiKitchenError(
          "VARIANT_NOT_FOUND",
          `${request} が指す recipe は今回の対象に含まれていない: ${recipeId}\n対象: ${[...declaredBy.keys()].join(", ")}`,
        );
      }
      if (!declared.has(variant)) {
        throw new UiKitchenError(
          "VARIANT_NOT_FOUND",
          `${recipeId} は variant ${variant} を宣言していない${availableHint(declaredBy)}`,
        );
      }
      enable(recipeId, variant);
      continue;
    }

    const targets = explicit.filter((id) => declaredBy.get(id)?.has(variant));
    if (targets.length === 0) {
      const owners = [...declaredBy].filter(([, declared]) => declared.has(variant)).map(([id]) => id);
      throw new UiKitchenError(
        "VARIANT_NOT_FOUND",
        owners.length > 0
          ? `variant ${variant} を宣言しているのは依存 recipe (${owners.join(", ")}) だけ。依存側に適用するなら <recipe-id>:${variant} の形式で指定する。`
          : `どの recipe も宣言していない variant: ${variant}${availableHint(declaredBy)}`,
      );
    }
    for (const id of targets) enable(id, variant);
  }

  return enabled;
}

function parseVariantRequest(request: string): { recipeId?: string; variant: string } {
  // recipe ID に `:` は使えないので、最後の `:` より前をスコープとして扱う。
  const separator = request.lastIndexOf(":");
  if (separator < 0) return { variant: request };
  return { recipeId: request.slice(0, separator), variant: request.slice(separator + 1) };
}

function availableHint(declaredBy: Map<string, Set<string>>): string {
  const available = [...declaredBy]
    .flatMap(([id, declared]) => [...declared].map((variant) => `${id}:${variant}`))
    .sort();
  return available.length > 0 ? `\n使用できる variant: ${available.join(", ")}` : "";
}

/** 出力先を組み立てるとき `src/components//ui` のような二重区切りを作らないため。 */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeTarget(target: string, vars: TemplateVars, recipeId: string): string {
  const expanded = expandTemplate(target, { vars, source: `${recipeId}:to` });
  // `a/./b` のような等価な別表記を 1 つに畳む。畳まないと文字列比較の重複検出を
  // すり抜け、join 後に同じファイルへ後勝ちで書き込まれる。
  const cleaned = normalize(expanded.replace(/\/{2,}/g, "/"));
  if (isAbsolute(cleaned)) {
    throw new ConfigError(`${recipeId} の出力先が絶対パスになった: ${cleaned}`);
  }
  if (cleaned === "." || cleaned === ".." || cleaned.startsWith(`..${sep}`)) {
    throw new ConfigError(`${recipeId} の出力先がファイルを指していない: ${cleaned}`);
  }
  return cleaned;
}

function assertInsideProject(absolutePath: string, projectRoot: string, recipeId: string): void {
  const rel = relative(projectRoot, absolutePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ConfigError(`${recipeId} の出力先がプロジェクト外を指している: ${absolutePath}`);
  }
}

/**
 * 実パスで出力先がプロジェクト内かを検証する。字句上の比較だけでは
 * `proj/src` がプロジェクト外への symlink のときにすり抜ける。
 */
async function assertRealTargetInsideProject(file: PlanFile, projectRootReal: string): Promise<void> {
  // 出力先はまだ存在しないことが多いので、存在する直近の親から辿る。
  const ancestor = await nearestExistingPath(dirname(file.absolutePath), file);
  assertRealInside(await realpathOrThrow(ancestor, file), projectRootReal, file);

  // 出力先自体が symlink なら writeFile はリンク先を書き換えるため、こちらも解決する。
  if (await pathExists(file.absolutePath, file)) {
    assertRealInside(await realpathOrThrow(file.absolutePath, file), projectRootReal, file);
  }
}

function assertRealInside(realPath: string, projectRootReal: string, file: PlanFile): void {
  const rel = relative(projectRootReal, realPath);
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new FileSystemError(
      `${file.recipeId} の出力先 ${file.to} が symlink 経由でプロジェクト外を指している: ${realPath}`,
    );
  }
}

/** 存在する直近の祖先を返す。ルートまで無ければルートを返す。 */
async function nearestExistingPath(path: string, file: PlanFile): Promise<string> {
  let current = path;
  for (;;) {
    if (await pathExists(current, file)) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** symlink 自体の有無を見る (リンク切れも「存在する」扱いにして realpath で弾く)。 */
async function pathExists(path: string, file: PlanFile): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (isNotFound(cause)) return false;
    throw new FileSystemError(`${file.to} の出力先を確認できない (${path}): ${describe(cause)}`);
  }
}

async function realpathOrThrow(path: string, file?: PlanFile): Promise<string> {
  try {
    return await realpath(path);
  } catch (cause) {
    const label = file ? `${file.to} の出力先` : "プロジェクトルート";
    throw new FileSystemError(`${label}の実パスを解決できない (${path}): ${describe(cause)}`);
  }
}

function assertNoDuplicateTargets(files: PlanFile[]): void {
  const seen = new Map<string, PlanFile>();
  for (const file of files) {
    // macOS / Windows のファイルシステムは case-insensitive なので、大文字小文字しか
    // 違わない出力先も同じファイルになる。環境差で結果が変わらないよう常に弾く。
    const key = file.absolutePath.toLowerCase();
    const owner = seen.get(key);
    if (owner) {
      const detail =
        owner.absolutePath === file.absolutePath
          ? file.to
          : `${owner.to} と ${file.to} (大文字小文字しか違わない)`;
      throw new UiKitchenError(
        "TARGET_CONFLICT",
        `${owner.recipeId} と ${file.recipeId} が同じファイルを出力しようとしている: ${detail}`,
      );
    }
    seen.set(key, file);
  }
}

async function statusFor(absolutePath: string, content: string): Promise<PlanFileStatus> {
  try {
    const existing = await readFile(absolutePath, "utf8");
    return existing === content ? "unchanged" : "conflict";
  } catch (cause) {
    if (isNotFound(cause)) return "create";
    // EISDIR / ENOTDIR / EACCES をそのまま投げると CLI がスタックトレースを出す。
    throw new FileSystemError(
      `出力先の既存内容を確認できない: ${absolutePath}${reasonHint(cause)}\n${describe(cause)}`,
    );
  }
}

function reasonHint(cause: unknown): string {
  switch (codeOf(cause)) {
    case "EISDIR":
      return " (同名のディレクトリが存在する)";
    case "ENOTDIR":
      return " (途中のディレクトリがファイルになっている)";
    case "EACCES":
    case "EPERM":
      return " (読み取り権限がない)";
    default:
      return "";
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function codeOf(cause: unknown): string | undefined {
  if (typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return undefined;
}

function isNotFound(cause: unknown): boolean {
  return codeOf(cause) === "ENOENT";
}
