/**
 * BSTS01-C03 ［行政担当］リグルド〔ターンに1回:同名〕
 * 「自分の『カウント＋』効果で増やすカウントを＋1する」(count-gain メタ修飾) の挙動検証。
 *
 * 裁定 (10_rules/08a §カウント＋ メタ修飾, 2026-06-14, 案A):
 * - そのターンに最初に解決する受益プレイヤーの count_increase 1 件のみへ +1 を自動適用。
 * - 終止形=強制 / 〔ターンに1回:同名〕は first-opportunity 消費 (プレイヤー選択なし)。
 * - 範囲=受益プレイヤーの count_increase 全般。
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeCountIncrease } from "../src/effect/structured-effect-interpreter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const RIGURUDO = "BSTS01-C03";
const PLAYER = "player-1";
const OPP = "player-2";

function withRigurudo(instanceIds: string[]): GameState {
  const cards = instanceIds.map((id) =>
    createCardInstance(getDef(RIGURUDO)!, {
      ownerPlayerId: PLAYER,
      zone: "field",
      instanceId: id,
    })
  );
  const state = createEmptyGameState({
    playerIds: [PLAYER, OPP],
    cardInstances: cards,
  });
  return rebuildContinuousEffectsFromField(state, getDef);
}

const countOf = (state: GameState, pid: string): number =>
  state.players.find((p) => p.id === pid)!.countValue;

describe("BSTS01-C03 カウント＋ メタ修飾 (count_gain_modifier)", () => {
  it("card data: 継続効果 count_gain_modifier を持ち stub が消えている", () => {
    const def = getDef(RIGURUDO)!;
    const hasModifier = def.effects?.some((e) =>
      e.steps.some((s) => s.action.kind === "count_gain_modifier")
    );
    expect(hasModifier).toBe(true);
    expect(def.effects?.some((e) => e.stub)).toBe(false);
  });

  it("在場: 召喚で count_gain_modifier CE が登録される", () => {
    const state = withRigurudo(["rig-1"]);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "count_gain_modifier"
      )
    ).toBe(true);
  });

  it("そのターン最初の count+ のみ +1、2件目以降は据え置き", () => {
    let state = withRigurudo(["rig-1"]);
    // 1件目: +2 指定 → +3 (bonus +1)
    state = executeCountIncrease(state, PLAYER, "self", 2);
    expect(countOf(state, PLAYER)).toBe(3);
    // 2件目: +2 → +2 (bonus 消費済み)
    state = executeCountIncrease(state, PLAYER, "self", 2);
    expect(countOf(state, PLAYER)).toBe(5);
  });

  it("不在: bonus 無し (素の増加量のみ)", () => {
    let state = createEmptyGameState({ playerIds: [PLAYER, OPP] });
    state = executeCountIncrease(state, PLAYER, "self", 2);
    expect(countOf(state, PLAYER)).toBe(2);
  });

  it("相手の count+ には適用されない (受益=自分のみ)", () => {
    let state = withRigurudo(["rig-1"]);
    state = executeCountIncrease(state, OPP, "self", 2);
    expect(countOf(state, OPP)).toBe(2);
    // 自分の count+ には依然として乗る
    state = executeCountIncrease(state, PLAYER, "self", 1);
    expect(countOf(state, PLAYER)).toBe(2);
  });

  it("同名2体でも +1 (同名は first-opportunity を共有)", () => {
    let state = withRigurudo(["rig-1", "rig-2"]);
    state = executeCountIncrease(state, PLAYER, "self", 0);
    expect(countOf(state, PLAYER)).toBe(1);
  });

  it("消費トラッカーがクリアされると bonus が復活する (ターン遷移リセットの契約)", () => {
    let state = withRigurudo(["rig-1"]);
    state = executeCountIncrease(state, PLAYER, "self", 0);
    expect(countOf(state, PLAYER)).toBe(1);
    // 〔ターンに1回:同名〕の消費が記録される。
    expect(state.countGainModifierConsumedThisTurn.length).toBeGreaterThan(0);
    // turn-system.ts (advanceFromEndStep) はターン遷移時に
    // countGainModifierConsumedThisTurn を [] にリセットする。それを模して
    // クリアすると、再び最初の count+ に +1 が乗る。
    state = { ...state, countGainModifierConsumedThisTurn: [] };
    state = executeCountIncrease(state, PLAYER, "self", 0);
    expect(countOf(state, PLAYER)).toBe(2);
  });
});
