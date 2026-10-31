/**
 * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step 1:
 * `cost_modify.modifier.additionalCostValue` を Amount (number | DynamicCount) へ拡張し、
 * 新規 DynamicCountSource `step_numeric_amount` で同一 effect 内の前段
 * `count_decrease`/`count_increase` step の解決済み量を後続 step から参照できるようにする
 * (BSGE01-M02【荒天：スプレッド】「自分のカウントを好きなだけ減らせる。そうしたとき、
 * 減らしたカウント1につき、相手の手札/手元のカードのコストを+1する」の土台)。
 *
 * このステップでは「count_decrease で減らした量を後段 cost_modify の additionalCostValue に
 * そのまま渡す」プリミティブのみを検証する。プレイヤーが「好きなだけ」を選ぶ pending UI /
 * BSGE01-M02 card-data 配線は後続ステップで行う。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getApplicableAdditionalCostDelta } from "../src/card/card-filter";
import { getAvailableMagicPaymentSources } from "../src/mechanics/magic-system";
import type { CardDefinition, Effect, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "紅魔",
  };
}

function magicDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "神喰",
  };
}

// count_decrease(amount:2) → cost_modify(player:opponent, additionalCostValue:
// {source: step_numeric_amount, stepId:"dec"}) の合成 effect。
function buildEffect(): Effect {
  return {
    timing: { kind: "continuous" },
    steps: [
      {
        id: "dec",
        action: {
          kind: "count_decrease",
          player: "self",
          amount: 2,
        },
      },
      {
        action: {
          kind: "cost_modify",
          player: "opponent",
          cardFilter: { category: ["magic"] },
          modifier: {
            additionalCostValue: {
              source: { kind: "step_numeric_amount", stepId: "dec" },
            },
          },
          duration: { scope: "turn" },
        },
        connector: "simultaneous",
      },
    ],
  } as unknown as Effect;
}

describe("cost_modify additionalCostValue (Amount/DynamicCount 対応)", () => {
  it("registers an additional_cost CE whose amount equals the referenced count_decrease step's resolved amount", () => {
    const source = spiritDef("SOURCE-DYNAMIC-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ countValue: 3 }, { countValue: 0 }],
      }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-value-dynamic-amount:109",
      state,
      effect: buildEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.players.find((p) => p.id === ALICE)?.countValue).toBe(1);
    const ce = next.activeContinuousEffects.find(
      (c) => c.modifierTag === "additional_cost"
    );
    expect(ce).toBeDefined();
    expect(ce!.modifierAmount).toBe(2);
    expect(ce!.targetFilter).toMatchObject({
      player: "opponent",
      category: ["magic"],
    });
  });

  it("reflects the dynamic +2 raise in the opponent's magic cost calculation (3 -> 5)", () => {
    const source = spiritDef("SOURCE-DYNAMIC-COST-MODIFY");
    const magic = magicDef("OPPONENT-MAGIC");
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ countValue: 3 }, { countValue: 0 }],
      }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: BOB,
          zone: "hand",
        }),
      ],
    };

    state = executeEffect({
      chainId: "test:cost-modify-additional-cost-value-dynamic-amount:154",
      state,
      effect: buildEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : id === magic.cardNo ? magic : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const delta = getApplicableAdditionalCostDelta(state, BOB, magic);
    expect(delta).toBe(2);

    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: BOB,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.reduction.finalCost).toBe(5);
  });

  it("still supports a plain literal number additionalCostValue (backward compatibility)", () => {
    const source = spiritDef("SOURCE-LITERAL-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-1",
          ownerPlayerId: ALICE,
          zone: "field",
        }),
      ],
    };

    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"] },
            modifier: { additionalCostValue: -1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-value-dynamic-amount:204",
      state,
      effect,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const ce = next.activeContinuousEffects.find(
      (c) => c.modifierTag === "additional_cost"
    );
    expect(ce!.modifierAmount).toBe(-1);
  });
});
