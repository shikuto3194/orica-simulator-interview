import { replaceCardInstances } from "../zone/card-instance-state";
import { isInHandForOwnEffect } from "./card-access-rules";
import { resolveSummonActionCost } from "./summon-cost";
import { chooseAutoCardCostPaymentSources } from "../core/auto-card-cost-payment";
import { applyAutoEnterFieldCores } from "../zone/enter-field-core-sources";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import { getAdditionalCosts, matchesCardFilter } from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import { getTotalCoresOnCardById } from "../core/core-system";
import { applyCardCostPayments } from "../core/payment-system";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import {
  canSummonUltimate,
  getEffectiveColors,
  isCardUseRestricted,
} from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  SummonAction,
  Zone,
} from "../model";
import {
  collectUnderCardScopeIds,
  stripAdventSourceUnderCardReference,
} from "../model";
import { getMinimumRequiredCoresFromDefinition } from "../factories";
import type { CardFilter } from "../dsl-types";
import { evaluateCondition } from "./structured-condition-eval";

export type SummonFromZoneCandidateZone =
  | NonNullable<SummonAction["zone"]>
  | Zone
  | readonly Zone[];

export interface SummonFromZoneCandidateSpec {
  zone: SummonFromZoneCandidateZone;
  filter?: CardFilter;
  includeAdventSource?: boolean;
  includeSoulState?: boolean;
  fullReduction?: boolean;
  /**
   * 指定時、zone一致 + includeAdventSource/includeSoulState 候補をこの instanceId 集合との
   * 交差にさらに絞り込む (`SummonAction.restrictToInstanceIds`、BSSG01-C08 Lv2)。
   * `include*` が候補を追加する軸なのに対し、こちらは候補を制限する軸。
   */
  restrictToInstanceIds?: readonly string[];
}

export function normalizeSummonFromZoneZone(
  zone: SummonFromZoneCandidateZone
): NonNullable<SummonAction["zone"]> {
  const zones = Array.isArray(zone) ? zone : [zone];
  if (zones.length === 1) {
    return zones[0] as NonNullable<SummonAction["zone"]>;
  }
  const sorted = [...zones].sort();
  return sorted.join("_or_") as NonNullable<SummonAction["zone"]>;
}

/**
 * `summon` from_zone の候補（zone一致 + includeAdventSource分 + filter + 利用制限）
 * を解決する。実行系と optional canExecute 判定で共有し、候補なしの executable no-op を防ぐ。
 */
export function resolveSummonFromZoneCandidates(
  state: GameState,
  actingPlayerId: string,
  action: SummonFromZoneCandidateSpec,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardInstance[] {
  const zone = normalizeSummonFromZoneZone(action.zone);
  const zoneMatch = (cardZone: CardInstance["zone"]): boolean => {
    switch (zone) {
      case "hand":
        return cardZone === "hand";
      case "set_aside":
        return cardZone === "set_aside";
      case "trash":
        return cardZone === "trash";
      case "hand_or_set_aside":
        return cardZone === "hand" || cardZone === "set_aside";
      case "hand_or_trash":
        return cardZone === "hand" || cardZone === "trash";
      case "hand_or_set_aside_or_trash":
        return (
          cardZone === "hand" ||
          cardZone === "set_aside" ||
          cardZone === "trash"
        );
      default:
        return false;
    }
  };

  const zoneCandidates = state.cardInstances.filter(
    (card) =>
      card.ownerPlayerId === actingPlayerId &&
      (zoneMatch(card.zone) ||
        (zone.split("_or_").includes("hand") &&
          isInHandForOwnEffect(
            state,
            card,
            actingPlayerId,
            getCardDefinitionById
          )))
  );
  const underCardIds = collectUnderCardScopeIds(state);
  const adventSourceIds = action.includeAdventSource
    ? underCardIds.adventSource
    : new Set<string>();
  const soulStateIds = new Set(
    state.players.flatMap((player) => player.soulStateInstanceIds)
  );
  const soulStateCandidates = action.includeSoulState
    ? state.cardInstances.filter(
        (card) =>
          card.ownerPlayerId === actingPlayerId &&
          card.zone === "field" &&
          soulStateIds.has(card.instanceId)
      )
    : [];
  const adventSourceCandidates = action.includeAdventSource
    ? state.cardInstances.filter(
        (card) =>
          card.ownerPlayerId === actingPlayerId &&
          adventSourceIds.has(card.instanceId)
      )
    : [];

  const seen = new Set<string>();
  const candidatesBeforeRestriction = [
    ...zoneCandidates,
    ...adventSourceCandidates,
    ...soulStateCandidates,
  ].filter((card) => {
    if (seen.has(card.instanceId)) return false;
    seen.add(card.instanceId);
    return true;
  });
  const candidates = action.restrictToInstanceIds
    ? candidatesBeforeRestriction.filter((card) =>
        action.restrictToInstanceIds!.includes(card.instanceId)
      )
    : candidatesBeforeRestriction;

  return candidates.filter((card) => {
    const def = getCardDefinitionById(card.definitionId);
    if (!def) return false;
    if (action.filter) {
      const effectiveFilter = {
        ...action.filter,
        ...(action.includeAdventSource && adventSourceIds.has(card.instanceId)
          ? { adventSourceScope: "include" as const }
          : {}),
        ...(action.includeSoulState && soulStateIds.has(card.instanceId)
          ? { soulState: "include" as const }
          : {}),
      };
      if (
        !matchesCardFilter(card, def, effectiveFilter, {
          state,
          soulStateIds,
          underCardIds,
          additionalCosts: getAdditionalCosts(state, card.instanceId),
          effectiveColors: getEffectiveColors(state, card, def),
          effectiveBp:
            card.zone === "field"
              ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
              : undefined,
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(state, card.instanceId)
              : undefined,
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(state, card, def, getCardDefinitionById)
              : undefined,
          effectiveCategory: getEffectiveCategory(state, card, def),
          effectiveSymbolCount:
            card.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  card,
                  def,
                  getCardDefinitionById
                )
              : undefined,
        })
      ) {
        return false;
      }
    }
    return !isCardUseRestricted(
      state,
      actingPlayerId,
      card,
      def,
      getCardDefinitionById,
      def.printedCategory === "nexus" ? "place_nexus" : "summon"
    );
  });
}

