import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildTrashEntryImmunityScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const getDef = (id: string) => definitions.get(id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const source = getDef("BSTH04-転醒R01(A)")!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: ["alice", "bob"].map((id) => ({
      deckCount: id === owner ? 2 : 0,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(source, {
        instanceId: "mirror",
        ownerPlayerId: owner,
        zone: "field",
      }),
      ...["BSTH04-R01", "BSTH04-XX01"].map((cardNo, index) =>
        createCardInstance(getDef(cardNo)!, {
          instanceId: index === 0 ? "immune" : "normal",
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
  });
  return executeEffect({
    chainId: "scenario:scenario-trash-entry-immunity.ts:38",
    state: { ...state, step: "main", activePlayerId: owner },
    effect: source.effects![0]!,
    sourceInstanceId: "mirror",
    actingPlayerId: owner,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
