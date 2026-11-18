export type EffectSourceKind =
  | "magic"
  | "spirit"
  | "ultimate"
  | "nexus"
  | "system";

export type FieldEffectSourceKind = Extract<
  EffectSourceKind,
  "spirit" | "nexus" | "magic" | "system"
>;

export type BattleImmediateEffectSourceKind = Extract<
  EffectSourceKind,
  "spirit" | "ultimate" | "system"
>;

export type NormalEffectSourceKind = Extract<
  EffectSourceKind,
  "spirit" | "nexus" | "magic"
>;

/**
 * カード category が効果登録の sourceKind と両立するか判定する。
 *
 * ブレイヴ / アルティメットはスピリット状態として "spirit" 系効果のソースになれる
 * (公式: ブレイヴ召喚はスピリット召喚ではないが、スピリット状態のブレイヴは
 *  独立スピリットのように扱われ自身の効果を発揮する)。battle 効果ではアルティメットは
 * "ultimate" として区別される。
 *
 * この判定は registration sourceKind を生成する `getXxxSourceKindForCategory` 群
 * (structured-effect-registrations.ts) と整合する。`printedCategory === sourceKind`
 * の素朴な比較ではブレイヴ (printedCategory="brave") / アルティメット
 * (printedCategory="ultimate") の "spirit" 登録が誤って弾かれていた。
 *
 * model.ts が source-kinds.ts を import するため、循環回避で category 型はここで定義する。
 */
type PrintedCategoryForSourceKind =
  | "spirit"
  | "brave"
  | "ultimate"
  | "nexus"
  | "magic";

export function isCategoryCompatibleWithSourceKind(
  category: PrintedCategoryForSourceKind,
  sourceKind: EffectSourceKind
): boolean {
  switch (sourceKind) {
    case "system":
      return true;
    case "spirit":
      return (
        category === "spirit" || category === "brave" || category === "ultimate"
      );
    case "ultimate":
      return category === "ultimate";
    case "nexus":
      return category === "nexus";
    case "magic":
      return category === "magic";
  }
}

/** registration 互換用 category→sourceKind 写像。 */
export function getEffectRegistrationSourceKindForPrintedCategory(
  category: PrintedCategoryForSourceKind
): NormalEffectSourceKind {
  switch (category) {
    case "spirit":
    case "brave":
    case "ultimate":
      return "spirit";
    case "nexus":
      return "nexus";
    case "magic":
      return "magic";
  }
}

/** suppression descriptor 用 category→sourceKind 写像。 */
export function getEffectDescriptorSourceKindForPrintedCategory(
  category: PrintedCategoryForSourceKind
): EffectSourceKind {
  switch (category) {
    case "spirit":
    case "brave":
      return "spirit";
    case "ultimate":
      return "ultimate";
    case "nexus":
      return "nexus";
    case "magic":
      return "magic";
  }
}
