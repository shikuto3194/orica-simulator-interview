import { describe, expect, it } from "vitest";
import {
  formatHudCoreCounts,
  formatHudHeading,
  formatHudText,
  getHudLabels,
  type HudInputs,
} from "../src/coreSelectionVerbs";

/* -------------------- 動詞辞書テスト (Step 2) --------------------
 * 仕様: manual/ai-reference/25_gui/11_core-selection-hud.md
 * 「モード別 表示テンプレ」表に従い、全モード × phase の動詞ラベルを検証する。
 */

const baseCounts = { a: 0, b: 0 } as const;

describe("getHudLabels — モード別 動詞 / 希望文", () => {
  it("card_cost / phase 1 → コストを支払う / 必要 (固定総コスト)", () => {
    // 仕様改訂 (2026-05-06): 固定総コストは「必要 m」(m=固定)。
    // n だけが 0→m に進む単方向表示で進捗を読みやすく。
    const labels = getHudLabels({
      mode: "card_cost",
      phase: 1,
      n: 0,
      m: 4,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コストを支払う");
    expect(labels.hopeVerb).toBe("必要");
    expect(labels.omitN).toBe(false);
  });

  it("shoot / phase 1 → コアの持ち主を決めつけず、固定取得数を表示", () => {
    // 仕様改訂 (2026-05-06): card_cost と同様に「必要 m」(m=固定)。
    const labels = getHudLabels({
      mode: "shoot",
      phase: 1,
      n: 1,
      m: 2,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBe("必要");
    expect(labels.omitN).toBe(false);
  });

  it("placement_single / phase 1 / n<min → コアを置く / 最低", () => {
    const labels = getHudLabels({
      mode: "placement_single",
      phase: 1,
      n: 0,
      m: 1,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBe("最低");
  });

  it("placement_single / phase 1 / n>=min → 希望文省略", () => {
    const labels = getHudLabels({
      mode: "placement_single",
      phase: 1,
      n: 1,
      m: 1,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBeNull();
  });

  it("placement_multi / phase 1 → コアを掴む / 必要", () => {
    const labels = getHudLabels({
      mode: "placement_multi",
      phase: 1,
      n: 0,
      m: 3,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBe("必要");
    expect(labels.omitN).toBe(false);
  });

  it("placement_multi / phase 2 → コアを置く / 残り (omitN)", () => {
    const labels = getHudLabels({
      mode: "placement_multi",
      phase: 2,
      n: 1,
      m: 2,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBe("残り");
    expect(labels.omitN).toBe(true);
  });

  it("separation / phase 1 → コアを掴む / 必要", () => {
    const labels = getHudLabels({
      mode: "separation",
      phase: 1,
      n: 0,
      m: 2,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBe("必要");
  });

  it("separation / phase 2 → コアを置く / 残り (omitN)", () => {
    const labels = getHudLabels({
      mode: "separation",
      phase: 2,
      n: 0,
      m: 2,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBe("残り");
    expect(labels.omitN).toBe(true);
  });

  it("core_move_free / phase 1 → コアを掴む / 任意 (希望文省略)", () => {
    const labels = getHudLabels({
      mode: "core_move_free",
      phase: 1,
      n: 0,
      m: 0,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBeNull();
  });

  it("core_move_fixed / phase 1 → コアを掴む / 必要", () => {
    const labels = getHudLabels({
      mode: "core_move_fixed",
      phase: 1,
      n: 0,
      m: 1,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBe("必要");
  });

  it("core_move (free|fixed) / phase 2 → コアを置く / 残り (omitN)", () => {
    for (const mode of ["core_move_free", "core_move_fixed"] as const) {
      const labels = getHudLabels({
        mode,
        phase: 2,
        n: 0,
        m: 1,
        ...baseCounts,
      });
      expect(labels.actionVerb).toBe("コアを置く");
      expect(labels.hopeVerb).toBe("残り");
      expect(labels.omitN).toBe(true);
    }
  });

  it("trash_distribution / phase 1 → コアを置く / 残り (omitN)", () => {
    const labels = getHudLabels({
      mode: "trash_distribution",
      phase: 1,
      n: 0,
      m: 5,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBe("残り");
    expect(labels.omitN).toBe(true);
  });

  it("core_distribute_any_self / phase 1 → コアを掴む / 必要", () => {
    const labels = getHudLabels({
      mode: "core_distribute_any_self",
      phase: 1,
      n: 0,
      m: 4,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBe("必要");
  });

  it("core_distribute_any_self / phase 2 → コアを置く / 残り (omitN)", () => {
    const labels = getHudLabels({
      mode: "core_distribute_any_self",
      phase: 2,
      n: 0,
      m: 4,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBe("残り");
    expect(labels.omitN).toBe(true);
  });

  it("core_split / phase 1 → コアを置く / 必要", () => {
    const labels = getHudLabels({
      mode: "core_split",
      phase: 1,
      n: 0,
      m: 2,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを置く");
    expect(labels.hopeVerb).toBe("必要");
    expect(labels.omitN).toBe(false);
  });

  it("core_source_allocation / phase 1 → コアを掴む / 必要", () => {
    const labels = getHudLabels({
      mode: "core_source_allocation",
      phase: 1,
      n: 0,
      m: 3,
      ...baseCounts,
    });
    expect(labels.actionVerb).toBe("コアを掴む");
    expect(labels.hopeVerb).toBe("必要");
    expect(labels.omitN).toBe(false);
  });
});

/* -------------------- 表示テンプレートテスト (Step 1) --------------------
 * 「フロート要素レイアウト」と「省略規則」「モード別 表示テンプレ」を実例で確認する。
 */

describe("formatHudHeading / formatHudText — 表示テンプレート", () => {
  it("通常形: 動作文 n / 希望文 m (card_cost: 必要 m が固定)", () => {
    const input: HudInputs = {
      mode: "card_cost",
      phase: 1,
      n: 1,
      m: 4,
      a: 1,
      b: 0,
    };
    expect(formatHudHeading(input)).toBe("コストを支払う 1 / 必要 4");
  });

  it("希望文省略: 動作文 n のみ (core_move 自由)", () => {
    const input: HudInputs = {
      mode: "core_move_free",
      phase: 1,
      n: 2,
      m: 0,
      a: 2,
      b: 0,
    };
    expect(formatHudHeading(input)).toBe("コアを掴む 2");
  });

  it("n / 省略: 動作文 希望文 m (placement_multi phase 2)", () => {
    const input: HudInputs = {
      mode: "placement_multi",
      phase: 2,
      n: 1,
      m: 2,
      a: 1,
      b: 0,
    };
    expect(formatHudHeading(input)).toBe("コアを置く 残り 2");
  });

  it("placement_single: n<min は 最低 m / n>=min は省略", () => {
    expect(
      formatHudHeading({
        mode: "placement_single",
        phase: 1,
        n: 0,
        m: 1,
        a: 0,
        b: 0,
      })
    ).toBe("コアを置く 0 / 最低 1");
    expect(
      formatHudHeading({
        mode: "placement_single",
        phase: 1,
        n: 1,
        m: 1,
        a: 1,
        b: 0,
      })
    ).toBe("コアを置く 1");
  });

  it("formatHudCoreCounts: 通常 / ソウル を併記", () => {
    expect(formatHudCoreCounts(2, 1)).toBe("通常 2 ソウル 1");
    expect(formatHudCoreCounts(0, 0)).toBe("通常 0 ソウル 0");
  });

  it("formatHudText: 主文 - 補足 - を { } で囲む", () => {
    const input: HudInputs = {
      mode: "card_cost",
      phase: 1,
      n: 2,
      m: 4,
      a: 1,
      b: 1,
    };
    expect(formatHudText(input)).toBe(
      "{ コストを支払う 2 / 必要 4 - 通常 1 ソウル 1 - }"
    );
  });
});
