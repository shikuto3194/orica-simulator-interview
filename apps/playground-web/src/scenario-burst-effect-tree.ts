import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

// 2026-09-12 snapshot: 反逆者アリスの同時召喚後、コア配置を挟んでも
// ヨハネスの効果発揮宣言は残りの召喚時効果を待つ (公式 Q411)。
export function buildBurstEffectTreeScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const entries = [
    ["summoner", "BSSA01-X02", owner, "field", 2],
    ["child-alice", "BSSA01-X02", owner, "hand", 0],
    ["child-ronie", "BSSA01-C03", owner, "hand", 0],
    ["burst", "BSGE01-M01", opponent, "burst", 0],
    ["draw-1", "BSSA01-C01", opponent, "deck", 0],
    ["draw-2", "BSSA01-C01", opponent, "deck", 0],
  ] as const;
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: entries.map(
      ([instanceId, cardNo, ownerPlayerId, zone, cores]) => {
        const definition = definitions.get(cardNo);
        if (!definition) throw new Error(`Missing scenario card: ${cardNo}`);
        return createCardInstance(definition, {
          instanceId,
          ownerPlayerId,
          zone,
          normalCoreCount: cores,
        });
      }
    ),
    setBurstStates: [{ playerId: opponent, cardInstanceId: "burst" }],
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount: 10,
      trashNormalCoreCount: id === owner ? 3 : 0,
      handCount: id === owner ? 2 : 0,
      deckCount: id === opponent ? 2 : 0,
    })),
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...base, activePlayerId: owner, step: "main", turnNumber: 6 },
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "scenario:scenario-burst-effect-tree.ts:52",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "summoner",
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
