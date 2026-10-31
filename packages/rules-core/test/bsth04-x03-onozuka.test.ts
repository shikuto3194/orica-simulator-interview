/**
 * BSTH04-X03 小野塚 小町 — 召喚/アタック時『カウント+1→そうしたとき相手1体のLvコスト+2』
 * + 『この効果で消滅したとき、ボイドからコア2個を自身に置く』
 * + Lv2-Lv3アタック時『導界者ネクサス2つへ1個ずつ置き、このスピリットは回復』。
 *
 * override_properties.levelCostDelta による対象1体選択 + 固定 delta（BSSL01-R01/
 * BSKB01-M01 precedent と同型）に、コア不足消滅の成立を ref_leave_established +
 * connector:"after_state_check" で接続し、誘発・魂状態選択より先にコアを置く。
 * count_increase → override_properties → (消滅時のみ) core_move という3ステップ構成。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src/effect/structured-condition-eval";

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

describe("BSTH04-X03 小野塚 小町 — カウント+1/相手Lvコスト+2/消滅連動コア配置", () => {
  const c = card("BSTH04-X03");
  const eff = c.effects![0]!;
  const attackEff = c.effects![1]!;

  it("構造: count_increase → override_properties(levelCostDelta:2, id付き) → after_state_check core_move。stub 解消済み", () => {
    expect(eff.stub).toBeUndefined();
    expect(eff.steps[0]!.action).toMatchObject({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    const lvStep = eff.steps[1]!;
    expect(lvStep.id).toBe("lv-cost-up");
    expect(lvStep.connector).toBe("conditional_result");
    expect(lvStep.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "count-up",
    });
    expect(lvStep.action).toMatchObject({
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate", "nexus"] },
        count: 1,
      },
      properties: { levelCostDelta: 2 },
      duration: { scope: "turn" },
    });
    const vanishStep = eff.steps[2]!;
    expect(vanishStep.connector).toBe("after_state_check");
    expect(vanishStep.stepCondition).toEqual({
      kind: "ref_leave_established",
      stepId: "lv-cost-up",
      leaveKind: "vanish",
    });
    expect(vanishStep.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
      amount: 2,
    });
  });

  function run(targetCores: number): { after: GameState } {
    const src = createCardInstance(c, {
      instanceId: "x03-src",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSTH001-R01"), {
      instanceId: "enemy-x03",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: targetCores,
    });
    const before = createEmptyGameState({
      cardInstances: [src, target],
      startingVoidNormalCoreCount: 10,
    });
    const after = executeEffect({
      chainId: "test:bsth04-x03-onozuka:95",
      state: before,
      effect: eff,
      sourceInstanceId: "x03-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["enemy-x03"],
    });
    return { after };
  }

  it("[board] 対象コア1個（実効Lv1コスト3で不足消滅）: 場を離れ、自身にコア2個が置かれ、カウント+1する", () => {
    const { after } = run(1);
    const tgt = after.cardInstances.find((x) => x.instanceId === "enemy-x03")!;
    expect(tgt.zone).toBe("field");
    expect(tgt.pendingLeaveKind).toBe("vanish");
    const src = after.cardInstances.find((x) => x.instanceId === "x03-src")!;
    expect(src.normalCoreCount).toBe(3); // 1 (初期) + 2 (消滅連動配置)
    expect(alice(after).countValue).toBe(1);
  });

  it("[board] 対象コア5個（実効Lv1コスト3を満たす）: 場に残り、自身へのコア配置は発生しない", () => {
    const { after } = run(5);
    const tgt = after.cardInstances.find((x) => x.instanceId === "enemy-x03")!;
    expect(tgt.zone).toBe("field");
    expect(tgt.normalCoreCount).toBe(5);
    const src = after.cardInstances.find((x) => x.instanceId === "x03-src")!;
    expect(src.normalCoreCount).toBe(1); // 変化なし
    expect(alice(after).countValue).toBe(1);
    const ce = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        ce.targetInstanceId === "enemy-x03"
    );
    expect(ce).toBeDefined();
  });

  it("構造: Lv2-Lv3アタック時は自分の起幻導界者ネクサス2つへ1個ずつ置き、自身を回復する。stub 解消済み", () => {
    expect(attackEff.stub).toBeUndefined();
    expect(attackEff.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(attackEff.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(attackEff.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(attackEff.steps[0]!.action).toEqual({
      kind: "core_distribute",
      from: { kind: "void", player: "self" },
      to: {
        kind: "filter",
        player: "self",
        filter: {
          category: ["nexus"],
          tribes: ["起幻"],
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
        count: 2,
      },
      amount: 2,
      mode: "one_each",
    });
    expect(attackEff.steps[1]).toEqual({
      action: {
        kind: "recover",
        target: { kind: "self" },
      },
      connector: "simultaneous",
    });
  });

  it.each([3, 4])(
    "[board] コア%s個のLv2/Lv3アタック時: ボイドから自分の起幻導界者ネクサス2つへ1個ずつ置き、小町だけを回復する",
    (cores) => {
      const src = createCardInstance(c, {
        instanceId: "x03-src",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: cores,
        exhaustState: "exhausted",
      });
      const yuyuko = createCardInstance(card("BSTH04-X01"), {
        instanceId: "guided-yuyuko",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const eiki = createCardInstance(card("BSTH04-XX01"), {
        instanceId: "guided-eiki",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const opponentGuided = createCardInstance(card("BSTH04-X01"), {
        instanceId: "opponent-guided",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 0,
      });
      const before = createEmptyGameState({
        cardInstances: [src, yuyuko, eiki, opponentGuided],
        startingVoidNormalCoreCount: 10,
      });

      const after = executeEffect({
        chainId: "test:bsth04-x03-onozuka:203",
        state: before,
        effect: attackEff,
        sourceInstanceId: "x03-src",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });

      expect(
        after.cardInstances.find((x) => x.instanceId === "guided-yuyuko")!
          .normalCoreCount
      ).toBe(1);
      expect(
        after.cardInstances.find((x) => x.instanceId === "guided-eiki")!
          .normalCoreCount
      ).toBe(2);
      expect(
        after.cardInstances.find((x) => x.instanceId === "opponent-guided")!
          .normalCoreCount
      ).toBe(0);
      const srcAfter = after.cardInstances.find(
        (x) => x.instanceId === "x03-src"
      )!;
      expect(
        evaluateCondition(
          before,
          attackEff.condition!,
          src.instanceId,
          ALICE,
          getDef
        )
      ).toBe(true);
      const lv1 = {
        ...before,
        cardInstances: before.cardInstances.map((card) =>
          card.instanceId === src.instanceId
            ? { ...card, normalCoreCount: 2 }
            : card
        ),
      };
      expect(
        evaluateCondition(
          lv1,
          attackEff.condition!,
          src.instanceId,
          ALICE,
          getDef
        )
      ).toBe(false);
      expect(srcAfter.normalCoreCount).toBe(cores);
      expect(srcAfter.exhaustState).toBe("recovered");
      expect(after.log).toContain(
        "effect:core_distribute:one_each:2cores->2targets"
      );
    }
  );
});
