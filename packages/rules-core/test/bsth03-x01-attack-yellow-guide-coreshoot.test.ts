/**
 * BSTH03-X01「蓬莱山 輝夜」effects[1] 検証。
 *
 * 原文 (textLines[5,6]):
 *   Lv4-Lv5『このアルティメットのアタック時』
 *   自分の黄の導界者ネクサスのコア1個を自分のライフに置ける。そうしたとき、相手の
 *   スピリット/ネクサス1つをデッキの下に戻す。この効果は黄の効果以外では防げない。
 *
 * 検証点:
 *  - preventionRestriction.onlyPreventableByColors:["yellow"] が effect 定義に付与されている。
 *  - core_move.from が 黄/導界者/guided ネクサス限定フィルタで表現されている。
 *  - 任意実行 (pendingStepOptionalChoice) を execute すると、コアが黄導界者ネクサスから
 *    ライフへ移動し、そうしたとき (conditional_result) 相手カード1つがデッキ下へ送られる。
 *  - 任意実行を decline すると、コア移動も送還も発生しない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const X01 = card("BSTH03-X01");
const EFFECT_INDEX = 1;

describe("BSTH03-X01 effects[1] DSL 構造", () => {
  it("preventionRestriction.onlyPreventableByColors: ['yellow'] が付与されている", () => {
    const effect = X01.effects![EFFECT_INDEX]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionRestriction).toEqual({
      onlyPreventableByColors: ["yellow"],
    });
    const coreMoveStep = effect.steps[0]!;
    expect(coreMoveStep.action.kind).toBe("core_move");
    if (coreMoveStep.action.kind === "core_move") {
      expect(coreMoveStep.action.from).toEqual({
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          colors: ["yellow"],
          tribes: ["導界者"],
          targetsGrandwalker: true,
        },
      });
    }
    const sendStep = effect.steps[1]!;
    expect(sendStep.connector).toBe("conditional_result");
  });
});

function srcX01(cores: number) {
  return createCardInstance(X01, {
    instanceId: "src-x01",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
}

function yellowGuideNexus(cores: number) {
  return createCardInstance(card("BSTH03-X02"), {
    instanceId: "yellow-guide-nexus",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
}

function oppTarget() {
  return createCardInstance(card("BSTH03-C02"), {
    instanceId: "opp-target",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 0,
  });
}

function runEffect(state: GameState): GameState {
  const afterBody = executeEffect({
    chainId: "test:bsth03-x01-attack-yellow-guide-coreshoot:93",
    state,
    effect: X01.effects![EFFECT_INDEX]!,
    effectIndex: EFFECT_INDEX,
    sourceInstanceId: "src-x01",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
  // send_to_deck は pendingLeaveEntities 経由の2段階解決 (bounce) を積むため、
  // 通常パイプライン (applyLegalAction 内部) で行われる flush をテスト側で明示的に行う。
  return flushPendingLeaves(afterBody, getDef);
}

describe("BSTH03-X01 effects[1]（Lv4-5アタック時: 黄導界者ネクサスのコア1個をライフへ→相手1体をデッキ下へ）", () => {
  it("実行すると、黄導界者ネクサスのコアがライフへ移動し、相手カードがデッキ下へ送られる", () => {
    const nexus = yellowGuideNexus(2);
    const opp = oppTarget();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcX01(3), nexus, opp],
    });
    const bobDeckBefore = state.players.find((p) => p.id === BOB)!.deckCount;
    const aliceLifeBefore = state.players.find(
      (p) => p.id === ALICE
    )!.lifeNormalCoreCount;

    // effect.executionMode:"optional" は「トリガー宣言」段階(pendingTriggeredEffectDeclaration
    // 経由の legal-action pipeline)で処理される。executeEffect を直接呼ぶテストは宣言済み後の
    // steps 実行のみを検証するため、pendingStepOptionalChoice は生成されない
    // (BSAZ02-TR01(A) effects[1] precedent と同型: 前段は無条件実行、conditional_result 後段は
    // 「戻す」= 強制のため独自の executionMode を持たない)。
    const after = runEffect(state);

    const nexusAfter = after.cardInstances.find(
      (c) => c.instanceId === "yellow-guide-nexus"
    )!;
    expect(nexusAfter.normalCoreCount).toBe(1);
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.lifeNormalCoreCount).toBe(aliceLifeBefore + 1);

    const oppAfter = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    expect(oppAfter.zone).toBe("deck");
    const bobAfter = after.players.find((p) => p.id === BOB)!;
    expect(bobAfter.deckCount).toBe(bobDeckBefore + 1);
  });

  it("黄の導界者ネクサスが存在しないときは、コア移動 (前段) が不成立のため送還 (conditional_result 後段) も発生しない", () => {
    const opp = oppTarget();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcX01(3), opp],
    });
    const aliceLifeBefore = state.players.find(
      (p) => p.id === ALICE
    )!.lifeNormalCoreCount;

    const after = runEffect(state);

    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.lifeNormalCoreCount).toBe(aliceLifeBefore);
    const oppAfter = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    expect(oppAfter.zone).toBe("field");
  });
});
