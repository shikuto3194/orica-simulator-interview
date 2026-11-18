import { captureTriggerObservation } from "./trigger-observation-sources";
import { advanceSummonedTriggerPresenceGeneration } from "./effect-usage-lifecycle";
import type {
  GameState,
  SemanticTriggerEvent,
  SupplementalTriggerEvent,
  TriggerObservationSnapshot,
  Zone,
} from "../model";

/** Operation-owned facts. Display logs and zone/attachment deltas never create these events. */
export function recordSemanticTriggerEvent(
  state: GameState,
  event: Pick<
    SupplementalTriggerEvent,
    "eventKind" | "relatedInstanceId" | "effectScope" | "observationSnapshot"
  > & {
    fromZone?: Zone;
    triggerRelatedCombinedHostInstanceId?: string;
    cause?: NonNullable<SupplementalTriggerEvent["cause"]>;
  }
): GameState {
  const card = state.cardInstances.find(
    (c) => c.instanceId === event.relatedInstanceId
  );
  if (!card) throw new Error("Semantic trigger source is missing");
  return appendSemanticEvent(state, {
    ...event,
    actingPlayerId: card.controllerPlayerId,
    relatedPlayerId: card.controllerPlayerId,
    source: "action_resolution",
    chainId: null,
    attackId: null,
    amount: null,
  });
}

function appendSemanticEvent(
  state: GameState,
  event: SupplementalTriggerEvent & { observationOnly?: true }
): GameState {
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
      },
    ],
  };
}

/**
 * Delivered entry facts are only identity receipts: the collector never delivers
 * them again. Operation evidence can still qualify an enclosing delta, so its
 * payload may be discarded only at the outer legal-action exit with no suspended
 * effect/selection/cascade. Undelivered operations always retain their facts.
 */
export function compactDeliveredSemanticEventPayloads(
  state: GameState,
  includeOperationEvidence = false
): GameState {
  let changed = false;
  const events = state.semanticTriggerEvents?.map((entry) => {
    if (
      !entry.delivered ||
      (entry.observationOnly && !includeOperationEvidence) ||
      (entry.observationSnapshot === undefined &&
        entry.eventFactOccurrences === undefined)
    )
      return entry;
    const {
      observationSnapshot: _observation,
      eventFactOccurrences: _facts,
      ...receipt
    } = entry;
    changed = true;
    return receipt;
  });
  return changed && events
    ? { ...state, semanticTriggerEvents: events }
    : state;
}

/** Source registration capture replaces event facts with the frozen eligibility results. */
export function compactCapturedTriggerEventFacts(state: GameState): GameState {
  let changed = false;
  const compact = (pending: GameState["pendingTriggeredEffects"][number]) => {
    if (
      pending.timingSourceRegistrations === undefined ||
      pending.eventFactOccurrences === undefined
    )
      return pending;
    const { eventFactOccurrences: _facts, ...captured } = pending;
    changed = true;
    return captured;
  };
  const pendingTriggeredEffects = state.pendingTriggeredEffects.map(compact);
  const pendingDeferredTriggeredEffects =
    state.pendingDeferredTriggeredEffects.map(compact);
  return changed
    ? { ...state, pendingTriggeredEffects, pendingDeferredTriggeredEffects }
    : state;
}

/**
 * Matching uses the collector's event attributes, never a second action→event map.
 * A later collector may supply additional provenance. Amount is deliberately not
 * compared: a single final event can aggregate several operations (e.g. draws).
 */
function matchesObservationEvent(
  evidence: SupplementalTriggerEvent,
  event: SupplementalTriggerEvent
): boolean {
  const {
    observationSnapshot: _snapshot,
    eventFactOccurrences: _facts,
    operationObservationEventIds: _evidenceIds,
    semanticEventId: _id,
    amount: _amount,
    source: _source,
    chainId: _chain,
    attackId: _attack,
    ...attributes
  } = event;
  return Object.entries(attributes).every(([key, value]) => {
    const recorded = evidence[key as keyof SupplementalTriggerEvent];
    // Optional metadata is sometimes supplied only at the finalization boundary.
    return (
      recorded === undefined ||
      JSON.stringify(recorded) === JSON.stringify(value)
    );
  });
}

