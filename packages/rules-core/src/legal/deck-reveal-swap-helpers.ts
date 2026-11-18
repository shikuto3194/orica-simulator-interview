import type {
  CardDefinition,
  GameState,
  PendingDeckReveal,
  PendingZoneSelection,
} from "../model";
import { getCardById } from "../card/card-lookup";
import { isCardInEffectZone } from "../effect/card-access-rules";
import {
  getDeckRevealCostPaymentSources,
  getDeckRevealHandGainCost,
  revealedChoiceIncreasesHand,
} from "./deck-reveal-hand-gain-cost";
import { isEffectFieldEntryRestricted } from "../card/put-card-on-field";
import { getReplaceableBurstSetState } from "../mechanics/burst-system";
import {
  getAvailableMiragePaymentSources,
  canEffectSetMirage,
} from "../mechanics/mirage-system";

/**
 * `hand_gain_cost_gate` (engine-opponent-hand-gain-paid-tax-gate, BSRK01-C02[3,4])
 * が `pending.actingPlayerId` に課す対価を支払えないため、revealed_choice の手札加算
 * disposition を選択できないか。手札を増やさない disposition (swap/set_as_burst) は
 * 対象外 (常に false)。
 */
function isRevealedChoiceHandGainUnaffordable(
  state: GameState,
  pending: PendingDeckReveal,
  id: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  if (!revealedChoiceIncreasesHand(pending, id)) return false;
  const gateAmount = getDeckRevealHandGainCost(state, pending);
  if (gateAmount <= 0) return false;
  return (
    !getCardDefinitionById ||
    getDeckRevealCostPaymentSources(state, pending, getCardDefinitionById)
      .totalAvailableCoreAmount < gateAmount
  );
}

export type DeckRevealSwapOutZone = "hand" | "set_aside";

export function getDeckRevealSwapOutCandidateIds(options: {
  state: GameState;
  actingPlayerId: string;
  zones: readonly DeckRevealSwapOutZone[];
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  excludeInstanceIds?: Iterable<string>;
}): string[] {
  const excluded = new Set(options.excludeInstanceIds ?? []);
  return options.state.cardInstances
    .filter(
      (card) =>
        card.ownerPlayerId === options.actingPlayerId &&
        (options.getCardDefinitionById
          ? isCardInEffectZone(
              options.state,
              card,
              options.zones,
              options.actingPlayerId,
              options.getCardDefinitionById
            )
          : options.zones.some((zone) => zone === card.zone)) &&
        !excluded.has(card.instanceId)
    )
    .map((card) => card.instanceId);
}

export function getDeckRevealSwapOutHandCandidateIds(options: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  excludeInstanceIds?: Iterable<string>;
}): string[] {
  return getDeckRevealSwapOutCandidateIds({
    ...options,
    zones: ["hand"],
  });
}

export function canAcceptDeckRevealSwap(options: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  acceptedInstanceId: string;
}): boolean {
  return (
    getDeckRevealSwapOutHandCandidateIds({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      excludeInstanceIds: [options.acceptedInstanceId],
      getCardDefinitionById: options.getCardDefinitionById,
    }).length > 0
  );
}

