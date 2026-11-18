/**
 * カード対象「相手の効果を受けない」(defense_immune) — 構造化インタプリタ destroy 経路の回帰。
 *
 * レミリア BSTH01-X03『アタック時』「BP20000以下の相手のスピリット/アルティメット1体を破壊する。
 * この効果で破壊したスピリット/アルティメットの効果は発揮されない」が battle_immediate として
 * 解決される際、対象は `structured-effect-interpreter` の `executeDestroy` →
 * `resolveTargetCards` 自動選択経路を通る (GUI 候補列挙 getCandidateTargetInstanceIds を経ない)。
 *
 * 旧バグ: この経路には免疫 (defense_immune) フィルタが無く、回復パチュリー BSTH01-M01
 * 「回復状態のこのスピリットは、相手の効果を受けない」が先頭で掴まれて破壊され、本来 Q19 裁定で
 * 貫通破壊されるべき美鈴 BSTH01-R04「相手の効果でフィールドを離れない」(cannot_leave_field) が
 * 取りこぼされていた (両者が反転)。
 *
 * 正: 免疫スピリット (パチュリー) は対象から除外され残存。pierce 対象の cannot_leave_field
 * スピリット (美鈴) は suppressDestroyedEffects による Q19 貫通で破壊される。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeDestroy } from "../src/effect/structured-effect-interpreter";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectTarget,
  GameState,
} from "../src/model";

const ALICE = "player-1"; // 攻撃側 (X03 のコントローラー)
const BOB = "player-2"; // 防御側 (パチュリー / 美鈴 のコントローラー)

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

function bobSpirit(instanceId: string): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 2,
  });
}

/** 「相手の効果を受けない」defense_immune CE (パチュリー型)。 */
function immunityCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `di-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "BSTH01-M01",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
  };
}

/** 「相手の効果でフィールドを離れない」cannot_leave_field CE (美鈴型)。 */
function cannotLeaveFieldCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `clf-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "BSTH01-R04",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cannot_leave_field",
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  } as ContinuousEffect;
}

function getCardDef(_id: string): CardDefinition | undefined {
  return dummyDef();
}

const cardOf = (state: GameState, id: string): CardInstance =>
  state.cardInstances.find((c) => c.instanceId === id)!;

// X03『アタック時』相当の対象指定: 相手スピリット1体、destroy。
const opponentSpiritTarget: EffectTarget = {
  player: "opponent",
  category: ["spirit", "ultimate"],
  maxBp: 20000,
  count: 1,
};

describe("executeDestroy vs 相手の効果を受けない (構造化インタプリタ)", () => {
  it("免疫パチュリーは自動選択対象から除外され、貫通対象の美鈴が破壊される", () => {
    // 候補順は instanceId 順に依存しないよう、パチュリー(免疫)を先頭に置く。
    const patchouli = bobSpirit("patchouli"); // 免疫
    const meiling = bobSpirit("meiling"); // cannot_leave_field
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [patchouli, meiling],
      activeContinuousEffects: [
        immunityCE("patchouli"),
        cannotLeaveFieldCE("meiling"),
      ],
    };

    const result = executeDestroy(
      state,
      ALICE,
      opponentSpiritTarget,
      getCardDef,
      "x03-source",
      undefined,
      "destroyed_only" // → pierceCannotLeaveField=true (Q19 貫通)
    );

    // パチュリーは免疫で対象外 → 破壊判定にすら乗らずフィールドに残る。
    expect(cardOf(result, "patchouli").pendingLeaveKind).toBeNull();
    // 美鈴は cannot_leave_field だが suppressDestroyedEffects で貫通 → 破壊 (pendingLeave)。
    expect(cardOf(result, "meiling").pendingLeaveKind).toBe("destroy");
  });

  it("免疫スピリットしかいなければ何も破壊されない (誤って免疫を掴まない)", () => {
    const patchouli = bobSpirit("patchouli");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [patchouli],
      activeContinuousEffects: [immunityCE("patchouli")],
    };

    const result = executeDestroy(
      state,
      ALICE,
      opponentSpiritTarget,
      getCardDef,
      "x03-source",
      undefined,
      "destroyed_only"
    );

    expect(cardOf(result, "patchouli").pendingLeaveKind).toBeNull();
  });

  it("免疫が無ければ通常通り破壊される (回帰)", () => {
    const meiling = bobSpirit("meiling");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [meiling],
      activeContinuousEffects: [],
    };

    const result = executeDestroy(
      state,
      ALICE,
      opponentSpiritTarget,
      getCardDef,
      "x03-source",
      undefined,
      "destroyed_only"
    );

    expect(cardOf(result, "meiling").pendingLeaveKind).toBe("destroy");
  });
});
