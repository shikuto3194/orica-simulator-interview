/**
 * FIDELITY: 自己系統宣言行 (「このカードは、系統：「X」/「Y」を持つ。」) は
 * 静的な tribe フィールドが表現する covered 行であり、stub にしない。
 *
 * BSTH03-R02 / R03 / C12 / X04 は effect[0] に当該宣言行の偽陽性 stub を
 * 持っていた。tribe フィールドを def.tribe.split("・") で分割すると
 * 印字どおりの系統を含むため、宣言行は完全表現されている。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

describe("FIDELITY: 自己系統宣言行は tribe フィールドが表現する (stub にしない)", () => {
  it.each([
    ["BSTH03-R02"],
    ["BSTH03-R03"],
    ["BSTH03-C12"],
    ["BSTH03-X04"],
  ] as const)(
    "%s effect[0] (系統宣言行) に偽陽性 stub が残っていない",
    (no) => {
      const c = card(no);
      const decl = (c.effects ?? []).find(
        (e) =>
          typeof e.stub === "string" &&
          (e.stub.includes("tribeフィールドに既に含まれている") ||
            e.stub.includes("系統：幻想/起幻を持つ"))
      );
      expect(decl, `${no} に旧 自己系統宣言 stub が残っている`).toBeUndefined();
    }
  );

  it.each([
    ["BSTH03-R02", ["幻想", "起幻"]],
    ["BSTH03-R03", ["幻想", "起幻"]],
    ["BSTH03-C12", ["幻想"]],
    ["BSTH03-X04", ["起幻"]],
  ] as const)(
    "%s の tribe は宣言行の系統を含む (宣言行が静的データで表現されている)",
    (no, expectedTribes) => {
      const tribes = (card(no).tribe ?? "").split("・");
      for (const expected of expectedTribes) {
        expect(tribes).toContain(expected);
      }
    }
  );
});
