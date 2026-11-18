import { expect, it } from "vitest";
// @ts-expect-error Operational Node module is tested at its public boundary.
import { changedCardContexts } from "../../../scripts/notices/card-context.mjs";

const path = "packages/card-data/src/cards/BSXX01.ts";
const first = `{
  cardNo: "BSXX01-C01", name: "コアを置くカード",
  textLines: ["コア1個を置く。"],
  effects: [{ action: { kind: "core_move", amount: 1 } }]
}`;
const second = `{
  cardNo: "BSXX01-M02", name: "破壊して召喚するカード",
  textLines: ["自分のネクサス1つを破壊することで、召喚する。"],
  effects: [{ action: { kind: "destroy", filter: { category: ["nexus"] } } }]
}`;
it("keeps the changed card identity, printed text and before/after action together without evaluating source", () => {
  const before = `throw new Error("never evaluate"); export const cards = [${first}, ${second}];`;
  const after = before.replace(
    'category: ["nexus"]',
    'category: ["nexus"], grandwalkerKind: "guided"'
  );
  const contexts = changedCardContexts(path, before, after);
  expect(contexts).toHaveLength(1);
  expect(contexts[0]).toMatchObject({
    path,
    cardNo: "BSXX01-M02",
    before: second,
  });
  expect(contexts[0].after).toContain('name: "破壊して召喚するカード"');
  expect(contexts[0].after).toContain('grandwalkerKind: "guided"');
  expect(contexts[0].after).not.toContain("コアを置くカード");
});
it("carries added, removed and nested back-face definitions", () => {
  const face = `{cardNo: "BSXX01-TR01(B)", name: "裏面", textLines: ["効果。"]}`;
  expect(
    changedCardContexts(path, "", `const cards=[${first}, ${face}];`)
  ).toEqual([
    { path, cardNo: "BSXX01-C01", before: "", after: first },
    { path, cardNo: "BSXX01-TR01(B)", before: "", after: face },
  ]);
  expect(changedCardContexts(path, `const cards=[${first}];`, "")).toEqual([
    { path, cardNo: "BSXX01-C01", before: first, after: "" },
  ]);
  const parent = `const cards=[{cardNo: "BSXX01-TR01(A)", name: "表面", backFace: ${face}}];`;
  expect(
    changedCardContexts(path, parent, parent.replace("裏面", "裏面訂正")).map(
      (c: { cardNo: string }) => c.cardNo
    )
  ).toEqual(["BSXX01-TR01(A)", "BSXX01-TR01(B)"]);
});
