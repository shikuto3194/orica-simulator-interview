import {
  checkAndQueuePlacementOracle,
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildPlacementOracleTrashScenario(
  cards: CardDefinition[]
): GameState {
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const getDefinition = (id: string) => definitions.get(id);
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { deckCount: 3, handCount: 0 },
      { deckCount: 0, handCount: 0 },
    ],
    cardInstances: [
      createCardInstance(getDefinition("BSSA01-XX01")!, {
        instanceId: "oracle-cardinal",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(getDefinition("BSTS01-C05")!, {
        instanceId: "oracle-tempest",
        ownerPlayerId: "bob",
        zone: "field",
      }),
      ...["BSSA01-C01", "BSSA01-C02", "BSTH02-R11"].map((cardNo, index) =>
        createCardInstance(getDefinition(cardNo)!, {
          instanceId: `oracle-deck-${index}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      ),
    ],
  });
  return checkAndQueuePlacementOracle(
    recomputeAndRebuildContinuousEffects(
      { ...state, step: "main", activePlayerId: "alice" },
      getDefinition
    ),
    "oracle-cardinal",
    getDefinition,
    "scenario:scenario-placement-oracle-trash.ts:41"
  );
}
