import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildBssl01FidelityScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const role = params?.get("role") ?? "soul";
  const variant = params?.get("variant");
  const get = (no: string) => cards.find((c) => c.cardNo === no)!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(get("BSSL01-CX01"), {
        instanceId: "audit-shun",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: role === "spirit" ? 1 : 0,
      }),
      createCardInstance(get("BSSL01-C01"), {
        instanceId: "audit-attacker",
        ownerPlayerId: opponent,
        zone: "field",
        normalCoreCount: 2,
        exhaustState: "exhausted",
      }),
      ...["hand-1", "hand-2", "deck-1", "deck-2", "deck-3"].map((id) =>
        createCardInstance(get("BSSL01-C02"), {
          instanceId: `audit-${id}`,
          ownerPlayerId: owner,
          zone: id.startsWith("hand") ? "hand" : "deck",
        })
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) =>
      id === owner
        ? {
            countValue: 0,
            handCount: 2,
            deckCount: 3,
            contractCardNo: "BSSL01-CX01",
            soulStateInstanceIds: role === "soul" ? ["audit-shun"] : [],
          }
        : { handCount: 0, countValue: 0 }
    ),
  });
  if (role === "advent")
    state.cardInstances.push({
      ...createCardInstance(get("BSSL01-C01"), {
        instanceId: "audit-host",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 2,
      }),
      underCards: [{ cardInstanceId: "audit-shun", role: "advent_source" }],
    });
  if (variant === "preparation") {
    state.cardInstances.find(
      (c) => c.instanceId === "audit-hand-1"
    )!.definitionId = "BSSL01-C01";
    state.cardInstances.push(
      createCardInstance(get("BSSL01-X02"), {
        instanceId: "audit-x02",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      createCardInstance(get("BSSL01-C01"), {
        instanceId: "audit-trash-player",
        ownerPlayerId: owner,
        zone: "trash",
      })
    );
    const player = state.players.find((p) => p.id === owner)!;
    player.handCount = 3;
    player.countValue = 7;
    player.reserveNormalCoreCount = 5;
    player.soulCoreLocation = { kind: "reserve" };
  }
  if (variant === "position") {
    state.cardInstances.unshift(
      createCardInstance(get("BSSL01-M03"), {
        instanceId: "audit-kaisel",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const shun = state.cardInstances.find(
      (c) => c.instanceId === "audit-shun"
    )!;
    shun.normalCoreCount = 3;
    shun.exhaustState = "exhausted";
    shun.attachedChildrenIds = ["audit-brave"];
    state.cardInstances.push({
      ...createCardInstance(get("BSSL01-R03"), {
        instanceId: "audit-brave",
        ownerPlayerId: owner,
        zone: "field",
      }),
      attachedToInstanceId: shun.instanceId,
    });
  }
  const active = variant ? owner : opponent;
  const attackerId = variant === "position" ? "audit-shun" : "audit-attacker";
  if (variant) {
    const attacker = state.cardInstances.find(
      (c) => c.instanceId === attackerId
    )!;
    attacker.ownerPlayerId = owner;
    attacker.controllerPlayerId = owner;
  }
  return {
    ...state,
    turnNumber: 3,
    activePlayerId: active,
    step: "attack",
    window: "flash_before_block",
    battleEntities: [
      {
        entityId: "audit-attacker-entity",
        memberInstanceIds: [
          attackerId,
          ...(variant === "position" ? ["audit-brave"] : []),
        ],
        attackState: "attacking",
        resolvedBp: 7000,
        resolvedSymbols: ["purple"],
      },
    ],
    activeAttack: {
      attackId: "audit-attack",
      primaryEntityId: "audit-attacker-entity",
      participantEntityIds: ["audit-attacker-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: variant ? opponent : owner },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
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
