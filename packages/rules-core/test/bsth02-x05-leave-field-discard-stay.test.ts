/**
 * BSTH02-X05 八雲 藍 effects[1] 離脱置換効果の検証。
 *
 * 原文 (textLines[6,7]):
 *   "Lv2-Lv3"
 *   "このスピリットが相手の効果でフィールドを離れるとき、自分の手札1枚を破棄することで、
 *    疲労状態でフィールドに残る。"
 *
 * SSOT 流用: BSLH01-R01 effects[0] / BSTH05.5-C02 effects[1] / BSSG01.ts §1101 同型の
 * cost + conditional_cost stay_on_field パターン。挙動テストは BSSG01-M02 effects[2]
 * (bssg01-cards.test.ts:765-801) を参考に pendingLeave を立ててから runEffect する。
 *
 * 検証ポイント:
 *   shape 系:
 *     - timing.cause = "opponent_effect" 単独 (「相手の効果で」の厳密マッピング、
 *       "battle" は含まない — BSTH02-X02 effects[0] の「相手によって」との対比)
 *     - executionMode: "optional" (プレイヤーは手札破棄を辞退可能)
 *     - steps[0] = discard 1 (player:self, fromZone:hand)
 *     - steps[1] = stay_on_field newExhaustState:"exhausted" + connector:"conditional_cost"
 *     - stub フィールドが削除されている
 *   挙動系:
 *     - 手札1枚あり + 相手効果離脱 → discard 成功で field 残置 (exhausted)
 *     - 手札0枚 → conditional_cost ロールバックで stay_on_field 不発火 (zone≠field)
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

describe("BSTH02-X05 八雲 藍 effects[1] 離脱置換 (discard→stay_on_field exhausted)", () => {
  const c = cardNoMap.get("BSTH02-X05")!;

  // ========== shape 検証 ==========
  it("timing は leave_field + cause:'opponent_effect' 単独", () => {
    const e = c.effects![1]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
  });

  it("executionMode:'optional' + min_level:2 condition", () => {
    const e = c.effects![1]!;
    expect(e.executionMode).toBe("optional");
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
  });

  it("step0 = discard 1 (player:self, fromZone:hand)", () => {
    const e = c.effects![1]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("discard");
    if (step0.action.kind === "discard") {
      expect(step0.action.count).toBe(1);
      expect(step0.action.player).toBe("self");
      expect(step0.action.fromZone).toBe("hand");
    }
  });

  it("step1 = stay_on_field newExhaustState:'exhausted' + connector:'conditional_cost'", () => {
    const e = c.effects![1]!;
    const step1 = e.steps[1]!;
    expect(step1.action.kind).toBe("stay_on_field");
    if (step1.action.kind === "stay_on_field") {
      expect(step1.action.newExhaustState).toBe("exhausted");
      expect(step1.action.target).toEqual({ kind: "self" });
    }
    expect(step1.connector).toBe("conditional_cost");
  });

  it("stub フィールドは削除されている (fidelity 違反 0)", () => {
    const e = c.effects![1]!;
    expect(e.stub).toBeUndefined();
  });

  // ========== 挙動検証 ==========
  // Lv2 = 3 cores 必要（levelDefs[1].requiredCores=3）。
  // pendingLeave を立てておき、effects[1] を runEffect すると conditional_cost で
  // 手札があれば discard 1 + stay_on_field exhausted、無ければロールバックして離脱継続。

  function setupAt(level2Cores: number, handCount: number): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "ran-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: level2Cores,
      exhaustState: "recovered",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-x05-leave",
    });
    const handCards = [];
    // 手札用の任意カード (BSTH02-X05 以外)。
    const handDef = cardNoMap.get("BSTH02-X04")!;
    for (let i = 0; i < handCount; i++) {
      handCards.push(
        createCardInstance(handDef, {
          instanceId: `alice-hand-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        })
      );
    }
    return {
      ...base,
      cardInstances: [self, ...handCards],
      pendingLeaveEntities: [
        {
          instanceId: "ran-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-x05-leave",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
  }

  it("手札1枚あり + Lv2: discard 1 で field 残置 (exhausted)", () => {
    const state = setupAt(3, 1);
    const result = executeEffect({
      chainId: "test:bsth02-x05-leave-field-discard-stay:135",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "ran-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((x) => x.instanceId === "ran-1")!;
    // field に残り、newExhaustState:"exhausted" が適用される。
    expect(inst.zone).toBe("field");
    expect(inst.exhaustState).toBe("exhausted");
    expect(inst.pendingLeaveKind).toBeNull();
    // 手札は破棄されている (zone=trash)。
    const handAfter = result.cardInstances.filter(
      (x) => x.ownerPlayerId === "alice" && x.zone === "hand"
    );
    expect(handAfter.length).toBe(0);
    const trashAfter = result.cardInstances.filter(
      (x) => x.ownerPlayerId === "alice" && x.zone === "trash"
    );
    expect(trashAfter.length).toBe(1);
  });

  it("手札0枚 + Lv2: conditional_cost ロールバックで離脱続行 (zone≠field)", () => {
    const state = setupAt(3, 0);
    const result = executeEffect({
      chainId: "test:bsth02-x05-leave-field-discard-stay:160",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "ran-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((x) => x.instanceId === "ran-1")!;
    // discard 不能 → conditional_cost で stay_on_field がスキップされ、pendingLeave は据え置き。
    // (実 flush は state-based-actions 側の責務、ここでは pendingLeave 残置を確認)
    expect(inst.pendingLeaveKind).toBe("destroy");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "ran-1")
    ).toBeDefined();
  });
});
