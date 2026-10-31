/**
 * 条件付き防止不可（`Effect.preventionLevelCondition`）の解決時ゲートテスト。
 *
 * 「自分のカウントN以上のとき、この効果は相手の効果では防げない」(BSDB01-X02 /
 * BSTS01-X02) 型。`preventionLevel: "unpreventable"` を `preventionLevelCondition`
 * で条件ゲートし、**解決時に条件が成立した場合のみ** cannot_* / defense_immune を貫通し、
 * 不成立なら通常の防止可能破壊として解決する（相手の「破壊されない」に阻まれる）ことを
 * 実カード 2 枚で確認する。
 *
 * ルール正源: 効果防止の優先順位 10_rules/03c「防げない＞受けない＞発揮できない」。
 * 評価は evaluateCondition 一本（SSOT、executeEffect 内）。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/** 対象が実際に離脱する（破壊が通る）かを判定する。p3-43-unpreventable-producer と同じ。 */
function isLeaving(result: GameState, id: string): boolean {
  const c = result.cardInstances.find((x) => x.instanceId === id);
  const leftField = !c || c.zone !== "field";
  const realLeave = result.pendingLeaveEntities.some(
    (e) => e.instanceId === id && !e.blockedByResistance
  );
  return leftField || realLeave;
}

/** 相手起因の「破壊されない」効果耐性 CE を対象 instance に付与する。 */
function cannotBeDestroyedCE(
  targetInstanceId: string,
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: `test-cbd-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

describe("条件付き防止不可: BSDB01-X02 超サイヤ人2 ベジータ -天使- (カウント7以上で防げない)", () => {
  const def = card("BSDB01-X02");
  // effects[0] = 『煌臨/アタック時』本来コスト8以下の相手2体まで破壊。カウント7以上で防げない。
  const destroyEffect = def.effects![0]!;

  function makeState(selfCount: number): GameState {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: selfCount }, {}],
    });
    const self = createCardInstance(def, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    // 相手スピリット（コスト3 ≤ maxCost8）に「相手の効果で破壊されない」を付与。
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
      activeContinuousEffects: [cannotBeDestroyedCE("enemy-1", "bob")],
    };
  }

  it("カウント6（条件未達）: 通常の防止可能破壊として cannot_be_destroyed に阻まれ残存", () => {
    const result = executeEffect({
      chainId: "test:conditional-prevention-level:101",
      state: makeState(6),
      effect: destroyEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["enemy-1"],
    });
    expect(isLeaving(result, "enemy-1")).toBe(false);
  });

  it("カウント7（条件成立）: 防げない破壊として cannot_be_destroyed を貫通し破壊", () => {
    const result = executeEffect({
      chainId: "test:conditional-prevention-level:113",
      state: makeState(7),
      effect: destroyEffect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["enemy-1"],
    });
    expect(isLeaving(result, "enemy-1")).toBe(true);
  });
});

describe("条件付き防止不可: BSTS01-X02 ［覚醒魔王］リムル=テンペスト (カウント10以上∧Lv4以上で防げない)", () => {
  const def = card("BSTS01-X02");
  // textRef[8,9] = 『アタック時』相手2つまで破壊。カウント10以上で Lv4以上のとき防げない。
  const destroyEffect = def.effects!.find(
    (e) => e.textRef?.includes(8) && e.textRef?.includes(9)
  )!;

  // levelDefs: L3=1core / L4=3core / L5=4core。cores で Lv を制御する。
  function makeState(selfCount: number, selfCores: number): GameState {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: selfCount }, {}],
    });
    const self = createCardInstance(def, {
      instanceId: "ult-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: selfCores,
    });
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "venemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
      activeContinuousEffects: [cannotBeDestroyedCE("venemy-1", "bob")],
    };
  }

  it("カウント10 ∧ Lv4（両条件成立）: 防げない破壊で cannot_be_destroyed を貫通", () => {
    const result = executeEffect({
      chainId: "test:conditional-prevention-level:162",
      state: makeState(10, 3),
      effect: destroyEffect,
      sourceInstanceId: "ult-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["venemy-1"],
    });
    expect(isLeaving(result, "venemy-1")).toBe(true);
  });

  it("カウント9 ∧ Lv4（カウント未達）: 通常破壊で阻まれ残存", () => {
    const result = executeEffect({
      chainId: "test:conditional-prevention-level:174",
      state: makeState(9, 3),
      effect: destroyEffect,
      sourceInstanceId: "ult-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["venemy-1"],
    });
    expect(isLeaving(result, "venemy-1")).toBe(false);
  });

  it("カウント10 ∧ Lv3（レベル未達）: 通常破壊で阻まれ残存（min_level 分岐）", () => {
    const result = executeEffect({
      chainId: "test:conditional-prevention-level:186",
      state: makeState(10, 1),
      effect: destroyEffect,
      sourceInstanceId: "ult-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["venemy-1"],
    });
    expect(isLeaving(result, "venemy-1")).toBe(false);
  });
});
