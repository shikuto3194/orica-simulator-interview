import { getCardById } from "../card/card-lookup";
import {
  matchesCardFilter,
  type MatchCardFilterOptions,
} from "../card/card-filter";
import { getAvailablePayCostCoreSources } from "../core/payment-system";
import {
  definitionEffectPath,
  resolveDefinitionEffect,
} from "../effect/definition-effect-reference";
import { resolvePlayerRef } from "../effect/structured-effect-interpreter";
import { getFieldCoreSourceTakeableCount } from "../effect/structured-core-shoot";
import type { TargetLockBypassProfile } from "../effect/target-affect-gate";
import type {
  CardDefinition,
  CardInstance,
  EffectPlayerRef,
  EffectPreventionLevel,
  GameState,
  StepOptionalContinuation,
} from "../model";
import type { CoreLocation } from "../dsl-types";
import { getRequiredCountCostAvailableAmount } from "./required-count-cost-gate";
import type {
  RequiredCoreMoveCost,
  RequiredDiscardCost,
} from "./legal-actions-types";

export type RequiredEffectCostFilterOptions = Pick<
  MatchCardFilterOptions,
  "evaluateCondition" | "evaluateApplicability"
>;

export interface RequiredEffectCostRegistration {
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: EffectPlayerRef;
  requiredCoreMoveCost?: RequiredCoreMoveCost;
  requiredDiscardCost?: RequiredDiscardCost;
}

export interface RequiredEffectCostContextOptions {
  sourceInstanceId?: string;
  sourceDefinition?: CardDefinition;
  sourceDefinitionId?: string;
  effectIndex?: number;
  continuation?: Pick<
    StepOptionalContinuation,
    | "effectIndex"
    | "divineSkillIndex"
    | "isAccelData"
    | "isChangeData"
    | "resumeEffectOverride"
  >;
  targetStepId?: string;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
}

function canPayRequiredEffectCost(
  state: GameState,
  actingPlayerId: string,
  amount: number | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  contextOptions: RequiredEffectCostContextOptions
): boolean {
  if (amount === undefined || amount <= 0) return true;
  const sourceDefinition =
    contextOptions.sourceDefinition ??
    getCardDefinitionById(
      contextOptions.sourceDefinitionId ??
        getCardById(state, contextOptions.sourceInstanceId ?? "")
          ?.definitionId ??
        ""
    );
  const continuation = contextOptions.continuation;
  const effect =
    continuation?.resumeEffectOverride ??
    resolveDefinitionEffect(
      sourceDefinition,
      continuation?.effectIndex ?? contextOptions.effectIndex ?? -1,
      definitionEffectPath(continuation ?? {})
    );
  const timing = effect?.timing;
  return (
    getAvailablePayCostCoreSources(
      state,
      actingPlayerId,
      getCardDefinitionById,
      timing?.kind === "activated" && timing.mode !== "any"
        ? timing.mode
        : undefined
    ).reduce((sum, source) => sum + source.available, 0) >= amount
  );
}

function canPayRequiredCountCost(
  state: GameState,
  actingPlayerId: string,
  amount: number | undefined,
  playerRef: EffectPlayerRef | undefined,
  sourceTribes: readonly string[]
): boolean {
  if (amount === undefined || amount <= 0) return true;
  const availableAmount = getRequiredCountCostAvailableAmount(
    state,
    actingPlayerId,
    playerRef,
    sourceTribes
  );
  return availableAmount !== null && availableAmount >= amount;
}

function getRequiredCoreMoveDestinationCardOwnerId(
  state: GameState,
  destination: CoreLocation,
  sourceInstanceId: string | undefined
): string | undefined {
  const destinationInstanceId =
    destination.kind === "this_card"
      ? sourceInstanceId
      : destination.kind === "card_instance"
        ? destination.instanceId
        : undefined;
  if (destinationInstanceId === undefined) return undefined;
  return getCardById(state, destinationInstanceId)?.ownerPlayerId;
}

