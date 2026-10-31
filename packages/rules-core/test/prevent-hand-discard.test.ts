/**
 * 手札破棄耐性 prevent_hand_discard CE の検証。
 *
 * プリミティブ:
 *  - 継続効果 prevent_hand_discard が player-scoped CE を登録する
 *    (targetInstanceId = 保護対象 playerId)。executeDiscardHand が
 *    **acting プレイヤーが保護対象の相手のとき**だけ、ゲートが成立する間、
 *    対象の手札カードを破棄対象から除外する (手札全体が破棄不能)。
 *  - 動的ゲート (解決直前に再評価):
 *      handCountMax: 保護対象の手札枚数がこの値以下のときのみ有効 (「手札5枚以下の間」)。
 *      minSourceCores: 発揮元カードの通常コアがこの値以上のときのみ有効 (「コア1個以上のとき」)。
 *  - 自分自身の効果による手札破棄 (コスト自捨て等) は止めない。
 *
 * ルール正源: カード本文 (BSFT01-C03 星霊界 [5,6]「このネクサスのコアが1個以上のとき、
 *   自分の手札は5枚以下の間、相手によって破棄されない」)。手札ゾーンへの耐性付与は
 *   プレイヤー耐性 (P3-77) とは別系統で、本文が明示する手札カード対象の破棄不能。
 *
 * 解禁カード: BSFT01-C03 星霊界 [5,6]。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeDiscardHand } from "../src/effect/structured-effect-interpreter";
import type { DiscardHandAction } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

const FILLER = "BSRK01-C03";

/** 任意プレイヤー視点で continuous 効果を発揮する。 */
function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId = ALICE
): GameState {
  return executeEffect({
    chainId: "test:prevent-hand-discard:52",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

/**
 * 星霊界の手札破棄耐性効果 ([5,6]) を保有する盤面を組む。
 * @param sourceCores ネクサスの通常コア数 (minSourceCores ゲート用)。
 * @param handSize ALICE の手札枚数。
 */
function setup(sourceCores: number, handSize: number): GameState {
  const src = createCardInstance(card("BSFT01-C03"), {
    instanceId: "seireikai",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: sourceCores,
  });
  const hand = Array.from({ length: handSize }, (_, i) =>
    createCardInstance(card(FILLER), {
      instanceId: `alice-hand-${i}`,
      ownerPlayerId: ALICE,
      zone: "hand",
    })
  );
  let state = createEmptyGameState({
    cardInstances: [src, ...hand],
    playerOverrides: [{ handCount: handSize }, {}],
  });
  // [5,6] 継続効果を発揮して CE を登録。
  state = runEffect(state, card("BSFT01-C03").effects![2]!, "seireikai");
  return state;
}

/** 相手 (BOB) が ALICE の手札 N 枚を破棄する効果を実行する。 */
function opponentDiscard(state: GameState, count: number): GameState {
  const action: DiscardHandAction = {
    kind: "discard_hand",
    count,
    targetPlayer: "opponent", // acting=BOB から見て opponent=ALICE
    unseen: true, // 選択モーダルを介さず強制破棄経路で確定
  };
  return executeDiscardHand(state, BOB, action, getDef, "bob-src");
}

const aliceHand = (s: GameState) =>
  s.cardInstances.filter((c) => c.ownerPlayerId === ALICE && c.zone === "hand");

describe("prevent_hand_discard (手札破棄耐性)", () => {
  it("DSL: BSFT01-C03 [5,6] は continuous prevent_hand_discard (minSourceCores=1, handCountMax=5)", () => {
    const c = card("BSFT01-C03");
    const eff = c.effects![2]!;
    expect(eff.timing).toEqual({ kind: "continuous" });
    expect(eff.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(eff.steps[0]!.action).toEqual({
      kind: "prevent_hand_discard",
      player: "self",
      minSourceCores: 1,
      handCountMax: 5,
      duration: { scope: "while_on_field" },
    });
  });

  it("登録: CE が player-scoped (targetInstanceId=ALICE) で metadata にゲートを保持", () => {
    const state = setup(1, 3);
    const ce = state.activeContinuousEffects.find(
      (e) => e.modifierTag === "prevent_hand_discard"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe(ALICE);
    expect(ce!.metadata).toMatchObject({ handCountMax: 5, minSourceCores: 1 });
  });

  it("[board] コア1個以上・手札5枚以下なら相手の破棄を全て弾く (no-op)", () => {
    const state = setup(1, 3);
    const after = opponentDiscard(state, 2);
    // 1枚も破棄されない。
    expect(aliceHand(after)).toHaveLength(3);
    expect(alice(after).handCount).toBe(3);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "trash"
      )
    ).toHaveLength(0);
  });

  it("[board] 手札が5枚を超える間は耐性が外れ、相手が破棄できる", () => {
    const state = setup(1, 7); // 手札7枚 > handCountMax(5)
    const after = opponentDiscard(state, 2);
    expect(aliceHand(after)).toHaveLength(5);
    expect(alice(after).handCount).toBe(5);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "trash"
      )
    ).toHaveLength(2);
  });

  it("[board] ネクサスのコアが0個なら耐性が成立せず、相手が破棄できる", () => {
    const state = setup(0, 3); // コア0 < minSourceCores(1)
    const after = opponentDiscard(state, 2);
    expect(aliceHand(after)).toHaveLength(1);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "trash"
      )
    ).toHaveLength(2);
  });

  it("[board] 自分自身の効果による手札破棄 (コスト自捨て等) は止めない", () => {
    const state = setup(1, 3);
    // ALICE 自身が自分の手札を破棄 (acting=ALICE, target=self)。
    const action: DiscardHandAction = {
      kind: "discard_hand",
      count: 1,
      unseen: true,
    };
    const after = executeDiscardHand(state, ALICE, action, getDef, "seireikai");
    expect(aliceHand(after)).toHaveLength(2);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "trash"
      )
    ).toHaveLength(1);
  });
});
