import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-13 snapshotの古いレムリナ配置ログと、正規バーストの対照盤面。 */
export function buildStaleBurstCheckScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const validBurst = params?.get("stage") === "burst";
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const def = (cardNo: string) => cards.find((card) => card.cardNo === cardNo)!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def("BSAZ02-X05"), {
        instanceId: "card-19",
        ownerPlayerId: owner,
        zone: "field",
        cores: 1,
      }),
      ...["alice", "bob"].map((player) =>
        createCardInstance(def("BSAZ02-R01"), {
          instanceId: `${player}-deck`,
          ownerPlayerId: player,
          zone: "deck",
        })
      ),
      ...(validBurst
        ? [
            createCardInstance(def("BSTH03-M06"), {
              instanceId: "real-burst",
              ownerPlayerId: "alice",
              zone: "burst",
              faceDown: true,
            }),
          ]
        : []),
    ],
    startingDeckCount: 1,
    ...(validBurst
      ? {
          setBurstStates: [{ playerId: "alice", cardInstanceId: "real-burst" }],
        }
      : {}),
  });
  return {
    ...state,
    turnNumber: 4,
    activePlayerId: validBurst ? "bob" : owner,
    step: validBurst ? "main" : "draw",
    log: [`effect:field_place:deck_reveal:${owner}:card-19`],
  };
}
