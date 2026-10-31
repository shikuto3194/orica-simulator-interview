import {
  createCardInstance,
  createEmptyGameState,
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildC07UpToScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const def = (id: string) => cards.find((card) => card.cardNo === id)!;
  const cores = Number(params?.get("cores") ?? 2);
  const opponent = owner === "alice" ? "bob" : "alice";
  const priorBurst = params?.get("burst") === "1";
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        trashNormalCoreCount: id === owner ? cores : 0,
        handCount: id === owner ? 5 : 0,
        deckCount: 4,
        reserveNormalCoreCount: 10,
        soulCoreLocation: { kind: "trash" as const },
      })),
      setBurstStates: priorBurst
        ? [{ playerId: opponent, cardInstanceId: "prior-burst" }]
        : [],
      cardInstances: [
        createCardInstance(def("BSRK01-C07"), {
          instanceId: "c07-yahiko",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(def("BSRK01-CX01"), {
          instanceId: "c07-kenshin",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 2,
        }),
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(def("BSRK01-C03"), {
            instanceId: `c07-hand-${i}`,
            ownerPlayerId: owner,
            zone: "hand",
          })
        ),
        ...["alice", "bob"].flatMap((id) =>
          [0, 1, 2, 3].map((i) =>
            createCardInstance(def("BSRK01-C01"), {
              instanceId: `c07-deck-${id}-${i}`,
              ownerPlayerId: id,
              zone: "deck",
            })
          )
        ),
        ...(priorBurst
          ? [
              createCardInstance(def("BSTH02-M02"), {
                instanceId: "prior-burst",
                ownerPlayerId: opponent,
                zone: "burst",
              }),
            ]
          : []),
      ],
    }),
    turnNumber: 3,
    activePlayerId: owner,
    step: "main",
    window: "none",
  };
  return priorBurst
    ? queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: owner,
            eventKind: "increase_hand",
            source: "action_resolution",
            chainId: "c07-prior-draw",
            attackId: null,
            relatedPlayerId: owner,
            relatedInstanceId: "c07-kenshin",
            amount: 1,
            cause: "self_effect",
          },
        ],
        undefined,
        {
          getCardDefinitionById: def,
          getRegisteredBurstActions: buildBurstEffectLookup(cards),
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(cards),
        }
      )
    : state;
}
