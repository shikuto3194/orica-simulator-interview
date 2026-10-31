import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** Actual placement trigger / hand magic, with both legal sources and decoys. */
export function buildSummonSourceUnionScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const magic = params?.get("card") === "BSGE01-C16";
  const sourceNo = magic ? "BSGE01-C16" : "BSTS01-C05";
  const targetNo = magic ? "BSGE01-CX03" : "BSTS01-CX01";
  const cardMap = new Map(allCards.map((card) => [card.cardNo, card]));
  const entries = [
    ["source", sourceNo, magic ? "hand" : "field", owner],
    ["trash", targetNo, "trash", owner],
    ["soul", targetNo, "field", owner],
    ["ordinary", targetNo, "field", owner],
    ["hand", targetNo, "hand", owner],
    ["wrong", "BSTH01-C01", "trash", owner],
    ["opponent", targetNo, "trash", opponent],
  ] as const;
  const cardInstances = entries.map(([id, cardNo, zone, player]) => {
    const definition = cardMap.get(cardNo);
    if (!definition) throw new Error(`Missing scenario card: ${cardNo}`);
    return createCardInstance(definition, {
      instanceId: `sc-union-${id}`,
      ownerPlayerId: player,
      zone,
      normalCoreCount: id === "ordinary" ? 1 : 0,
    });
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances,
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 10,
        handCount: id === owner ? (magic ? 2 : 1) : 0,
        soulStateInstanceIds: id === owner ? ["sc-union-soul"] : [],
      })),
    }),
    activePlayerId: owner,
    turnNumber: 4,
    step: "main",
  };
  if (magic) return state;
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: owner,
        eventKind: "place",
        source: "action_resolution",
        chainId: "scenario:scenario-summon-source-union.ts:57",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "sc-union-source",
        amount: 1,
      },
    ],
    undefined,
    {
      getCardDefinitionById: (id) => cardMap.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
      getRegisteredBurstActions: () => undefined,
    }
  );
}
