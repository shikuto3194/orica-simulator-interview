import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildTx01AttackStartScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const tx01 = definitions.find((d) => d.cardNo === "BSTH02.7-TX01(B)")!;
  const target = definitions.find((d) => d.cardNo === "BSTH01-C04")!;
  const burst = definitions.find((d) => d.cardNo === "BSTH01-M13")!;
  if (!tx01 || !target || !burst)
    throw new Error("TX01 attack-start card missing");
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 1 : 0,
        reserveNormalCoreCount: 3,
      })),
      cardInstances: [
        {
          ...createCardInstance(tx01, {
            instanceId: "tx01-start",
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 2,
          }),
          originalDefinitionId: "BSTH02.7-TX01(A)",
        },
        createCardInstance(target, {
          instanceId: "tx01-target",
          ownerPlayerId: opponent,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(burst, {
          instanceId: "tx01-burst-hand",
          ownerPlayerId: owner,
          zone: "hand",
        }),
        createCardInstance(burst, {
          instanceId: "tx01-burst-aside",
          ownerPlayerId: owner,
          zone: "set_aside",
        }),
      ],
    }),
    turnNumber: 6,
    activePlayerId: opponent,
    step: "main",
    window: "none",
  };
}
