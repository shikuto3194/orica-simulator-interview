import {
  createCardInstance,
  createEmptyGameState,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

export function buildSummonCategoryScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("actor") === "bob" ? "bob" : "alice";
  const cardMap = new Map(allCards.map((c) => [c.cardNo, c]));
  const entries = [
    ["source", "BSSA01-X02", "field"],
    ["spirit", "BSSA01-C01", "hand"],
    ["brave", "BSSA01-転醒X02(A)", "set_aside"],
    ["nexus-hand", "BSSA01-転醒X01(A)", "hand"],
    ["nexus-aside", "BSSA01-転醒X04(A)", "set_aside"],
    ["magic", "BSSA01-C06", "hand"],
  ] as const;
  const cardInstances = entries.map(([id, no, zone]) => {
    const definition = cardMap.get(no);
    if (!definition) throw new Error(`Missing scenario card: ${no}`);
    return createCardInstance(definition, {
      instanceId: `sc-entry-${id}`,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  });
  const initial = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount: 20,
      handCount: id === owner ? 3 : 0,
    })),
  });
  const state: GameState = {
    ...initial,
    turnNumber: 3,
    activePlayerId: owner,
    step: "main",
  };
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "scenario:scenario-summon-category.ts:50",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "sc-entry-source",
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
