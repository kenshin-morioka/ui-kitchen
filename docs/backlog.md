# バックログ

次に着手するものを上から順に並べる。**1 項目 = 1 PR**。着手前に [CLAUDE.md](../CLAUDE.md) を読むこと。

このファイルは作業の引き継ぎ用の正本。項目を終えたら該当節を削除し、新たに分かったことがあれば追記する。**セッションをまたいでもここを見れば続きが分かる状態を保つ。**

各項目の「既知の要修正点」は、実装前に別コンテキストのレビューで実測確認された不具合。叩き台をそのまま採用すると踏むので、最初から塞いだ形で実装する。

## 1. `catalog/web/primitives/*` を 1 件ずつ

`input` → `card` → `badge` → `label` → `select` → `checkbox` の順（`button` は追加済み）。**1 recipe = 1 PR。**

各 PR に含めるもの: `recipe.yaml`、`files/`、`README.md`、`pnpm catalog:build` で再生成した `catalog.json`、実プロジェクトへの `uikit add` の動作確認結果。

`catalog/` はこのリポジトリ直下にあるので、`UI_KITCHEN_CATALOG` の指定なしで `pnpm uikit add <id> --cwd <対象>` が通る。

primitive は `web/lib/cn` を requires する（`cn` の出力先は `lib/cn.ts`。shadcn の `lib/utils.ts` とは別ファイルなので、import は `{{@libImport}}/cn` と書く）。

`button` の作り方を後続の雛形にする。shadcn 現行の実装をそのまま写し、`cn` の import だけ差し替える。variant（recipe の variant 機構）は持たせていない — `loading` のようなものを入れると `<Comp … />` を children で包む形に変える必要があり、行単位の条件ブロックでは表現できない。必要になったらテンプレート機構側の設計から詰める。

動作確認は「生成される」だけでなく **`tsc` とレンダリングまで通す**。`uikit add` は成功するのに import が解決しない、というのを一度踏んでいる。

## 2. 残っている CI の指摘

- `actions/checkout@v5` は現行 v7、`jdx/mise-action@v3` は現行 v4。更新して、少なくとも `mise-action` は commit SHA で pin する
- PR の base を付け替え（retarget）しても CI が再実行されない（`on: pull_request` の既定 types に base 変更が含まれない）。古い base 前提の判定が必須チェックとして残る
- `catalog/**/*.ts` は `tsconfig.json` の `exclude` に入っているため型検査されていない（消費側の依存が root に無いので現状は妥当な割り切り。将来は catalog 用の別 tsconfig + ダミー依存で型検査する）
- `uikit show` が `ai:` の複数行ブロックをそのまま流すため、2 行目以降のインデントが揃わず読みにくい。行ごとに接頭辞を付けて整形する

## 3. その後の構想（着手前に設計を詰める）

- `uikit doctor` — 前提の検証（tailwind 設定、importAlias、依存）
- `uikit snippet` / `uikit context` — ファイルを書かずにコード片 / `ai:` セクションを出力。AI に部分的に渡す用途
- `uikit diff` / `uikit adopt` — 導入済みファイルとカタログ正本の差分、手元の改変を recipe として吸い上げる
- `AGENTS.md` テンプレートの配布と Claude Code skill の同梱（`uikit init` が設置）。CLI があるだけでは AI は使わないので、フローに乗せる強制力が必要
- `examples/web-vite-react` — カタログの動作確認とプレビュー
- `catalog/mobile/` と `packages/adapter-mobile`（`core` に手を入れずに載ることが完了条件）

## 実装中に分かったこと

- `uikit add` は `adapter-web` を直接 import している。プラットフォームが増えたら、`config.platform` から adapter を選ぶ層を `packages/cli` 側に切る（`core` には持ち込まない）
- 引数解析は `node:util` の `parseArgs` を使わず自前（`packages/cli/src/args.ts`）。未知オプションのメッセージが英語で、かつ「`--` を使え」という無関係な助言が付いて他のエラーと形が揃わないため
- `--json` の判定は引数解析より先に生の `argv` を走査して行う。解析自体が失敗したときも出力形式を JSON に揃える必要があるため
- `findConfig` が「設定が無い」ときに投げるのは `ConfigNotFoundError`（`CONFIG_NOT_FOUND`）。以前は `CONFIG_INVALID` で、壊れている場合と区別できなかった
- `catalogRootCandidates()` は `packages/registry` の位置を起点にする。CLI から呼んでも探索先は変わらない
- **`recipe.yaml` で `:` を含む行はクォートする。** `- dark: を…` や `- :root の…` を素で書くと YAML がマッピングとして解釈し、「文字列を期待した」というスキーマ違反で落ちる
- 角丸は `--radius` からの**倍率**で全段を出す（`calc(var(--radius) * 0.6)` 等）。shadcn 現行版もこの形。一部の段だけ固定値にすると `--radius` を変えたときに大小が逆転する
- shadcn 現行版は `--destructive-foreground` を**持たない**。destructive な面の文字色は `text-white` を直書きする。カタログもこれに揃えてある
- `tailwind-merge` v3 は追加設定なしで `rounded-xs` / `rounded-4xl` や `bg-chart-1` / `bg-sidebar` を競合として畳める（実測確認済み）。`extendTailwindMerge` は不要
- shadcn の docs サイト（`apps/v4/app/globals.css`）はトークンが独自拡張されていて `shadcn init` の出力とは別物。正本として参照するなら docs の theming ページ側を見る
- **Biome の `organizeImports` は `catalog/` では無効にしている**（`biome.json` の `overrides`）。テンプレート変数から始まる import 文字列（`"{{@libImport}}/cn"`）は `{` が先頭なので外部パッケージより前に並べ替えられ、展開後の順序が壊れる。recipe の import 順は「展開後に正しい順序」を人が担保する
- recipe を実プロジェクトで検証するときは `tsc` まで通す。ファイルが生成されるだけでは import が解決できているか分からない（`@/src/lib/cn` の二重パスはこれで見つかった）
