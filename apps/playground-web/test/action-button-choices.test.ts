import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionButtonChoices } from "../src/components/ActionButtonChoices";
import { divineSkillChoiceText } from "../src/utils/field-effect-choice";
import {
  assertUniqueActionButtonLabels,
  distinguishActionButtonChoices,
  groupActionButtonChoices,
} from "../src/utils/action-button-choices";

describe("同一画面・効果元の同文言ボタン禁止", () => {
  it("同じ印字行の3個/4個分岐も、選択した支払いの本文で識別する", () => {
    const text =
      "〔3個/4個〕3個置いたとき、1枚ドローする。4個置いたとき、1体を回復する。";
    expect(divineSkillChoiceText(text, 3)).toBe("1枚ドローする。");
    expect(divineSkillChoiceText(text, 4)).toBe("1体を回復する。");
    expect(divineSkillChoiceText("1体を回復する。", 4)).toBe("1体を回復する。");
  });
  const make = (key: string, sourceId = "source", label = "神技発揮") => ({
    key,
    sourceId,
    label,
    onClick: vi.fn(),
  });
  it("重複の直接描画は不変条件違反になる", () => {
    expect(() =>
      assertUniqueActionButtonLabels([make("a"), make("b")])
    ).toThrow("Duplicate action button");
    expect(() =>
      assertUniqueActionButtonLabels([make("a"), make("b", "other")])
    ).not.toThrow();
  });
  it("入口は1つ、2つの効果はどちらも保持し、入口表示では宣言しない", () => {
    const choices = [make("skill-2"), make("skill-4")];
    expect(groupActionButtonChoices(choices)).toEqual([choices]);
    const html = renderToStaticMarkup(
      React.createElement(ActionButtonChoices, { choices })
    );
    expect(html.match(/>神技発揮<\/button>/g)).toHaveLength(1);
    choices.forEach((choice) => expect(choice.onClick).not.toHaveBeenCalled());
    const options = distinguishActionButtonChoices(
      choices.map((choice, i) => ({
        ...choice,
        description: `${i + 1}枚ドローする`,
      }))
    );
    expect(options.map((option) => option.label)).toEqual([
      "1枚ドローする",
      "2枚ドローする",
    ]);
    options[1]!.onClick();
    expect(choices[1]!.onClick).toHaveBeenCalledOnce();
    expect(choices[0]!.onClick).not.toHaveBeenCalled();
  });
  it("同じ本文の別効果や、追加した識別文言との衝突でもボタンは重複しない", () => {
    const choices = [
      make("a"),
      make("b"),
      make("c", "source", "神技発揮（選択肢1）"),
    ];
    const options = distinguishActionButtonChoices(choices);
    expect(() => assertUniqueActionButtonLabels(options)).not.toThrow();
    expect(options).toHaveLength(3);
  });
});
