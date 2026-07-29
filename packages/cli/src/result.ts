export interface CommandResult {
  /** 人間向けの出力 (行単位)。 */
  lines: string[];
  /** --json 指定時に出力する構造。 */
  data: unknown;
  /**
   * エラーではないが「そのままでは適用できない」状態。終了コード 1 になる。
   * dry-run の結果を終了コードだけで判定する呼び出し側のために必要。
   */
  blocked?: boolean;
}
