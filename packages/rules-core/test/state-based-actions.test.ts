import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  collectStateBasedActions,
  runStateBasedActions,
  queuePendingLeave,
  flushPendingLeaves,
  getMinimumRequiredCores,
  collectGameStateInvariantIssues,
  canCardBeAffectedByEffect,
  getEffectFilterBlockReason,
  filterTargetCardInstanceIdsByEffectFilter,
} from "../src";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectQueueEntry,
  GameState,
} from "../src";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(
  cardNo = "TEST-001",
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    textLines: [],
    images: {},
    tribe: [],
    ...overrides,
  } as CardDefinition;
}

function nexusDef(cardNo = "TEST-N01"): CardDefinition {
  return dummyDef(cardNo, {
    printedCategory: "nexus",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  });
}

function fieldCard(
  instanceId: string,
  owner = ALICE,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function fieldNexus(
  instanceId: string,
  owner = ALICE,
  cores = 0
): CardInstance {
  return createCardInstance(nexusDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    zoneRoleName: "nexus",
  });
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

// ── getMinimumRequiredCores ────────────────────────────

describe("getMinimumRequiredCores", () => {
  it("returns minimumRequiredCores for field cards", () => {
    const card = fieldCard("s1", ALICE, 3);
    expect(getMinimumRequiredCores(card)).toBe(1);
  });

  it("returns 0 for non-field cards", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "h1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    expect(getMinimumRequiredCores(card)).toBe(0);
  });
});

// ── collectStateBasedActions ───────────────────────────

describe("collectStateBasedActions", () => {
  it("detects vanish when cores < minimum", () => {
    const card = fieldCard("s1", ALICE, 0); // 0 cores, minimum=1
    const state = createEmptyGameState({ cardInstances: [card] });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(1);
    expect(checks[0]!.kind).toBe("vanish_due_to_core_deficit");
    expect(checks[0]!.instanceId).toBe("s1");
  });

  it("does not detect vanish when cores >= minimum", () => {
    const card = fieldCard("s1", ALICE, 1); // 1 core, minimum=1
    const state = createEmptyGameState({ cardInstances: [card] });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(0);
  });

  it("counts soul core towards total", () => {
    const card = fieldCard("s1", ALICE, 0); // soul core only = 1 total
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(0);
  });

  it("skips nexus (no vanish)", () => {
    const card = fieldNexus("n1", ALICE, 0); // 0 cores, but nexus
    const state = createEmptyGameState({ cardInstances: [card] });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(0);
  });

  it("skips cards already pending leave", () => {
    const card = fieldCard("s1", ALICE, 0, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-1",
    });
    const state = createEmptyGameState({ cardInstances: [card] });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(0);
  });

  it("skips non-field cards", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "h1",
      ownerPlayerId: ALICE,
      zone: "hand",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({ cardInstances: [card] });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(0);
  });

  // P3-47 F-1: 裏向きフィールド配置はリンボ状態で BP/Lv 検査の対象外。
  // フランドール【フォーオブアカインド】 step1 (deck → field 裏向き) 直後 / step2
  // core_distribute pending 中 / 裁定 #2 host 離脱後の残留など、印字 Lv1 cost > 0
  // のカードが 0 コアでフィールドに残るケースを SBA core_deficit から除外する。
  it("skips face-down field cards (P3-47 F-1)", () => {
    const card = fieldCard("s1", ALICE, 0, { faceDown: true });
    const state = createEmptyGameState({ cardInstances: [card] });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(0);
  });

  it("detects multiple cards vanishing", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0), fieldCard("s2", BOB, 0)],
    });

    const checks = collectStateBasedActions(state);

    expect(checks).toHaveLength(2);
  });
});

// ── runStateBasedActions ──────────────────────────────

describe("runStateBasedActions", () => {
  it("sets pendingLeaveKind to vanish for core-deficit cards", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
    });

    const result = runStateBasedActions(state);

    expect(result.checks).toHaveLength(1);
    expect(getCard(result.state, "s1").pendingLeaveKind).toBe("vanish");
    expect(getCard(result.state, "s1").pendingLeaveCause).toBe(
      "state_based_action"
    );
  });

  it("adds pendingLeaveEntity", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
    });

    const result = runStateBasedActions(state);

    expect(result.state.pendingLeaveEntities).toHaveLength(1);
    expect(result.state.pendingLeaveEntities[0]!.instanceId).toBe("s1");
    expect(result.state.pendingLeaveEntities[0]!.kind).toBe("vanish");
  });

  it("returns original state when no checks", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
    });

    const result = runStateBasedActions(state);

    expect(result.state).toBe(state); // referential equality
    expect(result.checks).toHaveLength(0);
  });
});

