/**
 * BSAZ02-C01「アルギュレ」effects[0,1,2] 検証。
 *
 * 原文 (textLines[4,5,7,8]):
 *   Lv3-Lv4-Lv5『このアルティメットのアタック/ブロック時』
 *   このアルティメットのBP以下の相手のスピリット/アルティメット1体を破壊する。自分の
 *   アタックステップにこの効果で破壊したとき、相手のライフのコア1個をリザーブに置く。
 *   これらの効果は相手の効果で防げない。
 *   Lv3-Lv4-Lv5【一騎打】『相手のアタックステップ開始時』
 *   このアルティメットと相手のスピリット1体のBPを比べ、BPが同じか低いスピリット/
 *   アルティメットが破壊され、相手のスピリットだけを破壊したとき、自分はデッキの上から
 *   1枚ドローする。
 *
 * 検証点:
 *  - effects[0] (attack): BP以下の相手1体を破壊し、破壊できたときのみ相手ライフから
 *    コア1個をリザーブへ移す (ref_succeeded ゲート、BSDB01.ts precedent 同型)。
 *  - effects[1] (block): 同じ破壊だがコア移動は付随しない。
 *  - effects[2] (一騎打): bp_compare_destroy で「相手のスピリットだけを破壊したとき」
 *    (ref_left_field ∧ self_state:on_field、BSKB01-X01 precedent 同型) にドロー1。
 *    相討ち（同値で両破壊）のときはドローが発火しない。
 *  - summonCondition (「ＣＦ」アルティメット0体、exact-zero field_has):
 *    structured-condition-eval.ts の `minCount = clause.minCount ?? 1` により
 *    minCount 省略時は既定1になり count=0 と常に矛盾するため、exact-zero を
 *    表現するには minCount:0 の明示が必須であることを実挙動で確認する
 *    （bsaz02-aldnoah-drive-card-tail cluster note が要検証としていた点）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src";
import { canSummonUltimate } from "../src/legal/legal-actions-shared";

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
const C01 = card("BSAZ02-C01");

function srcC01(cores: number) {
  const src = createCardInstance(C01, {
    instanceId: "src-c01",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-c01",
  });
}

function runEffect(state: GameState, effectIndex: number): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c01-alguile:79",
    state,
    effect: C01.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-c01",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

describe("BSAZ02-C01 effects[0]（アタック時: BP以下破壊 + 破壊時ライフコア1個リザーブ）", () => {
  it("Lv3(BP9000)以下の相手を破壊し、相手ライフから1個リザーブへ", () => {
    const src = srcC01(1); // Lv3, BP9000
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), opp],
    });
    const after = runEffect(state, 0);

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-krillin"
    )!;
    expect(
      oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(4);
  });
});

describe("BSAZ02-C01 effects[1]（ブロック時: BP以下破壊のみ、ライフコア移動は無し）", () => {
  it("破壊はするがライフコアは動かない", () => {
    const src = srcC01(1); // Lv3, BP9000
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), opp],
    });
    const after = runEffect(state, 1);

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-krillin"
    )!;
    expect(
      oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(5);
  });
});

describe("BSAZ02-C01 effects[2]（一騎打: BP比較破壊 + 相手のみ破壊でドロー1）", () => {
  it("相手が低い（クリリン2000 ≤ アルギュレ9000）: 相手のみ破壊・源は残り、ドローが発火する", () => {
    const src = srcC01(1); // Lv3, BP9000
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), opp],
    });
    const before = state.players.find((p) => p.id === ALICE)!.handCount;
    const after = runEffect(state, 2);

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-krillin"
    )!;
    const srcCard = after.cardInstances.find(
      (c) => c.instanceId === "src-c01"
    )!;
    expect(
      oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    expect(srcCard.zone).toBe("field");
    expect(srcCard.pendingLeaveKind).toBeNull();
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(before + 1);
  });

  it("同値（アルギュレ9000 = 悟空&ベジータ9000）: 相討ちで両破壊 → 「だけ」不成立でドローしない", () => {
    const src = srcC01(1); // Lv3, BP9000
    const opp = createCardInstance(card("BSDB01-TX01(A)"), {
      instanceId: "opp-gokuvegeta",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 9000（同値）
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), opp],
    });
    const before = state.players.find((p) => p.id === ALICE)!.handCount;
    const after = runEffect(state, 2);

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-gokuvegeta"
    )!;
    const srcCard = after.cardInstances.find(
      (c) => c.instanceId === "src-c01"
    )!;
    expect(
      oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    expect(
      srcCard.zone !== "field" || srcCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(before);
  });
});

describe("BSAZ02-C01 summonCondition（自分の系統：「ＣＦ」のアルティメット0体、exact-zero）", () => {
  it("自分の場に「ＣＦ」アルティメットが0体なら召喚可", () => {
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    expect(
      canSummonUltimate(state, ALICE, C01, getDef, {
        sourceInstanceId: "ult-hand",
        evaluateCondition,
      })
    ).toBe(true);
  });

  it("自分の場に「ＣＦ」アルティメットが1体でもいれば召喚不可", () => {
    const otherCf = createCardInstance(card("BSAZ02-C02"), {
      instanceId: "field-cf",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [otherCf],
    });
    expect(
      canSummonUltimate(state, ALICE, C01, getDef, {
        sourceInstanceId: "ult-hand",
        evaluateCondition,
      })
    ).toBe(false);
  });
});