/** New facts plus still-pending evidence survive selection resumes; older receipts do not leak. */
export function getOperationObservationEvidence(
  before: GameState,
  after: GameState,
  chainId: string | null | undefined
): readonly SemanticTriggerEvent[] {
  return (after.semanticTriggerEvents ?? []).filter(
    (entry) =>
      entry.observationOnly === true &&
      entry.observationSnapshot !== undefined &&
      entry.chainId === (chainId ?? null) &&
      (!entry.delivered ||
        entry.semanticEventId > (before.semanticTriggerSequence ?? 0))
  );
}

/**
 * Record only evidence for existing delta events. This does not make a new event
 * stream, alter aggregation, or deliver an operation that the collector omits.
 */
export function recordOperationObservationEvidence(
  before: GameState,
  after: GameState,
  events: readonly SupplementalTriggerEvent[]
): GameState {
  let result = after;
  for (const event of events) {
    if (event.semanticEventId !== undefined) continue;
    // Nested effects can already have captured more precise operation boundaries.
    // Do not replace their evidence with the enclosing action's older board.
    const hasInnerEvidence = (after.semanticTriggerEvents ?? []).some(
      (entry) =>
        entry.observationOnly === true &&
        entry.chainId === event.chainId &&
        entry.semanticEventId > (before.semanticTriggerSequence ?? 0) &&
        matchesObservationEvent(entry, event)
    );
    if (hasInnerEvidence) continue;
    result = appendSemanticEvent(result, { ...event, observationOnly: true });
  }
  return result;
}

/**
 * A final aggregate can be observed by sources present for any constituent
 * operation. A later occurrence of the same instance replaces its older identity;
 * current-state matching still rejects a subsequent, unobserving re-entry/face.
 */
export function getOperationTriggerObservation(
  event: SupplementalTriggerEvent,
  evidence: readonly SemanticTriggerEvent[]
):
  | {
      snapshot: TriggerObservationSnapshot;
      evidenceIds: number[];
      eventFactOccurrences?: import("../model").TriggerEventFacts[];
    }
  | undefined {
  const matching = evidence
    .filter((entry) => matchesObservationEvent(entry, event))
    .sort((left, right) => left.semanticEventId - right.semanticEventId);
  if (matching.length === 0) return undefined;
  const sourceIdentities: TriggerObservationSnapshot["sourceIdentities"] = {};
  const grantedEffectIds = new Set<string>();
  for (const entry of matching) {
    const snapshot = entry.observationSnapshot!;
    Object.assign(sourceIdentities, snapshot.sourceIdentities);
    for (const id of snapshot.grantedEffectIds) grantedEffectIds.add(id);
  }
  return {
    snapshot: { sourceIdentities, grantedEffectIds: [...grantedEffectIds] },
    evidenceIds: matching.map((entry) => entry.semanticEventId),
    eventFactOccurrences: matching.flatMap(
      (entry) => entry.eventFactOccurrences ?? []
    ),
  };
}

/** Capture observers before this operation. Simultaneous entries share the same beforeState. */
export function recordFieldEntry(
  state: GameState,
  beforeState: GameState,
  instanceId: string,
  eventKind: "summon" | "place" | "put",
  fromZone: Zone,
  effectScope?: SupplementalTriggerEvent["effectScope"]
): GameState {
  return recordSemanticTriggerEvent(
    eventKind === "summon"
      ? advanceSummonedTriggerPresenceGeneration(beforeState, state, instanceId)
      : state,
    {
      eventKind,
      relatedInstanceId: instanceId,
      fromZone,
      ...(effectScope !== undefined ? { effectScope } : {}),
      observationSnapshot: captureTriggerObservation(beforeState),
    }
  );
}

/** A failed entry is not an operation; never resurrect its tentative facts on a later entry. */
export function discardUncommittedSemanticEntry(
  state: GameState,
  instanceId: string
): GameState {
  if (
    !state.semanticTriggerEvents?.some(
      (e) =>
        !e.observationOnly && !e.delivered && e.relatedInstanceId === instanceId
    )
  )
    return state;
  return {
    ...state,
    semanticTriggerEvents: state.semanticTriggerEvents.filter(
      (e) =>
        e.observationOnly || e.delivered || e.relatedInstanceId !== instanceId
    ),
  };
}
