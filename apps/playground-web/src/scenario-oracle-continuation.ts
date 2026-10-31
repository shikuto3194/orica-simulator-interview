import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildOracleContinuationScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  cards = expandCardDefinitionsWithBackFaces(cards);
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const make = (no: string, id: string, zone: "field" | "deck") =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
    });
  const source = {
    ...make("BSTH09-TR01(B)", "source", "field"),
    attachedToInstanceId: "host",
  };
  const host = {
    ...make("BSTH09-X01", "host", "field"),
    normalCoreCount: 1,
    attachedChildrenIds: ["source"],
  };
  const deck = Array.from({ length: 12 }, (_, i) =>
    make(
      i === 0 ? "BSTH08-X01" : i % 4 === 0 ? "BSTH09-C05" : "BSTH09-C01",
      `deck-${i}`,
      "deck"
    )
  );
  return executeEffect({
    state: {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, host, ...deck],
        playerOverrides: ["alice", "bob"].map((id) => ({
          countValue: id === owner ? 3 : 0,
          reserveNormalCoreCount: 4,
          handCount: 0,
          deckCount: id === owner ? 12 : 0,
        })),
      }),
      step: "attack",
      activePlayerId: owner,
    },
    effect: lookup(source.definitionId)!.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: "source",
    actingPlayerId: owner,
    chainId: "scenario:oracle-continuation",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  });
}
