/**
 * BSTH02-R01/R02/R03 effects[0] + BSTH02-C21 effects[0] 「発動コストが手札破棄」stub解消。
 *
 * R01/R02/R03 (共通原文): 『召喚時』「自分は、手札1枚を破棄することで、2枚ドローする。」
 *   フィルタ無し(任意のカード)の無条件1枚破棄。SSOT 流用: BSGE01「召喚/契約合体時」効果
 *   (BSGE01.ts:4109-4118) と同型の discard(cost) → conditional_cost draw(payoff)。
 *
 * C21: 『自分のドローステップ』「手札にある系統：「幻想」を持つ紫のカードか、系統：
 *   「幻想」/「導界者」と「冥主」を持つカード1枚を破棄することで、ドローの枚数を+2する。」
 *   SSOT 流用: BSSL01-C03 effects[1] (コスト先払い型ドロー枚数修正、10_rules/02 §コスト
 *   先払い型ドロー枚数修正 model A) と同型の inline + draw_modify.prepaidCost。
 *   2枝OR は CardFilter.filterOr (card-filter.ts:272 既存機構) で新規primitiveゼロ。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  applyLegalAction,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";
const FILLER = cardNoMap.get("BSFT01-C03")!; // tribe未指定の実在カード

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:bsth02-r01-r02-r03-c21-discard-cost-draw:42",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe.each([["BSTH02-R01"], ["BSTH02-R02"], ["BSTH02-R03"]])(
  "%s effects[0] shape (discard→conditional_cost draw)",
  (cardNo) => {
    const card = cardNoMap.get(cardNo)!;
    const effect = card.effects![0]!;

    it("stub 解消済み、discard(1枚, フィルタ無し) → conditional_cost draw(2枚)", () => {
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
      expect(effect.executionMode).toBe("optional");
      expect(effect.steps).toHaveLength(2);
      expect(effect.steps[0]!.action).toEqual({
        kind: "discard",
        count: 1,
        player: "self",
        fromZone: "hand",
      });
      expect(effect.steps[1]!.action).toEqual({ kind: "draw", count: 2 });
      expect(effect.steps[1]!.connector).toBe("conditional_cost");
    });
  }
);

describe.each([["BSTH02-R01"], ["BSTH02-R02"], ["BSTH02-R03"]])(
  "%s 盤面変化 (discard→conditional_cost draw)",
  (cardNo) => {
    const card = cardNoMap.get(cardNo)!;

    it("手札に1枚あり → 破棄してトラッシュへ、デッキ上2枚ドロー", () => {
      const source = createCardInstance(card, {
        instanceId: "src-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const handCard = createCardInstance(FILLER, {
        instanceId: "hand-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      });
      const deck = Array.from({ length: 2 }, (_, i) =>
        createCardInstance(FILLER, {
          instanceId: `deck-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const before = createEmptyGameState({
        cardInstances: [source, handCard, ...deck],
        playerOverrides: [{ handCount: 1, deckCount: 2 }, {}],
      });
      const after = runEffect(before, card.effects![0]!, "src-1");

      expect(
        after.cardInstances.find((c) => c.instanceId === "hand-1")!.zone
      ).toBe("trash");
      const drawnCount = after.log.filter((l) =>
        l.includes("effect:draw")
      ).length;
      expect(drawnCount).toBe(2);
      expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
    });

    it("手札が0枚 → discard 不成立、conditional_cost で draw もロールバック", () => {
      const source = createCardInstance(card, {
        instanceId: "src-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const deck = Array.from({ length: 2 }, (_, i) =>
        createCardInstance(FILLER, {
          instanceId: `deck-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const before = createEmptyGameState({
        cardInstances: [source, ...deck],
        playerOverrides: [{ handCount: 0, deckCount: 2 }, {}],
      });
      const after = runEffect(before, card.effects![0]!, "src-1");

      const drawnCount = after.log.filter((l) =>
        l.includes("effect:draw")
      ).length;
      expect(drawnCount).toBe(0);
      expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(2);
    });
  }
);

describe("BSTH02-C21 白玉楼 effects[0] shape (inline draw_modify.prepaidCost + filterOr)", () => {
  const card = cardNoMap.get("BSTH02-C21")!;
  const effect = card.effects![0]!;

  it("stub 解消済み、inline + phase(draw,self,start) + prepaidCost.cardFilter.filterOr 2枝", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.inline).toBe(true);
    expect(effect.timing).toEqual({
      kind: "phase",
      step: "draw",
      whose: "self",
      subPhase: "start",
    });
    const step = effect.steps[0]!;
    expect(step.action.kind).toBe("draw_modify");
    if (step.action.kind === "draw_modify") {
      expect(step.action.amount).toBe(2);
      expect(step.action.prepaidCost?.kind).toBe("discard_hand");
      expect(step.action.prepaidCost?.cardFilter.filterOr).toEqual([
        { colors: ["purple"], tribes: ["幻想"] },
        {
          tribes: ["幻想", "導界者"],
          tribesLogic: "or",
          tribesRequired: ["冥主"],
        },
      ]);
    }
  });
});

describe("BSTH02-C21 白玉楼 盤面変化 (コスト先払い型ドロー枚数修正)", () => {
  const card = cardNoMap.get("BSTH02-C21")!;
  // 枝1: 紫 + 系統「幻想」(「冥主」は持たない、branch1単独での成立を確認)
  const purpleGensou = cardNoMap.get("BSTH001-C02")!; // tribe: 起幻・幻想・靈異, colors: purple
  // 枝2: 系統「幻想」/「冥主」(紫以外、branch2単独での成立を確認)
  const gensouMeishu = cardNoMap.get("BSTH02-C02")!; // tribe: 幻想・冥主, colors: white
  // 非該当: 幻想/冥主どちらも持たない紫以外カード
  const nonMatch = cardNoMap.get("BSFT01-C03")!;

  function buildState(hand: CardDefinition[], cores: number): GameState {
    const nexus = createCardInstance(card, {
      instanceId: "c21-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: cores,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(nonMatch, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const handCards = hand.map((def, i) =>
      createCardInstance(def, {
        instanceId: `hand-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    return {
      ...base,
      activePlayerId: ALICE,
      turnNumber: 2,
      step: "core",
      cardInstances: [nexus, ...deck, ...handCards],
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, deckCount: deck.length, handCount: handCards.length }
          : p
      ),
    };
  }

  const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

  it("Lv2 (3コア) + 枝1候補(紫幻想)あり → pendingDrawStepCostChoice が立つ", () => {
    const state = buildState([purpleGensou, nonMatch], 3);
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.step).toBe("draw");
    expect(after.pendingDrawStepCostChoice).not.toBeNull();
    const entry = after.pendingDrawStepCostChoice!.entries[0]!;
    expect(entry.bonus).toBe(2);
    expect(entry.candidateCardInstanceIds).toEqual(["hand-0"]);
  });

  it("枝2候補(幻想/冥主、紫以外)でも成立する", () => {
    const state = buildState([gensouMeishu, nonMatch], 3);
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.pendingDrawStepCostChoice).not.toBeNull();
    expect(
      after.pendingDrawStepCostChoice!.entries[0]!.candidateCardInstanceIds
    ).toEqual(["hand-0"]);
  });

  it("支払い(pay) → 破棄カードがトラッシュへ移り +2 込みで3枚ドロー", () => {
    const state = buildState([purpleGensou, nonMatch], 3);
    const pendingState = advanceStep(state, getCardDefinitionById, lookup);
    expect(pendingState.pendingDrawStepCostChoice).not.toBeNull();

    const legals = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    const action = legals.find(
      (a) => a.kind === "resolve_pending_draw_step_cost_choice"
    )!;
    const resolved = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      drawStepCostChoice: "pay",
      drawStepCostDiscardCardInstanceId: "hand-0",
    }).state;

    expect(resolved.pendingDrawStepCostChoice ?? null).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "hand-0")!.zone
    ).toBe("trash");
    // 手札: 元2 - 破棄1 + ドロー3(1+2) = 4。デッキ 5-3=2。
    expect(alice(resolved).handCount).toBe(4);
    expect(alice(resolved).deckCount).toBe(2);
  });

  it("該当候補なし → pending を立てず通常1枚ドロー", () => {
    const state = buildState([nonMatch, nonMatch], 3);
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.pendingDrawStepCostChoice ?? null).toBeNull();
    expect(alice(after).handCount).toBe(3);
    expect(alice(after).deckCount).toBe(4);
  });

  it("Lv1 (0コア) では min_level 相当なし。C21はmin_level条件を持たないため Lv1でも成立する", () => {
    // C21 effects[0] に min_level 条件は無い(印字通りLv1-Lv2共通)。参考シナリオとして
    // 0コアでも通常通りコスト提示されることを確認する。
    const state = buildState([purpleGensou, nonMatch], 0);
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.pendingDrawStepCostChoice).not.toBeNull();
  });
});
