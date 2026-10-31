import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  createStepExecutionContext,
  recordStepResult,
} from "../src/step-execution-context";
import { resolveAmount } from "../src/effect/target-resolution";
import type { CardDefinition, GameState } from "../src/model";
import type { DynamicCount } from "../src/dsl-types";

// engine-drain 4 GAP B: DynamicCount.divisor（端数切捨 floor 除算）
//
// 適用順: value = floor((baseCount * multiplier) / divisor) * groupMultiplier + offset。
// 「N個につき1体」「破壊数÷2(端数切捨)」を表現する。

const ALICE = "player-1";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-DCD-001",
    name: "DCD Test Card",
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

// eventAmount を base にして DynamicCount を解決するヘルパー。
function resolveWithEventAmount(dc: DynamicCount, eventAmount: number): number {
  const state = createEmptyGameState();
  const ctx = createStepExecutionContext(state);
  ctx.eventAmount = eventAmount;
  return resolveAmount(dc, state, ALICE, ctx, getCardDef);
}

describe("engine-drain 4: DynamicCount.divisor (floor division)", () => {
  it("base 5 / divisor 2 → floor(5/2) = 2", () => {
    const dc: DynamicCount = { source: { kind: "event_amount" }, divisor: 2 };
    expect(resolveWithEventAmount(dc, 5)).toBe(2);
  });

  it("base 6 / divisor 2 → floor(6/2) = 3", () => {
    const dc: DynamicCount = { source: { kind: "event_amount" }, divisor: 2 };
    expect(resolveWithEventAmount(dc, 6)).toBe(3);
  });

  it("base 7 / divisor 3 → floor(7/3) = 2（端数切捨確認）", () => {
    const dc: DynamicCount = { source: { kind: "event_amount" }, divisor: 3 };
    expect(resolveWithEventAmount(dc, 7)).toBe(2);
  });

  it("multiplier + divisor + offset を順に適用: floor((6*2)/4)+1 = 4", () => {
    // floor((6 * 2) / 4) + 1 = floor(12/4) + 1 = 3 + 1 = 4
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      multiplier: 2,
      divisor: 4,
      offset: 1,
    };
    expect(resolveWithEventAmount(dc, 6)).toBe(4);
  });

  it("groupMultiplier は floor 除算後に掛ける: 13件を7件につき3 → 3", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      divisor: 7,
      groupMultiplier: 3,
    };
    expect(resolveWithEventAmount(dc, 13)).toBe(3);
    expect(resolveWithEventAmount(dc, 14)).toBe(6);
  });

  it("floor は offset の前に適用される: floor((5*1)/2)+10 = 12（(5/2)+10 の切上ではない）", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      divisor: 2,
      offset: 10,
    };
    // floor(5/2)+10 = 2+10 = 12。 floor((5+offset*divisor)/divisor) 等の別順序なら異なる値になる。
    expect(resolveWithEventAmount(dc, 5)).toBe(12);
  });

  it("divisor 未指定は従来どおり base*multiplier+offset（回帰防止）", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      multiplier: 3,
      offset: 2,
    };
    // 4*3+2 = 14
    expect(resolveWithEventAmount(dc, 4)).toBe(14);
  });

  it("divisor=1 は no-op（base*multiplier+offset と一致）", () => {
    const dc: DynamicCount = {
      source: { kind: "event_amount" },
      multiplier: 3,
      divisor: 1,
      offset: 2,
    };
    expect(resolveWithEventAmount(dc, 4)).toBe(14);
  });

  it("cards_in_zone を base にした floor 除算: 手札5枚 / divisor 2 → 2", () => {
    const handCards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(dummyDef(), {
        instanceId: `a-h-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const state: GameState = createEmptyGameState({
      cardInstances: handCards,
      playerOverrides: [{ handCount: 5 }, {}],
    });
    const ctx = createStepExecutionContext(state);
    const dc: DynamicCount = {
      source: { kind: "cards_in_zone", zone: "hand", player: "self" },
      divisor: 2,
    };
    expect(resolveAmount(dc, state, ALICE, ctx, getCardDef)).toBe(2);
  });

  it("cards_from_ref(leftFieldKind) は記録だけでなく最終的に field を離れた参照カードだけ数える", () => {
    const stayed = createCardInstance(dummyDef(), {
      instanceId: "stayed",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const left = createCardInstance(dummyDef(), {
      instanceId: "left",
      ownerPlayerId: ALICE,
      zone: "trash",
      cores: 0,
    });
    const state = createEmptyGameState({
      cardInstances: [stayed, left],
    });
    const ctx = createStepExecutionContext(state);
    recordStepResult(ctx, {
      stepId: "drain",
      affectedCardInstanceIds: [stayed.instanceId, left.instanceId],
      leftFieldKindsByCardId: {
        [stayed.instanceId]: "vanish",
        [left.instanceId]: "vanish",
      },
      succeeded: true,
      executed: true,
    });
    const dc: DynamicCount = {
      source: {
        kind: "cards_from_ref",
        stepId: "drain",
        leftFieldKind: "vanish",
      },
    };

    expect(resolveAmount(dc, state, ALICE, ctx, getCardDef)).toBe(1);
  });
});
