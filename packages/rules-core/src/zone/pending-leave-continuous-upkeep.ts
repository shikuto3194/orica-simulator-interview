import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import { flushPendingLeaves } from "../state-based-actions";
import type { CardDefinition, GameState } from "../model";

type FlushPendingLeavesOptions = Parameters<typeof flushPendingLeaves>[4];

function hasCardContinuousEffectLifecycleTransition(
  beforeFlushState: GameState,
  afterFlushState: GameState
): boolean {
  const afterCardsById = new Map(
    afterFlushState.cardInstances.map((card) => [card.instanceId, card])
  );
  for (const beforeCard of beforeFlushState.cardInstances) {
    const afterCard = afterCardsById.get(beforeCard.instanceId);
    if (!afterCard || afterCard.zone !== beforeCard.zone) return true;
    if (
      beforeCard.pendingLeaveKind !== null &&
      afterCard.pendingLeaveKind === null
    ) {
      return true;
    }
    if (afterCard.zoneEnteredAtTurn !== beforeCard.zoneEnteredAtTurn) {
      return true;
    }
  }

  const beforeInstanceIds = new Set(
    beforeFlushState.cardInstances.map((card) => card.instanceId)
  );
  return afterFlushState.cardInstances.some(
    (card) => !beforeInstanceIds.has(card.instanceId)
  );
}

export function rebuildContinuousEffectsAfterPendingLeaveFlush(options: {
  beforeFlushState: GameState;
  afterFlushState: GameState;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  return !hasCardContinuousEffectLifecycleTransition(
    options.beforeFlushState,
    options.afterFlushState
  )
    ? options.afterFlushState
    : recomputeAndRebuildContinuousEffects(
        options.afterFlushState,
        options.getCardDefinitionById
      );
}

export function flushPendingLeavesAndRecomputeContinuousEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceColors?: Parameters<typeof flushPendingLeaves>[2],
  sourceCategory?: Parameters<typeof flushPendingLeaves>[3],
  options?: FlushPendingLeavesOptions
): GameState {
  const flushed = flushPendingLeaves(
    state,
    getCardDefinitionById,
    sourceColors,
    sourceCategory,
    options
  );
  return rebuildContinuousEffectsAfterPendingLeaveFlush({
    beforeFlushState: state,
    afterFlushState: flushed,
    getCardDefinitionById,
  });
}
