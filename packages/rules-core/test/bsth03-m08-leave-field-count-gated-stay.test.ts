/**
 * BSTH03-M08 [永夜抄]魂魄 妖夢 effects[1] 離脱残置効果の検証。
 *
 * 原文 (textLines[5,6]):
 *   "Lv3-Lv4"
 *   "このアルティメットが相手によってフィールドを離れるとき、相手のカウントが1以上なら、
 *    回復状態でフィールドに残ることができる。"
 *
 * ENGINE-leave-field-trigger-during-pending (2026-06-25 resolved) で pendingLeave 発生時の
 * card_event(leave_field) pre-flush emission が解消済みのため、SSOT 流用: BSSG01-M01[6] /
 * BSTH02-X05[1] と同型の card_event(leave_field, cause) + stay_on_field パターンで表現可能。
 * コストを伴わない単純な任意選択のため conditional_cost 連結は使わず executionMode:"optional"
 * のみで表現する。「相手によって」= cause:["opponent_effect","battle"]
 * (BSTH02-X05 コメント/BSTH02.7-X05 precedent 参照、battle 由来の離脱も含む)。
 *
 * 検証ポイント:
 *   shape 系:
 *     - timing.cause = ["opponent_effect", "battle"] (「相手によって」の広義マッピング)
 *     - condition = min_level:3 + count_value(player:opponent, min:1)
 *     - executionMode: "optional"
 *     - steps[0] = stay_on_field newExhaustState:"recovered"
 *     - stub フィールドが削除されている
 *   挙動系:
 *     - 相手カウント1以上 → stay_on_field で回復状態のまま field 残置・pendingLeave 解消
 *     - 相手カウント0 → effect.condition 不成立で不発火・pendingLeave 据え置き(離脱継続)
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

describe("BSTH03-M08 妖夢 effects[1] 離脱残置 (相手カウント1以上でstay_on_field recovered)", () => {
  const c = cardNoMap.get("BSTH03-M08")!;

  // ========== shape 検証 ==========
  it("timing は leave_field + cause:['opponent_effect','battle']", () => {
    const e = c.effects![1]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
  });

  it("condition = min_level:3 + count_value(opponent, min:1)", () => {
    const e = c.effects![1]!;
    expect(e.condition).toEqual([
      { kind: "min_level", value: 3 },
      { kind: "count_value", player: "opponent", min: 1 },
    ]);
  });

  it("executionMode:'optional'", () => {
    const e = c.effects![1]!;
    expect(e.executionMode).toBe("optional");
  });

  it("step0 = stay_on_field newExhaustState:'recovered' (connector なし・コスト無し)", () => {
    const e = c.effects![1]!;
    const step0 = e.steps[0]!;
    expect(step0.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
      newExhaustState: "recovered",
    });
    expect(step0.connector).toBeUndefined();
  });

  it("stub フィールドは削除されている (fidelity 違反 0)", () => {
    const e = c.effects![1]!;
    expect(e.stub).toBeUndefined();
  });

  // ========== 挙動検証 ==========
  // Lv3 = requiredCores 1 (levelDefs[0])。

  function setupAt(normalCoreCount: number, opponentCount: number): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "m08-stay",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount,
      exhaustState: "exhausted",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-m08-stay",
    });
    return {
      ...base,
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "bob" ? { ...p, countValue: opponentCount } : p
      ),
      pendingLeaveEntities: [
        {
          instanceId: "m08-stay",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-m08-stay",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
  }

  it("相手カウント1以上: stay_on_field で回復状態のまま field に残り pendingLeave が解消される", () => {
    const state = setupAt(1, 1);
    const result = executeEffect({
      chainId: "test:bsth03-m08-leave-field-count-gated-stay:121",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "m08-stay",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((x) => x.instanceId === "m08-stay")!;
    expect(inst.zone).toBe("field");
    expect(inst.exhaustState).toBe("recovered");
    expect(inst.pendingLeaveKind).toBeNull();
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "m08-stay")
    ).toBeUndefined();
  });

  it("相手カウント0: effect.condition 不成立で不発火・pendingLeave は離脱継続のまま据え置き", () => {
    const state = setupAt(1, 0);
    const result = executeEffect({
      chainId: "test:bsth03-m08-leave-field-count-gated-stay:139",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "m08-stay",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((x) => x.instanceId === "m08-stay")!;
    expect(inst.pendingLeaveKind).toBe("destroy");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "m08-stay")
    ).toBeDefined();
  });
});