export function getDeckRevealRevealedChoiceCandidateIds(options: {
  state: GameState;
  pending: PendingDeckReveal;
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}): string[] {
  const dispositionMap = options.pending.revealedDispositionMap ?? {};
  return (options.pending.revealedAutoAddCandidateIds ?? []).filter((id) => {
    const disposition = dispositionMap[id];
    if (disposition?.kind === "blocked") return false;
    if (disposition?.kind === "set_as_burst") {
      const card = getCardById(options.state, id);
      return (
        card?.zone === "revealed" &&
        getReplaceableBurstSetState(options.state, card.ownerPlayerId) === null
      );
    }
    if (
      isRevealedChoiceHandGainUnaffordable(
        options.state,
        options.pending,
        id,
        options.getCardDefinitionById
      )
    ) {
      return false;
    }
    if (disposition?.kind === "move" && disposition.destination === "field") {
      if (!options.getCardDefinitionById) return false;
      const card = getCardById(options.state, id);
      const def = card
        ? options.getCardDefinitionById(card.definitionId)
        : undefined;
      if (!card || !def) return false;
      return !isEffectFieldEntryRestricted(
        options.state,
        card,
        def,
        options.getCardDefinitionById
      );
    }
    if (disposition?.kind === "set_as_mirage") {
      if (!options.getCardDefinitionById) return false;
      const card = getCardById(options.state, id);
      const def = card
        ? options.getCardDefinitionById(card.definitionId)
        : undefined;
      if (
        !card ||
        !def?.mirageData ||
        !canEffectSetMirage({
          state: options.state,
          actingPlayerId: options.pending.actingPlayerId,
          sourceInstanceId: id,
          effectAuthorizedSourceZones: ["revealed", "trash"],
          getCardDefinitionById: options.getCardDefinitionById,
        })
      ) {
        return false;
      }
      return getAvailableMiragePaymentSources({
        state: options.state,
        actingPlayerId: options.pending.actingPlayerId,
        mirageData: def.mirageData,
        sourceInstanceId: id,
        getCardDefinitionById: options.getCardDefinitionById,
      }).canFullyPay;
    }
    return (
      disposition?.kind !== "swap" ||
      canAcceptDeckRevealSwap({
        state: options.state,
        actingPlayerId: options.pending.actingPlayerId,
        acceptedInstanceId: id,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    );
  });
}

export function isDeckRevealRevealedChoiceGroupSelectionValid(
  pending: Pick<PendingDeckReveal, "revealedUsageGroupByInstanceId">,
  selectedIds: readonly string[]
): boolean {
  if (new Set(selectedIds).size !== selectedIds.length) return false;
  const groups = new Set<string>();
  for (const id of selectedIds) {
    const group = pending.revealedUsageGroupByInstanceId?.[id];
    if (group === undefined) continue;
    if (groups.has(group)) return false;
    groups.add(group);
  }
  return true;
}

export function getDeckRevealRevealedChoiceMaxPickCount(options: {
  state: GameState;
  pending: PendingDeckReveal;
  candidateIds?: readonly string[];
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}): number {
  const candidateIds =
    options.candidateIds ??
    getDeckRevealRevealedChoiceCandidateIds({
      state: options.state,
      pending: options.pending,
      ...(options.getCardDefinitionById
        ? { getCardDefinitionById: options.getCardDefinitionById }
        : {}),
    });
  const dispositionMap = options.pending.revealedDispositionMap ?? {};
  const groups = new Map<string, boolean>();
  for (const id of candidateIds) {
    const key = options.pending.revealedUsageGroupByInstanceId?.[id];
    const group = key === undefined ? `instance:${id}` : `usage:${key}`;
    // 同一グループから非交換を選べるなら手札交換の上限を使わない。
    groups.set(
      group,
      (groups.get(group) ?? false) || dispositionMap[id]?.kind !== "swap"
    );
  }
  const nonSwapCount = [...groups.values()].filter(Boolean).length;
  const swapCount = groups.size - nonSwapCount;
  const handCandidateCount = getDeckRevealSwapOutHandCandidateIds({
    state: options.state,
    actingPlayerId: options.pending.actingPlayerId,
    excludeInstanceIds: candidateIds,
    getCardDefinitionById: options.getCardDefinitionById,
  }).length;
  return nonSwapCount + Math.min(swapCount, handCandidateCount);
}

export function getCurrentDeckRevealSwapOutCandidateIds(options: {
  state: GameState;
  pending: PendingZoneSelection;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
}): string[] {
  const zones = options.pending.swapCandidateZones ?? ["hand", "set_aside"];
  const candidateIds = getDeckRevealSwapOutCandidateIds({
    state: options.state,
    actingPlayerId: options.pending.actingPlayerId,
    zones,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.pending.swapOutExcludedInstanceIds !== undefined
      ? { excludeInstanceIds: options.pending.swapOutExcludedInstanceIds }
      : {}),
  });
  if (
    options.pending.swapCandidateZones === undefined &&
    options.pending.swapOutExcludedInstanceIds === undefined
  ) {
    return candidateIds;
  }
  const allowed = new Set(options.pending.candidateCardInstanceIds);
  return candidateIds.filter((id) => allowed.has(id));
}

export function getRevealedChoiceSwapFallbackRemainder(
  pending: PendingDeckReveal
): "top" | "bottom" | "trash" {
  if (pending.origin === "trash" || pending.remainder === "trash") {
    return "trash";
  }
  if (pending.remainder === "top") {
    return "top";
  }
  return "bottom";
}

export function getDeckRevealSwapPendingDestination(
  fallbackRemainder: "top" | "bottom" | "trash"
): "trash" | "deck_bottom" {
  return fallbackRemainder === "trash" ? "trash" : "deck_bottom";
}

export function shouldDeferRevealedChoiceSwapPlacement(
  pending: PendingDeckReveal
): boolean {
  return (
    pending.origin !== "trash" &&
    (pending.remainder === "top_or_bottom" ||
      pending.remainder === "bottom_or_trash")
  );
}

export function applyDeckRevealSwapPlacement(
  pending: PendingZoneSelection,
  placement: "top" | "bottom" | "trash"
): PendingZoneSelection {
  const destination = getDeckRevealSwapPendingDestination(placement);
  const {
    destinationPosition: _oldDestinationPosition,
    swapPlacementFollowsDeckReveal: _oldFollowsDeckReveal,
    ...rest
  } = pending;
  return {
    ...rest,
    destination,
    swapPickedFallbackRemainder: placement,
    ...(destination === "deck_bottom"
      ? { destinationPosition: placement === "top" ? "top" : "bottom" }
      : {}),
  };
}
