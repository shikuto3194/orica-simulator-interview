/**
 * P3-14 C-1: 「召喚コスト支払い後」タイミングのトリガーテスト
 *
 * - triggerEventKindToStructuredEvent("after_cost_paid") のマッピング検証
 * - queueAfterCostPaidTriggers の直接呼び出しで pending triggered effect が積まれる
 * - playSummonAsAction → applyCardCostPayments 直後に after_cost_paid event が発火
 * - playMagicCardAsAction → applyMagicPayments 直後に after_cost_paid event が発火
 * - OPT_IN_TRIGGER_EVENT_KINDS フィルタにより該当 timing 効果を持たないカードでは
 *   pending を作らない
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  triggerEventKindToStructuredEvent,
  playSummonAsAction,
  playMagicCardAsAction,
  getLegalActions,
  applyLegalAction,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

function makeSpirit(
  cardNo: string,
  effects: CardDefinition["effects"] = undefined,
  cost = 2
): CardDefinition {
  const base: CardDefinition = {
    cardNo,
    name: `Spirit ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  return effects !== undefined ? { ...base, effects } : base;
}

function makeMagic(
  cardNo: string,
  effects: CardDefinition["effects"] = undefined,
  cost = 2
): CardDefinition {
  const base: CardDefinition = {
    cardNo,
    name: `Magic ${cardNo}`,
    printedCategory: "magic",
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  return effects !== undefined ? { ...base, effects } : base;
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

/**
 * P3-29 Phase 1 以降: triggered 効果の発揮宣言は stack window を開く。
 * テスト目的の同期解決には、相手の pass を 1 回投入して窓をクローズする。
 */
