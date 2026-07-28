import { z } from "zod";

/**
 * recipe の種別。ディレクトリ名との対応は KIND_DIRECTORIES を参照。
 * 総称は「recipe」。component はその一種でしかない。
 */
export const RECIPE_KINDS = ["tokens", "lib", "primitive", "component", "block", "layout", "page"] as const;

export type RecipeKind = (typeof RECIPE_KINDS)[number];

/** 対応プラットフォーム。mobile を追加するときはここに足す。 */
export const PLATFORMS = ["web"] as const;

export type Platform = (typeof PLATFORMS)[number];

/** kind → カタログ内のディレクトリ名。 */
export const KIND_DIRECTORIES = {
  tokens: "tokens",
  lib: "lib",
  primitive: "primitives",
  component: "components",
  block: "blocks",
  layout: "layouts",
  page: "pages",
} as const satisfies Record<RecipeKind, string>;

/** ディレクトリ名 → kind。 */
export const DIRECTORY_KINDS = Object.fromEntries(
  Object.entries(KIND_DIRECTORIES).map(([kind, dir]) => [dir, kind as RecipeKind]),
) as Record<string, RecipeKind>;

/**
 * テンプレート内で展開できる変数名。有限集合に固定することで、
 * 任意の式評価を排除し出力を決定的に保つ。
 */
export const TEMPLATE_VARIABLES = [
  "componentsDir",
  "hooksDir",
  "libDir",
  "stylesDir",
  "importAlias",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const recipeIdPattern = /^[a-z]+\/[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const recipeId = z
  .string()
  .regex(
    recipeIdPattern,
    "recipe ID は <platform>/<kind-dir>/<name> 形式で指定する (例: web/primitives/button)",
  );

/** 相対パスのみ許可し、ディレクトリ traversal と絶対パスを弾く。 */
const relativePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), "絶対パスは指定できない")
  .refine((value) => !value.split("/").includes(".."), "'..' を含むパスは指定できない");

export const stackSchema = z.object({
  framework: z.string().min(1),
  language: z.string().min(1),
  styling: z.string().min(1),
  ui: z.string().min(1).optional(),
});

export const recipeFileSchema = z.object({
  /** recipe ディレクトリからの相対パス。 */
  from: relativePath,
  /** 出力先。テンプレート変数を含められる。 */
  to: relativePath,
});

export const recipeVariantSchema = z.object({
  name: z.string().regex(kebabCase, "variant 名は kebab-case で指定する"),
  description: z.string().min(1),
});

export const recipeAiSchema = z.object({
  use_when: z.string().min(1),
  do_not: z.array(z.string().min(1)).default([]),
  integration: z.string().min(1).optional(),
});

export const recipeSchema = z.object({
  id: recipeId,
  name: z.string().min(1),
  kind: z.enum(RECIPE_KINDS),
  platform: z.enum(PLATFORMS),
  description: z.string().min(1),
  tags: z.array(z.string().regex(kebabCase, "tag は kebab-case で指定する")).default([]),
  stack: stackSchema,
  files: z.array(recipeFileSchema).min(1),
  requires: z.array(recipeId).default([]),
  /** npm 依存。値は semver range。CLI は不足を報告するだけで install はしない。 */
  dependencies: z.record(z.string().min(1), z.string().min(1)).default({}),
  variants: z.array(recipeVariantSchema).default([]),
  ai: recipeAiSchema,
});

export type Recipe = z.output<typeof recipeSchema>;
export type RecipeFile = z.output<typeof recipeFileSchema>;
export type Stack = z.output<typeof stackSchema>;

export const projectConfigSchema = z.object({
  platform: z.enum(PLATFORMS),
  stack: stackSchema,
  paths: z.object({
    componentsDir: relativePath,
    hooksDir: relativePath,
    libDir: relativePath,
    stylesDir: relativePath,
  }),
  /** import のパスエイリアス。末尾の区切りまで含める (例: "@/")。 */
  importAlias: z.string().min(1),
});

export type ProjectConfig = z.output<typeof projectConfigSchema>;

/** recipe ID から期待されるカタログ内の相対ディレクトリを組み立てる。 */
export function recipeDirectoryFor(recipe: Pick<Recipe, "platform" | "kind" | "id">): string {
  const name = recipe.id.split("/").at(-1);
  return `${recipe.platform}/${KIND_DIRECTORIES[recipe.kind]}/${name}`;
}
