import { loadCatalog, resolveRecipes, UnknownRecipeError } from "@ui-kitchen/core";
import { repositoryCatalogRoot } from "@ui-kitchen/registry";
import type { CommandResult } from "./result.ts";

export async function runShow(recipeId: string): Promise<CommandResult> {
  const catalog = await loadCatalog(repositoryCatalogRoot());
  const loaded = catalog.recipes.get(recipeId);
  if (!loaded) throw new UnknownRecipeError(recipeId, [...catalog.recipes.keys()]);

  const { recipe } = loaded;
  // 依存が先に来る順。add で実際に生成される recipe の順序と同じものを見せる。
  const order = resolveRecipes([recipeId], catalog).map((entry) => entry.recipe.id);

  const lines = [
    `${recipe.id}  [${recipe.kind}]  ${recipe.name}`,
    recipe.description,
    "",
    `platform: ${recipe.platform}`,
    `stack: ${[recipe.stack.framework, recipe.stack.language, recipe.stack.styling, recipe.stack.ui]
      .filter((value) => value !== undefined)
      .join(" / ")}`,
  ];
  if (recipe.tags.length > 0) lines.push(`tags: ${recipe.tags.join(", ")}`);

  lines.push("", "生成されるファイル (出力先はテンプレート変数のまま):");
  for (const file of recipe.files) {
    lines.push(`  ${file.from} -> ${file.to}`);
  }

  lines.push("", `解決される recipe (依存が先): ${order.join(" -> ")}`);

  const dependencies = Object.entries(recipe.dependencies);
  if (dependencies.length > 0) {
    lines.push("", "npm 依存 (install はしない):");
    for (const [name, range] of dependencies) lines.push(`  ${name} ${range}`);
  }

  if (recipe.variants.length > 0) {
    lines.push("", "variants:");
    for (const variant of recipe.variants) lines.push(`  ${variant.name}: ${variant.description}`);
  }

  lines.push("", "使うとき:", `  ${recipe.ai.use_when}`);
  if (recipe.ai.do_not.length > 0) {
    lines.push("してはいけないこと:", ...recipe.ai.do_not.map((item) => `  - ${item}`));
  }
  if (recipe.ai.integration !== undefined) {
    lines.push("組み込み方:", `  ${recipe.ai.integration}`);
  }
  lines.push("", `導入するには: uikit add ${recipe.id}`);

  return { lines, data: { recipe, resolvedRecipes: order } };
}
