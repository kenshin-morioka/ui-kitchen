# バックログ

次に着手するものを上から順に並べる。**1 項目 = 1 PR**。着手前に [CLAUDE.md](../CLAUDE.md) を読むこと。

このファイルは作業の引き継ぎ用の正本。項目を終えたら該当節を削除し、新たに分かったことがあれば追記する。**セッションをまたいでもここを見れば続きが分かる状態を保つ。**

各項目の「既知の要修正点」は、実装前に別コンテキストのレビューで実測確認された不具合。叩き台をそのまま採用すると踏むので、最初から塞いだ形で実装する。

## 1. `packages/cli` — `uikit init` / `list` / `show` / `add`

`core` と `adapter-web` と `registry` を繋いで CLI にする。

既知の要修正点:

- **`--json` 指定時はエラーも JSON で返す。** 今の設計だとエラーは常に非 JSON（`error[CODE] message`）で、JSON を期待している呼び出し側が解釈できない。`{"error":{"code":"...","message":"..."}}` を出す
- **`--cwd` を明示したら上方探索しない。** `init` は `--cwd` 直下に `ui-kitchen.json` を作るのに、`add` は上方探索するため意味が食い違う。monorepo ルートに設定があると `--cwd apps/web` を無視して祖先の設定・祖先の出力先に生成してしまう
- **`--dry-run` でも conflict があれば非 0 を返すか、JSON に `blocked: true` を明示する。** 「まず dry-run させる」運用を推奨しているので、終了コードだけを見る呼び出し側が「適用可能」と誤判断する
- **未知オプションのエラーに HELP を添える。** 今は Node の英語メッセージが素で出る上、`--` を使えという無関係な助言が付く
- `--help` と `--json` の同時指定で非 JSON のヘルプが出る点も揃える

接続点の注意: `adapter-web` の `findMissingDependencies` の第 2 引数は `Record<string,string>` ではなく `InstalledDependencies`（`{ resolved, peer }`）。`findIncompatibleDependencies`（範囲不一致）も別枠で報告する。

## 2. CI に `catalog` ジョブ + `tokens/base` と `lib/cn` の recipe

`catalog/` が初めて入る PR。`lint:catalog` スクリプト（`biome ci --error-on-warnings catalog`）と CI の `catalog` ジョブ（`pnpm catalog:validate` + `pnpm lint:catalog`、`catalog/` と `packages/(core|registry)/` の変更で起動）を併せて追加する。

`tokens.css` は Tailwind v4.3.3 で実コンパイルして検証済み（`@import "tailwindcss"` / `@theme inline` / `@custom-variant dark (&:is(.dark *))` / `oklch()` はいずれも正しく、shadcn の実リポジトリと一致）。ただし以下は要修正:

- **radius スケールが不完全。** `sm/md/lg/xl` だけを `--radius` 由来にしているため、`--radius: 1.5rem` にすると `xl`(1.75rem) > `2xl`(1rem) でスケールが逆転する。`xs` / `2xl` / `3xl` / `4xl` も `--radius` 由来にする
- **shadcn の `--chart-1..5` と `--sidebar-*`（8 変数）が無い。** 「外部から持ち込むコードとの互換性」を謳うなら追加する。追加しないなら `recipe.yaml` の説明を「shadcn の色トークンのサブセット」に直す
- `--destructive-foreground` の値が shadcn（`oklch(0.97 0.01 17)`）とずれている。かつ shadcn 現行の `button.tsx` はこのトークンを使わず `text-white` を直書きしている。方針を決めて `ai.do_not` に明記する
- `* { border-color }` が preflight のリセット対象（`::after` `::before` `::backdrop` `::file-selector-button`）をカバーしていない
- `@import "tailwindcss"` を recipe 側で持つと、monorepo でルートからビルドする消費者でソース検出範囲がずれる。`recipe.yaml` の `integration` に `source()` の調整が必要な旨を書くか、`@import` をアプリ側の責務に移す

## 3. `catalog/web/primitives/*` を 1 件ずつ

`button` → `input` → `card` → `badge` → `label` → `select` → `checkbox` の順。**1 recipe = 1 PR。**

各 PR に含めるもの: `recipe.yaml`、`files/`、`README.md`、`pnpm catalog:build` で再生成した `catalog.json`、実プロジェクトへの `uikit add` の動作確認結果。

## 4. 残っている CI の指摘

- `actions/checkout@v5` は現行 v7、`jdx/mise-action@v3` は現行 v4。更新して、少なくとも `mise-action` は commit SHA で pin する
- PR の base を付け替え（retarget）しても CI が再実行されない（`on: pull_request` の既定 types に base 変更が含まれない）。古い base 前提の判定が必須チェックとして残る
- `catalog/**/*.ts` は `tsconfig.json` の `exclude` に入っているため型検査されていない（消費側の依存が root に無いので現状は妥当な割り切り。将来は catalog 用の別 tsconfig + ダミー依存で型検査する）

## 5. その後の構想（着手前に設計を詰める）

- `uikit doctor` — 前提の検証（tailwind 設定、importAlias、依存）
- `uikit snippet` / `uikit context` — ファイルを書かずにコード片 / `ai:` セクションを出力。AI に部分的に渡す用途
- `uikit diff` / `uikit adopt` — 導入済みファイルとカタログ正本の差分、手元の改変を recipe として吸い上げる
- `AGENTS.md` テンプレートの配布と Claude Code skill の同梱（`uikit init` が設置）。CLI があるだけでは AI は使わないので、フローに乗せる強制力が必要
- `examples/web-vite-react` — カタログの動作確認とプレビュー
- `catalog/mobile/` と `packages/adapter-mobile`（`core` に手を入れずに載ることが完了条件）
