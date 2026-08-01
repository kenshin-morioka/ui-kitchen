# web/primitives/button

ボタン。shadcn/ui の `button` と同じ API。

```bash
uikit add web/primitives/button
```

生成先は `ui-kitchen.json` の `paths.componentsDir` 配下の `button.tsx`。
`web/lib/cn`（と、その依存の `web/tokens/base`）も併せて生成される。

以下は既定設定 (`importAlias: "@/"`、`componentsDir: "src/components"`) の場合。
設定を変えている場合は `uikit add web/primitives/button --dry-run` が出す実際の
生成先に合わせる。

```tsx
import { Button } from "@/components/button";

<Button>保存</Button>
<Button variant="destructive">削除</Button>
<Button variant="outline" size="sm">キャンセル</Button>
<Button size="icon" aria-label="閉じる"><XIcon /></Button>
```

リンクをボタンの見た目にするときは `asChild`。

```tsx
<Button asChild>
  <Link to="/settings">設定</Link>
</Button>
```

## variant と size

| variant | 用途 |
| --- | --- |
| `default` | 主要な操作。1 画面に 1 つが目安 |
| `destructive` | 破壊的な操作（削除など） |
| `outline` | 副次的な操作。背景の上でも輪郭が出る |
| `secondary` | 副次的な操作。塗りが必要なとき |
| `ghost` | ツールバーなど、枠を出したくない場所 |
| `link` | 文中のリンクと同じ見た目にしたいとき |

size は `default` / `xs` / `sm` / `lg` と、正方形の `icon` / `icon-xs` / `icon-sm` / `icon-lg`。
`icon` 系は文字を持たないので `aria-label` を必ず付ける。

## 意図

`class-variance-authority` で variant を解決し、結果を `cn` に通す。`cn` が
`tailwind-merge` を使うので、`className` で渡した指定が variant の既定クラスを
後勝ちで上書きできる。

`asChild` は `radix-ui` の `Slot` を使う。`<a>` や `<Link>` を自前でスタイルすると
ボタンの見た目が 2 系統に分かれるので、見た目はこのコンポーネントに寄せる。

`data-slot="button"` / `data-variant` / `data-size` を出力している。親側から
`[&_[data-slot=button]]:…` の形でまとめて調整できるようにするため。

## 改変ポイント

**見た目を恒久的に変える** — `buttonVariants` の該当する文字列を直す。呼び出し側で
`className` を足して回るより、定義を 1 箇所直す。

**variant を増やす** — `variants.variant` にキーを足す。色は必ずトークン由来の
クラス（`bg-primary` など）で書く。`bg-[#3b82f6]` のような直書きはしない。

**size を増やす** — 高さ（`h-*` / `size-*`）と内側の余白、`has-[>svg]:px-*` を
併せて指定する。`has-[>svg]` はアイコンを含むときだけ余白を詰めるための指定。

## 注意

- `loading` 状態は持たない。無効化だけなら `disabled`、スピナーを出すなら
  `children` 側で描画する（`<Button disabled><Spinner />保存中</Button>`）
- `asChild` の子要素は 1 つだけ。複数渡すと実行時に落ちる
- `buttonVariants` を別の要素の `className` に貼ると `data-slot` などが付かない。
  ボタンの見た目が必要なら `asChild` を使う
