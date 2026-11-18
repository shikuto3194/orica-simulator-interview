import { describe, expect, it } from "vitest";
import {
  cardCategoryLabel,
  coreLocationDisplayLabel,
  zoneDisplayLabel,
  type LegalAction,
} from "@orica/rules-core";
import { getActionLabel } from "../src/components/action-ui";
import { describeCardFilter } from "../src/utils/describe-card-filter";

describe("日本語表示のフォールバック", () => {
  it("旧スナップショットの選択肢とマジック使用ラベルを辞書から復元する", () => {
    expect(
      getActionLabel({
        kind: "resolve_pending_step_choice",
        choiceLabel: "unblockable",
      } as LegalAction)
    ).toBe("ブロックされない");
    expect(
      getActionLabel({
        kind: "use_magic",
        timing: "flash",
        choiceLabel: "unblockable",
      } as LegalAction)
    ).toBe("フラッシュを使用（ブロックされない）");
  });
  it("黒とスタック効果を含むフィルタを日本語で表示する", () => {
    expect(
      describeCardFilter(
        {
          colors: ["black"],
          category: ["spirit"],
          hasMechanic: ["stack_effect"],
        },
        1
      )
    ).toBe("黒のスピリットのスタック効果持ち1枚");
  });
  it("カウント・カード上のコアを識別し未知の値も日本語にする", () => {
    expect(zoneDisplayLabel("count_area")).toBe("カウント");
    expect(coreLocationDisplayLabel("card_instance")).toBe("カード");
    expect(zoneDisplayLabel("unknown_zone")).toBe("ゾーン");
    expect(cardCategoryLabel("unknown_category")).toBe("カード");
  });
});
