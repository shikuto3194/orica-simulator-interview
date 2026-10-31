/**
 * BSTH02-X02 西行寺 幽々子 effects[0] 離脱置換効果の検証。
 *
 * 原文 (textLines[0,1]):
 *   "Lv2-Lv3"
 *   "このスピリットが相手によってフィールドを離れるとき、相手のライフのコア1個を
 *    このスピリットに置くことで、回復状態でフィールドに残る。"
 *
 * SSOT 流用: BSLH01-R01 effects[0] (相手によって離脱→ボイドコア1個→回復状態で残る) の cost を
 *   「ボイドからコア」→「相手のライフからコア」へ差し替えただけで構造は同じ。
 *   BSTH02-X05 effects[1] (「相手の効果で」cause:"opponent_effect" 単独) との対比で、本効果は
 *   「相手によって」= cause:["opponent_effect","battle"] (バトル消滅もカバー)。
 *
 * 検証ポイント (shape):
 *   - timing.cause = ["opponent_effect","battle"] (「相手によって」の厳密マッピング)
 *   - executionMode: "optional" (プレイヤーは支払いを辞退可能)
 *   - condition: min_level 2
 *   - steps[0] = core_move from opponent.life to this_card amount:1
 *   - steps[1] = stay_on_field newExhaustState:"recovered" + connector:"conditional_cost"
 *   - stub フィールドが削除されている
 *
 * 挙動 (happy path):
 *   - 相手 life コア 5 + Lv2 + pendingLeave (cause:"effect_resolution"): 1 コア移動 + field 残置 (recovered)
 *
 * 挙動 (fail-closed):
 *   - 相手 life コア 0 + Lv2: conditional_cost ロールバックで stay_on_field 不発火 (pendingLeave 据え置き)
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH02-X02 西行寺 幽々子 effects[0] 離脱置換 (opponent life core → stay recovered)", () => {
  const c = cardNoMap.get("BSTH02-X02")!;

  // ========== shape 検証 ==========
  it("timing は leave_field + cause:['opponent_effect','battle']", () => {
    const e = c.effects![0]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
  });

  it("executionMode:'optional' + min_level:2 condition", () => {
    const e = c.effects![0]!;
    expect(e.executionMode).toBe("optional");
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
  });

  it("step0 = core_move from opponent.life to this_card amount:1", () => {
    const e = c.effects![0]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("core_move");
    if (step0.action.kind === "core_move") {
      expect(step0.action.from).toEqual({ kind: "life", player: "opponent" });
      expect(step0.action.to).toEqual({ kind: "this_card" });
      expect(step0.action.amount).toBe(1);
    }
  });

  it("step1 = stay_on_field newExhaustState:'recovered' + connector:'conditional_cost'", () => {
    const e = c.effects![0]!;
    const step1 = e.steps[1]!;
    expect(step1.action.kind).toBe("stay_on_field");
    if (step1.action.kind === "stay_on_field") {
      expect(step1.action.newExhaustState).toBe("recovered");
      expect(step1.action.target).toEqual({ kind: "self" });
    }
    expect(step1.connector).toBe("conditional_cost");
  });

  it("stub フィールドは削除されている (ENGINE-core-move-from-life-to-this_card-soul-cross-player 解消)", () => {
    const e = c.effects![0]!;
    // cross-player soul 移転は option b (soul 除外、normal-only) を最終設計として採用済。
    // 相手ライフが soul のみの edge case は intentional な仕様であり stub ではない。
    expect(e.stub).toBeUndefined();
  });

  // ========== 挙動検証 ==========
  // Lv2 = 3 cores 必要（levelDefs[1].requiredCores=3）。
  function setupAt(level2Cores: number, opponentLifeCores: number): GameState {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { lifeNormalCoreCount: 5 },
        { lifeNormalCoreCount: opponentLifeCores },
      ],
    });
    const self = createCardInstance(c, {
      instanceId: "yuyuko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: level2Cores,
      exhaustState: "exhausted",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-x02-leave",
    });
    return {
      ...base,
      cardInstances: [self],
      pendingLeaveEntities: [
        {
          instanceId: "yuyuko-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-x02-leave",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
  }

  it("相手 life コア 5 + Lv2: 1 コア移動 + field 残置 (recovered)", () => {
    const state = setupAt(3, 5);
    const result = executeEffect({
      chainId: "test:bsth02-x02-leave-field-lifecost-stay:130",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "yuyuko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((x) => x.instanceId === "yuyuko-1")!;
    expect(inst.zone).toBe("field");
    expect(inst.exhaustState).toBe("recovered");
    expect(inst.pendingLeaveKind).toBeNull();
    // 自カード上にコアが 1 個追加されている (元 3 + 1)。
    expect(inst.normalCoreCount).toBe(4);
    // 相手のライフコアが 1 個減っている (元 5 - 1)。
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(4);
  });

  it("相手 life コア 0 + Lv2: conditional_cost ロールバックで離脱続行", () => {
    const state = setupAt(3, 0);
    const result = executeEffect({
      chainId: "test:bsth02-x02-leave-field-lifecost-stay:150",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "yuyuko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((x) => x.instanceId === "yuyuko-1")!;
    // core_move 不能 → conditional_cost で stay_on_field がスキップされ、pendingLeave 据え置き。
    expect(inst.pendingLeaveKind).toBe("destroy");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "yuyuko-1")
    ).toBeDefined();
    // 相手のライフは減らない。
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(0);
  });
});
