/**
 * BSTH02.7-X01 ゴリアテ人形 effects[2] 配線検証。
 *
 * 原文 textLines[5,6]:
 *   "Lv2-Lv3『このスピリットのアタック時』
 *    〔ターンに1回:同名〕自分のカウント1以上のとき、手札/手元/トラッシュの系統:「動玩」を
 *    持つカード2枚までをコストを支払わずに召喚できる。"
 *
 * 既存 stub は steps:[] の no-op だった。BSSA01-X02 effects[1] と同型の
 *   summon{from_zone:[hand,set_aside,trash], filter:tribes 動玩, count:{min:0,max:2}, costModifier:"free"}
 * + executionMode:"optional" + condition:[min_level:2, count_value≥1] + usageLimit:per_card_name turn
 * へ配線したことを shape level で固定する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

describe("BSTH02.7-X01 effects[3] 動玩カード2枚まで無コスト召喚", () => {
  const def = card("BSTH02.7-X01");
  // effects[0] (rebirth) / effects[1] (leave_field) の手札トリガー分割実装 (2026-07-07)
  // により旧 effects[2] は effects[3] へシフト。
  const effect = def.effects![3]!;

  it("timing: card_event attack / Lv2 + count≥1 / per_card_name turn / 任意", () => {
    expect(effect.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "count_value", player: "self", min: 1 },
    ]);
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  it("steps[0] = summon free / from [hand, set_aside, trash] / tribes 動玩 / 0..2", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(1);
    const step0 = effect.steps[0]!;
    const action = step0.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.costModifier).toBe("free");
      expect(action.target.kind).toBe("from_zone");
      if (action.target.kind === "from_zone") {
        expect(action.target.zone).toEqual(["hand", "set_aside", "trash"]);
        expect(action.target.filter?.tribes).toEqual(["動玩"]);
        expect(action.target.count).toEqual({ min: 0, max: 2 });
      }
    }
  });

  it("textRef を保持し stub なし", () => {
    expect(effect.textRef).toEqual([5, 6]);
    expect(effect.stub).toBeUndefined();
  });
});
