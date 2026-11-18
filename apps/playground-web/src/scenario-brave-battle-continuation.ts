import {
  createCardInstance,
  createEmptyGameState,
  createActiveAttack,
  queuePendingLeave,
  flushPendingLeaves,
  useOpenBattleFlashAsAction,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 実際の離脱待機から、残留選択後の自動継続・空バトルを検証する。 */
export function buildBraveBattleContinuationScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const blocking = params?.get("role") === "block";
  const restricted = params?.get("restricted") === "1";
  const getCardDefinitionById = (id: string) =>
    allCards.find((c) => c.cardNo === id);
  const braveDef = getCardDefinitionById(
    restricted ? "BSGE01-TX01(A)" : "BSTH01-X09"
  )!;
  const hostDef = restricted
    ? getCardDefinitionById("BSGE01-CX01")!
    : allCards.find(
        (c) =>
          c.printedCategory === "spirit" &&
          c.name.includes("フランドール・スカーレット")
      )!;
  const enemyDef = getCardDefinitionById("BSTH01-C01")!;
  const cards = [
    createCardInstance(hostDef, {
      instanceId: "sc-cont-host",
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: 4,
      exhaustState: "exhausted",
      attachedChildrenIds: ["sc-cont-brave"],
    }),
    createCardInstance(braveDef, {
      instanceId: "sc-cont-brave",
      ownerPlayerId: owner,
      zone: "field",
      attachedToInstanceId: "sc-cont-host",
    }),
    createCardInstance(enemyDef, {
      instanceId: "sc-cont-enemy",
      ownerPlayerId: opponent,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    }),
  ];
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    playerOverrides: [
      { reserveNormalCoreCount: 6 },
      { reserveNormalCoreCount: 6 },
    ],
  });
  const active = blocking ? opponent : owner;
  const attackerId = blocking ? "sc-cont-enemy-entity" : "sc-cont-entity";
  const before: GameState = {
    ...base,
    step: "attack",
    window: blocking ? "declare_block" : "declare_attack",
    turnNumber: 3,
    activePlayerId: active,
    battleEntities: [
      {
        entityId: "sc-cont-entity",
        memberInstanceIds: ["sc-cont-host", "sc-cont-brave"],
        resolvedBp: 10000,
        resolvedSymbols: ["red", "red"],
        attackState: blocking ? "blocking" : "attacking",
      },
      ...(blocking
        ? [
            {
              entityId: "sc-cont-enemy-entity",
              memberInstanceIds: ["sc-cont-enemy"],
              resolvedBp: 1000,
              resolvedSymbols: ["red" as const],
              attackState: "attacking" as const,
            },
          ]
        : []),
    ],
    activeAttack: {
      ...createActiveAttack(
        { ...base, turnNumber: 3, activePlayerId: active },
        attackerId,
        active
      ),
      flashBeforeBlockCompleted: blocking,
      blockAssignments: [
        {
          participantEntityId: attackerId,
          blockedByEntityIds: blocking ? ["sc-cont-entity"] : [],
        },
      ],
    },
  };
  const opened = useOpenBattleFlashAsAction({
    state: before,
    actingPlayerId: active,
    flashKind: blocking ? "after_block" : "before_block",
  }).state;
  return flushPendingLeaves(
    queuePendingLeave({
      state: opened,
      instanceId: "sc-cont-host",
      kind: "bounce",
      leaveDestination: { zone: "hand" },
      cause: "effect_resolution",
      causePlayerId: opponent,
      chainId: "scenario-brave-continuation",
    }),
    getCardDefinitionById
  );
}