function passOpponentToCloseTriggeredStack(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggeredLookup?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredTriggeredEffectActions"]
): GameState {
  if (state.window !== "stack" || !state.stackWindow) {
    return state;
  }
  const opponentId = state.stackWindow.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${opponentId}`,
      can: true,
      reason: "p3_29_test_close",
      actingPlayerId: opponentId,
    },
    getCardDefinitionById,
    ...(triggeredLookup
      ? { getRegisteredTriggeredEffectActions: triggeredLookup }
      : {}),
  }).state;
}

/**
 * P3-36 厳密モード: 複数 pending の場合、resolve_pending_triggered_effect を発火する前に
 * select_pending_to_resolve でターン側が解決順を確定する必要がある。
 * このヘルパーは指定 eventKind の pending を select する（既に auto-select 状態なら no-op）。
 */
function selectPendingIfRequired(
  state: GameState,
  eventKind: string,
  callerPlayerId: string,
  lookup: (id: string) => CardDefinition | undefined,
  triggeredLookup: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredTriggeredEffectActions"]
): GameState {
  const target = state.pendingTriggeredEffects.find(
    (p) => p.eventKind === eventKind
  );
  if (!target) return state;
  if (target.selectedByTurnPlayer === true) return state;
  if (state.pendingTriggeredEffects.length <= 1) return state;
  const turnActions = getLegalActions({
    state,
    actingPlayerId: state.activePlayerId,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  });
  const selectAction = turnActions.find(
    (a) =>
      a.kind === "select_pending_to_resolve" &&
      "pendingId" in a &&
      a.pendingId === target.pendingId
  );
  if (!selectAction) return state;
  void callerPlayerId;
  return applyLegalAction({
    state,
    action: selectAction,
    getCardDefinitionById: lookup,
    ...(triggeredLookup
      ? { getRegisteredTriggeredEffectActions: triggeredLookup }
      : {}),
  }).state;
}

describe("triggerEventKindToStructuredEvent — after_cost_paid", () => {
  it("maps after_cost_paid to payment_timing family with snapshot_only validation", () => {
    expect(triggerEventKindToStructuredEvent("after_cost_paid")).toEqual({
      family: "payment_timing",
      validationMode: "snapshot_only",
    });
  });
});

describe("queueAfterCostPaidTriggers — direct invocation", () => {
  it("appends pending triggered effect for a card with matching card_event timing", async () => {
    const { queueAfterCostPaidTriggers } =
      await import("../src/effect/trigger-system");

    const def = makeSpirit("PAY-WITH-TIMING", [
      {
        timing: { kind: "card_event", event: "after_cost_paid" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "card-1",
          ownerPlayerId: "alice",
          zone: "in_use",
          cores: 0,
        }),
      ],
    });
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const next = queueAfterCostPaidTriggers({
      chainId: "test:after-cost-paid-trigger:181",
      state: baseState,
      sourceInstanceId: "card-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(next.pendingTriggeredEffects.length).toBe(1);
    const pending = next.pendingTriggeredEffects[0]!;
    expect(pending.eventKind).toBe("after_cost_paid");
    expect(pending.relatedInstanceId).toBe("card-1");
    expect(pending.actingPlayerId).toBe("alice");
    expect(pending.event).toMatchObject({ family: "payment_timing" });
  });

  it("filters out pending when sourceInstanceId is null (forced payment / no relatedInstance)", async () => {
    const { queueAfterCostPaidTriggers } =
      await import("../src/effect/trigger-system");

    const def = makeSpirit("PAY-NULL-SOURCE", [
      {
        timing: { kind: "card_event", event: "after_cost_paid" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "card-1",
          ownerPlayerId: "alice",
          zone: "in_use",
          cores: 0,
        }),
      ],
    });
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const next = queueAfterCostPaidTriggers({
      chainId: "test:after-cost-paid-trigger:221",
      state: baseState,
      sourceInstanceId: null,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(next.pendingTriggeredEffects.length).toBe(0);
  });

  it("does not queue pending when card has no after_cost_paid timing effect", async () => {
    const { queueAfterCostPaidTriggers } =
      await import("../src/effect/trigger-system");

    const def = makeSpirit("PAY-NO-TIMING");
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "card-1",
          ownerPlayerId: "alice",
          zone: "in_use",
          cores: 0,
        }),
      ],
    });
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const next = queueAfterCostPaidTriggers({
      chainId: "test:after-cost-paid-trigger:251",
      state: baseState,
      sourceInstanceId: "card-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(next.pendingTriggeredEffects.length).toBe(0);
  });
});

describe("playSummonAsAction — after_cost_paid trigger", () => {
  it("queues pending triggered effect after summon cost is paid", () => {
    const def = makeSpirit(
      "SUM-WITH-AFTER-PAID",
      [
        {
          timing: { kind: "card_event", event: "after_cost_paid" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
      2
    );
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "hand-spirit",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);
    // P3-39 follow-up: hand → in_use → field の経路で after_cost_paid 時点で
    // ソースが in_use にあるため、strict 経路でも sourceChoices=1 で pending が積まれる。
    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-spirit",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const afterPaid = result.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "after_cost_paid"
    );
    expect(afterPaid.length).toBe(1);
    expect(afterPaid[0]!.relatedInstanceId).toBe("hand-spirit");
    expect(afterPaid[0]!.actingPlayerId).toBe("alice");
  });

  it("does not queue pending when summoning a spirit without after_cost_paid timing", () => {
    const def = makeSpirit("SUM-NO-AFTER-PAID", undefined, 2);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "hand-spirit",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-spirit",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const afterPaid = result.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "after_cost_paid"
    );
    expect(afterPaid.length).toBe(0);
  });
});

describe("after_cost_paid resolution — spirit source-backed (in_use 直後を含む)", () => {
  it("queueAfterCostPaidTriggers + in_use ゾーンの spirit を source として draw 1 を実行できる", async () => {
    const def = makeSpirit("SUM-AFTER-PAID-INUSE", [
      {
        timing: { kind: "card_event", event: "after_cost_paid" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "card-1",
          ownerPlayerId: "alice",
          zone: "in_use",
          cores: 0,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const { queueAfterCostPaidTriggers } =
      await import("../src/effect/trigger-system");
    const queued = queueAfterCostPaidTriggers({
      chainId: "test:after-cost-paid-trigger:381",
      state,
      sourceInstanceId: "card-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(queued.pendingTriggeredEffects.length).toBe(1);

    const legalActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveAction = legalActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "after_cost_paid"
    );
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected source-backed resolve action");
    }
    // 修正前は in_use 不許可で fallback (sourceInstanceId 無し) になっていた
    expect(resolveAction.sourceInstanceId).toBe("card-1");
    expect(resolveAction.sourceKind).toBe("spirit");

    const beforeHand =
      queued.players.find((p) => p.id === "alice")?.handCount ?? 0;
    const beforeDeck =
      queued.players.find((p) => p.id === "alice")?.deckCount ?? 0;

    const applied = applyLegalAction({
      state: queued,
      action: resolveAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const drained = passOpponentToCloseTriggeredStack(
      applied.state,
      lookup,
      triggeredLookup
    );
    const afterAlice = drained.players.find((p) => p.id === "alice")!;
    expect(afterAlice.handCount).toBe(beforeHand + 1);
    expect(afterAlice.deckCount).toBe(beforeDeck - 1);
  });

  it("playSummonAsAction (非 stack-context) でも source-backed で draw 1 を実行できる", () => {
    const def = makeSpirit(
      "SUM-AFTER-PAID-RESOLVE",
      [
        {
          timing: { kind: "card_event", event: "after_cost_paid" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
      2
    );
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "hand-spirit",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3, deckCount: 5 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    // P3-39 follow-up: hand → in_use → field の経路で in_use ゾーンを source に
    // strict 経路で pending が積まれる。
    const summonResult = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-spirit",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    // P3-36 厳密モード: 複数 pending の場合は select_pending_to_resolve を先に発火する
    const stateForResolve = selectPendingIfRequired(
      summonResult.state,
      "after_cost_paid",
      "alice",
      lookup,
      triggeredLookup
    );
    const legalActions = getLegalActions({
      state: stateForResolve,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveAction = legalActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "after_cost_paid"
    );
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected source-backed resolve action");
    }
    expect(resolveAction.sourceInstanceId).toBe("hand-spirit");
    expect(resolveAction.sourceKind).toBe("spirit");

    const beforeHand =
      stateForResolve.players.find((p) => p.id === "alice")?.handCount ?? 0;
    const beforeDeck =
      stateForResolve.players.find((p) => p.id === "alice")?.deckCount ?? 0;

    const applied = applyLegalAction({
      state: stateForResolve,
      action: resolveAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const drained = passOpponentToCloseTriggeredStack(
      applied.state,
      lookup,
      triggeredLookup
    );
    const afterAlice = drained.players.find((p) => p.id === "alice")!;
    expect(afterAlice.handCount).toBe(beforeHand + 1);
    expect(afterAlice.deckCount).toBe(beforeDeck - 1);
  });
});

describe("playMagicCardAsAction — after_cost_paid trigger", () => {
  it("queues pending triggered effect after magic cost is paid", () => {
    const def = makeMagic(
      "MAG-WITH-AFTER-PAID",
      [
        {
          timing: { kind: "card_event", event: "after_cost_paid" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
      2
    );
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "hand-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "hand-magic",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      chosenTiming: "main",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const afterPaid = result.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "after_cost_paid"
    );
    expect(afterPaid.length).toBe(1);
    expect(afterPaid[0]!.relatedInstanceId).toBe("hand-magic");
    expect(afterPaid[0]!.actingPlayerId).toBe("alice");
  });
});

describe("after_cost_paid resolution — magic source-backed (in_use ゾーン)", () => {
  it("queueAfterCostPaidTriggers + in_use ゾーンの magic を source として draw 1 を実行できる", async () => {
    const def = makeMagic("MAG-AFTER-PAID-INUSE", [
      {
        timing: { kind: "card_event", event: "after_cost_paid" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const { queueAfterCostPaidTriggers } =
      await import("../src/effect/trigger-system");
    const queued = queueAfterCostPaidTriggers({
      chainId: "test:after-cost-paid-trigger:605",
      state,
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(queued.pendingTriggeredEffects.length).toBe(1);

    const legalActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveAction = legalActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "after_cost_paid"
    );
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected source-backed resolve action for magic");
    }
    // 修正前は magic registration が生成されず fallback (sourceInstanceId 無し) になっていた
    expect(resolveAction.sourceInstanceId).toBe("magic-1");
    expect(resolveAction.sourceKind).toBe("magic");

    const beforeHand =
      queued.players.find((p) => p.id === "alice")?.handCount ?? 0;
    const beforeDeck =
      queued.players.find((p) => p.id === "alice")?.deckCount ?? 0;

    const applied = applyLegalAction({
      state: queued,
      action: resolveAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const drained = passOpponentToCloseTriggeredStack(
      applied.state,
      lookup,
      triggeredLookup
    );
    const afterAlice = drained.players.find((p) => p.id === "alice")!;
    expect(afterAlice.handCount).toBe(beforeHand + 1);
    expect(afterAlice.deckCount).toBe(beforeDeck - 1);
  });
});
