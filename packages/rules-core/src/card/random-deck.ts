import type { CardDefinition } from "../model";
import {
  getCardDefinitionMainDeckMaxCount,
  isContractDefinition,
} from "./card-filter";

export function randomDeck(
  cards: readonly CardDefinition[],
  size = 40,
  rng: () => number = Math.random,
  options: { allowUnavailableDeckCards?: boolean } = {}
): CardDefinition[] {
  if (size <= 0) return [];
  if (options.allowUnavailableDeckCards === true) {
    if (cards.length === 0) {
      throw new Error("randomDeck requires at least one card");
    }
    const deck: CardDefinition[] = [];
    for (let i = 0; i < size; i++) {
      deck.push(cards[Math.floor(rng() * cards.length)]!);
    }
    return deck;
  }

  const uniqueCandidates = new Map<string, CardDefinition>();
  for (const card of cards) {
    if (getCardDefinitionMainDeckMaxCount(card) <= 0) continue;
    if (!uniqueCandidates.has(card.cardNo)) {
      uniqueCandidates.set(card.cardNo, card);
    }
  }

  const nonContractCards: CardDefinition[] = [];
  const contractCards: CardDefinition[] = [];
  let nonContractCapacity = 0;
  for (const card of uniqueCandidates.values()) {
    const maxDeckCount = getCardDefinitionMainDeckMaxCount(card);
    if (isContractDefinition(card)) {
      contractCards.push(card);
    } else {
      nonContractCards.push(card);
      nonContractCapacity += maxDeckCount;
    }
  }

  const contractChoices: Array<CardDefinition | null> = [];
  if (nonContractCapacity >= size) contractChoices.push(null);
  for (const card of contractCards) {
    if (nonContractCapacity + getCardDefinitionMainDeckMaxCount(card) >= size) {
      contractChoices.push(card);
    }
  }

  if (contractChoices.length === 0) {
    throw new Error(
      `randomDeck cannot build ${size} cards within maxDeckCount and contract-card limits`
    );
  }

  const selectedContract =
    contractChoices[Math.floor(rng() * contractChoices.length)] ?? null;
  const candidateCards = selectedContract
    ? [...nonContractCards, selectedContract]
    : nonContractCards;
  const remaining = candidateCards.map((def) => ({
    def,
    count: getCardDefinitionMainDeckMaxCount(def),
  }));

  const deck: CardDefinition[] = [];
  while (deck.length < size) {
    const eligible = remaining.filter((entry) => entry.count > 0);
    if (eligible.length === 0) {
      throw new Error(
        `randomDeck ran out of candidates after ${deck.length} cards`
      );
    }
    const picked = eligible[Math.floor(rng() * eligible.length)]!;
    picked.count -= 1;
    deck.push(picked.def);
  }
  return deck;
}
