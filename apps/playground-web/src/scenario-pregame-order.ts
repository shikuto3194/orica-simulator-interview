import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 相手手札にパチュリーがある状態から先後選択とマリガンを確認する。 */
export function buildPregameOrderScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "alice" ? "alice" : "bob";
  const definition = (id: string) => cards.find((card) => card.cardNo === id)!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: ["alice", "bob"].flatMap((playerId) =>
      Array.from({ length: 40 }, (_, index) =>
        createCardInstance(
          definition(
            playerId === owner && index === 0 ? "BSTH01-M01" : "BSTH01-C01"
          ),
          {
            instanceId: `pregame-${playerId}-${index}`,
            ownerPlayerId: playerId,
            zone: index < 4 ? "hand" : "deck",
          }
        )
      )
    ),
  });
  return {
    ...state,
    turnNumber: 1,
    step: "start",
    players: state.players.map((player) => ({
      ...player,
      handCount: 4,
      deckCount: 36,
    })),
    preGame: {
      phase: "waiting_janken",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: null,
      firstPlayerId: null,
      mulliganDone: {},
    },
  };
}
