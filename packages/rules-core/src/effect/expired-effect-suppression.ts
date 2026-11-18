import { getDynamicEffectSuppressionTargetIds } from "../legal/legal-actions-shared";
import type { CardDefinition, ContinuousEffect, GameState } from "../model";

/**
 * 期限切れになった effect_suppression CE が抑止していた source を集める。
 *
 * dynamic filter 型では、現在の CardFilter 一致だけでなく、抑止前に記録した
 * `suppressedSourceInstanceIds` も使う。対象自身の CE が実効カテゴリ等を変えて
 * filter 一致に寄与していた場合でも、失効直後に元の CE を再登録できる。
 */
export function collectExpiredEffectSuppressionSourceIds(
  stateBeforeExpiry: GameState,
  activeContinuousEffectsAfterExpiry: readonly ContinuousEffect[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): Set<string> {
  const sourceInstanceIds = new Set<string>();
  for (const effect of stateBeforeExpiry.activeContinuousEffects) {
    if (effect.modifierTag !== "effect_suppression") continue;
    if (
      activeContinuousEffectsAfterExpiry.some(
        (remaining) => remaining.effectId === effect.effectId
      )
    ) {
      continue;
    }
    if (effect.targetInstanceId) {
      sourceInstanceIds.add(effect.targetInstanceId);
      continue;
    }

    const historicalSourceIds = effect.metadata?.suppressedSourceInstanceIds;
    if (Array.isArray(historicalSourceIds)) {
      for (const sourceInstanceId of historicalSourceIds) {
        if (typeof sourceInstanceId === "string") {
          sourceInstanceIds.add(sourceInstanceId);
        }
      }
    }
    for (const sourceInstanceId of getDynamicEffectSuppressionTargetIds(
      stateBeforeExpiry,
      effect,
      getCardDefinitionById
    )) {
      sourceInstanceIds.add(sourceInstanceId);
    }
  }
  return sourceInstanceIds;
}
