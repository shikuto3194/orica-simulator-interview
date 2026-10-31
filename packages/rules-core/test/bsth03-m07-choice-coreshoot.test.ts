/**
 * BSTH03-M07 [永夜抄]西行寺 幽々子 — Lv3-Lv4『召喚/破壊時』二択（コントローラ選択）
 *   「相手のスピリットのコア２個を相手のリザーブに置く。または、相手の手札1枚を
 *    内容を見ないで破棄する。」
 *
 * 従来は 4 effects（召喚/破壊 × コアシュート/破棄）が常に全部発火する誤実装で、
 * かつ破棄は player 省略＝自分の手札を捨てるバグだった。EffectStep.choice で
 *   choiceIndex 0 = 単一対象コアシュート（core_move.target + from:target_card、固定2個、
 *     BSTH001-転醒R02(A) 同型・[[project_single_target_coreshoot]]）
 *   choiceIndex 1 = 相手のランダム破棄（discard player:opponent count:1）
 * の択一に統合した。board 変化で各分岐を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const bob = (s: GameState) => s.players.find((p) => p.id === BOB)!;

const m07 = card("BSTH03-M07");
const summonEffect = m07.effects!.find(
  (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
)!;
const destroyEffect = m07.effects!.find(
  (e) => e.timing.kind === "card_event" && e.timing.event === "destroy"
)!;

describe("BSTH03-M07 幽々子 — 召喚/破壊時 二択 (コアシュート or 破棄)", () => {
  it("構造: 召喚/破壊 とも 1 effect・primary=単一対象コアシュート, choice[0]=相手ランダム破棄, stub なし", () => {
    for (const eff of [summonEffect, destroyEffect]) {
      expect(eff.stub).toBeUndefined();
      const step = eff.steps[0]!;
      const move = step.action;
      expect(move.kind).toBe("core_move");
      if (move.kind === "core_move") {
        expect(move.from).toEqual({ kind: "target_card" });
        expect(move.target).toMatchObject({
          kind: "filter",
          player: "opponent",
          count: 1,
        });
        expect(move.to).toEqual({ kind: "reserve", player: "opponent" });
        expect(move.amount).toBe(2);
      }
      const alt = step.choice?.[0]?.action;
      expect(alt?.kind).toBe("discard");
      if (alt?.kind === "discard") {
        expect(alt.player).toBe("opponent");
        expect(alt.count).toBe(1);
        expect(alt.unseen).toBe(true);
      }
    }
    // 旧実装の「破棄が常に発火する 2 本目の effect」が残っていないこと。
    const summonEffects = m07.effects!.filter(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    );
    expect(summonEffects).toHaveLength(1);
  });

  it("[board] choiceIndex 0: 選んだ相手スピリット1体のコア2個のみが相手リザーブへ移る", () => {
    const src = createCardInstance(m07, {
      instanceId: "yuyuko",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const tgt = createCardInstance(card("BSTH001-R01"), {
      instanceId: "enemy-tgt",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const other = createCardInstance(card("BSTH001-R02"), {
      instanceId: "enemy-other",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      cardInstances: [src, tgt, other],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const after = executeEffect({
      chainId: "test:bsth03-m07-choice-coreshoot:96",
      state: before,
      effect: summonEffect,
      sourceInstanceId: "yuyuko",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-tgt"],
      choiceIndex: 0,
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === "enemy-tgt")!
        .normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find((x) => x.instanceId === "enemy-other")!
        .normalCoreCount
    ).toBe(2);
    expect(bob(after).reserveNormalCoreCount).toBe(2);
  });

  it("[board] choiceIndex 1: 相手の手札が1枚減り（ランダム破棄）、相手のコアは不変", () => {
    const src = createCardInstance(m07, {
      instanceId: "yuyuko",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const tgt = createCardInstance(card("BSTH001-R01"), {
      instanceId: "enemy-tgt",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const hand1 = createCardInstance(card("BSTH001-R02"), {
      instanceId: "bob-hand-1",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const hand2 = createCardInstance(card("BSTH001-R01"), {
      instanceId: "bob-hand-2",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [src, tgt, hand1, hand2],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const after = executeEffect({
      chainId: "test:bsth03-m07-choice-coreshoot:144",
      state: before,
      effect: summonEffect,
      sourceInstanceId: "yuyuko",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
    });
    const bobHand = after.cardInstances.filter(
      (x) => x.ownerPlayerId === BOB && x.zone === "hand"
    );
    expect(bobHand).toHaveLength(1);
    // 破棄分岐ではコアシュートは起きない。
    expect(
      after.cardInstances.find((x) => x.instanceId === "enemy-tgt")!
        .normalCoreCount
    ).toBe(3);
    expect(bob(after).reserveNormalCoreCount).toBe(0);
  });
});