function cloneStateForCostSimulation(state: GameState): GameState {
  return { ...state, log: [...state.log] };
}

function getSummonedZoneRoleName(
  definition: CardDefinition
): "spirit" | "ultimate" | "nexus" | "brave" {
  return definition.printedCategory === "spirit"
    ? "spirit"
    : definition.printedCategory === "ultimate"
      ? "ultimate"
      : definition.printedCategory === "nexus"
        ? "nexus"
        : definition.printedCategory === "brave"
          ? "brave"
          : "spirit";
}

export function canAutoExecuteSummonFromZoneCandidate(args: {
  state: GameState;
  actingPlayerId: string;
  action: SummonAction;
  candidate: CardInstance;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  return (
    simulateAutoExecuteSummonFromZoneCandidate({
      state: args.state,
      actingPlayerId: args.actingPlayerId,
      action: args.action,
      candidate: args.candidate,
      getCardDefinitionById: args.getCardDefinitionById,
    }) !== null
  );
}

function simulateAutoExecuteSummonFromZoneCandidate(args: {
  state: GameState;
  actingPlayerId: string;
  action: SummonAction;
  candidate: CardInstance;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  excludedFieldSourceIds?: ReadonlySet<string>;
  costState?: GameState;
}): { state: GameState; trashCores: number } | null {
  const currentCandidate =
    getCardById(args.state, args.candidate.instanceId) ?? args.candidate;
  const def = args.getCardDefinitionById(args.candidate.definitionId);
  if (!def) return null;
  if (
    args.action.ignoreSummonCondition !== true &&
    !canSummonUltimate(
      args.state,
      args.actingPlayerId,
      def,
      args.getCardDefinitionById,
      {
        sourceInstanceId: args.candidate.instanceId,
        evaluateCondition,
      }
    )
  ) {
    return null;
  }

  const excludedTargetIds = new Set([
    ...(args.excludedFieldSourceIds ?? []),
    args.candidate.instanceId,
  ]);
  const costToPay = resolveSummonActionCost({
    state: args.costState ?? args.state,
    actingPlayerId: args.actingPlayerId,
    action: args.action,
    definition: def,
    sourceInstanceId: currentCandidate.instanceId,
    ...(args.action.perCardOverrideCost?.[currentCandidate.instanceId] !==
    undefined
      ? {
          perCardOverride:
            args.action.perCardOverrideCost[currentCandidate.instanceId],
        }
      : {}),
    getCardDefinitionById: args.getCardDefinitionById,
  });
  const paymentSources = chooseAutoCardCostPaymentSources(
    args.state,
    args.actingPlayerId,
    def,
    costToPay,
    args.getCardDefinitionById,
    args.candidate.instanceId,
    excludedTargetIds,
    args.action.onBoardCoreSourceFilter
  );
  if (paymentSources === null) return null;

  const paidState =
    costToPay > 0
      ? applyCardCostPayments({
          state: cloneStateForCostSimulation(args.state),
          actingPlayerId: args.actingPlayerId,
          chainId: `effect-summon-can-execute-${args.candidate.instanceId}`,
          paymentSources,
          getCardDefinitionById: args.getCardDefinitionById,
          ...(args.action.onBoardCoreSourceFilter !== undefined
            ? { onBoardCoreSourceFilter: args.action.onBoardCoreSourceFilter }
            : {}),
        })
      : args.state;

  const fieldEntryState: GameState = replaceCardInstances(
    {
      ...paidState,
      players:
        currentCandidate.zone === "hand"
          ? paidState.players.map((player) =>
              player.id === args.actingPlayerId ? { ...player } : player
            )
          : paidState.players,
    },
    stripAdventSourceUnderCardReference(
      paidState.cardInstances.map((card) =>
        card.instanceId === currentCandidate.instanceId
          ? {
              ...card,
              zone: "field" as const,
              zoneRoleName: getSummonedZoneRoleName(def),
              normalCoreCount: 0,
              minimumRequiredCores: getMinimumRequiredCoresFromDefinition(def),
              exhaustState: "recovered" as const,
              attachedToInstanceId: null,
              attachedChildrenIds: [],
              oraclePlacementSuppressed:
                args.action.suppressPlacementOracle === true,
            }
          : card
      ),
      currentCandidate.instanceId
    )
  );

  const placedState = applyAutoEnterFieldCores({
    ...(args.action.fieldCoreSourceMinimum !== undefined
      ? { fieldCoreSourceMinimum: args.action.fieldCoreSourceMinimum }
      : {}),
    state: fieldEntryState,
    actingPlayerId: args.actingPlayerId,
    destinationInstanceId: args.candidate.instanceId,
    requiredCores: getMinimumRequiredCoresFromDefinition(def),
    ...(args.action.trashCoreMax !== undefined
      ? { trashCoreMax: args.action.trashCoreMax }
      : {}),
    ...(args.action.trashCoreKind !== undefined
      ? { trashCoreKind: args.action.trashCoreKind }
      : {}),
    excludedFieldSourceIds: excludedTargetIds,
    getCardDefinitionById: args.getCardDefinitionById,
  });
  return placedState;
}

export function canAutoExecuteSummonFromZoneCandidateSequence(args: {
  state: GameState;
  actingPlayerId: string;
  action: SummonAction;
  candidates: readonly CardInstance[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  let nextState = cloneStateForCostSimulation(args.state);
  let remainingTrashBudget = args.action.trashCoreMax ?? 0;
  for (const candidate of args.candidates) {
    const simulated = simulateAutoExecuteSummonFromZoneCandidate({
      excludedFieldSourceIds: new Set(
        args.candidates.map((card) => card.instanceId)
      ),
      // 同時召喚のコストは全対象の提示時点の盤面で確定する。
      costState: args.state,
      state: nextState,
      actingPlayerId: args.actingPlayerId,
      action: { ...args.action, trashCoreMax: remainingTrashBudget },
      candidate,
      getCardDefinitionById: args.getCardDefinitionById,
    });
    if (simulated === null) return false;
    nextState = simulated.state;
    remainingTrashBudget -= simulated.trashCores;
  }
  return true;
}

export function getMaxAutoExecutableSummonFromZoneSelectionCount(args: {
  state: GameState;
  actingPlayerId: string;
  action: SummonAction;
  candidates: readonly CardInstance[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  maxCountHint?: number;
}): number {
  const limit = Math.min(
    Math.max(0, args.maxCountHint ?? args.candidates.length),
    args.candidates.length
  );
  if (limit <= 0) return 0;
  let best = 0;

  const search = (
    index: number,
    stateForSelection: GameState,
    selectedCount: number,
    remainingTrashBudget: number
  ): void => {
    if (best >= limit) return;
    const remainingCandidateCount = args.candidates.length - index;
    if (selectedCount + remainingCandidateCount <= best) return;
    if (selectedCount >= limit) {
      best = limit;
      return;
    }
    if (index >= args.candidates.length) {
      best = Math.max(best, selectedCount);
      return;
    }

    const candidate = args.candidates[index]!;
    const currentCandidate = getCardById(
      stateForSelection,
      candidate.instanceId
    );
    if (!currentCandidate) {
      search(index + 1, stateForSelection, selectedCount, remainingTrashBudget);
      return;
    }
    const simulated = simulateAutoExecuteSummonFromZoneCandidate({
      excludedFieldSourceIds: new Set(
        args.candidates.map((card) => card.instanceId)
      ),
      state: stateForSelection,
      actingPlayerId: args.actingPlayerId,
      action: { ...args.action, trashCoreMax: remainingTrashBudget },
      candidate: currentCandidate,
      getCardDefinitionById: args.getCardDefinitionById,
    });
    if (simulated !== null) {
      search(
        index + 1,
        simulated.state,
        selectedCount + 1,
        remainingTrashBudget - simulated.trashCores
      );
    }
    search(index + 1, stateForSelection, selectedCount, remainingTrashBudget);
  };

  search(
    0,
    cloneStateForCostSimulation(args.state),
    0,
    args.action.trashCoreMax ?? 0
  );
  return best;
}
