/**
 * ことで構文 (`connector: "conditional_cost"`) の `pay_cost` コア源選択を、宣言時(窓前)でなく
 * 解決時(窓後)へ遅延する (BSTH01-X04 フランドール「1コスト支払うことで…破壊する」型)。
 *
 * - `allowPendingPayCostSourceAllocation` 指定 (= GUI が窓前モーダルを抑止した deferred 経路) で
 *   フィールドの支払い元があれば pendingCoreSourceAllocation を立てて中断し、
 *   窓後にコア源 (reserve / フィールドカード) を選ばせる。
 * - 非対話実行も同じ合法候補を使い、リザーブ優先で決定的に支払う。
 * - 解決後はことで構文どおりコスト支払い + 効果 (destroy) が atomic に成立する。
 *
 * 正源: 10_rules/02:204 ことで構文の窓後解決順 (P3-110 と同型)。
 */
import { describe, expect, it } from "vitest";
import { canPayRequiredEffectCosts } from "../src/legal/required-effect-cost-gate";
import type { CardDefinition, GameState, ContinuousEffect } from "../src/index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { Effect } from "../src/dsl-types";

// pay_cost(1) → conditional_cost destroy(相手スピリット1体)。X04 effect[0] と同型。
const FLASH_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    { action: { kind: "pay_cost", amount: 1 } },
    {
      action: {
        kind: "destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
      },
      connector: "conditional_cost",
    },
  ],
} as Effect;

function makeSpiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    keywordTags: [],
    textLines: [],
    effects: [FLASH_EFFECT],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function buildState(): { state: GameState; defs: Map<string, CardDefinition> } {
  const srcDef = makeSpiritDef("PCSA-SRC");
  const fieldDef = makeSpiritDef("PCSA-FIELD");
  const victimDef = makeSpiritDef("PCSA-VICTIM");
  const defs = new Map<string, CardDefinition>([
    [srcDef.cardNo, srcDef],
    [fieldDef.cardNo, fieldDef],
    [victimDef.cardNo, victimDef],
  ]);
  const cards = [
    createCardInstance(srcDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    }),
    // 追加のコア保持フィールドカード (リザーブと並ぶ第2の支払い候補)。
    createCardInstance(fieldDef, {
      instanceId: "fld-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    }),
    createCardInstance(victimDef, {
      instanceId: "bob-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    }),
  ];
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    }),
    activePlayerId: "alice",
    step: "attack" as const,
  };
  return { state, defs };
}

function run(
  state: GameState,
  defs: Map<string, CardDefinition>,
  opts: { allowPending?: boolean } = {}
): GameState {
  return executeEffect({
    chainId: "test:pay-cost-source-allocation:106",
    state,
    effect: FLASH_EFFECT,
    effectIndex: 0,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredTriggeredEffectActions: () => [],
    targetInstanceIds: ["bob-1"],
    ...(opts.allowPending ? { allowPendingPayCostSourceAllocation: true } : {}),
  });
}

function resolveWith(
  state: GameState,
  defs: Map<string, CardDefinition>,
  allocations: Record<string, number>,
  soulSourceId?: string
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: () => [],
  });
  const action = actions.find(
    (a) => a.kind === "resolve_core_source_allocation"
  );
  expect(
    action,
    "resolve_core_source_allocation が合法手に出ない"
  ).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredTriggeredEffectActions: () => [],
    coreSourceAllocations: allocations,
    ...(soulSourceId ? { coreSourceSoulCoreInstanceId: soulSourceId } : {}),
  }).state;
}

function isGone(state: GameState, id: string): boolean {
  const c = state.cardInstances.find((x) => x.instanceId === id);
  return c === undefined || c.zone !== "field" || c.pendingLeaveKind !== null;
}

