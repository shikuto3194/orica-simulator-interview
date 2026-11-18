/**
 * BSTH05-R01 河城 にとり effects[1] 離脱置換効果の検証。
 *
 * 原文 (textLines[3,4]):
 *   "Lv2"
 *   "系統：「風神」を持つ自分のコスト4/5/6のスピリットが相手の効果でフィールドを
 *    離れるとき、コストを支払うことで、支払ったコスト1につきそのスピリット1体は
 *    同じ状態でフィールドに残る。"
 *
 * SSOT 流用: 「相手の効果で離れるとき、コストを払うことで残る」型は BSLH01-R01「駆動」
 *   effects[0] (card_event(leave_field)+core_move cost+stay_on_field(self)) と同型。
 *   本カードは対象が「自分の風神スピリット」全般 (自身に限らない) のため、対象観測に
 *   third-party game_event(player:"self")+triggerFilter を使う BSLH01-C08 型に、cost を
 *   core_move ではなく PayCostAction(pay_cost) に差し替えた組み合わせ。
 *   flushPendingLeaves は PendingLeaveEntity ごとに離脱イベントを発火するため
 *   (state-based-actions.ts の `for (const pendingLeave of pendingLeaves)`)、
 *   複数体同時離脱でも対象ごとに独立して pay_cost(1)+stay_on_field が誘発し、
 *   「支払ったコスト1につき1体」は自然に成立する。
 *
 * 検証ポイント (shape):
 *   - timing: game_event(player:"self", leave_field, triggerFilter:{spirit,風神,cost4-6}, cause:[opponent_effect])
 *   - condition: min_level 2 (河城にとり自身の Lv)
 *   - executionMode: "optional"
 *   - steps[0] = pay_cost amount:1 / steps[1] = stay_on_field(trigger_related_instance, includePendingLeave:true) + conditional_cost
 *   - stub フィールドが削除されている
 *
 * 挙動 (happy path):
 *   - alice reserve 1 + pendingLeave 中の対象スピリット (風神/コスト4): pay_cost で reserve→trash 1、
 *     対象は pendingLeave 解除・フィールド残置
 *
 * 挙動 (fail-closed):
 *   - alice reserve 0 + フィールド支払い禁止: conditional_cost ロールバックで pendingLeave 据え置き
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState, ContinuousEffect } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH05-R01 河城 にとり effects[1] 離脱置換 (pay_cost → stay_on_field)", () => {
  const c = cardNoMap.get("BSTH05-R01")!;

  // ========== shape 検証 ==========
  it("timing は game_event(leave_field) + triggerFilter(spirit/風神/cost4-6) + cause:['opponent_effect']", () => {
    const e = c.effects![1]!;
    expect(e.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      triggerFilter: {
        category: ["spirit"],
        tribes: ["風神"],
        minCost: 4,
        maxCost: 6,
      },
      cause: ["opponent_effect"],
    });
  });

  it("executionMode:'optional' + min_level:2 condition", () => {
    const e = c.effects![1]!;
    expect(e.executionMode).toBe("optional");
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
  });

  it("step0 = pay_cost amount:1 / step1 = stay_on_field(trigger_related_instance) + conditional_cost", () => {
    const e = c.effects![1]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("pay_cost");
    if (step0.action.kind === "pay_cost") {
      expect(step0.action.amount).toBe(1);
    }
    const step1 = e.steps[1]!;
    expect(step1.action.kind).toBe("stay_on_field");
    if (step1.action.kind === "stay_on_field") {
      expect(step1.action.target).toEqual({
        kind: "trigger_related_instance",
        includePendingLeave: true,
      });
    }
    expect(step1.connector).toBe("conditional_cost");
  });

  it("stub フィールドは削除されている", () => {
    expect(c.effects![1]!.stub).toBeUndefined();
  });

  // ========== 挙動検証 ==========
  // にとり自身 (Lv2 = 3コア必要) を効果ソースに、別の風神コスト4スピリットを離脱対象にする。
  function setupState(aliceReserve: number): {
    state: GameState;
    nitoriId: string;
    targetId: string;
  } {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: aliceReserve }, {}],
    });
    const nitori = createCardInstance(c, {
      instanceId: "nitori-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const target = createCardInstance(c, {
      instanceId: "kaku-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-r01-leave",
    });
    const state: GameState = {
      ...base,
      cardInstances: [nitori, target],
      pendingLeaveEntities: [
        {
          instanceId: "kaku-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-r01-leave",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    return { state, nitoriId: nitori.instanceId, targetId: target.instanceId };
  }

  it("alice reserve 1: pay_cost で1コア消費 + 対象がフィールドに残置される", () => {
    const { state, nitoriId, targetId } = setupState(1);
    const result = executeEffect({
      chainId: "test:bsth05-r01-leave-field-cost-stay:144",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: nitoriId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: targetId,
    });
    const target = result.cardInstances.find((x) => x.instanceId === targetId)!;
    expect(target.zone).toBe("field");
    expect(target.pendingLeaveKind).toBeNull();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
  });

  it("alice reserve 0: フィールド3コアから1コストを支払い、離脱を置換する", () => {
    const { state, nitoriId, targetId } = setupState(0);
    const result = executeEffect({
      chainId: "test:bsth05-r01-leave-field-cost-stay:161",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: nitoriId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: targetId,
    });
    const target = result.cardInstances.find((x) => x.instanceId === targetId)!;
    expect(target.pendingLeaveKind).toBeNull();
    expect(
      result.cardInstances.find((x) => x.instanceId === nitoriId)!
        .normalCoreCount
    ).toBe(2);
    expect(
      result.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(1);
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === targetId)
    ).toBeUndefined();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
  });

  it("リザーブ0かつフィールド支払い禁止なら離脱を置換せず、コアも動かさない", () => {
    const { state, nitoriId, targetId } = setupState(0);
    const restricted: GameState = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "restrict-field-payment",
          sourceInstanceId: targetId,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          targetInstanceId: "alice",
          modifierTag: "restrict_field_cost_payment",
          metadata: {},
        } as ContinuousEffect,
      ],
    };
    const result = executeEffect({
      chainId: "test:nitori-field-payment-restricted",
      state: restricted,
      effect: c.effects![1]!,
      sourceInstanceId: nitoriId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: targetId,
    });
    expect(
      result.cardInstances.find((x) => x.instanceId === targetId)!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === targetId)
    ).toBeDefined();
    expect(
      result.cardInstances.find((x) => x.instanceId === nitoriId)!
        .normalCoreCount
    ).toBe(3);
    expect(
      result.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(0);
  });
});
