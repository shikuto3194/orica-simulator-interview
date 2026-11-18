import { describe, it, expect } from "vitest";
import { createEmptyGameState } from "../src/factories";
import { createStepExecutionContext } from "../src/step-execution-context";
import { resolveAmount } from "../src/effect/target-resolution";
import type { CardDefinition } from "../src/model";
import type { DynamicCount } from "../src/dsl-types";

// engine-drain: DynamicCount.cap（上限クランプ）
//
// 最終値 (multiplier/divisor/offset 適用後) を min(value, cap) で抑える。
// 「自分のカウント1につき5枚（最大15枚）」= { multiplier:5, cap:15 } 等の印字上限を表す。
// 正源カード: BSTH08-X02（カウント×5・最大15枚）/ BSTH08-X03（カウント×1・最大3体）。

const ALICE = "player-1";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-DCC-001",
    name: "DCC Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

function getCardDef(): CardDefinition {
  return dummyDef();
}

function resolveWithEventAmount(dc: DynamicCount, eventAmount: number): number {
  const state = createEmptyGameState();
  const ctx = createStepExecutionContext(state);
  ctx.eventAmount = eventAmount;
  return resolveAmount(dc, state, ALICE, ctx, getCardDef);
}

describe("DynamicCount.cap (upper clamp)", () => {
  it("cap 未指定は無制限（回帰防止）: 4*5 = 20", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      multiplier: 5,
    };
    expect(resolveWithEventAmount(dc, 4)).toBe(20);
  });

  it("BSTH08-X02 型: カウント4 → 4*5=20 を cap 15 で抑える", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      multiplier: 5,
      cap: 15,
    };
    expect(resolveWithEventAmount(dc, 4)).toBe(15);
  });

  it("cap 未達なら素通り: カウント2 → 2*5=10 ≤ 15", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      multiplier: 5,
      cap: 15,
    };
    expect(resolveWithEventAmount(dc, 2)).toBe(10);
  });

  it("BSTH08-X03 型: カウント1につき1体・最大3体（カウント7→3）", () => {
    const dc: DynamicCount = { source: { kind: "event_amount" }, cap: 3 };
    expect(resolveWithEventAmount(dc, 7)).toBe(3);
  });

  it("ちょうど cap と一致する値はそのまま: カウント3 → 3 (cap 3)", () => {
    const dc: DynamicCount = { source: { kind: "event_amount" }, cap: 3 };
    expect(resolveWithEventAmount(dc, 3)).toBe(3);
  });

  it("divisor/offset 適用後に cap を掛ける: floor((10*1)/2)+1=6 を cap 4 で抑える", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      divisor: 2,
      offset: 1,
      cap: 4,
    };
    expect(resolveWithEventAmount(dc, 10)).toBe(4);
  });
});
