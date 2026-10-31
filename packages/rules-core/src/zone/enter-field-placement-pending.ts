import { getMultiPlacementTargets } from "../pending-state-guards";
import { discardUncommittedSemanticEntry } from "../effect/semantic-trigger-events";
import { getCardById } from "../card/card-lookup";
import {
  getTotalCoresOnCardById,
  moveCardZone,
  resolveCardLeavesFieldCores,
} from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import { nextPendingSelectionId } from "../effect/structured-effect-sequences";
import type {
  CardDefinition,
  FieldCoreSourceMinimum,
  GameState,
  PendingMultiPlacement,
} from "../model";
import { getEnterFieldCorePlacementPolicy } from "./enter-field-placement-policy";
import { countEnterFieldCoreSources } from "./enter-field-core-sources";
import {
  getEntryMinimumCoreCount,
  openEntryBraveCombineChoice,
} from "./enter-field-brave-choice";

export function isAwaitingEffectEntryCores(
  state: GameState,
  instanceId: string
): boolean {
  const pending = state.pendingMultiPlacement;
  return (
    (state.pendingBraveCombineChoice?.effectSummon !== undefined &&
      state.pendingBraveCombineChoice.braveInstanceId === instanceId) ||
    getMultiPlacementTargets(pending).some(
      (target) => target.instanceId === instanceId
    ) ||
    pending?.excludedFieldSourceIds?.includes(instanceId) === true ||
    pending?.combineAfterPlacement?.braveInstanceId === instanceId
  );
}

/** Shared chosen maintenance cores. null eventKind also supports existing-card separation. */
export function queueEnterFieldCorePlacement(options: {
  state: GameState;
  beforeState: GameState;
  instanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  eventKind: "summon" | "place" | "put" | null;
  trashNormalCoreMax?: number;
  trashCoreMax?: number;
  fieldCoreSourceMinimum?: FieldCoreSourceMinimum;
}): GameState {
  const { state, instanceId, getCardDefinitionById } = options;
  const card = getCardById(state, instanceId);
  const definition = card && getCardDefinitionById(card.definitionId);
  if (!card || !definition || card.zone !== "field") return state;
  const policy = getEnterFieldCorePlacementPolicy({ card, definition });
  if (policy.maximumCoreCount === 0) return state;
  const target: PendingMultiPlacement["targets"][number] = {
    instanceId,
    definitionId: card.definitionId,
    minimumCoreCount: card.attachedToInstanceId
      ? 0
      : Math.max(
          0,
          policy.minimumCoreCount - getTotalCoresOnCardById(state, instanceId)
        ),
    maximumCoreCount: policy.maximumCoreCount,
    enterFieldEventKind: options.eventKind,
  };
  const pending = state.pendingMultiPlacement;
  const queuedTargets = [
    ...(pending?.actingPlayerId === card.controllerPlayerId
      ? pending.targets
      : []),
    ...(pending?.remainingPlacements
      ?.filter((group) => group.actingPlayerId === card.controllerPlayerId)
      .flatMap((group) => group.targets) ?? []),
  ];
  if (isAwaitingEffectEntryCores(state, instanceId)) return state;
  if (
    countEnterFieldCoreSources({
      state,
      actingPlayerId: card.controllerPlayerId,
      getCardDefinitionById,
      excludedFieldSourceIds: new Set([
        instanceId,
        ...queuedTargets.map((t) => t.instanceId),
        ...(pending?.excludedFieldSourceIds ?? []),
      ]),
      trashNormalCapacity: options.trashNormalCoreMax ?? 0,
      trashGenericCapacity: options.trashCoreMax ?? 0,
      ...(options.fieldCoreSourceMinimum !== undefined
        ? { fieldCoreSourceMinimum: options.fieldCoreSourceMinimum }
        : {}),
    }) <
    getEntryMinimumCoreCount(state, target, getCardDefinitionById) +
      queuedTargets.reduce(
        (sum, t) =>
          sum + getEntryMinimumCoreCount(state, t, getCardDefinitionById),
        0
      )
  ) {
    const failed = moveCardZone(
      resolveCardLeavesFieldCores(state, instanceId),
      instanceId,
      "trash",
      getDefaultZoneRoleName(definition, "trash")
    );
    return {
      ...discardUncommittedSemanticEntry(failed, instanceId),
      log: [
        ...failed.log,
        `effect:field-entry-failed:${instanceId}:insufficient-maintenance-cores`,
      ],
    };
  }
  if (pending) {
    if (pending.actingPlayerId === card.controllerPlayerId) {
      return openEntryBraveCombineChoice(
        {
          ...state,
          pendingMultiPlacement: {
            ...pending,
            excludedFieldSourceIds: [
              ...(pending.excludedFieldSourceIds ??
                pending.targets.map((target) => target.instanceId)),
              instanceId,
            ],
            targets: [...pending.targets, target],
          },
        },
        getCardDefinitionById
      );
    }
    const remaining = pending.remainingPlacements ?? [];
    const group = remaining.find(
      (p) => p.actingPlayerId === card.controllerPlayerId
    );
    return {
      ...state,
      pendingMultiPlacement: {
        ...pending,
        excludedFieldSourceIds: [
          ...(pending.excludedFieldSourceIds ??
            pending.targets.map((target) => target.instanceId)),
          instanceId,
        ],
        remainingPlacements: group
          ? remaining.map((p) =>
              p === group ? { ...p, targets: [...p.targets, target] } : p
            )
          : [
              ...remaining,
              { actingPlayerId: card.controllerPlayerId, targets: [target] },
            ],
      },
    };
  }
  return openEntryBraveCombineChoice(
    {
      ...state,
      pendingMultiPlacement: {
        pendingId: nextPendingSelectionId("mp"),
        actingPlayerId: card.controllerPlayerId,
        sourceInstanceId: instanceId,
        sourceDefinitionId: card.definitionId,
        targets: [target],
        ...(card.attachedToInstanceId
          ? { resolvedBraveCombineInstanceIds: [instanceId] }
          : {}),
        effectTiming: { kind: "activated", mode: "main" },
        canAbort: false,
        excludedFieldSourceIds: [instanceId],
        ...(options.fieldCoreSourceMinimum !== undefined
          ? { fieldCoreSourceMinimum: options.fieldCoreSourceMinimum }
          : {}),
        priorStateSnapshot: options.beforeState,
        ...(options.trashNormalCoreMax !== undefined
          ? { trashNormalCoreMax: options.trashNormalCoreMax }
          : {}),
        ...(options.trashCoreMax !== undefined
          ? { trashCoreMax: options.trashCoreMax }
          : {}),
      },
    },
    getCardDefinitionById
  );
}
