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
  constructor(id: string, available: string[]) {
    const hint = available.length > 0 ? `\n候補: ${available.slice(0, 10).join(", ")}` : "";
    super("RECIPE_NOT_FOUND", `recipe が見つからない: ${id}${hint}`);
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
