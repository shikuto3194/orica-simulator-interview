import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeBattleResolution,
  executeEffect,
  flushPendingLeaves,
  getBlockDeclarationBlockReason,
  getEffectiveBp,
  getEffectiveSymbols,
  getLegalActions,
  isBattleCapableCategory,
  recomputeBattleEntityBp,
} from "../src";
import type {
  BattleEntity,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(
  cardNo = "TEST-S01",
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: "Test Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    symbolColors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
      { level: 3, requiredCores: 5, bp: 8000 },
    ],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "",
    ...overrides,
  };
}

function nexusDef(cardNo = "TEST-N01"): CardDefinition {
  return spiritDef(cardNo, {
    printedCategory: "nexus",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
  });
}

function ultimateDef(cardNo = "TEST-U01"): CardDefinition {
  return spiritDef(cardNo, {
    printedCategory: "ultimate",
    symbolColors: ["red", "red"],
    levelDefs: [
      { level: 3, requiredCores: 3, bp: 10000 },
      { level: 4, requiredCores: 5, bp: 15000 },
    ],
  });
}

function fieldCard(
  instanceId: string,
  def: CardDefinition,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function makeBattleEntity(
  instanceId: string,
  def: CardDefinition,
  bp: number
): BattleEntity {
  return {
    entityId: `entity-${instanceId}`,
    side: ALICE,
    memberInstanceIds: [instanceId],
    resolvedBp: bp,
    resolvedSymbols: [...def.symbolColors],
  };
}

function makeActiveAttack(
  entityId: string
): NonNullable<GameState["activeAttack"]> {
  return {
    attackId: "attack-1",
    primaryEntityId: entityId,
    participantEntityIds: [entityId],
    groupMode: "single",
    target: { kind: "player", playerId: "player-2" },
    blockAssignments: [],
    symbolResolutionOrder: [entityId],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
}

function bpModifierCE(
  targetInstanceId: string,
  amount: number,
  opts: Partial<ContinuousEffect> = {}
): ContinuousEffect {
  return {
    effectId: `ce-bp-${targetInstanceId}-${amount}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "bp_modifier",
    modifierAmount: amount,
    targetInstanceId,
    ...opts,
  };
}

function symbolAdditionCE(
  targetInstanceId: string,
  symbol: string
): ContinuousEffect {
  return {
    effectId: `ce-sym-${targetInstanceId}-${symbol}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "symbol_addition",
    modifierSymbol: [symbol as never],
    targetInstanceId,
  };
}

describe("battle entity field-leave cleanup", () => {
  it("removes idle battle entity members when pending leave is flushed", () => {
    const def = spiritDef("TEST-FLUSH-BATTLE-ENTITY");
    const lookup = (definitionId: string) =>
      definitionId === def.cardNo ? def : undefined;
    const field = createCardInstance(def, {
      instanceId: "leaving-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "cost_payment",
      pendingLeaveChainId: "test-cost-chain",
      deferZoneMoveUntilChainEnd: false,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [field],
      }),
      battleEntities: [
        {
          entityId: "battle-entity:leaving-spirit",
          memberInstanceIds: ["leaving-spirit"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "idle" as const,
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "leaving-spirit",
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          causePlayerId: ALICE,
          chainId: "test-cost-chain",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const flushed = flushPendingLeaves(state, lookup);

    expect(
      flushed.cardInstances.find((card) => card.instanceId === "leaving-spirit")
        ?.zone
    ).toBe("trash");
    expect(flushed.battleEntities).toEqual([]);
  });

  it("removes an active single attacker from battle entities when it leaves field", () => {
    const def = spiritDef("TEST-FLUSH-ACTIVE-ATTACKER");
    const lookup = (definitionId: string) =>
      definitionId === def.cardNo ? def : undefined;
    const attacker = createCardInstance(def, {
      instanceId: "active-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect",
      pendingLeaveChainId: "active-attacker-chain",
      deferZoneMoveUntilChainEnd: false,
    });
    const entityId = "battle-entity:active-attacker";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [attacker],
      }),
      activeAttack: {
        ...makeActiveAttack(entityId),
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
      },
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["active-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "active-attacker",
          kind: "destroy",
          cause: "effect",
          causePlayerId: "player-2",
          chainId: "active-attacker-chain",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const flushed = flushPendingLeaves(state, lookup);

    expect(
      flushed.cardInstances.find(
        (card) => card.instanceId === "active-attacker"
      )?.zone
    ).toBe("trash");
    expect(flushed.battleEntities).toEqual([
      expect.objectContaining({
        entityId,
        memberInstanceIds: [],
        leftFieldMemberInstanceIds: ["active-attacker"],
        attackState: "attacking",
      }),
    ]);
    expect(flushed.activeAttack?.participantEntityIds).toEqual([entityId]);
    expect(flushed.pendingBraveAttackContinuation).toBeNull();

    const resolved = executeBattleResolution({
      state: flushed,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(resolved.totalLifeDamage).toBe(0);
    expect(resolved.destroyedEntityIds).toEqual([]);
    expect(resolved.state.activeAttack).toBeNull();
    expect(
      resolved.state.log.some((entry) =>
        entry.startsWith("battle:resolution:bp-compare:")
      )
    ).toBe(false);
  });

  it("does not allow blocking an empty left-field attacker shell", () => {
    const attackerDef = spiritDef("TEST-LEFT-FIELD-ATTACKER-BLOCK-GUARD");
    const blockerDef = spiritDef("TEST-LEFT-FIELD-BLOCKER");
    const lookup = (definitionId: string) =>
      definitionId === attackerDef.cardNo
        ? attackerDef
        : definitionId === blockerDef.cardNo
          ? blockerDef
          : undefined;
    const attackerEntityId = "battle-entity:left-field-attacker";
    const leftAttacker = createCardInstance(attackerDef, {
      instanceId: "left-field-attacker",
      ownerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(blockerDef, {
      instanceId: "ready-blocker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [leftAttacker, blocker],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        ...makeActiveAttack(attackerEntityId),
        flashBeforeBlockCompleted: true,
        blockAssignments: [
          { participantEntityId: attackerEntityId, blockedByEntityIds: [] },
        ],
      },
      battleEntities: [
        {
          entityId: attackerEntityId,
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: ["left-field-attacker"],
          resolvedBp: 0,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
    };

    expect(
      getBlockDeclarationBlockReason({
        state,
        actingPlayerId: BOB,
        sourceInstanceId: "ready-blocker",
        participantEntityId: attackerEntityId,
        getCardDefinitionById: lookup,
      })
    ).toBe("participant_not_ready");
    expect(
      getLegalActions({
        state,
        actingPlayerId: BOB,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).some((action) => action.kind === "block")
    ).toBe(false);
  });

  it("does not fire field-source battle_end deferrals after the source leaves field", () => {
    const def = spiritDef("TEST-FLUSH-ACTIVE-ATTACKER-BED", {
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "trash", player: "self" },
                to: { kind: "reserve", player: "self" },
                amount: 1,
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    const lookup = (definitionId: string) =>
      definitionId === def.cardNo ? def : undefined;
    const attacker = createCardInstance(def, {
      instanceId: "left-source-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect",
      pendingLeaveChainId: "left-source-chain",
      deferZoneMoveUntilChainEnd: false,
    });
    const entityId = "battle-entity:left-source-attacker";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
          {},
        ],
        cardInstances: [attacker],
      }),
      activeAttack: {
        ...makeActiveAttack(entityId),
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
      },
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["left-source-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "left-source-attacker",
          kind: "destroy",
          cause: "effect",
          causePlayerId: "player-2",
          chainId: "left-source-chain",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "bed:left-source",
          attackId: "attack-1",
          actingPlayerId: ALICE,
          sourceInstanceId: "left-source-attacker",
          sourceDefinitionId: def.cardNo,
          effectIndex: 0,
        },
      ],
    };

    const flushed = flushPendingLeaves(state, lookup);
    const resolved = executeBattleResolution({
      state: flushed,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const alice = resolved.state.players.find((player) => player.id === ALICE)!;

    expect(resolved.state.pendingBattleEndDeferrals).toEqual([]);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(
      resolved.state.log.some((entry) =>
        entry.startsWith(
          "battle:end-deferral:fire:attack-1:left-source-attacker"
        )
      )
    ).toBe(false);
    expect(resolved.state.log).toContain(
      "battle:end-deferral:skip-source-left:attack-1:left-source-attacker:0"
    );
  });

  it("does not fire combined brave battle_end deferrals after the effect source leaves field", () => {
    const effect = {
      timing: {
        kind: "card_event",
        event: "attack",
        deferredTo: "battle_end",
      },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef = spiritDef("TEST-COMBINED-BED-HOST", {
      effects: [effect],
    });
    const braveDef = spiritDef("TEST-COMBINED-BED-BRAVE", {
      printedCategory: "brave",
      effects: [effect],
    });
    const lookup = (definitionId: string) =>
      definitionId === hostDef.cardNo
        ? hostDef
        : definitionId === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "combined-bed-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "combined-bed-brave-left",
      ownerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
    });
    const entityId = "battle-entity:combined-bed-host";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
          {},
        ],
        cardInstances: [host, brave],
      }),
      activeAttack: {
        ...makeActiveAttack(entityId),
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
      },
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [host.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "bed:combined-brave-left",
          attackId: "attack-1",
          actingPlayerId: ALICE,
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectSourceOnFieldRequired: true,
          effectSourceAttachmentRequired: true,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
    };

    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const alice = resolved.state.players.find((player) => player.id === ALICE)!;

    expect(resolved.state.pendingBattleEndDeferrals).toEqual([]);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(
      resolved.state.log.some((entry) =>
        entry.startsWith("battle:end-deferral:fire:attack-1:combined-bed-host")
      )
    ).toBe(false);
    expect(resolved.state.log).toContain(
      "battle:end-deferral:skip-source-left:attack-1:combined-bed-host:0"
    );
  });

  it("does not fire combined brave battle_end deferrals after the effect source separates but stays field", () => {
    const effect = {
      timing: {
        kind: "card_event",
        event: "attack",
        deferredTo: "battle_end",
      },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef = spiritDef("TEST-COMBINED-BED-SEPARATED-HOST", {
      effects: [effect],
    });
    const braveDef = spiritDef("TEST-COMBINED-BED-SEPARATED-BRAVE", {
      printedCategory: "brave",
      effects: [effect],
    });
    const lookup = (definitionId: string) =>
      definitionId === hostDef.cardNo
        ? hostDef
        : definitionId === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "combined-bed-separated-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "combined-bed-separated-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: null,
    });
    const entityId = "battle-entity:combined-bed-separated-host";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
          {},
        ],
        cardInstances: [host, brave],
      }),
      activeAttack: {
        ...makeActiveAttack(entityId),
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
      },
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [host.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "bed:combined-brave-separated",
          attackId: "attack-1",
          actingPlayerId: ALICE,
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectSourceOnFieldRequired: true,
          effectSourceAttachmentRequired: true,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
    };

    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const alice = resolved.state.players.find((player) => player.id === ALICE)!;

    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(
      resolved.state.log.some((entry) =>
        entry.startsWith(
          "battle:end-deferral:fire:attack-1:combined-bed-separated-host"
        )
      )
    ).toBe(false);
    expect(resolved.state.log).toContain(
      "battle:end-deferral:skip-source-left:attack-1:combined-bed-separated-host:0"
    );
  });

  it("fires effect-level source_card battle_end self-destruction after the brave separates but stays field", () => {
    const effect = {
      timing: {
        kind: "card_event",
        event: "attack",
        deferredTo: "battle_end",
      },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { kind: "source_card" },
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef = spiritDef("TEST-EFFECT-BED-SOURCE-CARD-HOST");
    const braveDef = spiritDef("TEST-EFFECT-BED-SOURCE-CARD-BRAVE", {
      printedCategory: "brave",
      effects: [effect],
    });
    const lookup = (definitionId: string) =>
      definitionId === hostDef.cardNo
        ? hostDef
        : definitionId === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "effect-bed-source-card-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["effect-bed-source-card-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "effect-bed-source-card-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: host.instanceId,
    });
    const entityId = "battle-entity:effect-bed-source-card-host";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [host, brave],
      }),
      activeAttack: {
        ...makeActiveAttack(entityId),
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
      },
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [host.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:battle-system:750",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinitionId: braveDef.cardNo,
      sourceCardReferenceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 0,
    });
    expect(queued.pendingBattleEndDeferrals[0]).toMatchObject({
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinitionId: braveDef.cardNo,
      effectSourceOnFieldRequired: true,
    });
    expect(
      queued.pendingBattleEndDeferrals[0]?.effectSourceAttachmentRequired
    ).toBeUndefined();

    const separatedBeforeBattleEnd: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((card) =>
        card.instanceId === host.instanceId
          ? { ...card, attachedChildrenIds: [] }
          : card.instanceId === brave.instanceId
            ? { ...card, attachedToInstanceId: null }
            : card
      ),
    };

    const resolved = executeBattleResolution({
      state: separatedBeforeBattleEnd,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const braveAfter = resolved.state.cardInstances.find(
      (card) => card.instanceId === brave.instanceId
    )!;

    expect(resolved.state.pendingBattleEndDeferrals).toEqual([]);
    expect(braveAfter.zone).toBe("trash");
    expect(braveAfter.pendingLeaveKind).toBeNull();
    expect(resolved.state.log).toContain(
      `battle:end-deferral:fire:attack-1:${host.instanceId}:0`
    );
  });

  it("keeps attachment required when an effect-level source_card battle_end has later non-source steps", () => {
    const effect = {
      timing: {
        kind: "card_event",
        event: "attack",
        deferredTo: "battle_end",
      },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { kind: "source_card" },
          },
        },
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef = spiritDef("TEST-EFFECT-BED-MIXED-HOST");
    const braveDef = spiritDef("TEST-EFFECT-BED-MIXED-BRAVE", {
      printedCategory: "brave",
      effects: [effect],
    });
    const lookup = (definitionId: string) =>
      definitionId === hostDef.cardNo
        ? hostDef
        : definitionId === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "effect-bed-mixed-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["effect-bed-mixed-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "effect-bed-mixed-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: host.instanceId,
    });
    const entityId = "battle-entity:effect-bed-mixed-host";
    const queued = executeEffect({
      chainId: "test:battle-system:852",
      state: {
        ...createEmptyGameState({
          playerIds: [ALICE, "player-2"],
          playerOverrides: [
            { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
            {},
          ],
          cardInstances: [host, brave],
        }),
        activeAttack: {
          ...makeActiveAttack(entityId),
          blockAssignments: [
            { participantEntityId: entityId, blockedByEntityIds: [] },
          ],
        },
        battleEntities: [
          {
            entityId,
            memberInstanceIds: [host.instanceId],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      },
      effect,
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinitionId: braveDef.cardNo,
      sourceCardReferenceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 0,
    });
    expect(queued.pendingBattleEndDeferrals[0]).toMatchObject({
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: brave.instanceId,
      effectSourceAttachmentRequired: true,
    });

    const separatedBeforeBattleEnd: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((card) =>
        card.instanceId === host.instanceId
          ? { ...card, attachedChildrenIds: [] }
          : card.instanceId === brave.instanceId
            ? { ...card, attachedToInstanceId: null }
            : card
      ),
    };

    const resolved = executeBattleResolution({
      state: separatedBeforeBattleEnd,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const alice = resolved.state.players.find((player) => player.id === ALICE)!;
    const braveAfter = resolved.state.cardInstances.find(
      (card) => card.instanceId === brave.instanceId
    )!;

    expect(resolved.state.pendingBattleEndDeferrals).toEqual([]);
    expect(braveAfter.zone).toBe("field");
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(resolved.state.log).toContain(
      `battle:end-deferral:skip-source-left:attack-1:${host.instanceId}:0`
    );
  });

  it("keeps a left-field simultaneous participant as an empty battle-end shell", () => {
    const leavingDef = spiritDef("TEST-FLUSH-SIMUL-LEAVING");
    const stayingDef = spiritDef("TEST-FLUSH-SIMUL-STAYING");
    const lookup = (definitionId: string) =>
      definitionId === leavingDef.cardNo
        ? leavingDef
        : definitionId === stayingDef.cardNo
          ? stayingDef
          : undefined;
    const leaving = createCardInstance(leavingDef, {
      instanceId: "simul-leaving",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect",
      pendingLeaveChainId: "simul-leaving-chain",
      deferZoneMoveUntilChainEnd: false,
    });
    const staying = createCardInstance(stayingDef, {
      instanceId: "simul-staying",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const leavingEntityId = "battle-entity:simul-leaving";
    const stayingEntityId = "battle-entity:simul-staying";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [leaving, staying],
      }),
      activeAttack: {
        ...makeActiveAttack(leavingEntityId),
        primaryEntityId: leavingEntityId,
        participantEntityIds: [leavingEntityId, stayingEntityId],
        groupMode: "simultaneous",
        blockAssignments: [
          {
            participantEntityId: leavingEntityId,
            blockedByEntityIds: [],
          },
          {
            participantEntityId: stayingEntityId,
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: [leavingEntityId, stayingEntityId],
      },
      battleEntities: [
        {
          entityId: leavingEntityId,
          memberInstanceIds: ["simul-leaving"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: stayingEntityId,
          memberInstanceIds: ["simul-staying"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "simul-leaving",
          kind: "destroy",
          cause: "effect",
          causePlayerId: "player-2",
          chainId: "simul-leaving-chain",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const flushed = flushPendingLeaves(state, lookup);

    expect(
      flushed.cardInstances.find((card) => card.instanceId === "simul-leaving")
        ?.zone
    ).toBe("trash");
    expect(flushed.battleEntities.map((entity) => entity.entityId)).toEqual([
      leavingEntityId,
      stayingEntityId,
    ]);
    expect(
      flushed.battleEntities.find(
        (entity) => entity.entityId === leavingEntityId
      )
    ).toMatchObject({
      memberInstanceIds: [],
      leftFieldMemberInstanceIds: ["simul-leaving"],
      attackState: "attacking",
    });
    expect(flushed.activeAttack).toMatchObject({
      primaryEntityId: leavingEntityId,
      participantEntityIds: [leavingEntityId, stayingEntityId],
      groupMode: "simultaneous",
      symbolResolutionOrder: [leavingEntityId, stayingEntityId],
      blockAssignments: [
        {
          participantEntityId: leavingEntityId,
          blockedByEntityIds: [],
        },
        {
          participantEntityId: stayingEntityId,
          blockedByEntityIds: [],
        },
      ],
    });
  });

  it("keeps a left-field blocker as blocked context without BP comparison", () => {
    const attackerDef = spiritDef("TEST-FLUSH-BLOCKED-ATTACKER");
    const blockerDef = spiritDef("TEST-FLUSH-LEFT-BLOCKER");
    const lookup = (definitionId: string) =>
      definitionId === attackerDef.cardNo
        ? attackerDef
        : definitionId === blockerDef.cardNo
          ? blockerDef
          : undefined;
    const attacker = createCardInstance(attackerDef, {
      instanceId: "blocked-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const blocker = createCardInstance(blockerDef, {
      instanceId: "leaving-blocker",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect",
      pendingLeaveChainId: "leaving-blocker-chain",
      deferZoneMoveUntilChainEnd: false,
    });
    const attackerEntityId = "battle-entity:blocked-attacker";
    const blockerEntityId = "battle-entity:leaving-blocker";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [attacker, blocker],
      }),
      activeAttack: {
        ...makeActiveAttack(attackerEntityId),
        blockAssignments: [
          {
            participantEntityId: attackerEntityId,
            blockedByEntityIds: [blockerEntityId],
          },
        ],
        flashAfterBlockCompleted: true,
      },
      battleEntities: [
        {
          entityId: attackerEntityId,
          memberInstanceIds: ["blocked-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: blockerEntityId,
          memberInstanceIds: ["leaving-blocker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "leaving-blocker",
          kind: "destroy",
          cause: "effect",
          causePlayerId: ALICE,
          chainId: "leaving-blocker-chain",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const flushed = flushPendingLeaves(state, lookup);

    expect(
      flushed.cardInstances.find(
        (card) => card.instanceId === "leaving-blocker"
      )?.zone
    ).toBe("trash");
    expect(
      flushed.battleEntities.find(
        (entity) => entity.entityId === blockerEntityId
      )
    ).toMatchObject({
      memberInstanceIds: [],
      leftFieldMemberInstanceIds: ["leaving-blocker"],
      attackState: "blocking",
    });
    expect(
      flushed.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual([blockerEntityId]);

    const resolved = executeBattleResolution({
      state: flushed,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(resolved.totalLifeDamage).toBe(0);
    expect(resolved.destroyedEntityIds).toEqual([]);
    expect(
      resolved.state.log.some((entry) =>
        entry.startsWith("battle:resolution:bp-compare:")
      )
    ).toBe(false);
  });

  it("keeps surviving brave as the active entity when an attacking host leaves field", () => {
    const hostDef = spiritDef("TEST-FLUSH-ACTIVE-HOST");
    const braveDef = spiritDef("TEST-FLUSH-ACTIVE-BRAVE", {
      printedCategory: "brave",
    });
    const lookup = (definitionId: string) =>
      definitionId === hostDef.cardNo
        ? hostDef
        : definitionId === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "active-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect",
      pendingLeaveChainId: "active-host-chain",
      deferZoneMoveUntilChainEnd: false,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "surviving-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const entityId = "battle-entity:active-host";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [host, brave],
      }),
      activeAttack: makeActiveAttack(entityId),
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["active-host", "surviving-brave"],
          resolvedBp: 6000,
          resolvedSymbols: ["red", "red"],
          attackState: "attacking",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "active-host",
          kind: "destroy",
          cause: "effect",
          causePlayerId: "player-2",
          chainId: "active-host-chain",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const flushed = flushPendingLeaves(state, lookup);

    expect(
      flushed.cardInstances.find((card) => card.instanceId === "active-host")
        ?.zone
    ).toBe("trash");
    expect(flushed.battleEntities).toHaveLength(1);
    expect(flushed.battleEntities[0]?.memberInstanceIds).toEqual([
      "surviving-brave",
    ]);
    expect(flushed.activeAttack?.participantEntityIds).toEqual([entityId]);
    expect(flushed.pendingBraveAttackContinuation).toBeNull();
  });
});

// ── isBattleCapableCategory ────────────────────────────

describe("isBattleCapableCategory", () => {
  it("spirit is battle-capable", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    expect(isBattleCapableCategory(def, card)).toBe(true);
  });

  it("ultimate is battle-capable", () => {
    const def = ultimateDef();
    const card = fieldCard("u1", def, 3, { zoneRoleName: "ultimate" });
    expect(isBattleCapableCategory(def, card)).toBe(true);
  });

  it("nexus is NOT battle-capable", () => {
    const def = nexusDef();
    const card = fieldCard("n1", def, 0, { zoneRoleName: "nexus" });
    expect(isBattleCapableCategory(def, card)).toBe(false);
  });

  it("brave zoneRoleName is battle-capable", () => {
    const def = spiritDef("BRAVE-01", { printedCategory: "brave" });
    const card = fieldCard("b1", def, 1, { zoneRoleName: "brave" });
    expect(isBattleCapableCategory(def, card)).toBe(true);
  });
});

// ── getEffectiveBp ─────────────────────────────────────

describe("getEffectiveBp", () => {
  it("returns Lv1 BP when cores meet Lv1 requirement", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveBp(state, card, def)).toBe(3000);
  });

  it("returns Lv2 BP when cores meet Lv2 requirement", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 3);
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveBp(state, card, def)).toBe(5000);
  });

  it("returns Lv3 BP when cores meet Lv3 requirement", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 5);
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveBp(state, card, def)).toBe(8000);
  });

  it("returns highest available level BP", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 4); // meets Lv2 (3 cores) but not Lv3 (5 cores)
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveBp(state, card, def)).toBe(5000);
  });

  it("returns 0 when cores below minimum level", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 0);
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveBp(state, card, def)).toBe(0);
  });

  it("counts soul core towards level", () => {
    const def = spiritDef();
    // 0 normal + soul = 1 total → Lv1
    const card = fieldCard("s1", def, 0);
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    expect(getEffectiveBp(state, card, def)).toBe(3000);
  });

  it("applies bp_modifier CE", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({
      cardInstances: [card],
    });
    state.activeContinuousEffects = [bpModifierCE("s1", 2000)];

    expect(getEffectiveBp(state, card, def)).toBe(5000);
  });

  it("bp_modifier cannot reduce below 0", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({
      cardInstances: [card],
    });
    state.activeContinuousEffects = [bpModifierCE("s1", -10000)];

    expect(getEffectiveBp(state, card, def)).toBe(0);
  });

  it("stacks multiple bp_modifier CEs", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({
      cardInstances: [card],
    });
    state.activeContinuousEffects = [
      bpModifierCE("s1", 1000),
      { ...bpModifierCE("s1", 2000), effectId: "ce-bp-s1-2000-2" },
    ];

    expect(getEffectiveBp(state, card, def)).toBe(6000);
  });

  it("returns 0 when no levelDefs", () => {
    const def = spiritDef("NO-LEVEL", { levelDefs: [] });
    const card = fieldCard("s1", def, 5);
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveBp(state, card, def)).toBe(0);
  });
});

