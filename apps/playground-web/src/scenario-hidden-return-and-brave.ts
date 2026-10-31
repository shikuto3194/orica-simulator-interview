import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

export function buildHiddenCardReturnScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const getDefinition = (id: string) =>
    allCards.find((card) => card.cardNo === id);
  const magic = getDefinition("BSRK01-C03")!;
  const source = createCardInstance(magic, {
    instanceId: "hidden-return-source",
    ownerPlayerId: owner,
    zone: "in_use",
  });
  const cards = Array.from({ length: 9 }, (_, index) =>
    createCardInstance(
      getDefinition(index % 2 ? "BSRK01-C04" : "BSTS01-R02")!,
      {
        instanceId: `hidden-return-${index}`,
        ownerPlayerId: owner,
        zone: index < 4 ? "hand" : "deck",
      }
    )
  );
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [source, ...cards],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: id === owner ? 4 : 0,
      deckCount: id === owner ? 5 : 0,
      lifeNormalCoreCount: 5,
    })),
  });
  return executeEffect({
    chainId: "scenario:scenario-hidden-return-and-brave.ts:40",
    state: { ...base, step: "main", turnNumber: 3, activePlayerId: owner },
    effect: magic.effects![1]!,
    sourceInstanceId: source.instanceId,
    actingPlayerId: owner,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

export function buildBraveConditionScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const cards = ["BSRK01-X01", "BSTS01-R02", "BSRK01-C04"].map((no, index) =>
    createCardInstance(allCards.find((card) => card.cardNo === no)!, {
      instanceId: `brave-condition-${index}`,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
  });
  return { ...base, step: "main", turnNumber: 3, activePlayerId: owner };
}
