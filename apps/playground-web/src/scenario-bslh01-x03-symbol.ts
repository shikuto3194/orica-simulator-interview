import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** ロイドの連続アタックと、ブロック時のシンボル・任意回復。 */
export function buildBslh01X03SymbolScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const other = owner === "alice" ? "bob" : "alice";
  const getDef = (id: string) => cards.find((card) => card.cardNo === id);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { lifeNormalCoreCount: 10 },
        { lifeNormalCoreCount: 10 },
      ],
      cardInstances: [
        createCardInstance(getDef("BSLH01-X03")!, {
          instanceId: "lloyd",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...(params?.get("role") === "block"
          ? ["attacker", "attacker-2"].map((instanceId) =>
              createCardInstance(getDef("BSTH01-C01")!, {
                instanceId,
                ownerPlayerId: other,
                zone: "field",
                normalCoreCount: 1,
              })
            )
          : []),
      ],
    }),
    activePlayerId: params?.get("role") === "block" ? other : owner,
    turnNumber: 3,
    step: "attack",
    window: "none",
  };
  return rebuildContinuousEffectsFromField(state, getDef);
}
