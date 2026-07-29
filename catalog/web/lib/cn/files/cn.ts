import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * クラス名を結合する。条件付きのクラス指定を clsx で畳み、競合する Tailwind の
 * ユーティリティを tailwind-merge で後勝ちに解決する。
 *
 * 後勝ちの解決が必要なのは、呼び出し側から className で上書きさせるため。
 * 単純な連結だと "px-4" と "px-2" が両方残り、どちらが効くかは CSS の
 * 出力順で決まってしまう (呼び出し側の指定が無視されることがある)。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
