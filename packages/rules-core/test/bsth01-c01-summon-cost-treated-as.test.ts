/**
 * BSTH01-C01【毛玉】回帰テスト。
 *
 * 「このカード/スピリットのコストは3としても扱う。ただし、召喚コストは変化しない。」
 * 自カード継続 cost_modify (additionalCostValue:3, target:self, 固定値) は、召喚コスト
 * 計算には影響してはならない（印字コスト0のまま召喚できる）。
 *
 * 直読み方式の getEffectiveBaseCostAdditionalDelta（BSTH07.8-R04/X01 の DynamicCount
 * 対応用に追加）が固定値 additionalCostValue も無条件加算すると、既存 CE 経路
 * (additional_cost CE) が担う「固定値は除外」の意図と衝突し、召喚コストが 0→3 に
 * 回帰する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  playSummonAsAction,
} from "../src";
import type { GameState } from "../src";

const cardNoMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const 毛玉 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-C01")!;

describe("BSTH01-C01【毛玉】 召喚コスト非変化", () => {
  it("calculateReduction: finalCost は印字コスト0のまま", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(毛玉, {
          instanceId: "kedama-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };

    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: 毛玉,
      getCardDefinitionById,
      sourceInstanceId: "kedama-1",
    });

    expect(result.finalCost).toBe(0);
  });

  it("コア/コスト支払い無しで召喚できる（盤面変化を検証）", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(毛玉, {
          instanceId: "kedama-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.kind === "summon")).toBe(true);

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "kedama-1",
      getCardDefinitionById,
      paymentSources: [],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });

    expect(
      result.state.cardInstances.find((c) => c.instanceId === "kedama-1")!.zone
    ).toBe("field");
  });
});
