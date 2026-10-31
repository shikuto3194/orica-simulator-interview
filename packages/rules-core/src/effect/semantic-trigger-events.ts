import type {
  CardDefinition,
  GameState,
  SupplementalTriggerEvent,
  Zone,
} from "../model";

/** Operation-owned facts. Display logs and zone/attachment deltas never create these events. */
export function recordSemanticTriggerEvent(
  state: GameState,
  event: Pick<SupplementalTriggerEvent, "eventKind" | "relatedInstanceId"> & {
    fromZone?: Zone;
    triggerRelatedCombinedHostInstanceId?: string;
    cause?: NonNullable<SupplementalTriggerEvent["cause"]>;
  }
): GameState {
  const card = state.cardInstances.find(
    (c) => c.instanceId === event.relatedInstanceId
  );
  if (!card) throw new Error("Semantic trigger source is missing");
  const recordedIds = new Set<number>();
  let highWater = state.semanticTriggerSequence ?? 0;
  if (!Number.isSafeInteger(highWater) || highWater < 0)
    throw new Error("Invalid semantic trigger sequence");
  for (const entry of state.semanticTriggerEvents ?? []) {
    if (
      !Number.isSafeInteger(entry.semanticEventId) ||
      entry.semanticEventId < 1 ||
      recordedIds.has(entry.semanticEventId)
    )
      throw new Error("Invalid semantic trigger identity");
    recordedIds.add(entry.semanticEventId);
    highWater = Math.max(highWater, entry.semanticEventId);
  }
  const sequence = highWater + 1;
  if (!Number.isSafeInteger(sequence))
    throw new Error("Semantic trigger sequence exhausted");
  return {
    ...state,
    semanticTriggerSequence: sequence,
    semanticTriggerEvents: [
      ...(state.semanticTriggerEvents ?? []).filter(
        (entry) => !entry.delivered || entry.turnNumber === state.turnNumber
      ),
      {
        ...event,
        semanticEventId: sequence,
        turnNumber: state.turnNumber,
        actingPlayerId: card.controllerPlayerId,
        relatedPlayerId: card.controllerPlayerId,
        source: "action_resolution",
        chainId: null,
        attackId: null,
        amount: null,
      },
    ],
  };
}

export function recordBraveFieldEntry(
  state: GameState,
  definition: CardDefinition,
  instanceId: string,
  eventKind: "summon" | "place" | "put",
  fromZone: Zone
): GameState {
  return definition.printedCategory === "brave"
    ? recordSemanticTriggerEvent(state, {
        eventKind,
        relatedInstanceId: instanceId,
        fromZone,
      })
    : state;
}

/** A failed entry is not an operation; never resurrect its tentative facts on a later entry. */
export function discardUncommittedSemanticEntry(
  state: GameState,
  instanceId: string
): GameState {
  if (
    !state.semanticTriggerEvents?.some(
      (e) => !e.delivered && e.relatedInstanceId === instanceId
    )
  )
    return state;
  return {
    ...state,
    semanticTriggerEvents: state.semanticTriggerEvents.filter(
      (e) => e.delivered || e.relatedInstanceId !== instanceId
    ),
  };
}
