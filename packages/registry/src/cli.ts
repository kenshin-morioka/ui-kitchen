import { UiKitchenError } from "@ui-kitchen/core";

/**
 * 想定内エラー (UiKitchenError) を `error[CODE] message` の 1 行で出し、終了コード 1 にする。
 * 想定外の例外は原因の特定にスタックトレースが必要なのでそのまま投げる。
 */
export async function runCommand(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof UiKitchenError)) throw error;
    console.error(`error[${error.code}] ${error.message}`);
    // process.exit(1) だと stderr がパイプのとき書き込みが flush されず、
    // CI ログから原因メッセージだけが消える。自然終了に任せる。
    process.exitCode = 1;
  }
}
