[English](README.md) | [日本語](README.ja.md)

# ui-kitchen

再利用可能な UI recipe のカタログと、それをプロジェクトへ決定的にコピーする CLI。

UI を毎回 AI に書かせると、結果は毎回変わる。完璧なこともあれば、存在しない API を使うこともあり、プロジェクト間で統一感も出ない。ui-kitchen は、品質を確認済みの UI を**ファイル**として保存し、AI の役割を「UI を書く」から「recipe を選んで CLI を叩く」に縮小することで、この揺れを取り除く。

```bash
uikit list --kind block --tag auth   # カタログを検索する
uikit show web/blocks/auth-card      # メタ情報・生成されるファイル・使い方を確認する
uikit add web/blocks/auth-card       # 依存ごと生成する
```

同じ recipe からは常にバイト単位で同じ出力が得られる。生成にモデルは一切関与せず、処理はスキーマ検証・テンプレート変数の置換・ファイル IO だけ。

## 何のために

- **統一感** — どのプロジェクトも同じトークン・同じコンポーネントを使う
- **決定的** — `add` は冪等。`--dry-run` で書き込み前に計画を確認できる
- **確認は一度だけ** — 品質を見るのは recipe を作るときで、生成のたびではない
- **自分のコードになる** — recipe はプロジェクトにコピーされる (shadcn/ui と同じ思想)。取り込んだ後に手を入れてよい

## 状態

製作中。エンジン、CLI (`init` / `list` / `show` / `add`)、カタログの土台 (`web/tokens/base`、`web/lib/cn`) まで入っている。primitive は 1 recipe ずつ PR で追加していく。このリポジトリ内では `pnpm uikit <command>` で動かせる (パッケージとしては未公開)。

## 必要なもの

ツールチェイン (Node, pnpm, Bun) は `mise.toml` に固定してある。

```bash
mise install
pnpm install
```

## 使い方

```bash
# UI を追加したいプロジェクト側で実行する
uikit init                                  # ui-kitchen.json を作成する (出力先・エイリアス・スタック)
uikit list --json                           # 機械可読なカタログ。AI が使うのはこちら
uikit show web/tokens/base
uikit add web/tokens/base web/lib/cn        # 必要な recipe を再帰的に解決する
uikit add web/primitives/button --dry-run   # 書き込まずに計画だけ見る
```

補足:

- npm 依存は自動 install しない。不足があれば実行すべきコマンドを提示する
- 内容が異なる既存ファイルは `conflict` として報告し、`--force` が無ければ触らない
- `UI_KITCHEN_CATALOG=<path>` で参照するカタログを差し替えられる

## スタック

recipe は React + TypeScript + Tailwind CSS + shadcn/ui。CLI は TypeScript (Bun 実行) を pnpm workspace で管理している。

カタログはプラットフォーム単位 (`catalog/web/…`) に分かれ、エンジン側はプラットフォームを知らない。既存 recipe に手を入れずにモバイルを後から追加できる。

## ドキュメント

- [docs/design.md](docs/design.md) — 設計ドキュメント: データモデル、CLI の全体像、ロードマップ

