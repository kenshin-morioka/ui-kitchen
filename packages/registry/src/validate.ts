#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { catalogIndexPath, renderCatalogIndex, repositoryCatalogRoot } from "./index.ts";

// recipe.yaml のスキーマ検証と、コミット済みインデックスの鮮度チェックを兼ねる。
const root = repositoryCatalogRoot();
const path = catalogIndexPath(root);
const expected = await renderCatalogIndex(root);

let actual: string;
try {
  actual = await readFile(path, "utf8");
} catch {
  console.error(`${path} が無い。'pnpm catalog:build' を実行する。`);
  process.exit(1);
}

if (actual !== expected) {
  console.error(`${path} が古い。'pnpm catalog:build' を実行してコミットする。`);
  process.exit(1);
}

console.log("catalog は検証済みでインデックスも最新");
