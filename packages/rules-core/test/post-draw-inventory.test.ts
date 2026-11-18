import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { Effect } from "../src";
import {
  collectCardFaces,
  collectEffectContainers,
} from "../../../scripts/card-text-accountability-core.mjs";
import { generateDivineSkillTargetRegistration } from "../src/effect/structured-effect-registrations";

describe("ドロー後の全カード監査", () => {
  it("ドロー後・ドローした後の全印字本文が監査済みである", () => {
    const actual = ALL_CARDS.flatMap(collectCardFaces)
      .flatMap(({ cardNo, face }) =>
        face.textLines.flatMap((text: string, textRef: number) =>
          /ドロー(?:後|した後)/.test(text) ? [{ cardNo, textRef, text }] : []
        )
      )
      .sort(
        (a, b) => a.cardNo.localeCompare(b.cardNo) || a.textRef - b.textRef
      );
    const audited = JSON.parse(
      readFileSync(
        new URL("./fixtures/post-draw-audit.json", import.meta.url),
        "utf8"
      )
    );
    expect(actual).toEqual(audited);
  });

  it("全効果コンテナでドロー後の手札選択を発揮前の対象へ持ち上げない", () => {
    const violations: string[] = [];
    for (const { cardNo, face } of ALL_CARDS.flatMap(collectCardFaces)) {
      for (const { path, effects } of collectEffectContainers(face)) {
        for (const effect of effects as Effect[]) {
          const drawIndex = effect.steps.findIndex((step) =>
            [
              step.action,
              ...(step.choice ?? []).map((choice) => choice.action),
            ].some((action) => action.kind === "draw")
          );
          if (drawIndex < 0) continue;
          // 共通の対象登録抽出を使用し、対象アクション種別の写像を複製しない。
          const registration = generateDivineSkillTargetRegistration([effect]);
          if (!registration) continue;
          for (const variant of registration.choices ?? [registration]) {
            for (const target of variant.targetGroups ?? [variant]) {
              if (!target.candidateTargetZones?.includes("hand")) continue;
              const index = effect.steps.findIndex(
                (step, i) => (step.id ?? `__step_${i}`) === target.targetStepId
              );
              if (index > drawIndex)
                violations.push(`${cardNo}:${path}:${target.targetStepId}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
