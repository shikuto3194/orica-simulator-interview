import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
} from "../src";
import {
  CARD_COLORS,
  type CardDefinition,
  type SymbolColor,
} from "../src/model";

function reduce(
  requests: SymbolColor[],
  supplies: SymbolColor[],
  effects: CardDefinition["effects"] = []
) {
  const base = ALL_CARDS.find((card) => card.printedCategory === "nexus")!;
  const card: CardDefinition = {
    ...base,
    cost: 8,
    reductionSymbols: requests,
    effects,
  };
  const definitions = supplies.map(
    (color, i): CardDefinition => ({
      ...base,
      cardNo: `supply-${i}`,
      symbolColors: [color],
      effects: [],
    })
  );
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: definitions.map((definition, i) =>
      createCardInstance(definition, {
        instanceId: `instance-${i}`,
        ownerPlayerId: "alice",
        zone: "field",
      })
    ),
  });
  return calculateReduction({
    state,
    actingPlayerId: "alice",
    card,
    getCardDefinitionById: (id) =>
      definitions.find((definition) => definition.cardNo === id),
  });
}

describe("六・七の軽減シンボル", () => {
  for (const request of ["six", "seven"] as const) {
    it.each(CARD_COLORS)(`${request} を %s で軽減する`, (color) => {
      const expected = request === "six" && color === "black" ? 0 : 1;
      const result = reduce([request], [color]);
      expect(result.totalReduction).toBe(expected);
      expect(result.finalCost).toBe(8 - expected);
    });
    it.each(["god", "guide", "ultimate_symbol"] as const)(
      `${request} は %s では軽減しない`,
      (color) => {
        expect(reduce([request], [color]).totalReduction).toBe(0);
      }
    );
    it(`${request} の複数枠に同じシンボルを重複使用しない`, () => {
      expect(reduce([request, request], ["red"]).totalReduction).toBe(1);
      expect(reduce([request, request], ["red", "red"]).totalReduction).toBe(2);
      expect(reduce([request], ["red", "blue"]).totalReduction).toBe(1);
    });
  }
  it("通常色と六・七が競合しても最大軽減になる", () => {
    expect(
      reduce(["seven", "six", "red"], ["red", "blue", "black"]).totalReduction
    ).toBe(3);
  });
  it("実カードの六としても扱う効果を軽減に反映する", () => {
    const effect = ALL_CARDS.find((card) => card.cardNo === "BSSA01-X03")!
      .effects![0]!;
    expect(reduce(["white"], ["blue"], [effect]).totalReduction).toBe(1);
    expect(reduce(["white"], ["black"], [effect]).totalReduction).toBe(0);
  });
  it("効果で追加する七も1枠として扱う", () => {
    const effects: CardDefinition["effects"] = [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["reduction_symbol"],
              asColor: "seven",
              addsReductionSymbol: true,
            },
          },
        ],
      },
    ];
    const result = reduce(["red"], ["red", "black"], effects);
    expect(result.totalReduction).toBe(2);
    expect(result.requiredReductionSymbolCount).toBe(2);
  });
});
