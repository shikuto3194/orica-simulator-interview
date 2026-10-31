import {
  checkAndQueuePlacementOracle,
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-10-16 snapshot: 宵越しの銭・ブレイジングスター・小町の配置時導託。 */
export function buildBlazingStarOracleScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const getDefinition = (id: string) => definitions.get(id);
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: ["alice", "bob"].map((id) => ({
      deckCount: id === owner ? 3 : 0,
      handCount: 0,
      voidNormalCoreCount: 100,
    })),
    cardInstances: [
      createCardInstance(getDefinition("BSTH04-XX01")!, {
        instanceId: "yamazanadu",
        ownerPlayerId: owner,
        zone: "field",
      }),
      ...["BSTH04-C12", "BSTH01-C21", "BSTH04-X03"].map((cardNo, index) =>
        createCardInstance(getDefinition(cardNo)!, {
          instanceId: `oracle-deck-${index}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
  });
  return checkAndQueuePlacementOracle(
    recomputeAndRebuildContinuousEffects(
      { ...state, step: "main", activePlayerId: owner },
      getDefinition
    ),
    "yamazanadu",
    getDefinition,
    "scenario:blazing-star-oracle"
  );
}
