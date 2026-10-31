import {
  visitPaymentSourceAllocations,
  type CorePaymentSourceCapacity,
} from "./core/payment-allocation";
import { findTokenPoolPreCostForcedCombineTrigger } from "./legal/token-pool-pre-cost-forced-combine";
import { isNormalCoreMovePrevented } from "./core/core-system";
import { reverseRebirthSummonSourceReturnedState } from "./core/reverse-rebirth-core-return";
import { isCoreDistributionAllocationValid } from "./core/core-distribution-constraints";
import {
  getDeckRevealCostPaymentSources,
  getDeckRevealSelectedHandGainCost,
} from "./legal/deck-reveal-hand-gain-cost";

import { getZoneSelectionHandGainCost } from "./legal/zone-selection-hand-gain-cost";
import { isDeckRevealRevealedChoiceGroupSelectionValid } from "./legal/deck-reveal-swap-helpers";

import { getHandGainCostPaymentSources } from "./effect/hand-gain-cost";

import {
  getCoreShootSoulSourceId,
  reserveCoreShootSentinelId,
} from "./effect/structured-core-shoot";

import { satisfiesCoreSourceGroupMinimums } from "./model";

import type { DraftCoreMove } from "./core/core-draft";

import { recomposeBraveSeparationLegalAction } from "./core/core-draft";

import {
  buildCoreDistributionSoulMovePlan,
  coreDistributionSoulCoreSourceContainerFromKey,
  type SoulCoreDistributionSourceChunk,
} from "./core/core-distribution-flow";

import { getCoreDistributionTargetTotalBounds } from "./core/core-distribution-target-totals";

import { resolveSummonCostCoreMoveChoiceSelection } from "./mechanics/summon-cost-core-move-choice";

import { calculateFreeSummonCost } from "./effect/summon-cost";

import { coreShootSoulDestinationAllowed } from "./effect/structured-core-shoot";

import {
  assignLegalActionTargetGroups,
  getAvailableBraveSeparationCoreSources,
  getSummonTrashCorePlacementGrant,
} from "./legal/legal-actions-shared";

import {
  canCompleteHandPlayAfterCostPayment,
  canCompleteTenshoSummonAfterCostPayment,
} from "./play/play-card-resolution";

import { getCardById } from "./card/card-lookup";
import type { AiDecisionApplyOptionField } from "./player-decision-contract";

import {
  getRequiredAttackExhaustCostCount,
  getRequiredAttackExhaustCostSourceCandidates,
} from "./battle/battle-system";

import type {
  ApplyLegalActionOptions,
  LegalAction,
} from "./legal/legal-actions-types";

import {
  canProvideEnterFieldCorePlacementSource,
  getEnterFieldCorePlacementSourceCapacity,
  type EnterFieldCorePlacement,
} from "./zone/enter-field-placement-execution";

import {
  applyCardCostPayments,
  getAvailableCardCostPaymentSources,
  type CardCostPaymentSource,
} from "./core/payment-system";

import { getAvailableMiragePaymentSources } from "./mechanics/mirage-system";

import type { CardDefinition, GameState, LifeCoreKind } from "./model";
/** Atomic engine inputs shared by the browser's simple AI and training decisions.
 * Training-only factored decisions stay in training-decision-surface.ts.
 */
export type CardDefinitionLookup = (id: string) => CardDefinition | undefined;
export type ActionInputOptions = Partial<
  Pick<ApplyLegalActionOptions, AiDecisionApplyOptionField>
>;
export interface ActionInputChoiceContext {
  getCardDefinitionById?: CardDefinitionLookup;
  getTargetInput?: (
    state: GameState,
    action: LegalAction,
    limit: number
  ) => ChoiceAccumulator<ActionInputOptions> | null;
}

export type TrainingPlacementSource = {
  kind: "reserve" | "card" | "trash";
  instanceId?: string;
  normalCap: number;
  soulCap: number;
  totalCap?: number;
};

export type AnyAction = LegalAction & Record<string, unknown>;

export type ChoiceAccumulator<T> = {
  values: T[];
  truncated: boolean;
  limit: number;
};

export type TargetGroupLike = {
  candidateTargetInstanceIds: string[];
  requiredTargetCount: number;
  maxTargetCount?: number;
};

export type FollowUpPerTargetInput = NonNullable<
  ActionInputOptions["followUpPerTargetInputs"]
>[number];

export type ResolvePendingBurstCheckAction = Extract<
  LegalAction,
  { kind: "resolve_pending_burst_check" }
>;

export function actionRecord(action: LegalAction): AnyAction {
  return action as AnyAction;
}

export function numberValue(
  action: AnyAction,
  key: string
): number | undefined {
  const value = action[key];
  return typeof value === "number" ? value : undefined;
}

export function booleanValue(
  action: AnyAction,
  key: string
): boolean | undefined {
  const value = action[key];
  return typeof value === "boolean" ? value : undefined;
}

export function stringArrayValue(action: AnyAction, key: string): string[] {
  const value = action[key];
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : [];
}

export function targetGroupsValue(action: AnyAction): TargetGroupLike[] {
  const value = action.targetGroups;
  if (!Array.isArray(value)) return [];
  return value.filter((group): group is TargetGroupLike => {
    if (typeof group !== "object" || group === null) return false;
    const record = group as Record<string, unknown>;
    return (
      Array.isArray(record.candidateTargetInstanceIds) &&
      record.candidateTargetInstanceIds.every((id) => typeof id === "string") &&
      typeof record.requiredTargetCount === "number"
    );
  });
}

export function compactOptions(
  options: ActionInputOptions
): ActionInputOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  ) as ActionInputOptions;
}

export function cloneEnterFieldCorePlacements(
  placements: readonly EnterFieldCorePlacement[]
): EnterFieldCorePlacement[] {
  return placements.map(
    (placement): EnterFieldCorePlacement =>
      ({ ...placement }) as EnterFieldCorePlacement
  );
}

export function cloneFollowUpPerTargetInput(
  input: FollowUpPerTargetInput
): FollowUpPerTargetInput {
  return {
    targetInstanceId: input.targetInstanceId,
    ...(input.enterFieldCorePlacements !== undefined
      ? {
          enterFieldCorePlacements: cloneEnterFieldCorePlacements(
            input.enterFieldCorePlacements
          ),
        }
      : {}),
    ...(input.followUpTargetInstanceIds !== undefined
      ? { followUpTargetInstanceIds: [...input.followUpTargetInstanceIds] }
      : {}),
    ...(input.followUpChosenLifeCoreKind !== undefined
      ? { followUpChosenLifeCoreKind: input.followUpChosenLifeCoreKind }
      : {}),
  };
}

export function mergeFollowUpPerTargetInputs(
  left: readonly FollowUpPerTargetInput[] | undefined,
  right: readonly FollowUpPerTargetInput[] | undefined
): FollowUpPerTargetInput[] | undefined {
  if (left === undefined && right === undefined) return undefined;
  const byTarget = new Map<string, FollowUpPerTargetInput>();
  for (const input of [...(left ?? []), ...(right ?? [])]) {
    const existing = byTarget.get(input.targetInstanceId);
    byTarget.set(input.targetInstanceId, {
      ...(existing ? cloneFollowUpPerTargetInput(existing) : {}),
      ...cloneFollowUpPerTargetInput(input),
    });
  }
  return [...byTarget.values()];
}

export function mergeTrainingInputOptions(
  left: ActionInputOptions,
  right: ActionInputOptions
): ActionInputOptions {
  const merged = { ...left, ...right };
  const followUpPerTargetInputs = mergeFollowUpPerTargetInputs(
    left.followUpPerTargetInputs,
    right.followUpPerTargetInputs
  );
  if (followUpPerTargetInputs !== undefined) {
    merged.followUpPerTargetInputs = followUpPerTargetInputs;
  }
  return compactOptions(merged);
}

export function makeAccumulator<T>(limit: number): ChoiceAccumulator<T> {
  return { values: [], truncated: false, limit };
}

export function pushLimited<T>(acc: ChoiceAccumulator<T>, value: T): void {
  if (acc.values.length >= acc.limit) {
    acc.truncated = true;
    return;
  }
  acc.values.push(value);
}

function* iterateCombinations<T>(
  items: readonly T[],
  minCount: number,
  maxCount: number,
  /** Monotone constraint: a rejected prefix can never become a legal selection. */
  acceptsPartial?: (selection: readonly T[]) => boolean
): Generator<T[]> {
  const max = Math.max(0, Math.min(maxCount, items.length));
  const min = Math.max(0, Math.min(minCount, max));

  function* walk(index: number, selected: T[]): Generator<T[]> {
    if (selected.length > max || (acceptsPartial && !acceptsPartial(selected)))
      return;
    if (index === items.length) {
      if (selected.length >= min) yield [...selected];
      return;
    }
    if (selected.length + (items.length - index) < min) return;
    yield* walk(index + 1, selected);
    selected.push(items[index]!);
    yield* walk(index + 1, selected);
    selected.pop();
  }

  yield* walk(0, []);
}

export function combinations<T>(
  items: readonly T[],
  minCount: number,
  maxCount: number,
  limit: number,
  acceptsPartial?: (selection: readonly T[]) => boolean
): ChoiceAccumulator<T[]> {
  const acc = makeAccumulator<T[]>(limit);
  for (const selection of iterateCombinations(
    items,
    minCount,
    maxCount,
    acceptsPartial
  )) {
    pushLimited(acc, selection);
    if (acc.truncated) break;
  }
  return acc;
}

export function permutations<T>(
  items: readonly T[],
  limit: number
): ChoiceAccumulator<T[]> {
  const acc = makeAccumulator<T[]>(limit);
  const used = new Set<number>();
  const selected: T[] = [];
  const walk = (): void => {
    if (acc.truncated) return;
    if (selected.length === items.length) {
      pushLimited(acc, [...selected]);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      selected.push(items[i]!);
      walk();
      selected.pop();
      used.delete(i);
    }
  };
  walk();
  return acc;
}

export function integerDistributions(options: {
  ids: readonly string[];
  minTotal: number;
  maxTotal: number;
  caps?: Record<string, number>;
  accept?: (distribution: Record<string, number>, total: number) => boolean;
  limit: number;
}): ChoiceAccumulator<Record<string, number>> {
  const { ids, caps = {}, limit } = options;
  const acc = makeAccumulator<Record<string, number>>(limit);
  const current: Record<string, number> = {};
  const minTotal = Math.max(0, options.minTotal);
  const maxTotal = Math.max(minTotal, options.maxTotal);

  const walk = (index: number, total: number): void => {
    if (acc.truncated) return;
    if (index === ids.length) {
      if (
        total >= minTotal &&
        total <= maxTotal &&
        (!options.accept || options.accept(current, total))
      ) {
        pushLimited(
          acc,
          Object.fromEntries(
            Object.entries(current).filter(([, amount]) => amount > 0)
          )
        );
      }
      return;
    }
    const id = ids[index]!;
    const cap = Math.max(0, caps[id] ?? maxTotal);
    const remainingMax = Math.max(0, maxTotal - total);
    for (let amount = 0; amount <= Math.min(cap, remainingMax); amount++) {
      if (amount > 0) current[id] = amount;
      else delete current[id];
      walk(index + 1, total + amount);
    }
    delete current[id];
  };

  walk(0, 0);
  return acc;
}

export function mergeOptionGroups(
  groups: readonly ActionInputOptions[][],
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(limit);
  const active = groups.filter((group) => group.length > 0);
  if (active.length === 0) return acc;

  const walk = (index: number, merged: ActionInputOptions): void => {
    if (acc.truncated) return;
    if (index === active.length) {
      pushLimited(acc, compactOptions(merged));
      return;
    }
    for (const option of active[index]!) {
      walk(index + 1, mergeTrainingInputOptions(merged, option));
    }
  };

  walk(0, {});
  return acc;
}

export function currentPlayer(state: GameState, playerId: string) {
  return state.players.find((p) => p.id === playerId);
}

export function paymentSourceKey(source: {
  kind: "reserve" | "card";
  instanceId?: string;
}): string {
  return source.kind === "reserve" ? "reserve" : `card:${source.instanceId}`;
}

export type PaymentSourceGenerationOptions = {
  state: GameState;
  playerId: string;
  requiredCost: number;
  reserveAvailable?: number;
  onBoardSources?: readonly {
    instanceId: string;
    availableCoreAmount: number;
    soulCoreAvailable?: boolean;
    destination?: "trash" | "void";
  }[];
  soulOnlySources?: readonly { instanceId: string }[];
  field: "paymentSources" | "payCostPaymentSources" | "summonPaymentSources";
  limit: number;
};

export type TrainingPaymentSource = CorePaymentSourceCapacity;

