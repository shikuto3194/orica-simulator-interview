import {
  createCardInstance,
  createEmptyGameState,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 空の手札で使用し、3枚引いてから破棄方法を選ぶ。 */
export function buildSequentialOrderScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const withBurst = params?.get("burst") === "1";
  const magic = cards.find((c) => c.cardNo === "BSTH05.5-C10")!;
  const filler = cards.find((c) => c.cardNo === "BSTH01-C01")!;
  if (params?.get("mode") === "post-draw") {
    const drive = cards.find((c) => c.cardNo === "BSAZ02-C10")!;
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(drive, {
            instanceId: "post-draw-drive",
            ownerPlayerId: owner,
            zone: "field",
          }),
          createCardInstance(filler, {
            instanceId: "post-draw-hand",
            ownerPlayerId: owner,
            zone: "hand",
          }),
          ...Array.from({ length: 3 }, (_, i) =>
            createCardInstance(filler, {
              instanceId: `post-draw-deck-${i}`,
              ownerPlayerId: owner,
              zone: "deck",
            })
          ),
        ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          handCount: id === owner ? 1 : 0,
          deckCount: id === owner ? 3 : 0,
        })),
      }),
      activePlayerId: owner,
      turnNumber: 3,
      step: "main",
      window: "none",
    };
    return queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          actingPlayerId: owner,
          eventKind: "summon",
          source: "action_resolution",
          chainId: "scenario:post-draw-selection",
          attackId: null,
          relatedPlayerId: owner,
          relatedInstanceId: "post-draw-drive",
          amount: null,
          fromZone: "hand",
        },
      ],
      undefined,
      {
        getCardDefinitionById: (id) => cards.find((card) => card.cardNo === id),
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
        getRegisteredBurstActions: () => [],
      }
    );
  }
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(magic, {
        instanceId: "sequential-magic",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      ...(withBurst
        ? [
            createCardInstance(cards.find((c) => c.cardNo === "BSTH02-M02")!, {
              instanceId: "sequential-burst",
              ownerPlayerId: opponent,
              zone: "burst",
            }),
          ]
        : []),
      ...Array.from({ length: 5 }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `sequential-deck-${i}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: id === owner ? 1 : 0,
      deckCount: id === owner ? 5 : 0,
      reserveNormalCoreCount: 10,
    })),
    setBurstStates: withBurst
      ? [{ playerId: opponent, cardInstanceId: "sequential-burst" }]
      : [],
  });
  return {
    ...base,
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
}
