#!/usr/bin/env bun
import { runCommand } from "./cli.ts";
import { checkCatalogIndex, repositoryCatalogRoot } from "./index.ts";

await runCommand(async () => {
  const path = await checkCatalogIndex(repositoryCatalogRoot());
  console.log(`${path} は recipe の内容と一致している`);
});
