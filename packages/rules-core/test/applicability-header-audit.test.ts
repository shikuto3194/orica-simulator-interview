import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { auditApplicabilityHeaders } from "../../../scripts/applicability-header-audit.mjs";

describe("全カードの発揮ヘッダーと構造化定義", () => {
  it("魂状態・煌臨元・Lv制限・合体・セット条件の明示を照合する", () => {
    expect(auditApplicabilityHeaders(ALL_CARDS).issues).toEqual([]);
  });
  it("同じ本文の別処理があっても白シンボルの魂状態/煌臨元定義の欠落を見逃さない", () => {
    const card = structuredClone(
      ALL_CARDS.find((c) => c.cardNo === "BSRK01-CX01")!
    );
    card.effects = card.effects!.filter(
      (effect) =>
        !(
          effect.applicability?.zone instanceof Array &&
          effect.applicability.zone.includes("advent_source") &&
          effect.steps.some((step) => step.action.kind === "treat_as")
        )
    );
    expect(auditApplicabilityHeaders([card]).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "advent_source:treat_as" }),
      ])
    );
  });
  it("Lv条件を min_level で定義済みなら重複した applicability を要求しない", () => {
    const card = structuredClone(
      ALL_CARDS.find((c) => c.cardNo === "BSAZ01-C15")!
    );
    expect(auditApplicabilityHeaders([card]).issues).toEqual([]);
    card.effects![1]!.condition = card.effects![1]!.condition!.filter(
      (clause) => clause.kind !== "min_level"
    );
    card.textLines = card.textLines?.map((line) =>
      line.startsWith("Lv2")
        ? `${line} 相手のLv1スピリット。${"長い本文".repeat(30)}`
        : line
    );
    expect(auditApplicabilityHeaders([card]).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "level.min" })])
    );
  });
});
