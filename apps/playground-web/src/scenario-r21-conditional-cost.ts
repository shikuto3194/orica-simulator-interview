import {
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** R21 has a friendly legal result while the opposing attacker exceeds its BP cap. */
export function buildR21ConditionalCostScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const other = owner === "alice" ? "bob" : "alice";
  const card = (
    no: string,
    id: string,
    player: string,
    normalCoreCount: number
  ) =>
    createCardInstance(cards.find((definition) => definition.cardNo === no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone: "field",
      normalCoreCount,
    });
  const baseState: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 8, lifeNormalCoreCount: 5 },
        { reserveNormalCoreCount: 8, lifeNormalCoreCount: 5 },
      ],
      cardInstances: [
        card("BSTH01-R21", "r21-source", owner, 0),
        card("BSTH001-C01", "r21-ally", owner, 1),
        {
          ...card("BSTH01-X04", "r21-enemy", other, 1),
          exhaustState: "exhausted",
        },
      ],
    }),
    step: "attack",
    window: "flash_before_block",
    activePlayerId: other,
    turnNumber: 4,
    battleEntities: [
      {
        entityId: "r21-entity",
        memberInstanceIds: ["r21-enemy"],
        resolvedBp: 8000,
        resolvedSymbols: ["red", "red"],
        attackState: "attacking",
      },
    ],
  };
  return {
    ...baseState,
    activeAttack: {
      ...createActiveAttack(baseState, "r21-entity", other),
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
      },
    },
  };
}
