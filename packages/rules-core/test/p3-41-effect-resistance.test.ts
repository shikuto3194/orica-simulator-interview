/**
 * P3-41: effect_resistance (cannot_*) consumer + 動的 filter 化。
 *
 * Phase A 検証: executeDestroy / Vanish / Bounce / SendToDeck / RemoveFromGame が
 * cannot_* CE を読み、source 条件 (opponent_effect / all) を満たす場合に対象を除外する。
 *
 * Phase B 検証: executeEffectResistance が target.count === -1 (= "all") + 表現可能な
 * filter のみのとき、per-target snapshot ではなく単一 CE + targetFilter で登録され、
 * 後から場に出た同条件カードも自動的に保護される。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeDestroy,
  executeBounce,
  executeVanish,
  executeSendToDeck,
  executeRemoveFromGame,
  executeEffectResistance,
  executeEffect,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function nexusDef(
  cardNo: string,
  tribes: string[],
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: tribes.join("・"),
    sourceUrls: [],
    sourceConfidence: "A",
    ...overrides,
  } as CardDefinition;
}

const 紅魔ネクサス = nexusDef("KOH-1", ["幻想", "紅魔"]);
const 紅魔ネクサス2 = nexusDef("KOH-2", ["幻想", "紅魔"]);
const 普通ネクサス = nexusDef("NEXUS-1", ["蓬莱"]);

function getCardDef(id: string): CardDefinition | undefined {
  if (id === "KOH-1") return 紅魔ネクサス;
  if (id === "KOH-2") return 紅魔ネクサス2;
  if (id === "NEXUS-1") return 普通ネクサス;
  return undefined;
}

function makeState(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: cards,
  };
}

function fieldNexus(
  instanceId: string,
  defId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(getCardDef(defId)!, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

describe("P3-41 Phase A: cannot_* consumer (per-target snapshot)", () => {
  it("cannot_be_destroyed (source: opponent_effect): 相手効果での破壊を阻止", () => {
    const protectedCard = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([protectedCard]);

    // alice 視点で「自分の紅魔ネクサスを破壊から保護」(per-target で 1 体だけ登録)
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: false, player: "self", count: 1, tribes: ["紅魔"] },
        resistType: "cannot_be_destroyed",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    // bob (相手) が破壊しようとする → 阻止される
    const result = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-source"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();
    expect(result.log.some((l) => l.includes("blocked-by-resistance"))).toBe(
      true
    );
  });

  it("cannot_be_destroyed (source: opponent_effect): 自分効果での破壊は阻止しない", () => {
    const protectedCard = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([protectedCard]);

    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: false, player: "self", count: 1, tribes: ["紅魔"] },
        resistType: "cannot_be_destroyed",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    // alice 自身が破壊する → 通る
    const result = executeDestroy(
      state,
      ALICE,
      { selfCard: false, player: "self", count: -1 },
      getCardDef,
      "alice-source"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("cannot_be_destroyed (source: all): 自分の効果でも阻止される", () => {
    const protectedCard = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([protectedCard]);

    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: false, player: "self", count: 1, tribes: ["紅魔"] },
        resistType: "cannot_be_destroyed",
        source: "all",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    const result = executeDestroy(
      state,
      ALICE,
      { selfCard: false, player: "self", count: -1 },
      getCardDef,
      "alice-source"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();
  });

  it("cannot_leave_field: 全 outcome (destroy / bounce / vanish / send_to_deck / remove_from_game) を阻止", () => {
    const protectedCard = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([protectedCard]);

    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: false, player: "self", count: 1, tribes: ["紅魔"] },
        resistType: "cannot_leave_field",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    // bob からの destroy / bounce / vanish / send_to_deck / remove_from_game をすべて阻止
    const targetSpec = {
      selfCard: false,
      player: "opponent" as const,
      count: -1,
    };
    const dResult = executeDestroy(
      state,
      BOB,
      targetSpec,
      getCardDef,
      "bob-src"
    );
    expect(
      dResult.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();

    const bResult = executeBounce(
      state,
      BOB,
      { kind: "bounce", target: targetSpec },
      getCardDef,
      "bob-src"
    );
    // 耐性で除外され、pending leave にも乗らず場に残ることを確認
    expect(bResult.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "field"
    );

    const vResult = executeVanish(
      state,
      BOB,
      targetSpec,
      getCardDef,
      "bob-src"
    );
    expect(
      vResult.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();

    const sResult = executeSendToDeck(
      state,
      BOB,
      { kind: "send_to_deck", target: targetSpec, position: "top" },
      getCardDef,
      "bob-src"
    );
    expect(sResult.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "field"
    );

    const rResult = executeRemoveFromGame(
      state,
      BOB,
      { kind: "remove_from_game", target: targetSpec },
      getCardDef,
      "bob-src"
    );
    expect(rResult.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "field"
    );
  });
});

describe("P3-41 Phase B: 動的 filter CE", () => {
  it('count: -1 ("all") + filter のみ → 単一 CE + targetFilter で登録', () => {
    const k1 = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([k1]);

    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: {
          selfCard: false,
          player: "self",
          count: -1,
          category: ["nexus"],
          tribes: ["紅魔"],
        },
        resistType: "cannot_be_destroyed",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    const ces = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "cannot_be_destroyed"
    );
    expect(ces.length).toBe(1);
    expect(ces[0]!.targetInstanceId).toBeUndefined();
    expect(ces[0]!.targetFilter).toBeDefined();
    expect(ces[0]!.targetFilter?.tribes).toEqual(["紅魔"]);
  });

  it("動的 filter: 後から場に出た同条件カードも保護される", () => {
    const k1 = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([k1]);

    // alice が「自分の紅魔ネクサスすべては相手の効果で破壊されない」を発揮
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: {
          selfCard: false,
          player: "self",
          count: -1,
          category: ["nexus"],
          tribes: ["紅魔"],
        },
        resistType: "cannot_be_destroyed",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    // 後から alice が新たに紅魔ネクサスを場に出す
    const k2 = fieldNexus("k2", "KOH-2", ALICE);
    state = { ...state, cardInstances: [...state.cardInstances, k2] };

    // bob が両方の破壊を試みる
    const result = executeDestroy(
      state,
      BOB,
      {
        selfCard: false,
        player: "opponent",
        count: -1,
        category: ["nexus"],
      },
      getCardDef,
      "bob-source"
    );

    // 既存の k1 も新規 k2 も保護される
    expect(
      result.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();
    expect(
      result.cardInstances.find((c) => c.instanceId === "k2")?.pendingLeaveKind
    ).toBeNull();
  });

  it("DSL resistsOutcome: 配列で複数 outcome を渡すと outcome ごとに 1 CE 登録", () => {
    const k1 = fieldNexus("k1", "KOH-1", ALICE);
    const baseState = makeState([k1]);

    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "effect_resistance",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["nexus"], tribes: ["紅魔"] },
              count: "all",
            },
            resistsOutcome: ["destroy", "bounce", "vanish"],
            source: "opponent_effect",
            duration: { scope: "permanent" },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:p3-41-effect-resistance:373",
      state: baseState,
      effect,
      sourceInstanceId: "k1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const tags = result.activeContinuousEffects.map((ce) => ce.modifierTag);
    expect(tags).toContain("cannot_be_destroyed");
    expect(tags).toContain("cannot_be_bounced");
    expect(tags).toContain("cannot_be_vanished");

    // 動的 filter eligible なので各 outcome で 1 CE ずつ (合計 3 件)
    const resistanceCEs = result.activeContinuousEffects.filter((ce) =>
      [
        "cannot_be_destroyed",
        "cannot_be_bounced",
        "cannot_be_vanished",
      ].includes(ce.modifierTag)
    );
    expect(resistanceCEs.length).toBe(3);
    for (const ce of resistanceCEs) {
      expect(ce.targetFilter).toBeDefined();
      expect(ce.targetFilter?.tribes).toEqual(["紅魔"]);
    }
  });

  it("動的 filter: 系統が一致しないカードは保護されない", () => {
    const k1 = fieldNexus("k1", "KOH-1", ALICE);
    let state = makeState([k1]);

    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: {
          selfCard: false,
          player: "self",
          count: -1,
          category: ["nexus"],
          tribes: ["紅魔"],
        },
        resistType: "cannot_be_destroyed",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "k1",
      getCardDef
    );

    // 紅魔系統を持たない別ネクサスを場に出す
    const n1 = fieldNexus("n1", "NEXUS-1", ALICE);
    state = { ...state, cardInstances: [...state.cardInstances, n1] };

    const result = executeDestroy(
      state,
      BOB,
      {
        selfCard: false,
        player: "opponent",
        count: -1,
        category: ["nexus"],
      },
      getCardDef,
      "bob-source"
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();
    // 普通ネクサスは破壊される
    expect(
      result.cardInstances.find((c) => c.instanceId === "n1")?.pendingLeaveKind
    ).toBe("destroy");
  });
});
