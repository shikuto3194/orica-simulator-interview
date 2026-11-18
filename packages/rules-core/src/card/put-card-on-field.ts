import { getCardById } from "./card-lookup";
import { moveCardZone } from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import { isCardUseRestricted } from "../legal/legal-actions-shared";
import type { CardDefinition, CardInstance, GameState } from "../model";

export function isEffectSummonFieldEntry(
  definition: CardDefinition | undefined
) {
  return (
    definition?.printedCategory === "spirit" ||
    definition?.printedCategory === "ultimate" ||
    definition?.printedCategory === "brave"
  );
}

/** Shared by effect placement and its search/reveal candidate filters. */
export function isEffectFieldEntryRestricted(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition,
  getDefinition: (id: string) => CardDefinition | undefined
): boolean {
  const useKind =
    definition.printedCategory === "nexus"
      ? "place_nexus"
      : isEffectSummonFieldEntry(definition)
        ? "summon"
        : "put_on_field";
  return isCardUseRestricted(
    state,
    card.controllerPlayerId,
    card,
    definition,
    getDefinition,
    useKind,
    { byEffect: true }
  );
}

/** Put a card on the field without summoning, placing a nexus, or using magic. */
export function putCardOnField(
  state: GameState,
  instanceId: string,
  getDefinition: (id: string) => CardDefinition | undefined,
  actingPlayerId?: string
): GameState {
  const card = getCardById(state, instanceId);
  if (!card || card.zone === "field") return state;
  const definition = getDefinition(card.definitionId);
  if (
    definition &&
    isCardUseRestricted(
      state,
      actingPlayerId ?? card.controllerPlayerId,
      card,
      definition,
      getDefinition,
      "put_on_field",
      { byEffect: true }
    )
  ) {
    return {
      ...state,
      log: [...state.log, `effect:field_place:${instanceId}:restricted`],
    };
  }
  return moveCardZone(
    state,
    instanceId,
    "field",
    definition ? getDefaultZoneRoleName(definition, "field") : card.zoneRoleName
  );
}
