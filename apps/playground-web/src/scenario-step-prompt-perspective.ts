import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 実カードの相手選択待ち。chooser=bob でBob REST、kind=deckで水兵ワドルディ。 */
export function buildStepPromptPerspectiveScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const chooser = params?.get("chooser") === "bob" ? "bob" : "alice";
  const owner = chooser === "alice" ? "bob" : "alice";
  const deck = params?.get("kind") === "deck";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const source = definitions.get(deck ? "BSKB01-C02" : "BSGE01-C13")!;
  const metaknight = definitions.get("BSKB01-C01")!;
  const lookups = {
    getCardDefinitionById: (id: string) => definitions.get(id),
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  let state = executeEffect({
    chainId: "scenario:scenario-step-prompt-perspective.ts:28",
    state: {
      ...base,
      activePlayerId: owner,
      turnNumber: 3,
      step: "main",
      players: base.players.map((player) => ({
        ...player,
        countValue: 5,
        deckCount: 2,
        handCount: deck && player.id === owner ? 1 : 0,
      })),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "perspective-source",
          ownerPlayerId: owner,
          zone: deck ? "hand" : "field",
          normalCoreCount: deck ? 0 : 1,
        }),
        ...(deck
          ? [
              createCardInstance(metaknight, {
                instanceId: "perspective-metaknight",
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
        ...["alice", "bob"].flatMap((playerId) =>
          [0, 1].map((index) =>
            createCardInstance(metaknight, {
              instanceId: `${playerId}-deck-${index}`,
              ownerPlayerId: playerId,
              zone: "deck",
            })
          )
        ),
      ],
    },
    effect: source.effects![deck ? 0 : 1]!,
    effectIndex: deck ? 0 : 1,
    sourceInstanceId: "perspective-source",
    actingPlayerId: owner,
    ...lookups,
  });
  if (deck) {
    // 所有者側の破棄は辞退し、相手側の判断へ実際の継続経路で進む。
    const decline = getLegalActions({
      state,
      actingPlayerId: owner,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    if (!decline) throw new Error("Missing owner deck-discard choice");
    state = applyLegalAction({ state, action: decline, ...lookups }).state;
  }
  if (state.pendingStepOptionalChoice?.choosingPlayerId !== chooser) {
    throw new Error("Missing opponent choice");
  }
  return state;
}
