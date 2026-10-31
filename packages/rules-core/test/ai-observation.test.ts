import { describe, expect, it } from "vitest";
import {
  AI_UNKNOWN_CARD,
  buildAiObservation,
  buildStaticCardFeatures,
  createCardInstance,
  createEmptyGameState,
  getCombinedUnitBp,
  getCombinedUnitSymbolBundles,
  getEffectiveSymbolBundles,
  sanitizeStateForViewer,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const HOST: CardDefinition = {
  cardNo: "AI-OBS-HOST",
  name: "AI観測ホスト",
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
  tribe: "観測",
};

const BRAVE: CardDefinition = {
  ...HOST,
  cardNo: "AI-OBS-BRAVE",
  name: "AI観測ブレイヴ",
  printedCategory: "brave",
  colors: ["white"],
  cost: 2,
  reductionSymbols: ["white"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["white"],
  combinedBoost: 2000,
};

const ALICE_HAND: CardDefinition = {
  ...HOST,
  cardNo: "AI-OBS-ALICE-HAND",
  name: "AI観測アリス手札",
  cost: 1,
};

const BOB_HAND: CardDefinition = {
  ...HOST,
  cardNo: "AI-OBS-BOB-HAND",
  name: "AI観測ボブ手札",
  colors: ["purple"],
  symbolColors: ["purple"],
};

const BOB_BURST: CardDefinition = {
  ...HOST,
  cardNo: "AI-OBS-BOB-BURST",
  name: "AI観測ボブバースト",
  colors: ["yellow"],
  symbolColors: ["yellow"],
};

const DECK_KNOWN: CardDefinition = {
  ...HOST,
  cardNo: "AI-OBS-KNOWN-DECK",
  name: "AI観測既知デッキ",
};

const defs = [HOST, BRAVE, ALICE_HAND, BOB_HAND, BOB_BURST, DECK_KNOWN];
const getDef = (id: string): CardDefinition | undefined =>
  defs.find((def) => def.cardNo === id);

function makeObservationState(): GameState {
  const host = createCardInstance(HOST, {
    instanceId: "host",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 3,
    attachedChildrenIds: ["brave"],
  });
  const brave = createCardInstance(BRAVE, {
    instanceId: "brave",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
    attachedToInstanceId: "host",
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
  const knownDeck = createCardInstance(DECK_KNOWN, {
    instanceId: "known-deck-top",
    ownerPlayerId: ALICE,
    zone: "deck",
  });
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, brave, aliceHand, bobHand, bobBurst, knownDeck],
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
        definitionIdSnapshot: DECK_KNOWN.cardNo,
        audience: "actor_only",
        actorPlayerId: ALICE,
      },
      {
        playerId: ALICE,
        indexFromBottom: 0,
        definitionIdSnapshot: BOB_HAND.cardNo,
        audience: "opponent_only",
        actorPlayerId: ALICE,
      },
    ],
  };
}

describe("AiObservation", () => {
  it("player mode は自分の手札を出し、相手の手札/未公開バースト identity を漏らさない", () => {
    const state = makeObservationState();
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: ALICE,
      mode: "player",
      getCardDefinitionById: getDef,
    });

    expect(
      observation.cards.find((card) => card.instanceId === "alice-hand")
        ?.cardNoOrUnknown
    ).toBe(ALICE_HAND.cardNo);
    expect(
      observation.cards.some((card) => card.instanceId === "bob-hand")
    ).toBe(false);
    expect(
      observation.players.find((player) => player.playerId === BOB)?.handCount
    ).toBe(1);

    const hiddenBurst = observation.cards.find(
      (card) => card.instanceId === "bob-burst"
    );
    expect(hiddenBurst).toMatchObject({
      identityVisibility: "unknown",
      cardNoOrUnknown: AI_UNKNOWN_CARD,
      effectiveSymbols: [],
    });

    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain(BOB_HAND.cardNo);
    expect(serialized).not.toContain(BOB_BURST.cardNo);
  });

  it("field token は GUI と同じ実効/合体シンボル・BP SSOT に一致する", () => {
    const state = makeObservationState();
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: ALICE,
      mode: "player",
      getCardDefinitionById: getDef,
    });
    const host = state.cardInstances.find((card) => card.instanceId === "host");
    expect(host).toBeDefined();
    const hostToken = observation.cards.find(
      (card) => card.instanceId === "host"
    );
    expect(hostToken).toBeDefined();

    expect(hostToken?.effectiveSymbolBundles).toEqual(
      getEffectiveSymbolBundles(state, host!, HOST, getDef)
    );
    expect(hostToken?.combinedUnitSymbolBundles).toEqual(
      getCombinedUnitSymbolBundles(state, host!, HOST, getDef)
    );
    expect(hostToken?.combinedUnitBp).toBe(
      getCombinedUnitBp(state, host!, HOST, getDef)
    );
  });

  it("knownDeckCards は sanitizeStateForViewer と同じ audience 境界で出る", () => {
    const state = makeObservationState();
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: ALICE,
      mode: "player",
      getCardDefinitionById: getDef,
    });

    expect(observation.knownDeck).toEqual([
      {
        playerId: ALICE,
        owner: "me",
        indexFromBottom: 0,
        definitionIdSnapshot: DECK_KNOWN.cardNo,
        audience: "actor_only",
        actorPlayerId: ALICE,
      },
    ]);
    expect(observation.knownDeck).toEqual(
      sanitizeStateForViewer(state, ALICE).knownDeckCards?.map((entry) => ({
        ...entry,
        owner: "me",
      }))
    );
    expect(
      observation.players.find((player) => player.playerId === ALICE)
        ?.ownDeckCardNoCounts
    ).toEqual({ [DECK_KNOWN.cardNo]: 1 });
    expect(
      observation.players.find((player) => player.playerId === BOB)
        ?.ownDeckCardNoCounts
    ).toBeUndefined();
  });

  it("spectator_full はデッキ順と裏向き identity をデバッグ用に開示する", () => {
    const state = makeObservationState();
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: ALICE,
      mode: "spectator_full",
      getCardDefinitionById: getDef,
    });

    expect(
      observation.cards.find((card) => card.instanceId === "bob-burst")
        ?.cardNoOrUnknown
    ).toBe(BOB_BURST.cardNo);
    expect(
      observation.cards.find((card) => card.instanceId === "known-deck-top")
    ).toMatchObject({
      cardNoOrUnknown: DECK_KNOWN.cardNo,
      deckIndexFromTop: 0,
      deckIndexFromBottom: 0,
    });
  });
});

describe("buildStaticCardFeatures", () => {
  it("カードDB feature は identity embedding と併用する明示特徴を返す", () => {
    const features = buildStaticCardFeatures({
      ...BRAVE,
      effects: [
        {
          timing: { type: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "draw",
                count: 1,
              },
            },
          ],
        },
      ],
    } as CardDefinition);

    expect(features).toMatchObject({
      cardNo: BRAVE.cardNo,
      category: "brave",
      cost: 2,
      printedSymbols: ["white"],
      reductionSymbols: ["white"],
    });
    expect(features.mechanicTags).toContain("brave");
    expect(features.effectActionKinds).toEqual(["draw"]);
  });
});
