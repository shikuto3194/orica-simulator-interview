import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeStayOnField,
  flushPendingLeaves,
  deriveTriggerEventCauseFromPendingLeave,
} from "../src";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingBurstCheck,
  PendingLeaveEntity,
  PendingTriggeredEffect,
  StayOnFieldAction,
} from "../src";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(cardNo = "TEST-001"): CardDefinition {
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
  } as CardDefinition;
}

function fieldCard(
  instanceId: string,
  owner = ALICE,
  cores = 2,
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

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

const noopGetDef = (_: string): CardDefinition | undefined => dummyDef();

function pendingDestroy(
  instanceId: string,
  causePlayerId: string | null = BOB
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

function pendingBounce(
  instanceId: string,
  causePlayerId: string | null = BOB
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "bounce",
    cause: "effect_resolution",
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

function makePendingTriggeredEffect(opts: {
  pendingId: string;
  actingPlayerId: string;
  eventKind: PendingTriggeredEffect["eventKind"];
  relatedInstanceId: string | null;
  simultaneousGroupId?: string;
}): PendingTriggeredEffect {
  return {
    pendingId: opts.pendingId,
    actingPlayerId: opts.actingPlayerId,
    eventKind: opts.eventKind,
    source: "action_resolution",
    chainId: "test:stay-on-field-action:101",
    attackId: null,
    relatedPlayerId: ALICE,
    relatedInstanceId: opts.relatedInstanceId,
    amount: null,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: [],
    ...(opts.simultaneousGroupId !== undefined
      ? { simultaneousGroupId: opts.simultaneousGroupId }
      : {}),
  };
}

function makePendingBurstCheck(opts: {
  checkId: string;
  actingPlayerId: string;
  eventKind: PendingBurstCheck["eventKind"];
  relatedInstanceId: string | null;
  simultaneousGroupId?: string;
}): PendingBurstCheck {
  return {
    checkId: opts.checkId,
    actingPlayerId: opts.actingPlayerId,
    eventKind: opts.eventKind,
    source: "action_resolution",
    chainId: "test:stay-on-field-action:127",
    attackId: null,
    relatedPlayerId: ALICE,
    relatedInstanceId: opts.relatedInstanceId,
    amount: 0,
    step: "main",
    window: "none",
    resolvedBurstCardInstanceIds: [],
    ...(opts.simultaneousGroupId !== undefined
      ? { simultaneousGroupId: opts.simultaneousGroupId }
      : {}),
  };
}

const stayOnFieldExhaustSelfAction: StayOnFieldAction = {
  kind: "stay_on_field",
  target: { selfCard: true, player: "self", count: 1 },
  newExhaustState: "exhausted",
};

// ── deriveTriggerEventCauseFromPendingLeave ─────────────

describe("deriveTriggerEventCauseFromPendingLeave", () => {
  it("returns 'state_based' for state_based_action cause", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "state_based_action", causePlayerId: null },
        ALICE
      )
    ).toBe("state_based");
  });

  it("returns 'battle' for battle cause", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "battle", causePlayerId: BOB },
        ALICE
      )
    ).toBe("battle");
  });

  it("returns 'opponent_effect' when causePlayer differs from controller", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "effect_resolution", causePlayerId: BOB },
        ALICE
      )
    ).toBe("opponent_effect");
  });

  it("returns 'self_effect' when causePlayer matches controller", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "effect_resolution", causePlayerId: ALICE },
        ALICE
      )
    ).toBe("self_effect");
  });

  it("returns 'self_effect' when causePlayer is null but cause is effect-related", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "effect_resolution", causePlayerId: null },
        ALICE
      )
    ).toBe("self_effect");
  });
});

// ── executeStayOnField (direct unit tests) ──────────────

