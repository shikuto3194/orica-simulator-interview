/**
 * P3-20 継続効果の宣言型属性カバレッジギャップ — テスト。
 *
 * - ギャップ A: usageLimit: no_duplicate を持つ continuous 効果が、
 *   同名カードが場に複数いても CE を 1 件しか登録しないこと。
 * - ギャップ B: continuous 効果の condition / applicability が
 *   盤面状態の変化に応じて動的に再評価されること（recomputeAndRebuildContinuousEffects）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const ルーミア = cardNoMap.get("BSTH01-C04")!;

/** 系統「導界者」を持つ簡易ネクサス定義（ルーミアの field_lacks 条件を破る用）。 */
const guidedNexusDef: CardDefinition = {
  cardNo: "TEST-GUIDED-NEXUS",
  name: "テスト導界者ネクサス",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  tribe: "導界者",
};

const lookupWithGuided = (id: string) => {
  if (id === guidedNexusDef.cardNo) return guidedNexusDef;
  return cardNoMap.get(id);
};

function buildState(cardInstancesArg: GameState["cardInstances"]): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "main",
    cardInstances: cardInstancesArg,
  };
}

describe("P3-20 ギャップ A: continuous 効果の no_duplicate", () => {
  it("同名 ルーミア が 2 体場にいても symbol_addition CE は 1 体ぶん (2 件) のみ", () => {
    const state = buildState([
      createCardInstance(ルーミア, {
        instanceId: "rumia-A",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(ルーミア, {
        instanceId: "rumia-B",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
    ]);

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );

    const symAdds = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    // ルーミアは Lv2 で symbol_add red x2 (2 ステップ) の effect。
    // no_duplicate により 1 体ぶん = 2 件のみ登録される。
    expect(symAdds).toHaveLength(2);
    // 1 体に集中して登録される (どちらか一方の rumia)。
    const targetIds = new Set(symAdds.map((ce) => ce.targetInstanceId));
    expect(targetIds.size).toBe(1);
    expect([...targetIds][0]).toMatch(/^rumia-[AB]$/);
  });

  it("リビルダ冪等: 2 ルーミア + 2 回 rebuild しても CE 数が増えない", () => {
    const state = buildState([
      createCardInstance(ルーミア, {
        instanceId: "rumia-A",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(ルーミア, {
        instanceId: "rumia-B",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
    ]);

    const once = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const twice = rebuildContinuousEffectsFromField(
      once,
      getCardDefinitionById
    );

    expect(
      twice.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(2);
  });
});

describe("P3-20 ギャップ B: continuous 効果の condition 動的再評価", () => {
  it("ルーミア登録後に 導界者ネクサス が場に出ると symbol_addition CE が除去される", () => {
    // 1. ルーミア (Lv2) のみ → CE 登録される
    const initial = buildState([
      createCardInstance(ルーミア, {
        instanceId: "rumia-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
    ]);

    const withRumia = rebuildContinuousEffectsFromField(
      initial,
      getCardDefinitionById
    );
    expect(
      withRumia.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(2);

    // 2. 導界者ネクサスを後から場に追加 → recompute で CE 除去
    const afterNexus: GameState = {
      ...withRumia,
      cardInstances: [
        ...withRumia.cardInstances,
        createCardInstance(guidedNexusDef, {
          instanceId: "guide-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      afterNexus,
      lookupWithGuided
    );

    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(0);
  });

  it("導界者ネクサス存在下で召喚した ルーミア の CE は登録されず、ネクサス除去後に再登録される", () => {
    // 1. ネクサス + ルーミア 同時 → CE 登録されない
    const initial = buildState([
      createCardInstance(guidedNexusDef, {
        instanceId: "guide-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(ルーミア, {
        instanceId: "rumia-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
    ]);

    const withBoth = rebuildContinuousEffectsFromField(
      initial,
      lookupWithGuided
    );
    expect(
      withBoth.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(0);

    // 2. ネクサスを場から離す (例: 破壊で trash 行き) → recompute で CE 再登録
    const afterDestroy: GameState = {
      ...withBoth,
      cardInstances: withBoth.cardInstances.map((c) =>
        c.instanceId === "guide-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      afterDestroy,
      lookupWithGuided
    );

    const symAdds = recomputed.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    expect(symAdds).toHaveLength(2);
    expect(symAdds.every((ce) => ce.targetInstanceId === "rumia-1")).toBe(true);
  });

  it("Lv1 ルーミア (applicability unmet) はコア追加で Lv2 になると CE が登録される", () => {
    // 1. 1 コア = Lv1 → applicability unmet → CE 未登録
    const initial = buildState([
      createCardInstance(ルーミア, {
        instanceId: "rumia-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
    ]);

    const lv1 = rebuildContinuousEffectsFromField(
      initial,
      getCardDefinitionById
    );
    expect(
      lv1.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(0);

    // 2. コアを追加 (2 コア = Lv2) → recompute で CE 登録
    const lv2State: GameState = {
      ...lv1,
      cardInstances: lv1.cardInstances.map((c) =>
        c.instanceId === "rumia-1" ? { ...c, normalCoreCount: 2 } : c
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      lv2State,
      getCardDefinitionById
    );
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(2);
  });

  it("Lv2 ルーミア (CE 登録済) からコアが減って Lv1 になると CE が除去される", () => {
    // 1. 2 コア = Lv2 → CE 登録
    const initial = buildState([
      createCardInstance(ルーミア, {
        instanceId: "rumia-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
    ]);

    const lv2 = rebuildContinuousEffectsFromField(
      initial,
      getCardDefinitionById
    );
    expect(
      lv2.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(2);

    // 2. コア減 (1 コア = Lv1) → recompute で CE 除去
    const lv1State: GameState = {
      ...lv2,
      cardInstances: lv2.cardInstances.map((c) =>
        c.instanceId === "rumia-1" ? { ...c, normalCoreCount: 1 } : c
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      lv1State,
      getCardDefinitionById
    );
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "symbol_addition"
      )
    ).toHaveLength(0);
  });

  it("2 ルーミア で 1 体目が場を離れると 2 体目で CE が再登録される (no_duplicate 連動)", () => {
    // 1. 2 ルーミア (Lv2) → CE は 1 体ぶん (rumia-A の 2 件) のみ
    const initial = buildState([
      createCardInstance(ルーミア, {
        instanceId: "rumia-A",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(ルーミア, {
        instanceId: "rumia-B",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
    ]);

    const both = rebuildContinuousEffectsFromField(
      initial,
      getCardDefinitionById
    );
    const initialSymAdds = both.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    expect(initialSymAdds).toHaveLength(2);
    const initialTarget = initialSymAdds[0]!.targetInstanceId;

    // 2. CE 保有側 (initialTarget) を trash へ → recompute で CE 除去 + もう一方で再登録
    const afterLoss: GameState = {
      ...both,
      cardInstances: both.cardInstances.map((c) =>
        c.instanceId === initialTarget ? { ...c, zone: "trash" as const } : c
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      afterLoss,
      getCardDefinitionById
    );
    const remaining = recomputed.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    expect(remaining).toHaveLength(2);
    const otherInstanceId = initialTarget === "rumia-A" ? "rumia-B" : "rumia-A";
    expect(
      remaining.every((ce) => ce.targetInstanceId === otherInstanceId)
    ).toBe(true);
  });
});
