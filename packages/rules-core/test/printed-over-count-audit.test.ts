import { describe, expect, it } from "vitest";
import rawCards from "../../card-data/raw/cardData.js";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getCombinedUnitBp,
  rebuildContinuousEffectsFromField,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => definitions.find((card) => card.cardNo === id);
const printed = new Map<string, { minCount: number; bpBonus: number }>();
function collect(value: unknown) {
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (object.ocBoost) {
    const oc = object.ocBoost as { levelLabel: string; bp: string };
    const front = object.front as Record<string, unknown> | undefined;
    const cardNo = object.cardNumber ?? front?.cardNumber;
    const min = /^OC(\d+)\+$/.exec(oc.levelLabel);
    const bonus = /^\+(\d+)$/.exec(oc.bp);
    if (typeof cardNo !== "string" || !min || !bonus)
      throw new Error("Unrecognized raw OC metadata");
    const expected = { minCount: Number(min[1]), bpBonus: Number(bonus[1]) };
    if (printed.has(cardNo)) expect(printed.get(cardNo)).toEqual(expected);
    printed.set(cardNo, expected);
  }
  Object.values(object).forEach(collect);
}
collect(rawCards);

describe("all printed OC faces: raw source → engine → field BP", () => {
  it("covers all imported front/back faces in both directions", () => {
    expect(printed.size).toBeGreaterThan(0);
    expect(
      definitions
        .filter((d) => d.printedOverCount || d.overCount)
        .map((d) => d.cardNo)
        .sort()
    ).toEqual([...printed.keys()].sort());
  });

  it.each([...printed])(
    "%s: thresholds, every level and controller",
    (cardNo, oc) => {
      const definition = getDef(cardNo)!;
      expect(definition, cardNo).toBeDefined();
      expect(definition.printedOverCount).toEqual(oc);
      expect(definition.overCount).toEqual(oc);
      for (const level of definition.levelDefs) {
        const card = createCardInstance(definition, {
          instanceId: "oc-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: level.requiredCores,
        });
        let state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
          playerOverrides: [{ countValue: 99 }, { countValue: 0 }],
        });
        for (const count of [
          oc.minCount - 1,
          oc.minCount,
          oc.minCount + 1,
          oc.minCount - 1,
        ]) {
          state.players[1]!.countValue = count;
          state = rebuildContinuousEffectsFromField(state, getDef);
          const aura = cardNo === "BSDB01-X01" ? count * 1000 : 0;
          expect(
            getCombinedUnitBp(state, card, definition, getDef),
            `${cardNo} Lv${level.level} C${count}`
          ).toBe(level.bp + aura + (count >= oc.minCount ? oc.bpBonus : 0));
        }
      }
    }
  );

  it("snapshot BSTS01-X02: three cores, count nine = 32000", () => {
    const definition = getDef("BSTS01-X02")!;
    const card = createCardInstance(definition, {
      instanceId: "card-21",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
      playerOverrides: [{ countValue: 9 }, { countValue: 2 }],
    });
    expect(getCombinedUnitBp(state, card, definition, getDef)).toBe(32000);
  });
});
