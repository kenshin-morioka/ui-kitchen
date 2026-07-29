#!/usr/bin/env bun
import { runCli } from "./run.ts";

// process.exit を使わない。stdout がパイプのとき書き込みが flush されず、
// 呼び出し側が受け取る JSON / メッセージが欠ける。
process.exitCode = await runCli(process.argv.slice(2), {
  io: {
    out: (text) => {
      console.log(text);
    },
    err: (text) => {
      console.error(text);
    },
  },
  cwd: process.cwd(),
});
