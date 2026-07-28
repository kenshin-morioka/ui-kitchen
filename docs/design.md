# ui-kitchen 設計ドキュメント

## 1. 背景と課題

個人 OSS 開発において、UI は毎回 AI に生成させている。バックエンド / インフラが専門でフロントの知識とデザインセンスが乏しいため、生成物の判断基準を持てないことが前提にある。この運用には次の問題がある。

- **出来栄えが不安定**: プロンプトの書き方・その時のモデルの機嫌で品質が上下する。完璧なこともあれば、存在しない API を使う（ハルシネーション）こともある。
- **統一感がない**: リポジトリ間、同一リポジトリ内でも、生成時期が違うと配色・余白・命名・構造がバラバラになる。
- **レビューできない**: 生成結果の良し悪しを自分で判断できないので、品質のばらつきをそのまま受け入れてしまう。

原因は一点に集約できる。**UI の実装を毎回「推論」で作り直している**こと。

## 2. 目的

**一度品質を確認した UI を資産として一元管理し、以降は推論ではなく決定的なコピー操作で再利用する。**

- 保存された UI は「AI が思い出すもの」ではなく「ファイルとして存在するもの」にする。
- AI の役割を「UI を書く」から「カタログから適切なものを選び、CLI を叩く」に縮小する。生成の主体を LLM からツールに移す。
- 結果として、同じ recipe を指定すれば毎回バイト単位で同じ出力になる。

### 非目的（やらないこと）

- 汎用 UI ライブラリとして他人に配布・公開すること（結果的にそうなってもよいが、最適化の対象は自分の使い方）
- npm パッケージとして `import` させること。**コードはコピーして持ち込む**（shadcn/ui と同じ思想。持ち込み後の改変を許すため）
- デザインシステムそのものの設計論を突き詰めること
- 初期段階でのモバイル対応（ただし後から足せる構造にする → §4）

## 3. コアコンセプト: 決定的生成フロー

従来:

```
ユーザー「ログイン画面つくって」 → AI が推論して実装 → 品質は運
```

ui-kitchen 導入後:

```
ユーザー「ログイン画面つくって」
  → AI: uikit list --kind block --tag auth      （カタログ検索）
  → AI: uikit show web/blocks/auth-card         （メタ情報と使い方を確認）
  → AI: uikit add web/blocks/auth-card          （決定的にファイル生成）
  → AI: 生成されたファイルのプロジェクト固有部分だけを最小限に編集
```

推論が残るのは最後の「どの recipe を選ぶか」と「文言・繋ぎ込み」だけ。**見た目を決めるコードは推論の外に出る。**

これを実現する要件:

1. カタログは AI が機械的に検索・理解できる形式でメタデータを持つ（§5）
2. CLI は LLM を一切呼ばない。テンプレート展開のみ（§6）
3. AI に対して「自分で UI を書くな、CLI を使え」を強制する仕組みを配布する（§7）

## 4. リポジトリ構成

プラットフォーム名を上位ディレクトリで分離し、コアロジックをプラットフォーム非依存に保つ。将来 `catalog/mobile/` と `packages/adapter-mobile/` を足すだけで拡張できる。

```
ui-kitchen/
├── pnpm-workspace.yaml
├── package.json
├── docs/
│   └── design.md
├── packages/
│   ├── core/               # @ui-kitchen/core
│   │                       #   recipe のパース・検証・依存解決・テンプレート展開
│   │                       #   プラットフォーム非依存（web/mobile を知らない）
│   ├── cli/                # @ui-kitchen/cli  … uikit コマンド本体
│   ├── adapter-web/        # @ui-kitchen/adapter-web
│   │                       #   web 固有: package.json への依存追記、tailwind 設定検証、
│   │                       #   tsconfig paths 解決など
│   └── registry/           # カタログのインデックス生成 (catalog.json) と CI 検証
├── catalog/
│   └── web/
│       ├── tokens/         # デザイントークン（配色・余白・タイポ・radius）
│       ├── primitives/     # Button, Input, Badge … 最小単位
│       ├── components/     # DataTable, Modal, Form … primitives の合成
│       ├── blocks/         # LoginCard, PricingSection, Sidebar … 画面の一区画
│       ├── layouts/        # AppShell, DocsLayout … ページ骨格
│       └── pages/          # 完成画面一式（Dashboard, Settings …）
└── examples/
    └── web-vite-react/     # カタログの動作確認・プレビュー用のサンドボックス
```

