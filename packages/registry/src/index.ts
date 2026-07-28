import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogIndex, loadCatalog, UiKitchenError } from "@ui-kitchen/core";

export const CATALOG_INDEX_FILENAME = "catalog.json";

/** このリポジトリの catalog/ ディレクトリ。UI_KITCHEN_CATALOG で上書きできる。 */
export function repositoryCatalogRoot(): string {
  const override = process.env.UI_KITCHEN_CATALOG;
  if (override) return resolve(override);
  // packages/registry/src/index.ts -> リポジトリルート
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..", "catalog");
}

export function catalogIndexPath(catalogRoot: string): string {
  return join(catalogRoot, CATALOG_INDEX_FILENAME);
}

/** インデックスの JSON 文字列。生成順を固定しているので同じカタログなら常に同一。 */
export async function renderCatalogIndex(catalogRoot: string): Promise<string> {
  const catalog = await loadCatalog(catalogRoot);
  assertRequiresExist(catalog.recipes);
  return `${JSON.stringify(buildCatalogIndex(catalog), null, 2)}\n`;
}

function assertRequiresExist(recipes: Map<string, { recipe: { id: string; requires: string[] } }>): void {
  for (const { recipe } of recipes.values()) {
    for (const dependency of recipe.requires) {
      if (!recipes.has(dependency)) {
        throw new UiKitchenError(
          "RECIPE_NOT_FOUND",
          `${recipe.id} が存在しない recipe を requires している: ${dependency}`,
        );
      }
    }
  }
}
