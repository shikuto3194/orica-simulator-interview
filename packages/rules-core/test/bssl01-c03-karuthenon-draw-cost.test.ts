/**
 * BSSL01-C03 カルテノン神殿 effect[3,4] — コスト先払い型ドロー枚数修正（model A）。
 *
 * カード本文 (Ver.17.0 エターナル独自拡張):
 * - Lv2『自分のドローステップ』〔重複不可〕
 *   「自分の手札にある系統:「影」/「プレイヤー」を持つカード1枚を破棄することで、
 *    ドロー枚数を+1する。」
 *
 * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正（裁定 2026-06-15, model A）。
 * システムドロー**より前に**任意コスト（破棄）の支払い判断を解決し、**支払えた場合のみ**
 * +1 を確定してからシステムドローを行う（コスト → ボーナス確定 → システムドロー）。
 *
 * 本テストで検証する:
 * - inline draw step が prepaidCost を検出して pendingDrawStepCostChoice を立てる
 *   （= ドローステップ中断。まだドローしていない）。
 * - 支払い (pay): 破棄カードがトラッシュへ移り、+1 込みで 2 枚ドロー。usageLimit 消費。
 * - 辞退 (decline): 破棄せず通常の 1 枚ドロー。
 * - 破棄候補が無い (系統不一致のみ) 場合は pending を立てず通常 1 枚ドロー。
 * - Lv1 (0 コア) では min_level 条件未達のため発火しない。
 * - GUI ピッカー (P3-93): pending の候補が手札の系統:「影」/「プレイヤー」だけに絞られる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);

const カルテノン = cardNoMap.get("BSSL01-C03")!; // tribe 影
const 影カード = cardNoMap.get("BSSL01-C03")!; // 破棄候補 (系統 影)
const プレイヤーカード = cardNoMap.get("BSSL01-C01")!; // tribe プレイヤー/影
const 非対象カード = cardNoMap.get("BSTH01-C12")!; // tribe 幻想・紅魔 (非対象)

const ALICE = "alice";

/**
 * カルテノンを Lv2 (1 コア) で alice フィールドに置き、デッキ N 枚・指定手札を持つ state を作る。
 * step=core で advanceStep するとドローステップへ遷移する (turnNumber=2 で先攻スキップ無効)。
 */
