import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const allFaces = ALL_CARDS.flatMap((card) =>
  card.backFace ? [card, card.backFace] : [card]
);
const cardNoMap = new Map(allFaces.map((card) => [card.cardNo, card]));

function countPrintedCostFilters(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countPrintedCostFilters(item), 0);
  }
  if (!value || typeof value !== "object") return 0;

  const record = value as Record<string, unknown>;
  const self =
    record.costBasis === "printed" &&
    (record.minCost !== undefined || record.maxCost !== undefined)
      ? 1
      : 0;
  return (
    self +
    Object.values(record).reduce(
      (sum, item) => sum + countPrintedCostFilters(item),
      0
    )
  );
}

describe("本来のコスト filters use printed cost basis", () => {
  it.each([
    ["BSAZ02-C15", 1],
    ["BSDB01-X02", 1],
    ["BSLH01-X05", 1],
    ["BSSA01-転醒X02(A)", 1],
    ["BSSL01-C04", 1],
    ["BSTH04-XX01", 2],
    ["BSTH07-転醒R01(B)", 1],
    ["BSTH08-XX01", 1],
    ["BSTH09.2-XX01", 1],
    ["BSTS01-X01", 1],
  ])("%s has printed cost-basis filters", (cardNo, expectedCount) => {
    const card = cardNoMap.get(cardNo);
    expect(card, cardNo).toBeDefined();
    expect(countPrintedCostFilters(card!.effects)).toBe(expectedCount);
  });

  it("BSTH09.2-XX01 no longer carries the 本来コスト近似 stub", () => {
    const card = cardNoMap.get("BSTH09.2-XX01")!;
    expect(
      card.effects?.some((effect) => effect.stub?.includes("本来のコスト"))
    ).toBe(false);
  });
});
