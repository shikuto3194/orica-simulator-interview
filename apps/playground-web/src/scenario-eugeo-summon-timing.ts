import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

export function buildEugeoSummonTimingScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  if (params?.get("variant") === "core-boost")
    return buildEugeoCoreBoostScenario(allCards, params);
  const owner = params?.get("actor") === "bob" ? "bob" : "alice";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const entries = [
    ["summoner", "BSSA01-X02", "field"],
    ["eugeo", "BSSA01-C02", "hand"],
    ["kirito", "BSSA01-X01", "hand"],
    ["cardinal", "BSSA01-XX01", "field"],
  ] as const;
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: entries.map(([instanceId, cardNo, zone]) => {
      const definition = definitions.get(cardNo);
      if (!definition) throw new Error(`Missing scenario card: ${cardNo}`);
      return createCardInstance(definition, {
        instanceId,
        ownerPlayerId: owner,
        zone,
        normalCoreCount: zone === "field" ? 1 : 0,
      });
    }),
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount: 10,
      handCount: id === owner ? 2 : 0,
    })),
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...base, activePlayerId: owner, step: "main", turnNumber: 3 },
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "scenario:scenario-eugeo-summon-timing.ts:43",
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

function buildEugeoCoreBoostScenario(
  allCards: CardDefinition[],
  params: URLSearchParams
): GameState {
  const owner = params.get("actor") === "bob" ? "bob" : "alice";
  const definitions = new Map(allCards.map((c) => [c.cardNo, c]));
  const entries = [
    ["source", "BSSA01-転醒X03(A)", "field"],
    ...(params.get("multi") === "1" ? [["ally", "BSSA01-C02", "field"]] : []),
    ...(params.get("rose") === "1"
      ? [["rose", "BSSA01-転醒X02(A)", "hand"]]
      : []),
  ];
  const initial = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: entries.map(([instanceId, cardNo, zone]) =>
      createCardInstance(definitions.get(cardNo!)!, {
        instanceId: instanceId!,
        ownerPlayerId: owner,
        zone: zone === "hand" ? "hand" : "field",
        normalCoreCount: zone === "field" ? 1 : 0,
      })
    ),
    playerOverrides: ["alice", "bob"].map((id) => ({
      voidNormalCoreCount: Number(params.get("void") ?? "10"),
      reserveNormalCoreCount: 5,
      handCount: id === owner && params.get("rose") === "1" ? 1 : 0,
    })),
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...initial, activePlayerId: owner, step: "main", turnNumber: 3 },
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "scenario:scenario-eugeo-summon-timing.ts:95",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "source",
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
