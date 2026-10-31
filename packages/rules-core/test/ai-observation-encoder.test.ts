import { describe, expect, it } from "vitest";

import {
  AI_OBSERVATION_CARD_FEATURE_DIM,
  AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX,
  AI_OBSERVATION_ENCODER_PENDING_KIND_DOMAIN,
  AI_OBSERVATION_GLOBAL_FEATURE_DIM,
  AI_OBSERVATION_KNOWN_DECK_FEATURE_DIM,
  AI_OBSERVATION_PENDING_FIELD_ROLES,
  AI_UNKNOWN_CARD,
  buildAiObservation,
  buildAiObservationCardVocabulary,
  createCardInstance,
  createEmptyGameState,
  encodeAiObservation,
  type CardDefinition,
  type GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

const HOST: CardDefinition = {
  cardNo: "AI-ENC-HOST",
  name: "AI Encoder Host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 3, bp: 5000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "Encoder",
};

const ALICE_HAND: CardDefinition = {
  ...HOST,
  cardNo: "AI-ENC-ALICE-HAND",
  name: "AI Encoder Alice Hand",
  cost: 1,
};

const BOB_HAND: CardDefinition = {
  ...HOST,
  cardNo: "AI-ENC-BOB-HAND",
  name: "AI Encoder Bob Hand",
  colors: ["purple"],
  symbolColors: ["purple"],
};

const BOB_BURST: CardDefinition = {
  ...HOST,
  cardNo: "AI-ENC-BOB-BURST",
  name: "AI Encoder Bob Burst",
  colors: ["yellow"],
  symbolColors: ["yellow"],
};

const KNOWN_DECK: CardDefinition = {
  ...HOST,
  cardNo: "AI-ENC-KNOWN-DECK",
  name: "AI Encoder Known Deck",
};

const defs = [HOST, ALICE_HAND, BOB_HAND, BOB_BURST, KNOWN_DECK];
const getDef = (id: string): CardDefinition | undefined =>
  defs.find((def) => def.cardNo === id);

function makeState(): GameState {
  const host = createCardInstance(HOST, {
    instanceId: "host",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 3,
  });
  const aliceHand = createCardInstance(ALICE_HAND, {
    instanceId: "alice-hand",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const bobHand = createCardInstance(BOB_HAND, {
    instanceId: "bob-hand",
    ownerPlayerId: BOB,
    zone: "hand",
  });
  const bobBurst = createCardInstance(BOB_BURST, {
    instanceId: "bob-burst",
    ownerPlayerId: BOB,
    zone: "burst",
    faceDown: true,
  });
  const knownDeck = createCardInstance(KNOWN_DECK, {
    instanceId: "known-deck-bottom",
    ownerPlayerId: ALICE,
    zone: "deck",
  });

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, aliceHand, bobHand, bobBurst, knownDeck],
      playerOverrides: [
        { handCount: 1, deckCount: 1 },
        { handCount: 1, deckCount: 0 },
      ],
    }),
    setBurstStates: [{ playerId: BOB, cardInstanceId: "bob-burst" }],
    knownDeckCards: [
      {
        playerId: ALICE,
        indexFromBottom: 0,
        definitionIdSnapshot: KNOWN_DECK.cardNo,
        audience: "actor_only",
        actorPlayerId: ALICE,
      },
    ],
  };
}

function makeObservation() {
  return buildAiObservation({
    state: makeState(),
    viewpointPlayerId: ALICE,
    mode: "player",
    getCardDefinitionById: getDef,
  });
}

function expectFiniteVector(values: readonly number[]): void {
  expect(values.every((value) => Number.isFinite(value))).toBe(true);
}

