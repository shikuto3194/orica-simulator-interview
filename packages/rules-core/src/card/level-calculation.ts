import type { LevelDefinition } from "../model";

/** 印字Lv条件とLvコスト修飾から算出する共通処理（表示・効果条件・離脱前記録）。 */
export function calculateLevelFromResources(
  levelDefs: readonly LevelDefinition[],
  totalCores: number,
  countValue = 0,
  levelCostDelta = 0,
  levelCostOverride?: { lv1?: number; lv2?: number; lv3?: number }
): number {
  const overrides: Record<number, number | undefined> = {
    1: levelCostOverride?.lv1,
    2: levelCostOverride?.lv2,
    3: levelCostOverride?.lv3,
  };
  let level = 0;
  for (const ld of levelDefs) {
    // Q637: 契約創界神のC条件は上のコア数を参照しない。コアのLvコスト変更とも別。
    const reached =
      ld.requiredCount !== undefined
        ? countValue >= ld.requiredCount
        : totalCores >=
          Math.max(
            0,
            (overrides[ld.level] ?? ld.requiredCores) + levelCostDelta
          );
    if (reached) level = Math.max(level, ld.level);
  }
  return level;
}
