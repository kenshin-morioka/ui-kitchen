import { describe, expect, test } from "bun:test";
import type { Catalog, LoadedRecipe } from "../src/catalog.ts";
import { CircularDependencyError, UnknownRecipeError } from "../src/errors.ts";
import { resolveRecipes } from "../src/resolve.ts";
import type { Recipe } from "../src/schema.ts";

function recipeStub(id: string, requires: string[]): LoadedRecipe {
  return {
    dir: `/catalog/${id}`,
    recipe: { id, requires } as Recipe,
  };
}

function catalogOf(...entries: LoadedRecipe[]): Catalog {
  return {
    root: "/catalog",
    recipes: new Map(entries.map((entry) => [entry.recipe.id, entry])),
  };
}

describe("resolveRecipes", () => {
  test("依存が先に来る順で返す", () => {
    const catalog = catalogOf(
      recipeStub("web/primitives/button", ["web/lib/cn", "web/tokens/base"]),
      recipeStub("web/lib/cn", []),
      recipeStub("web/tokens/base", []),
    );

    expect(resolveRecipes(["web/primitives/button"], catalog).map((entry) => entry.recipe.id)).toEqual([
      "web/lib/cn",
      "web/tokens/base",
      "web/primitives/button",
    ]);
  });

  test("複数経路から参照される依存も 1 度だけ含む", () => {
    const catalog = catalogOf(
      recipeStub("web/blocks/form", ["web/primitives/button", "web/primitives/input"]),
      recipeStub("web/primitives/button", ["web/lib/cn"]),
      recipeStub("web/primitives/input", ["web/lib/cn"]),
      recipeStub("web/lib/cn", []),
    );

    const ids = resolveRecipes(["web/blocks/form"], catalog).map((entry) => entry.recipe.id);
    expect(ids.filter((id) => id === "web/lib/cn")).toHaveLength(1);
    expect(ids.indexOf("web/lib/cn")).toBeLessThan(ids.indexOf("web/primitives/button"));
  });

  test("存在しない recipe はエラーにする", () => {
    expect(() => resolveRecipes(["web/primitives/nope"], catalogOf())).toThrow(UnknownRecipeError);
  });

  test("循環依存を検出する", () => {
    const catalog = catalogOf(recipeStub("web/lib/a", ["web/lib/b"]), recipeStub("web/lib/b", ["web/lib/a"]));
    expect(() => resolveRecipes(["web/lib/a"], catalog)).toThrow(CircularDependencyError);
  });
});
