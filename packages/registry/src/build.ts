#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { catalogIndexPath, renderCatalogIndex, repositoryCatalogRoot } from "./index.ts";

const root = repositoryCatalogRoot();
const path = catalogIndexPath(root);
await writeFile(path, await renderCatalogIndex(root), "utf8");
console.log(`${path} を生成した`);
