import { isChainAtOrUnder, requireTriggerChainId } from "../chain-id";
import { hasOutstandingEffectResolutionContinuation } from "../state-based-actions";
import {
  createEffectActivationTriggerEvent,
  flushPendingLeavesAndQueueReactions,
  queuePendingReactionsFromTriggerEvents,
} from "./trigger-system";
import type { GameState, CardDefinition } from "../model";
import type {
  TriggeredEffectActionRegistrationLookup,
  BurstActionRegistrationLookup,
} from "./trigger-system";

/** 通常バーストはQ411/Q7734により待たない。内側の発揮後は先に閉じる。 */
export function flushReadyEffectCompletions(
  state: GameState,
  options: {
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions?:
      | TriggeredEffectActionRegistrationLookup
      | undefined;
    getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
  }
): GameState {
  const pending = state.pendingEffectCompletions ?? [];
  if (!pending.length) return state;
  if (
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.activeAttack?.flashWindowState?.pendingStackAction != null ||
    state.pendingSoulStateReplacement !== null ||
    state.pendingBraveLeaveChoice !== null ||
    hasOutstandingEffectResolutionContinuation({
      ...state,
      pendingAfterTriggersContinuations: [],
      pendingStackCascade: null,
    })
  )
    return state;
  const index = pending.findLastIndex((completion) => {
    const matches = (chain: string | null | undefined) =>
      completion.chainId == null ||
      (chain != null && isChainAtOrUnder(chain, completion.chainId));
    return (
      !state.pendingTriggeredEffects.some((p) => matches(p.chainId)) &&
      !state.pendingDeferredTriggeredEffects.some((p) => matches(p.chainId)) &&
      !state.pendingPrivateDeclarations.some((p) => matches(p.chainId)) &&
      !state.battleImmediateEffects.some((p) => matches(p.causedByChainId)) &&
      !state.pendingAfterTriggersContinuations.some((p) =>
        matches(p.chainId ?? p.continuationId)
      ) &&
      !pending.some(
        (p) =>
          p !== completion &&
          p.chainId !== completion.chainId &&
          matches(p.chainId)
      ) &&
      !state.pendingLeaveEntities.some(
        (p) => !p.deferZoneMoveUntilChainEnd && matches(p.chainId)
      )
    );
  });
  if (index < 0) return state;
  const completion = pending[index]!;
  const next = {
    ...state,
    pendingEffectCompletions: pending.filter((_, i) => i !== index),
  };
  const event = createEffectActivationTriggerEvent({
    ...completion,
    chainId: requireTriggerChainId(completion.chainId),
    state: next,
    eventKind: "effect_completed",
    relatedInstanceId: completion.triggerCardInstanceId,
  });
  const afterReactions = queuePendingReactionsFromTriggerEvents(
    next,
    [event],
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
  // 完了通知そのものがコスト消滅の flush blocker になっている。
  // 通知から派生した効果を先に収集し、共通 gate でチェーン閉鎖を再判定する。
  // 離脱誘発 (reactionChainIds) を持たないカードもこの境界で実移動する。
  return flushPendingLeavesAndQueueReactions({
    beforeFlushState: afterReactions,
    chainId: completion.chainId ?? "effect-completion",
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}