describe("pay_cost ことで構文: 窓後コア源選択の遅延", () => {
  it("allowPending かつ配分曖昧 → pendingCoreSourceAllocation を立て中断 (盤面不変)", () => {
    const { state, defs } = buildState();
    const next = run(state, defs, { allowPending: true });
    expect(next.pendingCoreSourceAllocation).not.toBeNull();
    const pending = next.pendingCoreSourceAllocation!;
    expect(pending.requiredTotal).toBe(1);
    const candIds = pending.candidates.map((c) => c.instanceId).sort();
    // リザーブ + フィールドカード (src-1 / fld-1) が候補。
    expect(candIds).toContain("reserve");
    expect(candIds).toContain("fld-1");
    // 中断時点では支払い前 (victim 健在 / コア未移動)。
    expect(isGone(next, "bob-1")).toBe(false);
    expect(next.pendingCoreSourceAllocation!.continuation).toBeDefined();
  });

  it("リザーブを選んで解決 → リザーブからコア支払い + destroy 成立", () => {
    const { state, defs } = buildState();
    const pendingState = run(state, defs, { allowPending: true });
    const resolved = resolveWith(pendingState, defs, { reserve: 1 });
    expect(resolved.pendingCoreSourceAllocation).toBeNull();
    expect(isGone(resolved, "bob-1")).toBe(true);
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1); // 2 → 1
    // フィールドカードのコアは不変。
    const fld = resolved.cardInstances.find((c) => c.instanceId === "fld-1")!;
    expect(fld.normalCoreCount).toBe(2);
  });

  it("フィールドカードを選んで解決 → そのカードからコア支払い + destroy 成立", () => {
    const { state, defs } = buildState();
    const pendingState = run(state, defs, { allowPending: true });
    const resolved = resolveWith(pendingState, defs, { "fld-1": 1 });
    expect(resolved.pendingCoreSourceAllocation).toBeNull();
    expect(isGone(resolved, "bob-1")).toBe(true);
    const fld = resolved.cardInstances.find((c) => c.instanceId === "fld-1")!;
    expect(fld.normalCoreCount).toBe(1); // 2 → 1
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2); // 不変
  });

  it("allowPending 未指定 (直接 executeEffect) → 従来どおりリザーブ自動支払い・即破壊", () => {
    const { state, defs } = buildState();
    const next = run(state, defs);
    expect(next.pendingCoreSourceAllocation).toBeNull();
    expect(isGone(next, "bob-1")).toBe(true);
    const alice = next.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1); // 2 → 1 (reserve auto)
  });
});

describe("pay_cost 共通支払い元", () => {
  it("フィールドのソウルコアを選んで支払える", () => {
    const { state: base, defs } = buildState();
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveNormalCoreCount: 0,
              reserveSoulCoreCount: 0,
              soulCoreLocation: { kind: "card", instanceId: "fld-1" },
            }
          : p
      ),
      cardInstances: base.cardInstances.map((c) =>
        c.controllerPlayerId === "alice"
          ? {
              ...c,
              normalCoreCount: 0,
              soulCoreCount: c.instanceId === "fld-1" ? 1 : 0,
            }
          : c
      ),
    };
    const pending = run(state, defs, { allowPending: true });
    expect(pending.pendingCoreSourceAllocation?.candidates).toEqual([
      {
        instanceId: "fld-1",
        available: 1,
        normalAvailable: 0,
        hasSoulCore: true,
      },
    ]);
    const paid = resolveWith(pending, defs, {}, "fld-1");
    expect(paid.pendingCoreSourceAllocation).toBeNull();
    expect(paid.players.find((p) => p.id === "alice")?.trashSoulCoreCount).toBe(
      1
    );
    expect(isGone(paid, "bob-1")).toBe(true);
  });

  it("待機カード上のコアも共通支払い候補に含める", () => {
    const { state, defs } = buildState();
    state.cardInstances = state.cardInstances.map((c) =>
      c.instanceId === "fld-1" ? { ...c, pendingLeaveKind: "destroy" } : c
    );
    const pending = run(state, defs, { allowPending: true });
    expect(
      pending.pendingCoreSourceAllocation?.candidates.some(
        (c) => c.instanceId === "fld-1"
      )
    ).toBe(true);
    const paid = resolveWith(pending, defs, { "fld-1": 1 });
    expect(
      paid.players.find((p) => p.id === "alice")?.trashNormalCoreCount
    ).toBe(1);
    expect(isGone(paid, "bob-1")).toBe(true);
  });

  it("通常コアのリザーブだけなら選択待ちを出さず支払う", () => {
    const { state, defs } = buildState();
    state.cardInstances = state.cardInstances.map((c) =>
      c.controllerPlayerId === "alice" ? { ...c, normalCoreCount: 0 } : c
    );
    const paid = run(state, defs, { allowPending: true });
    expect(paid.pendingCoreSourceAllocation).toBeNull();
    expect(
      paid.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(1);
    expect(isGone(paid, "bob-1")).toBe(true);
  });
});