// ── queuePendingLeave ─────────────────────────────────

describe("queuePendingLeave", () => {
  it("marks card as pending leave", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
    });

    const next = queuePendingLeave({
      state,
      instanceId: "s1",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "chain-1",
    });

    expect(getCard(next, "s1").pendingLeaveKind).toBe("destroy");
    expect(getCard(next, "s1").pendingLeaveCause).toBe("effect_resolution");
    expect(next.pendingLeaveEntities).toHaveLength(1);
  });

  it("throws when target is not on field", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "h1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({ cardInstances: [card] });

    expect(() =>
      queuePendingLeave({
        state,
        instanceId: "h1",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "chain-1",
      })
    ).toThrow("must be on the field");
  });

  it("supports deferZoneMoveUntilChainEnd", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
    });

    const next = queuePendingLeave({
      state,
      instanceId: "s1",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "chain-1",
      deferZoneMoveUntilChainEnd: true,
    });

    expect(getCard(next, "s1").deferZoneMoveUntilChainEnd).toBe(true);
    expect(next.pendingLeaveEntities[0]!.deferZoneMoveUntilChainEnd).toBe(true);
  });
});

// ── flushPendingLeaves ────────────────────────────────

describe("flushPendingLeaves", () => {
  it("moves pending-leave card to trash", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "s1",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ];

    const next = flushPendingLeaves(state);

    expect(getCard(next, "s1").zone).toBe("trash");
    expect(getCard(next, "s1").pendingLeaveKind).toBeNull();
    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    // Cores moved to reserve
    expect(next.players[0]!.reserveNormalCoreCount).toBe(3);
    expect(next.pendingLeaveEntities).toHaveLength(0);
  });

  it("removes a host under-card reference when that advent source leaves", () => {
    const host = fieldCard("host", ALICE, 3, {
      underCards: [{ cardInstanceId: "advent-source", role: "advent_source" }],
    });
    const source = fieldCard("advent-source", ALICE, 0, {
      zoneRoleName: "advent-source",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "destroy-advent-source",
    });
    const state = createEmptyGameState({ cardInstances: [host, source] });
    state.pendingLeaveEntities = [
      {
        instanceId: source.instanceId,
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "destroy-advent-source",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ];

    const next = flushPendingLeaves(state);

    expect(getCard(next, source.instanceId).zone).toBe("trash");
    expect(getCard(next, host.instanceId).underCards).toEqual([]);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("is no-op when no pending leaves", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
    });

    const next = flushPendingLeaves(state);

    expect(next).toBe(state);
  });

  it("does not flush when effectQueueEntries exist (non-deferred)", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-1",
    });
    const state = createEmptyGameState({ cardInstances: [card] });
    state.pendingLeaveEntities = [
      {
        instanceId: "s1",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ];
    state.effectQueueEntries = [
      {
        scope: "chain",
        chainId: "chain-1",
        kind: "chain_resolve",
        description: "resolve",
      } as unknown as EffectQueueEntry,
    ];

    const next = flushPendingLeaves(state);

    expect(next).toBe(state); // no flush happened
  });

  // ── 置換効果 (field exit replacement) ────────────────

  type ReplacementMeta = {
    trigger: "leave_field" | "destroy" | "bounce" | "vanish";
    source: "opponent_effect" | "opponent" | "all" | "self";
    replacement: { kind: "move_to"; zone: "hand" | "deck_bottom" };
  };

  function replacementCE(
    targetInstanceId: string,
    metadata: ReplacementMeta
  ): ContinuousEffect {
    return {
      effectId: `ce-replacement-${targetInstanceId}`,
      sourceInstanceId: targetInstanceId,
      sourceDefinitionId: "TEST-001",
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "replace_field_exit",
      targetInstanceId,
      metadata: metadata as unknown as Record<string, unknown>,
    };
  }

  function pendingDestroy(
    instanceId: string,
    causePlayerId: string | null = BOB
  ) {
    return {
      instanceId,
      kind: "destroy" as const,
      cause: "effect_resolution" as const,
      causePlayerId,
      chainId: `chain-${instanceId}`,
      deferZoneMoveUntilChainEnd: false as const,
      leaveFieldCoreDestinationOverride: null,
    };
  }

  function pendingBounce(
    instanceId: string,
    causePlayerId: string | null = BOB
  ) {
    return {
      instanceId,
      kind: "bounce" as const,
      cause: "effect_resolution" as const,
      causePlayerId,
      chainId: `chain-${instanceId}`,
      deferZoneMoveUntilChainEnd: false as const,
      leaveFieldCoreDestinationOverride: null,
    };
  }

  function pendingBattleDestroy(instanceId: string) {
    return {
      instanceId,
      kind: "destroy" as const,
      cause: "battle" as const,
      causePlayerId: null,
      chainId: `chain-${instanceId}`,
      deferZoneMoveUntilChainEnd: false as const,
      leaveFieldCoreDestinationOverride: null,
    };
  }

  // 注: 「疲労状態でフィールドに残る」系の置換は triggered effect (stay_on_field) に
  // 移行済み。本ファイルでは move_to (手札 / デッキ下) のみを扱う。
  // stay_on_field のテストは test/stay-on-field-action.test.ts を参照。

  it("replace_field_exit (trigger=destroy, move_to hand): card goes to hand instead of trash", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "destroy",
        source: "opponent_effect",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    const s1 = getCard(next, "s1");
    expect(s1.zone).toBe("hand");
    expect(s1.pendingLeaveKind).toBeNull();
    expect(s1.normalCoreCount).toBe(0); // cores moved off
    expect(next.players[0]!.reserveNormalCoreCount).toBe(3); // cores to reserve
    expect(next.players[0]!.handCount).toBe(6); // hand count incremented
    expect(next.pendingLeaveEntities).toHaveLength(0);
    expect(
      next.log.some((l: string) => l.includes("replacement:destroy_to_hand"))
    ).toBe(true);
  });

  it("replace_field_exit (trigger=destroy, move_to deck_bottom): card goes to deck instead of trash", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, deckCount: 20 }],
    });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "destroy",
        source: "opponent_effect",
        replacement: { kind: "move_to", zone: "deck_bottom" },
      }),
    ];

    const next = flushPendingLeaves(state);

    const s1 = getCard(next, "s1");
    expect(s1.zone).toBe("deck");
    expect(s1.pendingLeaveKind).toBeNull();
    expect(s1.normalCoreCount).toBe(0); // cores moved off
    expect(next.players[0]!.reserveNormalCoreCount).toBe(3); // cores to reserve
    expect(next.players[0]!.deckCount).toBe(21); // deck count incremented
    expect(next.pendingLeaveEntities).toHaveLength(0);
    expect(
      next.log.some((l: string) => l.includes("replacement:destroy_to_deck"))
    ).toBe(true);
  });

  it("trigger=destroy does NOT match vanish kind (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "state_based",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "s1",
        kind: "vanish" as const,
        cause: "state_based" as const,
        causePlayerId: null,
        chainId: "chain-s1",
        deferZoneMoveUntilChainEnd: false as const,
        leaveFieldCoreDestinationOverride: null,
      },
    ];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "destroy",
        source: "all",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // trigger=destroy, kind=vanish → no match → 通常通りトラッシュへ
    expect(getCard(next, "s1").zone).toBe("trash");
  });

  // ── source=opponent_effect のフィルタリング（move_to 系で検証） ─

  it("source=opponent_effect skips own-controller cause (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    // 自分自身（ALICE）の効果による破壊
    state.pendingLeaveEntities = [pendingDestroy("s1", ALICE)];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "opponent_effect",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // 自分の効果は捕捉しない → 通常通りトラッシュへ
    expect(getCard(next, "s1").zone).toBe("trash");
  });

  it("source=opponent_effect skips state-based (causePlayerId=null) (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "state_based",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "s1",
        kind: "vanish" as const,
        cause: "state_based" as const,
        causePlayerId: null,
        chainId: "chain-s1",
        deferZoneMoveUntilChainEnd: false as const,
        leaveFieldCoreDestinationOverride: null,
      },
    ];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "opponent_effect",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // state-based (causePlayerId=null) は opponent_effect には該当しない
    expect(getCard(next, "s1").zone).toBe("trash");
  });

  it("source=opponent_effect skips battle destroy (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "battle",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    state.pendingLeaveEntities = [pendingBattleDestroy("s1")];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "opponent_effect",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    expect(getCard(next, "s1").zone).toBe("trash");
  });

  it("source=opponent includes battle destroy (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "battle",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    state.pendingLeaveEntities = [pendingBattleDestroy("s1")];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "opponent",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    expect(getCard(next, "s1").zone).toBe("hand");
  });

  // ── source=self のフィルタリング（ENGINE-set-aside-exit-replacement-choice Step1） ─

  it("source=self matches own-controller cause (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    // 自分自身（ALICE）の効果による破壊
    state.pendingLeaveEntities = [pendingDestroy("s1", ALICE)];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "self",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // 自分の効果による破壊は捕捉する → 手札へ
    expect(getCard(next, "s1").zone).toBe("hand");
  });

  it("source=self skips opponent-caused destroy (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    // 相手（BOB）の効果による破壊
    state.pendingLeaveEntities = [pendingDestroy("s1", BOB)];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "self",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // 相手の効果は捕捉しない → 通常通りトラッシュへ
    expect(getCard(next, "s1").zone).toBe("trash");
  });

  it("source=self skips battle destroy (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "battle",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    state.pendingLeaveEntities = [pendingBattleDestroy("s1")];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "leave_field",
        source: "self",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // battle 起因は自分効果扱いしない → 通常通りトラッシュへ
    expect(getCard(next, "s1").zone).toBe("trash");
  });

  // ── trigger=destroy + bounce kind は不一致 ─────

  it("trigger=destroy does NOT match bounce kind (move_to hand)", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "bounce",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 5 }],
    });
    state.pendingLeaveEntities = [pendingBounce("s1")];
    state.activeContinuousEffects = [
      replacementCE("s1", {
        trigger: "destroy",
        source: "opponent_effect",
        replacement: { kind: "move_to", zone: "hand" },
      }),
    ];

    const next = flushPendingLeaves(state);

    // trigger=destroy だが kind=bounce → 置換不発、フィールドには残らない（通常通り手札へバウンス）
    expect(getCard(next, "s1").zone).not.toBe("field");
    expect(getCard(next, "s1").pendingLeaveKind).toBeNull();
  });
});

