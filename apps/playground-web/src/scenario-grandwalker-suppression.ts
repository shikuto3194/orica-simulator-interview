import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-19提供snapshotの最小再現。両者のカーディナルを鏡で抑止する。 */
export function buildGrandwalkerSuppressionScenario(
  cards: CardDefinition[]
): GameState {
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const instance = (
    cardNo: string,
    instanceId: string,
    ownerPlayerId: string,
    zone: "field" | "trash" | "deck",
    normalCoreCount = 0
  ) =>
    createCardInstance(definitions.get(cardNo)!, {
      instanceId,
      ownerPlayerId,
      zone,
      normalCoreCount,
    });
  return recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { deckCount: 1, handCount: 0 },
          { deckCount: 1, handCount: 0 },
        ],
        cardInstances: [
          instance("BSTH04-転醒R01(A)", "mirror", "bob", "field"),
          instance("BSTH04-C02", "kigen", "bob", "trash"),
          ...["alice", "bob"].flatMap((owner) => [
            instance("BSSA01-XX01", `${owner}-cardinal`, owner, "field", 4),
            instance("BSSA01-C01", `${owner}-deck`, owner, "deck"),
          ]),
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      turnNumber: 5,
    },
    (id) => definitions.get(id)
  );
}
