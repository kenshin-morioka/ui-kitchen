/** 想定内のエラー。CLI はこれをスタックトレースなしで表示する。 */
export class UiKitchenError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    // サブクラスでも実際のクラス名が出るようにする。
    this.name = new.target.name;
    this.code = code;
  }
}

export class RecipeValidationError extends UiKitchenError {
  constructor(message: string) {
    super("RECIPE_INVALID", message);
  }
}

export class UnknownRecipeError extends UiKitchenError {
  /** requiredBy を渡すと、どの recipe の requires を直すべきか分かる。 */
  constructor(id: string, available: string[], requiredBy?: string) {
    const hint = available.length > 0 ? `\n候補: ${available.slice(0, 10).join(", ")}` : "";
    const origin = requiredBy ? ` (${requiredBy} の requires が参照している)` : "";
    super("RECIPE_NOT_FOUND", `recipe が見つからない: ${id}${origin}${hint}`);
  }
}

/** カタログのディレクトリ自体が無い。UI_KITCHEN_CATALOG の誤指定が典型。 */
export class CatalogNotFoundError extends UiKitchenError {
  constructor(root: string) {
    super("CATALOG_NOT_FOUND", `カタログが見つからない: ${root}\nUI_KITCHEN_CATALOG で場所を指定できる。`);
  }
}

/** 生成先ファイルの読み書きに失敗した。ENOENT 以外を包んで理由を出すため。 */
export class FileSystemError extends UiKitchenError {
  constructor(message: string) {
    super("FILESYSTEM_ERROR", message);
  }
}

/** conflict などで生成を中止した。どのファイルが原因かを保持する。 */
export class ApplyBlockedError extends UiKitchenError {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    super(
      "APPLY_BLOCKED",
      `内容の異なる既存ファイルがあるため何も書き込まなかった:\n${conflicts
        .map((path) => `  ${path}`)
        .join("\n")}\n上書きするなら --force を付ける。`,
    );
    this.conflicts = conflicts;
  }
}

export class CircularDependencyError extends UiKitchenError {
  constructor(path: string[]) {
    super("RECIPE_CIRCULAR", `recipe の依存が循環している: ${path.join(" -> ")}`);
  }
}

export class TemplateError extends UiKitchenError {
  constructor(message: string) {
    super("TEMPLATE_INVALID", message);
  }
}

export class StackMismatchError extends UiKitchenError {
  constructor(recipeId: string, field: string, expected: string, actual: string) {
    super(
      "STACK_MISMATCH",
      `${recipeId} は ${field}=${expected} を前提にしているが、プロジェクトは ${field}=${actual}`,
    );
  }
}

export class ConfigError extends UiKitchenError {
  constructor(message: string, code = "CONFIG_INVALID") {
    super(code, message);
  }
}

/** 設定ファイルが存在しない。上方向探索の継続条件として使う。 */
export class ConfigNotFoundError extends ConfigError {
  constructor(message: string) {
    super(message, "CONFIG_NOT_FOUND");
  }
}

/** 設定ファイルが既にある。排他的作成が EEXIST で失敗したときに使う。 */
export class ConfigExistsError extends ConfigError {
  constructor(path: string) {
    super(
      `${path} は既に存在する。作り直すなら --force を付ける (推測値で上書きされるので手で直した内容は失われる)。`,
      "CONFIG_EXISTS",
    );
  }
}
