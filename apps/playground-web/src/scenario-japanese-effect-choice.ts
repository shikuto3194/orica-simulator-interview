import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** BSTH01-C21 の効果選択。legacy=1 は旧 snapshot の英語ラベルを再現する。 */
export function buildJapaneseEffectChoiceScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const source = allCards.find((card) => card.cardNo === "BSTH01-C21")!;
  const sourceId = "japanese-choice-magic";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const state = executeEffect({
    chainId: "scenario:scenario-japanese-effect-choice.ts:18",
    state: {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: owner === "alice" ? "bob" : "alice",
      step: "attack",
      turnNumber: 4,
      cardInstances: [
        createCardInstance(source, {
          instanceId: sourceId,
          ownerPlayerId: owner,
          zone: "in_use",
        }),
      ],
    },
    effect: source.effects![1]!,
    sourceInstanceId: sourceId,
    actingPlayerId: owner,
    getCardDefinitionById: (id) => definitions.get(id),
    getRegisteredTriggeredEffectActions: () => [],
    promptUnresolvedChoice: true,
  });
  if (params?.get("legacy") === "1" && state.pendingStepChoice) {
    state.pendingStepChoice.choices[0]!.label = "unblockable";
  }
  return state;
}
