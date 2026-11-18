import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BATTLE_SCREEN_PATH = resolve(
  __dirname,
  "../src/components/BattleScreen.tsx"
);

function pendingEffectChoiceModalSource(): string {
  const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
  const start = src.indexOf("{pendingEffectChoice &&");
  const end = src.indexOf("{displayState.pendingStepOptionalChoice", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("pendingEffectChoice modal", () => {
  it("does not mix the effect-level decline button into choice variant selection", () => {
    const modalSrc = pendingEffectChoiceModalSource();
    expect(modalSrc).not.toContain("pendingEffectChoice.isOptional");
    expect(modalSrc).not.toContain("skipOptionalEffect");
    expect(modalSrc).not.toContain("任意効果をスキップ");
  });

  it("uses choice labels before falling back to full card text", () => {
    const modalSrc = pendingEffectChoiceModalSource();
    const choiceLabelIndex = modalSrc.indexOf("choiceLabels.length > 0");
    const fullTextFallbackIndex = modalSrc.indexOf("def?.textLines?.join");
    expect(choiceLabelIndex).toBeGreaterThanOrEqual(0);
    expect(fullTextFallbackIndex).toBeGreaterThan(choiceLabelIndex);
  });
});
