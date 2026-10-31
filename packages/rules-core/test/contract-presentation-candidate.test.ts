import { ALL_CARDS } from "../../card-data/src/generated-index";
import { describe, expect, it } from "vitest";
import { initializeGame } from "../src/factories";
import type { CardDefinition } from "../src/model";

const contractAdventCard = ALL_CARDS.find(
  (card) => card.cardNo === "BSSL01-C01"
)!;
const printedContractCard = ALL_CARDS.find(
  (card) => card.cardNo === "BSSL01-CX01"
)!;
const normalCard = ALL_CARDS.find((card) => card.cardNo === "BSSL01-C02")!;

function deck(...cards: CardDefinition[]): CardDefinition[] {
  return [...cards, ...Array(40 - cards.length).fill(normalCard)];
}

describe("契約提示候補", () => {
  it("契約煌臨するカードだけを採用したデッキでは契約提示を開始しない", () => {
    const state = initializeGame({
      decks: [deck(contractAdventCard), deck()],
      allowUnavailableDeckCards: true,
    });

    expect(contractAdventCard.adventData?.adventVariant).toBe("contract");
    expect(contractAdventCard.keywordTags).not.toContain("contract");
    expect(state.preGame?.phase).toBe("waiting_janken");
    expect(state.preGame?.contractCandidateCardNos).toBeUndefined();
  });

  it("契約煌臨カードが先に含まれていても、印字種類が契約のカードだけを提示する", () => {
    const state = initializeGame({
      decks: [deck(contractAdventCard, printedContractCard), deck()],
      allowUnavailableDeckCards: true,
    });

    expect(printedContractCard.keywordTags).toContain("contract");
    expect(state.preGame?.phase).toBe("waiting_contract");
    expect(state.preGame?.contractCandidateCardNos).toEqual({
      alice: "BSSL01-CX01",
    });
  });
});
