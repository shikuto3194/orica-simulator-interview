import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectCardFaces,
  collectEffectContainers,
} from "../../../scripts/card-text-accountability-core.mjs";
import type { EffectStep } from "../src";

function hasConditionalCost(steps: readonly EffectStep[]): boolean {
  return steps.some(
    (step) =>
      step.connector === "conditional_cost" ||
      hasConditionalCost(step.choice ?? [])
  );
}

describe("全カード「○○たとき」の双方向コスト誤変換監査", () => {
  const seen = new Set<string>();
  for (const card of ALL_CARDS) {
    for (const { cardNo, face } of collectCardFaces(card)) {
      if (seen.has(cardNo)) continue;
      seen.add(cardNo);
      for (const { path, effects } of collectEffectContainers(face)) {
        effects.forEach((effect, index) => {
          const text = (effect.textRef ?? [])
            .map((line) => face.textLines?.[line] ?? "")
            .join("\n");
          if (!/た(?:とき|時)/.test(text) || text.includes("ことで")) return;
          it(`${cardNo} ${path}[${index}]: 結果条件を「ことで」コストにしない`, () => {
            expect(hasConditionalCost(effect.steps)).toBe(false);
          });
        });
      }
    }
  }
});
