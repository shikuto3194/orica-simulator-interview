/** 雨の断章: 両席のマジック枚数で未充足の黄枠だけを満たす。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getEffectiveReductionSymbolEntries,
} from "../src";
import type { CardDefinition, SymbolColor } from "../src";
const M01 = ALL_CARDS.find((c) => c.cardNo === "BSAZ03-M01")!;
const magic: CardDefinition = {
  ...M01,
  cardNo: "TEST-MAGIC",
  effects: [],
  symbolColors: [],
};
function run(
  aliceCount: number,
  bobCount: number,
  symbols: SymbolColor[] = [],
  mixed = false
) {
  const supply: CardDefinition = {
    ...magic,
    cardNo: "TEST-SUPPLY",
    printedCategory: "nexus",
    symbolColors: symbols,
    symbolColorEntries: mixed ? [symbols] : undefined,
  };
  const lookup = (id: string) =>
    [M01, magic, supply].find((c) => c.cardNo === id);
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(M01, {
        instanceId: "paying",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(supply, {
        instanceId: "supply",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      ...[
        ["alice", aliceCount],
        ["bob", bobCount],
      ].flatMap(([owner, count]) =>
        Array.from({ length: Number(count) }, (_, i) =>
          createCardInstance(magic, {
            instanceId: `${owner}-${i}`,
            ownerPlayerId: String(owner),
            zone: "field",
          })
        )
      ),
    ],
  });
  const result = calculateReduction({
    state,
    card: M01,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    sourceInstanceId: "paying",
  });
  expect(
    getEffectiveReductionSymbolEntries(
      M01,
      state,
      "alice",
      lookup,
      "paying",
      "flash"
    )
  ).toHaveLength(6);
  return result;
}
const matrixTitles = [
  [
    "自分0枚・相手0枚は黄3枠までを満たす",
    "自分0枚・相手1枚は黄3枠までを満たす",
    "自分0枚・相手2枚は黄3枠までを満たす",
    "自分0枚・相手3枚は黄3枠までを満たす",
  ],
  [
    "自分1枚・相手0枚は黄3枠までを満たす",
    "自分1枚・相手1枚は黄3枠までを満たす",
    "自分1枚・相手2枚は黄3枠までを満たす",
    "自分1枚・相手3枚は黄3枠までを満たす",
  ],
  [
    "自分2枚・相手0枚は黄3枠までを満たす",
    "自分2枚・相手1枚は黄3枠までを満たす",
    "自分2枚・相手2枚は黄3枠までを満たす",
    "自分2枚・相手3枚は黄3枠までを満たす",
  ],
  [
    "自分3枚・相手0枚は黄3枠までを満たす",
    "自分3枚・相手1枚は黄3枠までを満たす",
    "自分3枚・相手2枚は黄3枠までを満たす",
    "自分3枚・相手3枚は黄3枠までを満たす",
  ],
];

describe("BSAZ03-M01 両席合算と黄枠の上限", () => {
  for (const alice of [0, 1, 2, 3])
    for (const bob of [0, 1, 2, 3]) {
      it(matrixTitles[alice]![bob]!, () => {
        const result = run(alice, bob);
        expect(result.totalReduction).toBe(Math.min(3, alice + bob));
        expect(result.finalCost).toBe(5 - Math.min(3, alice + bob));
      });
    }
  it("通常の黄1・白1と合算し、残る黄2枠だけを免除する", () => {
    const result = run(1, 2, ["yellow", "white"]);
    expect(result.totalReduction).toBe(4);
    expect(result.finalCost).toBe(1);
  });
  it("黄がすべて充足済みなら白枠を免除しない", () => {
    const result = run(2, 3, ["yellow", "yellow", "yellow"]);
    expect(result.totalReduction).toBe(3);
    expect(result.finalCost).toBe(2);
  });
  it("黄白の複合1シンボルを白へ回し、黄3枠の自己充足と合わせて4軽減する", () => {
    const result = run(1, 2, ["yellow", "white"], true);
    expect(result.totalReduction).toBe(4);
    expect(result.finalCost).toBe(1);
    expect(result.fieldSymbolSources[0]!.symbolEntries).toHaveLength(1);
    expect(
      result.reductionBreakdown.find((entry) => entry.color === "white")!
        .applied
    ).toBe(1);
  });

  it("手札破棄の割引は別のcost_modifyとして維持する", () => {
    const action = M01.effects!.flatMap((e) => e.steps)
      .map((s) => s.action)
      .find(
        (a) =>
          a.kind === "cost_modify" && a.useCostPayment?.kind === "discard_hand"
      );
    expect(action).toMatchObject({
      modifier: { additionalCostValue: -1 },
      useCostPayment: { kind: "discard_hand", sourceZone: "hand", maxCount: 5 },
    });
  });
});
