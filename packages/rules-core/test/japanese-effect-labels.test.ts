import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { getEffectStepChoiceOptions } from "../src/effect/structured-effect-registrations";
import { buildPendingStepPrompt } from "../src/effect/effect-step-prompt";
import {
  EFFECT_ACTION_LABELS,
  effectActionLabel,
  localizeEffectLabel,
} from "../src/effect/action-display";
import type { Action, Effect } from "../src/dsl-types";

describe("効果選択肢の日本語表示", () => {
  it("BSTH01-C21 の未指定ラベルを日本語で自動生成する", () => {
    const card = ALL_CARDS.find((card) => card.cardNo === "BSTH01-C21")!;
    expect(
      getEffectStepChoiceOptions(card.effects![1]!, 0).map((c) => c.label)
    ).toEqual(["ブロックされない", "アタックステップ終了"]);
  });
  it("収録カードの自動選択肢に英語識別子を漏らさない", () => {
    for (const card of expandCardDefinitionsWithBackFaces(ALL_CARDS)) {
      for (const effect of card.effects ?? []) {
        effect.steps.forEach((step, index) => {
          if (!step.choice?.length) return;
          for (const choice of getEffectStepChoiceOptions(effect, index)) {
            expect(
              choice.label,
              `${card.cardNo}: ${step.action.kind}`
            ).not.toMatch(/^[a-z][a-z0-9_]*$/);
          }
        });
      }
    }
  });
  it("辞書に登録した全効果が日本語名を持つ", () => {
    for (const [kind, label] of Object.entries(EFFECT_ACTION_LABELS)) {
      expect(label, kind).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });
  it("保存済み英語ラベルを直し、明示の日本語と固有名詞は保持する", () => {
    expect(localizeEffectLabel("unblockable")).toBe("ブロックされない");
    expect(localizeEffectLabel("future_action")).toBe("効果");
    expect(localizeEffectLabel("手札に戻す（任意）")).toBe(
      "手札に戻す（任意）"
    );
    expect(localizeEffectLabel("ENIGMA")).toBe("ENIGMA");
    expect(effectActionLabel("toString")).toBe("効果");
  });
  it("詳細説明のない効果も辞書から確認文を生成する", () => {
    const action: Action = {
      kind: "unblockable",
      target: { kind: "self" },
      duration: { scope: "turn" },
    };
    expect(buildPendingStepPrompt({ action })).toEqual({
      label: "ブロックされない",
      question: "「ブロックされない」を発揮しますか？",
    });
    expect(
      buildPendingStepPrompt({ action, prompt: { label: "unblockable" } }).label
    ).toBe("ブロックされない");
  });
  it("ドロー位置と明示ラベルで選択肢を区別する", () => {
    const effect = {
      steps: [
        {
          action: { kind: "draw", count: 1, position: "bottom" },
          choice: [
            { action: { kind: "draw", count: 1, position: "top" } },
            { label: "この効果を発揮しない", action: { kind: "noop" } },
          ],
        },
      ],
    } as Effect;
    expect(getEffectStepChoiceOptions(effect, 0).map((c) => c.label)).toEqual([
      "デッキの下からドロー",
      "デッキの上からドロー",
      "この効果を発揮しない",
    ]);
  });
});
