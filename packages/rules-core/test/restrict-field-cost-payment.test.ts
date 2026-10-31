import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getAvailableCardCostPaymentSources } from "../src/core/payment-system";
import {
  isFieldCostPaymentRestricted,
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
// ENGINE-restrict-field-cost-payment: 「相手のマジックのスタック効果コストは、
// フィールドから支払えない」(BSTH08-C06 [3,4])。restrict_reserve_cost_payment と
// 対称の player-scoped CE で、支払いソースからフィールドのカード上コアを除外する。
// ============================================================

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-RFCP-001",
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
  const sourceDef = makeDef({ cardNo: "RFCP-SRC" });
  registerDef(sourceDef);
  const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
  const state = makeState([sourceCard]);

  const effect: Effect = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action }],
  };

  return executeEffect({
    chainId: "test:restrict-field-cost-payment:81",
    state,
    effect,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("ENGINE-restrict-field-cost-payment: restrict_field_cost_payment — CE 登録", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_field_cost_payment アクションで同タグの CE が登録される", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
      effectModes: ["stack"],
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag ===
        ("restrict_field_cost_payment" as ContinuousEffectTag)
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("bob"); // opponent
    expect(ces[0]!.duration.scope).toBe("battle");
    expect(
      (ces[0]!.metadata as { effectModes?: readonly string[] } | undefined)
        ?.effectModes
    ).toEqual(["stack"]);
  });

  it("ログに restrict_field_cost_payment:registered が記録される", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
      effectModes: ["stack"],
    });

    expect(
      result.log.some((l) =>
        l.includes("effect:restrict_field_cost_payment:registered")
      )
    ).toBe(true);
  });
});

describe("ENGINE-restrict-field-cost-payment: isFieldCostPaymentRestricted — CE 消費", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("effectModes:[stack] 指定時、stack 支払いのみ制限され main は制限されない", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
      effectModes: ["stack"],
    });

    expect(isFieldCostPaymentRestricted(result, "bob", "stack")).toBe(true);
    expect(isFieldCostPaymentRestricted(result, "bob", "main")).toBe(false);
    expect(isFieldCostPaymentRestricted(result, "bob", "flash")).toBe(false);
    // effectMode 未指定 (summon 等) も制限対象外。
    expect(isFieldCostPaymentRestricted(result, "bob")).toBe(false);
    // alice (CE 発動者) は制限されない
    expect(isFieldCostPaymentRestricted(result, "alice", "stack")).toBe(false);
  });

  it("effectModes 省略時は全コスト種別が無条件に制限される (restrict_reserve_cost_payment と同じ挙動)", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });

    expect(isFieldCostPaymentRestricted(result, "bob", "stack")).toBe(true);
    expect(isFieldCostPaymentRestricted(result, "bob", "main")).toBe(true);
    expect(isFieldCostPaymentRestricted(result, "bob")).toBe(true);
  });

  it("CE が無いとき isFieldCostPaymentRestricted が false", () => {
    const state = makeState([]);
    expect(isFieldCostPaymentRestricted(state, "bob", "stack")).toBe(false);
  });

  it("CE は player-scoped のため recomputeContinuousEffects を跨いでも除去されない", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
      effectModes: ["stack"],
    });

    const recomputed = recomputeContinuousEffects(result);
    const ce = recomputed.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_field_cost_payment"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe("bob");
    expect(isFieldCostPaymentRestricted(recomputed, "bob", "stack")).toBe(true);
  });
});

describe("ENGINE-restrict-field-cost-payment: getAvailableCardCostPaymentSources 消費 (支払いソース除外)", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("stack コスト制限中はフィールドのカード上コアが支払いソースから除外され、リザーブは引き続き使える", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
      effectModes: ["stack"],
    });
    const bobFieldDef = makeDef({ cardNo: "RFCP-FIELD" });
    registerDef(bobFieldDef);
    const bobFieldCard = makeInstance(bobFieldDef, {
      instanceId: "bob-field-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const withField: GameState = {
      ...result,
      cardInstances: [...result.cardInstances, bobFieldCard],
      players: result.players.map((p) =>
        p.id === "bob" ? { ...p, reserveNormalCoreCount: 5 } : p
      ),
    };

    const targetDef = makeDef({ cardNo: "RFCP-PAY-TARGET", cost: 3 });
    const stackSources = getAvailableCardCostPaymentSources({
      state: withField,
      actingPlayerId: "bob",
      card: targetDef,
      getCardDefinitionById: getDef,
      effectMode: "stack",
    });

    expect(stackSources.onBoardCoreSources).toHaveLength(0);
    expect(stackSources.reserveSource.availableCoreAmount).toBe(5);

    // main コストは制限対象外 (effectModes:["stack"]) のためフィールドのコアが使える。
    const mainSources = getAvailableCardCostPaymentSources({
      state: withField,
      actingPlayerId: "bob",
      card: targetDef,
      getCardDefinitionById: getDef,
      effectMode: "main",
    });
    expect(mainSources.onBoardCoreSources.length).toBeGreaterThan(0);
  });

  it("制限されていないプレイヤー (alice) はフィールドのコアを通常どおり支払いソースに使える", () => {
    const result = runEffect({
      kind: "restrict_field_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
      effectModes: ["stack"],
    });
    const aliceFieldDef = makeDef({ cardNo: "RFCP-FIELD-2" });
    registerDef(aliceFieldDef);
    const aliceFieldCard = makeInstance(aliceFieldDef, {
      instanceId: "alice-field-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const withField: GameState = {
      ...result,
      cardInstances: [...result.cardInstances, aliceFieldCard],
    };

    const targetDef = makeDef({ cardNo: "RFCP-PAY-TARGET-2", cost: 3 });
    const sources = getAvailableCardCostPaymentSources({
      state: withField,
      actingPlayerId: "alice",
      card: targetDef,
      getCardDefinitionById: getDef,
      effectMode: "stack",
    });

    expect(sources.onBoardCoreSources.length).toBeGreaterThan(0);
  });
});

describe("ENGINE-restrict-field-cost-payment: didNonCardActionChangeState 配線", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_field_cost_payment step の CE 登録成功が stepSucceeded=true として後続 ref_succeeded step へ伝播する", () => {
    const sourceDef = makeDef({ cardNo: "RFCP-SRC-2" });
    registerDef(sourceDef);
    const sourceCard = makeInstance(sourceDef, { instanceId: "src-2" });
    const state = makeState([sourceCard]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "restrict-step",
          action: {
            kind: "restrict_field_cost_payment",
            player: "opponent",
            duration: { scope: "battle" },
            effectModes: ["stack"],
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
      chainId: "test:restrict-field-cost-payment:307",
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