describe("stay_on_field action", () => {
  it("removes pending leave and exhausts target on field (destroy)", () => {
    const card = fieldCard("s1", ALICE, 3, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    state.pendingLeaveEntities = [pendingDestroy("s1")];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1"
    );

    const s1 = getCard(next, "s1");
    expect(s1.zone).toBe("field");
    expect(s1.exhaustState).toBe("exhausted");
    expect(s1.pendingLeaveKind).toBeNull();
    expect(s1.pendingLeaveCause).toBeNull();
    expect(s1.deferZoneMoveUntilChainEnd).toBe(false);
    expect(s1.normalCoreCount).toBe(3); // cores preserved
    expect(next.pendingLeaveEntities).toHaveLength(0);
    expect(
      next.log.some((l) => l.includes("effect:stay_on_field:s1:exhausted"))
    ).toBe(true);
  });

  it("removes pending leave for bounce kind too", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "bounce",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    state.pendingLeaveEntities = [pendingBounce("s1")];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1"
    );

    expect(getCard(next, "s1").zone).toBe("field");
    expect(getCard(next, "s1").exhaustState).toBe("exhausted");
    expect(next.pendingLeaveEntities).toHaveLength(0);
  });

  it("supports newExhaustState=heavily_exhausted", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({ cardInstances: [card] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];

    const next = executeStayOnField(
      state,
      ALICE,
      {
        kind: "stay_on_field",
        target: { selfCard: true, player: "self", count: 1 },
        newExhaustState: "heavily_exhausted",
      },
      noopGetDef,
      "s1"
    );

    expect(getCard(next, "s1").exhaustState).toBe("heavily_exhausted");
  });

  it("preserves current exhaust state when newExhaustState is omitted (同じ状態で残せる)", () => {
    // BSSG01-M01/M02 系「同じ状態で残せる」: 疲労状態を変えずに残置する。
    // 疲労状態 (exhausted) の対象が残置後も exhausted のまま。
    const card = fieldCard("s1", ALICE, 3, {
      exhaustState: "exhausted",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    state.pendingLeaveEntities = [pendingDestroy("s1")];

    const next = executeStayOnField(
      state,
      ALICE,
      {
        kind: "stay_on_field",
        target: { selfCard: true, player: "self", count: 1 },
        // newExhaustState 省略 = 同じ状態を維持
      },
      noopGetDef,
      "s1"
    );

    const s1 = getCard(next, "s1");
    expect(s1.zone).toBe("field");
    // 疲労状態は据え置き（recovered に戻らない）
    expect(s1.exhaustState).toBe("exhausted");
    expect(s1.pendingLeaveKind).toBeNull();
    expect(next.pendingLeaveEntities).toHaveLength(0);
    expect(
      next.log.some((l) => l.includes("effect:stay_on_field:s1:keep"))
    ).toBe(true);
  });

  it("preserves recovered state too when newExhaustState omitted", () => {
    const card = fieldCard("s1", ALICE, 2, {
      exhaustState: "recovered",
      pendingLeaveKind: "bounce",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({ cardInstances: [card] });
    state.pendingLeaveEntities = [pendingBounce("s1")];

    const next = executeStayOnField(
      state,
      ALICE,
      {
        kind: "stay_on_field",
        target: { selfCard: true, player: "self", count: 1 },
      },
      noopGetDef,
      "s1"
    );

    expect(getCard(next, "s1").zone).toBe("field");
    expect(getCard(next, "s1").exhaustState).toBe("recovered");
  });

  it("flushPendingLeaves no-ops after stay_on_field removes the pending entry", () => {
    const card = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-s1",
    });
    const state = createEmptyGameState({ cardInstances: [card] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];

    const afterStay = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1"
    );

    const flushed = flushPendingLeaves(afterStay);
    // 既に pendingLeaveEntities は空なので flush は何もしない
    expect(getCard(flushed, "s1").zone).toBe("field");
    expect(getCard(flushed, "s1").exhaustState).toBe("exhausted");
  });
});

// ── 同時誘発グループ内 pending の連動撤回 ───────────────

