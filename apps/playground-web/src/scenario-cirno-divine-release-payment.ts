import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905089: 妖精2体の攻撃中、リザーブ0で界放と召喚コストを別に払う。 */
export function buildCirnoDivineReleasePaymentScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const lookup = (id: string) => cards.find((c) => c.cardNo === id);
  const fixtures = [
    ["cirno", "BSTH07.8-X01", "hand", 0],
    ["lily", "BSTH07.8-XX01", "field", 3],
    ["lake", "BSTH07.8-C05", "field", 0],
    ["payer", "BSTH07.8-C03", "field", 1],
    ["fairy", "BSTH07.8-R02", "field", 1],
  ] as const;
  const ids = ["payer", "fairy"];
  const base = rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: ["alice", "bob"].map((id) => ({
          handCount: id === owner ? 1 : 0,
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 1,
          soulCoreLocation: { kind: "trash" },
        })),
        cardInstances: fixtures.map(([instanceId, no, zone, normalCoreCount]) =>
          createCardInstance(lookup(no)!, {
            instanceId,
            ownerPlayerId: owner,
            zone,
            normalCoreCount,
            exhaustState: ids.includes(instanceId) ? "exhausted" : "recovered",
          })
        ),
      }),
      activePlayerId: owner,
      step: "main",
      turnNumber: 3,
    },
    lookup
  );
  return {
    ...base,
    battleEntities: ids.map((id, i) => ({
      entityId: `battle-entity:${id}`,
      memberInstanceIds: [id],
      resolvedBp: 2000,
      resolvedSymbols: [i === 0 ? "guide" : "yellow"],
      attackState: "attacking",
    })),
    activeAttack: {
      attackId: "cirno-payment-battle",
      primaryEntityId: "battle-entity:payer",
      participantEntityIds: ids.map((id) => `battle-entity:${id}`),
      groupMode: "simultaneous",
      target: { kind: "player", playerId: opponent },
      blockAssignments: ids.map((id) => ({
        participantEntityId: `battle-entity:${id}`,
        blockedByEntityIds: [],
      })),
      symbolResolutionOrder: ids.map((id) => `battle-entity:${id}`),
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
      blockerCapacity: "participant_count",
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
      },
    },
    activePlayerId: owner,
    step: "attack",
    window: "flash_before_block",
    turnNumber: 3,
  };
}
