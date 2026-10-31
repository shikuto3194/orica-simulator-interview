import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 神技の宣言→応答→範囲支払い→バウンス対象の順序を確認する。 */
export function buildDivineSkillPaymentScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const stackResponse = params?.get("mode") === "stack-response";
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const field = (cardNo: string, id: string, cores: number, player = owner) =>
    createCardInstance(definitions.get(cardNo)!, {
      instanceId: id,
      ownerPlayerId: player,
      controllerPlayerId: player,
      zone: "field",
      normalCoreCount: cores,
    });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      field(params?.get("card") ?? "BSTH11-X01", "divine-source", 6),
      field("BSTH11-M01", "divine-target-1", 1),
      field("BSTH11-R03", "divine-target-2", 1),
      field("BSTH11-M01", "divine-target-3", 1),
      field("BSTH11-R01", "divine-attacker", 1, opponent),
      ...(stackResponse
        ? [field("BSTH04-X01", "divine-original", 4, opponent)]
        : []),
    ],
  });
  if (stackResponse) {
    for (const card of base.cardInstances) {
      if (card.instanceId.startsWith("divine-target-"))
        card.exhaustState = "exhausted";
    }
  }
  const rebuilt = recomputeAndRebuildContinuousEffects(
    {
      ...base,
      activePlayerId: opponent,
      turnNumber: 4,
      step: "attack",
      window: "flash_before_block",
    },
    (id) => definitions.get(id)
  );
  return {
    ...rebuilt,
    battleEntities: [
      {
        entityId: "divine-attack-entity",
        memberInstanceIds: ["divine-attacker"],
        resolvedBp: 3000,
        resolvedSymbols: ["green"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "divine-attack",
      primaryEntityId: "divine-attack-entity",
      participantEntityIds: ["divine-attack-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: owner },
      blockAssignments: [
        { participantEntityId: "divine-attack-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["divine-attack-entity"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: stackResponse ? opponent : owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: stackResponse ? opponent : owner,
        pendingStackAction: null,
        consecutiveActiveUseCount: 0,
      },
    },
  };
}
