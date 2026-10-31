import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905090: compare implicit accel with the printed accel oracle. */
export function buildOracleTriggerKindsScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const explicitAccel = params?.get("mode") === "explicit-accel";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const make = (no: string, id: string, zone: "hand" | "field", cores = 0) =>
    createCardInstance(definitions.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make(
        explicitAccel ? "BSTH08.5-X03" : "BSTH03-X02",
        "oracle-source",
        "field"
      ),
      make(
        explicitAccel ? "BSTH08.5-C20" : "BSTH03-C03",
        "oracle-target",
        "hand"
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: id === owner ? 1 : 0,
      reserveNormalCoreCount: 12,
      voidNormalCoreCount: 20,
    })),
  });
  return rebuildContinuousEffectsFromField(
    {
      ...base,
      turnNumber: 5,
      activePlayerId: owner,
      step: "main",
      window: "none",
    },
    (id) => definitions.get(id)
  );
}
