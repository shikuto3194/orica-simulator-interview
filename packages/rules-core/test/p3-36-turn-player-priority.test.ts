import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  CollectedTriggerEvent,
  PendingPrivateDeclaration,
} from "../src";
import {
  applyLegalAction,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isPendingPrivateDeclarationsSortedByTurnPriority,
  queuePendingReactionsFromTriggerEvents,
  sortPendingPrivateDeclarationsByTurnPriority,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

/**
 * P3-36 Phase B/C/D scenario tests.
 *
 * - Phase B: direct-path 誘発が pendingTriggeredEffects に自動登録されること。
 * - Phase C: 混在オーナーキューでターンプレイヤーに select_pending_to_resolve が
 *   提示され、非ターンプレイヤーには legal action が提示されないこと。
 * - Phase D: select 後、対象 pending の owner に resolve_pending_triggered_effect が
 *   legal になり、direct-path optional は skipOptionalEffect で発揮辞退できること。
 */

function makeFieldSpirit(
  cardNo: string,
  executionMode: "mandatory" | "optional" = "optional"
): CardDefinition {
  return {
    cardNo,
    name: `P3-36 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone: "field" },
        executionMode,
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return (definitionId: string) => map.get(definitionId);
}

function makeStartStepEvent(
  actingPlayerId: string = "alice"
): CollectedTriggerEvent {
  return {
    actingPlayerId,
    eventKind: "start_step",
    source: "step_transition",
    chainId: "test:p3-36-turn-player-priority:67",
    attackId: null,
    relatedPlayerId: actingPlayerId,
    relatedInstanceId: null,
    amount: null,
    step: "start",
    subPhase: "start",
  };
}

describe("P3-36 Phase B/C/D: turn-player priority for public queue", () => {
  it("Phase B: direct-path field trigger は pendingTriggeredEffects に自動登録される", () => {
    const fieldDef = makeFieldSpirit("P3-36-FIELD", "mandatory");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(next.pendingTriggeredEffects).toHaveLength(1);
    expect(next.pendingTriggeredEffects[0]?.actingPlayerId).toBe("alice");
    expect(
      next.pendingTriggeredEffects[0]?.declaredFromPrivateZone
    ).toBeFalsy();
    expect(next.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("Phase C: 混在オーナーキューでターンプレイヤーに select_pending_to_resolve が提示される", () => {
    const fieldDef = makeFieldSpirit("P3-36-FIELD-MIX", "mandatory");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });
    expect(state.activePlayerId).toBe("alice");

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(next.pendingTriggeredEffects).toHaveLength(2);

    const aliceActions = getLegalActions({
      state: next,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const bobActions = getLegalActions({
      state: next,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });

    // 非ターンプレイヤー (bob) には legal action なし
    expect(bobActions).toEqual([]);

    // ターンプレイヤー (alice) には pending 数だけ select アクションが提示される
    expect(aliceActions).toHaveLength(2);
    expect(
      aliceActions.every((a) => a.kind === "select_pending_to_resolve")
    ).toBe(true);
    const ownerIds = aliceActions
      .map((a) =>
        a.kind === "select_pending_to_resolve" ? a.ownerPlayerId : null
      )
      .sort();
    expect(ownerIds).toEqual(["alice", "bob"]);
  });

  it("Phase C: 自分の単一 optional pending の select は発揮判断 metadata を持ち、辞退できる", () => {
    const fieldDef = makeFieldSpirit("P3-36-FIELD-OPT-SELECT", "optional");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(2);

    const aliceActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const selectAliceAction = aliceActions.find(
      (a) =>
        a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "alice"
    );
    expect(selectAliceAction).toBeDefined();
    if (selectAliceAction?.kind !== "select_pending_to_resolve") {
      throw new Error("expected select action");
    }
    expect(selectAliceAction.executionMode).toBe("optional");
    expect(selectAliceAction.sourceInstanceId).toBe("alice-field-1");
    expect(selectAliceAction.registrationIndex).toBe(0);

    const afterSkip = applyLegalAction({
      state: queued,
      action: selectAliceAction,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect("skipped" in afterSkip && afterSkip.skipped).toBe(true);
    expect(afterSkip.state.pendingTriggeredEffects).toHaveLength(1);
    expect(afterSkip.state.pendingTriggeredEffects[0]?.actingPlayerId).toBe(
      "bob"
    );
  });

  it("Phase C: 自分の複数 optional source pending は source ごとの optional select として辞退できる", () => {
    const fieldDef = makeFieldSpirit(
      "P3-36-FIELD-OPT-SELECT-MULTI",
      "optional"
    );
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "alice-field-2",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(2);

    const aliceActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const aliceSelectActions = aliceActions.filter(
      (a) =>
        a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "alice"
    );
    expect(aliceSelectActions).toHaveLength(2);
    const selectAliceAction = aliceSelectActions.find(
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.sourceInstanceId === "alice-field-1"
    )!;
    if (selectAliceAction.kind !== "select_pending_to_resolve") {
      throw new Error("expected select action");
    }
    expect(selectAliceAction.executionMode).toBe("optional");
    expect(selectAliceAction.sourceInstanceId).toBe("alice-field-1");
    expect(selectAliceAction.registrationIndex).toBe(0);

    const afterSkip = applyLegalAction({
      state: queued,
      action: selectAliceAction,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect("skipped" in afterSkip && afterSkip.skipped).toBe(true);
    expect(afterSkip.state.pendingTriggeredEffects).toHaveLength(2);
    expect(
      afterSkip.state.pendingTriggeredEffects.some(
        (pending) => pending.actingPlayerId === "alice"
      )
    ).toBe(true);
    expect(
      afterSkip.state.pendingTriggeredEffects.some(
        (pending) => pending.actingPlayerId === "bob"
      )
    ).toBe(true);
    expect(
      afterSkip.state.pendingTriggeredEffects.find(
        (pending) => pending.actingPlayerId === "alice"
      )?.resolvedSourceRegistrationKeys
    ).toContain("alice-field-1#0");
  });

  it("Phase C: owner optional select の受諾は source を選択し、そのまま発揮宣言スタック窓を開く", () => {
    const fieldDef = makeFieldSpirit(
      "P3-36-FIELD-OPT-SELECT-ACCEPT-MULTI",
      "optional"
    );
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "alice-field-2",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    const selectAliceAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find(
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.ownerPlayerId === "alice" &&
        a.sourceInstanceId === "alice-field-2"
    );
    if (selectAliceAction?.kind !== "select_pending_to_resolve") {
      throw new Error("expected source-specific owner optional select action");
    }

    const afterAccept = applyLegalAction({
      state: queued,
      action: selectAliceAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(afterAccept.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );
    expect(afterAccept.stackWindow?.pendingStackAction?.cardInstanceId).toBe(
      "alice-field-2"
    );
    expect(afterAccept.log).toContain(
      `trigger:pending:selected:${selectAliceAction.pendingId}:by:alice`
    );
    expect(
      afterAccept.log.some((entry) =>
        entry.startsWith(`trigger:declared:${selectAliceAction.pendingId}:`)
      )
    ).toBe(true);
  });

  it("Phase C: optional と mandatory が混ざる owner pending は source ごとに select 表示を分ける", () => {
    const optionalDef = makeFieldSpirit(
      "P3-36-FIELD-OPT-SELECT-MIXED",
      "optional"
    );
    const mandatoryDef = makeFieldSpirit(
      "P3-36-FIELD-MANDATORY-SELECT-MIXED",
      "mandatory"
    );
    const bobDef = makeFieldSpirit("P3-36-FIELD-BOB-MIXED", "optional");
    const lookup = makeLookup([optionalDef, mandatoryDef, bobDef]);
    const triggerLookup = buildTriggeredEffectLookup([
      optionalDef,
      mandatoryDef,
      bobDef,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(optionalDef, {
          instanceId: "alice-optional-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(mandatoryDef, {
          instanceId: "alice-mandatory-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(bobDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(2);

    const aliceSelectActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).filter(
      (a) =>
        a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "alice"
    );
    expect(aliceSelectActions).toHaveLength(2);
    const optionalSelectAction = aliceSelectActions.find(
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.sourceInstanceId === "alice-optional-1"
    );
    const mandatorySelectAction = aliceSelectActions.find(
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.sourceInstanceId === "alice-mandatory-1"
    );
    expect(optionalSelectAction).toBeDefined();
    expect(mandatorySelectAction).toBeDefined();
    if (
      optionalSelectAction?.kind !== "select_pending_to_resolve" ||
      mandatorySelectAction?.kind !== "select_pending_to_resolve"
    ) {
      throw new Error("expected select actions");
    }
    expect(optionalSelectAction.executionMode).toBe("optional");
    expect(optionalSelectAction.registrationIndex).toBe(0);
    expect(mandatorySelectAction.executionMode).toBe("mandatory");
    expect(mandatorySelectAction.registrationIndex).toBe(0);

    const afterMandatorySelect = applyLegalAction({
      state: queued,
      action: mandatorySelectAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const mandatoryResolveActions = getLegalActions({
      state: afterMandatorySelect.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(mandatoryResolveActions).toHaveLength(1);
    const mandatoryResolveAction = mandatoryResolveActions[0];
    if (mandatoryResolveAction?.kind !== "resolve_pending_triggered_effect") {
      throw new Error("expected resolve action");
    }
    expect(mandatoryResolveAction.sourceInstanceId).toBe("alice-mandatory-1");
    expect(mandatoryResolveAction.executionMode).toBe("mandatory");

    const afterOptionalSkip = applyLegalAction({
      state: queued,
      action: optionalSelectAction,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect("skipped" in afterOptionalSkip && afterOptionalSkip.skipped).toBe(
      true
    );
    expect(afterOptionalSkip.state.pendingTriggeredEffects).toHaveLength(2);
    const alicePendingAfterSkip =
      afterOptionalSkip.state.pendingTriggeredEffects.find(
        (pending) => pending.actingPlayerId === "alice"
      );
    expect(alicePendingAfterSkip?.resolvedSourceRegistrationKeys).toContain(
      "alice-optional-1#0"
    );
    const aliceSelectActionsAfterSkip = getLegalActions({
      state: afterOptionalSkip.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).filter(
      (a) =>
        a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "alice"
    );
    expect(aliceSelectActionsAfterSkip).toHaveLength(1);
    const aliceSelectActionAfterSkip = aliceSelectActionsAfterSkip[0];
    if (aliceSelectActionAfterSkip?.kind !== "select_pending_to_resolve") {
      throw new Error("expected select action");
    }
    expect(aliceSelectActionAfterSkip.executionMode).toBe("mandatory");
    expect(aliceSelectActionAfterSkip.sourceInstanceId).toBe(
      "alice-mandatory-1"
    );
  });

  it("Phase C: select 後、対象 pending owner にだけ resolve_pending_triggered_effect が出る", () => {
    const fieldDef = makeFieldSpirit("P3-36-FIELD-SELECT", "mandatory");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // alice (ターン) が「bob の pending」を先に解決する旨を select する
    const aliceSelectActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const selectBobAction = aliceSelectActions.find(
      (a) => a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "bob"
    );
    expect(selectBobAction).toBeDefined();

    const afterSelect = applyLegalAction({
      state: queued,
      action: selectBobAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    // bob の pending に flag が立っている
    const selectedPending = afterSelect.pendingTriggeredEffects.find(
      (p) => p.actingPlayerId === "bob"
    );
    expect(selectedPending?.selectedByTurnPlayer).toBe(true);

    // `解決` を押した後は、alice には resolve 系も別効果へ変更する select も出ない。
    const aliceAfter = getLegalActions({
      state: afterSelect,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(
      aliceAfter.some((a) => a.kind === "resolve_pending_triggered_effect")
    ).toBe(false);
    expect(aliceAfter.some((a) => a.kind === "select_pending_to_resolve")).toBe(
      false
    );

    // bob (owner) に resolve action が出る
    const bobAfter = getLegalActions({
      state: afterSelect,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const bobResolve = bobAfter.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(bobResolve).toBeDefined();
    expect(
      bobResolve?.kind === "resolve_pending_triggered_effect"
        ? bobResolve.pendingId
        : ""
    ).toBe(selectedPending?.pendingId);
  });

  it("Phase D: direct-path optional pending は skipOptionalEffect で発揮辞退できる (select 後)", () => {
    const fieldDef = makeFieldSpirit("P3-36-FIELD-OPT", "optional");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "bob-field-1",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice"), makeStartStepEvent("bob")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(2);

    // alice (ターン) が bob の pending を select
    const aliceActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const selectBobAction = aliceActions.find(
      (a) => a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "bob"
    );
    const afterSelect = applyLegalAction({
      state: queued,
      action: selectBobAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    // bob (owner) の resolve action は executionMode='optional'
    const bobActions = getLegalActions({
      state: afterSelect,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const bobResolve = bobActions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(bobResolve).toBeDefined();
    if (bobResolve?.kind !== "resolve_pending_triggered_effect") {
      throw new Error("expected resolve action");
    }
    expect(bobResolve.executionMode).toBe("optional");

    // 発揮辞退 (skipOptionalEffect=true) で pending が削除される
    const afterSkip = applyLegalAction({
      state: afterSelect,
      action: bobResolve,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    if (
      "skipped" in afterSkip &&
      afterSkip.skipped === true &&
      afterSkip.state.pendingTriggeredEffects
    ) {
      expect(afterSkip.state.pendingTriggeredEffects).toHaveLength(1);
      expect(afterSkip.state.pendingTriggeredEffects[0]?.actingPlayerId).toBe(
        "alice"
      );
    } else {
      throw new Error("expected skipped result with remaining alice pending");
    }
  });

  it("Phase C: 同一オーナーキューは select 不要（互換性: head-only iterating の挙動）", () => {
    const fieldDef = makeFieldSpirit("P3-36-FIELD-SAME", "mandatory");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(fieldDef, {
          instanceId: "alice-field-2",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects.length).toBeGreaterThanOrEqual(1);

    // owner (alice) に select 経由なしで直接 resolve action が legal になる
    const aliceActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(
      aliceActions.every((a) => a.kind === "resolve_pending_triggered_effect")
    ).toBe(true);

    // bob (非ターン) には何も出ない
    const bobActions = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(bobActions).toEqual([]);
  });
});

describe("P3-36 Phase A: pendingPrivateDeclarations sort 不変条件", () => {
  function makePrivateDecl(
    declarationId: string,
    ownerPlayerId: string
  ): PendingPrivateDeclaration {
    return {
      declarationId,
      pendingId: `pending-${declarationId}`,
      ownerPlayerId,
      actingPlayerId: ownerPlayerId,
      eventKind: "reduce_life",
      source: "step_transition",
      sourceInstanceId: `inst-${declarationId}`,
      sourceDefinitionId: "P3-36-DECL",
      sourceKind: "spirit",
      sourceZone: "hand",
      registrationIndex: 0,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
      attackId: null,
      chainId: "test:p3-36-turn-player-priority:779",
    };
  }

  it("sortPendingPrivateDeclarationsByTurnPriority は非ターンプレイヤーを先頭に並べる", () => {
    const turnPlayerId = "alice";
    const decls = [
      makePrivateDecl("d1", "alice"),
      makePrivateDecl("d2", "bob"),
      makePrivateDecl("d3", "alice"),
      makePrivateDecl("d4", "bob"),
    ];
    const sorted = sortPendingPrivateDeclarationsByTurnPriority(
      decls,
      turnPlayerId
    );
    expect(sorted.map((d) => d.declarationId)).toEqual([
      "d2",
      "d4",
      "d1",
      "d3",
    ]);
  });

  it("isPendingPrivateDeclarationsSortedByTurnPriority は正しい順序を true、誤った順序を false で返す", () => {
    const turnPlayerId = "alice";
    const sorted = [
      makePrivateDecl("d1", "bob"),
      makePrivateDecl("d2", "bob"),
      makePrivateDecl("d3", "alice"),
    ];
    expect(
      isPendingPrivateDeclarationsSortedByTurnPriority(sorted, turnPlayerId)
    ).toBe(true);

    const broken = [
      makePrivateDecl("d1", "bob"),
      makePrivateDecl("d2", "alice"),
      makePrivateDecl("d3", "bob"),
    ];
    expect(
      isPendingPrivateDeclarationsSortedByTurnPriority(broken, turnPlayerId)
    ).toBe(false);
  });

  it("invariants check は sort 違反を pending_private_declarations_unsorted で報告する", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const broken = {
      ...state,
      pendingPrivateDeclarations: [
        makePrivateDecl("d1", "alice"),
        makePrivateDecl("d2", "bob"),
      ],
    };
    const issues = collectGameStateInvariantIssues(broken);
    expect(
      issues.some(
        (issue) => issue.code === "pending_private_declarations_unsorted"
      )
    ).toBe(true);

    const sorted = {
      ...state,
      pendingPrivateDeclarations: [
        makePrivateDecl("d1", "bob"),
        makePrivateDecl("d2", "alice"),
      ],
    };
    const sortedIssues = collectGameStateInvariantIssues(sorted);
    expect(
      sortedIssues.some(
        (issue) => issue.code === "pending_private_declarations_unsorted"
      )
    ).toBe(false);
  });
});
