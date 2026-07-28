import {
  buildCatalogIndex,
  filterRecipes,
  PLATFORMS,
  type Platform,
  RECIPE_KINDS,
  type RecipeKind,
  UiKitchenError,
} from "@ui-kitchen/core";
import { openCatalog, parse, printJson, showHelp } from "../shared.ts";

const HELP = `uikit list — カタログの recipe を一覧する

使い方: uikit list [options]

オプション:
  --kind <kind>          種別で絞る (${RECIPE_KINDS.join(" | ")})
  --tag <tag>            タグで絞る
  --platform <platform>  プラットフォームで絞る (${PLATFORMS.join(" | ")})
  --json                 機械可読な形式で出力する (AI が使うのはこちら)
`;

export async function runList(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    kind: { type: "string" },
    tag: { type: "string" },
    platform: { type: "string" },
    json: { type: "boolean" },
  });
  if (showHelp(values, HELP)) return 0;

  const catalog = await openCatalog();
  const matched = filterRecipes(catalog, {
    kind: assertKind(values.kind),
    platform: assertPlatform(values.platform),
    tag: typeof values.tag === "string" ? values.tag : undefined,
  });

  if (values.json === true) {
    const matchedIds = new Set(matched.map(({ recipe }) => recipe.id));
    const index = buildCatalogIndex(catalog);
    printJson({ recipes: index.recipes.filter((entry) => matchedIds.has(entry.id)) });
    return 0;
  }

  if (matched.length === 0) {
    console.log("該当する recipe が無い");
    return 0;
  }

  const width = Math.max(...matched.map(({ recipe }) => recipe.id.length));
  for (const { recipe } of matched) {
    console.log(`${recipe.id.padEnd(width)}  ${recipe.description}`);
  }
  return 0;
}

function assertKind(value: unknown): RecipeKind | undefined {
  if (typeof value !== "string") return undefined;
  if (!(RECIPE_KINDS as readonly string[]).includes(value)) {
    throw new UiKitchenError("ARGS_INVALID", `未知の kind: ${value}\n使用できる: ${RECIPE_KINDS.join(", ")}`);
  }
  return value as RecipeKind;
}

function assertPlatform(value: unknown): Platform | undefined {
  if (typeof value !== "string") return undefined;
  if (!(PLATFORMS as readonly string[]).includes(value)) {
    throw new UiKitchenError(
      "ARGS_INVALID",
      `未知の platform: ${value}\n使用できる: ${PLATFORMS.join(", ")}`,
    );
  }
  return value as Platform;
}