// ── getEffectiveSymbols ────────────────────────────────

describe("getEffectiveSymbols", () => {
  it("returns base symbols from definition", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveSymbols(state, card, def)).toEqual(["red"]);
  });

  it("returns double symbols for ultimate", () => {
    const def = ultimateDef();
    const card = fieldCard("u1", def, 3, { zoneRoleName: "ultimate" });
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveSymbols(state, card, def)).toEqual(["red", "red"]);
  });

  it("includes symbol_addition CE", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [symbolAdditionCE("s1", "blue")];

    expect(getEffectiveSymbols(state, card, def)).toEqual(["red", "blue"]);
  });

  it("returns empty for zero-symbol card", () => {
    const def = nexusDef();
    const card = fieldCard("n1", def, 0, { zoneRoleName: "nexus" });
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(getEffectiveSymbols(state, card, def)).toEqual([]);
  });
});

// ── recomputeBattleEntityBp ───────────────────────────

describe("recomputeBattleEntityBp", () => {
  const def = spiritDef();
  const defLookup = (id: string) => (id === def.cardNo ? def : undefined);

  it("updates resolvedBp when bp_modifier CE is added", () => {
    const card = fieldCard("s1", def, 1); // Lv1 → BP 3000
    const entity = makeBattleEntity("s1", def, 3000);
    const state = createEmptyGameState({
      cardInstances: [card],
      battleEntities: [entity],
    });
    state.activeContinuousEffects = [bpModifierCE("s1", 2000)];

    const next = recomputeBattleEntityBp(state, defLookup);

    expect(next.battleEntities[0]!.resolvedBp).toBe(5000);
  });

  it("returns same state when BP unchanged", () => {
    const card = fieldCard("s1", def, 1);
    const entity = makeBattleEntity("s1", def, 3000);
    const state = createEmptyGameState({
      cardInstances: [card],
      battleEntities: [entity],
    });

    const next = recomputeBattleEntityBp(state, defLookup);

    expect(next).toBe(state); // referential equality
  });

  it("returns same state when no battle entities", () => {
    const state = createEmptyGameState();

    const next = recomputeBattleEntityBp(state, defLookup);

    expect(next).toBe(state);
  });

  it("updates resolvedSymbols when symbol_addition CE is added", () => {
    const card = fieldCard("s1", def, 1);
    const entity = makeBattleEntity("s1", def, 3000);
    const state = createEmptyGameState({
      cardInstances: [card],
      battleEntities: [entity],
    });
    state.activeContinuousEffects = [symbolAdditionCE("s1", "blue")];

    const next = recomputeBattleEntityBp(state, defLookup);

    expect(next.battleEntities[0]!.resolvedSymbols).toEqual(["red", "blue"]);
  });
});
