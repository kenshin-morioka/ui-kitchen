import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * ui-kitchen: web/lib/cn
 * 条件付きのクラス合成 (clsx) と、競合する Tailwind ユーティリティの
 * 後勝ち解決 (tailwind-merge) をまとめて行う。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
