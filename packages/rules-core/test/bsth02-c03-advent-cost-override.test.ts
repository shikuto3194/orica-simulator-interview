/**
 * BSTH02-C03 橙 Lv2:「系統：「幻想」と「妖戒」を持つコスト4以下のスピリットすべては、
 * 自分が【煌臨】するとき、コスト5としても扱う」。
 *
 * advent_cost_override (新 ContinuousEffectTag) = AdventCondition.minCost 判定にのみ
 * 影響する対象限定の実効コスト付与。additional_cost (自分自身・全コスト判定に影響) と
 * 異なり、target filter で自分以外のカード群にも付与できる。
 *
 * P3-105後判定 audit-open BSTH02-C03 effects[1]（needs-dsl.audit.jsonl）を配線。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import { matchesAdventCondition } from "../src/mechanics/advent-system";
import type { AdventCondition, CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const orange = cardNoMap.get("BSTH02-C03")!;

// tribe: 幻想・妖戒 ではないコスト4以下のスピリット（フィルタ不一致の対照用）。
const otherSpiritDef: CardDefinition = {
  cardNo: "TEST-OTHER-SPIRIT",
  name: "Test Other Spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "A" as const,
};
cardNoMap.set(otherSpiritDef.cardNo, otherSpiritDef);

function buildState(orangeCores: number): GameState {
  const base = createEmptyGameState({
    cardInstances: [
      createCardInstance(orange, {
        instanceId: "orange-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: orangeCores,
      }),
      createCardInstance(otherSpiritDef, {
        instanceId: "other-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  return { ...base, activePlayerId: "alice", step: "main" };
}

const minCost5Condition: AdventCondition = {
  minCost: 5,
  targetCategory: ["spirit"],
};

describe("BSTH02-C03 Lv2: advent_cost_override", () => {
  it("カードデータに存在し、effects[1] の stub が消えている", () => {
    expect(orange).toBeDefined();
    expect(orange.effects).toHaveLength(2);
    expect(orange.effects![1]!.stub).toBeUndefined();
  });

  it("Lv2 (2コア) で advent_cost_override CE が登録される", () => {
    const state = buildState(2);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const ces = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "advent_cost_override"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.modifierAmount).toBe(5);
    expect(ces[0]!.targetFilter).toMatchObject({
      player: "self",
      category: ["spirit"],
      tribes: ["幻想", "妖戒"],
      tribesLogic: "and",
      maxCost: 4,
    });
  });

  it("Lv1 (1コア) では advent_cost_override CE が登録されない", () => {
    const state = buildState(1);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const ces = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "advent_cost_override"
    );
    expect(ces).toHaveLength(0);
  });

  it("Lv2 時、橙自身 (コスト3・幻想&妖戒) がコスト5以上煌臨条件を満たすようになる", () => {
    const state = buildState(2);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const orangeCard = rebuilt.cardInstances.find(
      (c) => c.instanceId === "orange-1"
    )!;
    expect(
      matchesAdventCondition(
        orangeCard,
        orange,
        minCost5Condition,
        getCardDefinitionById,
        rebuilt
      )
    ).toBe(true);
  });

  it("Lv1 時は同じ橙インスタンスがコスト5以上煌臨条件を満たさない（印字コスト3のまま）", () => {
    const state = buildState(1);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const orangeCard = rebuilt.cardInstances.find(
      (c) => c.instanceId === "orange-1"
    )!;
    expect(
      matchesAdventCondition(
        orangeCard,
        orange,
        minCost5Condition,
        getCardDefinitionById,
        rebuilt
      )
    ).toBe(false);
  });

  it("系統が幻想・妖戒でないコスト3スピリットは Lv2 橙が居ても対象外のまま", () => {
    const state = buildState(2);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const otherCard = rebuilt.cardInstances.find(
      (c) => c.instanceId === "other-1"
    )!;
    expect(
      matchesAdventCondition(
        otherCard,
        otherSpiritDef,
        minCost5Condition,
        getCardDefinitionById,
        rebuilt
      )
    ).toBe(false);
  });
});
