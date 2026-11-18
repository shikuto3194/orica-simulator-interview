/**
 * BSTH03-M04 [永夜抄]十六夜 咲夜 effects[1] 検証テスト。
 * Lv2『自分のアタックステップ』相手のマジック・スタック効果コストをリザーブだけから
 * 支払わせる = restrict_field_cost_payment(effectModes:["stack"]) と同義
 * (BSTH08-C06 と同型パターン、ENGINE-restrict-field-cost-payment)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import { getAvailableCardCostPaymentSources } from "../src/core/payment-system";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth03-m04-reserve-only-stack-cost:28",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH03-M04 Lv2 スタック効果コストのリザーブ限定支払い", () => {
  const card = cardNoMap.get("BSTH03-M04")!;

  it("effects[1]: continuous + timingScope(自分のアタックステップ) + min_level:2 + restrict_field_cost_payment(effectModes:[stack])", () => {
    const e = card.effects![1]!;
    expect(e.stub).toBeUndefined();
    expect(e.timing).toEqual({ kind: "continuous" });
    expect(e.timingScope).toEqual({ player: "self", period: "attack" });
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const a = e.steps[0]!.action;
    expect(a.kind).toBe("restrict_field_cost_payment");
    if (a.kind === "restrict_field_cost_payment") {
      expect(a.player).toBe("opponent");
      expect(a.effectModes).toEqual(["stack"]);
    }
  });

  it("盤面変化: 制限中は相手のスタック効果コストがフィールドのコアで支払えず、リザーブは使える (main コストは影響なし)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sakuya-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const restricted = runEffect(state, card.effects![1]!, "sakuya-1", "alice");
    const ce = restricted.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_field_cost_payment"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("bob");

    const bobSpirit = createCardInstance(cardNoMap.get("BSTH03-M05")!, {
      instanceId: "bob-payer",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const withPayer: GameState = {
      ...restricted,
      players: restricted.players.map((p) =>
        p.id === "bob" ? { ...p, reserveNormalCoreCount: 5 } : p
      ),
      cardInstances: [...restricted.cardInstances, bobSpirit],
    };
    const magicDef = cardNoMap.get("BSTH03-M05")!;

    const stackSources = getAvailableCardCostPaymentSources({
      state: withPayer,
      actingPlayerId: "bob",
      card: magicDef,
      getCardDefinitionById,
      effectMode: "stack",
    });
    expect(stackSources.onBoardCoreSources).toHaveLength(0);
    expect(stackSources.reserveSource.availableCoreAmount).toBe(5);

    const mainSources = getAvailableCardCostPaymentSources({
      state: withPayer,
      actingPlayerId: "bob",
      card: magicDef,
      getCardDefinitionById,
      effectMode: "main",
    });
    expect(mainSources.onBoardCoreSources.length).toBeGreaterThan(0);
  });
});
