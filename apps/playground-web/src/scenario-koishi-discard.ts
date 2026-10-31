import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** BSTH06-X02: 通常アタックから相手の手元を発揮側が選んで破棄する。 */
export function buildKoishiDiscardScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definitions.get("BSTH06-X02")!, {
          instanceId: "koishi",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
        ...["BSTH06-C01", "BSTH01-C12"].map((id, index) =>
          createCardInstance(definitions.get(id)!, {
            instanceId: `koishi-target-${index}`,
            ownerPlayerId: opponent,
            zone: "set_aside",
          })
        ),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "attack",
    window: "none",
  };
}
