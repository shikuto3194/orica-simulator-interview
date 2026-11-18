import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src";
import {
  collectCardFaces,
  collectEffectContainers,
} from "../../../scripts/card-text-accountability-core.mjs";
import { shouldDeferConditionalStepChoice } from "../src/effect/structured-effect-registrations";

describe("その後: 全カード監査の対象集合", () => {
  it("新しい本文・変更本文は監査台帳と回帰ケースを更新する", () => {
    const audited = JSON.parse(
      readFileSync(
        new URL("./fixtures/sequential-effect-audit.json", import.meta.url),
        "utf8"
      )
    );
    const current = expandCardDefinitionsWithBackFaces(ALL_CARDS)
      .flatMap((card) =>
        card.textLines.flatMap((text, textRef) =>
          text.includes("その後")
            ? [{ cardNo: card.cardNo, textRef, text }]
            : []
        )
      )
      .sort(
        (a, b) => a.cardNo.localeCompare(b.cardNo) || a.textRef - b.textRef
      );
    expect(current).toEqual(audited);
  });
  it("その後の後段choiceを前段の解決前へ持ち上げない（全コンテナ）", () => {
    for (const { cardNo, face } of ALL_CARDS.flatMap(collectCardFaces)) {
      for (const { path, effects } of collectEffectContainers(face)) {
        for (const effect of effects) {
          if (
            !effect.textRef?.some((index) =>
              face.textLines[index]?.includes("その後")
            )
          )
            continue;
          effect.steps.forEach((step, index) => {
            if (
              index > 0 &&
              step.choice?.length &&
              step.connector === "sequential"
            )
              expect(
                shouldDeferConditionalStepChoice(effect, index),
                `${cardNo}:${path}:${index}`
              ).toBe(true);
          });
        }
      }
    }
  });
});
