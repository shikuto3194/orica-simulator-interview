import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";

describe("カード本文の固定枚数検索", () => {
  for (const card of ALL_CARDS) {
    for (const [effectIndex, effect] of (card.effects ?? []).entries()) {
      function inspect(value: unknown, path: string) {
        if (!value || typeof value !== "object") return;
        const action = value as Record<string, unknown>;
        if (
          action.kind === "search_zone" &&
          typeof action.count === "number" &&
          action.count > 0
        ) {
          it(`${card.cardNo}[${effectIndex}] ${path}: 固定枚数の検索は発揮後の0枚選択を許可しない`, () => {
            expect(action.mandatory).toBe(true);
          });
        }
        for (const [key, child] of Object.entries(action))
          inspect(child, `${path}.${key}`);
      }
      inspect(effect.steps, "steps");
    }
  }
});
