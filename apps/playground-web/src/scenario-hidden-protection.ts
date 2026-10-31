import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildHiddenProtectionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const make = (
    no: string,
    id: string,
    player: string,
    zone: "field" | "mirage" | "burst",
    normalCoreCount = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount,
    });
  const source = lookup("BSTH09-X01")!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make(source.cardNo, "source", owner, "field", 2),
      make("BSTH09-C05", "nexus", opponent, "field"),
      make(
        cards.find((card) => card.mirageData)!.cardNo,
        "mirage",
        opponent,
        "mirage"
      ),
      make("BSTH01-X07", "burst", opponent, "burst"),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: 0,
      deckCount: 0,
      trashNormalCoreCount: id === owner ? 2 : 0,
    })),
    setBurstStates: [{ playerId: opponent, cardInstanceId: "burst" }],
    mirageSetStates: [{ playerId: opponent, cardInstanceId: "mirage" }],
  });
  return executeEffect({
    state: rebuildContinuousEffectsFromField(
      { ...state, step: "main", activePlayerId: owner },
      lookup
    ),
    effect: source.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: "source",
    actingPlayerId: owner,
    chainId: "scenario:hidden-protection",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
