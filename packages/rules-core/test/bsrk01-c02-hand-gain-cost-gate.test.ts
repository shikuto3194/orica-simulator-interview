/**
 * BSRK01-C02「神谷薫」effects[1] (textRef[3,4]):
 *   engine-opponent-hand-gain-paid-tax-gate cluster、新設プリミティブ require_hand_gain_cost。
 *
 * 「Lv1-Lv2『相手のターン』〔重複不可〕相手は、1コスト支払わなければ、相手の効果で
 *  デッキ/トラッシュ/オープンしたカードから手札を増やせない。」
 *
 * require_hand_gain_cost: 相手プレイヤーに hand_gain_cost_gate CE (player-scoped,
 * timingScope で「相手のターン」に限定) を登録するだけの宣言 primitive。実際の
 * affordability 判定・自動支払いは deck-reveal-pick-candidates.ts の
 * resolveDeckRevealCostGateToApply が DeckRevealPick.costGate と同じ経路
 * (BSTH08.5-C23 由来) に合成する。
 *
 * effects[0] (デッキ上2枚見て1枚手札に加える) / effects[2] (Lv2 相手の効果を受けない) は
 * 既存テスト (bsrk01-cards.test.ts) で別途検証済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  collectContinuousEffectInvariantIssues,
  createCardInstance,
  createActionInputDecisionNode,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  materializeDeferredTrashOptionalAdds,
  rebuildContinuousEffectsFromField,
} from "../src";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  GameStateInvariantIssue,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C02 = cardNoMap.get("BSRK01-C02")!;
const C24 = cardNoMap.get("BSTH08.5-C24")!;

const ALICE = "alice";
const BOB = "bob";

it("神谷薫の同名別個体は対価CEを1件だけ登録する", () => {
  const copies = ["kaoru-a", "kaoru-b"].map((instanceId) =>
    createCardInstance(C02, { instanceId, ownerPlayerId: ALICE, zone: "field" })
  );
  let state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: copies,
  });
  state = { ...state, activePlayerId: BOB, step: "main" };
  for (const source of copies)
    state = executeEffect({
      chainId: "test:bsrk01-c02-hand-gain-cost-gate:57",
      state,
      effect: C02.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });
  expect(
    state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "hand_gain_cost_gate"
    )
  ).toHaveLength(1);
});

// bob 側の「デッキ上2枚を見て1枚を手札に加える」効果 (BSRK01-C02 effects[0] と同型の
// 汎用 deck_reveal idiom)。相手 (alice) の hand_gain_cost_gate がこの手札加算を課税対象にする。
const BOB_DECK_PEEK: CardDefinition = {
  cardNo: "TEST-BOB-DECK-PEEK",
  name: "test bob deck peek",
  printedCategory: "nexus",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 2,
            picks: [{ count: 1 }],
            remainder: "bottom",
          },
        },
      ],
    },
  ],
};

// 「手札に加えるまたは手元に置く」選択型。BSRK01-C02 の hand_gain_cost_gate が
// 手札だけに課され、手元選択はコスト0でも残ることを検証する。
const BOB_DECK_HAND_OR_SET_ASIDE: CardDefinition = {
  cardNo: "TEST-BOB-DECK-HAND-OR-SET-ASIDE",
  name: "test bob deck hand or set aside",
  printedCategory: "nexus",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 2,
            picks: [{ count: 1, destination: "hand_or_set_aside_choice" }],
            remainder: "bottom",
          },
        },
      ],
    },
  ],
};

// BSTH01-R12 型「デッキからオープンされたこのカードは手札に加えられる」idiom
// (event:"revealed" + cardEventDisposition、revealed_choice フェーズ経由)。
// origin:"deck" の revealed_choice / origin:"trash" の任意手札追加 (トラッシュ経由)
// どちらの検証にも使い回す (両者とも同じ RevealedDisposition 機構)。
const BOB_SELF_REVEAL_CARD: CardDefinition = {
  cardNo: "TEST-BOB-SELF-REVEAL",
  name: "test bob self reveal",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "revealed" },
      cardEventDisposition: { kind: "move", destination: "hand" },
      executionMode: "optional",
      steps: [{ action: { kind: "move_self", destination: "hand" } }],
    },
  ],
};

const testCardMap = new Map<string, CardDefinition>([
  [BOB_DECK_PEEK.cardNo, BOB_DECK_PEEK],
  [BOB_DECK_HAND_OR_SET_ASIDE.cardNo, BOB_DECK_HAND_OR_SET_ASIDE],
  [BOB_SELF_REVEAL_CARD.cardNo, BOB_SELF_REVEAL_CARD],
]);
const getCardDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? testCardMap.get(id);

function findHandGainCostGateEffect() {
  return C02.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "require_hand_gain_cost")
  )!;
}

describe("BSRK01-C02 effects[1]: require_hand_gain_cost 新設プリミティブ", () => {
  it("effect 定義: timingScope『相手のターン』+ require_hand_gain_cost 1 step", () => {
    const effect = findHandGainCostGateEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.timingScope).toEqual({ player: "opponent", period: "turn" });
    expect(effect.steps).toHaveLength(1);

    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("require_hand_gain_cost");
    if (action.kind !== "require_hand_gain_cost") {
      throw new Error("unreachable");
    }
    expect(action.player).toBe("opponent");
    expect(action.costAmount).toBe(1);
    expect(action.duration).toEqual({ scope: "while_on_field" });
  });

  it("実行すると hand_gain_cost_gate CE (targetInstanceId=相手) が登録される", () => {
    const kaoru = createCardInstance(C02, {
      instanceId: "kaoru",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [kaoru],
    };
    const effect = findHandGainCostGateEffect();
    const after = executeEffect({
      chainId: "test:bsrk01-c02-hand-gain-cost-gate:212",
      state,
      effect,
      sourceInstanceId: "kaoru",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });

    const gateCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "hand_gain_cost_gate"
    );
    expect(gateCEs).toHaveLength(1);
    expect(gateCEs[0]!.targetInstanceId).toBe(BOB);
    expect(gateCEs[0]!.metadata).toEqual({ costAmount: 1 });
    expect(gateCEs[0]!.duration).toEqual({ scope: "while_on_field" });
    expect(gateCEs[0]!.timingScope).toEqual({
      player: "opponent",
      period: "turn",
    });
  });

  it("相手ターン限定 CE は自分のターンの recompute 後も保持され invariant に合格する (EDH-0002-01)", () => {
    const kaoru = createCardInstance(C02, {
      instanceId: "kaoru",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [kaoru],
    };

    const rebuilt = rebuildContinuousEffectsFromField(state, getCardDef);
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "kaoru" &&
          ce.modifierTag === "hand_gain_cost_gate"
      )
    ).toHaveLength(1);

    const recomputed = recomputeContinuousEffects(rebuilt);
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "kaoru" &&
          ce.modifierTag === "hand_gain_cost_gate"
      )
    ).toHaveLength(1);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: recomputed,
      issues,
      getCardDefinitionById: getCardDef,
    });
    expect(
      issues.filter(
        (issue) =>
          issue.code === "missing_continuous_effect" &&
          issue.path === "activeContinuousEffects[kaoru:1]"
      )
    ).toHaveLength(0);
  });
});

function gateCE(): ContinuousEffect {
  return {
    effectId: "ce-hand-gain-cost-gate-test",
    sourceInstanceId: "kaoru",
    sourceDefinitionId: C02.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "hand_gain_cost_gate",
    targetInstanceId: BOB,
    metadata: { costAmount: 1 },
    timingScope: { player: "opponent", period: "turn" },
  };
}

describe("BSRK01-C02: hand_gain_cost_gate による相手デッキ手札加算のコストゲート", () => {
  function revealState(options: {
    bobReserve: number;
    activePlayerId?: string;
  }): GameState {
    const bobCard = createCardInstance(BOB_DECK_PEEK, {
      instanceId: "bob-peek",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const deckCards = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(BOB_DECK_PEEK, {
        instanceId: `bob-deck-${i + 1}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { reserveNormalCoreCount: options.bobReserve }],
    });
    return {
      ...base,
      activePlayerId: options.activePlayerId ?? BOB,
      step: "main",
      cardInstances: [bobCard, ...deckCards],
      activeContinuousEffects: [gateCE()],
    };
  }

  function reveal(state: GameState) {
    return executeEffect({
      chainId: "test:bsrk01-c02-hand-gain-cost-gate:331",
      state,
      effect: BOB_DECK_PEEK.effects![0]!,
      sourceInstanceId: "bob-peek",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
  }

  function getPickAction(state: GameState) {
    const actions = getLegalActions({
      state,
      actingPlayerId: BOB,
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

  function revealHandOrSetAside(state: GameState) {
    const choiceSource = createCardInstance(BOB_DECK_HAND_OR_SET_ASIDE, {
      instanceId: "bob-choice",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    return executeEffect({
      chainId: "test:bsrk01-c02-hand-gain-cost-gate:363",
      state: {
        ...state,
        cardInstances: [...state.cardInstances, choiceSource],
      },
      effect: BOB_DECK_HAND_OR_SET_ASIDE.effects![0]!,
      sourceInstanceId: "bob-choice",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
  }

  it("リザーブ不足なら手札加算ピックの候補が0枚になり選択できない(デッキ下へ据え置き)", () => {
    const afterReveal = reveal(revealState({ bobReserve: 0 }));
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds).toEqual([]);
    expect(pick.canSkip).toBe(true);

    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: [],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    // remainder:"bottom" かつ残り2枚 (>1) は戻し順選択が必要 (shouldAutoFinalizeDeckRevealRemainder)。
    expect(afterPick.state.pendingDeckReveal?.phase).toBe("ordering_remainder");
    const orderAction = getLegalActions({
      state: afterPick.state,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (a) => a.kind === "resolve_pending_deck_reveal_order"
    );
    if (
      !orderAction ||
      orderAction.kind !== "resolve_pending_deck_reveal_order"
    ) {
      throw new Error("resolve_pending_deck_reveal_order action not found");
    }
    const remaining = orderAction.remainingCardInstanceIds;
    const resolved = applyLegalAction({
      state: afterPick.state,
      action: orderAction,
      getCardDefinitionById: getCardDef,
      deckRevealRemainderOrder: remaining,
      deckRevealRemainderPlacements: Object.fromEntries(
        remaining.map((id) => [id, "bottom"])
      ),
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    expect(resolved.state.pendingDeckReveal).toBeNull();
    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(0);
    for (const id of ["bob-deck-1", "bob-deck-2"]) {
      expect(
        resolved.state.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("deck");
    }
  });

  it("手札/手元の二択では、0コアでも手元を選べるが手札選択は C02 の対価 gate で拒否する", () => {
    const afterReveal = revealHandOrSetAside(revealState({ bobReserve: 0 }));
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds.sort()).toEqual([
      "bob-deck-1",
      "bob-deck-2",
    ]);
    expect(pick.freeDestinationChoices).toEqual(["set_aside"]);

    const setAside = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["bob-deck-1"],
      deckRevealPickFreeDestination: "set_aside",
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(
      setAside.state.cardInstances.find(
        (card) => card.instanceId === "bob-deck-1"
      )?.zone
    ).toBe("set_aside");
    expect(
      setAside.state.players.find((player) => player.id === BOB)
        ?.reserveNormalCoreCount
    ).toBe(0);

    const handAttempt = revealHandOrSetAside(revealState({ bobReserve: 0 }));
    expect(() =>
      applyLegalAction({
        state: handAttempt,
        action: getPickAction(handAttempt),
        selectedDeckRevealCardIds: ["bob-deck-1"],
        deckRevealPickFreeDestination: "hand",
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow(/blocked by hand_gain_cost_gate/);
  });

  it("手札/手元の二択で 1 コアあれば、手札選択は C02 の対価を支払って完走する", () => {
    const afterReveal = revealHandOrSetAside(revealState({ bobReserve: 1 }));
    const pick = getPickAction(afterReveal);
    expect(pick.freeDestinationChoices).toBeUndefined();

    const hand = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["bob-deck-1"],
      deckRevealPickFreeDestination: "hand",
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(
      hand.state.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
    expect(
      hand.state.players.find((player) => player.id === BOB)
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("リザーブが足りれば1枚選んで手札に加えられ、対価1コストが自動で支払われる", () => {
    const afterReveal = reveal(revealState({ bobReserve: 2 }));
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds.sort()).toEqual([
      "bob-deck-1",
      "bob-deck-2",
    ]);

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["bob-deck-1"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    expect(resolved.state.pendingDeckReveal).toBeNull();
    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(1); // 2 - 1コスト
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "bob-deck-1")!
        .zone
    ).toBe("hand");
  });

  it("gate の timingScope『相手のターン』が非アクティブ(自分のターン)なら課税されない", () => {
    const afterReveal = reveal(
      revealState({ bobReserve: 0, activePlayerId: ALICE })
    );
    const pick = getPickAction(afterReveal);
    // gate owner (alice) 視点で "opponent" スコープだが、activePlayerId が alice 自身
    // (= alice のターン) のため isTimingScopeActive が false になり CE は無視される。
    expect(pick.candidateCardInstanceIds.sort()).toEqual([
      "bob-deck-1",
      "bob-deck-2",
    ]);
  });
});

// adversarial verifier round2 refute: deck_reveal の二択だけを守っても、同じ
// hand_or_set_aside_choice を使う search_zone (BSTH08.5-C24) が C02 を迂回してはならない。
describe("BSRK01-C02: BSTH08.5-C24 のトラッシュ→手札/手元 per-card choice", () => {
  function resolveC24Choice(bobReserve: number): GameState {
    const source = createCardInstance(C24, {
      instanceId: "c24-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const trashed = createCardInstance(C24, {
      instanceId: "c24-trashed",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { reserveNormalCoreCount: bobReserve }],
    });
    return executeEffect({
      chainId: "test:bsrk01-c02-hand-gain-cost-gate:553",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [source, trashed],
        activeContinuousEffects: [gateCE()],
      },
      effect: C24.accelData!.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
  }

  function getZoneSelectionAction(state: GameState) {
    const action = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (candidate) => candidate.kind === "resolve_pending_zone_selection"
    );
    if (!action || action.kind !== "resolve_pending_zone_selection") {
      throw new Error("resolve_pending_zone_selection action not found");
    }
    return action;
  }

  it("0コアでは手元だけを legal/training surface に残し、偽装手札選択を拒否する", () => {
    const afterEffect = resolveC24Choice(0);
    const action = getZoneSelectionAction(afterEffect);
    expect(action.perCardDestinationChoices).toEqual({
      "c24-trashed": ["set_aside"],
    });

    const inputNode = createActionInputDecisionNode(afterEffect, action, {
      getCardDefinitionById: getCardDef,
    });
    expect(
      inputNode?.choices.some(
        (choice) =>
          choice.applyOptions?.zoneSelectionDestinationByCardId?.[
            "c24-trashed"
          ] === "hand"
      )
    ).toBe(false);
    const setAsideInput = inputNode?.choices.find(
      (choice) =>
        choice.applyOptions?.zoneSelectionDestinationByCardId?.[
          "c24-trashed"
        ] === "set_aside"
    );
    expect(setAsideInput).toBeDefined();

    const setAside = applyLegalAction({
      state: afterEffect,
      action,
      ...setAsideInput?.applyOptions,
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(
      setAside.state.cardInstances.find(
        (card) => card.instanceId === "c24-trashed"
      )?.zone
    ).toBe("set_aside");
    expect(
      setAside.state.players.find((player) => player.id === BOB)
        ?.reserveNormalCoreCount
    ).toBe(0);

    const handAttempt = resolveC24Choice(0);
    expect(() =>
      applyLegalAction({
        state: handAttempt,
        action: getZoneSelectionAction(handAttempt),
        selectedZoneCardIds: ["c24-trashed"],
        zoneSelectionDestinationByCardId: { "c24-trashed": "hand" },
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow(/blocked by hand_gain_cost_gate/);
  });

  it("1コアなら手札を選べ、C02 の対価を一度だけ支払って完走する", () => {
    const afterEffect = resolveC24Choice(1);
    const action = getZoneSelectionAction(afterEffect);
    expect(action.perCardDestinationChoices?.["c24-trashed"]).toEqual([
      "hand",
      "set_aside",
    ]);

    const hand = applyLegalAction({
      state: afterEffect,
      action,
      selectedZoneCardIds: ["c24-trashed"],
      zoneSelectionDestinationByCardId: { "c24-trashed": "hand" },
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(
      hand.state.cardInstances.find((card) => card.instanceId === "c24-trashed")
        ?.zone
    ).toBe("hand");
    expect(
      hand.state.players.find((player) => player.id === BOB)
        ?.reserveNormalCoreCount
    ).toBe(0);
  });
});

// adversarial verifier round1 refute: picks[]/picking フェーズだけでなく、同じ
// PendingDeckReveal が持つ revealed_choice フェーズ (origin:"deck" の revealed disposition
// 自己手札追加 = BSTH01-R12 型「オープンされたこのカードは手札に加えられる」、および
// origin:"trash" の任意手札追加) にも hand_gain_cost_gate を適用しないと、この経路で
// 無償の手札加算が素通りしてしまう (silent bug)。
describe("BSRK01-C02: hand_gain_cost_gate は revealed_choice フェーズ(オープン/トラッシュの手札加算)にも適用される", () => {
  function getRevealedChoicePickAction(state: GameState) {
    const actions = getLegalActions({
      state,
      actingPlayerId: BOB,
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

  function revealWithSelfRevealCard(bobReserve: number): GameState {
    const bobPeek = createCardInstance(BOB_DECK_PEEK, {
      instanceId: "bob-peek2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const selfRevealCard = createCardInstance(BOB_SELF_REVEAL_CARD, {
      instanceId: "bob-self-reveal",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
    });
    const filler = createCardInstance(BOB_DECK_PEEK, {
      instanceId: "bob-filler",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { reserveNormalCoreCount: bobReserve }],
    });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [bobPeek, selfRevealCard, filler],
      activeContinuousEffects: [gateCE()],
    };
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-c02-hand-gain-cost-gate:719",
      state,
      effect: BOB_DECK_PEEK.effects![0]!,
      sourceInstanceId: "bob-peek2",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(afterReveal.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(afterReveal.pendingDeckReveal?.origin).toBe("deck");
    return afterReveal;
  }

  it("origin:deck の revealed disposition (オープン自己手札追加) はリザーブ不足だと候補から除外される", () => {
    const afterReveal = revealWithSelfRevealCard(0);
    const pick = getRevealedChoicePickAction(afterReveal);
    expect(pick.candidateCardInstanceIds).not.toContain("bob-self-reveal");
  });

  it("origin:deck でリザーブが足りれば選択でき、1コストが自動徴収される", () => {
    const afterReveal = revealWithSelfRevealCard(1);
    const pick = getRevealedChoicePickAction(afterReveal);
    expect(pick.candidateCardInstanceIds).toContain("bob-self-reveal");

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["bob-self-reveal"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(0); // 1 - 1コスト
    expect(
      resolved.state.cardInstances.find(
        (c) => c.instanceId === "bob-self-reveal"
      )!.zone
    ).toBe("hand");
  });

  it("origin:trash (moved_to_trash 任意手札追加) もリザーブ不足だと候補から除外される", () => {
    const trashCard = createCardInstance(BOB_SELF_REVEAL_CARD, {
      instanceId: "bob-trash-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [trashCard],
      activeContinuousEffects: [gateCE()],
      pendingTrashOptionalAdds: [
        { actingPlayerId: BOB, instanceIds: ["bob-trash-card"] },
      ],
    };
    const materialized = materializeDeferredTrashOptionalAdds(state);
    expect(materialized.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(materialized.pendingDeckReveal?.origin).toBe("trash");

    const pick = getRevealedChoicePickAction(materialized);
    expect(pick.candidateCardInstanceIds).toEqual([]);
  });

  it("origin:trash でリザーブが足りれば選択でき、1コストが自動徴収される", () => {
    const trashCard = createCardInstance(BOB_SELF_REVEAL_CARD, {
      instanceId: "bob-trash-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { reserveNormalCoreCount: 1 }],
    });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [trashCard],
      activeContinuousEffects: [gateCE()],
      pendingTrashOptionalAdds: [
        { actingPlayerId: BOB, instanceIds: ["bob-trash-card"] },
      ],
    };
    const materialized = materializeDeferredTrashOptionalAdds(state);
    const pick = getRevealedChoicePickAction(materialized);
    expect(pick.candidateCardInstanceIds).toEqual(["bob-trash-card"]);

    const resolved = applyLegalAction({
      state: materialized,
      action: pick,
      selectedDeckRevealCardIds: ["bob-trash-card"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(0); // 1 - 1コスト
    expect(
      resolved.state.cardInstances.find(
        (c) => c.instanceId === "bob-trash-card"
      )!.zone
    ).toBe("hand");
  });
});
