import { hasPendingLeaveResolutionChoice } from "../pending-state-guards";
import {
  getAvailableTriggeredEffectSourceChoices,
  getAvailableBurstSourceChoices,
} from "../effect/trigger-system";
import type {
  TriggeredEffectActionRegistrationLookup,
  BurstActionRegistrationLookup,
} from "../effect/trigger-system";
import type { CardDefinition, GameState } from "../model";
import { hasOutstandingEffectResolutionContinuation } from "../state-based-actions";
import { getTriggeredMechanicActivationState } from "../effect/triggered-mechanic-eligibility";

export function hasResolvablePendingBurst(state: GameState): boolean {
  return state.pendingBurstChecks.some(
    (pending) =>
      state.revealedBurstStates.some(
        (revealed) => revealed.checkId === pending.checkId
      ) ||
      state.setBurstStates.some(
        (setBurst) => setBurst.playerId === pending.actingPlayerId
      )
  );
}

/** ライフ減少・破壊・離脱などの誘発と、その解決中の選択/バーストを先に完了する。 */
export function hasPendingBattleEndEntryReactions(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup = () => [],
  getRegisteredBurstActions: BurstActionRegistrationLookup = () => []
): boolean {
  return (
    state.battleImmediateEffects.length > 0 ||
    hasPendingLeaveResolutionChoice(state) ||
    hasResolvablePendingBurst(state) ||
    state.pendingBurstChecks.some(
      (pendingBurstCheck) =>
        getAvailableBurstSourceChoices({
          state,
          pendingBurstCheck,
          getCardDefinitionById,
          getRegisteredBurstActions,
        }).length > 0
    ) ||
    state.pendingTriggeredEffects.some(
      (pendingEffect) =>
        pendingEffect.declaredFromPrivateZone === true ||
        (pendingEffect.mechanic
          ? getTriggeredMechanicActivationState(
              state,
              pendingEffect.mechanic,
              getCardDefinitionById
            ).canActivate
          : getAvailableTriggeredEffectSourceChoices({
              state,
              pendingEffect,
              getCardDefinitionById,
              getRegisteredTriggeredEffectActions,
            }).length > 0)
    ) ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.pendingPrivateDeclarations.length > 0 ||
    hasOutstandingEffectResolutionContinuation(state) ||
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.activeAttack?.flashWindowState?.pendingStackAction != null
  );
}
