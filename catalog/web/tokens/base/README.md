# web/tokens/base

色と角丸のデザイントークン。カタログのすべての recipe がこれを前提にしている。

```bash
uikit add web/tokens/base
```

生成先は `<stylesDir>/tokens.css`。アプリのエントリから読み込む。

```ts
import "@/styles/tokens.css";
```

## 意図

CSS 変数名を shadcn/ui と一致させている。外から持ち込んだ shadcn のコード
（`bg-primary`、`text-muted-foreground`、`border-input` などを使うもの）が、
インポート先を直すだけで動く状態を保つのが目的。

`@theme inline` で変数を Tailwind のユーティリティに結び付けているので、
`bg-primary` のようなクラスがそのまま使える。

## 改変ポイント

**テーマの色を変える** — `:root` と `.dark` の値だけを差し替える。`@theme inline` の
対応付けは触らない。変数名を変えると shadcn 由来のコードが壊れる。

**角丸の大きさを変える** — `--radius` の 1 箇所だけを変える。`sm` 〜 `4xl` はすべて
`--radius` からの倍率なので、スケール全体が比例して動く。

個別の段だけを固定値にすると、`--radius` を変えたときに大小が逆転する。
（例: `xl` だけ `1.75rem` 固定にして `--radius: 1.5rem` にすると、
`2xl` = `2.7rem` との関係は保たれるが `lg` = `1.5rem` との差が詰まって潰れる。）
`xs` は shadcn には無いが、Tailwind 既定の `0.125rem` を残すと小さい `--radius` で
`sm` を追い越すため、こちらでも倍率に揃えている。

**ダークモードの切り替え方** — `@custom-variant dark (&:is(.dark *))` により、
`dark:` はルート要素の `.dark` クラスで切り替わる。OS の設定に追従させたい場合は、
`prefers-color-scheme` を見て `.dark` を付け外しする処理をアプリ側に置く
（この CSS を書き換えるのではなく）。

## 注意

- `--destructive-foreground` は**定義していない**。shadcn 現行版もこのトークンを
  削除し、destructive な面の文字色は `text-white` を直書きしている。同じ方針に揃えた
- `@import "tailwindcss"` をこのファイルが持つ。Tailwind を読み込むエントリを
  他に作らないこと（同じユーティリティが二重に出力される）
- monorepo でアプリの外にコンポーネントを置く場合、Tailwind のソース検出は
  この CSS の位置を起点にするため `@source` の追加が必要