describe("AiObservation encoder", () => {
  it("normalizes public disclosure history length in policy input", () => {
    const oneDisclosure = makeState();
    oneDisclosure.publicDisclosures = [
      {
        id: "public-disclosure:1",
        sequence: 1,
        turnNumber: oneDisclosure.turnNumber,
        step: oneDisclosure.step,
        actorPlayerId: ALICE,
        audience: "both",
        kind: "state_changed",
        targets: [],
        results: [],
      },
    ];
    const moreDisclosures = structuredClone(oneDisclosure);
    moreDisclosures.publicDisclosures.push({
      ...oneDisclosure.publicDisclosures[0]!,
      id: "public-disclosure:2",
      sequence: 2,
    });

    const oneEncoded = encodeAiObservation({
      observation: buildAiObservation({
        state: oneDisclosure,
        viewpointPlayerId: ALICE,
        mode: "player",
        getCardDefinitionById: getDef,
      }),
    });
    const moreEncoded = encodeAiObservation({
      observation: buildAiObservation({
        state: moreDisclosures,
        viewpointPlayerId: ALICE,
        mode: "player",
        getCardDefinitionById: getDef,
      }),
    });

    expect(moreEncoded.global).toEqual(oneEncoded.global);
  });

  it("encodes token-deck cards with a distinct schema-v3 zone bit", () => {
    const observation = makeObservation();
    const encoded = encodeAiObservation({
      observation: {
        ...observation,
        cards: [{ ...observation.cards[0]!, zone: "token_pool" }],
      },
      maxCards: 1,
    });
    expect(encoded.schemaVersion).toBe(3);
    expect(
      encoded.cards[0]!.features[AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX]
    ).toBe(1);
    expect(encoded.cards[0]!.features).toHaveLength(
      AI_OBSERVATION_CARD_FEATURE_DIM
    );
  });

  it("encodes visible observation frames as fixed-size finite tensors", () => {
    const observation = makeObservation();
    const vocabulary = buildAiObservationCardVocabulary(
      defs.map((def) => def.cardNo)
    );
    const encoded = encodeAiObservation({
      observation,
      cardVocabulary: vocabulary,
      maxCards: 12,
      maxKnownDeckEntries: 4,
    });

    expect(encoded.global).toHaveLength(AI_OBSERVATION_GLOBAL_FEATURE_DIM);
    expect(encoded.cards).toHaveLength(12);
    expect(encoded.knownDeck).toHaveLength(4);
    expect(encoded.metadata.cardFeatureDim).toBe(
      AI_OBSERVATION_CARD_FEATURE_DIM
    );
    expect(encoded.metadata.knownDeckFeatureDim).toBe(
      AI_OBSERVATION_KNOWN_DECK_FEATURE_DIM
    );
    expect(encoded.cardMask.filter(Boolean)).toHaveLength(
      observation.cards.length
    );
    expect(encoded.knownDeckMask.filter(Boolean)).toHaveLength(
      observation.knownDeck.length
    );
    expectFiniteVector(encoded.global);
    for (const card of encoded.cards) expectFiniteVector(card.features);
    for (const entry of encoded.knownDeck) expectFiniteVector(entry.features);

    const ownHandIndex = encoded.cardInstanceIds.indexOf("alice-hand");
    expect(encoded.cards[ownHandIndex]?.embIndex).toBe(
      vocabulary.get(ALICE_HAND.cardNo)
    );

    const hiddenBurstIndex = encoded.cardInstanceIds.indexOf("bob-burst");
    expect(encoded.cards[hiddenBurstIndex]?.embIndex).toBe(0);
    expect(observation.cards[hiddenBurstIndex]?.cardNoOrUnknown).toBe(
      AI_UNKNOWN_CARD
    );

    expect(encoded.cardInstanceIds).not.toContain("bob-hand");
    expect(encoded.knownDeck.find((entry) => entry.mask === 1)?.embIndex).toBe(
      vocabulary.get(KNOWN_DECK.cardNo)
    );
  });

  it("reports truncation and pads masks deterministically", () => {
    const observation = makeObservation();
    const encoded = encodeAiObservation({
      observation,
      maxCards: 1,
      maxKnownDeckEntries: 0,
    });

    expect(encoded.cards).toHaveLength(1);
    expect(encoded.cardMask).toEqual([1]);
    expect(encoded.knownDeck).toHaveLength(0);
    expect(encoded.knownDeckMask).toEqual([]);
    expect(encoded.metadata.truncatedCardCount).toBe(
      observation.cards.length - 1
    );
    expect(encoded.metadata.truncatedKnownDeckCount).toBe(
      observation.knownDeck.length
    );
  });

  it("keeps the pending multi-hot domain in sync with summary pending roles", () => {
    const summaryPendingFields = Object.entries(
      AI_OBSERVATION_PENDING_FIELD_ROLES
    )
      .filter(([, role]) => role === "summary")
      .map(([field]) => field)
      .sort();

    expect([...AI_OBSERVATION_ENCODER_PENDING_KIND_DOMAIN].sort()).toEqual(
      summaryPendingFields
    );
  });
});
