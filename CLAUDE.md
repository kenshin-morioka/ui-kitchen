# ui-kitchen 作業ルール

品質を確認済みの UI を recipe としてファイルで保管し、CLI で決定的にプロジェクトへコピーするためのリポジトリ。**生成に推論を介在させないことが唯一の存在理由**なので、決定性を崩す変更は入れない。

設計の全体像は [docs/design.md](docs/design.md)、次に着手するものは [docs/backlog.md](docs/backlog.md)。ここには作業のルールだけを書く。

作業を始めるときは backlog の一番上を 1 件だけ取る。終えたら backlog から該当節を消し、新たに分かったことを追記する。

## コミット

- **`user.email` を上書きしない。** リポジトリ / グローバル設定に既にある identity をそのまま使う。GitHub アカウントに紐付いていないアドレスでコミットすると、同名の別コントリビューターとして計上される
- **`Co-Authored-By:` トレーラーと `🤖 Generated with [Claude Code]` の行を付けない。** コントリビューターを汚さないため
- コミットメッセージは日本語。1 行目に要約、本文に「なぜそうしたか」を書く。何をしたかは diff を見れば分かる

## ブランチと PR

- `main` は保護されている。直接 push / マージは管理者含めて不可。**すべての変更は PR 経由**
- 作業開始時に必ずブランチを切る（`feat-*` / `fix-*` / `chore-*` / `docs-*` / `ci-*`）
- **UI アイテム 1 件 = 1 PR。** まとめない。レビューは「見た目を確認して合意する」行為なので、差分が大きいと機能しない
- 基盤の変更も責務単位で分ける（例: スキーマ / 依存解決 / CLI / CI をそれぞれ別 PR）
- PR 本文には **設計上の判断とその理由**、**動作確認の内容**を書く。ファイル一覧の羅列は要らない
- PR 作成時に作者が自動アサインされる。マージ後にブランチは自動削除される

## コミット前に必ず通すもの

```bash
pnpm lint          # Biome (packages/)
pnpm lint:catalog  # Biome (catalog/ の ts/tsx/css)
pnpm typecheck     # tsc --noEmit
pnpm test          # bun test
pnpm catalog:validate  # recipe.yaml のスキーマ検証 + catalog.json の鮮度
```

`pnpm fix` で Biome の自動修正。ツールチェインは mise で固定（node / pnpm / bun / actionlint）。`mise install` してから作業する。

CI は変更パスからスタック別ジョブを選び、集約ジョブ `ci` に結果をまとめる。**必須チェックは `ci` だけ**。パス判定でスキップされたジョブを必須指定すると PR が永久にブロックされるため。

## 構成

| ディレクトリ | 責務 |
| --- | --- |
| `packages/core` | recipe のスキーマ・依存解決・テンプレート展開・生成計画。**プラットフォーム非依存**（web / mobile を知らない） |
| `packages/adapter-web` | web 固有の処理（npm 依存の検出、プロジェクト構成の推測） |
| `packages/registry` | `catalog.json` の生成と CI 用の検証 |
| `packages/cli` | `uikit` コマンド |
| `catalog/<platform>/<kind-dir>/<name>/` | recipe の実体 |

- プラットフォーム固有の処理は `adapter-<platform>` に閉じる。`core` に web の知識を持ち込まない（mobile を後から足せる形を維持する）
- recipe ID は `<platform>/<kind-dir>/<name>`。kind ディレクトリは `tokens` / `lib` / `primitives` / `components` / `blocks` / `layouts` / `pages`
- カタログ全体の総称は **recipe**。`component` は kind の一種にすぎないので総称に使わない

## recipe を書くときのルール

```text
catalog/web/primitives/button/
├── recipe.yaml   # メタデータ（唯一の正本）
├── files/        # 生成されるソースの実体
└── README.md     # 使い方・意図・改変ポイント
```

- **テンプレート変数は `{{@componentsDir}}` の形式。`@` を必ず付ける。** `@` 無しだと JSX の `style={{ color: "red" }}` や `animate={{opacity}}` を変数参照と誤認して展開が壊れる
- 使える変数は `componentsDir` / `hooksDir` / `libDir` / `stylesDir` / `importAlias` のみ。増やすときは `TEMPLATE_VARIABLES` に追加する
- variant の条件ブロックは**独立した行**に書く。ネスト不可

```tsx
// {{#if variant.with-loading}}
if (loading) return <Spinner />;
// {{/if}}
```

- 色・余白・角丸は必ず `web/tokens/base` 由来のクラスを使う（`bg-primary` など）。個別に直書きしない
- `requires` で依存 recipe を宣言する。npm 依存は `dependencies` に書く（CLI は install せず提示するだけ）
- `ai:` セクションの `use_when` / `do_not` / `integration` は AI が読む前提の指示。省略しない
- recipe を追加・変更したら `pnpm catalog:build` で `catalog.json` を再生成してコミットする（CI が鮮度を検証する）

## 崩してはいけない不変条件

1. **生成に LLM を介在させない。** 生成処理はスキーマ検証・テンプレート変数の置換・ファイル IO のみ。任意の式を評価しない
2. **`add` は冪等。** 同じ recipe / variant / 設定なら常にバイト単位で同じ出力
3. **conflict が 1 件でもあれば何も書かない。** 部分適用は「新しいファイルが古いファイルを参照する」壊れた状態を作る
4. **`catalog.json` に揺れる値を入れない。** タイムスタンプ禁止、並び順はロケール非依存（`localeCompare` を使わない）
5. **プロジェクト外に書き込まない。** 出力先は realpath で検証する（symlink 経由の脱出を防ぐ）
6. **npm 依存を自動 install しない。** ロックファイルを勝手に触らせない
7. **variant は recipe スコープ。** グローバル適用すると依存 recipe の出力が意図せず変わり、共有ファイルが永久に conflict になる

## 言語

- コード内コメント・コミットメッセージ・PR 本文・`docs/` は日本語
- `README.md` は英語、`README.ja.md` が日本語。両方の先頭に言語切り替えリンクを置く。**片方だけ更新しない**
- 用途は「個人開発全般」。OSS 限定の書き方をしない

## 実装で気をつける点（過去に踏んだもの）

- シェルで変更判定するとき `echo "$x" | grep -q` は使わない。`grep -q` の早期終了で `echo` が SIGPIPE で死に、`pipefail` によって**マッチしたのに false** になる。here-string (`grep -q ... <<<"$x"`) を使う
- パス検証で `..` を弾くときは `/` と `\` の両方を区切りとして扱う。Windows のパスがすり抜ける
- 改行コードは CRLF も来る。行単位の正規表現には `\r?` を許容する
- ファイル操作の失敗は `ENOENT` 以外も起きる（EISDIR / ENOTDIR / EACCES）。生の例外を投げずに `UiKitchenError` 系に包む。CLI は想定内エラーをスタックトレースなしで出す
- `JSON.parse` で他プロジェクトの `tsconfig.json` を読むときは失敗する前提で書く（コメント・末尾カンマ入りが普通）。黙って既定値にフォールバックしない