describe("pay_cost 標準契約・支払い制限", () => {
  function restrict(base: GameState, modifierTag: string, modes?: string[]) {
    return {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        {
          effectId: modifierTag,
          sourceDefinitionId: "PCSA-VICTIM",
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          sourceInstanceId: "bob-1",
          targetInstanceId: "alice",
          modifierTag,
          metadata: modes ? { effectModes: modes } : {},
        } as ContinuousEffect,
      ],
    };
  }
  function canPay(
    state: GameState,
    defs: Map<string, CardDefinition>,
    amount = 1
  ) {
    return canPayRequiredEffectCosts(
      state,
      "alice",
      { requiredPayCostAmount: amount },
      (id) => defs.get(id),
      [],
      {},
      { sourceDefinition: defs.get("PCSA-SRC")!, effectIndex: 0 }
    );
  }
  it("フラグなしの非対話実行も、リザーブ0ならフィールドから支払う", () => {
    const { state: base, defs } = buildState();
    const state = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 0 } : p
      ),
    };
    const paid = run(state, defs);
    expect(paid.pendingCoreSourceAllocation).toBeNull();
    expect(paid.players[0]!.trashNormalCoreCount).toBe(1);
    expect(
      paid.cardInstances.find((c) => c.instanceId === "src-1")!.normalCoreCount
    ).toBe(0);
    expect(isGone(paid, "bob-1")).toBe(true);
  });
  it("リザーブ制限は候補と明示入力と非対話支払いのすべてへ適用する", () => {
    const { state: base, defs } = buildState();
    const state = restrict(base, "restrict_reserve_cost_payment");
    expect(canPay(state, defs)).toBe(true);
    const pending = run(state, defs, { allowPending: true });
    expect(
      pending.pendingCoreSourceAllocation!.candidates.map((c) => c.instanceId)
    ).not.toContain("reserve");
    const rejected = executeEffect({
      chainId: "test:restricted:1",
      state,
      effect: FLASH_EFFECT,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["bob-1"],
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
    });
    expect(isGone(rejected, "bob-1")).toBe(false);
    expect(rejected.players[0]!.trashNormalCoreCount).toBe(0);
    const paid = run(state, defs);
    expect(paid.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(paid.players[0]!.trashNormalCoreCount).toBe(1);
    expect(isGone(paid, "bob-1")).toBe(true);
  });
  it("flash限定のフィールド制限は可否判定・候補・明示入力で一致する", () => {
    const { state: base, defs } = buildState();
    const state = restrict(base, "restrict_field_cost_payment", ["flash"]);
    const paid = run(state, defs, { allowPending: true });
    expect(paid.pendingCoreSourceAllocation).toBeNull();
    expect(paid.players[0]!.reserveNormalCoreCount).toBe(1);
    expect(
      paid.cardInstances.find((c) => c.instanceId === "fld-1")!.normalCoreCount
    ).toBe(2);
    const noReserve = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 0 } : p
      ),
    };
    expect(canPay(noReserve, defs)).toBe(false);
    expect(isGone(run(noReserve, defs), "bob-1")).toBe(false);
    const rejected = executeEffect({
      chainId: "test:restricted-field:1",
      state,
      effect: FLASH_EFFECT,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["bob-1"],
      payCostPaymentSources: [{ kind: "card", instanceId: "fld-1", amount: 1 }],
    });
    expect(isGone(rejected, "bob-1")).toBe(false);
    expect(rejected.players[0]!.trashNormalCoreCount).toBe(0);
    expect(
      canPay(
        restrict(noReserve, "restrict_field_cost_payment", ["stack"]),
        defs
      )
    ).toBe(false);
    const onlyStack = restrict(
      { ...noReserve, activeContinuousEffects: [] },
      "restrict_field_cost_payment",
      ["stack"]
    );
    expect(canPay(onlyStack, defs)).toBe(true);
    expect(isGone(run(onlyStack, defs), "bob-1")).toBe(true);
  });
  it("総量不足は起動可否と実行の両方で支払い・効果を止める", () => {
    const { state: base, defs } = buildState();
    const state = {
      ...base,
      cardInstances: base.cardInstances.map((c) =>
        c.controllerPlayerId === "alice" ? { ...c, normalCoreCount: 0 } : c
      ),
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 0 } : p
      ),
    };
    expect(canPay(state, defs)).toBe(false);
    const failed = run(state, defs, { allowPending: true });
    expect(failed.pendingCoreSourceAllocation).toBeNull();
    expect(isGone(failed, "bob-1")).toBe(false);
    expect(failed.players[0]!.trashNormalCoreCount).toBe(0);
  });
});

it("通常のpay_costはリザーブとフィールドを組み合わせて同じpendingから支払える", () => {
  const { state, defs } = buildState();
  const effect: Effect = {
    ...FLASH_EFFECT,
    steps: FLASH_EFFECT.steps.map((step) =>
      step.action.kind === "pay_cost"
        ? { ...step, action: { ...step.action, amount: 2 } }
        : step
    ),
  };
  const pending = executeEffect({
    chainId: "test:pay-cost-mixed:1",
    state,
    effect,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: (id) => defs.get(id),
    getRegisteredTriggeredEffectActions: () => [],
    targetInstanceIds: ["bob-1"],
    allowPendingPayCostSourceAllocation: true,
  });
  expect(pending.pendingCoreSourceAllocation?.requiredTotal).toBe(2);
  const paid = resolveWith(pending, defs, { reserve: 1, "fld-1": 1 });
  expect(paid.pendingCoreSourceAllocation).toBeNull();
  expect(paid.players[0]).toMatchObject({
    reserveNormalCoreCount: 1,
    trashNormalCoreCount: 2,
  });
  expect(
    paid.cardInstances.find((c) => c.instanceId === "fld-1")!.normalCoreCount
  ).toBe(1);
  expect(
    paid.cardInstances.find((c) => c.instanceId === "src-1")!.normalCoreCount
  ).toBe(1);
  expect(isGone(paid, "bob-1")).toBe(true);
});
