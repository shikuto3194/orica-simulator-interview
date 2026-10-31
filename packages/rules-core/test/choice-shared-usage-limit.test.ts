/**
 * P3-24: choice 変種の usageLimit 共有検証
 *
 * 修正前: getStableEffectLabel が choiceIndex ごとに別ラベル (effect:0:choice:0, effect:0:choice:1) を返し、
 *         「ターンに1回, A or B」のカードが A と B を両方使用できる bug が発生していた。
 * 修正後: getStableEffectLabel は effect:N に統一し、choice 変種は usageLimit を共有する。
 */
import { describe, expect, it } from "vitest";
import { getStableEffectLabel } from "../src/legal/legal-actions-shared";

describe("P3-24: getStableEffectLabel — choice 変種は同一 effect ラベル", () => {
  it("effectIndex のみ → effect:N", () => {
    expect(getStableEffectLabel("triggered", 0, { effectIndex: 2 })).toBe(
      "effect:2"
    );
  });

  it("effectIndex + choiceIndex 0 (デフォルト) → effect:N (choice 部分は無視)", () => {
    expect(
      getStableEffectLabel("triggered", 0, { effectIndex: 2, choiceIndex: 0 })
    ).toBe("effect:2");
  });

  it("effectIndex + choiceIndex 1 (choice 変種) → effect:N (デフォルトと共有)", () => {
    expect(
      getStableEffectLabel("triggered", 0, { effectIndex: 2, choiceIndex: 1 })
    ).toBe("effect:2");
  });

  it("choice 変種同士 (choiceIndex 1 vs 2) も同一ラベル", () => {
    const label1 = getStableEffectLabel("triggered", 0, {
      effectIndex: 5,
      choiceIndex: 1,
    });
    const label2 = getStableEffectLabel("triggered", 0, {
      effectIndex: 5,
      choiceIndex: 2,
    });
    expect(label1).toBe(label2);
    expect(label1).toBe("effect:5");
  });

  it("registration 未指定 → fallback にフォールバック", () => {
    expect(getStableEffectLabel("battle_immediate", 3, undefined)).toBe(
      "battle_immediate:3"
    );
  });
});