function canPayRequiredCoreMoveCost(
  state: GameState,
  actingPlayerId: string,
  cost: RequiredCoreMoveCost | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  filterOptions: RequiredEffectCostFilterOptions,
  contextOptions: RequiredEffectCostContextOptions
): boolean {
  if (cost === undefined || cost.amount <= 0) return true;
  const sourcePlayerId = resolvePlayerRef(
    actingPlayerId,
    cost.sourcePlayer,
    state
  );
  const sourceCard =
    contextOptions.sourceInstanceId !== undefined
      ? getCardById(state, contextOptions.sourceInstanceId)
      : undefined;
  const sourceDefinition =
    contextOptions.sourceDefinition ??
    (contextOptions.sourceDefinitionId !== undefined
      ? getCardDefinitionById(contextOptions.sourceDefinitionId)
      : sourceCard !== undefined
        ? getCardDefinitionById(sourceCard.definitionId)
        : undefined);
  const effectSource = {
    ...(sourceCard !== undefined ? { instance: sourceCard } : {}),
    ...(sourceDefinition !== undefined ? { definition: sourceDefinition } : {}),
    ...(contextOptions.effectIndex !== undefined
      ? { effectIndex: contextOptions.effectIndex }
      : {}),
    ...(contextOptions.targetStepId !== undefined
      ? { targetStepId: contextOptions.targetStepId }
      : {}),
  };
  const destinationCardOwnerId = getRequiredCoreMoveDestinationCardOwnerId(
    state,
    cost.destination,
    contextOptions.sourceInstanceId
  );
  const allowSoulCoreMove =
    (cost.destination.kind === "this_card" ||
      cost.destination.kind === "card_instance") &&
    destinationCardOwnerId !== undefined &&
    destinationCardOwnerId === sourcePlayerId;
  const hasSoulCoreOn = (instanceId: string): boolean =>
    state.players.some(
      (player) =>
        player.id === sourcePlayerId &&
        player.soulCoreLocation?.kind === "card" &&
        player.soulCoreLocation.instanceId === instanceId
    );
  const availableOnCandidate = (card: CardInstance): number => {
    const hasSoul = hasSoulCoreOn(card.instanceId);
    return getFieldCoreSourceTakeableCount(state, card, actingPlayerId, {
      soulCoresOnCard: hasSoul ? 1 : 0,
      soulCoresMovable: allowSoulCoreMove && hasSoul ? 1 : 0,
      sourcePreventionLevel: contextOptions.sourcePreventionLevel ?? "none",
      effectSource,
      getCardDefinitionById,
      ...(contextOptions.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: contextOptions.sourcePreventionBypass }
        : {}),
      filter: cost.sourceFilter,
      filterOptions,
      sourceInstanceId: contextOptions.sourceInstanceId,
      ...(contextOptions.sourceTargetLockBypass !== undefined
        ? { sourceTargetLockBypass: contextOptions.sourceTargetLockBypass }
        : {}),
    });
  };
  const totalAvailable = state.cardInstances.reduce((sum, card) => {
    if (card.controllerPlayerId !== sourcePlayerId) return sum;
    if (card.zone !== "field") return sum;
    if (card.pendingLeaveKind !== null) return sum;
    return sum + availableOnCandidate(card);
  }, 0);
  return totalAvailable >= cost.amount;
}

function canPayRequiredDiscardCost(
  state: GameState,
  actingPlayerId: string,
  cost: RequiredDiscardCost | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  filterOptions: RequiredEffectCostFilterOptions
): boolean {
  if (cost === undefined || cost.amount <= 0) return true;
  const sourcePlayerId = resolvePlayerRef(
    actingPlayerId,
    cost.sourcePlayer,
    state
  );
  let matchCount = 0;
  for (const card of state.cardInstances) {
    if (card.controllerPlayerId !== sourcePlayerId) continue;
    if (card.zone !== "hand") continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    if (
      cost.sourceFilter !== undefined &&
      !matchesCardFilter(card, def, cost.sourceFilter, {
        ...filterOptions,
      })
    ) {
      continue;
    }
    matchCount++;
    if (matchCount >= cost.amount) return true;
  }
  return matchCount >= cost.amount;
}

export function canPayRequiredEffectCosts(
  state: GameState,
  actingPlayerId: string,
  registration: RequiredEffectCostRegistration,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  sourceTribes: readonly string[] = [],
  filterOptions: RequiredEffectCostFilterOptions = {},
  contextOptions: RequiredEffectCostContextOptions = {}
): boolean {
  return (
    canPayRequiredEffectCost(
      state,
      actingPlayerId,
      registration.requiredPayCostAmount,
      getCardDefinitionById,
      contextOptions
    ) &&
    canPayRequiredCountCost(
      state,
      actingPlayerId,
      registration.requiredCountCostAmount,
      registration.requiredCountCostPlayer,
      sourceTribes
    ) &&
    canPayRequiredCoreMoveCost(
      state,
      actingPlayerId,
      registration.requiredCoreMoveCost,
      getCardDefinitionById,
      filterOptions,
      contextOptions
    ) &&
    canPayRequiredDiscardCost(
      state,
      actingPlayerId,
      registration.requiredDiscardCost,
      getCardDefinitionById,
      filterOptions
    )
  );
}
