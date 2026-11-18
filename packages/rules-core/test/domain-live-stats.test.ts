import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveBp,
  getEffectiveSymbols,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "../src";

const targetDef: CardDefinition = {
  cardNo: "DOMAIN-LIVE-TARGET",
  name: "領域監査対象",
  printedCategory: "spirit",
  colors: ["red", "purple", "green", "white", "yellow"],
  cost: 7,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["white"],
  tribe: "起幻・風神・アシハラ",
  textLines: [],
  keywordTags: [],
  effects: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const definitions = new Map(
  [
    ...ALL_CARDS,
    targetDef,
    { ...targetDef, cardNo: "DOMAIN-NON-TARGET", tribe: "無関係" },
  ].map((c) => [c.cardNo, c])
);
const getDef = (id: string) => definitions.get(id);
const instance = (no: string, id: string, cores: number, owner = "alice") =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });
const rebuild = (state: GameState) =>
  recomputeAndRebuildContinuousEffects(state, getDef);
const cards = [
  ["BSTH04-XX01", ["yellow", "purple"], 1000],
  ["BSTH05-X01", ["white"], 6000],
  ["BSTH08-XX01", ["white", "white", "white"], 1000],
  ["BSTH09.2-XX01", ["white", "red"], 1000],
] as const;

describe("常時領域の対象が増減したときの実効BP・シンボル", () => {
  it.each(cards)(
    "%s は既存対象と後入り対象に同じ修飾を適用し、発揮元離脱で解除する",
    (sourceNo, symbols, bp) => {
      const initial = rebuild({
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance(sourceNo, "source", 10),
            instance(targetDef.cardNo, "first", 1),
          ],
        }),
        activePlayerId: "alice",
        step: "attack",
      });
      const entered = rebuild({
        ...initial,
        cardInstances: [
          ...initial.cardInstances,
          instance(targetDef.cardNo, "late", 1),
          instance(targetDef.cardNo, "opponent", 1, "bob"),
        ],
      });
      const stats = (state: GameState, id: string) => {
        const c = state.cardInstances.find((c) => c.instanceId === id)!;
        return {
          symbols: getEffectiveSymbols(
            state,
            c,
            getDef(c.definitionId)!,
            getDef
          ),
          bp: getEffectiveBp(state, c, getDef(c.definitionId)!, getDef),
        };
      };
      expect(stats(entered, "first")).toEqual({ symbols, bp });
      expect(stats(entered, "late")).toEqual({ symbols, bp });
      expect(stats(entered, "opponent")).toEqual({
        symbols: ["white"],
        bp: 1000,
      });
      const outsideAttack = rebuild({
        ...entered,
        activePlayerId: "bob",
        step: "main",
      });
      expect(stats(outsideAttack, "late")).toEqual(
        sourceNo === "BSTH09.2-XX01"
          ? { symbols, bp }
          : { symbols: ["white"], bp: 1000 }
      );
      const low = rebuild({
        ...entered,
        cardInstances: entered.cardInstances.map((c) =>
          c.instanceId === "source" ? { ...c, normalCoreCount: 0 } : c
        ),
      });
      expect(stats(low, "late")).toEqual({ symbols: ["white"], bp: 1000 });
      const noLongerTarget = rebuild({
        ...entered,
        cardInstances: entered.cardInstances.map((c) =>
          c.instanceId === "late"
            ? { ...c, definitionId: "DOMAIN-NON-TARGET" }
            : c
        ),
      });
      expect(stats(noLongerTarget, "late")).toEqual({
        symbols: ["white"],
        bp: 1000,
      });
      const duplicate = rebuild({
        ...entered,
        cardInstances: [
          ...entered.cardInstances,
          instance(sourceNo, "source-copy", 10),
        ],
      });
      expect(stats(duplicate, "late")).toEqual({
        symbols,
        bp: sourceNo === "BSTH05-X01" ? 11000 : bp,
      });
      const departed = rebuild({
        ...entered,
        cardInstances: entered.cardInstances.map((c) =>
          c.instanceId === "source" ? { ...c, zone: "trash" } : c
        ),
      });
      for (const id of ["first", "late"])
        expect(stats(departed, id)).toEqual({ symbols: ["white"], bp: 1000 });
    }
  );
});
