# ui-kitchen

個人開発向けの UI テンプレート / コンポーネントカタログと、それを決定的に取り込む CLI。

## これは何のためのものか

UI を毎回 AI に推論で書かせると、品質・統一感が安定しない。ui-kitchen は一度品質を確認した UI をファイルとして保存し、以降は **推論ではなくコピー操作** で再利用する。

```bash
uikit list --kind block --tag auth   # カタログを検索
uikit show web/blocks/auth-card      # 中身と使い方を確認
uikit add web/blocks/auth-card       # 依存ごと決定的に生成
```

AI の役割は「UI を書く」ではなく「カタログから選んで CLI を叩く」に縮小される。

## 状態

Phase 0（設計中）。設計は [docs/design.md](docs/design.md) を参照。

## スタック

React + TypeScript + Tailwind CSS + shadcn/ui / CLI は TypeScript（Bun 実行、pnpm workspace）。

Web フロントから開始し、`catalog/mobile/` を後から追加できる構成にしている。
