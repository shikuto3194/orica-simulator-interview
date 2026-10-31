import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildCoreDistributionGroupsScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const cb = params?.get("kind") === "cb";
  const defs = new Map(allCards.map((d) => [d.cardNo, d]));
  const getDef = (id: string) => defs.get(id);
  const field = (no: string, id: string) =>
    createCardInstance(getDef(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone: "field",
      cores: 1,
    });
  const source = cb ? "BSLH01-X04" : "BSTH11-R03";
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      field(source, "group-source"),
      ...(cb
        ? Array.from({ length: 4 }, (_, i) => field(source, `group-cb-${i}`))
        : [
            field("BSTH11-X02", "group-dual"),
            field("BSTH11-C01", "group-fantasy"),
            field("BSTH11-X01", "group-secret"),
          ]),
      ...Array.from({ length: 4 }, (_, i) =>
        createCardInstance(getDef("BSTH11-C04")!, {
          instanceId: `group-deck-${i}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      id,
      voidNormalCoreCount: 20,
      trashNormalCoreCount: 3,
    })),
  });
  state = recomputeAndRebuildContinuousEffects(
    { ...state, activePlayerId: owner, step: "main", turnNumber: 3 },
    getDef
  );
  return executeEffect({
    state,
    chainId: "scenario:core-distribution-groups",
    sourceInstanceId: "group-source",
    actingPlayerId: owner,
    effect: getDef(source)!.effects![cb ? 0 : 1]!,
    effectIndex: cb ? 0 : 1,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
