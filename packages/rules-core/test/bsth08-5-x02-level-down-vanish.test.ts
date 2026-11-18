import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH08.5-X02 effects[0]
 * 「【バースト：自分のライフ減少後】自分のライフが2以下のとき、このターンの間、
 * 相手のスピリット/アルティメット3体のLvを2つ下のものとして扱う。この効果で
 * 最低Lvより低くなったスピリット/アルティメットは消滅し、消滅した相手の
 * スピリット/アルティメット1体につきボイドからコア1個を自分のライフに置く。
 * その後、このカードをコストを支払わず召喚する。」回帰テスト。
 *
 * engine-temporary-level-delta-vanish-threshold: override_properties.level に
 * `{delta}` (相対上書き、`"max"` の相対版) を追加し、`CardFilter.belowOwnMinimumLevel`
 * (対象自身の levelDefs 最低Lvとの相対比較) で「扱いのLvが最低Lv未満」を判定する。
 * 消滅待機にした数を cards_from_ref で数え、誘発や実移動は本文の全解決まで待つ。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const komachiDef = cardNoMap.get("BSTH08.5-X02")!;

const enemyDef: CardDefinition = {
  cardNo: "TEST-ENEMY-3LV",
  name: "テスト用敵スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 2, bp: 2000 },
    { level: 3, requiredCores: 4, bp: 3000 },
  ],
  symbolColors: [],
  textLines: [],
  tribe: "",
  image: "",
  rarity: "C",
  pack: "",
  maxDeckCount: 4,
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
cardNoMap.set(enemyDef.cardNo, enemyDef);

describe("BSTH08.5-X02 effects[0]: バースト(ライフ減少後) Lv2下扱い→最低Lv未満消滅→ライフ補充→召喚", () => {
  const effect = komachiDef.effects![0]!;

  it("ライフ2以下の条件はLv低下の前半だけにかかり、後続召喚は独立する", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.condition).toBeUndefined();
    expect(effect.steps[0]!.condition).toEqual([
      { kind: "life_value", player: "self", max: 2 },
    ]);
    expect(effect.steps).toHaveLength(4);
    const levelDown = effect.steps[0]!.action;
    expect(levelDown.kind).toBe("override_properties");
    if (levelDown.kind === "override_properties") {
      expect(levelDown.properties.level).toEqual({ delta: -2 });
      expect(levelDown.duration).toEqual({ scope: "turn" });
    }
    expect(effect.steps[1]!.action.kind).toBe("vanish");
    expect(effect.steps[2]!.action.kind).toBe("core_move");
    expect(effect.steps[3]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
  });

  it("Lv1/Lv2は最低Lv未満で消滅(2体)、Lv3(max)は生存しLv1扱いになる。消滅数分ボイド→ライフ", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingLife: 2,
      startingVoidNormalCoreCount: 5,
    });
    const komachi = createCardInstance(komachiDef, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst_set",
    });
    // Lv1 (1コア): 2下→-1 < 最低Lv1 → 消滅
    const enemyLv1 = createCardInstance(enemyDef, {
      instanceId: "enemy-lv1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    // Lv2 (2コア): 2下→0 < 最低Lv1 → 消滅
    const enemyLv2 = createCardInstance(enemyDef, {
      instanceId: "enemy-lv2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    // Lv3 (4コア、最大): 2下→1、最低Lv1未満ではない → 生存(Lv1扱い)
    const enemyLv3 = createCardInstance(enemyDef, {
      instanceId: "enemy-lv3",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [komachi, enemyLv1, enemyLv2, enemyLv3],
    };

    const result = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth08-5-x02-level-down-vanish:120",
      state,
      effect,
      sourceInstanceId: "komachi-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-lv1", "enemy-lv2", "enemy-lv3"],
    });

    // 維持コアを選んで本文を完了すると、消滅対象の離脱も確定する。
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-lv1")?.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-lv2")?.zone
    ).toBe("trash");

    // Lv3 は生存し、このターンの間 Lv1 扱い(delta:-2)になる。
    const survivor = result.cardInstances.find(
      (c) => c.instanceId === "enemy-lv3"
    )!;
    expect(survivor.zone).toBe("field");

    // 消滅2体 → ボイドから自分のライフへコア2個。
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(4); // 開始2 + 補充2
    expect(alice.voidNormalCoreCount).toBe(3); // 開始5 - 2

    // その後、このカードをコストを支払わず召喚する。
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    expect(komachiAfter.zone).toBe("field");
    const finalized = finalizeEffectResolution({
      state: result,
      beforeState: state,
      chainId: "komachi-order",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: "komachi-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    expect(finalized.pendingLeaveEntities).toHaveLength(0);
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "enemy-lv1")?.zone
    ).toBe("trash");
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "enemy-lv2")?.zone
    ).toBe("trash");
    expect(finalized.players[0]!.lifeNormalCoreCount).toBe(4);
  });

  it("ライフ3以上では相手のLvを変えず、独立した後続の召喚を行う", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingLife: 3,
    });
    const komachi = createCardInstance(komachiDef, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst_set",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        komachi,
        createCardInstance(enemyDef, {
          instanceId: "enemy-unaffected",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:bsth08-5-x02-level-down-vanish:202",
      state,
      effect,
      sourceInstanceId: "komachi-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    expect(komachiAfter.zone).toBe("field");
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-unaffected")
        ?.zone
    ).toBe("field");
    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.targetInstanceId === "enemy-unaffected"
      )
    ).toBe(false);
    expect(
      result.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(3);
  });
});