命名方針:

- recipe ID は `<platform>/<kind>/<name>` 形式（例: `web/blocks/auth-card`）。プラットフォームが ID に含まれるので、mobile 追加時に既存 ID の破壊的変更が起きない。
- パッケージ名にプラットフォームを含めない（`core`, `cli`, `registry`）。プラットフォーム固有は `adapter-<platform>` に閉じる。
- 「component」という語は kind の一つとして予約し、カタログ全体の総称には使わない（総称は **recipe**）。

## 5. カタログのデータモデル

1 recipe = 1 ディレクトリ。

```
catalog/web/blocks/auth-card/
├── recipe.yaml       # メタデータ（唯一の正本）
├── files/            # 生成されるソースの実体
│   ├── auth-card.tsx
│   └── use-auth-form.ts
├── preview.png       # 見た目の記録（人間が選ぶ用）
└── README.md         # 使い方・意図・改変ポイント
```

### recipe.yaml

```yaml
id: web/blocks/auth-card
name: Auth Card
kind: block                    # tokens | primitive | component | block | layout | page
platform: web
description: メール + パスワードのログインカード。バリデーション付き。
tags: [auth, form, login]

stack:                         # 前提スタック。合わないプロジェクトには add させない
  framework: react
  language: typescript
  styling: tailwind
  ui: shadcn

files:
  - from: files/auth-card.tsx
    to: "{{componentsDir}}/blocks/auth-card.tsx"
  - from: files/use-auth-form.ts
    to: "{{hooksDir}}/use-auth-form.ts"

requires:                      # 他 recipe への依存。再帰的に解決される
  - web/primitives/button
  - web/primitives/input
  - web/tokens/base

dependencies:                  # npm 依存。不足していれば CLI が提示（自動 install はしない）
  react-hook-form: ^7
  zod: ^3

variants:                      # 生成時に選べる差分。テンプレート内の条件分岐に対応
  - name: with-oauth
    description: Google / GitHub のソーシャルログインボタンを含める

ai:                            # AI 向けの決定的なガイド。uikit context で出力される
  use_when: メール/パスワードのログイン・サインアップ画面が必要なとき
  do_not:
    - 認証ロジック自体は含まれない。onSubmit の中身は呼び出し側で実装する
    - スタイルは tokens 由来。個別に色を直書きしない
  integration: onSubmit プロパティに (email, password) => Promise<void> を渡す
```

### テンプレート変数

`files[].to` と `files/` 配下の内容では、プロジェクト設定（§6 `ui-kitchen.json`）由来の変数のみを展開する。変数は固定の有限集合とし、任意の式は評価しない（決定性と安全性のため）。

- `{{componentsDir}}` / `{{hooksDir}}` / `{{libDir}}` … 出力先
- `{{importAlias}}` … `@/` などのパスエイリアス
- `{{variant.<name>}}` … variant の有効/無効

### インデックス

`packages/registry` が全 recipe を走査して `catalog.json`（ID・kind・tags・description・requires のフラットな一覧）を生成する。`uikit list` / `uikit search` はこれだけを読むので、カタログが数百件になっても検索は一定コスト。CI でインデックスの再生成差分と recipe.yaml のスキーマ検証を行う。

## 6. CLI 設計

**実装: TypeScript / 実行ランタイム: Bun / パッケージ管理: pnpm（workspace）**
コマンド名は `uikit`。