function buildState(options: {
  cores: number;
  deck: number;
  hand: CardDefinition[];
}): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, "bob"] });
  const nexus = createCardInstance(カルテノン, {
    instanceId: "karu-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: options.cores,
  });
  const deckCards = Array.from({ length: options.deck }, (_, i) =>
    createCardInstance(非対象カード, {
      instanceId: `deck-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  const handCards = options.hand.map((def, i) =>
    createCardInstance(def, {
      instanceId: `hand-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    })
  );
  return {
    ...base,
    activePlayerId: ALICE,
    turnNumber: 2,
    step: "core",
    cardInstances: [nexus, ...deckCards, ...handCards],
    players: base.players.map((p) =>
      p.id === ALICE
        ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
        : p
    ),
  };
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSSL01-C03 カルテノン神殿 コスト先払い型ドロー枚数修正", () => {
  it("カード stub が解消されている (effect[3,4] inline draw_modify prepaidCost)", () => {
    const eff = カルテノン.effects![1]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.inline).toBe(true);
    const step = eff.steps[0]!;
    expect(step.action.kind).toBe("draw_modify");
    if (step.action.kind === "draw_modify") {
      expect(step.action.amount).toBe(1);
      expect(step.action.prepaidCost?.kind).toBe("discard_hand");
      expect(step.action.prepaidCost?.cardFilter.tribes).toEqual([
        "影",
        "プレイヤー",
      ]);
    }
  });

  it("ドローステップ遷移で pendingDrawStepCostChoice を立て、まだドローしない (中断)", () => {
    const state = buildState({
      cores: 1,
      deck: 10,
      hand: [影カード, 非対象カード],
    });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.step).toBe("draw");
    // ドロー前に中断: pending が立ち、手札枚数は不変。
    expect(after.pendingDrawStepCostChoice).not.toBeNull();
    expect(alice(after).deckCount).toBe(10);
    expect(alice(after).handCount).toBe(2);
    // GUI ピッカー: 候補は系統一致カードのみ (hand-0=影, hand-1=非対象を除外)。
    const pending = after.pendingDrawStepCostChoice!;
    const entry = pending.entries[0]!;
    expect(entry.bonus).toBe(1);
    expect(entry.candidateCardInstanceIds).toEqual(["hand-0"]);
  });

  it("支払い (pay): 破棄カードがトラッシュへ移り +1 込みで 2 枚ドロー、usageLimit 消費", () => {
    const state = buildState({
      cores: 1,
      deck: 10,
      hand: [影カード, プレイヤーカード],
    });
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
    );
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      drawStepCostChoice: "pay",
      drawStepCostDiscardCardInstanceId: "hand-0",
    }).state;

    expect(resolved.pendingDrawStepCostChoice ?? null).toBeNull();
    // 破棄 1 枚 (hand-0 → trash)。
    const discarded = resolved.cardInstances.find(
      (c) => c.instanceId === "hand-0"
    )!;
    expect(discarded.zone).toBe("trash");
    // 手札: 元 2 - 破棄 1 + ドロー 2 = 3。デッキ 10 - 2 = 8。
    expect(alice(resolved).handCount).toBe(3);
    expect(alice(resolved).deckCount).toBe(8);
    // 〔重複不可〕の使用は今回のドローステップだけに記録する。
    expect(
      resolved.effectUsageRecords.some(
        (r) => r.sourceDefinitionId === カルテノン.cardNo
      )
    ).toBe(true);
  });

  it("同じターンに再びドローステップへ入ると、支払って再度+1できる", () => {
    let state = buildState({
      cores: 1,
      deck: 10,
      hand: [影カード, プレイヤーカード],
    });
    state.cardInstances.push(
      createCardInstance(カルテノン, {
        instanceId: "karu-2",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const scopes: string[] = [];
    for (const discardId of ["hand-0", "hand-1"]) {
      state = advanceStep(
        { ...state, step: "core" },
        getCardDefinitionById,
        lookup
      );
      expect(state.pendingDrawStepCostChoice).not.toBeNull();
      const action = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
      }).find((a) => a.kind === "resolve_pending_draw_step_cost_choice")!;
      state = applyLegalAction({
        state,
        action,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
        drawStepCostChoice: "pay",
        drawStepCostDiscardCardInstanceId: discardId,
      }).state;
      expect(state.pendingDrawStepCostChoice).toBeNull();
      scopes.push(state.effectUsageRecords.at(-1)!.triggerEventScopeKey!);
    }
    expect(new Set(scopes).size).toBe(2);
    expect(alice(state).deckCount).toBe(6);
    expect(alice(state).handCount).toBe(4);
  });

  it("no_duplicateは別ドローイベントで再度発揮できる", () => {
    const state = buildState({
      cores: 1,
      deck: 10,
      hand: [影カード, プレイヤーカード],
    });
    // 前ターン (turnNumber:1) に使用済みの record を注入。isRecordInDurationScope の
    // turn 判定 (record.turnNumber === state.turnNumber) により現ターン (2) には効かないはず。
    const staleRecordState: GameState = {
      ...state,
      effectUsageRecords: [
        {
          sourceInstanceId: "karu-1",
          sourceDefinitionId: カルテノン.cardNo,
          effectLabel: "effect:1",
          turnNumber: 1,
          triggerEventScopeKey: "draw-step:1:alice:1",
          step: "draw",
          duration: "turn",
          count: 1,
        },
      ],
    };
    const after = advanceStep(staleRecordState, getCardDefinitionById, lookup);
    expect(after.pendingDrawStepCostChoice).not.toBeNull();
  });

  it("同じドローイベントのrecordは重複をブロックする", () => {
    const state = buildState({
      cores: 1,
      deck: 10,
      hand: [影カード, プレイヤーカード],
    });
    const sameTurnRecordState: GameState = {
      ...state,
      effectUsageRecords: [
        {
          sourceInstanceId: "karu-1",
          sourceDefinitionId: カルテノン.cardNo,
          effectLabel: "effect:1",
          turnNumber: 2,
          triggerEventScopeKey: "draw-step:2:alice:1",
          step: "draw",
          duration: "turn",
          count: 1,
        },
      ],
    };
    const after = advanceStep(
      sameTurnRecordState,
      getCardDefinitionById,
      lookup
    );
    expect(after.pendingDrawStepCostChoice ?? null).toBeNull();
    // usageLimit でブロックされ、破棄コストは発動せず通常 1 枚ドローのみ (手札 2+1=3, デッキ 10-1=9)。
    expect(alice(after).handCount).toBe(3);
    expect(alice(after).deckCount).toBe(9);
  });

  it("辞退 (decline): 破棄せず通常の 1 枚ドロー", () => {
    const state = buildState({
      cores: 1,
      deck: 10,
      hand: [影カード],
    });
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
      drawStepCostChoice: "decline",
    }).state;

    expect(resolved.pendingDrawStepCostChoice ?? null).toBeNull();
    // 破棄なし、通常 1 枚ドロー: 手札 1 + 1 = 2、デッキ 10 - 1 = 9。
    expect(alice(resolved).handCount).toBe(2);
    expect(alice(resolved).deckCount).toBe(9);
    // 破棄カードは手札のまま。
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "hand-0")!.zone
    ).toBe("hand");
  });

  it("破棄候補が無い (系統不一致のみ) 場合は pending を立てず通常 1 枚ドロー", () => {
    const state = buildState({
      cores: 1,
      deck: 10,
      hand: [非対象カード, 非対象カード],
    });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.pendingDrawStepCostChoice ?? null).toBeNull();
    // 通常 1 枚ドロー。
    expect(alice(after).handCount).toBe(3);
    expect(alice(after).deckCount).toBe(9);
  });

  it("Lv1 (0 コア) では min_level 条件未達のため発火せず通常 1 枚ドロー", () => {
    const state = buildState({
      cores: 0,
      deck: 10,
      hand: [影カード],
    });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.pendingDrawStepCostChoice ?? null).toBeNull();
    expect(alice(after).handCount).toBe(2);
    expect(alice(after).deckCount).toBe(9);
  });
});
