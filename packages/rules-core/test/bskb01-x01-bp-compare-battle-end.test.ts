/**
 * BSKB01-X01「[英雄を討ち倒し者]メタナイト」effects[1] 検証。
 *
 * 原文: 【OC中＆煌臨中】Lv1-Lv2-Lv3『このスピリットのアタック時』
 *   「バトル終了時、相手のスピリット/アルティメット1体とこのスピリットのBPを比べられる。
 *    （BPが同じか低い対象が破壊される）相手の対象だけを破壊したとき、相手のライフのコア1個を
 *    リザーブに置ける。」
 *
 * 検証点:
 *  - bp_compare_destroy（源=このスピリット vs 相手1体）で「同じか低い」側が破壊される。
 *  - 後続の相手ライフ→リザーブのコア移動は「相手の対象だけを破壊したとき」=
 *    対象が場を離れた（ref_left_field）∧ 源が場に残っている（self_state:"on_field"）ときのみ。
 *    相討ち（同値で両破壊）のときは「だけ」が成立しないため発火しない。
 * ルール正源: カード本文。self_state:"on_field" は本イテレーションで追加した汎用条件句。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState, Effect } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getCombinedUnitBp } from "../src/legal/legal-actions-shared";

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

// BSKB01-X01 effects[1] の steps（bp_compare_destroy + 相手のみ破壊ゲートのコア移動）を、
// deferredTo:battle_end の遅延を介さず直接実行して step 合成（self_state:"on_field" ゲート）を検証する。
// deferredTo:battle_end の遅延自体は deferred-to-battle-end.test.ts が別途担保する。
//
// 実際の card.effects[1] を直接使い、firingBattleEndDeferral:true で deferredTo インターセプトを
// バイパス + effectIndex:1 で resume 時の effect lookup を一致させる
// （pendingStepOptionalChoice resume は cont.effectIndex で再 lookup するため、META 合成だと
// findEffectIndex fallback が 0 を返して別 effect を再開してしまう）。
const REAL_EFFECT_INDEX = 1;
const META_EFFECT: Effect = card("BSKB01-X01").effects[REAL_EFFECT_INDEX]!;

function srcMeta(cores: number) {
  // メタナイト Lv1=BP9000(1コア) / Lv2=16000(2) / Lv3=21000(4)
  // effects[1].condition は self_state:"advented" も要求する（adversarial verifier 反証で
  // effects[0] と同型の煌臨中ゲートが欠落していたと判明・engine-claude 2026-07-24 追加）。
  // この test は BP 比較破壊 steps の合成を検証する目的のため、condition は常に満たす。
  const base = createCardInstance(card("BSKB01-X01"), {
    instanceId: "src-meta",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  // createCardInstance は underCards オプションを受け付けない（常に []）ため生成後に上書きする
  // (bskb01-x01-oc-advent-coremove.test.ts の placeMetaknight と同じ convention)。
  return {
    ...base,
    underCards: [
      { cardInstanceId: "meta-src", role: "advent_source" as const },
    ],
  };
}

function run(state: GameState): GameState {
  let s = executeEffect({
    chainId: "test:bskb01-x01-bp-compare-battle-end:71",
    state,
    effect: META_EFFECT,
    effectIndex: REAL_EFFECT_INDEX,
    sourceInstanceId: "src-meta",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    firingBattleEndDeferral: true,
  });
  while (s.pendingStepOptionalChoice !== null) {
    const psoc = s.pendingStepOptionalChoice;
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
  }
  return s;
}

function baseState(cardInstances: ReturnType<typeof srcMeta>[]): GameState {
  return createEmptyGameState({
    cardInstances,
    // effects[1] の発揮条件 count_value(self) >= 7 を満たす。
    playerOverrides: [{ countValue: 7 }, {}],
  });
}

describe("BSKB01-X01 effects[1]（バトル終了時 BP 比較破壊 + 相手のみ破壊でライフコア除去）", () => {
  it("相手が低い（krillin 2000 ≤ OCメタナイト17000）: 相手のみ破壊・源は残り、相手ライフ→リザーブのコア移動が起きる", () => {
    const src = srcMeta(1); // BP 9000 + OC8000
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const after = run(baseState([src, opp]));

    const oppCard = after.cardInstances.find(
      (x) => x.instanceId === "opp-krillin"
    )!;
    const srcCard = after.cardInstances.find(
      (x) => x.instanceId === "src-meta"
    )!;
    // 相手のみ破壊（pendingLeave or 既にトラッシュ）、源は場に残る。
    expect(
      oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    expect(srcCard.zone).toBe("field");
    expect(srcCard.pendingLeaveKind).toBeNull();
    // 「相手の対象だけを破壊したとき」→ 相手ライフコア 5 → 4（1 個がリザーブへ）。
    // （リザーブは破壊された相手のコアも流入するため、ゲートの信号としてライフ枚数で判定する。）
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(4);
  });

  it.each([0, 7])(
    "相手カウント%s: OCのBP差で片側破壊、双方OCなら相討ち",
    (opponentCount) => {
      const src = srcMeta(1); // BP 9000 + OC8000
      const opp = createCardInstance(card("BSKB01-X01"), {
        instanceId: "opp-meta",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1, // BP 9000、相手もC7ならOC8000を加算
      });
      const state = baseState([src, opp]);
      state.players.find((p) => p.id === BOB)!.countValue = opponentCount;
      expect(getCombinedUnitBp(state, src, card("BSKB01-X01"), getDef)).toBe(
        17000
      );
      expect(getCombinedUnitBp(state, opp, card("BSKB01-X01"), getDef)).toBe(
        opponentCount === 7 ? 17000 : 9000
      );
      const after = run(state);

      const oppCard = after.cardInstances.find(
        (x) => x.instanceId === "opp-meta"
      )!;
      const srcCard = after.cardInstances.find(
        (x) => x.instanceId === "src-meta"
      )!;
      // OCを満たす側だけが高BP。両者OCなら同値で双方破壊。
      expect(
        oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
      ).toBe(true);
      expect(
        srcCard.zone !== "field" || srcCard.pendingLeaveKind === "destroy"
      ).toBe(opponentCount === 7);
      // 相討ち時のみ「相手だけ」不成立でライフコアは動かない。
      const bob = after.players.find((p) => p.id === BOB)!;
      expect(bob.lifeNormalCoreCount).toBe(opponentCount === 7 ? 5 : 4);
    }
  );
});
