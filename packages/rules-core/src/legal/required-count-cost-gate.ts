import type { DynamicCount } from "../dsl-types";
import { resolvePlayerRef } from "../effect/structured-effect-interpreter";
import type {
  CardDefinition,
  CardInstance,
  EffectPlayerRef,
  GameState,
} from "../model";
import { immuneProtectedCount } from "../model";
import { getEffectiveTribes } from "./legal-actions-shared";
import type {
  LegalActionTargetGroup,
  RequiredSelectedTargetsCountCost,
} from "./legal-actions-types";

export function getRequiredCountCostAvailableAmount(
  state: GameState,
  actingPlayerId: string,
  playerRef: EffectPlayerRef | undefined,
  sourceTribes: readonly string[]
): number | null {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    playerRef ?? "self",
    state
  );
  const player = state.players.find((p) => p.id === targetPlayerId);
  if (!player) return null;
  return Math.max(
    0,
    player.countValue -
      immuneProtectedCount(player.protectedCounts, sourceTribes)
  );
}

export function getRequiredCostSourceTribes(
  sourceDefinition: CardDefinition | undefined
): readonly string[] {
  return sourceDefinition?.tribe?.split("・").filter(Boolean) ?? [];
}

export function getRequiredCostSourceTribesForCard(
  state: GameState,
  sourceCard: CardInstance | undefined,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): readonly string[] {
  return getEffectiveTribes(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById
  );
}

export function resolveRequiredSelectedTargetsCountCostAmount(
  amount: DynamicCount,
  targetStepId: string,
  selectedTargetCount: number
): number | null {
  const source = amount.source;
  if (
    source.kind !== "selected_targets" ||
    (source.stepId !== undefined && source.stepId !== targetStepId) ||
    amount.subtract !== undefined
  ) {
    return null;
  }

  const multiplier = amount.multiplier ?? 1;
  const divisor = amount.divisor ?? 1;
  const groupMultiplier = amount.groupMultiplier ?? 1;
  const offset = amount.offset ?? 0;
  const raw =
    Math.floor((selectedTargetCount * multiplier) / divisor) * groupMultiplier +
    offset;
  const capped = amount.cap !== undefined ? Math.min(raw, amount.cap) : raw;
  return Math.max(0, capped);
}

export function getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
  state: GameState,
  actingPlayerId: string,
  registration: {
    requiredSelectedTargetsCountCost?: RequiredSelectedTargetsCountCost;
  },
  maxTargetCount: number,
  sourceTribes: readonly string[]
): number {
  const cost = registration.requiredSelectedTargetsCountCost;
  if (cost === undefined) return maxTargetCount;
  const availableAmount = getRequiredCountCostAvailableAmount(
    state,
    actingPlayerId,
    cost.player,
    sourceTribes
  );
  if (availableAmount === null) return -1;

  for (
    let selectedTargetCount = Math.max(0, Math.floor(maxTargetCount));
    selectedTargetCount >= 0;
    selectedTargetCount--
  ) {
    const requiredAmount = resolveRequiredSelectedTargetsCountCostAmount(
      cost.amount,
      cost.targetStepId,
      selectedTargetCount
    );
    if (requiredAmount !== null && requiredAmount <= availableAmount) {
      return selectedTargetCount;
    }
  }
  return -1;
}

export function capTargetGroupsByRequiredSelectedTargetsCountCost(
  state: GameState,
  actingPlayerId: string,
  registration: {
    requiredSelectedTargetsCountCost?: RequiredSelectedTargetsCountCost;
  },
  targetGroups: readonly LegalActionTargetGroup[],
  sourceTribes: readonly string[]
): readonly LegalActionTargetGroup[] | null {
  const cost = registration.requiredSelectedTargetsCountCost;
  if (cost === undefined || targetGroups.length === 0) return targetGroups;

  let matched = false;
  const cappedGroups = targetGroups.map((group) => {
    if (group.targetStepId !== cost.targetStepId) return group;
    matched = true;

    const rawMaxTargetCount = group.maxTargetCount ?? group.requiredTargetCount;
    const costLimitedMaxTargetCount =
      getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
        state,
        actingPlayerId,
        registration,
        rawMaxTargetCount,
        sourceTribes
      );
    if (costLimitedMaxTargetCount < group.requiredTargetCount) {
      return null;
    }

    const effectiveMaxTargetCount = Math.min(
      rawMaxTargetCount,
      costLimitedMaxTargetCount
    );
    const { maxTargetCount: _maxTargetCount, ...rest } = group;
    return {
      ...rest,
      ...(effectiveMaxTargetCount !== group.requiredTargetCount
        ? { maxTargetCount: effectiveMaxTargetCount }
        : {}),
    };
  });

  if (!matched) return targetGroups;
  if (cappedGroups.some((group) => group === null)) return null;
  return cappedGroups as LegalActionTargetGroup[];
}
