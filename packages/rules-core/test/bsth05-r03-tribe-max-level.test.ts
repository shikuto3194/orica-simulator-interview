/**
 * BSTH05-R03 犬走 椛 effects[1]
 *   Lv2『自分のアタックステップ』
 *   系統：「天狗」を持つ自分のスピリットは、そのスピリットが持つ最高Lvとして扱う。
 *
 * override_properties.properties.level: "max"（実効 Lv を対象カード自身の levelDefs 最高値へ
 * 直接上書き。コア数計算を経由しない）+ timingScope: { player: "self", period: "attack" } で
 * 「自分のアタックステップ中」を汎用パイプラインだけで表現する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveLevel,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
} from "../src";

const momiji = ALL_CARDS.find((c) => c.cardNo === "BSTH05-R03");
if (!momiji) {
  throw new Error("BSTH05-R03 not found in ALL_CARDS");
}
const MOMIJI = momiji;

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH05-R03 犬走 椛 effects[1]", () => {
  it("effects[1] 天狗スピリット最高Lv扱いは override_properties(level:max) で表現（stub 解消）", () => {
    expect(MOMIJI.effects![1]!.stub).toBeUndefined();
    expect(MOMIJI.effects![1]!.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
  });

  it("[board] 自分のアタックステップ・椛Lv2以上のとき、天狗スピリットは最高Lv扱いになる", () => {
    const momijiCard = createCardInstance(MOMIJI, {
      instanceId: "momiji",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // levelDefs lv2.requiredCores === 3
    });
    const tenguDef: CardDefinition = {
      cardNo: "TEST-TENGU",
      name: "test tengu spirit",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 5, bp: 2000 },
      ],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "天狗",
      effects: [],
    };
    const targetCard = createCardInstance(tenguDef, {
      instanceId: "tengu-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // 単独では Lv1
    });
    const getDef = (id: string) =>
      id === "TEST-TENGU" ? tenguDef : getCardDefinitionById(id);

    const attackState = {
      ...createEmptyGameState({ cardInstances: [momijiCard, targetCard] }),
      step: "attack" as const,
      activePlayerId: "alice",
    };
    const afterAttack = rebuildContinuousEffectsFromField(attackState, getDef);
    expect(getEffectiveLevel(afterAttack, targetCard, tenguDef, getDef)).toBe(
      2
    );

    // timingScope: { player: "self", period: "attack" } — メインステップでは適用されない
    const mainState = { ...attackState, step: "main" as const };
    const afterMain = rebuildContinuousEffectsFromField(mainState, getDef);
    expect(getEffectiveLevel(afterMain, targetCard, tenguDef, getDef)).toBe(1);
  });

  it("[board] 椛がLv1（条件未成立）のときは天狗スピリットが最高Lv扱いにならない", () => {
    const momijiCard = createCardInstance(MOMIJI, {
      instanceId: "momiji",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv1 のみ (min_level:2 条件を満たさない)
    });
    const tenguDef: CardDefinition = {
      cardNo: "TEST-TENGU",
      name: "test tengu spirit",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 5, bp: 2000 },
      ],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "天狗",
      effects: [],
    };
    const targetCard = createCardInstance(tenguDef, {
      instanceId: "tengu-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const getDef = (id: string) =>
      id === "TEST-TENGU" ? tenguDef : getCardDefinitionById(id);

    const attackState = {
      ...createEmptyGameState({ cardInstances: [momijiCard, targetCard] }),
      step: "attack" as const,
      activePlayerId: "alice",
    };
    const afterAttack = rebuildContinuousEffectsFromField(attackState, getDef);
    expect(getEffectiveLevel(afterAttack, targetCard, tenguDef, getDef)).toBe(
      1
    );
  });
});
