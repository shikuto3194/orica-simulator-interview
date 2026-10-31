/**
 * BSTH001-C03「魔界」effects[1] 検証。
 *
 * カード本文 (Ver.17.0 エターナル独自拡張):
 * - Lv1-Lv2『自分のドローステップ』ドロー枚数+1。ドロー後、自分は手札のカード2枚か、
 *   系統：「靈異」を持つカード1枚か、系統：「起幻」を持つネクサスカード1枚を破棄する。
 *   この効果は重複しない。
 *
 * 実装は BSTH01-C12「ヴワル魔法図書館」effects[0] と同型の
 * inline draw-step pre/post + choice discard alternates を使う。
 * 「この効果は重複しない」= usageLimit no_duplicate (03e §〔重複不可〕vs〔ターンに1回:同名〕、
 * per_card_name/turn とは別 keyword/scope)。
 * 本テストでは choice alternates が2件 (靈異 / 起幻ネクサス) 正しく登録され、
 * それぞれのフィルタが意図通り候補を絞ることを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
} from "../src/runtime";
import type { CardDefinition, GameState } from "../src/runtime";
import { canUseEffectByUsageLimit } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const 魔界 = cardNoMap.get("BSTH001-C03")!;
// tribe 起幻・幻想・靈異 の spirit (nexus ではない) → filter1(靈異) のみ一致
const 靈異スピリット = cardNoMap.get("BSTH001-C01")!;
// tribe 創界石・起幻・幻想 の nexus → filter2(nexus + 起幻) のみ一致
const 起幻ネクサス = cardNoMap.get("BSTH001-転醒R01(A)")!;

describe("BSTH001-C03 魔界 effects[1] (ドロー+1、choice破棄)", () => {
  it("コア→ドローステップ遷移で+1ドロー後、discard 選択モーダルが開き choice alternates が2件登録される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const 魔界field = createCardInstance(魔界, {
      instanceId: "makai-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const deckCards = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(魔界, {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const 靈異手札 = createCardInstance(靈異スピリット, {
      instanceId: "hand-reii",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const 起幻手札 = createCardInstance(起幻ネクサス, {
      instanceId: "hand-kigen",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const フィラー手札 = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(魔界, {
        instanceId: `hand-filler-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    const handCards = [靈異手札, 起幻手札, ...フィラー手札];
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      turnNumber: 2,
      step: "core",
      cardInstances: [魔界field, ...deckCards, ...handCards],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
          : p
      ),
    };
    const lookup = buildTriggeredEffectLookup([魔界]);
    const after = advanceStep(state, getCardDefinitionById, lookup);

    // ドローステップで +1 ドロー (通常1枚+ボーナス1枚 = 2枚)
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(after.step).toBe("draw");
    expect(alice.handCount).toBe(handCards.length + 2);
    expect(alice.deckCount).toBe(deckCards.length - 2);

    // ポスト discard が pending zone selection を開く (強制、primary 上限2枚)
    const pzs = after.pendingZoneSelection;
    expect(pzs).not.toBeNull();
    expect(pzs!.canSkip).toBe(false);
    expect(pzs!.maxCount).toBe(2);

    // choice alternates が2件 (靈異1枚 / 起幻ネクサス1枚)
    expect(pzs!.alternateSelections).toBeDefined();
    expect(pzs!.alternateSelections!).toHaveLength(2);
    const [alt靈異, alt起幻] = pzs!.alternateSelections!;
    expect(alt靈異!.count).toBe(1);
    expect(alt起幻!.count).toBe(1);

    // alt1 (靈異) の候補には 靈異スピリット手札のみが入り、起幻ネクサス手札は含まれない
    expect(alt靈異!.candidateInstanceIds).toContain("hand-reii");
    expect(alt靈異!.candidateInstanceIds).not.toContain("hand-kigen");

    // alt2 (起幻ネクサス) の候補には 起幻ネクサス手札のみが入り、靈異スピリット手札は含まれない
    expect(alt起幻!.candidateInstanceIds).toContain("hand-kigen");
    expect(alt起幻!.candidateInstanceIds).not.toContain("hand-reii");

    // usageLimit (no_duplicate) が消費される
    const usageRecorded = after.effectUsageRecords.some(
      (r) => r.sourceDefinitionId === 魔界.cardNo
    );
    expect(usageRecorded).toBe(true);
  });

  it("同名複数枚は同じドローステップで畳み、追加ドローステップでは再発揮する (重複しない)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const deckCards = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(魔界, {
        instanceId: `deck2-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const 魔界A = createCardInstance(魔界, {
      instanceId: "makai-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const 魔界B = createCardInstance(魔界, {
      instanceId: "makai-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handCards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(魔界, {
        instanceId: `hand2-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      turnNumber: 2,
      step: "core",
      cardInstances: [魔界A, 魔界B, ...deckCards, ...handCards],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
          : p
      ),
    };
    const lookup = buildTriggeredEffectLookup([魔界]);
    const firstDraw = advanceStep(state, getCardDefinitionById, lookup);
    const aliceAfterFirstDraw = firstDraw.players.find(
      (p) => p.id === "alice"
    )!;
    // 同じ event の同名2枚でも draw_modify は1回だけなので、通常1枚+ボーナス1枚。
    expect(aliceAfterFirstDraw.handCount).toBe(handCards.length + 2);

    // no_duplicate の使用記録は、同じドローステップを表す event scope に1件だけ残る。
    const effect = 魔界.effects![1]!;
    const firstUsage = firstDraw.effectUsageRecords.filter(
      (record) =>
        record.sourceDefinitionId === 魔界.cardNo &&
        record.effectLabel === "effect:1"
    );
    expect(firstUsage).toHaveLength(1);
    const firstScope = firstUsage[0]!.triggerEventScopeKey;
    expect(firstScope).toMatch(/^draw-step:2:alice:/);

    // 同じ scope では、もう一方の同名 source は明示的に usageLimit で拒否される。
    expect(
      canUseEffectByUsageLimit({
        state: firstDraw,
        sourceEffect: effect,
        sourceInstanceId: "makai-b",
        sourceDefinitionId: 魔界.cardNo,
        getCardDefinitionById,
        effectLabel: "effect:1",
        usageLimit: effect.usageLimit!,
        triggerEventScopeKey: firstScope,
      })
    ).toBe(false);

    // 〔重複不可〕はターン制限ではないため、別 event scope は直ちに利用可能である。
    expect(
      canUseEffectByUsageLimit({
        state: firstDraw,
        sourceEffect: effect,
        sourceInstanceId: "makai-b",
        sourceDefinitionId: 魔界.cardNo,
        getCardDefinitionById,
        effectLabel: "effect:1",
        usageLimit: effect.usageLimit!,
        triggerEventScopeKey: `${firstScope}:next`,
      })
    ).toBe(true);

    // 1回目の post-draw discard を解決して pending を空にする。
    const firstPending = firstDraw.pendingZoneSelection!;
    const firstDiscardIds = firstPending.candidateCardInstanceIds.slice(
      0,
      firstPending.maxCount
    );
    expect(firstDiscardIds).toHaveLength(2);
    const afterFirstDiscard = applyLegalAction({
      state: firstDraw,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: firstDiscardIds,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
    expect(afterFirstDiscard.pendingZoneSelection).toBeNull();
    expect(afterFirstDiscard.pendingTriggeredEffects).toHaveLength(0);
    expect(afterFirstDiscard.pendingStepChoice).toBeNull();
    expect(afterFirstDiscard.pendingStepOptionalChoice).toBeNull();
    expect(afterFirstDiscard.pendingEffectTargetSelection).toBeNull();
    expect(afterFirstDiscard.stackWindow).toBeNull();
    expect(afterFirstDiscard.players[0]!.handCount).toBe(handCards.length);
    expect(afterFirstDiscard.players[0]!.deckCount).toBe(deckCards.length - 2);
    expect(
      afterFirstDiscard.cardInstances.filter((card) => card.zone === "hand")
    ).toHaveLength(handCards.length);
    expect(
      afterFirstDiscard.cardInstances.filter((card) => card.zone === "deck")
    ).toHaveLength(deckCards.length - 2);
    expect(
      afterFirstDiscard.cardInstances
        .filter((card) => card.zone === "trash")
        .map((card) => card.instanceId)
        .sort()
    ).toEqual([...firstDiscardIds].sort());
    expect(afterFirstDiscard.effectUsageRecords).toEqual(
      firstDraw.effectUsageRecords
    );

    // 同一ターンに追加された別ドローステップは stepSequence を更新し、新しい event として
    // 同じ no_duplicate 効果をもう一度発揮する。
    const secondDraw = advanceStep(
      { ...afterFirstDiscard, pendingExtraSteps: ["draw"] },
      getCardDefinitionById,
      lookup
    );
    const aliceAfterSecondDraw = secondDraw.players.find(
      (p) => p.id === "alice"
    )!;
    expect(secondDraw.step).toBe("draw");
    expect(aliceAfterSecondDraw.handCount).toBe(handCards.length + 2);
    expect(aliceAfterSecondDraw.deckCount).toBe(deckCards.length - 4);
    expect(secondDraw.pendingZoneSelection).not.toBeNull();
    const allUsage = secondDraw.effectUsageRecords.filter(
      (record) =>
        record.sourceDefinitionId === 魔界.cardNo &&
        record.effectLabel === "effect:1"
    );
    expect(allUsage).toHaveLength(2);
    expect(
      new Set(allUsage.map((record) => record.triggerEventScopeKey)).size
    ).toBe(2);

    // 2回目も必須破棄まで完了し、継続解決が再ドローや使用枠の払戻しを起こさない。
    const secondPending = secondDraw.pendingZoneSelection!;
    const secondDiscardIds = secondPending.candidateCardInstanceIds.slice(
      0,
      secondPending.maxCount
    );
    expect(secondDiscardIds).toHaveLength(2);
    expect(secondDiscardIds.every((id) => !firstDiscardIds.includes(id))).toBe(
      true
    );
    const afterSecondDiscard = applyLegalAction({
      state: secondDraw,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: secondDiscardIds,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
    expect(afterSecondDiscard.pendingZoneSelection).toBeNull();
    expect(afterSecondDiscard.pendingTriggeredEffects).toHaveLength(0);
    expect(afterSecondDiscard.pendingStepChoice).toBeNull();
    expect(afterSecondDiscard.pendingStepOptionalChoice).toBeNull();
    expect(afterSecondDiscard.pendingEffectTargetSelection).toBeNull();
    expect(afterSecondDiscard.stackWindow).toBeNull();
    expect(afterSecondDiscard.players[0]!.handCount).toBe(handCards.length);
    expect(afterSecondDiscard.players[0]!.deckCount).toBe(deckCards.length - 4);
    expect(
      afterSecondDiscard.cardInstances.filter((card) => card.zone === "hand")
    ).toHaveLength(handCards.length);
    expect(
      afterSecondDiscard.cardInstances.filter((card) => card.zone === "deck")
    ).toHaveLength(deckCards.length - 4);
    expect(
      afterSecondDiscard.cardInstances
        .filter((card) => card.zone === "trash")
        .map((card) => card.instanceId)
        .sort()
    ).toEqual([...firstDiscardIds, ...secondDiscardIds].sort());
    expect(afterSecondDiscard.effectUsageRecords).toEqual(
      secondDraw.effectUsageRecords
    );
  });
});