export function paymentSourcesForTraining(
  options: Omit<PaymentSourceGenerationOptions, "field" | "limit">
): TrainingPaymentSource[] {
  const player = currentPlayer(options.state, options.playerId);
  const reserveNormalCap = Math.min(
    player?.reserveNormalCoreCount ?? 0,
    options.reserveAvailable ?? Number.POSITIVE_INFINITY
  );
  const reserveSoulCap =
    (player?.reserveSoulCoreCount ?? 0) > 0 &&
    (options.reserveAvailable ?? 0) > reserveNormalCap
      ? 1
      : 0;
  const sources: TrainingPaymentSource[] = [];
  if (reserveNormalCap > 0 || reserveSoulCap > 0) {
    sources.push({
      kind: "reserve",
      normalCap: reserveNormalCap,
      soulCap: reserveSoulCap,
    });
  }

  const byKey = new Map<string, TrainingPaymentSource>();
  for (const source of options.onBoardSources ?? []) {
    const normalCap = Math.max(
      0,
      source.availableCoreAmount - (source.soulCoreAvailable ? 1 : 0)
    );
    const candidate = {
      kind: "card" as const,
      instanceId: source.instanceId,
      normalCap,
      soulCap: source.soulCoreAvailable ? (1 as const) : (0 as const),
      ...(source.destination ? { destination: source.destination } : {}),
    };
    byKey.set(paymentSourceKey(candidate), candidate);
  }
  for (const source of options.soulOnlySources ?? []) {
    const key = `card:${source.instanceId}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      kind: "card",
      instanceId: source.instanceId,
      normalCap: existing?.normalCap ?? 0,
      soulCap: 1,
      ...(existing?.destination ? { destination: existing.destination } : {}),
    });
  }
  sources.push(...byKey.values());
  return sources;
}

export { paymentSourceAllocationOptions } from "./core/payment-allocation";

export function generatePaymentSourceOptions(
  options: PaymentSourceGenerationOptions
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(options.limit);
  visitPaymentSourceAllocations(
    paymentSourcesForTraining(options),
    Math.max(0, options.requiredCost),
    (payment) => {
      pushLimited(acc, { [options.field]: payment } as ActionInputOptions);
      return acc.truncated;
    }
  );
  return acc;
}

export function placementSources(options: {
  state: GameState;
  playerId: string;
  excludeInstanceIds?: readonly string[];
  getCardDefinitionById?: CardDefinitionLookup;
  allowedTrashNormalCoreCount?: number;
}): TrainingPlacementSource[] {
  const exclude = new Set(options.excludeInstanceIds ?? []);
  const player = currentPlayer(options.state, options.playerId);
  const sources: ReturnType<typeof placementSources> = [];
  if (
    (player?.reserveNormalCoreCount ?? 0) > 0 ||
    player?.reserveSoulCoreCount
  ) {
    sources.push({
      kind: "reserve",
      normalCap: player?.reserveNormalCoreCount ?? 0,
      soulCap: (player?.reserveSoulCoreCount ?? 0) > 0 ? 1 : 0,
    });
  }
  const allowedTrashNormalCoreCount = options.allowedTrashNormalCoreCount ?? 0;
  if (
    allowedTrashNormalCoreCount > 0 &&
    (player?.trashNormalCoreCount ?? 0) > 0
  ) {
    sources.push({
      kind: "trash",
      normalCap: Math.min(
        player?.trashNormalCoreCount ?? 0,
        allowedTrashNormalCoreCount
      ),
      soulCap: 0,
    });
  }
  for (const card of options.state.cardInstances) {
    if (card.controllerPlayerId !== options.playerId) continue;
    if (card.zone !== "field") continue;
    if (exclude.has(card.instanceId)) continue;
    const definition = options.getCardDefinitionById?.(card.definitionId);
    const normalCap =
      options.getCardDefinitionById === undefined ||
      canProvideEnterFieldCorePlacementSource(
        options.state,
        options.playerId,
        card,
        definition,
        "normal"
      )
        ? card.normalCoreCount
        : 0;
    const soulCap =
      options.getCardDefinitionById === undefined
        ? card.soulCoreCount > 0
          ? 1
          : 0
        : canProvideEnterFieldCorePlacementSource(
              options.state,
              options.playerId,
              card,
              definition,
              "soul"
            )
          ? 1
          : 0;
    if (normalCap <= 0 && soulCap === 0) continue;
    sources.push({
      kind: "card",
      instanceId: card.instanceId,
      normalCap: Math.min(
        normalCap,
        getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.playerId,
          card,
          definition,
          "normal"
        )
      ),
      soulCap: Math.min(
        soulCap,
        getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.playerId,
          card,
          definition,
          "soul"
        )
      ),
      ...(options.state.pendingMultiPlacement?.fieldCoreSourceMinimum
        ? {
            totalCap: getEnterFieldCorePlacementSourceCapacity(
              options.state,
              options.playerId,
              card,
              definition,
              "generic"
            ),
          }
        : {}),
    });
  }
  return sources;
}

export function generatePlacementOptions(options: {
  state: GameState;
  playerId: string;
  minTotal: number;
  maxTotal: number;
  field: "enterFieldCorePlacements" | "summonEnterFieldCorePlacements";
  excludeInstanceIds?: readonly string[];
  getCardDefinitionById?: CardDefinitionLookup;
  allowedTrashNormalCoreCount?: number;
  limit: number;
}): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(options.limit);
  const sources = placementSources(options);
  const selected: EnterFieldCorePlacement[] = [];
  const minTotal = Math.max(0, options.minTotal);
  const maxTotal = Math.max(minTotal, options.maxTotal);

  const walk = (index: number, placed: number): void => {
    if (acc.truncated) return;
    if (placed > maxTotal) return;
    if (index === sources.length) {
      if (placed >= minTotal) {
        pushLimited(acc, {
          [options.field]: selected.map((entry) => ({ ...entry })),
        } as ActionInputOptions);
      }
      return;
    }
    const source = sources[index]!;
    walk(index + 1, placed);
    for (
      let normalAmount = 0;
      normalAmount <= Math.min(source.normalCap, maxTotal - placed);
      normalAmount++
    ) {
      for (let soulAmount = 0; soulAmount <= source.soulCap; soulAmount++) {
        const amount = normalAmount + soulAmount;
        if (amount > (source.totalCap ?? Infinity)) continue;
        if (amount <= 0 || placed + amount > maxTotal) continue;
        const start = selected.length;
        if (source.kind === "reserve") {
          if (normalAmount > 0) {
            selected.push({ kind: "reserve_normal", amount: normalAmount });
          }
          if (soulAmount > 0) selected.push({ kind: "reserve_soul" });
        } else if (source.kind === "card") {
          if (normalAmount > 0) {
            selected.push({
              kind: "card_normal",
              instanceId: source.instanceId!,
              amount: normalAmount,
            });
          }
          if (soulAmount > 0) {
            selected.push({
              kind: "card_soul",
              instanceId: source.instanceId!,
            });
          }
        } else if (normalAmount > 0) {
          selected.push({ kind: "trash_normal", amount: normalAmount });
        }
        walk(index + 1, placed + amount);
        selected.splice(start);
      }
    }
  };

  walk(0, 0);
  return acc;
}

export function targetSelectionsForAction(
  action: AnyAction,
  limit: number
): ChoiceAccumulator<string[]> {
  const targetGroups = targetGroupsValue(action);
  const candidateTargetInstanceIds = stringArrayValue(
    action,
    "candidateTargetInstanceIds"
  );
  const requiredTargetCount = numberValue(action, "requiredTargetCount") ?? 0;
  const maxTargetCount =
    numberValue(action, "maxTargetCount") ?? requiredTargetCount;
  const allowDuplicateTargets = booleanValue(action, "allowDuplicateTargets");
  const mandatory = stringArrayValue(action, "mandatoryTargetInstanceIds");

  if (targetGroups.length > 0) {
    const acc = makeAccumulator<string[]>(limit);
    const walk = (index: number, merged: string[]): void => {
      if (acc.truncated) return;
      if (index === targetGroups.length) {
        if (!mandatory.every((id) => merged.includes(id))) return;
        const assigned = assignLegalActionTargetGroups({
          targetGroups,
          targetInstanceIds: merged,
          allowDuplicateTargets: allowDuplicateTargets === true,
        });
        if (assigned !== null) pushLimited(acc, assigned);
        return;
      }
      const group = targetGroups[index]!;
      const candidates = [...group.candidateTargetInstanceIds].sort(
        (a, b) => Number(mandatory.includes(b)) - Number(mandatory.includes(a))
      );
      const selected: string[] = [];
      const select = (count: number, start: number): void => {
        if (acc.truncated) return;
        if (selected.length === count) {
          walk(index + 1, [...merged, ...selected]);
          return;
        }
        for (
          let candidateIndex = start;
          candidateIndex < candidates.length;
          candidateIndex += 1
        ) {
          const id = candidates[candidateIndex]!;
          if (
            allowDuplicateTargets !== true &&
            (merged.includes(id) || selected.includes(id))
          )
            continue;
          selected.push(id);
          select(
            count,
            allowDuplicateTargets === true ? candidateIndex : candidateIndex + 1
          );
          selected.pop();
          if (acc.truncated) return;
        }
      };
      for (
        let count = group.requiredTargetCount;
        count <= (group.maxTargetCount ?? group.requiredTargetCount);
        count += 1
      ) {
        select(count, 0);
        if (acc.truncated) return;
      }
    };
    walk(0, []);
    return acc;
  }

  if (allowDuplicateTargets) {
    const acc = makeAccumulator<string[]>(limit);
    const candidates = [...candidateTargetInstanceIds].sort(
      (a, b) => Number(mandatory.includes(b)) - Number(mandatory.includes(a))
    );
    const selected: string[] = [];
    const walk = (count: number): void => {
      if (acc.truncated) return;
      if (selected.length === count) {
        if (mandatory.every((id) => selected.includes(id))) {
          pushLimited(acc, [...selected]);
        }
        return;
      }
      for (const id of candidates) {
        selected.push(id);
        walk(count);
        selected.pop();
        if (acc.truncated) return;
      }
    };
    for (
      let count = Math.max(requiredTargetCount, new Set(mandatory).size);
      count <= maxTargetCount;
      count += 1
    ) {
      walk(count);
      if (acc.truncated) break;
    }
    return acc;
  }

  const candidateSet = new Set(candidateTargetInstanceIds);
  const fixedMandatory = mandatory.filter((id) => candidateSet.has(id));
  const rest = candidateTargetInstanceIds.filter(
    (id) => !fixedMandatory.includes(id)
  );
  const min = Math.max(0, requiredTargetCount - fixedMandatory.length);
  const max = Math.max(min, maxTargetCount - fixedMandatory.length);
  const combos = combinations(rest, min, max, limit);
  return {
    ...combos,
    values: combos.values.map((choice) => [...fixedMandatory, ...choice]),
  };
}

export function targetInputGroup(
  action: LegalAction,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  const a = actionRecord(action);
  const isPendingTargetSelectionAction =
    action.kind === "resolve_pending_effect_target" ||
    action.kind === "resolve_pending_step_optional_target_selection" ||
    action.kind === "resolve_borrowed_effect_target";
  if (a.targetMode !== "manual" && !isPendingTargetSelectionAction) {
    return null;
  }
  const candidates = stringArrayValue(a, "candidateTargetInstanceIds");
  const required = numberValue(a, "requiredTargetCount") ?? 0;
  if (candidates.length === 0 && required > 0) return null;
  const selections = targetSelectionsForAction(a, limit);
  return {
    ...selections,
    values: selections.values.map((targetInstanceIds) => ({
      targetInstanceIds,
    })),
  };
}

export function chosenLifeCoreGroup(action: LegalAction): ActionInputOptions[] {
  const a = actionRecord(action);
  if (booleanValue(a, "requiresChosenLifeCoreKind") !== true) return [];
  const kinds = a.availableChosenLifeCoreKinds;
  if (
    !Array.isArray(kinds) ||
    !kinds.every((kind) => kind === "normal" || kind === "soul")
  ) {
    return [];
  }
  return (kinds as LifeCoreKind[]).map((chosenLifeCoreKind) => ({
    chosenLifeCoreKind,
  }));
}

export function topLevelPaymentRequest(
  state: GameState,
  action: LegalAction
): Omit<PaymentSourceGenerationOptions, "field" | "limit"> | null {
  const a = actionRecord(action);
  if (
    action.kind === "summon" &&
    (booleanValue(a, "opensCostExcludeChoice") ||
      booleanValue(a, "opensCostCoreMoveChoice"))
  ) {
    return null;
  }
  const finalCost = numberValue(a, "finalCost");
  if (finalCost === undefined) return null;
  if (action.kind === "use_magic" && a.costMode === "free") return null;
  return {
    state,
    playerId: action.actingPlayerId,
    requiredCost: finalCost,
    reserveAvailable: numberValue(a, "availableReserveCoreAmount") ?? 0,
    onBoardSources:
      (a.availableOnBoardCoreSources as
        | Parameters<typeof generatePaymentSourceOptions>[0]["onBoardSources"]
        | undefined) ?? [],
    soulOnlySources:
      (a.availableSoulCoreOnlySources as
        | Parameters<typeof generatePaymentSourceOptions>[0]["soulOnlySources"]
        | undefined) ?? [],
  };
}

export function topLevelPaymentSourcesAreCompletable(
  state: GameState,
  action: LegalAction,
  paymentSources: readonly CardCostPaymentSource[],
  getCardDefinitionById?: CardDefinitionLookup
): boolean {
  if (
    (action.kind !== "summon" && action.kind !== "place_nexus") ||
    !getCardDefinitionById
  ) {
    return true;
  }

  const definition = getCardDefinitionById(action.sourceDefinitionId);
  if (!definition) return true;
  const trashGrant = getSummonTrashCorePlacementGrant(
    state,
    action.actingPlayerId,
    definition
  );
  const common = {
    state,
    actingPlayerId: action.actingPlayerId,
    paymentSources,
    minimumEnterFieldCoreCount: action.minimumEnterFieldCoreCount,
    getCardDefinitionById,
    ...(action.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
      : {}),
    ...(trashGrant ? { allowedTrashNormalCoreCount: trashGrant.amount } : {}),
  };
  if (action.kind === "summon" && definition.tenshoSummon) {
    return canCompleteTenshoSummonAfterCostPayment({ ...common, definition });
  }

  const card = state.cardInstances.find(
    (candidate) => candidate.instanceId === action.sourceInstanceId
  );
  return (
    card !== undefined &&
    canCompleteHandPlayAfterCostPayment({ ...common, card, definition })
  );
}

export function topLevelPaymentGroup(
  state: GameState,
  action: LegalAction,
  limit: number,
  getCardDefinitionById?: CardDefinitionLookup
): ChoiceAccumulator<ActionInputOptions> | null {
  if (
    action.kind === "summon" &&
    getCardDefinitionById &&
    findTokenPoolPreCostForcedCombineTrigger(
      state,
      action.actingPlayerId,
      action.sourceInstanceId,
      getCardDefinitionById
    )
  )
    return null;
  const request = topLevelPaymentRequest(state, action);
  if (!request) return null;
  const generated = generatePaymentSourceOptions({
    ...request,
    field: "paymentSources",
    limit,
  });
  return {
    ...generated,
    values: generated.values.filter((input) =>
      topLevelPaymentSourcesAreCompletable(
        state,
        action,
        input.paymentSources ?? [],
        getCardDefinitionById
      )
    ),
  };
}

export function summonCostExcludePaymentRequest(
  state: GameState,
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >,
  selectedCardInstanceIds: readonly string[]
): Omit<PaymentSourceGenerationOptions, "field" | "limit"> {
  const selectedIds = new Set(selectedCardInstanceIds);
  const minCount = action.minCount ?? 0;
  if (
    selectedIds.size !== selectedCardInstanceIds.length ||
    selectedCardInstanceIds.length < minCount ||
    selectedCardInstanceIds.length > action.maxCount ||
    selectedCardInstanceIds.some(
      (id) => !action.candidateCardInstanceIds.includes(id)
    )
  ) {
    throw new Error("Training summon-cost-exclude selection is invalid");
  }
  const requiredCost =
    action.fullCostPaid && selectedCardInstanceIds.length > 0
      ? (action.remainingPaymentCost ?? 0)
      : action.fullReduction && selectedCardInstanceIds.length > 0
        ? (action.fullReductionCost ?? action.reducedCost)
        : Math.max(
            0,
            action.reducedCost -
              selectedCardInstanceIds.length * action.discountPerCard
          );
  return {
    state,
    playerId: action.actingPlayerId,
    requiredCost,
    reserveAvailable: action.availableReserveCoreAmount,
    // The selected card has already left the field when payment is applied.
    // Do not generate a phantom source that pays with the same card being
    // excluded as this atomic cost replacement.
    onBoardSources: action.availableOnBoardCoreSources.filter(
      (source) => !selectedIds.has(source.instanceId)
    ),
    soulOnlySources: action.availableSoulCoreOnlySources.filter(
      (source) => !selectedIds.has(source.instanceId)
    ),
  };
}

export function summonCostExcludePaymentChoicesForSelection(
  state: GameState,
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >,
  selectedCardInstanceIds: readonly string[],
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  return generatePaymentSourceOptions({
    ...summonCostExcludePaymentRequest(state, action, selectedCardInstanceIds),
    field: "paymentSources",
    limit,
  });
}

/**
 * `zone_discount_variable` は legal action が最大軽減時の `additionalCost` を持つ一方、
 * 実際の支払額は同時に選ぶ `selectedZoneCardIds` の枚数で決まる。最大軽減額を
 * 差し引いて、通常の追加コスト（相手のマジック税など）を復元してから組み合わせる。
 * そのため通常の topLevelPaymentGroup と独立に、選択枚数ごとの支払いを 1 つの
 * training input として列挙する。
 */
export function variableZoneDiscountMagicPaymentRequest(
  state: GameState,
  action: Extract<LegalAction, { kind: "use_magic" }>,
  selectedZoneCardIds: readonly string[]
): Omit<PaymentSourceGenerationOptions, "field" | "limit"> | null {
  if (action.costMode !== "zone_discount_variable") return null;
  const discountPerCard = action.zoneCostDiscountPerCard;
  const maxCount = action.zoneCostPaymentMaxCount;
  const candidateIds = action.zoneCostPaymentCandidateIds ?? [];
  if (
    discountPerCard === undefined ||
    maxCount === undefined ||
    maxCount <= 0
  ) {
    return null;
  }

  const selectedIds = new Set(selectedZoneCardIds);
  if (
    selectedIds.size !== selectedZoneCardIds.length ||
    selectedZoneCardIds.length > maxCount ||
    selectedZoneCardIds.some((id) => !candidateIds.includes(id))
  ) {
    throw new Error("Training variable zone-discount selection is invalid");
  }

  // availability は variable zone discount を最大枚数ぶん additionalCost に織り込む。
  // それ以外の additional cost は選択枚数によらないので、ここで分離して保持する。
  const bestCaseCount = Math.min(maxCount, candidateIds.length);
  const fixedAdditionalCost =
    action.additionalCost - discountPerCard * bestCaseCount;
  const requiredCost = Math.max(
    0,
    action.reducedCost +
      fixedAdditionalCost +
      discountPerCard * selectedZoneCardIds.length
  );
  return {
    state,
    playerId: action.actingPlayerId,
    requiredCost,
    reserveAvailable: action.availableReserveCoreAmount,
    onBoardSources: action.availableOnBoardCoreSources.filter(
      (source) => !selectedIds.has(source.instanceId)
    ),
    soulOnlySources: action.availableSoulCoreOnlySources.filter(
      (source) => !selectedIds.has(source.instanceId)
    ),
  };
}

export function variableZoneDiscountMagicPaymentChoicesForSelection(
  state: GameState,
  action: Extract<LegalAction, { kind: "use_magic" }>,
  selectedZoneCardIds: readonly string[],
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  const request = variableZoneDiscountMagicPaymentRequest(
    state,
    action,
    selectedZoneCardIds
  );
  if (!request) return null;
  return generatePaymentSourceOptions({
    ...request,
    field: "paymentSources",
    limit,
  });
}

export function variableZoneDiscountMagicPaymentGroup(
  state: GameState,
  action: LegalAction,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  if (action.kind !== "use_magic") return null;
  if (action.costMode !== "zone_discount_variable") return null;

  const maxCount = action.zoneCostPaymentMaxCount;
  const candidateIds = action.zoneCostPaymentCandidateIds ?? [];
  if (maxCount === undefined || maxCount <= 0) return null;

  const acc = makeAccumulator<ActionInputOptions>(limit);

  // limit は生の破棄組合せではなく、支払可能な完全入力に適用する。
  // 上限到達後も次の完全入力を探し、残りが不払可能なら truncated は false。
  for (const selectedZoneCardIds of iterateCombinations(
    candidateIds,
    0,
    maxCount
  )) {
    const payments = variableZoneDiscountMagicPaymentChoicesForSelection(
      state,
      action,
      selectedZoneCardIds,
      Math.max(1, limit - acc.values.length)
    );
    if (!payments) return null;
    for (const payment of payments.values) {
      pushLimited(acc, {
        selectedZoneCardIds: [...selectedZoneCardIds],
        ...payment,
      });
      if (acc.truncated) return acc;
    }
    if (payments.truncated) {
      acc.truncated = true;
      return acc;
    }
  }
  return acc;
}

export function payCostGroup(
  _state: GameState,
  action: LegalAction,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  const a = actionRecord(action);
  const amount = numberValue(a, "requiredPayCostAmount");
  if (!amount || amount <= 0) return null;
  // 効果文の支払い選択は窓後の共通pendingで列挙する。
  const payment: ChoiceAccumulator<ActionInputOptions> = {
    values: [],
    truncated: false,
    limit,
  };
  pushLimited(payment, { deferPayCostSourceSelection: true });
  return payment;
}

export function actionAttackExhaustCostSourceIds(
  action: LegalAction
): string[] {
  const a = actionRecord(action);
  const multi = stringArrayValue(a, "attackExhaustCostSourceInstanceIds");
  if (multi.length > 0) return multi;
  const single = a.attackExhaustCostSourceInstanceId;
  return typeof single === "string" ? [single] : [];
}

export function attackExhaustCostSelectionValue(
  selectedIds: readonly string[]
): string | string[] | undefined {
  if (selectedIds.length === 0) return undefined;
  return selectedIds.length === 1 ? selectedIds[0]! : [...selectedIds];
}

export function additionalAttackExhaustCostAssignments(options: {
  state: GameState;
  action: LegalAction;
  additionalSourceInstanceIds: readonly string[];
  getCardDefinitionById: CardDefinitionLookup | undefined;
  limit: number;
}): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(options.limit);
  const sourceInstanceId = actionRecord(options.action).sourceInstanceId;
  if (typeof sourceInstanceId !== "string") return acc;
  const declaredParticipantIds = new Set([
    sourceInstanceId,
    ...options.additionalSourceInstanceIds,
  ]);
  const usedCostSourceIds = new Set(
    actionAttackExhaustCostSourceIds(options.action)
  );
  const assignments: Record<string, string | string[]> = {};

  const pushAssignment = (): void => {
    pushLimited(acc, {
      additionalSourceInstanceIds: [...options.additionalSourceInstanceIds],
      ...(Object.keys(assignments).length > 0
        ? {
            additionalAttackExhaustCostSourceInstanceIds: { ...assignments },
          }
        : {}),
    });
  };

  if (!options.getCardDefinitionById) {
    pushAssignment();
    return acc;
  }

  const walk = (index: number): void => {
    if (acc.truncated) return;
    if (index === options.additionalSourceInstanceIds.length) {
      pushAssignment();
      return;
    }

    const additionalId = options.additionalSourceInstanceIds[index]!;
    const additionalCard = getCardById(options.state, additionalId);
    if (!additionalCard) return;
    const requiredCount = getRequiredAttackExhaustCostCount(
      options.state,
      additionalCard,
      options.getCardDefinitionById!
    );
    const excluded = new Set([...declaredParticipantIds, ...usedCostSourceIds]);
    const candidates = getRequiredAttackExhaustCostSourceCandidates(
      options.state,
      additionalCard,
      options.getCardDefinitionById!,
      excluded
    );
    if (candidates === null || requiredCount === 0) {
      walk(index + 1);
      return;
    }
    if (!Number.isFinite(requiredCount) || requiredCount < 0) return;

    const selections = combinations(
      candidates,
      requiredCount,
      requiredCount,
      options.limit
    );
    const selectionsTruncated = selections.truncated;
    for (const selectedIds of selections.values) {
      const value = attackExhaustCostSelectionValue(selectedIds);
      if (value === undefined) continue;
      assignments[additionalId] = value;
      for (const selectedId of selectedIds) usedCostSourceIds.add(selectedId);
      walk(index + 1);
      for (const selectedId of selectedIds)
        usedCostSourceIds.delete(selectedId);
      delete assignments[additionalId];
      if (acc.truncated) break;
    }
    if (selectionsTruncated) acc.truncated = true;
  };

  walk(0);
  return acc;
}

export function attackAdditionalSourceGroup(
  state: GameState,
  action: LegalAction,
  getCardDefinitionById: CardDefinitionLookup | undefined,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  if (action.kind !== "attack") return null;
  const option = action.simultaneousAttackOption;
  const fixedAdditionalSourceInstanceIds = stringArrayValue(
    actionRecord(action),
    "additionalSourceInstanceIds"
  );
  if (!option && fixedAdditionalSourceInstanceIds.length === 0) return null;
  const maxAdditional = option
    ? Math.max(0, option.maxCount - 1)
    : fixedAdditionalSourceInstanceIds.length;
  const selections = combinations(
    option?.candidateInstanceIds ?? fixedAdditionalSourceInstanceIds,
    option ? 0 : fixedAdditionalSourceInstanceIds.length,
    maxAdditional,
    limit
  );
  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (selections.truncated) acc.truncated = true;
  for (const additionalSourceInstanceIds of selections.values) {
    const assignments = additionalAttackExhaustCostAssignments({
      state,
      action,
      additionalSourceInstanceIds,
      getCardDefinitionById,
      limit,
    });
    if (assignments.truncated) acc.truncated = true;
    for (const value of assignments.values) pushLimited(acc, value);
  }
  return acc;
}

export function braveSeparationCoreGroup(
  state: GameState,
  action: LegalAction,
  getCardDefinitionById: CardDefinitionLookup | undefined,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  const braveInstanceId =
    action.kind === "brave_separate"
      ? action.braveInstanceId
      : action.kind === "resolve_brave_leave_choice" &&
          action.choice === "keep" &&
          action.braveInstanceIds.length === 1
        ? action.braveInstanceIds[0]!
        : null;
  if (braveInstanceId === null) return null;
  if (!getCardDefinitionById) return null;
  const brave = getCardById(state, braveInstanceId);
  if (!brave) return null;
  const currentCores = brave.normalCoreCount + brave.soulCoreCount;
  const needed = Math.max(0, brave.minimumRequiredCores - currentCores);
  if (needed <= 0) return null;

  const sources = getAvailableBraveSeparationCoreSources(
    state,
    action.actingPlayerId,
    braveInstanceId,
    getCardDefinitionById
  );
  const totalAvailable = sources.reduce(
    (total, source) => total + source.available,
    0
  );
  if (totalAvailable < needed) return null;

  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const distributions = integerDistributions({
    ids: sources.map((source) => source.key),
    minTotal: needed,
    maxTotal: needed,
    caps: Object.fromEntries(
      sources.map((source) => [source.key, source.available])
    ),
    limit,
  });

  return {
    ...distributions,
    values: distributions.values.flatMap((distribution) => {
      const drafts: DraftCoreMove[] = [];
      for (const [key, amount] of Object.entries(distribution)) {
        if (amount <= 0) continue;
        const source = sourceByKey.get(key);
        if (!source) return [];
        drafts.push({
          kind: "normal",
          from: source.container,
          to: { kind: "card", instanceId: braveInstanceId },
          amount,
          purpose: "separation",
        });
      }
      const recomposed = recomposeBraveSeparationLegalAction(drafts);
      return [
        {
          separateCoreDistribution: recomposed.separateCoreDistribution,
        },
      ];
    }),
  };
}

export function boundedEnterFieldMax(
  minimumCoreCount: number,
  maximumCoreCount: number | null
): number {
  return maximumCoreCount ?? Math.max(minimumCoreCount, 12);
}

export function hasNonEmptyPlacementChoice(
  choices: readonly (readonly EnterFieldCorePlacement[])[]
): boolean {
  return choices.some((placements) => placements.length > 0);
}

export function sourceFollowUpPlacementGroup(
  state: GameState,
  action: LegalAction,
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  if (
    action.kind !== "resolve_pending_burst_check" ||
    !action.playsSourceCardWithoutCostAfterResolve ||
    action.enterFieldCorePlacementRule === "forbidden"
  ) {
    return null;
  }
  const sourceInstanceId =
    typeof action.sourceInstanceId === "string"
      ? action.sourceInstanceId
      : undefined;
  const generated = generatePlacementOptions({
    state,
    playerId: action.actingPlayerId,
    minTotal: action.minimumEnterFieldCoreCount,
    maxTotal: boundedEnterFieldMax(
      action.minimumEnterFieldCoreCount,
      action.maximumEnterFieldCoreCount
    ),
    field: "enterFieldCorePlacements",
    ...(sourceInstanceId ? { excludeInstanceIds: [sourceInstanceId] } : {}),
    ...(opts.getCardDefinitionById
      ? { getCardDefinitionById: opts.getCardDefinitionById }
      : {}),
    limit,
  });
  if (
    action.minimumEnterFieldCoreCount <= 0 &&
    !hasNonEmptyPlacementChoice(
      generated.values.map((value) => value.enterFieldCorePlacements ?? [])
    )
  ) {
    return null;
  }
  return generated;
}

export function followUpTargetSelectionNeedsInput(options: {
  targetMode: unknown;
  requiredTargetCount: number;
  maxTargetCount?: number;
}): boolean {
  if (options.targetMode !== "manual") return false;
  const maxTargetCount = options.maxTargetCount ?? options.requiredTargetCount;
  return options.requiredTargetCount > 0 || maxTargetCount > 0;
}

export function followUpTargetSelectionChoices(
  option: ResolvePendingBurstCheckAction["targetFollowUpMagicOptions"][number],
  limit: number
): ChoiceAccumulator<string[] | undefined> {
  const acc = makeAccumulator<string[] | undefined>(limit);
  if (!followUpTargetSelectionNeedsInput(option)) {
    pushLimited(acc, undefined);
    return acc;
  }
  const selections = targetSelectionsForAction(
    option as unknown as AnyAction,
    limit
  );
  if (selections.truncated) acc.truncated = true;
  for (const ids of selections.values) {
    pushLimited(acc, ids);
  }
  return acc;
}

export function followUpLifeCoreChoices(
  option: ResolvePendingBurstCheckAction["targetFollowUpMagicOptions"][number]
): Array<LifeCoreKind | undefined> {
  if (option.requiresChosenLifeCoreKind !== true) return [undefined];
  const kinds = option.availableChosenLifeCoreKinds.filter(
    (kind): kind is LifeCoreKind => kind === "normal" || kind === "soul"
  );
  return kinds;
}

export function singleTargetFollowUpMagicGroup(
  action: ResolvePendingBurstCheckAction,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  if (
    !action.usesTargetCardWithoutCostAfterResolve ||
    action.targetFollowUpMagicOptions.length !== 1
  ) {
    return null;
  }
  const option = action.targetFollowUpMagicOptions[0]!;
  const targetSelections = followUpTargetSelectionChoices(option, limit);
  const lifeChoices = followUpLifeCoreChoices(option);
  if (lifeChoices.length === 0) return makeAccumulator(limit);
  if (
    !followUpTargetSelectionNeedsInput(option) &&
    option.requiresChosenLifeCoreKind !== true
  ) {
    return null;
  }
  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (targetSelections.truncated) acc.truncated = true;
  for (const followUpTargetInstanceIds of targetSelections.values) {
    for (const followUpChosenLifeCoreKind of lifeChoices) {
      pushLimited(acc, {
        ...(followUpTargetInstanceIds !== undefined
          ? { followUpTargetInstanceIds }
          : {}),
        ...(followUpChosenLifeCoreKind !== undefined
          ? { followUpChosenLifeCoreKind }
          : {}),
      });
    }
  }
  return acc;
}

export function perTargetFollowUpMagicChoiceGroup(
  option: ResolvePendingBurstCheckAction["targetFollowUpMagicOptions"][number],
  limit: number
): ChoiceAccumulator<FollowUpPerTargetInput[]> | null {
  const needsTarget = followUpTargetSelectionNeedsInput(option);
  const needsLife = option.requiresChosenLifeCoreKind === true;
  if (!needsTarget && !needsLife) return null;

  const targetSelections = followUpTargetSelectionChoices(option, limit);
  const lifeChoices = followUpLifeCoreChoices(option);
  const acc = makeAccumulator<FollowUpPerTargetInput[]>(limit);
  if (targetSelections.truncated) acc.truncated = true;
  if (lifeChoices.length === 0) return acc;

  for (const followUpTargetInstanceIds of targetSelections.values) {
    for (const followUpChosenLifeCoreKind of lifeChoices) {
      pushLimited(acc, [
        {
          targetInstanceId: option.targetInstanceId,
          ...(needsTarget && followUpTargetInstanceIds !== undefined
            ? { followUpTargetInstanceIds }
            : {}),
          ...(followUpChosenLifeCoreKind !== undefined
            ? { followUpChosenLifeCoreKind }
            : {}),
        },
      ]);
    }
  }
  return acc;
}

export function perTargetPlacementChoiceGroup(
  state: GameState,
  action: ResolvePendingBurstCheckAction,
  option: ResolvePendingBurstCheckAction["targetEnterFieldCorePlacementOptions"][number],
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<FollowUpPerTargetInput[]> | null {
  if (option.enterFieldCorePlacementRule === "forbidden") return null;
  const generated = generatePlacementOptions({
    state,
    playerId: action.actingPlayerId,
    minTotal: option.minimumEnterFieldCoreCount,
    maxTotal: boundedEnterFieldMax(
      option.minimumEnterFieldCoreCount,
      option.maximumEnterFieldCoreCount
    ),
    field: "enterFieldCorePlacements",
    excludeInstanceIds: action.targetEnterFieldCorePlacementOptions.map(
      (targetOption) => targetOption.targetInstanceId
    ),
    ...(opts.getCardDefinitionById
      ? { getCardDefinitionById: opts.getCardDefinitionById }
      : {}),
    limit,
  });
  const placementChoices = generated.values.map(
    (value) => value.enterFieldCorePlacements ?? []
  );
  if (
    option.minimumEnterFieldCoreCount <= 0 &&
    !hasNonEmptyPlacementChoice(placementChoices)
  ) {
    return null;
  }
  return {
    ...generated,
    values: placementChoices.map((enterFieldCorePlacements) => [
      {
        targetInstanceId: option.targetInstanceId,
        enterFieldCorePlacements,
      },
    ]),
  };
}

export function combineFollowUpPerTargetGroups(
  groups: readonly (ChoiceAccumulator<FollowUpPerTargetInput[]> | null)[],
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  const liveGroups = groups
    .filter((group): group is ChoiceAccumulator<FollowUpPerTargetInput[]> =>
      Boolean(group)
    )
    .filter((group) => group.values.length > 0);
  if (liveGroups.length === 0) return null;

  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (liveGroups.some((group) => group.truncated)) acc.truncated = true;

  const walk = (
    index: number,
    followUpPerTargetInputs: FollowUpPerTargetInput[]
  ): void => {
    if (acc.truncated) return;
    if (index === liveGroups.length) {
      pushLimited(acc, {
        followUpPerTargetInputs:
          mergeFollowUpPerTargetInputs(followUpPerTargetInputs, []) ?? [],
      });
      return;
    }
    for (const value of liveGroups[index]!.values) {
      walk(
        index + 1,
        mergeFollowUpPerTargetInputs(followUpPerTargetInputs, value) ?? []
      );
    }
  };

  walk(0, []);
  return acc;
}

export function perTargetFollowUpInputGroup(
  state: GameState,
  action: ResolvePendingBurstCheckAction,
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  const magicGroups =
    action.usesTargetCardWithoutCostAfterResolve &&
    action.targetFollowUpMagicOptions.length > 1
      ? action.targetFollowUpMagicOptions.map((option) =>
          perTargetFollowUpMagicChoiceGroup(option, limit)
        )
      : [];
  const placementGroups = action.playsTargetCardWithoutCostAfterResolve
    ? action.targetEnterFieldCorePlacementOptions.map((option) =>
        perTargetPlacementChoiceGroup(state, action, option, opts, limit)
      )
    : [];
  return combineFollowUpPerTargetGroups(
    [...magicGroups, ...placementGroups],
    limit
  );
}

export function followUpInputGroup(
  state: GameState,
  action: LegalAction,
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<ActionInputOptions> | null {
  if (action.kind !== "resolve_pending_burst_check") return null;
  return fieldChoicesFromGroups(
    [
      sourceFollowUpPlacementGroup(state, action, opts, limit),
      singleTargetFollowUpMagicGroup(action, limit),
      perTargetFollowUpInputGroup(state, action, opts, limit),
    ],
    limit
  );
}

export function withOptionalSkipChoices(
  action: LegalAction,
  generated: ChoiceAccumulator<ActionInputOptions>,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const a = actionRecord(action);
  const skipOnly = a.skipOnly === true;
  const canSkipDuplicate =
    a.canSkipDuplicate === true &&
    (action.kind !== "select_pending_to_resolve" ||
      action.ownerPlayerId === action.actingPlayerId);
  if (a.executionMode !== "optional" && !skipOnly && !canSkipDuplicate)
    return generated;

  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (!skipOnly) {
    const executeValues = generated.values.length > 0 ? generated.values : [{}];
    for (const option of executeValues) {
      pushLimited(acc, { ...option, skipOptionalEffect: false });
    }
  }
  pushLimited(acc, { skipOptionalEffect: true });
  acc.truncated = generated.truncated || acc.truncated;
  return acc;
}

export function fieldChoicesFromGroups(
  groups: readonly (ChoiceAccumulator<ActionInputOptions> | null)[],
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const liveGroups = groups
    .filter((group): group is ChoiceAccumulator<ActionInputOptions> =>
      Boolean(group)
    )
    .filter((group) => group.values.length > 0);
  const merged = mergeOptionGroups(
    liveGroups.map((group) => group.values),
    limit
  );
  if (liveGroups.some((group) => group.truncated)) merged.truncated = true;
  return merged;
}

export function generateTopLevelActionInputChoices(
  state: GameState,
  action: LegalAction,
  opts: ActionInputChoiceContext,
  limit: number,
  options: { includeTargetInput?: boolean } = {}
): ChoiceAccumulator<ActionInputOptions> {
  const variableZoneDiscountPayments = variableZoneDiscountMagicPaymentGroup(
    state,
    action,
    limit
  );
  const groups = [
    options.includeTargetInput === false
      ? null
      : (opts.getTargetInput?.(state, action, limit) ??
        targetInputGroup(action, limit)),
    variableZoneDiscountPayments ??
      topLevelPaymentGroup(state, action, limit, opts.getCardDefinitionById),
    payCostGroup(state, action, limit),
    attackAdditionalSourceGroup(
      state,
      action,
      opts.getCardDefinitionById,
      limit
    ),
    braveSeparationCoreGroup(state, action, opts.getCardDefinitionById, limit),
    followUpInputGroup(state, action, opts, limit),
    { values: chosenLifeCoreGroup(action), truncated: false, limit },
  ];
  return withOptionalSkipChoices(
    action,
    fieldChoicesFromGroups(groups, limit),
    limit
  );
}

export function deckRevealPickChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_deck_reveal_pick" }>,
  getCardDefinitionById: CardDefinitionLookup | undefined,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const base = makeAccumulator<ActionInputOptions>(limit);
  const addDestinations = (selectedDeckRevealCardIds: string[]): void => {
    const destinations =
      action.requiresFreeDestinationChoice &&
      selectedDeckRevealCardIds.length > 0
        ? (action.freeDestinationChoices ?? (["hand", "set_aside"] as const))
        : ([undefined] as const);
    for (const destination of destinations) {
      const input = {
        selectedDeckRevealCardIds,
        ...(destination ? { deckRevealPickFreeDestination: destination } : {}),
      };
      const pending = state.pendingDeckReveal;
      const cost =
        pending && getCardDefinitionById
          ? getDeckRevealSelectedHandGainCost(
              state,
              pending,
              selectedDeckRevealCardIds,
              destination,
              getCardDefinitionById
            )
          : 0;
      if (cost > 0 && pending && getCardDefinitionById) {
        const available = getDeckRevealCostPaymentSources(
          state,
          pending,
          getCardDefinitionById
        );
        const payments = generatePaymentSourceOptions({
          state,
          playerId: action.actingPlayerId,
          requiredCost: cost,
          reserveAvailable: available.reserveSource.availableCoreAmount,
          onBoardSources: available.onBoardCoreSources,
          soulOnlySources: available.soulCoreOnlySources,
          field: "paymentSources",
          limit,
        });
        base.truncated ||= payments.truncated;
        for (const payment of payments.values)
          pushLimited(base, { ...input, ...payment });
      } else {
        pushLimited(base, input);
      }
    }
  };

  if (action.exclusiveGroupBranches?.length) {
    if (action.canSkip) addDestinations([]);
    for (const branch of action.exclusiveGroupBranches) {
      const picks = combinations(
        branch.candidateCardInstanceIds,
        branch.count,
        branch.count,
        limit
      );
      if (picks.truncated) base.truncated = true;
      for (const pick of picks.values) addDestinations(pick);
    }
  } else {
    const min = action.canSkip ? 0 : Math.min(action.maxPickCount, 1);
    const combos = combinations(
      action.candidateCardInstanceIds,
      min,
      action.maxPickCount,
      limit,
      state.pendingDeckReveal?.phase === "revealed_choice"
        ? (selection) =>
            isDeckRevealRevealedChoiceGroupSelectionValid(
              state.pendingDeckReveal!,
              selection
            )
        : undefined
    );
    if (combos.truncated) base.truncated = true;
    for (const combo of combos.values) addDestinations(combo);
  }

  const pending = state.pendingDeckReveal;
  if (
    pending?.phase !== "revealed_choice" ||
    pending.actingPlayerId !== action.actingPlayerId
  ) {
    return base;
  }

  const dispositionMap = pending.revealedDispositionMap ?? {};
  if (!getCardDefinitionById) {
    // An effect-set mirage must carry its individual payment map.  Do not
    // expose a choice that the action executor would reject when a caller has
    // not supplied the card lookup needed to construct that map.
    return {
      ...base,
      values: base.values.filter(
        (pick) =>
          !(pick.selectedDeckRevealCardIds ?? []).some(
            (instanceId) => dispositionMap[instanceId]?.kind === "set_as_mirage"
          )
      ),
    };
  }

  const acc = makeAccumulator<ActionInputOptions>(limit);
  let sourceChoicesTruncated = base.truncated;
  for (const pick of base.values) {
    const mirageSetIds = (pick.selectedDeckRevealCardIds ?? []).filter(
      (instanceId) => dispositionMap[instanceId]?.kind === "set_as_mirage"
    );
    if (mirageSetIds.length === 0) {
      pushLimited(acc, pick);
      continue;
    }

    const addPaymentChoices = (
      index: number,
      paymentState: GameState,
      paymentsByInstanceId: NonNullable<
        ActionInputOptions["deckRevealMiragePaymentSourcesByInstanceId"]
      >
    ): void => {
      if (acc.truncated) return;
      if (index === mirageSetIds.length) {
        pushLimited(acc, {
          ...pick,
          deckRevealMiragePaymentSourcesByInstanceId: paymentsByInstanceId,
        });
        return;
      }

      const instanceId = mirageSetIds[index]!;
      const card = getCardById(paymentState, instanceId);
      const definition = card
        ? getCardDefinitionById(card.definitionId)
        : undefined;
      if (!definition?.mirageData) return;

      const available = getAvailableMiragePaymentSources({
        state: paymentState,
        actingPlayerId: action.actingPlayerId,
        mirageData: definition.mirageData,
        sourceInstanceId: instanceId,
        getCardDefinitionById,
      });
      if (!available.canFullyPay) return;

      const paymentChoices = generatePaymentSourceOptions({
        state: paymentState,
        playerId: action.actingPlayerId,
        requiredCost: available.reduction.finalCost,
        reserveAvailable: available.reserveSource.availableCoreAmount,
        onBoardSources: available.onBoardCoreSources,
        soulOnlySources: available.soulCoreOnlySources,
        field: "paymentSources",
        limit: acc.limit,
      });
      sourceChoicesTruncated ||= paymentChoices.truncated;
      for (const paymentChoice of paymentChoices.values) {
        const paymentSources = paymentChoice.paymentSources ?? [];
        try {
          const nextPaymentState = applyCardCostPayments({
            state: paymentState,
            actingPlayerId: action.actingPlayerId,
            chainId: `training:deck-reveal-mirage:${pending.pendingId}:${instanceId}`,
            paymentSources,
            getCardDefinitionById,
          });
          addPaymentChoices(index + 1, nextPaymentState, {
            ...paymentsByInstanceId,
            [instanceId]: paymentSources,
          });
        } catch {
          // Keep the training surface fail-closed if a generated source stops
          // being valid after an earlier effect-set payment.
        }
      }
    };

    addPaymentChoices(0, state, {});
  }
  acc.truncated ||= sourceChoicesTruncated;
  return acc;
}

export function deckRevealOrderChoices(
  action: Extract<LegalAction, { kind: "resolve_pending_deck_reveal_order" }>,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (action.remainder === "bottom_or_trash") {
    pushLimited(acc, {
      deckRevealRemainderOrder: [...action.remainingCardInstanceIds],
      deckRevealPlacement: "trash",
    });
    const bottomOrders = permutations(action.remainingCardInstanceIds, limit);
    acc.truncated ||= bottomOrders.truncated;
    for (const deckRevealRemainderOrder of bottomOrders.values)
      pushLimited(acc, {
        deckRevealRemainderOrder,
        deckRevealPlacement: "bottom",
      });
    return acc;
  }
  const orders = permutations(action.remainingCardInstanceIds, limit);
  if (orders.truncated) acc.truncated = true;
  for (const deckRevealRemainderOrder of orders.values) {
    if (action.remainder === "top_or_bottom") {
      pushLimited(acc, {
        deckRevealRemainderOrder,
        deckRevealPlacement: "top",
      });
      pushLimited(acc, {
        deckRevealRemainderOrder,
        deckRevealPlacement: "bottom",
      });
    } else if (action.remainder === "top_bottom_split") {
      const placements = combinations(
        action.remainingCardInstanceIds,
        0,
        action.remainingCardInstanceIds.length,
        Math.max(1, limit - acc.values.length)
      );
      if (placements.truncated) acc.truncated = true;
      for (const topIds of placements.values) {
        const topSet = new Set(topIds);
        pushLimited(acc, {
          deckRevealRemainderOrder,
          deckRevealRemainderPlacements: Object.fromEntries(
            action.remainingCardInstanceIds.map((id) => [
              id,
              topSet.has(id) ? "top" : "bottom",
            ])
          ) as Record<string, "top" | "bottom">,
        });
      }
    } else {
      pushLimited(acc, { deckRevealRemainderOrder });
    }
  }
  return acc;
}

export function zoneSelectionChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_zone_selection" }>,
  getCardDefinitionById: CardDefinitionLookup | undefined,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(limit);
  const addPayment = (input: ActionInputOptions): void => {
    const pending = state.pendingZoneSelection;
    const cost = pending
      ? getZoneSelectionHandGainCost(
          state,
          pending,
          input.selectedZoneCardIds,
          input.zoneSelectionDestinationByCardId
        )
      : 0;
    if (cost <= 0 || !pending) {
      pushLimited(acc, input);
      return;
    }
    if (!getCardDefinitionById) return;
    const playerId = pending.effectActingPlayerId ?? pending.actingPlayerId;
    const available = getHandGainCostPaymentSources(
      state,
      { ...pending, actingPlayerId: playerId },
      getCardDefinitionById
    );
    const payments = generatePaymentSourceOptions({
      state,
      playerId,
      requiredCost: cost,
      reserveAvailable: available.reserveSource.availableCoreAmount,
      onBoardSources: available.onBoardCoreSources,
      soulOnlySources: available.soulCoreOnlySources,
      field: "paymentSources",
      limit,
    });
    acc.truncated ||= payments.truncated;
    for (const payment of payments.values)
      pushLimited(acc, { ...input, ...payment });
  };
  // combinations は候補数に上限を丸める。exact な数量条件は丸めず、
  // primary が不足するときは成立する alternate だけを生成する。
  const primary =
    action.canSkip || action.candidateCardInstanceIds.length >= action.maxCount
      ? combinations(
          action.candidateCardInstanceIds,
          action.canSkip ? 0 : action.maxCount,
          action.maxCount,
          limit
        )
      : makeAccumulator<string[]>(limit);
  if (primary.truncated) acc.truncated = true;

  const seen = new Set<string>();
  const addSelection = (selectedZoneCardIds: string[]): void => {
    const key = selectedZoneCardIds.join("\0");
    if (seen.has(key)) return;
    seen.add(key);
    if (
      !action.requiresPerCardDestinationChoice ||
      selectedZoneCardIds.length === 0
    ) {
      addPayment({ selectedZoneCardIds });
      return;
    }
    const destinationCombos = combinations(
      selectedZoneCardIds,
      0,
      selectedZoneCardIds.length,
      Math.max(1, limit - acc.values.length)
    );
    if (destinationCombos.truncated) acc.truncated = true;
    for (const setAsideIds of destinationCombos.values) {
      const setAsideSet = new Set(setAsideIds);
      const destinationByCardId = Object.fromEntries(
        selectedZoneCardIds.map((id) => [
          id,
          setAsideSet.has(id) ? "set_aside" : "hand",
        ])
      ) as Record<string, "hand" | "set_aside">;
      const isAllowed = selectedZoneCardIds.every((id) =>
        (
          action.perCardDestinationChoices?.[id] ?? ["hand", "set_aside"]
        ).includes(destinationByCardId[id]!)
      );
      if (!isAllowed) continue;
      addPayment({
        selectedZoneCardIds,
        zoneSelectionDestinationByCardId: destinationByCardId,
      });
    }
  };

  if (action.handGainCost) addSelection([]);
  for (const selection of primary.values) addSelection(selection);
  for (const alt of action.alternateSelections ?? []) {
    if (alt.candidateInstanceIds.length < alt.count) continue;
    const choices = combinations(
      alt.candidateInstanceIds,
      alt.count,
      alt.count,
      Math.max(1, limit - acc.values.length)
    );
    if (choices.truncated) acc.truncated = true;
    for (const selection of choices.values) addSelection(selection);
  }
  return acc;
}

export function coreShootChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_shoot" }>,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const ids = action.candidates.map((candidate) => candidate.instanceId);
  const caps = Object.fromEntries(
    action.candidates.map((candidate) => {
      const card = state.cardInstances.find(
        (c) => c.instanceId === candidate.instanceId
      );
      return [
        candidate.instanceId,
        Math.min(
          candidate.availableCores,
          (card
            ? isNormalCoreMovePrevented(state, card.instanceId)
              ? 0
              : card.normalCoreCount
            : undefined) ??
            (candidate.instanceId ===
            reserveCoreShootSentinelId(action.fromPlayerId)
              ? (currentPlayer(state, action.fromPlayerId)
                  ?.reserveNormalCoreCount ?? 0)
              : candidate.availableCores)
        ),
      ];
    })
  );
  const minTotal = action.minTotal ?? action.totalAmount;
  const pending = state.pendingCoreShootSelection;
  const soulCardId =
    pending?.fromPlayerId === pending?.toPlayerId &&
    coreShootSoulDestinationAllowed(pending?.toKind ?? "")
      ? getCoreShootSoulSourceId(currentPlayer(state, action.fromPlayerId))
      : undefined;
  const valid = (
    distribution: Record<string, number>,
    normalTotal: number,
    soulId?: string
  ): boolean => {
    const total = normalTotal + (soulId ? 1 : 0);
    if (total < minTotal || total > action.totalAmount) return false;
    if (
      soulId &&
      !action.candidates.some(
        (c) =>
          c.instanceId === soulId &&
          (distribution[soulId] ?? 0) + 1 <= c.availableCores
      )
    )
      return false;
    return (
      (action.mandatoryTargetInstanceIds ?? []).every(
        (id) => (distribution[id] ?? 0) > 0 || id === soulId
      ) &&
      satisfiesCoreSourceGroupMinimums(
        action.sourceGroupMinimums,
        distribution,
        soulId
      )
    );
  };
  const normalDistributions = integerDistributions({
    ids,
    minTotal: Math.max(0, minTotal - 1),
    maxTotal: action.totalAmount,
    caps,
    limit,
    accept: (distribution, total) =>
      valid(distribution, total) ||
      Boolean(soulCardId && valid(distribution, total, soulCardId)),
  });
  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (normalDistributions.truncated) acc.truncated = true;
  for (const distribution of normalDistributions.values) {
    const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    if (valid(distribution, total))
      pushLimited(acc, { coreShootDistribution: distribution });
    if (soulCardId && valid(distribution, total, soulCardId))
      pushLimited(acc, {
        coreShootDistribution: distribution,
        coreShootSoulCoreInstanceId: soulCardId,
      });
  }
  return acc;
}

export function coreSourceAllocationChoices(
  action: Extract<LegalAction, { kind: "resolve_core_source_allocation" }>,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (action.canDecline) pushLimited(acc, { coreSourceAllocations: {} });
  const minimum = action.minimumTotal ?? action.requiredTotal;
  const ids = action.candidates.map((candidate) => candidate.instanceId);
  const caps = Object.fromEntries(
    action.candidates.map((candidate) => [
      candidate.instanceId,
      candidate.normalAvailable ?? candidate.available,
    ])
  );
  const distributions = integerDistributions({
    ids,
    minTotal: Math.max(0, minimum - 1),
    maxTotal: action.requiredTotal,
    caps,
    limit,
  });
  if (distributions.truncated) acc.truncated = true;
  for (const coreSourceAllocations of distributions.values) {
    const normalTotal = Object.values(coreSourceAllocations).reduce(
      (sum, amount) => sum + amount,
      0
    );
    if (normalTotal >= minimum && normalTotal <= action.requiredTotal) {
      pushLimited(acc, { coreSourceAllocations });
    }
    if (normalTotal + 1 >= minimum && normalTotal + 1 <= action.requiredTotal) {
      for (const candidate of action.candidates) {
        if (candidate.hasSoulCore) {
          pushLimited(acc, {
            coreSourceAllocations,
            coreSourceSoulCoreInstanceId: candidate.instanceId,
          });
        }
      }
    }
  }
  return acc;
}

export function fixedCoreDistributionTotalsMatch(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  coreDistributionAllocations: Record<string, number>,
  coreDistributionSourceAllocations: Record<string, number> | undefined,
  coreDistributionSoulCoreAllocations: Record<string, number>,
  coreDistributionSoulCoreSourceAllocations: Record<string, number> | undefined
): boolean {
  const fixedTargetTotals = action.targetTotalSelection?.fixedTargetTotals;
  if (fixedTargetTotals === undefined) return true;

  for (const candidate of action.candidates) {
    const card = state.cardInstances.find(
      (instance) => instance.instanceId === candidate.instanceId
    );
    const currentTotal =
      (card?.normalCoreCount ?? 0) + (card?.soulCoreCount ?? 0);
    const sourceKey = `field:${candidate.instanceId}`;
    const incoming =
      (coreDistributionAllocations[candidate.instanceId] ?? 0) +
      (coreDistributionSoulCoreAllocations[candidate.instanceId] ?? 0);
    const outgoing =
      (coreDistributionSourceAllocations?.[sourceKey] ?? 0) +
      (coreDistributionSoulCoreSourceAllocations?.[sourceKey] ?? 0);
    if (
      currentTotal - outgoing + incoming !==
      (fixedTargetTotals[candidate.instanceId] ?? 0)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Source and destination are selected as aggregate maps.  A field card cannot
 * supply a core to itself, so reject aggregate maps which cannot be routed
 * without such a self-move before exposing them to a training policy.
 */
export function canRouteNormalCoreDistributionWithoutSelfMove(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  coreDistributionAllocations: Record<string, number>,
  coreDistributionSourceAllocations: Record<string, number> | undefined
): boolean {
  if (action.fromKind !== "any_movable") return true;
  const totalIncoming = Object.values(coreDistributionAllocations).reduce(
    (sum, amount) => sum + amount,
    0
  );
  for (const candidate of action.candidates) {
    const incoming = coreDistributionAllocations[candidate.instanceId] ?? 0;
    const outgoing =
      coreDistributionSourceAllocations?.[`field:${candidate.instanceId}`] ?? 0;
    if (
      incoming > totalIncoming - outgoing ||
      outgoing > totalIncoming - incoming
    ) {
      return false;
    }
  }
  return true;
}

export function fitsCombinedCoreDistributionSourceAvailability(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  coreDistributionSourceAllocations: Record<string, number> | undefined,
  coreDistributionSoulCoreSourceAllocations: Record<string, number> | undefined
): boolean {
  if (action.fromKind !== "any_movable") return true;
  const sourceTotalAvailable = action.sourceTotalAvailable;
  if (sourceTotalAvailable === undefined) return true;
  const sourceKeys = new Set([
    ...Object.keys(coreDistributionSourceAllocations ?? {}),
    ...Object.keys(coreDistributionSoulCoreSourceAllocations ?? {}),
  ]);
  for (const key of sourceKeys) {
    const selected =
      (coreDistributionSourceAllocations?.[key] ?? 0) +
      (coreDistributionSoulCoreSourceAllocations?.[key] ?? 0);
    if (selected > (sourceTotalAvailable[key] ?? 0)) return false;
  }
  return true;
}

/**
 * A target chooser must not hand the core owner a fixed total for which the
 * second decision phase has no legal physical allocation. Reuse that phase's
 * generation here so its min/max, soul, source-cap, and self-move checks stay
 * authoritative.
 */
export function hasCoreDistributionSourceOwnerChoice(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  fixedTargetTotals: Record<string, number>,
  limit: number
): boolean {
  const targetTotalSelection = action.targetTotalSelection;
  if (targetTotalSelection === undefined) return true;
  return (
    coreDistributionChoices(
      state,
      {
        ...action,
        targetTotalSelection: {
          ...targetTotalSelection,
          fixedTargetTotals,
        },
      },
      limit
    ).values.length > 0
  );
}

export function hasDisjointCoreDistributionSources(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): boolean {
  const targetIds = new Set(
    action.candidates.map((candidate) => candidate.instanceId)
  );
  return (action.allowedSources ?? []).every(
    (source) => source.kind !== "field" || !targetIds.has(source.instanceId)
  );
}

/**
 * A target-total choice can also be factored when every physical source is a
 * target and only normal cores participate. In that shape a final total
 * determines each source's net outgoing amount, so reachability can be
 * checked without materialising the target/source Cartesian product.
 */
export function hasOnlyOverlappingNormalCoreDistributionSources(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): boolean {
  if (action.hasSoulCore || (action.totalSoulCores ?? 0) > 0) {
    return false;
  }
  return hasOnlyOverlappingCoreDistributionSources(action);
}

/**
 * Every physical source is also a target. Final target totals therefore
 * constrain the source-owner's outgoing and incoming core flow, including
 * mixed normal/soul allocations.
 */
export function hasOnlyOverlappingCoreDistributionSources(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): boolean {
  if (action.fromKind !== "any_movable") return false;
  const targetIds = new Set(
    action.candidates.map((candidate) => candidate.instanceId)
  );
  return (
    (action.allowedSources ?? []).length > 0 &&
    (action.allowedSources ?? []).every(
      (source) => source.kind === "field" && targetIds.has(source.instanceId)
    )
  );
}

/**
 * Validate a complete final-total map for the overlapping-normal-source
 * shape. With no soul cores, each card's signed final-total delta gives the
 * meaningful source/target aggregate: deficits supply cores and surpluses
 * receive them. The shared routing helper remains authoritative for the
 * no-self-move constraint.
 */
export function canCompleteOverlappingNormalCoreDistributionTargetTotals(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  bounds: ReturnType<typeof getCoreDistributionTargetTotalBounds>,
  finalTotals: Readonly<Record<string, number>>
): ActionInputOptions | null {
  const coreDistributionAllocations: Record<string, number> = {};
  const coreDistributionSourceAllocations: Record<string, number> = {};
  let movedTotal = 0;

  for (const id of bounds.candidateIds) {
    const delta = (finalTotals[id] ?? 0) - (bounds.currentTotals[id] ?? 0);
    if (delta > 0) {
      coreDistributionAllocations[id] = delta;
      movedTotal += delta;
      continue;
    }
    if (delta < 0) {
      const sourceKey = `field:${id}`;
      const outgoing = -delta;
      if (outgoing > (action.sourceAvailable?.[sourceKey] ?? 0)) {
        return null;
      }
      coreDistributionSourceAllocations[sourceKey] = outgoing;
    }
  }

  const maximumTotal = action.maxTotal ?? action.totalNormalCores;
  if (
    !isCoreDistributionAllocationValid(action, coreDistributionAllocations) ||
    movedTotal < (action.minTotal ?? 0) ||
    movedTotal > maximumTotal ||
    movedTotal > action.totalNormalCores
  ) {
    return null;
  }

  if (
    !canRouteNormalCoreDistributionWithoutSelfMove(
      action,
      coreDistributionAllocations,
      coreDistributionSourceAllocations
    ) ||
    !fitsCombinedCoreDistributionSourceAvailability(
      action,
      coreDistributionSourceAllocations,
      undefined
    ) ||
    !fixedCoreDistributionTotalsMatch(
      state,
      action,
      coreDistributionAllocations,
      coreDistributionSourceAllocations,
      {},
      undefined
    )
  ) {
    return null;
  }
  return {
    coreDistributionAllocations,
    coreDistributionSourceAllocations,
  };
}

/**
 * Once target totals are fixed and no target can also supply a core, normal
 * and soul incoming allocations are constrained directly by those totals.
 * Avoid enumerating every target/source Cartesian product just to reject it
 * with fixedCoreDistributionTotalsMatch afterwards.
 */
export function fixedDisjointCoreDistributionChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  fixedTargetTotals: Record<string, number>,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(limit);
  const ids = action.candidates.map((candidate) => candidate.instanceId);
  const incomingTotals: Record<string, number> = {};
  let totalIncoming = 0;
  for (const id of ids) {
    const card = getCardById(state, id);
    const currentTotal =
      (card?.normalCoreCount ?? 0) + (card?.soulCoreCount ?? 0);
    const incoming = (fixedTargetTotals[id] ?? 0) - currentTotal;
    if (incoming < 0) return acc;
    if (incoming > 0) incomingTotals[id] = incoming;
    totalIncoming += incoming;
  }

  const totalSoulCores = action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0);
  const maxByTotal =
    action.maxTotal ?? action.totalNormalCores + totalSoulCores;
  if (totalIncoming < (action.minTotal ?? 0) || totalIncoming > maxByTotal) {
    return acc;
  }

  if (!isCoreDistributionAllocationValid(action, incomingTotals)) return acc;

  const minimumSoulTotal = action.mustPlaceSoulCore ? totalSoulCores : 0;
  const maximumSoulTotal = Math.min(totalSoulCores, totalIncoming);
  const sourceAvailable = action.sourceAvailable ?? {};
  const sourceIds = Object.keys(sourceAvailable);
  for (
    let soulTotal = minimumSoulTotal;
    soulTotal <= maximumSoulTotal;
    soulTotal++
  ) {
    const normalTotal = totalIncoming - soulTotal;
    if (
      normalTotal > action.totalNormalCores ||
      (action.mustPlaceSoulCore && normalTotal !== action.totalNormalCores)
    ) {
      continue;
    }
    const soulTargetChoices = integerDistributions({
      ids,
      minTotal: soulTotal,
      maxTotal: soulTotal,
      caps: incomingTotals,
      limit: Math.max(1, limit - acc.values.length),
    });
    if (soulTargetChoices.truncated) acc.truncated = true;
    const sourceDistributions = integerDistributions({
      ids: sourceIds,
      minTotal: normalTotal,
      maxTotal: normalTotal,
      caps: sourceAvailable,
      limit: Math.max(1, limit - acc.values.length),
    });
    if (sourceDistributions.truncated) acc.truncated = true;
    const soulSourceChoices = coreDistributionSoulSourceChoices(
      action,
      soulTotal,
      Math.max(1, limit - acc.values.length)
    );
    if (soulSourceChoices.truncated) acc.truncated = true;

    for (const coreDistributionSoulCoreAllocations of soulTargetChoices.values) {
      const coreDistributionAllocations = Object.fromEntries(
        ids.flatMap((id) => {
          const amount =
            (incomingTotals[id] ?? 0) -
            (coreDistributionSoulCoreAllocations[id] ?? 0);
          return amount > 0 ? [[id, amount]] : [];
        })
      ) as Record<string, number>;
      for (const coreDistributionSourceAllocations of sourceDistributions.values) {
        for (const coreDistributionSoulCoreSourceAllocations of soulSourceChoices.values) {
          if (
            !canSatisfyCoreDistributionSoulAllocation(
              action,
              coreDistributionSoulCoreAllocations,
              coreDistributionSoulCoreSourceAllocations
            ) ||
            !fitsCombinedCoreDistributionSourceAvailability(
              action,
              coreDistributionSourceAllocations,
              coreDistributionSoulCoreSourceAllocations
            ) ||
            !fixedCoreDistributionTotalsMatch(
              state,
              action,
              coreDistributionAllocations,
              coreDistributionSourceAllocations,
              coreDistributionSoulCoreAllocations,
              coreDistributionSoulCoreSourceAllocations
            )
          ) {
            continue;
          }
          pushLimited(acc, {
            coreDistributionAllocations,
            ...(coreDistributionSourceAllocations
              ? { coreDistributionSourceAllocations }
              : {}),
            ...(soulTotal > 0 ? { coreDistributionSoulCoreAllocations } : {}),
            ...(coreDistributionSoulCoreSourceAllocations
              ? { coreDistributionSoulCoreSourceAllocations }
              : {}),
          });
        }
      }
    }
  }
  return acc;
}

export function coreDistributionChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  if (
    action.targetTotalSelection &&
    action.targetTotalSelection.fixedTargetTotals === undefined
  ) {
    const bounds = getCoreDistributionTargetTotalBounds(state, action);
    const baselineTotal = bounds.candidateIds.reduce(
      (sum, id) => sum + (bounds.minimumTotals[id] ?? 0),
      0
    );
    const extraCaps = Object.fromEntries(
      bounds.candidateIds.map((id) => [
        id,
        Math.max(
          0,
          (bounds.maximumTotals[id] ?? 0) - (bounds.minimumTotals[id] ?? 0)
        ),
      ])
    );
    const extraTotals = integerDistributions({
      ids: [...bounds.candidateIds],
      minTotal: Math.max(0, bounds.minimumSelectedTotal - baselineTotal),
      maxTotal: Math.max(0, bounds.maximumSelectedTotal - baselineTotal),
      caps: extraCaps,
      limit,
    });
    const acc = makeAccumulator<ActionInputOptions>(limit);
    if (extraTotals.truncated) acc.truncated = true;
    for (const extraById of extraTotals.values) {
      const finalTotals: Record<string, number> = {};
      for (const id of bounds.candidateIds) {
        const amount = (bounds.minimumTotals[id] ?? 0) + (extraById[id] ?? 0);
        if (amount > 0) finalTotals[id] = amount;
      }
      const selectedTotal = Object.values(finalTotals).reduce(
        (sum, amount) => sum + amount,
        0
      );
      const deficitTotal = bounds.candidateIds.reduce(
        (sum, id) =>
          sum +
          Math.max(0, (finalTotals[id] ?? 0) - (bounds.currentTotals[id] ?? 0)),
        0
      );
      if (
        selectedTotal < bounds.minimumSelectedTotal ||
        selectedTotal > bounds.maximumSelectedTotal ||
        deficitTotal > bounds.maximumDeficitTotal ||
        !hasCoreDistributionSourceOwnerChoice(state, action, finalTotals, limit)
      ) {
        continue;
      }
      pushLimited(acc, { coreDistributionAllocations: finalTotals });
    }
    return acc;
  }

  const fixedTargetTotals = action.targetTotalSelection?.fixedTargetTotals;
  if (
    fixedTargetTotals !== undefined &&
    hasOnlyOverlappingNormalCoreDistributionSources(action)
  ) {
    const completion = canCompleteOverlappingNormalCoreDistributionTargetTotals(
      state,
      action,
      getCoreDistributionTargetTotalBounds(state, action),
      fixedTargetTotals
    );
    return {
      values: completion ? [completion] : [],
      truncated: false,
      limit,
    };
  }
  if (
    fixedTargetTotals !== undefined &&
    hasDisjointCoreDistributionSources(action)
  ) {
    return fixedDisjointCoreDistributionChoices(
      state,
      action,
      fixedTargetTotals,
      limit
    );
  }

  const ids = action.candidates.map((candidate) => candidate.instanceId);
  const maxByTotal =
    action.maxTotal ??
    action.totalNormalCores +
      (action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0));
  const minTotal = action.minTotal ?? 0;
  const totalSoulCores = action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0);
  const minimumNormalTotal = action.mustPlaceSoulCore
    ? action.totalNormalCores
    : Math.max(0, minTotal - totalSoulCores);
  const caps =
    action.maxPerCandidate === undefined
      ? undefined
      : Object.fromEntries(ids.map((id) => [id, action.maxPerCandidate!]));
  const targetTotals = integerDistributions({
    ids,
    // A soul core can satisfy the required total even when no normal core is
    // available. These are physical incoming allocations after the target
    // chooser has fixed final totals (or for a single-player distribution).
    minTotal: minimumNormalTotal,
    maxTotal: Math.min(maxByTotal, action.totalNormalCores),
    ...(caps ? { caps } : {}),
    limit,
  });
  const acc = makeAccumulator<ActionInputOptions>(limit);
  if (targetTotals.truncated) acc.truncated = true;
  const sourceAvailable = action.sourceAvailable ?? {};
  const sourceIds = Object.keys(sourceAvailable);

  for (const coreDistributionAllocations of targetTotals.values) {
    if (!isCoreDistributionAllocationValid(action, coreDistributionAllocations))
      continue;
    const normalTotal = Object.values(coreDistributionAllocations).reduce(
      (sum, amount) => sum + amount,
      0
    );
    const sourceDistributions =
      action.fromKind === "any_movable"
        ? integerDistributions({
            ids: sourceIds,
            minTotal: normalTotal,
            maxTotal: normalTotal,
            caps: sourceAvailable,
            limit: Math.max(1, limit - acc.values.length),
          })
        : { values: [undefined], truncated: false, limit };
    if (sourceDistributions.truncated) acc.truncated = true;
    for (const coreDistributionSourceAllocations of sourceDistributions.values) {
      if (
        !action.mustPlaceSoulCore &&
        normalTotal >= minTotal &&
        canRouteNormalCoreDistributionWithoutSelfMove(
          action,
          coreDistributionAllocations,
          coreDistributionSourceAllocations
        ) &&
        fitsCombinedCoreDistributionSourceAvailability(
          action,
          coreDistributionSourceAllocations,
          undefined
        ) &&
        fixedCoreDistributionTotalsMatch(
          state,
          action,
          coreDistributionAllocations,
          coreDistributionSourceAllocations,
          {},
          undefined
        )
      ) {
        pushLimited(acc, {
          coreDistributionAllocations,
          ...(coreDistributionSourceAllocations
            ? { coreDistributionSourceAllocations }
            : {}),
        });
      }
      const minimumSoulTotal = action.mustPlaceSoulCore
        ? totalSoulCores
        : Math.max(0, minTotal - normalTotal);
      const maximumSoulTotal = Math.min(
        totalSoulCores,
        maxByTotal - normalTotal
      );
      for (
        let soulTotal = Math.max(1, minimumSoulTotal);
        soulTotal <= maximumSoulTotal;
        soulTotal++
      ) {
        const soulTargetChoices = integerDistributions({
          ids,
          minTotal: soulTotal,
          maxTotal: soulTotal,
          limit: Math.max(1, limit - acc.values.length),
        });
        if (soulTargetChoices.truncated) acc.truncated = true;
        const soulSourceChoices = coreDistributionSoulSourceChoices(
          action,
          soulTotal,
          Math.max(1, limit - acc.values.length)
        );
        if (soulSourceChoices.truncated) acc.truncated = true;
        for (const coreDistributionSoulCoreAllocations of soulTargetChoices.values) {
          if (
            !isCoreDistributionAllocationValid(
              action,
              coreDistributionAllocations,
              coreDistributionSoulCoreAllocations
            )
          )
            continue;
          for (const coreDistributionSoulCoreSourceAllocations of soulSourceChoices.values) {
            if (
              !canSatisfyCoreDistributionSoulAllocation(
                action,
                coreDistributionSoulCoreAllocations,
                coreDistributionSoulCoreSourceAllocations
              )
            ) {
              continue;
            }
            if (
              !canRouteNormalCoreDistributionWithoutSelfMove(
                action,
                coreDistributionAllocations,
                coreDistributionSourceAllocations
              ) ||
              !fitsCombinedCoreDistributionSourceAvailability(
                action,
                coreDistributionSourceAllocations,
                coreDistributionSoulCoreSourceAllocations
              ) ||
              !fixedCoreDistributionTotalsMatch(
                state,
                action,
                coreDistributionAllocations,
                coreDistributionSourceAllocations,
                coreDistributionSoulCoreAllocations,
                coreDistributionSoulCoreSourceAllocations
              )
            ) {
              continue;
            }
            pushLimited(acc, {
              coreDistributionAllocations,
              ...(coreDistributionSourceAllocations
                ? { coreDistributionSourceAllocations }
                : {}),
              coreDistributionSoulCoreAllocations,
              ...(coreDistributionSoulCoreSourceAllocations
                ? { coreDistributionSoulCoreSourceAllocations }
                : {}),
            });
          }
        }
      }
    }
  }
  return acc;
}

export function coreDistributionSoulSourceChoices(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  amount: number,
  limit: number
): ChoiceAccumulator<Record<string, number> | undefined> {
  const acc = makeAccumulator<Record<string, number> | undefined>(limit);
  if (action.fromKind !== "any_movable") {
    pushLimited(acc, undefined);
    return acc;
  }
  const available = action.soulSourceAvailable ?? {};
  const ids = Object.keys(available).filter((id) => (available[id] ?? 0) > 0);
  const sourceTotals = integerDistributions({
    ids,
    minTotal: amount,
    maxTotal: amount,
    caps: available,
    limit,
  });
  if (sourceTotals.truncated) acc.truncated = true;
  for (const distribution of sourceTotals.values) {
    pushLimited(acc, distribution);
  }
  return acc;
}

export function canSatisfyCoreDistributionSoulAllocation(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  soulCoreAllocations: Record<string, number>,
  soulCoreSourceAllocations: Record<string, number> | undefined
): boolean {
  if (action.fromKind !== "any_movable") return true;
  if (!soulCoreSourceAllocations) return false;
  const sourceChunks: SoulCoreDistributionSourceChunk[] = [];
  for (const [key, amount] of Object.entries(soulCoreSourceAllocations)) {
    if (amount <= 0) continue;
    const container = coreDistributionSoulCoreSourceContainerFromKey(
      action.fromPlayerId,
      key
    );
    if (!container) return false;
    sourceChunks.push({ container, remaining: amount });
  }
  try {
    buildCoreDistributionSoulMovePlan(
      sourceChunks,
      new Map(
        Object.entries(soulCoreAllocations).filter(([, amount]) => amount > 0)
      ),
      action.pendingId
    );
    return true;
  } catch {
    return false;
  }
}

export function multiPlacementChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_multi_placement" }>,
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const groups = action.targets.map((target) => {
    const maxTotal =
      target.maximumCoreCount ?? Math.max(target.minimumCoreCount, 12);
    const generated = generatePlacementOptions({
      state,
      playerId: action.actingPlayerId,
      minTotal: target.minimumCoreCount,
      maxTotal,
      field: "enterFieldCorePlacements",
      excludeInstanceIds:
        state.pendingMultiPlacement?.excludedFieldSourceIds ??
        action.targets.map((t) => t.instanceId),
      ...(opts.getCardDefinitionById
        ? { getCardDefinitionById: opts.getCardDefinitionById }
        : {}),
      allowedTrashNormalCoreCount:
        (action.trashNormalCoreMax ?? 0) + (action.trashCoreMax ?? 0),
      limit,
    });
    return {
      ...generated,
      values: generated.values.map((option) => ({
        destinationInstanceId: target.instanceId,
        placements: option.enterFieldCorePlacements ?? [],
      })),
    };
  });
  // The trash grant belongs to the whole pending, not independently to each target.
  const merged = makeAccumulator<ActionInputOptions>(limit);
  const allocations: NonNullable<
    ActionInputOptions["multiPlacementAllocations"]
  >[number][] = [];
  const trashMax = Math.min(
    (action.trashNormalCoreMax ?? 0) + (action.trashCoreMax ?? 0),
    currentPlayer(state, action.actingPlayerId)?.trashNormalCoreCount ?? 0
  );
  const walk = (index: number, trashUsed: number): void => {
    if (merged.truncated) return;
    if (index === groups.length) {
      pushLimited(merged, { multiPlacementAllocations: [...allocations] });
      return;
    }
    for (const entry of groups[index]!.values) {
      const amount = entry.placements.reduce(
        (sum, placement) =>
          sum + (placement.kind === "trash_normal" ? placement.amount : 0),
        0
      );
      if (trashUsed + amount > trashMax) continue;
      allocations.push(entry);
      walk(index + 1, trashUsed + amount);
      allocations.pop();
      if (merged.truncated) return;
    }
  };
  walk(0, 0);
  if (groups.some((group) => group.truncated)) merged.truncated = true;
  return {
    ...merged,
    values: merged.values.map((option) => ({
      multiPlacementAllocations: (
        option.multiPlacementAllocations as NonNullable<
          ActionInputOptions["multiPlacementAllocations"]
        >
      ).flat(),
    })),
  };
}

export function scalarCountChoices(
  field:
    | "coreCountSelection"
    | "countDecreaseSelection"
    | "discardSetBurstCountSelection",
  min: number,
  max: number,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const acc = makeAccumulator<ActionInputOptions>(limit);
  for (let value = min; value <= max; value++) {
    pushLimited(acc, { [field]: value } as ActionInputOptions);
  }
  return acc;
}

/**
 * pattern 2 の逆転醒は、解決時に source のコアを先にリザーブへ戻してから
 * 支払い/維持コア配置を行う。training の候補生成もその一時状態を使わないと、
 * 実行時には使えるコアを候補から落として pending を残す。
 */
export { reverseRebirthSummonSourceReturnedState } from "./core/reverse-rebirth-core-return";

export function reverseRebirthSummonInputChoices(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_reverse_rebirth_summon" }>,
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  const getCardDefinitionById = opts.getCardDefinitionById;
  const frontDefinition = getCardDefinitionById?.(action.frontDefinitionId);
  if (!getCardDefinitionById || !frontDefinition) {
    // The normal direct-action fallback is retained for callers that do not
    // provide a definition lookup (the training engine always provides one).
    return generateTopLevelActionInputChoices(state, action, opts, limit);
  }

  const returnedState = reverseRebirthSummonSourceReturnedState(state, action);
  const available = getAvailableCardCostPaymentSources({
    state: returnedState,
    actingPlayerId: action.actingPlayerId,
    card: frontDefinition,
    excludeFieldInstanceIds: [action.sourceInstanceId],
    sourceInstanceId: action.sourceInstanceId,
    getCardDefinitionById,
  });
  const payments = generatePaymentSourceOptions({
    state: returnedState,
    playerId: action.actingPlayerId,
    requiredCost: action.costToPay,
    reserveAvailable: available.reserveSource.availableCoreAmount,
    onBoardSources: available.onBoardCoreSources.filter(
      (source) => source.instanceId !== action.sourceInstanceId
    ),
    soulOnlySources: available.soulCoreOnlySources.filter(
      (source) => source.instanceId !== action.sourceInstanceId
    ),
    field: "summonPaymentSources",
    limit,
  });

  const acc = makeAccumulator<ActionInputOptions>(limit);
  acc.truncated = payments.truncated;
  for (const payment of payments.values) {
    let afterPayment = returnedState;
    const paymentSources = payment.summonPaymentSources;
    if (paymentSources && paymentSources.length > 0) {
      try {
        afterPayment = applyCardCostPayments({
          state: returnedState,
          actingPlayerId: action.actingPlayerId,
          chainId: `training:reverse-rebirth:${action.pendingId}`,
          paymentSources,
          getCardDefinitionById,
        });
      } catch {
        // A choice must be executable against the same post-return state as
        // the real resolver. Omit stale candidates rather than deadlocking
        // the training loop with an invalid payload.
        continue;
      }
    }
    const placements = generatePlacementOptions({
      state: afterPayment,
      playerId: action.actingPlayerId,
      minTotal: action.minimumCoreCount,
      maxTotal: Math.max(action.minimumCoreCount, 12),
      field: "summonEnterFieldCorePlacements",
      excludeInstanceIds: [action.sourceInstanceId],
      getCardDefinitionById,
      limit: Math.max(1, limit - acc.values.length),
    });
    acc.truncated ||= placements.truncated;
    for (const placement of placements.values) {
      pushLimited(acc, { ...payment, ...placement });
    }
  }
  return acc;
}

export function generateActionInputChoices(
  state: GameState,
  action: LegalAction,
  opts: ActionInputChoiceContext,
  limit: number
): ChoiceAccumulator<ActionInputOptions> {
  switch (action.kind) {
    case "resolve_pending_triggered_effect": {
      const candidates =
        action.paidPreventionImmunityCardCostCandidateInstanceIds ?? [];
      const amount = action.paidPreventionImmunityCardCostAmount;
      if (amount === undefined || candidates.length <= amount) {
        return generateTopLevelActionInputChoices(state, action, opts, limit);
      }
      const selected = combinations(candidates, amount, amount, limit);
      return {
        ...selected,
        values: selected.values.map((paidPreventionImmunityCardSelection) => ({
          paidPreventionImmunityCardSelection,
        })),
      };
    }
    case "resolve_pending_enter_field_placement": {
      const pending = state.pendingEnterFieldPlacement;
      const sourceDefinition = opts.getCardDefinitionById?.(
        action.sourceDefinitionId
      );
      const trashGrant =
        pending?.deferredStack?.actionKind === "summon" && sourceDefinition
          ? getSummonTrashCorePlacementGrant(
              state,
              action.actingPlayerId,
              sourceDefinition
            )
          : null;
      return generatePlacementOptions({
        state,
        playerId: action.actingPlayerId,
        minTotal: action.minimumCoreCount,
        maxTotal:
          action.maximumCoreCount ?? Math.max(action.minimumCoreCount, 12),
        field: "enterFieldCorePlacements",
        excludeInstanceIds: [action.sourceInstanceId],
        ...(opts.getCardDefinitionById
          ? { getCardDefinitionById: opts.getCardDefinitionById }
          : {}),
        ...(trashGrant
          ? { allowedTrashNormalCoreCount: trashGrant.amount }
          : {}),
        limit,
      });
    }
    case "resolve_reverse_rebirth_summon":
      return reverseRebirthSummonInputChoices(state, action, opts, limit);
    case "resolve_pending_effect_target":
    case "resolve_pending_step_optional_target_selection":
    case "resolve_borrowed_effect_target":
      return (
        opts.getTargetInput?.(state, action, limit) ??
        targetInputGroup(action, limit) ??
        makeAccumulator(limit)
      );
    case "resolve_pending_deck_reveal_pick":
      return deckRevealPickChoices(
        state,
        action,
        opts.getCardDefinitionById,
        limit
      );
    case "resolve_pending_deck_reveal_order":
      return deckRevealOrderChoices(action, limit);
    case "resolve_battle_immediate_effect":
      return generateTopLevelActionInputChoices(state, action, opts, limit, {
        includeTargetInput: false,
      });
    case "resolve_pending_zone_selection":
      return zoneSelectionChoices(
        state,
        action,
        opts.getCardDefinitionById,
        limit
      );
    case "resolve_pending_draw_step_cost_choice": {
      const acc = makeAccumulator<ActionInputOptions>(limit);
      pushLimited(acc, { drawStepCostChoice: "decline" });
      for (const id of action.candidateCardInstanceIds) {
        pushLimited(acc, {
          drawStepCostChoice: "pay",
          drawStepCostDiscardCardInstanceId: id,
        });
      }
      return acc;
    }
    case "resolve_pending_summon_cost_exclude_choice": {
      const acc = makeAccumulator<ActionInputOptions>(limit);
      const selections = combinations(
        action.candidateCardInstanceIds,
        action.minCount ?? 0,
        action.maxCount,
        limit
      );
      if (selections.truncated) acc.truncated = true;
      for (const summonCostExcludeSelectedCardInstanceIds of selections.values) {
        const payments = summonCostExcludePaymentChoicesForSelection(
          state,
          action,
          summonCostExcludeSelectedCardInstanceIds,
          Math.max(1, limit - acc.values.length)
        );
        if (payments.truncated) acc.truncated = true;
        for (const payment of payments.values) {
          pushLimited(acc, {
            summonCostExcludeSelectedCardInstanceIds,
            ...payment,
          });
        }
      }
      return acc;
    }
    case "resolve_pending_summon_cost_core_move_choice": {
      const acc = makeAccumulator<ActionInputOptions>(limit);
      const pending = state.pendingSummonCostCoreMoveChoice;
      const getDef = opts.getCardDefinitionById ?? (() => undefined);
      const definition = getDef(action.sourceDefinitionId);
      if (!pending || !definition) return acc;
      const ids = [
        "reserve",
        ...action.fieldDestinationCandidateInstanceIds.map(
          (id) => `field:${id}`
        ),
      ];
      const player = currentPlayer(state, action.actingPlayerId)!;
      const soulTargets: Array<string | undefined> = [
        undefined,
        ...(player.soulCoreLocation?.kind === "trash" ? ids : []),
      ];
      for (const soulTarget of soulTargets) {
        const soulCount = soulTarget === undefined ? 0 : 1;
        const distributions = integerDistributions({
          ids,
          minTotal: Math.max(0, action.minCount - soulCount),
          maxTotal: Math.min(
            player.trashNormalCoreCount,
            action.availableCoreCount - soulCount
          ),
          limit: Math.max(1, limit - acc.values.length),
        });
        acc.truncated ||= distributions.truncated;
        for (const distribution of distributions.values) {
          const allocations = ids
            .filter((id) => (distribution[id] ?? 0) > 0 || id === soulTarget)
            .map((id) => ({
              destination:
                id === "reserve"
                  ? ("reserve" as const)
                  : { fieldCardInstanceId: id.slice(6) },
              normalCount: distribution[id] ?? 0,
              soulCount: id === soulTarget ? (1 as const) : (0 as const),
            }));
          const selectedCount = allocations.reduce(
            (sum, a) => sum + a.normalCount + a.soulCount,
            0
          );
          const moved = resolveSummonCostCoreMoveChoiceSelection(
            state,
            pending,
            selectedCount,
            { kind: "reserve" },
            allocations,
            getDef
          );
          const sources = getAvailableCardCostPaymentSources({
            state: moved.state,
            actingPlayerId: action.actingPlayerId,
            card: definition,
            sourceInstanceId: action.sourceInstanceId,
            getCardDefinitionById: getDef,
            additionalCostModifiers: moved.additionalCostModifiers,
          });
          const finalCost = pending.grantsFreeSummon
            ? calculateFreeSummonCost({
                state: moved.state,
                actingPlayerId: action.actingPlayerId,
                definition,
                sourceInstanceId: action.sourceInstanceId,
                getCardDefinitionById: getDef,
                ...(pending.effectSummonActivationZone !== undefined
                  ? { summonCause: "effect" as const }
                  : {}),
              })
            : sources.reduction.finalCost;
          const payments = generatePaymentSourceOptions({
            state: moved.state,
            playerId: action.actingPlayerId,
            requiredCost: finalCost,
            reserveAvailable: sources.reserveSource.availableCoreAmount,
            onBoardSources: sources.onBoardCoreSources,
            soulOnlySources: sources.soulCoreOnlySources,
            field: "paymentSources",
            limit: Math.max(1, limit - acc.values.length),
          });
          if (payments.truncated) acc.truncated = true;
          for (const payment of payments.values) {
            pushLimited(acc, {
              summonCostCoreMoveSelectedCount: selectedCount,
              summonCostCoreMoveAllocations: allocations,
              ...payment,
            });
          }
        }
      }
      return acc;
    }
    case "resolve_pending_grouped_summon_cost_override_choice": {
      const selected = combinations(
        action.candidateCardInstanceIds,
        0,
        action.maxCount,
        limit
      );
      return {
        ...selected,
        values: selected.values.map(
          (groupedSummonCostOverrideSelectedCardInstanceIds) => ({
            groupedSummonCostOverrideSelectedCardInstanceIds,
          })
        ),
      };
    }
    case "resolve_pending_life_damage_discard_choice":
      return {
        values: [
          { lifeDamageDiscardChoice: "decline" },
          { lifeDamageDiscardChoice: "pay" },
        ],
        truncated: false,
        limit,
      };
    case "resolve_pending_life_gain_replacement_choice":
      return {
        values: [
          { lifeGainReplacementChoice: "decline" },
          { lifeGainReplacementChoice: "replace" },
        ],
        truncated: false,
        limit,
      };
    case "resolve_pending_core_shoot":
      return coreShootChoices(state, action, limit);
    case "resolve_pay_to_act_core_gate": {
      const acc = makeAccumulator<ActionInputOptions>(limit);
      pushLimited(acc, { payToActCoreGateDecline: true });
      for (const payToActCoreSourceContainerId of action.candidateContainerIds) {
        const candidate = state.pendingPayToActCoreGate?.candidates.find(
          (c) => c.containerId === payToActCoreSourceContainerId
        );
        if ((candidate?.normalAvailable ?? candidate?.available ?? 0) > 0)
          pushLimited(acc, { payToActCoreSourceContainerId });
        if ((candidate?.soulAvailable ?? 0) > 0)
          pushLimited(acc, {
            payToActCoreSourceContainerId,
            payToActCoreKind: "soul",
          });
      }
      return acc;
    }
    case "resolve_pay_to_act_hand_discard_gate": {
      const selected = combinations(
        action.candidateCardInstanceIds,
        action.requiredCount,
        action.requiredCount,
        Math.max(1, limit - 1)
      );
      return {
        values: [
          { payToActHandDiscardGateDecline: true },
          ...selected.values.map((payToActHandDiscardCardInstanceIds) => ({
            payToActHandDiscardCardInstanceIds,
          })),
        ],
        truncated: selected.truncated,
        limit,
      };
    }
    case "resolve_field_magic_pre_cost_trigger":
      return {
        values: [
          { fieldMagicPreCostTriggerDecision: "decline" },
          { fieldMagicPreCostTriggerDecision: "trigger" },
        ],
        truncated: false,
        limit,
      };
    case "resolve_pending_core_split": {
      const ids = action.destinations.map((_, index) => String(index));
      const caps = Object.fromEntries(
        action.destinations.map((destination, index) => [
          String(index),
          destination.cap ?? action.totalAmount,
        ])
      );
      const distributions = integerDistributions({
        ids,
        minTotal: action.totalAmount,
        maxTotal: action.totalAmount,
        caps,
        limit,
      });
      return {
        ...distributions,
        values: distributions.values.map((distribution) => ({
          coreSplitDistribution: action.destinations.map(
            (_, index) => distribution[String(index)] ?? 0
          ),
        })),
      };
    }
    case "resolve_pending_split_summon_choice": {
      const acc = makeAccumulator<ActionInputOptions>(limit);
      for (
        let splitSummonTokenCount = 0;
        splitSummonTokenCount <= action.maxTokenCount;
        splitSummonTokenCount++
      ) {
        const maxZone = action.totalCount - splitSummonTokenCount;
        const zoneChoices = combinations(
          action.zoneCandidateInstanceIds,
          0,
          maxZone,
          Math.max(1, limit - acc.values.length)
        );
        if (zoneChoices.truncated) acc.truncated = true;
        for (const splitSummonZoneCardInstanceIds of zoneChoices.values) {
          pushLimited(acc, {
            splitSummonTokenCount,
            splitSummonZoneCardInstanceIds,
          });
        }
      }
      return acc;
    }
    case "resolve_pending_core_count":
      return scalarCountChoices(
        "coreCountSelection",
        action.min,
        action.max,
        limit
      );
    case "resolve_pending_count_decrease":
    case "resolve_pending_effect_optional_repeat_count":
      return scalarCountChoices(
        "countDecreaseSelection",
        action.min,
        action.max,
        limit
      );
    case "resolve_pending_discard_set_burst_count":
      return scalarCountChoices(
        "discardSetBurstCountSelection",
        action.min,
        action.max,
        limit
      );
    case "resolve_pending_life_core_selection": {
      const acc = makeAccumulator<ActionInputOptions>(limit);
      for (
        let normalChosen = 0;
        normalChosen <= action.normalAvailable;
        normalChosen++
      ) {
        const soulChosen = action.totalAmount - normalChosen;
        if (soulChosen < 0 || soulChosen > action.soulAvailable) continue;
        pushLimited(acc, {
          lifeCorePartitionChoice: { normalChosen, soulChosen },
        });
      }
      return acc;
    }
    case "resolve_core_source_allocation":
      return coreSourceAllocationChoices(action, limit);
    case "resolve_pending_link_aid_cost_source_choice":
      return makeAccumulator(limit);
    case "resolve_pending_effect_summon_cost_payment":
      return generatePaymentSourceOptions({
        state,
        playerId: action.actingPlayerId,
        requiredCost: action.requiredCost,
        reserveAvailable: action.availableReserveCoreAmount,
        onBoardSources: action.availableOnBoardCoreSources,
        soulOnlySources: action.availableSoulCoreOnlySources,
        field: "summonPaymentSources",
        limit,
      });
    case "resolve_pending_core_distribution":
      return coreDistributionChoices(state, action, limit);
    case "resolve_pending_multi_placement":
      return multiPlacementChoices(state, action, opts, limit);
    case "resolve_pending_change_cleanup_choice": {
      if (action.outcome !== "swap") return makeAccumulator(limit);
      return {
        values: action.swapCandidateInstanceIds.map((swapTargetInstanceId) => ({
          swapTargetInstanceId,
        })),
        truncated: false,
        limit,
      };
    }
    case "confirm_target_redirect": {
      const count =
        action.replacementMode === "reselect"
          ? (action.replacementTargetCount ??
            action.redirectableInstanceIds?.length ??
            1)
          : 1;
      const selections = combinations(
        action.candidateTokenInstanceIds,
        count,
        action.maxReplacementTargetCount ?? count,
        limit
      );
      return {
        ...selections,
        values: selections.values.flatMap((ids): ActionInputOptions[] => {
          if (action.replacementMode === "reselect") {
            return [{ redirectTargetReplacementInstanceIds: ids }];
          }
          const replacementId = ids[0];
          return replacementId
            ? [{ redirectTargetReplacementInstanceId: replacementId }]
            : [];
        }),
      };
    }
    default:
      return generateTopLevelActionInputChoices(state, action, opts, limit);
  }
}
