import { requireCardZone } from "../model";
import { replaceCardInstances } from "../zone/card-instance-state";
import { getCEsForTarget } from "../card/ce-lookup";
import { getCardById } from "../card/card-lookup";
import { moveCardZone, resolveCardLeavesFieldCores } from "../core/core-system";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import type { CardDefinition, CardZone, GameState } from "../model";

export function hasPreventBraveSeparationRestriction(
  state: GameState,
  hostInstanceId: string
): boolean {
  return getCEsForTarget(state, hostInstanceId).some(
    (ce) => ce.modifierTag === "prevent_brave_separation"
  );
}

export function movePreventBraveSeparationHostAndBravesDirectly(options: {
  state: GameState;
  hostInstanceId: string;
  destination: CardZone;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  applyFaceDownPolicy?: boolean;
}): {
  state: GameState;
  movedBraveInstanceIds: string[];
  movedInstanceIds: string[];
  actualDestination: CardZone;
} {
  const host = getCardById(options.state, options.hostInstanceId);
  if (!host || options.destination === "field") {
    return {
      state: options.state,
      movedBraveInstanceIds: [],
      movedInstanceIds: [],
      actualDestination: options.destination,
    };
  }

  const movedBraveInstanceIds = host.attachedChildrenIds.filter((id) => {
    const brave = getCardById(options.state, id);
    return brave?.attachedToInstanceId === host.instanceId;
  });
  const hostDefinition = options.getCardDefinitionById(host.definitionId);
  const actualDestination =
    hostDefinition?.keywordTags?.includes("token") === true
      ? "removed_from_game"
      : options.destination;
  let next = options.state;
  const movedInstanceIds = [host.instanceId, ...movedBraveInstanceIds];
  for (const instanceId of movedInstanceIds) {
    if (!getCardById(next, instanceId)) continue;
    next = resolveCardLeavesFieldCores(
      next,
      instanceId,
      null,
      options.getCardDefinitionById
    );
    next = moveCardZone(next, instanceId, requireCardZone(actualDestination));
  }

  const movedBraveSet = new Set(movedBraveInstanceIds);
  const movedSet = new Set(movedInstanceIds);
  next = replaceCardInstances(
    {
      ...next,
    },
    next.cardInstances.map((card) => {
      let updated = card;
      if (card.instanceId === host.instanceId) {
        updated = { ...updated, attachedChildrenIds: [] };
      } else if (movedBraveSet.has(card.instanceId)) {
        updated = { ...updated, attachedToInstanceId: null };
      }
      return options.applyFaceDownPolicy && movedSet.has(card.instanceId)
        ? applyFaceDownPolicyOnZoneChange(updated, actualDestination)
        : updated;
    })
  );

  return {
    state: next,
    movedBraveInstanceIds,
    movedInstanceIds,
    actualDestination,
  };
}
