import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
  rememberKnownDeckCardsByInstanceIds,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

export function buildKnownDeckScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const deck = [
    "BSSA01-C01",
    "BSRK01-C06",
    "BSTH02-R11",
    "BSSA01-転醒X02(A)",
    ...Array<string>(22).fill("BSSA01-C03"),
    "BSSA01-C02",
  ];
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(definitions.get("BSSA01-C01")!, {
        instanceId: "known-source",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      }),
      ...deck.map((id, i) =>
        createCardInstance(definitions.get(id)!, {
          instanceId: "known-deck-" + i,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      deckCount: id === owner ? 27 : 0,
      countValue: 1,
      lifeNormalCoreCount: 6,
    })),
  });
  const state = rememberKnownDeckCardsByInstanceIds({
    state: base,
    playerId: owner,
    instanceIds: [0, 1, 2, 3, 26].map((i) => "known-deck-" + i),
    audience: "both",
    actorPlayerId: owner,
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...state, activePlayerId: owner, step: "main", turnNumber: 3 },
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "scenario:scenario-known-deck.ts:57",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "known-source",
        amount: null,
      },
    ],
    undefined,
    {
      getCardDefinitionById: (id) => definitions.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
      getRegisteredBurstActions: () => undefined,
    }
  );
}
