import type { Catalog, LoadedRecipe } from "./catalog.ts";
import { CircularDependencyError, UnknownRecipeError } from "./errors.ts";

/**
 * requires を再帰的に辿り、依存が先に来る順 (トポロジカル順) で返す。
 * 同じ recipe が複数経路から参照されても 1 度だけ含まれる。
 */
export function resolveRecipes(ids: string[], catalog: Catalog): LoadedRecipe[] {
  const ordered: LoadedRecipe[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      // path には循環に入るまでの経路も含まれる。原因を読み取りやすくするため
      // 再訪した id から先だけを切り出して渡す。
      throw new CircularDependencyError([...path.slice(path.indexOf(id)), id]);
    }

    const loaded = catalog.recipes.get(id);
    if (!loaded) {
      // 依存を辿った先で見つからない場合は、直前の recipe の requires が原因。
      throw new UnknownRecipeError(id, [...catalog.recipes.keys()], path.at(-1));
    }

    visiting.add(id);
    for (const dependency of loaded.recipe.requires) {
      visit(dependency, [...path, id]);
    }
    visiting.delete(id);

    done.add(id);
    ordered.push(loaded);
  };

  for (const id of ids) {
    visit(id, []);
  }

  return ordered;
}
