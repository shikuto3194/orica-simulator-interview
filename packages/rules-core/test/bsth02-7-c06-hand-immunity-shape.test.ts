/**
 * BSTH02.7-C06 試験中「レベルティターニア」 effects[0] shape 検証。
 *
 * 効果 [0] = 「手札にあるこのカードは、相手の効果を受けない。」
 *   = applicability.zone:["hand"] + effect_immunity self / duration:permanent
 *
 * SSOT: BSGE01-C16 effects[0] と同型 (applicability.zone:["hand"] +
 *   effect_immunity 自己 permanent)。BSGE01 と同様に、手札ゾーンの continuous
 *   CE は continuous-effect-rebuild の REBUILD_ZONES に含まれないため、現状の
 *   isCardImmuneToOpponentEffect 経路では runtime 上では sleeping (silent)。
 *   def-level の wiring は SSOT と一致させ、engine 側の手札 CE 登録が landing
 *   したときに自動で有効化される。本テストは def-level shape のみ assert する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH02.7-C06 試験中「レベルティターニア」 shape", () => {
  const card = cardNoMap.get("BSTH02.7-C06")!;
  it("印字 (黄マジック・コスト 4)", () => {
    expect(card).toBeDefined();
    expect(card.printedCategory).toBe("magic");
    expect(card.colors).toEqual(["yellow"]);
    expect(card.cost).toBe(4);
  });

  it("effects[0] = applicability.zone:[hand] + effect_immunity self permanent (BSGE01-C16 SSOT 同型)", () => {
    const e0 = card.effects![0]!;
    expect(e0.stub).toBeUndefined();
    expect(e0.timing).toEqual({ kind: "continuous" });
    expect(e0.applicability).toEqual({ zone: ["hand"] });
    expect(e0.steps).toHaveLength(1);
    const action = e0.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.duration).toEqual({ scope: "permanent" });
    }
  });

  it("effects[1] (フラッシュ二択) は stub 解消済み (costModifier:full_reduction 実装)", () => {
    const e1 = card.effects![1]!;
    expect(e1.stub).toBeUndefined();
    expect(e1.timing).toMatchObject({ kind: "activated", mode: "flash" });
  });
});
