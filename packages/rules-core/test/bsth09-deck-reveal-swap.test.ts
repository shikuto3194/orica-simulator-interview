/**
 * BSTH09 C01/C02/C03/C04/C05 「手札/手元と入れ替えられる」semantic 検証。
 *
 * 仕様 (10_rules/07b §BSTH09-C04/C05, 裁定 2026-06-17):
 *   - deck_reveal.picks[].destination = "hand_or_set_aside_swap" は、ピック後に
 *     プレイヤーが手札/手元から 1 枚を選び、ピックカードと「物理 1 対 1 交換」する。
 *   - 受理: 選んだ手札/手元カードをデッキ下 (remainder=bottom) or トラッシュ
 *     (remainder=trash) へ送り、picked card を選んだカードの元ゾーンへ。
 *   - 諦め (skip): picked card を remainder と同じ行き先へ送る。
 *   - 両ゾーン (手札+手元) が空: 候補 0 件、skip のみ可。
 *   - per-pick 独立選択 (chain): pick グループごとに個別に accept/skip。
 *
 * 対象カード:
 *   - BSTH09-C01 [輝針城]チルノ (4オープン, conditional_cost)
 *   - BSTH09-C02 わかさぎ姫 (4オープン, conditional_cost)
 *   - BSTH09-C03 赤 蓮奇 (5オープン, simultaneous)
 *   - BSTH09-C04 今泉 影狼 (5オープン, simultaneous)
 *   - BSTH09-C05 輝針城 (5オープン, simultaneous)
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/**
 * picking + ordering 段階を一気通貫で進める。
 * pickSelector は pick group index を受けて選択 cardIds を返す。
 * ordering 段階では現状の revealed 順をそのまま返して進める。
 */
function walkPicksAndOrdering(
  state: GameState,
  pickSelector: (groupIdx: number) => string[]
): GameState {
  let cur = state;
  // 安全弁: 最大 10 ステップ
  for (let step = 0; step < 10; step++) {
    if (cur.pendingDeckReveal === null) break;
    const phase = cur.pendingDeckReveal.phase;
    if (phase === "picking") {
      const groupIdx = cur.pendingDeckReveal.currentPickIndex;
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const pick = actions.find(
        (a) => a.kind === "resolve_pending_deck_reveal_pick"
      );
      if (!pick) break;
      cur = applyLegalAction({
        state: cur,
        action: pick,
        getCardDefinitionById,
        selectedDeckRevealCardIds: pickSelector(groupIdx),
      }).state;
    } else if (phase === "ordering_remainder") {
      const remaining = cur.pendingDeckReveal.revealedCardInstanceIds.filter(
        (id) => !cur.pendingDeckReveal!.pickedCardInstanceIds.includes(id)
      );
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const order = actions.find(
        (a) => a.kind === "resolve_pending_deck_reveal_order"
      );
      if (!order) break;
      cur = applyLegalAction({
        state: cur,
        action: order,
        getCardDefinitionById,
        deckRevealRemainderOrder: remaining,
      }).state;
    } else {
      break;
    }
  }
  return cur;
}

function deckRevealEffect(c: CardDefinition) {
  const e = (c.effects ?? []).find((eff) =>
    eff.steps?.some((s) => s.action?.kind === "deck_reveal")
  );
  if (!e) throw new Error(`no deck_reveal effect on ${c.cardNo}`);
  return e;
}

describe("BSTH09 deck_reveal pick destination = hand_or_set_aside_swap (card-data)", () => {
  it.each([
    "BSTH09-C01",
    "BSTH09-C02",
    "BSTH09-C03",
    "BSTH09-C04",
    "BSTH09-C05",
  ])(
    "%s: 全 3 ピックグループに destination=hand_or_set_aside_swap が付いている",
    (cardNo) => {
      const e = deckRevealEffect(card(cardNo));
      const reveal = e.steps.find(
        (s) => s.action.kind === "deck_reveal"
      )!.action;
      if (reveal.kind !== "deck_reveal") throw new Error("unexpected");
      expect(reveal.picks.length).toBe(3);
      for (const p of reveal.picks) {
        expect(p.destination).toBe("hand_or_set_aside_swap");
      }
    }
  );

  it.each([
    "BSTH09-C01",
    "BSTH09-C02",
    "BSTH09-C03",
    "BSTH09-C04",
    "BSTH09-C05",
  ])(
    "%s: 旧 stub「手札/手元と入れ替え」未表現が effects から消えている",
    (cardNo) => {
      const e = deckRevealEffect(card(cardNo));
      const stubText = (e as { stub?: string }).stub;
      if (stubText) {
        expect(stubText).not.toContain("「手札/手元と入れ替え」");
      }
    }
  );
});

