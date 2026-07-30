# web/lib/cn

クラス名を結合するユーティリティ。

```bash
uikit add web/lib/cn
```

生成先は `ui-kitchen.json` の `paths.libDir` 配下の `cn.ts`、import のパスは
`importAlias` + `libDir` で決まる。`web/tokens/base` を requires しているので、
依存も併せて生成される。

以下は既定設定 (`importAlias: "@/"`、`libDir: "src/lib"`) の場合。設定を変えている
場合は `uikit add web/lib/cn --dry-run` が出す実際の生成先に合わせる。

```tsx
import { cn } from "@/lib/cn";

<button className={cn("px-4 py-2 bg-primary", className)} />;
```

## 意図

`clsx` で条件付きのクラス指定を畳み、`tailwind-merge` で競合する Tailwind の
ユーティリティを後勝ちにする。

後勝ちの解決が必要なのは、呼び出し側から `className` で上書きさせるため。
単純に連結すると `px-4` と `px-2` が両方残り、どちらが効くかは CSS の出力順で
決まる。結果として呼び出し側の指定が無視されることがある。

## 出力先を lib/utils.ts にしていない理由

shadcn は `lib/utils.ts` に `cn` を置く。同じファイルに書き込むと、
`shadcn init` 済みのプロジェクトでは内容が一致しない限り必ず `conflict` になり、
`uikit add` が 1 件も通らなくなる（conflict が 1 件でもあれば何も書き込まないため）。
共有ファイルを取り合わないよう別名にしている。

外から持ってきた shadcn のコードは `@/lib/utils` から `cn` を import しているので、
どちらかを選ぶ:

- そのコードの import 先を `@/lib/cn` に向ける
- `lib/utils.ts` に `export { cn } from "./cn";` を書いて実装を 1 つに寄せる

## 改変ポイント

`tailwind-merge` の設定を足したい場合（独自のユーティリティ接頭辞を認識させる等）は
`extendTailwindMerge` に差し替える。`cn` のシグネチャは変えない。
カタログの primitive がすべてこの形で呼んでいる。
