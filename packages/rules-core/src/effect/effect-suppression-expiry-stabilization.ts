import { recomputeBattleEntityBp } from "../battle/battle-shared";
import type { CardDefinition, GameState } from "../model";
import { runStateBasedActions } from "../state-based-actions";
import { recomputeAndRebuildContinuousEffectsForSources } from "./continuous-effect-rebuild";

/**
 * 期限切れの effect_suppression によって再び有効になる source を安定化する。
 *
 * 再登録だけでは、抑止中に許されていた行為が制約復帰後に不正になっても盤面に
 * 残ってしまう。復帰 CE の再構築・battle entity 再計算・状態ベース処理を同じ
 * 安定点にまとめる。Q24907 の「合体不可」復帰時の強制分離が代表例である。
 */
export function stabilizeSourcesReleasedByEffectSuppressionExpiry(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  sourceInstanceIds: ReadonlySet<string>
): GameState {
  if (sourceInstanceIds.size === 0) return state;

  let stabilized = recomputeAndRebuildContinuousEffectsForSources(
    state,
    getCardDefinitionById,
    sourceInstanceIds
  );
  stabilized = recomputeBattleEntityBp(stabilized, getCardDefinitionById);
  stabilized = runStateBasedActions(stabilized, getCardDefinitionById).state;
  return recomputeBattleEntityBp(stabilized, getCardDefinitionById);
}
