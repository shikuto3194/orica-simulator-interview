import type { CardDefinition, GameState } from "../model";
import {
  applyPendingStepChoiceAction,
  resolveContinuationEffect,
} from "../legal/pending-action-handlers";
import {
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "./structured-effect-registrations";

/** 現行定義が source union に統合済みの、旧セーブの未実行分岐を再開する。 */
export function restoreUnifiedSourceChoice(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingStepChoice;
  if (
    !pending ||
    pending.paidEffectModifierChoice ||
    pending.continuation.resumeEffectOverride
  )
    return state;
  const definition = getCardDefinitionById(pending.sourceDefinitionId);
  const effect = resolveContinuationEffect(definition, pending.continuation);
  const step = effect?.steps[pending.stepIndex];
  if (!step || step.choice?.length) return state;
  const action = step.action;
  if (
    !(
      (action.kind === "core_move" && action.from.kind === "union") ||
      (action.kind === "summon" &&
        action.target.kind === "from_zone" &&
        action.target.includeSoulState === true)
    )
  )
    return state;
  // 定義参照の lookup を復元し、通常の continuation/cascade を共有する。
  // 選択済みカード・コスト・usage は巻き戻さず、未実行 step のみ現行定義で再開する。
  const ids = new Set([
    ...state.cardInstances.map((c) => c.definitionId),
    pending.sourceDefinitionId,
  ]);
  const definitions = [...ids]
    .map(getCardDefinitionById)
    .filter((d): d is CardDefinition => d !== undefined);
  const restored = applyPendingStepChoiceAction({
    state: {
      ...state,
      pendingStepChoice: {
        ...pending,
        choices: [{ choiceIndex: 0, label: "source union migration" }],
      },
    },
    action: {
      kind: "resolve_pending_step_choice",
      actionId: `restore:${pending.pendingId}`,
      can: true,
      reason: "restore_unified_source_choice",
      actingPlayerId: pending.choosingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      choiceLabel: "source union migration",
      effectIndex: pending.effectIndex,
      stepIndex: pending.stepIndex,
      choiceIndex: 0,
    },
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
  }).state;
  return {
    ...restored,
    log: [
      ...restored.log,
      `snapshot:restored-source-union:${pending.pendingId}`,
    ],
  };
}
