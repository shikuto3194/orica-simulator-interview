import type { GameState } from "../model";
import { collectTriggerEventsFromStateDelta } from "./trigger-system";
import { recordOperationObservationEvidence } from "./semantic-trigger-events";
import { captureCommittedSemanticEventFacts } from "./trigger-event-facts";
import { collectStoneRebirthCoreIncreases } from "../mechanics/grandstone-system";
import { canActivateNexusMechanicEffect } from "../mechanics/nexus-mechanic-suppression";
import {
  captureTriggerObservation,
  canObserveTrigger,
} from "./trigger-observation-sources";

/**
 * Native actions and pending-choice commits share the existing delta collector.
 * The caller supplies the board immediately before the completed operation and
 * records it before resuming later text; event creation/delivery remains separate.
 */
export function recordOperationTriggerObservations(
  options: Omit<
    Parameters<typeof collectTriggerEventsFromStateDelta>[0],
    "captureOperationObservations"
  >
): GameState {
  const afterState = options.getCardDefinitionById
    ? captureCommittedSemanticEventFacts(
        options.afterState,
        options.getCardDefinitionById,
        options.causedBySourceInstanceId ?? undefined
      )
    : options.afterState;
  const events = collectTriggerEventsFromStateDelta({
    ...options,
    afterState,
    captureOperationObservations: true,
  });
  // Independent stone cores intentionally do not emit the generic core-gain
  // event. Reuse the stone checker's fact detector for observation evidence only;
  // final existence/count still comes from that checker's enclosing net delta.
  if (options.getCardDefinitionById) {
    const increases = collectStoneRebirthCoreIncreases(
      options.beforeState,
      afterState,
      options.getCardDefinitionById
    );
    const observed = increases.length
      ? captureTriggerObservation(options.beforeState)
      : undefined;
    for (const { card } of increases) {
      const identity = observed!.sourceIdentities[card.instanceId];
      const canObserve =
        identity !== undefined &&
        canObserveTrigger(observed, card, afterState) &&
        canActivateNexusMechanicEffect(
          afterState,
          card.instanceId,
          "stone_rebirth",
          options.getCardDefinitionById
        );
      events.push({
        eventKind: "stone_rebirth",
        actingPlayerId: card.controllerPlayerId,
        relatedPlayerId: card.controllerPlayerId,
        relatedInstanceId: card.instanceId,
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        amount: null,
        observationSnapshot: {
          sourceIdentities: canObserve ? { [card.instanceId]: identity } : {},
          grantedEffectIds: [],
        },
      });
    }
  }
  return recordOperationObservationEvidence(
    options.beforeState,
    afterState,
    events
  );
}
