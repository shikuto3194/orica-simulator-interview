import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveBp,
  getEffectiveLevel,
  recomputeBattleEntityBp,
  type CardDefinition,
  type GameState,
} from "../src";
import type { Action, Effect } from "../src/dsl-types";

const kenshin = ALL_CARDS.find((card) => card.cardNo === "BSRK01-R03")!;
const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);

function setup(
  definition: CardDefinition = kenshin,
  countValue = 2
): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue }, {}],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "kenshin",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      }),
      createCardInstance(getDef("BSTH04-X03")!, {
        instanceId: "komachi",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
}

function apply(
  state: GameState,
  action: Effect["steps"][number]["action"]
): GameState {
  return executeEffect({
    chainId: "test:bsrk01-r03-level-bp:46",
    state,
    actingPlayerId: "bob",
    sourceInstanceId: "komachi",
    getCardDefinitionById: getDef,
    targetInstanceIds: ["kenshin"],
    getRegisteredTriggeredEffectActions: () => [],
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action }],
    },
  });
}

const target = {
  kind: "filter" as const,
  player: "opponent" as const,
  filter: { category: ["spirit" as const] },
  count: 1,
};

describe("BSRK01-R03 Lv/BP and OC correction", () => {
  it("印字Lv1(1)=5000/Lv2(3)=9000・OC2+=3000を登録する", () => {
    expect(kenshin.levelDefs).toEqual([
      { level: 1, requiredCores: 1, bp: 5000 },
      { level: 2, requiredCores: 3, bp: 9000 },
    ]);
    expect(kenshin.printedOverCount).toEqual({ minCount: 2, bpBonus: 3000 });
    expect(kenshin.overCount).toEqual(kenshin.printedOverCount);
    expect(kenshin.textLines).toContain("【OC条件：カウント2以上】");
    expect(kenshin.effects![1]!.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 2,
    });
  });

  it.each([1, 2])(
    "カウント%i: BP-5000後にLvコスト+2するとLv1のBPへ追従する",
    (count) => {
      let state = setup(kenshin, count);
      const card = state.cardInstances[0]!;
      const bonus = count >= 2 ? 3000 : 0;
      expect(getEffectiveLevel(state, card, kenshin, getDef)).toBe(2);
      expect(getEffectiveBp(state, card, kenshin, getDef)).toBe(9000 + bonus);
      state = apply(state, {
        kind: "bp_modify",
        target,
        amount: -5000,
        duration: { scope: "turn" },
      });
      expect(getEffectiveBp(state, card, kenshin, getDef)).toBe(4000 + bonus);
      state = apply(state, {
        kind: "override_properties",
        target,
        properties: { levelCostDelta: 2 },
        duration: { scope: "turn" },
      });
      expect(getEffectiveLevel(state, card, kenshin, getDef)).toBe(1);
      expect(getEffectiveBp(state, card, kenshin, getDef)).toBe(bonus);
      state = recomputeBattleEntityBp(
        {
          ...state,
          battleEntities: [
            {
              entityId: "kenshin-entity",
              memberInstanceIds: [card.instanceId],
              attackState: "idle",
              resolvedBp: 4000 + bonus,
              resolvedSymbols: ["red"],
            },
          ],
        },
        getDef
      );
      expect(state.battleEntities[0]!.resolvedBp).toBe(bonus);
    }
  );

  it.each([
    { levelCostDelta: 2 },
    { levelCost: { lv2: 5 } },
    { level: { delta: -1 } },
  ] satisfies Extract<Action, { kind: "override_properties" }>["properties"][])(
    "Lv変更%jは印字/上書き/転神BPすべてに反映する",
    (properties) => {
      for (const mode of ["printed", "override", "divine"] as const) {
        let state = setup(kenshin, 0);
        if (mode === "override")
          state = apply(state, {
            kind: "override_properties",
            target,
            properties: { bp: { lv1: 6000, lv2: 10000 } },
            duration: { scope: "turn" },
          });
        if (mode === "divine")
          state.cardInstances[0]!.divineTransformState = {
            bpByLevel: [
              { level: 1, bp: 6000 },
              { level: 2, bp: 10000 },
            ],
            protectedFromNonGrandwalker: false,
          };
        state = apply(state, {
          kind: "override_properties",
          target,
          properties,
          duration: { scope: "turn" },
        });
        const card = state.cardInstances[0]!;
        expect(getEffectiveLevel(state, card, kenshin, getDef)).toBe(1);
        expect(getEffectiveBp(state, card, kenshin, getDef)).toBe(
          mode === "printed" ? 5000 : 6000
        );
      }
    }
  );
});
