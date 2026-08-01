[English](README.md) | [日本語](README.ja.md)

# ui-kitchen

A catalog of reusable UI recipes, plus a CLI that copies them into a project deterministically.

Asking an AI to write UI from scratch every time gives you a different result every time: sometimes perfect, sometimes hallucinated, never consistent across projects. ui-kitchen removes the guesswork by storing UI you have already reviewed as **files**, and reducing the AI's job from "write the UI" to "pick a recipe and run the CLI".

```bash
uikit list --kind block --tag auth   # search the catalog
uikit show web/blocks/auth-card      # inspect metadata, files and usage
uikit add web/blocks/auth-card       # generate it, dependencies included
```

The same recipe always produces byte-identical output. No model is involved in generation — only schema validation, template variable substitution and file IO.

## Why

- **Consistent** — every project draws from the same tokens and the same components
- **Deterministic** — `add` is idempotent, and `--dry-run` shows the plan before anything is written
- **Reviewed once** — you check the quality when the recipe is created, not on every generation
- **Owned code** — recipes are copied into your project (the shadcn/ui philosophy), so you can edit them afterwards

## Status

Under construction. The engine, the CLI (`init` / `list` / `show` / `add`) and the catalog (`web/tokens/base`, `web/lib/cn`, `web/primitives/button`) are in place; the remaining primitives are landing one recipe at a time. Inside this repository the CLI runs as `pnpm uikit <command>` — it is not published as a package.

## Requirements

[mise](https://mise.jdx.dev/) provides the toolchain (Node, pnpm, Bun) pinned in `mise.toml`.

```bash
mise install
pnpm install
```

## Usage

```bash
# in the project that should receive the UI
uikit init                                  # write ui-kitchen.json (paths, import alias, stack)
uikit list --json                           # machine-readable catalog, for AI agents
uikit show web/tokens/base
uikit add web/tokens/base web/lib/cn        # resolves required recipes recursively
uikit add web/primitives/button --dry-run   # show the plan without writing
```

Notes:

- npm dependencies are never installed automatically. Missing ones are reported with the exact command to run
- An existing file whose content differs is reported as `conflict` and left untouched unless `--force` is passed
- `UI_KITCHEN_CATALOG=<path>` points the CLI at a different catalog

## Stack

React + TypeScript + Tailwind CSS + shadcn/ui for the recipes. The CLI is TypeScript on Bun, in a pnpm workspace.

The catalog is scoped per platform (`catalog/web/…`), and the engine is platform-agnostic, so a mobile stack can be added later without touching existing recipes.

## Documentation

- [docs/design.md](docs/design.md) — design document: data model, CLI surface, roadmap (Japanese only for now)

