import { resolveRecipes, UnknownRecipeError } from "@ui-kitchen/core";
import { openCatalog, parse, printJson, showHelp } from "../shared.ts";

const HELP = `uikit show — recipe の詳細と使い方を表示する

使い方: uikit show <recipe-id> [options]

オプション:
  --json   機械可読な形式で出力する
`;

export async function runShow(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { json: { type: "boolean" } });
  if (showHelp(values, HELP)) return 0;

  const id = positionals[0];
  if (!id) {
    console.error("recipe ID を指定する\n");
    console.error(HELP);
    return 1;
  }

  const catalog = await openCatalog();
  const loaded = catalog.recipes.get(id);
  if (!loaded) {
    throw new UnknownRecipeError(id, [...catalog.recipes.keys()]);
  }
  const { recipe } = loaded;
  // 依存を含めて実際に生成される recipe の全体像を示す。
  const chain = resolveRecipes([id], catalog).map((entry) => entry.recipe.id);

  if (values.json === true) {
    printJson({ recipe, resolved: chain });
    return 0;
  }

  const lines = [
    `${recipe.id}  (${recipe.kind})`,
    recipe.name,
    "",
    recipe.description,
    "",
    `tags: ${recipe.tags.length > 0 ? recipe.tags.join(", ") : "(なし)"}`,
    `stack: ${[recipe.stack.framework, recipe.stack.language, recipe.stack.styling, recipe.stack.ui]
      .filter(Boolean)
      .join(" / ")}`,
    "",
    "生成されるファイル:",
    ...recipe.files.map((file) => `  ${file.to}`),
    "",
    "依存する recipe (この順で生成される):",
    ...chain.filter((entry) => entry !== recipe.id).map((entry) => `  ${entry}`),
    ...(chain.length === 1 ? ["  (なし)"] : []),
    "",
    "npm 依存:",
    ...(Object.keys(recipe.dependencies).length > 0
      ? Object.entries(recipe.dependencies).map(([name, range]) => `  ${name}@${range}`)
      : ["  (なし)"]),
    "",
    "variants:",
    ...(recipe.variants.length > 0
      ? recipe.variants.map((variant) => `  --variant ${variant.name}  ${variant.description}`)
      : ["  (なし)"]),
    "",
    "使うべき場面:",
    `  ${recipe.ai.use_when}`,
    ...(recipe.ai.integration ? ["", "繋ぎ込み:", `  ${recipe.ai.integration}`] : []),
    ...(recipe.ai.do_not.length > 0
      ? ["", "やってはいけないこと:", ...recipe.ai.do_not.map((item) => `  - ${item}`)]
      : []),
  ];
  console.log(lines.join("\n"));
  return 0;
}
