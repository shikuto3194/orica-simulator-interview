import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905094: 里乃4コア・疲労、隠岐奈4コア、リザーブ0。 */
export function buildPayCostRecoverScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const defs = new Map(allCards.map((card) => [card.cardNo, card]));
  const satono = createCardInstance(defs.get("BSTH11-X04")!, {
    instanceId: "card-3",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 4,
    exhaustState: "exhausted",
  });
  const okina = createCardInstance(defs.get("BSTH11-X01")!, {
    instanceId: "card-13",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 4,
  });
  const state = recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [satono, okina],
        playerOverrides: ["alice", "bob"].map((id) => ({
          id,
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 0,
          soulCoreLocation: null,
        })),
      }),
      activePlayerId: owner,
      turnNumber: 3,
      step: "attack",
      window: "flash_before_block",
    },
    (id) => defs.get(id)
  );
  const attacker = {
    entityId: "battle-entity:card-3",
    memberInstanceIds: ["card-3"],
    resolvedBp: 14000, // 4コアの里乃はLv3。
    resolvedSymbols: ["green" as const],
    attackState: "attacking" as const,
  };
  return {
    ...state,
    battleEntities: [attacker],
    activeAttack: {
      attackId: "pay-cost-recover",
      primaryEntityId: attacker.entityId,
      participantEntityIds: [attacker.entityId],
      groupMode: "single",
      target: { kind: "player", playerId: opponent },
      blockAssignments: [
        { participantEntityId: attacker.entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [attacker.entityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
        consecutiveActiveUseCount: 0,
      },
    },
  };
}
