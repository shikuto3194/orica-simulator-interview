/**
 * BSTH07-C01 ナズーリン Lv1-Lv2 メイン効果テスト (P3-25 exhaustSelf 移行検証)
 *
 * カード本文:
 * - Lv1-Lv2『自分のメインステップ』
 * - このスピリットを疲労させることで、ボイドからコア1個を自分のリザーブに置く。
 *   この効果はターンに1回しか使えない。
 *
 * 本テストでは P3-25 移行 (`activationCost.exhaustSelf` → `set_exhaust_state` cost step
 * + `connector: "conditional_cost"`) が以下を満たすことを検証する:
 * - 未疲労時: 自身が疲労 + ボイド→リザーブにコア 1 個 (両方適用)
 * - 既疲労時: 状態変化なし → conditional_cost ロールバック (リザーブ加算なし)
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
const ナズーリン = cardNoMap.get("BSTH07-C01");

function buildState(
  instanceId: string,
  options: {
    exhaustState: "recovered" | "exhausted";
    voidCount: number;
    reserveCount: number;
  }
): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        voidNormalCoreCount: options.voidCount,
        reserveNormalCoreCount: options.reserveCount,
      },
    ],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(ナズーリン!, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: options.exhaustState,
      }),
    ],
  };
}

describe("BSTH07-C01 ナズーリン (P3-25 exhaustSelf 移行)", () => {
  it("カードデータに存在する", () => {
    expect(ナズーリン).toBeDefined();
    expect(ナズーリン?.printedCategory).toBe("spirit");
  });

  it("cost step + conditional_cost で表現される", () => {
    const effect = ナズーリン!.effects![1]!;
    expect(effect.steps[0]?.action.kind).toBe("set_exhaust_state");
    expect(effect.steps[1]?.connector).toBe("conditional_cost");
  });

  it("未疲労時: 自身が疲労 + ボイド→リザーブにコア 1 個", () => {
    const state = buildState("nazu-1", {
      exhaustState: "recovered",
      voidCount: 1,
      reserveCount: 0,
    });
    const effect = ナズーリン!.effects![1]!;
    const result = executeEffect({
      chainId: "test:bsth07-c01-exhaust-cost:82",
      state,
      effect,
      sourceInstanceId: "nazu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const nazu = result.cardInstances.find((c) => c.instanceId === "nazu-1");
    expect(nazu?.exhaustState).toBe("exhausted");

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(0);
  });

  it("既疲労時: cost step が state を変えず conditional_cost ロールバックでリザーブ加算なし", () => {
    const state = buildState("nazu-2", {
      exhaustState: "exhausted",
      voidCount: 1,
      reserveCount: 0,
    });
    const effect = ナズーリン!.effects![1]!;
    const result = executeEffect({
      chainId: "test:bsth07-c01-exhaust-cost:105",
      state,
      effect,
      sourceInstanceId: "nazu-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(1);
  });
});
