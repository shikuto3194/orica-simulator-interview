import { describe, expect, it } from "vitest";

import {
  getCardDefinitionMainDeckMaxCount,
  initializeGame,
  isCardDefinitionMainDeckAllowed,
  randomDeck,
  sanitizeMainDeckDefinitions,
  type CardDefinition,
} from "../src";

function spirit(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    colors: ["red"],
    symbolColors: ["red"],
    cost: 1,
    reduction: [],
    reductionSymbols: [],
    category: "spirit",
    printedCategory: "spirit",
    bp: 1000,
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
    ...overrides,
  };
}

const ALLOWED = spirit("TEST-DECK-ALLOWED");
const HIGH_LIMIT = spirit("TEST-DECK-HIGH-LIMIT", { maxDeckCount: 8 });
const MAX_ONE = spirit("TEST-DECK-MAX-ONE", { maxDeckCount: 1 });
const MAX_TWO = spirit("TEST-DECK-MAX-TWO", { maxDeckCount: 2 });
const MAX_ZERO = spirit("TEST-DECK-MAX-ZERO", { maxDeckCount: 0 });
const CONTRACT_A = spirit("TEST-DECK-CONTRACT-A", {
  keywordTags: ["contract"],
  maxDeckCount: 2,
});
const CONTRACT_B = spirit("TEST-DECK-CONTRACT-B", {
  keywordTags: ["contract"],
  maxDeckCount: 2,
});
const TOKEN = spirit("TEST-DECK-TOKEN", {
  maxDeckCount: 0,
  maxTokenDeckCount: 1,
  keywordTags: ["token"],
});

describe("main deck availability", () => {
  it("treats maxDeckCount:0 non-token cards and token cards as unavailable", () => {
    expect(isCardDefinitionMainDeckAllowed(ALLOWED)).toBe(true);
    expect(isCardDefinitionMainDeckAllowed(MAX_ZERO)).toBe(false);
    expect(isCardDefinitionMainDeckAllowed(TOKEN)).toBe(false);
    expect(getCardDefinitionMainDeckMaxCount(HIGH_LIMIT)).toBe(8);
  });

  it("rejects unavailable cards in initializeGame by default", () => {
    expect(() =>
      initializeGame({
        decks: [[MAX_ZERO], [ALLOWED]],
        skipPreGame: true,
      })
    ).toThrow(/maxDeckCount=0/);

    expect(() =>
      initializeGame({
        decks: [[TOKEN], [ALLOWED]],
        skipPreGame: true,
      })
    ).toThrow(/token/);
  });

  it("rejects copies above maxDeckCount and multiple contract card types", () => {
    expect(() =>
      initializeGame({
        decks: [[MAX_ONE, MAX_ONE], [ALLOWED]],
        skipPreGame: true,
      })
    ).toThrow(/maxDeckCount=1/);

    expect(() =>
      initializeGame({
        decks: [[CONTRACT_A, CONTRACT_B], [ALLOWED]],
        skipPreGame: true,
      })
    ).toThrow(/contract cards must be one type/);
  });

  it("allows unavailable cards only with an explicit fixture option", () => {
    const state = initializeGame({
      decks: [[MAX_ZERO, MAX_ONE, MAX_ONE, CONTRACT_A, CONTRACT_B], [TOKEN]],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });

    expect(state.cardInstances.map((card) => card.definitionId).sort()).toEqual(
      [
        MAX_ZERO.cardNo,
        MAX_ONE.cardNo,
        MAX_ONE.cardNo,
        CONTRACT_A.cardNo,
        CONTRACT_B.cardNo,
        TOKEN.cardNo,
      ].sort()
    );
  });

  it("excludes unavailable cards from AI random decks unless explicitly allowed", () => {
    expect(
      randomDeck([MAX_ZERO, HIGH_LIMIT, TOKEN], 8, () => 0).map(
        (card) => card.cardNo
      )
    ).toEqual(Array(8).fill(HIGH_LIMIT.cardNo));

    expect(
      randomDeck([MAX_ZERO, HIGH_LIMIT, TOKEN], 1, () => 0, {
        allowUnavailableDeckCards: true,
      })[0]?.cardNo
    ).toBe(MAX_ZERO.cardNo);
  });

  it("keeps random decks within per-card maxDeckCount", () => {
    const deck = randomDeck([MAX_ONE, MAX_TWO, HIGH_LIMIT], 8, () => 0);
    const counts = new Map<string, number>();
    for (const card of deck) {
      counts.set(card.cardNo, (counts.get(card.cardNo) ?? 0) + 1);
    }

    expect(counts.get(MAX_ONE.cardNo)).toBe(1);
    expect(counts.get(MAX_TWO.cardNo)).toBe(2);
    expect(counts.get(HIGH_LIMIT.cardNo)).toBe(5);
  });

  it("keeps random decks to one contract card type", () => {
    const filler = spirit("TEST-DECK-FILLER", { maxDeckCount: 38 });
    const deck = randomDeck([filler, CONTRACT_A, CONTRACT_B], 40, () => 0);
    const contractCardNos = new Set(
      deck
        .filter((card) => card.keywordTags.includes("contract"))
        .map((card) => card.cardNo)
    );

    expect(deck).toHaveLength(40);
    expect(contractCardNos.size).toBeLessThanOrEqual(1);
  });

  it("sanitizes imported main decks with the same rules", () => {
    expect(
      sanitizeMainDeckDefinitions([
        MAX_ZERO,
        MAX_ONE,
        MAX_ONE,
        CONTRACT_A,
        CONTRACT_A,
        CONTRACT_B,
      ]).map((card) => card.cardNo)
    ).toEqual([MAX_ONE.cardNo, CONTRACT_A.cardNo, CONTRACT_A.cardNo]);
  });
});
