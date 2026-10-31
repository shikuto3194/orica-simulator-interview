/**
 * BSTH08.5-X03「[創界神/能楽の神]摩多羅 隠岐奈」【神技：3】Lv1-Lv2 フラッシュ:
 * 「コア3個ボイド→デッキ3枚オープンし、その中の系統：「面霊」を持つブレイヴカードすべて
 * 「か」面霊スピリットカード1枚を手札に加える。残ったカードは破棄する。」
 *
 * deck_reveal の picks[] は従来 AND 併取りのみで、オープン後の排他選択 (ブレイヴ全部 XOR
 * スピリット1枚) を表現できなかった primitive gap を DeckRevealPick.exclusiveGroup で解消する
 * (cluster: deck-reveal-exclusive-pick-choice)。コスト支払い/神技タイミング判定は
 * grandwalkerData.divineSkills の既存汎用検査に委ねるため、ここでは
 * skill.effects[0] (deck_reveal 本体) を executeEffect で直接検証する
 * (bsth05_5-cards.test.ts の effects 直接実行パターンと同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X03 = cardNoMap.get("BSTH08.5-X03")!;
const C20 = cardNoMap.get("BSTH08.5-C20")!; // 面霊ブレイヴ
const C21 = cardNoMap.get("BSTH08.5-C21")!; // 面霊ブレイヴ
const X01 = cardNoMap.get("BSTH08.5-X01")!; // 面霊スピリット
// 「面霊ブレイヴ」にも「面霊スピリット」にも一致しないフィラー (無関係カード)。
const FILLER: CardDefinition = {
  cardNo: "TEST-BSTH08.5-X03-FILLER",
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

function baseState(deckCards: CardDefinition[]): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const x03Instance = createCardInstance(X03, {
    instanceId: "x03",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
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
    cardInstances: [x03Instance, ...deckInstances],
  };
}

function skillEffect() {
  return X03.grandwalkerData!.divineSkills![0]!.effects![0]!;
}

describe("BSTH08.5-X03 【神技：3】card-data", () => {
  it("coreCost=3 / timing=flash / Lv1-2 / ターンに1回、picks は同一 exclusiveGroup の2ブランチ", () => {
    const skill = X03.grandwalkerData!.divineSkills![0]!;
    expect(skill.label).toBe("divine_skill");
    expect(skill.coreCost).toBe(3);
    expect(skill.timing).toBe("flash");
    expect(skill.minLevel).toBe(1);
    expect(skill.maxLevel).toBe(2);
    expect(skill.turnLimit).toBe("once");

    const action = skillEffect().steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind !== "deck_reveal") throw new Error("unreachable");
    expect(action.revealCount).toBe(3);
    expect(action.remainder).toBe("trash");
    expect(action.picks).toHaveLength(2);
    expect(action.picks[0]!.exclusiveGroup).toBe("brave_or_spirit");
    expect(action.picks[1]!.exclusiveGroup).toBe("brave_or_spirit");
    expect(action.picks[0]!.count).toBe(-1);
    expect(action.picks[1]!.count).toBe(1);
  });
});

describe("BSTH08.5-X03 【神技：3】deck_reveal 排他選択 (exclusiveGroup) 実行", () => {
  function reveal(deckCards: CardDefinition[]): GameState {
    return executeEffect({
      chainId: "test:bsth08_5-x03-deck-reveal-exclusive-pick:111",
      state: baseState(deckCards),
      effect: skillEffect(),
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
  }

  it("ブレイヴブランチ選択: 面霊ブレイヴ2枚すべてを手札に加え、面霊スピリットはトラッシュへ", () => {
    const afterReveal = reveal([C20, C21, X01]);
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.phase).toBe("picking");
    expect(afterReveal.pendingDeckReveal!.currentPickIndex).toBe(0);

    const pickActions = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = pickActions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    );
    expect(pick).toBeDefined();
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("unreachable");
    }
    // 候補は両ブランチの合算 (ブレイヴ2 + スピリット1)。
    expect(pick.candidateCardInstanceIds.slice().sort()).toEqual(
      ["deck-1", "deck-2", "deck-3"].sort()
    );
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 2, candidateCardInstanceIds: ["deck-1", "deck-2"] },
      { count: 1, candidateCardInstanceIds: ["deck-3"] },
    ]);

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1", "deck-2"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    // trash remainder は自動確定 (P3-93、置き順に意味が無い) → pendingDeckReveal は閉じる。
    expect(resolved.state.pendingDeckReveal).toBeNull();

    const aliceHand = resolved.state.cardInstances.filter(
      (c) => c.controllerPlayerId === ALICE && c.zone === "hand"
    );
    expect(aliceHand.map((c) => c.instanceId).sort()).toEqual([
      "deck-1",
      "deck-2",
    ]);
    const trashed = resolved.state.cardInstances.find(
      (c) => c.instanceId === "deck-3"
    )!;
    expect(trashed.zone).toBe("trash");
  });

  it("スピリットブランチ選択: 面霊スピリット1枚を手札に加え、面霊ブレイヴ2枚はトラッシュへ", () => {
    const afterReveal = reveal([C20, C21, X01]);
    const pickActions = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = pickActions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    )!;

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-3"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    expect(resolved.state.pendingDeckReveal).toBeNull();
    const aliceHand = resolved.state.cardInstances.filter(
      (c) => c.controllerPlayerId === ALICE && c.zone === "hand"
    );
    expect(aliceHand.map((c) => c.instanceId)).toEqual(["deck-3"]);
    for (const id of ["deck-1", "deck-2"]) {
      const trashed = resolved.state.cardInstances.find(
        (c) => c.instanceId === id
      )!;
      expect(trashed.zone).toBe("trash");
    }
  });

  it("両ブランチにまたがる選択 (ブレイヴ1枚+スピリット1枚) はどちらの要求も満たさず拒否される", () => {
    const afterReveal = reveal([C20, C21, X01]);
    const pickActions = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = pickActions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    )!;

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: pick,
        selectedDeckRevealCardIds: ["deck-1", "deck-3"],
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow();
  });

  it("「すべて」ブランチの候補が0枚でも、もう一方の mandatory ブランチに候補があれば空選択は拒否される（vacuous match 回帰防止）", () => {
    // 面霊ブレイヴ0枚・面霊スピリット1枚 → count:-1 ブランチの requiredCount は0になるが、
    // それを理由に空選択で素通りできてはならない（spirit ブランチが候補1枚で mandatory）。
    const afterReveal = reveal([X01, FILLER, FILLER]);
    const pickActions = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = pickActions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    );
    expect(pick).toBeDefined();
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("unreachable");
    }
    expect(pick.canSkip).toBe(false);
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 0, candidateCardInstanceIds: [] },
      { count: 1, candidateCardInstanceIds: ["deck-1"] },
    ]);

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: pick,
        selectedDeckRevealCardIds: [],
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow();

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(resolved.state.pendingDeckReveal).toBeNull();
    const aliceHand = resolved.state.cardInstances.filter(
      (c) => c.controllerPlayerId === ALICE && c.zone === "hand"
    );
    expect(aliceHand.map((c) => c.instanceId)).toEqual(["deck-1"]);
  });
});