// ── getEffectFilterBlockReason / canCardBeAffectedByEffect ─

describe("getEffectFilterBlockReason", () => {
  it("returns null for normal field cards", () => {
    const card = fieldCard("s1", ALICE, 3);
    expect(getEffectFilterBlockReason(card)).toBeNull();
  });

  it("blocks in_use cards by default", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "m1",
      ownerPlayerId: ALICE,
      zone: "in_use",
    });
    expect(getEffectFilterBlockReason(card)).toBe("card_in_use_zone");
  });

  it("allows suppress_used_card filter on in_use cards", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "m1",
      ownerPlayerId: ALICE,
      zone: "in_use",
    });
    expect(getEffectFilterBlockReason(card, ["suppress_used_card"])).toBeNull();
  });

  it("Ver.17.0: allows general effects on pending vanish (unified with destroy)", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "vanish",
    });
    expect(getEffectFilterBlockReason(card, ["general"])).toBeNull();
  });

  it("allows vanish_related on pending vanish", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "vanish",
    });
    expect(getEffectFilterBlockReason(card, ["vanish_related"])).toBeNull();
  });

  it("allows leave_field_related on pending vanish", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "vanish",
    });
    expect(
      getEffectFilterBlockReason(card, ["leave_field_related"])
    ).toBeNull();
  });
});

