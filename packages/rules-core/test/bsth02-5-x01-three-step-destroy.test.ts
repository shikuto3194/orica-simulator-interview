/**
 * BSTH02.5-X01 伊吹 萃香 effects[2] 検証。
 *
 * 原文: "Lv2-Lv3【三歩壊廃】『このスピリットのアタック時』
 *       ゲーム中に1回、相手のスピリット/アルティメット/ネクサス/創界神ネクサス3つを破壊する。"
 *
 * 「ネクサス/創界神ネクサス」を含むため targetsGrandwalker:true が必要
 * (cf. BSDB01-R01 effects[3] textRef [7,8])。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH02.5-X01 伊吹 萃香 effects[2] 三歩壊廃", () => {
  const suika = cardNoMap.get("BSTH02.5-X01")!;

  it("DSL 形状: destroy filter は spirit/ultimate/nexus + targetsGrandwalker:true", () => {
    const effect = suika.effects![2]!;
    expect(effect.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "game",
    });
    const step = effect.steps[0]!;
    expect(step.action.kind).toBe("destroy");
    const action = step.action as Extract<
      typeof step.action,
      { kind: "destroy" }
    >;
    expect(action.target).toEqual({
      kind: "filter",
      player: "opponent",
      filter: {
        category: ["spirit", "ultimate", "nexus"],
        targetsGrandwalker: true,
      },
      count: 3,
    });
    expect("stub" in effect).toBe(false);
  });
});
