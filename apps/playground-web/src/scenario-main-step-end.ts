import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildMainStepEndScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const magic = params?.get("magic") === "1";
  const def = (cardNo: string) => {
    const card = cards.find((candidate) => candidate.cardNo === cardNo);
    if (!card) throw new Error(`Scenario card not found: ${cardNo}`);
    return card;
  };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    startingDeckCount: 3,
    cardInstances: [
      createCardInstance(def("BSKB01-C01"), {
        instanceId: "main-end-metaknight",
        ownerPlayerId: owner,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(def("BSKB01-C02"), {
        instanceId: "main-end-waddle-dee",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      // 通常の召喚候補が残っていても、終了宣言済みのステップは再開する。
      createCardInstance(def("BSTH01-C01"), {
        instanceId: "main-end-hand",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      ...(magic
        ? [
            createCardInstance(def("BSTH02.7-C01"), {
              instanceId: "main-end-magic",
              ownerPlayerId: owner,
              zone: "hand",
            }),
          ]
        : []),
      ...["alice", "bob"].flatMap((playerId) =>
        [0, 1, 2].map((index) =>
          createCardInstance(def("BSTH01-C01"), {
            instanceId: `main-end-deck-${playerId}-${index}`,
            ownerPlayerId: playerId,
            zone: "deck",
          })
        )
      ),
    ],
  });
  return {
    ...state,
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
}