describe("canCardBeAffectedByEffect", () => {
  it("returns true for normal field cards", () => {
    const card = fieldCard("s1", ALICE, 3);
    expect(canCardBeAffectedByEffect(card)).toBe(true);
  });

  it("returns false for in_use cards with default tags", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "m1",
      ownerPlayerId: ALICE,
      zone: "in_use",
    });
    expect(canCardBeAffectedByEffect(card)).toBe(false);
  });
});

// ── filterTargetCardInstanceIdsByEffectFilter ──────────

describe("filterTargetCardInstanceIdsByEffectFilter", () => {
  it("Ver.17.0: includes pending vanish cards for general effects (unified with destroy)", () => {
    const s1 = fieldCard("s1", ALICE, 3);
    const s2 = fieldCard("s2", ALICE, 3, { pendingLeaveKind: "vanish" });
    const state = createEmptyGameState({ cardInstances: [s1, s2] });

    const result = filterTargetCardInstanceIdsByEffectFilter(
      state,
      ["s1", "s2"],
      ["general"]
    );

    expect(result).toEqual(["s1", "s2"]);
  });

  it("includes all for vanish_related effects", () => {
    const s1 = fieldCard("s1", ALICE, 3);
    const s2 = fieldCard("s2", ALICE, 3, { pendingLeaveKind: "vanish" });
    const state = createEmptyGameState({ cardInstances: [s1, s2] });

    const result = filterTargetCardInstanceIdsByEffectFilter(
      state,
      ["s1", "s2"],
      ["vanish_related"]
    );

    expect(result).toEqual(["s1", "s2"]);
  });

  it("filters out unknown instance IDs", () => {
    const state = createEmptyGameState({ cardInstances: [] });

    const result = filterTargetCardInstanceIdsByEffectFilter(
      state,
      ["nonexistent"],
      ["general"]
    );

    expect(result).toEqual([]);
  });
});
