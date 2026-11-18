/**
 * preventionRestriction stale-stub sweep（engine-drain iteration）。
 *
 * 「○○以外では防げない」/「○○を持たない効果では防げない」型は preventionRestriction
 * DSL（onlyPreventableByKeywords / onlyPreventableByTribes / onlyPreventableByCategories）
 * で表現済み。registration は `preventionLevel` ではなく scoped `targetLockBypass` を持ち、
 * 指定スコープに一致しない cannot_* 効果耐性 / defense_immune だけを貫通する
 * （10_rules/04b §効果防止の優先順位 L56-57、dsl-types.ts preventionRestriction）。
 *
 * 本テストは、stale な「防止不可は未表現」stub を抱えていた以下の card-data 移管後の
 * 機械ガード（stub 解消 + registration が scoped bypass に解決）を実装している:
 *  - BSTH05-X04 [0]『召喚時』重疲労（【超重装甲】以外では防げない）
 *  - BSTH05-M02 burst バウンス＋デッキ下＋自己召喚（【超重装甲】以外では防げない）
 *  - BSTH08-C07 [0] burst デッキ下（系統：「起幻」を持たない効果では防げない）
 *  - BSTH08-C06 [0] burst デッキ下＋自己召喚（系統：「起幻」を持たない効果では防げない）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  expandCardDefinitionsWithBackFaces,
  generateTriggeredEffectRegistrations,
  generateBurstRegistrations,
} from "../src/effect/structured-effect-registrations";
import { getEffectPreventionLevel } from "../src/legal/legal-actions-shared";
import type { CardDefinition } from "../src/model";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expanded.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function expectOnlyPreventableByScope(
  reg: { preventionLevel?: unknown; targetLockBypass?: unknown },
  filter: Record<string, unknown>
): void {
  expect(getEffectPreventionLevel(reg)).toBe("none");
  expect(reg.targetLockBypass).toEqual({
    kind: "preventing_effect_filter",
    filter: { ...filter, bypassUnlessMatches: true },
  });
}

describe("BSTH05-X04 御社宮神『召喚時』重疲労: 【超重装甲】以外では防げない", () => {
  const def = card("BSTH05-X04");
  const idx = 0;

  it('card-data: stub 解消＋preventionRestriction.onlyPreventableByKeywords:["超重装甲"]', () => {
    const effect = def.effects![idx]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(effect.preventionRestriction?.onlyPreventableByKeywords).toEqual([
      "超重装甲",
    ]);
  });

  it("triggered registration が scoped targetLockBypass を導出", () => {
    const regs = generateTriggeredEffectRegistrations(def).filter(
      (r) => r.effectIndex === idx
    );
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expectOnlyPreventableByScope(reg, { keywords: ["超重装甲"] });
    }
  });
});

describe("BSTH05-M02 burst: 【超重装甲】以外では防げない（バウンス＋デッキ下＋自己召喚）", () => {
  const def = card("BSTH05-M02");
  // burst timing の effect index を探す（M02 effects[1] が burst）。
  const burstIdx = def.effects!.findIndex((e) => e.timing.kind === "burst");

  it('card-data: stub 解消＋preventionRestriction.onlyPreventableByKeywords:["超重装甲"]', () => {
    expect(burstIdx).toBeGreaterThanOrEqual(0);
    const effect = def.effects![burstIdx]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionRestriction?.onlyPreventableByKeywords).toEqual([
      "超重装甲",
    ]);
    // 元 stub の per-action maxPreventable:0 は撤去済み（effect 全体に preventionRestriction
    // が掛かるため重複表現を避ける）。
    for (const step of effect.steps) {
      const action = step.action as { maxPreventable?: unknown };
      expect(action.maxPreventable).toBeUndefined();
    }
  });

  it("burst registration が scoped targetLockBypass を導出", () => {
    // RegisteredBurstAction には effectIndex が無いため effect 全件で
    // scoped targetLockBypass を期待（このカードの burst は 1 個だけ）。
    const regs = generateBurstRegistrations(def);
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expectOnlyPreventableByScope(reg, { keywords: ["超重装甲"] });
    }
  });
});

describe("BSTH08-C07 burst: 系統：「起幻」を持たない効果では防げない", () => {
  const def = card("BSTH08-C07");
  const burstIdx = def.effects!.findIndex((e) => e.timing.kind === "burst");

  it('card-data: stub 解消＋preventionRestriction.onlyPreventableByTribes:["起幻"]', () => {
    expect(burstIdx).toBeGreaterThanOrEqual(0);
    const effect = def.effects![burstIdx]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionRestriction?.onlyPreventableByTribes).toEqual([
      "起幻",
    ]);
  });

  it("burst registration が scoped targetLockBypass を導出", () => {
    // RegisteredBurstAction には effectIndex が無いため effect 全件で
    // scoped targetLockBypass を期待（このカードの burst は 1 個だけ）。
    const regs = generateBurstRegistrations(def);
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expectOnlyPreventableByScope(reg, { tribes: ["起幻"] });
    }
  });
});

describe("BSTH08-C06 burst: 系統：「起幻」を持たない効果では防げない＋疲労/アタック状態フィルタ", () => {
  const def = card("BSTH08-C06");
  const burstIdx = def.effects!.findIndex((e) => e.timing.kind === "burst");

  it('card-data: stub 解消＋preventionRestriction.onlyPreventableByTribes:["起幻"]', () => {
    expect(burstIdx).toBeGreaterThanOrEqual(0);
    const effect = def.effects![burstIdx]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionRestriction?.onlyPreventableByTribes).toEqual([
      "起幻",
    ]);
  });

  it("対象フィルタが filterOr で「疲労状態 or アタックしている」を表現（category は各枝へ複製）", () => {
    const effect = def.effects![burstIdx]!;
    const sendStep = effect.steps[0]!;
    const action = sendStep.action as {
      kind: string;
      target?: { kind?: string; filter?: { filterOr?: unknown[] } };
    };
    expect(action.kind).toBe("send_to_deck");
    expect(action.target?.kind).toBe("filter");
    const filterOr = action.target?.filter?.filterOr;
    expect(filterOr).toBeDefined();
    expect(filterOr).toEqual([
      { category: ["spirit", "ultimate"], exhaustState: "exhausted" },
      { category: ["spirit", "ultimate"], battleState: "attacking" },
    ]);
  });

  it("『相手によって離れた』を timing.cause:[opponent_effect,battle] で表現", () => {
    const effect = def.effects![burstIdx]!;
    expect(effect.timing.kind).toBe("burst");
    if (effect.timing.kind === "burst") {
      expect(effect.timing.cause).toEqual(["opponent_effect", "battle"]);
    }
  });

  it("burst registration が scoped targetLockBypass を導出", () => {
    // RegisteredBurstAction には effectIndex が無いため effect 全件で
    // scoped targetLockBypass を期待（このカードの burst は 1 個だけ）。
    const regs = generateBurstRegistrations(def);
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expectOnlyPreventableByScope(reg, { tribes: ["起幻"] });
    }
  });
});
