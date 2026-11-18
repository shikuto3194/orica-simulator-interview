import type {
  CardDefinition,
  GameState,
  SupplementalTriggerEvent,
  TriggerEventFacts,
} from "../model";
import type { MatchCardFilterOptions } from "../card/card-filter";
import {
  getEffectiveColors,
  getEffectiveTribes,
  getCombinedUnitCostFilterOptions,
} from "../legal/legal-actions-shared";
import {
  getCombinedUnitBp,
  getEffectiveLevel,
  getCombinedUnitSymbolCount,
} from "../battle/battle-shared";
import {
  getEffectiveCategory,
  getEffectiveCategories,
} from "../mechanics/act-as-spirit";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import { hasOracleUltimateOptIn } from "../mechanics/oracle-ultimate-opt-in";
import { buildTriggerConditionContext } from "./trigger-condition-context";
import { isAwaitingEffectEntryCores } from "../zone/enter-field-placement-pending";
import { captureCardInstanceView } from "../zone/card-instance-state";
import { captureEffectAccountingView } from "./effect-usage-accounting";

/** Read-only rule input, detached from stack snapshots and operation history. */
export function captureTriggerEventFacts(
  state: GameState,
  event: SupplementalTriggerEvent,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): TriggerEventFacts {
  const filterState: TriggerEventFacts["filterState"] = {
    players: state.players,
    step: state.step,
    activePlayerId: state.activePlayerId,
    ...captureCardInstanceView(state),
    activeContinuousEffects: state.activeContinuousEffects,
    activeAttack: state.activeAttack
      ? { ...state.activeAttack, flashWindowState: null }
      : null,
    battleEntities: state.battleEntities,
    ...captureEffectAccountingView(state),
    turnNumber: state.turnNumber,
    stepOrdinalThisTurn: state.stepOrdinalThisTurn,
    preDeclarationStackWindow: state.preDeclarationStackWindow
      ? { ...state.preDeclarationStackWindow, pendingStackAction: null }
      : null,
    pendingPreDeclarationConfirmation: state.pendingPreDeclarationConfirmation
      ? { ...state.pendingPreDeclarationConfirmation, pendingStackAction: null }
      : null,
  };
  const ids = new Set([
    event.relatedInstanceId,
    ...(event.relatedInstanceIds ?? []),
    event.effectSourceInstanceId,
    ...(event.effectSourceInstanceIds ?? []),
  ]);
  const cards: TriggerEventFacts["cards"] = {};
  for (const card of state.cardInstances) {
    if (!ids.has(card.instanceId)) continue;
    const definition = getCardDefinitionById(
      card.instanceId === event.effectSourceInstanceId
        ? (event.effectSourceDefinitionId ?? card.definitionId)
        : card.definitionId
    );
    if (!definition) continue;
    cards[card.instanceId] = {
      card: { ...card, definitionId: definition.cardNo },
      filterOptions: {
        effectiveColors: getEffectiveColors(state, card, definition),
        effectiveTribes: getEffectiveTribes(
          state,
          card,
          definition,
          getCardDefinitionById
        ),
        ...getCombinedUnitCostFilterOptions(
          state,
          card,
          definition,
          getCardDefinitionById
        ),
        effectiveCategory: getEffectiveCategory(state, card, definition),
        effectiveCategories: getEffectiveCategories(state, card, definition),
        ...(card.zone === "field"
          ? {
              effectiveBp: getCombinedUnitBp(
                state,
                card,
                definition,
                getCardDefinitionById
              ),
              effectiveLevel: getEffectiveLevel(
                state,
                card,
                definition,
                getCardDefinitionById
              ),
              effectiveSymbolCount: getCombinedUnitSymbolCount(
                state,
                card,
                definition,
                getCardDefinitionById
              ),
            }
          : {}),
      },
      oracleUltimateOptIn: hasOracleUltimateOptIn(state, card.instanceId),
    };
  }
  return {
    ...(event.observationSnapshot
      ? { observationSnapshot: event.observationSnapshot }
      : {}),
    conditionContext: buildTriggerConditionContext(
      state,
      event,
      getCardDefinitionById
    ),
    cards,
    filterState,
    soulStateIds: [...getEffectiveSoulStateIds(state, getCardDefinitionById)],
  };
}

/** Entry core choices finish before the next action; freeze the completed entry before that action changes its attributes. */
export function captureCommittedSemanticEventFacts(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effectSourceInstanceId?: string
): GameState {
  let changed = false;
  const events = state.semanticTriggerEvents?.map((event) => {
    if (event.delivered || event.eventFactOccurrences || event.observationOnly)
      return event;
    const factEvent =
      effectSourceInstanceId && !event.effectSourceInstanceId
        ? { ...event, effectSourceInstanceId }
        : event;
    if (
      event.relatedInstanceId &&
      isAwaitingEffectEntryCores(state, event.relatedInstanceId)
    ) {
      if (factEvent !== event) changed = true;
      return factEvent;
    }
    changed = true;
    return {
      ...factEvent,
      eventFactOccurrences: [
        captureTriggerEventFacts(state, factEvent, getCardDefinitionById),
      ],
    };
  });
  return changed && events
    ? { ...state, semanticTriggerEvents: events }
    : state;
}

/** Canonical evaluators receive the saved event board without nested histories. */
export function getTriggerEventFactState(
  state: GameState,
  facts: TriggerEventFacts
): GameState {
  return { ...state, ...facts.filterState };
}

export function getTriggerEventFactFilterOptions(
  facts: TriggerEventFacts,
  instanceId: string
): MatchCardFilterOptions {
  // Category interpretation belongs to matchesCardReferenceFilter: summoning
  // uses a single category, while a field query includes spirit-state Braves
  // and magic-compatible forms. Its canonical resolver uses this saved board.
  const {
    effectiveCategory: _category,
    effectiveCategories: _categories,
    ...filterOptions
  } = facts.cards[instanceId]?.filterOptions ?? {};
  return {
    ...filterOptions,
    state: facts.filterState,
    soulStateIds: new Set(facts.soulStateIds),
  };
}