| コマンド | 役割 |
| --- | --- |
| `uikit init` | 対象プロジェクトに `ui-kitchen.json` を作成。出力先ディレクトリ・importAlias・スタック情報を記録 |
| `uikit list [--kind <k>] [--tag <t>] [--platform web]` | カタログ一覧。AI の一次検索用に `--json` を持つ |
| `uikit show <id>` | recipe.yaml の内容、生成されるファイル一覧、依存、使い方を表示 |
| `uikit add <id...> [--variant <v>] [--dry-run] [--force]` | **主機能。** requires を再帰解決し、テンプレート展開してファイルを書き出す。既存ファイルは既定で上書きしない |
| `uikit snippet <id> [--format json\|md]` | ファイルを書かずにコード片を標準出力。AI が部分的に埋め込みたいときに使う |
| `uikit context <id...>` | recipe の `ai:` セクションを集約して AI に渡すコンテキストを出力 |
| `uikit doctor` | 前提の検証（tailwind 設定、importAlias、必要 npm 依存の有無）と不足の提示 |
| `uikit diff <id>` | 導入済みファイルとカタログ正本の差分。カタログ改善を手元の改変から吸い上げるため |

決定性の担保:

- CLI は LLM API を呼ばない。処理はスキーマ検証 + 変数展開 + ファイル IO のみ。
- `add` は冪等。同じ recipe / variant / 設定なら常に同一の出力。
- `--dry-run` で書き込み前に生成計画（パスと差分）を確認できる。AI にはまず dry-run させる運用を推奨。
- 依存 npm パッケージは**自動 install しない**。不足を報告して人間 or AI に判断させる（勝手にロックファイルを触らせない）。

## 7. AI との連携

CLI があるだけでは AI は使わない。「自分で書いてしまう」のを封じる仕組みをリポジトリから配布する。

- **`AGENTS.md` / `CLAUDE.md` テンプレート**: 対象プロジェクトに `uikit init` が設置する。内容は「UI を新規実装する前に必ず `uikit list --json` を実行する / カタログに該当があれば `uikit add` を使う / 該当がない場合のみ新規実装し、完成後に ui-kitchen へ recipe として還流させる」。
- **Claude Code Skill**: ui-kitchen リポジトリ内に skill を同梱し、dotfiles 経由で `~/.claude/skills/` に配置する。UI 生成タスクを検知したら上記フローに強制的に乗せる役割。
- **カタログへの還流フロー**: 新規実装した UI が良かった場合、`uikit adopt <path>` 相当で recipe 化してカタログに登録する（Phase 3）。使うほどカタログが育ち、推論の割合が減っていく。

## 8. スタック前提

| 項目 | 選択 |
| --- | --- |
| フレームワーク | React + TypeScript |
| スタイリング | Tailwind CSS |
| UI 基盤 | shadcn/ui（コードをコピーして自前管理する思想が本リポジトリと一致） |
| ビルド前提 | Vite / Next.js のどちらでも載る形に保つ |
| CLI 言語 | TypeScript |
| CLI ランタイム | Bun |
| パッケージ管理 | pnpm（workspace でモノレポ管理） |

React + Tailwind + shadcn を選ぶ理由は、AI の学習データが最も厚く、カタログに無い UI を新規生成させる場合のフォールバック品質が最も高いため。カタログが未成熟な初期ほどこの差が効く。

## 9. ロードマップ

| Phase | 内容 | 完了条件 |
| --- | --- | --- |
| 0 | 本ドキュメント、リポジトリ骨格、pnpm workspace 構成 | 設計合意 |
| 1 | `packages/core` の recipe スキーマ・依存解決・テンプレート展開 / `uikit list` `show` `add` `init` | 手書きの recipe 1 件を実プロジェクトに add できる |
| 2 | tokens + primitives の初期カタログ整備、`examples/web-vite-react` でのプレビュー、`doctor` | Button/Input/Card 等で画面が 1 枚組める |
| 3 | blocks / layouts / pages の拡充、`snippet` `context` `diff` `adopt`、AGENTS.md と Claude Code Skill の配布 | AI が自力でフローに乗る |
| 4 | `catalog/mobile/` と `adapter-mobile` の追加 | web の recipe に手を入れずに mobile が並列で載る |

## 10. 未決事項

- プレビューの持ち方: `preview.png` の手動管理か、Storybook / Ladle を入れて自動生成するか（初期は手動でも成立するが、カタログが増えると破綻する）
- カタログのバージョニング: recipe 単位で破壊的変更が起きたときに、既に導入済みのプロジェクトへどう伝えるか（`uikit diff` で足りるか）
- ダークモード対応をトークン層で必須にするか、recipe ごとの任意にするか
