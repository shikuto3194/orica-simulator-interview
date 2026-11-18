import { getCardById } from "../card/card-lookup";
import { moveCardZone, resolveCardLeavesFieldCores } from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import { getValidBraveCombineHosts } from "../legal/legal-actions-availability";
import { hasCannotCombineRestriction } from "../mechanics/act-as-spirit";
import type {
  CardDefinition,
  GameState,
  PendingMultiPlacement,
} from "../model";
import { getMultiPlacementTargets } from "../pending-state-guards";
import { countEnterFieldCoreSources } from "./enter-field-core-sources";

type Target = PendingMultiPlacement["targets"][number];
type Lookup = (id: string) => CardDefinition | undefined;

export function getEntryBraveCombineHosts(
  state: GameState,
  target: Target,
  lookup: Lookup
) {
  if (
    target.enterFieldEventKind !== undefined &&
    target.enterFieldEventKind !== "summon"
  )
    return [];
  const card = getCardById(state, target.instanceId);
  const definition = card && lookup(card.definitionId);
  if (
    !card ||
    card.zone !== "field" ||
    card.attachedToInstanceId !== null ||
    definition?.printedCategory !== "brave" ||
    hasCannotCombineRestriction(state, card.instanceId, definition)
  )
    return [];
  return getValidBraveCombineHosts(
    state,
    definition,
    card.controllerPlayerId,
    lookup,
    card.instanceId
  );
}

/** Direct combination needs no maintenance cores; re-evaluate hosts after each choice. */
export function getEntryMinimumCoreCount(
  state: GameState,
  target: Target,
  lookup: Lookup
): number {
  return !state.pendingMultiPlacement?.resolvedBraveCombineInstanceIds?.includes(
    target.instanceId
  ) && getEntryBraveCombineHosts(state, target, lookup).length > 0
    ? 0
    : target.minimumCoreCount;
}

export function openEntryBraveCombineChoice(
  state: GameState,
  lookup: Lookup
): GameState {
  let placement = state.pendingMultiPlacement;
  if (
    !placement ||
    (state.pendingBraveCombineChoice &&
      state.pendingBraveCombineChoice.multiPlacementPendingId !==
        placement.pendingId)
  )
    return state;
  const available = countEnterFieldCoreSources({
    state,
    actingPlayerId: placement.actingPlayerId,
    getCardDefinitionById: lookup,
    excludedFieldSourceIds: new Set([
      ...(placement.excludedFieldSourceIds ?? []),
      ...getMultiPlacementTargets(placement).map((target) => target.instanceId),
    ]),
    trashNormalCapacity: placement.trashNormalCoreMax ?? 0,
    trashGenericCapacity: placement.trashCoreMax ?? 0,
    ...(placement.fieldCoreSourceMinimum
      ? { fieldCoreSourceMinimum: placement.fieldCoreSourceMinimum }
      : {}),
  });
  // A previous brave may have consumed the last compatible host. Apply the
  // normal failed-entry outcome instead of leaving an impossible core prompt.
  let required = 0;
  for (const target of placement.targets) {
    const minimum = getEntryMinimumCoreCount(state, target, lookup);
    const definition = lookup(target.definitionId);
    if (
      required + minimum > available &&
      definition?.printedCategory === "brave"
    ) {
      state = moveCardZone(
        resolveCardLeavesFieldCores(state, target.instanceId),
        target.instanceId,
        "trash",
        getDefaultZoneRoleName(definition, "trash")
      );
      placement = {
        ...placement,
        targets: placement.targets.filter(
          (other) => other.instanceId !== target.instanceId
        ),
      };
      state = {
        ...state,
        pendingMultiPlacement: placement,
        log: [
          ...state.log,
          `effect:field-entry-failed:${target.instanceId}:insufficient-maintenance-cores`,
        ],
      };
    } else {
      required += minimum;
    }
  }
  for (const target of placement.targets) {
    if (placement.resolvedBraveCombineInstanceIds?.includes(target.instanceId))
      continue;
    const hosts = getEntryBraveCombineHosts(state, target, lookup);
    if (hosts.length === 0) continue;
    const otherMinimum = placement.targets.reduce(
      (sum, other) =>
        sum +
        (other === target ? 0 : getEntryMinimumCoreCount(state, other, lookup)),
      0
    );
    return {
      ...state,
      pendingBraveCombineChoice: {
        pendingId: `entry-brave:${placement.pendingId}:${target.instanceId}`,
        multiPlacementPendingId: placement.pendingId,
        actingPlayerId: placement.actingPlayerId,
        braveInstanceId: target.instanceId,
        braveDefinitionId: target.definitionId,
        hostCandidateInstanceIds: hosts.map((host) => host.instanceId),
        spiritStateAffordable:
          available >= target.minimumCoreCount + otherMinimum,
        ...(placement.battleEndDeferralAttackId
          ? { battleEndDeferralAttackId: placement.battleEndDeferralAttackId }
          : {}),
      },
    };
  }
  return state.pendingBraveCombineChoice?.multiPlacementPendingId ===
    placement.pendingId
    ? { ...state, pendingBraveCombineChoice: null }
    : state;
}
