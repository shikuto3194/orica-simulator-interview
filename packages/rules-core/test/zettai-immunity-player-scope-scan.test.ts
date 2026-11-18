/**
 * P3-144: card-data 横断スキャン。
 *
 * 原文に「一切の効果を受けない」を含み、対応する effect が `effect_immunity`
 * (カード対象耐性) のものは `sourcePlayerScope: "any"` を持つことを機械検知する
 * (Q7010/Q7065/Q25555 裁定: 自分の効果も止める)。
 *
 * 「この効果は一切の効果を受けない」（効果対象、`effect_resistance` + `source:"all"`。
 * BSTH03-X01/X04 が該当）は別軸のため除外する。
 *
 * 対応 effect が存在しない (textRef で紐付く effect_immunity が無い) カードは、
 * これ自体が別種の未実装ギャップであり本 issue のスコープ外のため対象外とする
 * (発見時は needs-dsl/issue へ別途記録する)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const CARD_TARGET_PHRASE = "一切の効果を受けない";
const EFFECT_TARGET_PREFIX_RE = /この効果は一切の効果を受けない/;

describe("card-data 横断: 「トラッシュ/手札にあるこのカードは、一切の効果を受けない」→ sourcePlayerScope:any", () => {
  const targets = ALL_CARDS.flatMap((def) => {
    const lines = def.textLines ?? [];
    const matchedIndices = lines
      .map((line, i) => ({ line, i }))
      .filter(
        ({ line }) =>
          line.includes(CARD_TARGET_PHRASE) &&
          !EFFECT_TARGET_PREFIX_RE.test(line)
      )
      .map(({ i }) => i);
    if (matchedIndices.length === 0) return [];
    return matchedIndices.flatMap((textIndex) => {
      const effect = (def.effects ?? []).find(
        (e) =>
          e.textRef?.includes(textIndex) &&
          e.steps.some((s) => s.action.kind === "effect_immunity")
      );
      if (!effect) return [];
      return [{ cardNo: def.cardNo, textIndex, effect }];
    });
  });

  it("スキャン対象が存在する (回帰検知: 対象カードの card-data 構造変化で 0 件になっていないか)", () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  it.each(targets.map((t) => [t.cardNo, t.textIndex, t.effect] as const))(
    "%s (textRef %i): effect_immunity は sourcePlayerScope:'any' を持つ",
    (cardNo, _textIndex, effect) => {
      const action = effect.steps.find(
        (s) => s.action.kind === "effect_immunity"
      )!.action as { sourcePlayerScope?: "opponent" | "self" | "any" };
      expect(
        action.sourcePlayerScope,
        `${cardNo}: 「一切の効果を受けない」は自分の効果も受けない (Q7010/Q7065/Q25555) のため sourcePlayerScope:"any" が必要`
      ).toBe("any");
    }
  );
});
