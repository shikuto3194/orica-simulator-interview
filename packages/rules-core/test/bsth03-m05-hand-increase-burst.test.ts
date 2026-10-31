/**
 * BSTH03-M05「[永夜抄]霧雨 魔理沙」effects[0] バースト構造検証。
 *
 * 原文:
 *   【バースト：相手の効果によって相手の手札が増えた後】
 *   このカードをコストを支払わずに召喚する。
 *
 * 検証:
 *   - timing.kind = "burst" / trigger = hand_increase player:"opponent" / cause:["self_effect"]
 *   - summon step は target:self + costModifier:"free" (canonical burst self-summon パターン)
 *   - registration が burstEventKind="hand_increase" whose:"opponent" cause:["self_effect"] に展開される
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  generateBurstRegistrations,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH03-M05 effects[0] バースト構造", () => {
  const card = cardNoMap.get("BSTH03-M05")!;
  it("hand_increase + cause:[self_effect] + summon target:self costModifier:free", () => {
    const e = card.effects![0]!;
    expect(e.stub).toBeUndefined();
    expect(e.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "hand_increase", player: "opponent" },
      cause: ["self_effect"],
    });
    expect(e.steps).toHaveLength(1);
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.costModifier).toBe("free");
    }
  });
});

describe("BSTH03-M05 バースト registration", () => {
  it("hand_increase + whose:opponent + cause:[self_effect] に展開される", () => {
    const def = cardNoMap.get("BSTH03-M05")!;
    const regs = generateBurstRegistrations(def);
    const handIncRegs = regs.filter((r) => r.eventKind === "hand_increase");
    expect(handIncRegs).toHaveLength(1);
    expect(handIncRegs[0]!.whose).toBe("opponent");
    expect(handIncRegs[0]!.cause).toEqual(["self_effect"]);
  });

  it("lookup から呼び出せる (BSTH03-M05 burst effect は実カード登録に存在)", () => {
    const lookup = buildBurstEffectLookup(ALL_CARDS);
    const entries = lookup("BSTH03-M05");
    expect(entries).toBeDefined();
    expect(entries!.some((e) => e.eventKind === "hand_increase")).toBe(true);
  });
});
