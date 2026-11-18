import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbolBundles,
  getPrintedSymbolEntries,
  buildStaticCardFeatures,
  type CardDefinition,
  type SymbolColor,
} from "../src";
import { matchesCardFilterByDef } from "../src/card/card-filter";
import {
  getOverriddenProperties,
  getSymbolAdditions,
} from "../src/legal/legal-actions-shared";

const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);

describe("原文の複合印字シンボルは1個", () => {
  for (const [cardNo, color, special] of [
    ["BSTH02.7-CX01", "yellow", "guide"],
    ["BSES01-CX01", "white", "guide"],
    ["BSTH10-X01", "black", "god"],
    ["BSTH10-X03", "black", "god"],
    ["BSTH10-X04", "black", "god"],
    ["BSTH11-X01", "green", "god"],
  ] as const) {
    const card = getDef(cardNo)!;
    function board(count = 1) {
      return createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: Array.from({ length: count }, (_, index) =>
          createCardInstance(card, {
            instanceId: `source-${index}`,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 0,
          })
        ),
      });
    }

    it(`${cardNo}: 色集合・個数・印字フィルタ・AI観測が1個を保持する`, () => {
      const state = board();
      expect(getPrintedSymbolEntries(card)).toEqual([[color, special]]);
      expect(
        getEffectiveSymbolBundles(state, state.cardInstances[0]!, card, getDef)
      ).toEqual([{ colors: [color, special], count: 1 }]);
      expect(matchesCardFilterByDef(card, { printedSymbolCount: 1 })).toBe(
        true
      );
      expect(matchesCardFilterByDef(card, { printedSymbolCount: 2 })).toBe(
        false
      );
      expect(buildStaticCardFeatures(card).printedSymbolEntries).toEqual([
        [color, special],
      ]);
    });

    it(`${cardNo}: 1枚では色と特殊シンボルの軽減を同時に満たさず、2枚なら2軽減`, () => {
      for (const reductionSymbols of [
        [color],
        [special],
        [color, special],
      ] as SymbolColor[][]) {
        const payingCard: CardDefinition = {
          ...card,
          cardNo: "payment",
          cost: 3,
          reductionSymbols,
          effects: [],
        };
        const one = calculateReduction({
          state: board(),
          actingPlayerId: "alice",
          card: payingCard,
          getCardDefinitionById: getDef,
        });
        expect(one.totalReduction).toBe(1);
        expect(one.reducedCost).toBe(2);
        const two = calculateReduction({
          state: board(2),
          actingPlayerId: "alice",
          card: payingCard,
          getCardDefinitionById: getDef,
        });
        expect(two.totalReduction).toBe(reductionSymbols.length);
      }
    });

    it(`${cardNo}: 印字シンボルのコピーとゾーン由来追加も分割しない`, () => {
      const state = board();
      state.activeContinuousEffects.push({
        effectId: "copy",
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        sourceInstanceId: "source-0",
        sourceDefinitionId: cardNo,
        targetInstanceId: "source-0",
        modifierTag: "override_properties",
        metadata: { properties: { symbols: "copy_self" } },
      });
      expect(
        getOverriddenProperties(state, "source-0", getDef)?.symbolColorEntries
      ).toEqual([[color, special]]);
      state.activeContinuousEffects.push({
        effectId: "gain",
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        sourceInstanceId: "source-0",
        sourceDefinitionId: cardNo,
        targetInstanceId: "source-0",
        modifierTag: "symbol_addition",
        modifierSymbolSource: {
          kind: "zone_symbols",
          playerId: "alice",
          zone: "field",
        },
      });
      expect(
        getSymbolAdditions(
          {
            ...state,
            activeContinuousEffects: [...state.activeContinuousEffects],
          },
          "source-0",
          getDef
        )
      ).toEqual([[color, special]]);
    });
  }

  it("従来の黄1・導1は別の2個のまま、取得配列の編集は原文定義へ影響しない", () => {
    const card = { symbolColors: ["yellow", "guide"] as SymbolColor[] };
    expect(getPrintedSymbolEntries(card)).toEqual([["yellow"], ["guide"]]);
    const compound = getDef("BSTH02.7-CX01")!;
    getPrintedSymbolEntries(compound)[0]!.push("red");
    expect(compound.symbolColorEntries).toEqual([["yellow", "guide"]]);
  });
});
