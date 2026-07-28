#!/usr/bin/env bun
import { runCommand } from "./cli.ts";
import { repositoryCatalogRoot, writeCatalogIndex } from "./index.ts";

await runCommand(async () => {
  const path = await writeCatalogIndex(repositoryCatalogRoot());
  console.log(`${path} を生成した`);
});
