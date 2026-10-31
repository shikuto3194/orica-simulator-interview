import { describe, expect, it } from "vitest";
import type { Effect } from "../src/dsl-types";
import { deriveTriggerPhrasesFromTextRefs } from "../src/effect/effect-label-utils";

describe("印字された複合タイミングの正規トリガー句", () => {
  const cases: [string, string[]][] = [
    ["召喚/アタック時", ["召喚時", "アタック時"]],
    ["召喚/契約合体時", ["召喚時", "契約合体時"]],
    ["契約合体/アタック時", ["契約合体時", "アタック時"]],
    ["アタック/ブロック時", ["アタック時", "ブロック時"]],
    ["召喚/契約合体/アタック時", ["召喚時", "契約合体時", "アタック時"]],
    ["ブロック/召喚時", ["召喚時", "ブロック時"]],
    ...[
      "召喚時",
      "契約合体時",
      "配置時",
      "アタック時",
      "ブロック時",
      "バトル終了",
    ].map((s): [string, string[]] => [s, [s]]),
  ];
  for (const slash of ["/", "／"]) {
    it.each(cases)(
      `%s (${slash})をheadingと本文参照から抽出する`,
      (timing, expected) => {
        const heading = `Lv1-Lv2『このスピリット/ブレイヴの${timing.replaceAll("/", slash)}』`;
        const effect: Effect = {
          timing: { kind: "card_event", event: "summon" },
          steps: [],
        };
        expect(
          deriveTriggerPhrasesFromTextRefs({ ...effect, heading }, undefined)
        ).toEqual(expected);
        expect(
          deriveTriggerPhrasesFromTextRefs({ ...effect, textRef: [1] }, [
            heading,
            "1枚ドローする。",
          ])
        ).toEqual(expected);
        expect(
          deriveTriggerPhrasesFromTextRefs(
            { ...effect, heading, textRef: [0, 1] },
            [heading, "1枚ドローする。"]
          )
        ).toEqual(expected);
      }
    );
  }
  it("対象種別のスラッシュや本文にある単なる召喚からタイミングを生成しない", () => {
    const effect: Effect = { timing: { kind: "continuous" }, steps: [] };
    expect(deriveTriggerPhrasesFromTextRefs(effect, undefined)).toBeUndefined();
    expect(
      deriveTriggerPhrasesFromTextRefs(
        { ...effect, heading: "スピリット/ブレイヴを召喚する。" },
        undefined
      )
    ).toBeUndefined();
    expect(
      deriveTriggerPhrasesFromTextRefs({ ...effect, textRef: [2] }, [
        "Lv1『このスピリットの召喚時』",
        "",
        "効果を持たない。",
      ])
    ).toBeUndefined();
  });
});
