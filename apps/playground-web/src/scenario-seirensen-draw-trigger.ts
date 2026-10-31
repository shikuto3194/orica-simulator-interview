import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905095: card-9配置後、card-10の2ドローでcard-9だけ転醒。 */
export function buildSeirensenDrawTriggerScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const nexus = cards.find((c) => c.cardNo === "BSTH07-転醒R01(A)")!;
  const deck = cards.find((c) => c.cardNo === "BSTH07-C01")!;
  const instances = [
    ...["card-9", "card-10"].map((instanceId) =>
      createCardInstance(nexus, {
        instanceId,
        ownerPlayerId: owner,
        zone: "hand",
      })
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      createCardInstance(deck, {
        instanceId: `deck-${i + 1}`,
        ownerPlayerId: owner,
        zone: "deck",
      })
    ),
  ];
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: instances,
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 2 : 0,
        deckCount: id === owner ? 8 : 0,
        reserveNormalCoreCount: 12,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 4,
    step: "main",
    window: "none",
  };
}
