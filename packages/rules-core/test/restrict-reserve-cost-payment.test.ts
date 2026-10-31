import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getAvailableCardCostPaymentSources } from "../src/core/payment-system";
import {
  isReserveCostPaymentRestricted,
  recomputeContinuousEffects,
} from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// ENGINE-restrict-reserve-cost-payment: 「相手はリザーブからコストが支払えない」
// (BSSL01-R03 [3,4,5])。restrict_advent と同型の player-scoped CE。
// ============================================================

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-RRCP-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

function runEffect(action: Effect["steps"][number]["action"]) {
  const sourceDef = makeDef({ cardNo: "RRCP-SRC" });
  registerDef(sourceDef);
  const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
  const state = makeState([sourceCard]);

  const effect: Effect = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action }],
  };

  return executeEffect({
    chainId: "test:restrict-reserve-cost-payment:80",
    state,
    effect,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("ENGINE-restrict-reserve-cost-payment: restrict_reserve_cost_payment — CE 登録", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_reserve_cost_payment アクションで同タグの CE が登録される", () => {
    const result = runEffect({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag ===
        ("restrict_reserve_cost_payment" as ContinuousEffectTag)
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("bob"); // opponent
    expect(ces[0]!.duration.scope).toBe("battle");
  });

  it("ログに restrict_reserve_cost_payment:registered が記録される", () => {
    const result = runEffect({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });

    expect(
      result.log.some((l) =>
        l.includes("effect:restrict_reserve_cost_payment:registered")
      )
    ).toBe(true);
  });
});

describe("ENGINE-restrict-reserve-cost-payment: isReserveCostPaymentRestricted — CE 消費", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("CE があるとき isReserveCostPaymentRestricted が true", () => {
    const result = runEffect({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });

    expect(isReserveCostPaymentRestricted(result, "bob")).toBe(true);
    // alice (CE 発動者) は制限されない
    expect(isReserveCostPaymentRestricted(result, "alice")).toBe(false);
  });

  it("CE が無いとき isReserveCostPaymentRestricted が false", () => {
    const state = makeState([]);
    expect(isReserveCostPaymentRestricted(state, "bob")).toBe(false);
  });

  it("CE は player-scoped のため recomputeContinuousEffects を跨いでも除去されない", () => {
    const result = runEffect({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });

    const recomputed = recomputeContinuousEffects(result);
    const ce = recomputed.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_reserve_cost_payment"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe("bob");
    expect(isReserveCostPaymentRestricted(recomputed, "bob")).toBe(true);
  });
});

describe("ENGINE-restrict-reserve-cost-payment: getAvailableCardCostPaymentSources 消費 (支払いソース除外)", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("制限中はリザーブが支払いソースから除外され、フィールドのカード上コアは引き続き使える", () => {
    const result = runEffect({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });
    // bob にリザーブコア5個を与える
    const withReserve: GameState = {
      ...result,
      players: result.players.map((p) =>
        p.id === "bob" ? { ...p, reserveNormalCoreCount: 5 } : p
      ),
    };

    const targetDef = makeDef({ cardNo: "RRCP-PAY-TARGET", cost: 3 });
    const sources = getAvailableCardCostPaymentSources({
      state: withReserve,
      actingPlayerId: "bob",
      card: targetDef,
      getCardDefinitionById: getDef,
    });

    expect(sources.reserveSource.availableCoreAmount).toBe(0);
    expect(sources.totalAvailableCoreAmount).toBe(0);
    expect(sources.canFullyPay).toBe(false);
  });

  it("制限されていないプレイヤー (alice) はリザーブを通常どおり支払いソースに使える", () => {
    const result = runEffect({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });
    const withReserve: GameState = {
      ...result,
      players: result.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 5 } : p
      ),
    };

    const targetDef = makeDef({ cardNo: "RRCP-PAY-TARGET-2", cost: 3 });
    const sources = getAvailableCardCostPaymentSources({
      state: withReserve,
      actingPlayerId: "alice",
      card: targetDef,
      getCardDefinitionById: getDef,
    });

    expect(sources.reserveSource.availableCoreAmount).toBe(5);
    expect(sources.canFullyPay).toBe(true);
  });
});

describe("ENGINE-restrict-reserve-cost-payment: didNonCardActionChangeState 配線", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_reserve_cost_payment step の CE 登録成功が stepSucceeded=true として後続 ref_succeeded step へ伝播する", () => {
    const sourceDef = makeDef({ cardNo: "RRCP-SRC-2" });
    registerDef(sourceDef);
    const sourceCard = makeInstance(sourceDef, { instanceId: "src-2" });
    const state = makeState([sourceCard]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "restrict-step",
          action: {
            kind: "restrict_reserve_cost_payment",
            player: "opponent",
            duration: { scope: "battle" },
          },
        },
        {
          id: "bonus-step",
          stepCondition: { kind: "ref_succeeded", stepId: "restrict-step" },
          action: { kind: "count_increase", player: "self", amount: 5 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:restrict-reserve-cost-payment:253",
      state,
      effect,
      sourceInstanceId: "src-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(5);
  });
});
