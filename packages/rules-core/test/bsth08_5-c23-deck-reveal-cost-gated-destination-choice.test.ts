/**
 * BSTH08.5-C23「能面・火男（楽）」メイン【アクセル：コスト4<赤><赤>】:
 * 「自分のデッキを上から5枚オープンする。その中の系統：「面霊」を持つ創界神ネクサスカード
 * すべてか、1コスト支払うことで、系統：「面霊」を持つスピリットカード/ブレイヴカード合計3枚を
 * 手札に加えるまたは手元に置く。残ったカードは破棄する。」
 *
 * 前身 cluster deck-reveal-exclusive-pick-choice (BSTH08.5-X03) の exclusiveGroup XOR だけでは
 * 解消しない2つの追加 primitive gap を検証する:
 * (1) 排他ブランチの一方にコストゲート (DeckRevealPick.costGate) — 支払い不能なら候補0枚化。
 * (2) 得たカードの行き先の自由選択 (destination:"hand_or_set_aside_choice") — 交換を伴わない
 *     単純な hand/set_aside 選択を同一 resolve_pending_deck_reveal_pick アクションの
 *     追加入力 (deckRevealPickFreeDestination) で解決する。
 *
 * accelData.effects[0] を executeEffect で直接検証する (X03 テストと同型パターン)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  createActionInputDecisionNode,
  executeEffect,
  getLegalActions,
  generateActionInputChoices,
  getDeckRevealSelectedHandGainCost,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C23 = cardNoMap.get("BSTH08.5-C23")!;
const X03 = cardNoMap.get("BSTH08.5-X03")!; // 面霊 創界神ネクサス (grandwalker)
const C20 = cardNoMap.get("BSTH08.5-C20")!; // 面霊 ブレイヴ
const C21 = cardNoMap.get("BSTH08.5-C21")!; // 面霊 ブレイヴ
const X01 = cardNoMap.get("BSTH08.5-X01")!; // 面霊 スピリット
// 「面霊」系統にも「創界神ネクサス」にも一致しないフィラー。
const FILLER: CardDefinition = {
  cardNo: "TEST-BSTH08.5-C23-FILLER",
  name: "無関係テストカード",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  tribe: "無関係",
  sourceUrls: [],
  sourceConfidence: "C",
};
const testCardNoMap = new Map<string, CardDefinition>([
  [FILLER.cardNo, FILLER],
]);
const getCardDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  testCardNoMap.get(id) ??
  ALL_CARDS.find((c) => c.cardNo === id);

const ALICE = "alice";
const BOB = "bob";

function baseState(
  deckCards: CardDefinition[],
  aliceReserve?: number,
  handGainPrevention = false
): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    ...(aliceReserve !== undefined
      ? { playerOverrides: [{ reserveNormalCoreCount: aliceReserve }] }
      : {}),
  });
  const c23Instance = createCardInstance(C23, {
    instanceId: "c23",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "set_aside",
  });
  const deckInstances = deckCards.map((def, i) =>
    createCardInstance(def, {
      instanceId: `deck-${i + 1}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [c23Instance, ...deckInstances],
    ...(handGainPrevention
      ? { activeContinuousEffects: [handGainPreventionCE()] }
      : {}),
  };
}

function handGainPreventionCE(): ContinuousEffect {
  return {
    effectId: "ce-bsrk01-x01-hand-gain-prevention",
    sourceInstanceId: "bsrk01-x01",
    sourceDefinitionId: "BSRK01-X01",
    actingPlayerId: BOB,
    duration: { scope: "step", step: "start", whose: "self" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "hand_gain_prevention",
    targetInstanceId: ALICE,
  };
}

function accelEffect() {
  return C23.accelData!.effects![0]!;
}

describe("BSTH08.5-C23 メイン【アクセル】card-data", () => {
  it("accelData: timing=main / cost=4 / reduction=赤赤、picks は同一 exclusiveGroup の2ブランチ", () => {
    expect(C23.accelData!.timing).toBe("main");
    expect(C23.accelData!.cost).toBe(4);
    expect(C23.accelData!.reduction).toEqual(["red", "red"]);

    const action = accelEffect().steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind !== "deck_reveal") throw new Error("unreachable");
    expect(action.revealCount).toBe(5);
    expect(action.remainder).toBe("trash");
    expect(action.picks).toHaveLength(2);
    const [nexusPick, spiritBravePick] = action.picks;
    expect(nexusPick!.exclusiveGroup).toBe("nexus_free_or_paid_spirit_brave");
    expect(spiritBravePick!.exclusiveGroup).toBe(
      "nexus_free_or_paid_spirit_brave"
    );
    expect(nexusPick!.count).toBe(-1);
    expect(nexusPick!.costGate).toBeUndefined();
    expect(spiritBravePick!.count).toBe(3);
    expect(spiritBravePick!.costGate).toBe(1);
    expect(nexusPick!.destination).toBe("hand_or_set_aside_choice");
    expect(spiritBravePick!.destination).toBe("hand_or_set_aside_choice");
  });
});

describe("BSTH08.5-C23 deck_reveal 実行 (costGate + hand_or_set_aside_choice)", () => {
  function reveal(
    deckCards: CardDefinition[],
    aliceReserve?: number,
    handGainPrevention = false
  ) {
    return executeEffect({
      chainId:
        "test:bsth08_5-c23-deck-reveal-cost-gated-destination-choice:149",
      state: baseState(deckCards, aliceReserve, handGainPrevention),
      effect: accelEffect(),
      sourceInstanceId: "c23",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
  }

  function getPickAction(state: GameState) {
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = actions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    );
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("resolve_pending_deck_reveal_pick action not found");
    }
    return pick;
  }

  it.each(["hand", "set_aside"] as const)(
    "有料ブランチの%s選択はHUDとAIで同じコストと明示内訳を使う",
    (destination) => {
      let state = reveal([X03, C20, C21, FILLER, FILLER], 5);
      state = {
        ...state,
        players: state.players.map((player) =>
          player.id === ALICE
            ? {
                ...player,
                reserveSoulCoreCount: 1,
                soulCoreLocation: { kind: "reserve" as const },
              }
            : player
        ),
      };
      const pick = getPickAction(state);
      expect(
        getDeckRevealSelectedHandGainCost(
          state,
          state.pendingDeckReveal!,
          ["deck-2", "deck-3"],
          destination,
          getCardDef
        )
      ).toBe(1);
      const choices = generateActionInputChoices(
        state,
        pick,
        { getCardDefinitionById: getCardDef },
        64
      ).values;
      const paid = choices.find(
        (input) =>
          input.deckRevealPickFreeDestination === destination &&
          input.selectedDeckRevealCardIds?.includes("deck-2") &&
          input.paymentSources?.some((source) => source.includeSoulCore)
      );
      expect(paid).toBeDefined();
      const after = applyLegalAction({
        state,
        action: pick,
        getCardDefinitionById: getCardDef,
        ...paid,
      }).state;
      expect(
        after.cardInstances.find((card) => card.instanceId === "deck-2")?.zone
      ).toBe(destination);
      expect(
        after.players.find((player) => player.id === ALICE)
          ?.reserveNormalCoreCount
      ).toBe(5);
      expect(
        after.players.find((player) => player.id === ALICE)?.trashSoulCoreCount
      ).toBe(1);
    }
  );

  it("無償ブランチ: 面霊創界神ネクサス1枚を無償で取得、コスト消費なし、手札を選べる", () => {
    const afterReveal = reveal([X03, C20, C21, FILLER, FILLER]);
    expect(afterReveal.pendingDeckReveal).not.toBeNull();

    const pick = getPickAction(afterReveal);
    expect(pick.requiresFreeDestinationChoice).toBe(true);
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 1, candidateCardInstanceIds: ["deck-1"] },
      { count: 2, candidateCardInstanceIds: ["deck-2", "deck-3"], costGate: 1 },
    ]);

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1"],
      deckRevealPickFreeDestination: "hand",
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    expect(resolved.state.pendingDeckReveal).toBeNull();
    const alice = resolved.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(4); // 無償ブランチはコスト消費しない

    const x03Card = resolved.state.cardInstances.find(
      (c) => c.instanceId === "deck-1"
    )!;
    expect(x03Card.zone).toBe("hand");
    for (const id of ["deck-2", "deck-3", "deck-4", "deck-5"]) {
      expect(
        resolved.state.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }
  });

  it("有償ブランチ: 面霊創界神ネクサスが無いとき、1コスト払って面霊スピ/ブレイヴ最大3枚を取得し手元を選べる", () => {
    const afterReveal = reveal([C20, C21, X01, FILLER, FILLER], 4);
    const pick = getPickAction(afterReveal);
    // 創界神ネクサスが1枚も無いため、無償ブランチは候補0枚。
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 0, candidateCardInstanceIds: [] },
      {
        count: 3,
        candidateCardInstanceIds: ["deck-1", "deck-2", "deck-3"],
        costGate: 1,
      },
    ]);

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1", "deck-2", "deck-3"],
      deckRevealPickFreeDestination: "set_aside",
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    expect(resolved.state.pendingDeckReveal).toBeNull();
    const alice = resolved.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(3); // 1コスト支払い済み

    for (const id of ["deck-1", "deck-2", "deck-3"]) {
      expect(
        resolved.state.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("set_aside");
    }
    for (const id of ["deck-4", "deck-5"]) {
      expect(
        resolved.state.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }
  });

  it("BSRK01-X01 の手札増加禁止中は、C23 の手元選択だけを legal surface に残す", () => {
    const afterReveal = reveal([X03, C20, C21, FILLER, FILLER], 4, true);
    const handCountBefore = afterReveal.players.find(
      (player) => player.id === ALICE
    )!.handCount;
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds.sort()).toEqual([
      "deck-1",
      "deck-2",
      "deck-3",
    ]);
    expect(pick.freeDestinationChoices).toEqual(["set_aside"]);

    const inputNode = createActionInputDecisionNode(afterReveal, pick, {
      getCardDefinitionById: getCardDef,
    });
    expect(
      inputNode?.choices.some(
        (choice) =>
          choice.applyOptions?.deckRevealPickFreeDestination === "hand"
      )
    ).toBe(false);
    const setAsideInput = inputNode?.choices.find(
      (choice) =>
        choice.applyOptions?.deckRevealPickFreeDestination === "set_aside" &&
        choice.applyOptions?.selectedDeckRevealCardIds?.join(",") === "deck-1"
    );
    expect(setAsideInput).toBeDefined();
    if (!setAsideInput) throw new Error("set_aside input not generated");

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      ...setAsideInput.applyOptions,
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(
      resolved.state.cardInstances.find((card) => card.instanceId === "deck-1")
        ?.zone
    ).toBe("set_aside");
    expect(
      resolved.state.players.find((player) => player.id === ALICE)?.handCount
    ).toBe(handCountBefore);

    const handAttempt = reveal([X03, C20, C21, FILLER, FILLER], 4, true);
    expect(() =>
      applyLegalAction({
        state: handAttempt,
        action: getPickAction(handAttempt),
        selectedDeckRevealCardIds: ["deck-1"],
        deckRevealPickFreeDestination: "hand",
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow(/blocked by hand_gain_prevention/);
  });

  it("有償ブランチは候補が1枚でもその1枚を選べ、training input を生成して pending を解消する", () => {
    const afterReveal = reveal([C20, FILLER, FILLER, FILLER, FILLER], 4);
    const pick = getPickAction(afterReveal);

    // DeckRevealPick.count は「指定枚数まで」。mandatory は候補がある場合の
    // 空選択だけを禁じるため、候補不足で branch 自体が不能になってはいけない。
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 0, candidateCardInstanceIds: [] },
      { count: 1, candidateCardInstanceIds: ["deck-1"], costGate: 1 },
    ]);

    const inputNode = createActionInputDecisionNode(afterReveal, pick, {
      getCardDefinitionById: getCardDef,
    });
    expect(inputNode?.fields).toEqual([
      "deckRevealPickFreeDestination",
      "paymentSources",
      "selectedDeckRevealCardIds",
    ]);
    const handInput = inputNode?.choices.find(
      (choice) =>
        choice.applyOptions?.deckRevealPickFreeDestination === "hand" &&
        choice.applyOptions?.selectedDeckRevealCardIds?.join(",") === "deck-1"
    );
    expect(handInput).toBeDefined();
    if (!handInput) throw new Error("hand input not generated");

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      ...handInput.applyOptions,
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(resolved.state.pendingDeckReveal).toBeNull();
    expect(
      resolved.state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(3);
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "deck-1")!.zone
    ).toBe("hand");
  });

  it("有償ブランチはリザーブ不足だと候補0枚になり選択できない (無償ブランチも空なら0選択で通過)", () => {
    const afterReveal = reveal([C20, C21, X01, FILLER, FILLER], 0);
    const pick = getPickAction(afterReveal);
    // 無償 branch は候補0枚→requiredCount 0。有償 branch は既存 legal surface と
    // 同じく declared count を保持するが、allEmpty により empty selection で remainder
    // 処理へ進む。
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 0, candidateCardInstanceIds: [] },
      { count: 3, candidateCardInstanceIds: [], costGate: 1 },
    ]);
    expect(pick.canSkip).toBe(true);

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: [],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(resolved.state.pendingDeckReveal).toBeNull();
    const alice = resolved.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    for (let i = 1; i <= 5; i++) {
      expect(
        resolved.state.cardInstances.find((c) => c.instanceId === `deck-${i}`)!
          .zone
      ).toBe("trash");
    }
  });

  it("hand_or_set_aside_choice は行き先未指定だと拒否される (1枚以上選択時)", () => {
    const afterReveal = reveal([X03, C20, C21, FILLER, FILLER]);
    const pick = getPickAction(afterReveal);

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: pick,
        selectedDeckRevealCardIds: ["deck-1"],
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow();
  });
});
