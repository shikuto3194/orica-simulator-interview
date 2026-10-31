import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Before a real nexus deployment. The effect pending is created by the reducer. */
export function buildMakaiConditionalCostScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const hand = params?.get("mode") === "empty-hand" ? 0 : 2;
  const deck = params?.get("mode") === "empty-deck" ? 0 : 3;
  const card = (no: string, id: string, zone: "hand" | "deck") =>
    createCardInstance(cards.find((c) => c.cardNo === no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
    });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 8,
        lifeNormalCoreCount: 5,
        handCount: id === owner ? hand + 1 : 0,
        deckCount: id === owner ? deck : 0,
      })),
      cardInstances: [
        card("BSTH002-転醒R01(A)", "makai", "hand"),
        ...Array.from({ length: hand }, (_, i) =>
          card("BSTH001-C01", `cost-${i}`, "hand")
        ),
        ...Array.from({ length: deck }, (_, i) =>
          card("BSTH001-C01", `draw-${i}`, "deck")
        ),
      ],
    }),
    activePlayerId: owner,
    step: "main",
    turnNumber: 4,
  };
}
