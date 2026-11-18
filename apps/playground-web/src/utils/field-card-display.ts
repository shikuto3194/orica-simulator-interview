import {
  getActAsSpiritMetadata,
  getEffectiveCategory,
  isCardTextCardState,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";
import { resolveContinuationEffect } from "../../../../packages/rules-core/src/legal/pending-action-handlers";
import { isBattleCapableCategory } from "../../../../packages/rules-core/src/battle/battle-shared";

/** コア配分の直後に分身になるカードは、配分中から同じ列で個別に操作する。 */
function isPendingSpiritPlacement(
  state: GameState,
  card: CardInstance,
  getDefinition: (id: string) => CardDefinition | undefined
): boolean {
  const pending = state.pendingCoreDistribution;
  const continuation = pending?.continuation;
  if (
    !card.faceDown ||
    !continuation ||
    !pending.candidates.some((c) => c.instanceId === card.instanceId)
  )
    return false;
  const effect = resolveContinuationEffect(
    getDefinition(continuation.sourceDefinitionId),
    continuation
  );
  const action = effect?.steps[continuation.resumeStepIndex]?.action;
  return (
    action?.kind === "register_act_as_spirit" &&
    action.target.kind === "ref" &&
    (continuation.stepContext.results[
      action.target.stepId
    ]?.affectedCardInstanceIds.includes(card.instanceId) ??
      false)
  );
}

/** Shared by the board and its browser: every standalone field card has one home. */
export function fieldCardDisplayKind(
  state: GameState,
  card: CardInstance,
  getDefinition: (id: string) => CardDefinition | undefined
): "spirit" | "nexus" | "card" | null {
  if (card.zone !== "field" || card.attachedToInstanceId !== null) return null;
  if (
    state.cardInstances.some((host) =>
      host.underCards?.some((entry) => entry.cardInstanceId === card.instanceId)
    )
  )
    return null;
  const soul = state.players.some((p) =>
    p.soulStateInstanceIds.includes(card.instanceId)
  );
  if (!soul && isCardTextCardState(card, state))
    return isPendingSpiritPlacement(state, card, getDefinition)
      ? "spirit"
      : "card";
  const definition = getDefinition(card.definitionId);
  // 転神・転者はネクサスとしての性質も残すが、盤面では戦闘可能な列へ置く。
  if (!soul && definition && isBattleCapableCategory(definition, card, state)) {
    return "spirit";
  }
  const role = soul
    ? (definition?.printedCategory ?? card.zoneRoleName)
    : definition
      ? getEffectiveCategory(state, card, definition, true)
      : getActAsSpiritMetadata(state, card.instanceId)
        ? "spirit"
        : card.zoneRoleName;
  if (role === "nexus") return "nexus";
  if (
    soul ||
    role === "spirit" ||
    role === "ultimate" ||
    role === "brave" ||
    role === "quartz"
  )
    return "spirit";
  return "card";
}