describe("stay_on_field — simultaneous group revocation", () => {
  it("revokes related destroy-triggered effect in same simultaneousGroupId", () => {
    // 状況: Bob が Alice の C (s1) を破壊しようとする。
    //       同 simultaneousGroupId 内に「相手スピリットが破壊されたとき X 効果」(B 由来)
    //       で relatedInstanceId === s1 となる pending triggered effect が存在。
    //       C 側を stay_on_field で残置すると、その B 側 pending も連動して撤回される。
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-group-1",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.pendingTriggeredEffects = [
      // B 由来: 相手スピリット (s1) が破壊されたとき発動する効果
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:390",
        pendingId: "pe-b-related-s1",
        actingPlayerId: BOB,
        eventKind: "destroy",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1",
      undefined,
      { simultaneousGroupId: "sim-group:1" }
    );

    // C は field に exhausted で残る
    expect(getCard(next, "s1").zone).toBe("field");
    expect(getCard(next, "s1").exhaustState).toBe("exhausted");
    // B 側 pending は撤回される
    expect(next.pendingTriggeredEffects).toHaveLength(0);
    expect(
      next.log.some((l) => l.includes("stay_on_field:revoke:pe-b-related-s1"))
    ).toBe(true);
  });

  it("does NOT revoke pending in different simultaneousGroupId", () => {
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-group-1",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.pendingTriggeredEffects = [
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:428",
        pendingId: "pe-different-group",
        actingPlayerId: BOB,
        eventKind: "destroy",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:OTHER", // 別グループ
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1",
      undefined,
      { simultaneousGroupId: "sim-group:1" }
    );

    // 別グループの pending は残る
    expect(next.pendingTriggeredEffects).toHaveLength(1);
    expect(next.pendingTriggeredEffects[0]!.pendingId).toBe(
      "pe-different-group"
    );
  });

  it("does NOT revoke pending whose relatedInstanceId differs (e.g. B referring to D)", () => {
    // 状況: Bob 効果で C(s1) と D(s2) が破壊される。Bob の B 効果は
    //       「相手スピリットが破壊されたとき」で D に対しても発動する。
    //       C 側 stay_on_field 解決時、D 由来の B 発動は撤回されない。
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-group-1",
    });
    const d = fieldCard("s2", ALICE, 1, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-group-1",
    });
    const state = createEmptyGameState({ cardInstances: [c, d] });
    state.pendingLeaveEntities = [pendingDestroy("s1"), pendingDestroy("s2")];
    state.pendingTriggeredEffects = [
      // B 由来 — C を対象
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:472",
        pendingId: "pe-b-for-s1",
        actingPlayerId: BOB,
        eventKind: "destroy",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
      // B 由来 — D を対象（撤回されないはず）
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:480",
        pendingId: "pe-b-for-s2",
        actingPlayerId: BOB,
        eventKind: "destroy",
        relatedInstanceId: "s2",
        simultaneousGroupId: "sim-group:1",
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1",
      undefined,
      { simultaneousGroupId: "sim-group:1" }
    );

    // C は field に残る
    expect(getCard(next, "s1").zone).toBe("field");
    // D 由来の B pending は残る、C 由来の B pending は撤回される
    expect(next.pendingTriggeredEffects).toHaveLength(1);
    expect(next.pendingTriggeredEffects[0]!.pendingId).toBe("pe-b-for-s2");
  });

  it("revokes leave_field/vanish/bounce kinds in same group", () => {
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-group-1",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.pendingTriggeredEffects = [
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:515",
        pendingId: "pe-leave",
        actingPlayerId: BOB,
        eventKind: "leave_field",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:522",
        pendingId: "pe-vanish",
        actingPlayerId: BOB,
        eventKind: "vanish",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:529",
        pendingId: "pe-bounce",
        actingPlayerId: BOB,
        eventKind: "bounce",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
      // 関係ない eventKind は撤回されない
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:537",
        pendingId: "pe-summon",
        actingPlayerId: BOB,
        eventKind: "summon",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1",
      undefined,
      { simultaneousGroupId: "sim-group:1" }
    );

    expect(next.pendingTriggeredEffects).toHaveLength(1);
    expect(next.pendingTriggeredEffects[0]!.pendingId).toBe("pe-summon");
  });

  it("does NOT revoke pending when no simultaneousGroupId is provided", () => {
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-1",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.pendingTriggeredEffects = [
      makePendingTriggeredEffect({
        chainId: "test:stay-on-field-action:569",
        pendingId: "pe-no-group",
        actingPlayerId: BOB,
        eventKind: "destroy",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:1",
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1"
      // triggerContext 未指定 (simultaneousGroupId なし)
    );

    // pending は残る（撤回されない）
    expect(next.pendingTriggeredEffects).toHaveLength(1);
  });

  it("revokes related pendingBurstCheck in same simultaneousGroupId (destroy/vanish/bounce/leave_field)", () => {
    // 状況: Bob が Alice の C(s1) を破壊しようとし、同時誘発グループ内で
    //       s1 の destroy/vanish/bounce/leave_field 由来の BurstCheck が積まれている。
    //       stay_on_field で C を残置すると、これらの BurstCheck も連動撤回される。
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-burst-1",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.pendingBurstChecks = [
      makePendingBurstCheck({
        chainId: "test:stay-on-field-action:603",
        checkId: "bc-destroy",
        actingPlayerId: ALICE,
        eventKind: "destroy",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:burst",
      }),
      makePendingBurstCheck({
        chainId: "test:stay-on-field-action:610",
        checkId: "bc-vanish",
        actingPlayerId: ALICE,
        eventKind: "vanish",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:burst",
      }),
      makePendingBurstCheck({
        chainId: "test:stay-on-field-action:617",
        checkId: "bc-bounce",
        actingPlayerId: ALICE,
        eventKind: "bounce",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:burst",
      }),
      makePendingBurstCheck({
        chainId: "test:stay-on-field-action:624",
        checkId: "bc-leave",
        actingPlayerId: ALICE,
        eventKind: "leave_field",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:burst",
      }),
      // 関係ない eventKind (attack_after) は撤回されない
      makePendingBurstCheck({
        chainId: "test:stay-on-field-action:632",
        checkId: "bc-attack-after",
        actingPlayerId: ALICE,
        eventKind: "attack_after",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:burst",
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1",
      undefined,
      { simultaneousGroupId: "sim-group:burst" }
    );

    // s1 は field に残る
    expect(getCard(next, "s1").zone).toBe("field");
    // destroy/vanish/bounce/leave_field 由来の BurstCheck は撤回される
    expect(next.pendingBurstChecks).toHaveLength(1);
    expect(next.pendingBurstChecks[0]!.checkId).toBe("bc-attack-after");
    // 撤回ログも出る
    expect(
      next.log.some((l) => l.includes("stay_on_field:revoke_burst:bc-destroy"))
    ).toBe(true);
  });

  it("does NOT revoke pendingBurstCheck in different simultaneousGroupId", () => {
    const c = fieldCard("s1", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-burst-2",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    state.pendingLeaveEntities = [pendingDestroy("s1")];
    state.pendingBurstChecks = [
      makePendingBurstCheck({
        chainId: "test:stay-on-field-action:671",
        checkId: "bc-other-group",
        actingPlayerId: ALICE,
        eventKind: "destroy",
        relatedInstanceId: "s1",
        simultaneousGroupId: "sim-group:OTHER",
      }),
    ];

    const next = executeStayOnField(
      state,
      ALICE,
      stayOnFieldExhaustSelfAction,
      noopGetDef,
      "s1",
      undefined,
      { simultaneousGroupId: "sim-group:burst" }
    );

    // 別グループの BurstCheck は残る
    expect(next.pendingBurstChecks).toHaveLength(1);
    expect(next.pendingBurstChecks[0]!.checkId).toBe("bc-other-group");
  });
});
