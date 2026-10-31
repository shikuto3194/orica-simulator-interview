/**
 * BSTH001-転醒R02(A) ユウゲンマガン effect[1] Lv2-Lv3
 * 「自分のスピリットの『コア除去効果』で移動するコアの数を+1する」
 * (core_move_amount_modifier メタ修飾) の挙動検証。
 *
 * 設計:
 * - 継続効果 core_move_amount_modifier を Lv2+ で登録
 *   (applicability + continuous + while_on_field)。
 * - executeCoreMove の card_instance パス (相手カード源) で
 *   sourceCard.ownerPlayerId !== actingPlayerId の場合に bonus を加算する。
 * - ライフ↔リザーブ等の「コア除去効果でない」パスは bonus 対象外
 *   (10_rules/06 line 120: ライフ→リザーブは「コア除去効果」と別扱い)。
 * - 受益プレイヤーは「自分」、源側 (修飾発揮元) はフィールドの自分のスピリット必須。
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeCoreMove } from "../src/effect/structured-effect-interpreter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState, CardInstance } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const YUUGEN = "BSTH001-転醒R02(A)";
const PLAYER = "player-1";
const OPP = "player-2";

function placeYuugen(level: number, normalCoreCount: number): CardInstance {
  return createCardInstance(getDef(YUUGEN)!, {
    ownerPlayerId: PLAYER,
    zone: "field",
    instanceId: "yuugen-1",
    normalCoreCount,
    currentLevel: level,
  });
}

function opponentTarget(normalCoreCount: number): CardInstance {
  // 相手のスピリット (任意の cardNo を流用: 同弾の召喚時非対称が無いカードを選ぶ)。
  // 実 cardNo: BSTH001-C03 等が手近。definitionId は spirit カテゴリならよい。
  return createCardInstance(getDef("BSTH001-C03")!, {
    ownerPlayerId: OPP,
    zone: "field",
    instanceId: "opp-target",
    normalCoreCount,
  });
}

function setupState(yuugenLevel: number, targetCores: number): GameState {
  const state = createEmptyGameState({
    playerIds: [PLAYER, OPP],
    cardInstances: [placeYuugen(yuugenLevel, 4), opponentTarget(targetCores)],
  });
  return rebuildContinuousEffectsFromField(state, getDef);
}

describe("BSTH001-転醒R02(A) コア除去効果 移動コア数+1 (core_move_amount_modifier)", () => {
  it("card data: core_move_amount_modifier 継続効果を持ち stub が消えている", () => {
    const def = getDef(YUUGEN)!;
    const hasModifier = def.effects?.some((e) =>
      e.steps.some((s) => s.action.kind === "core_move_amount_modifier")
    );
    expect(hasModifier).toBe(true);
    // effect[1] の stub のみ消えていればよい
    // (他効果に stub があってもこの修正の範囲外)
    const targetEffect = def.effects?.find((e) =>
      e.steps.some((s) => s.action.kind === "core_move_amount_modifier")
    );
    expect(targetEffect?.stub).toBeUndefined();
  });

  it("Lv2 で core_move_amount_modifier CE が登録される (rebuild は applicability を見ない)", () => {
    const state = setupState(2, 3);
    const ce = state.activeContinuousEffects.find(
      (e) => e.modifierTag === "core_move_amount_modifier"
    );
    expect(ce).toBeDefined();
    expect(ce?.modifierAmount).toBe(1);
    expect(ce?.metadata?.coreMoveAmountScope).toBe("self_player_spirits");
    expect(ce?.actingPlayerId).toBe(PLAYER);
  });

  it("コア除去効果 (相手カード source → reserve) の amount に +1 加算 (base 1 → 2)", () => {
    const state = setupState(2, 3);
    const after = executeCoreMove(
      state,
      PLAYER,
      { kind: "card_instance", instanceId: "opp-target" },
      { kind: "reserve", player: "opponent" },
      1,
      "yuugen-1",
      undefined,
      undefined,
      getDef
    );
    const target = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    // 元 3 個 → 2 個 移動 → 残 1 個
    expect(target.normalCoreCount).toBe(1);
    // ログ確認: applied:+1:base=1
    expect(
      after.log.some((l) =>
        l.startsWith("effect:core_move_amount_modifier:applied:")
      )
    ).toBe(true);
  });

  it("ボーナス込みでも対象コア数を超えない (available cap)", () => {
    // 対象 1 個しかなければ amount 1 + bonus 1 = 2 でも 1 個のみ移動
    const state = setupState(2, 1);
    const after = executeCoreMove(
      state,
      PLAYER,
      { kind: "card_instance", instanceId: "opp-target" },
      { kind: "reserve", player: "opponent" },
      1,
      "yuugen-1",
      undefined,
      undefined,
      getDef
    );
    const target = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    expect(target.normalCoreCount).toBe(0);
  });

  it("ユウゲン不在では bonus なし (素の amount のみ)", () => {
    const state = createEmptyGameState({
      playerIds: [PLAYER, OPP],
      cardInstances: [opponentTarget(3)],
    });
    const after = executeCoreMove(
      state,
      PLAYER,
      { kind: "card_instance", instanceId: "opp-target" },
      { kind: "reserve", player: "opponent" },
      1,
      "opp-target", // dummy
      undefined,
      undefined,
      getDef
    );
    const target = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    expect(target.normalCoreCount).toBe(2);
  });

  it("field 源コアシュート (相手フィールド全体) にも +1 加算 (BSTH001-X01 型: 2個 → 3個移動)", () => {
    // BSTH001-X01[3,4] 「相手のフィールド/リザーブのコア2個をボイドに置く」型を再現。
    // ユウゲン在場で field 源コアシュートも bonus を受け、effectiveAmount 2+1=3 になる。
    // 相手フィールドカードは候補1枚のみ・available=4 で auto-fallback 経路。
    const state = createEmptyGameState({
      playerIds: [PLAYER, OPP],
      cardInstances: [placeYuugen(2, 4), opponentTarget(4)],
    });
    const seeded = rebuildContinuousEffectsFromField(state, getDef);
    const after = executeCoreMove(
      seeded,
      PLAYER,
      { kind: "field", player: "opponent" },
      { kind: "void" },
      2, // base 2 → +1 = 3
      "yuugen-1",
      undefined,
      undefined,
      getDef
    );
    const target = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    // 4 - 3 = 1
    expect(target.normalCoreCount).toBe(1);
    expect(
      after.log.some(
        (l) =>
          l.startsWith("effect:core_move_amount_modifier:applied:") &&
          l.endsWith(":field")
      )
    ).toBe(true);
  });

  it("field 源コアシュートで複数候補の場合は pending を生成し、totalAmount に bonus 反映", () => {
    // 候補が2枚あれば自動解決せず pendingCoreShootSelection を生成する。
    // pending.totalAmount は base 2 + bonus 1 = 3 を反映する。
    const opp2 = createCardInstance(getDef("BSTH001-C03")!, {
      ownerPlayerId: OPP,
      zone: "field",
      instanceId: "opp-target-2",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, OPP],
      cardInstances: [placeYuugen(2, 4), opponentTarget(3), opp2],
    });
    const seeded = rebuildContinuousEffectsFromField(state, getDef);
    const after = executeCoreMove(
      seeded,
      PLAYER,
      { kind: "field", player: "opponent" },
      { kind: "void" },
      2, // base 2 → +1 = 3
      "yuugen-1",
      undefined,
      undefined,
      getDef
    );
    expect(after.pendingCoreShootSelection).not.toBeNull();
    expect(after.pendingCoreShootSelection?.totalAmount).toBe(3);
  });

  it("自分のカード (= 自分の source 上のコア移動) には bonus なし — 「コア除去効果」=相手カード源限定", () => {
    // 修飾源 (yuugen) は自側スピリットだが、from が自分カードなら「コア除去効果」ではない
    const state = setupState(2, 3);
    // ユウゲン自身を source に、ユウゲン自身のコアを移動 → 自分→自分なので bonus 加算しない
    const after = executeCoreMove(
      state,
      PLAYER,
      { kind: "card_instance", instanceId: "yuugen-1" },
      { kind: "reserve", player: "self" },
      1,
      "yuugen-1",
      undefined,
      undefined,
      getDef
    );
    // bonus なしなので 1 個のみ
    const yuugen = after.cardInstances.find(
      (c) => c.instanceId === "yuugen-1"
    )!;
    expect(yuugen.normalCoreCount).toBe(3); // 4 - 1
  });
});