describe("BSTH09-C05 輝針城 配置時 deck_reveal swap chain (engine)", () => {
  function makeState(opts: { handCount: number; setAsideCount: number }): {
    state: GameState;
    selfId: string;
  } {
    const self = createCardInstance(card("BSTH09-C05"), {
      instanceId: "nexus-c05",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // 手札枠: 雑魚 (妖戒以外)
    const handCards = Array.from({ length: opts.handCount }, (_, i) =>
      createCardInstance(card("BSTH01-C01"), {
        instanceId: `hand-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    // 手元枠
    const setAsideCards = Array.from({ length: opts.setAsideCount }, (_, i) =>
      createCardInstance(card("BSTH01-C01"), {
        instanceId: `sa-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "set_aside",
      })
    );
    // デッキ: 妖戒スピを 1 枚 + 他 4 枚 (5 オープン用)
    const yokai = createCardInstance(card("BSTH09-C02"), {
      instanceId: "yokai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const fillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSTH01-C01"), {
        instanceId: `f${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...handCards, ...setAsideCards, yokai, ...fillers],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: opts.handCount, deckCount: 5 } : p
      ),
    };
    return { state, selfId: self.instanceId };
  }

  it("妖戒 1 枚をピック → 手札 1 枚と入れ替え (swap accept) → 妖戒が手札、選んだ手札が deck bottom", () => {
    const { state, selfId } = makeState({ handCount: 1, setAsideCount: 0 });
    // deck_reveal effect 抜き出し (count_increase は飛ばす)
    const e = deckRevealEffect(card("BSTH09-C05"));
    // count_increase を抜いて deck_reveal だけ単体実行する縮約 effect を組む
    const revealStep = e.steps.find((s) => s.action.kind === "deck_reveal")!;
    const isolated = { ...e, steps: [revealStep] };

    const afterReveal = executeEffect({
      chainId: "test:bsth09-deck-reveal-swap:212",
      state,
      effect: isolated,
      optionalExecuteResumeStepIndex: 0,
      sourceInstanceId: selfId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    // 妖戒は picking 候補に居て pending 立つ
    expect(afterReveal.pendingDeckReveal).not.toBeNull();

    // ピックグループ 1 (柱斧) は候補無し → 空選択
    let cur = afterReveal;
    cur = walkPicksAndOrdering(cur, (groupIdx) =>
      groupIdx === 2 ? ["yokai-1"] : []
    );

    // pendingZoneSelection が swap-out 選択を要求している
    expect(cur.pendingZoneSelection).not.toBeNull();
    expect(cur.pendingZoneSelection!.swapPickedInstanceId).toBe("yokai-1");
    expect(cur.pendingZoneSelection!.candidateCardInstanceIds).toEqual([
      "hand-0",
    ]);

    // hand-0 を選んで swap 受理
    const zoneActions = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const zoneAction = zoneActions.find(
      (a) => a.kind === "resolve_pending_zone_selection"
    );
    expect(zoneAction).toBeDefined();
    const finalState = applyLegalAction({
      state: cur,
      action: zoneAction!,
      getCardDefinitionById,
      selectedZoneCardIds: ["hand-0"],
    }).state;

    // 妖戒は hand へ、hand-0 は deck (bottom) へ
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "yokai-1")!.zone
    ).toBe("hand");
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "hand-0")!.zone
    ).toBe("deck");
    expect(finalState.pendingZoneSelection).toBeNull();
    expect(finalState.pendingDeckRevealSwapChain.length).toBe(0);
  });

  it("battle_end deferral 中の swap pending は attackId を保持し、完了時に battle scope CE を失効する", () => {
    const { state, selfId } = makeState({ handCount: 1, setAsideCount: 0 });
    const e = deckRevealEffect(card("BSTH09-C05"));
    const revealStep = e.steps.find((s) => s.action.kind === "deck_reveal")!;
    const isolated = { ...e, steps: [revealStep] };
    const attackId = "attack:swap-battle-end:1";

    const afterReveal = executeEffect({
      chainId: "test:bsth09-deck-reveal-swap:272",
      state,
      effect: isolated,
      optionalExecuteResumeStepIndex: 0,
      sourceInstanceId: selfId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();

    const afterRevealWithContinuation: GameState = {
      ...afterReveal,
      pendingDeckReveal: {
        ...afterReveal.pendingDeckReveal!,
        continuation: {
          chainId: "test:bsth09-deck-reveal-swap:286",
          sourceDefinitionId: "BSTH09-C05",
          effectIndex: 0,
          sourceInstanceId: selfId,
          actingPlayerId: "alice",
          resumeStepIndex: 1,
          recordStepId: "swap-record",
          stepContext: { results: {} },
          battleEndDeferralAttackId: attackId,
        },
      },
    };

    let cur = walkPicksAndOrdering(afterRevealWithContinuation, (groupIdx) =>
      groupIdx === 2 ? ["yokai-1"] : []
    );
    expect(
      cur.pendingZoneSelection?.continuation?.battleEndDeferralAttackId
    ).toBe(attackId);

    cur = {
      ...cur,
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [
        {
          effectId: "ce-swap-battle-end",
          sourceInstanceId: selfId,
          sourceDefinitionId: "BSTH09-C05",
          actingPlayerId: "alice",
          duration: { scope: "battle" },
          createdAtTurn: cur.turnNumber,
          createdAtAttackId: attackId,
          modifierTag: "defense_immune",
          targetInstanceId: selfId,
        },
      ],
    };

    const zoneAction = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    expect(zoneAction).toBeDefined();

    const finalState = applyLegalAction({
      state: cur,
      action: zoneAction!,
      getCardDefinitionById,
      selectedZoneCardIds: ["hand-0"],
    }).state;

    expect(finalState.pendingZoneSelection).toBeNull();
    expect(finalState.pendingDeckRevealSwapChain).toHaveLength(0);
    expect(finalState.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      finalState.activeContinuousEffects.some(
        (ce) => ce.effectId === "ce-swap-battle-end"
      )
    ).toBe(false);
  });

  it("妖戒 1 枚をピック → skip (両ゾーン空) → 妖戒は deck bottom へ送られる", () => {
    const { state, selfId } = makeState({ handCount: 0, setAsideCount: 0 });
    const e = deckRevealEffect(card("BSTH09-C05"));
    const revealStep = e.steps.find((s) => s.action.kind === "deck_reveal")!;
    const isolated = { ...e, steps: [revealStep] };

    const afterReveal = executeEffect({
      chainId: "test:bsth09-deck-reveal-swap:356",
      state,
      effect: isolated,
      optionalExecuteResumeStepIndex: 0,
      sourceInstanceId: selfId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const cur = walkPicksAndOrdering(afterReveal, (groupIdx) =>
      groupIdx === 2 ? ["yokai-1"] : []
    );

    // 候補 0 件 (手札+手元空) → swap-out 選択は skip のみ可
    expect(cur.pendingZoneSelection).not.toBeNull();
    expect(cur.pendingZoneSelection!.candidateCardInstanceIds.length).toBe(0);

    const zoneActions = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const zoneAction = zoneActions.find(
      (a) => a.kind === "resolve_pending_zone_selection"
    );
    expect(zoneAction).toBeDefined();
    // skip = 0 枚選択
    const finalState = applyLegalAction({
      state: cur,
      action: zoneAction!,
      getCardDefinitionById,
      selectedZoneCardIds: [],
    }).state;

    // 妖戒は deck (remainder=bottom と同じ行き先) へ
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "yokai-1")!.zone
    ).toBe("deck");
    expect(finalState.pendingZoneSelection).toBeNull();
    expect(finalState.pendingDeckRevealSwapChain.length).toBe(0);
  });

  it("手元 1 枚と入れ替え可 (set_aside も candidate に含まれる)", () => {
    const { state, selfId } = makeState({ handCount: 0, setAsideCount: 1 });
    const e = deckRevealEffect(card("BSTH09-C05"));
    const revealStep = e.steps.find((s) => s.action.kind === "deck_reveal")!;
    const isolated = { ...e, steps: [revealStep] };

    const afterReveal = executeEffect({
      chainId: "test:bsth09-deck-reveal-swap:404",
      state,
      effect: isolated,
      optionalExecuteResumeStepIndex: 0,
      sourceInstanceId: selfId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const cur = walkPicksAndOrdering(afterReveal, (groupIdx) =>
      groupIdx === 2 ? ["yokai-1"] : []
    );

    // 手元の sa-0 が candidate に入っている
    expect(cur.pendingZoneSelection).not.toBeNull();
    expect(cur.pendingZoneSelection!.candidateCardInstanceIds).toContain(
      "sa-0"
    );

    const zoneActions = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const zoneAction = zoneActions.find(
      (a) => a.kind === "resolve_pending_zone_selection"
    );
    const finalState = applyLegalAction({
      state: cur,
      action: zoneAction!,
      getCardDefinitionById,
      selectedZoneCardIds: ["sa-0"],
    }).state;

    // 妖戒は set_aside (sa-0 の元ゾーン) へ、sa-0 は deck (bottom) へ
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "yokai-1")!.zone
    ).toBe("set_aside");
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "sa-0")!.zone
    ).toBe("deck");
  });
});
