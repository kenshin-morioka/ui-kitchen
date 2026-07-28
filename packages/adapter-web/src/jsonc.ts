import { ConfigError } from "@ui-kitchen/core";

/**
 * JSONC (コメントと末尾カンマを許す JSON) を読む。
 *
 * tsconfig.json / jsconfig.json は Vite や Next.js の生成物が既定でコメント入りなので、
 * 素の JSON.parse では実プロジェクトのほとんどで失敗する。外部依存を増やさないため、
 * 「コメントを取る」「末尾カンマを取る」の 2 段だけを自前で行い、あとは JSON.parse に任せる。
 * TypeScript 本体の解釈 (単一引用符など) までは追わない。tsc が受け付けない書き方は
 * プロジェクト側で既に壊れているため。
 */
export function parseJsonc(source: string, path: string): unknown {
  try {
    return JSON.parse(stripTrailingCommas(stripComments(source)));
  } catch (cause) {
    throw new ConfigError(
      `${path} を JSON として読めない: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * `//` と `/* *\/` を空白に置き換える。
 * 文字列リテラルの中は素通しする。`"https://example.com"` の `//` を
 * コメントとして削ると値が壊れて JSON.parse も通ってしまい、静かに誤読する。
 */
function stripComments(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    if (char === '"') {
      const end = endOfString(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index++;
      // 閉じられていないブロックコメントでも index が末尾を超えるだけで済む。
      index += 2;
      continue;
    }

    out += char;
    index++;
  }

  return out;
}

/** `}` / `]` の直前のカンマを落とす。コメント除去後に走らせる前提。 */
function stripTrailingCommas(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    if (char === '"') {
      const end = endOfString(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < source.length && /\s/.test(source[lookahead] as string)) lookahead++;
      const next = source[lookahead];
      if (next === "}" || next === "]") {
        // カンマだけ捨てて空白は残す。行番号を保ってエラー位置を狂わせないため。
        index++;
        continue;
      }
    }

    out += char;
    index++;
  }

  return out;
}

/** `source[start]` の `"` から始まる文字列リテラルの終端 (閉じ引用符の次) を返す。 */
function endOfString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    // エスケープは 2 文字まとめて飛ばす。`"\\"` の閉じ引用符を見落とさないため。
    if (char === "\\") {
      index += 2;
      continue;
    }
    index++;
    if (char === '"') break;
  }
  return index;
}
