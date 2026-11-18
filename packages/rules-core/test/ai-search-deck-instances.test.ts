import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  initializeGame,
  materializeAiSearchDecks,
  projectAiSearchDeckKnowledge,
  sampleAiSearchDeck,
  type AiSearchSampledDeck,
  type CardDefinition,
} from "../src";
import {
  drawCardsToHand,
  replaceCardInstances,
} from "../src/zone/card-instance-state";

const definitions: CardDefinition[] = ["A", "B", "CREATED"].map((suffix) => ({
  cardNo: `DECK-INSTANCE-${suffix}`,
  name: suffix,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  maxDeckCount: suffix === "CREATED" ? 0 : 40,
}));
const [A, B, C] = definitions.map((definition) => definition.cardNo);
const sample = (owner: "me" | "opp"): AiSearchSampledDeck => ({
  owner,
  prior: "supplied_population",
  deckFromBottom: [A, B, A, B],
  hand: [B, A],
});
const input = () => [sample("me"), sample("opp")];

function world(samples = input()) {
  const cards = materializeAiSearchDecks(samples, definitions);
  const empty = createEmptyGameState({
    playerIds: [AI_SEARCH_WORLD_PLAYERS.me, AI_SEARCH_WORLD_PLAYERS.opp],
    startingDeckCount: 0,
    playerOverrides: [{ handCount: 0 }, { handCount: 0 }],
  });
  // Physical counts, not the abstract fixture's implicit cards.
  return replaceCardInstances({ ...empty, zoneCountMode: undefined }, cards);
}

describe("I1 sampled hand/deck instance component (not a full virtual world)", () => {
  it("takes only sampled components and public definitions, creates fresh synthetic instances", () => {
    expectTypeOf<
      Parameters<typeof materializeAiSearchDecks>[0]
    >().toEqualTypeOf<readonly AiSearchSampledDeck[]>();
    const samples = input();
    const before = structuredClone(samples);
    const cards = materializeAiSearchDecks(samples, definitions);
    expect(cards).toHaveLength(12);
    expect(new Set(cards.map((card) => card.instanceId)).size).toBe(12);
    expect(Object.isFrozen(AI_SEARCH_WORLD_PLAYERS)).toBe(true);
    for (const card of cards) {
      expect(card).toEqual(
        createCardInstance(
          definitions.find((d) => d.cardNo === card.definitionId)!,
          {
            instanceId: card.instanceId,
            ownerPlayerId: card.ownerPlayerId,
            zone: card.zone,
          }
        )
      );
      expect(card.instanceId).not.toContain(card.definitionId);
      expect(card.deckKnowledge).toBeUndefined();
    }
    cards[0].definitionId = C;
    cards[0].attachedChildrenIds.push("mutation");
    expect(samples).toEqual(before);
    expect(materializeAiSearchDecks(samples, definitions)).not.toEqual(cards);
    expect(cards[1].attachedChildrenIds).toEqual([]);
  });

  it.each(["top", "bottom"] as const)(
    "preserves bottom-index constraints through real %s draws and count synchronization",
    (position) => {
      const samples = input();
      const state = world(samples);
      const owner = AI_SEARCH_WORLD_PLAYERS.me;
      const deck = state.cardInstances.filter(
        (card) => card.ownerPlayerId === owner && card.zone === "deck"
      );
      expect(deck.map((card) => card.definitionId)).toEqual(
        [...samples[0].deckFromBottom].reverse()
      );
      for (let index = 0; index < deck.length; index++)
        expect(deck.at(-1 - index)!.definitionId).toBe(
          samples[0].deckFromBottom[index]
        );
      const result = drawCardsToHand(state, owner, 1, position);
      const drawn = result.state.cardInstances.find((card) =>
        result.drawnIds.has(card.instanceId)
      )!;
      expect(drawn.definitionId).toBe(position === "top" ? B : A);
      expect(drawn.zone).toBe("hand");
      expect(result.amount).toBe(1);
      expect(
        result.state.players.map((player) => [
          player.handCount,
          player.deckCount,
        ])
      ).toEqual([
        [3, 3],
        [2, 4],
      ]);
      expect(
        state.players.map((player) => [player.handCount, player.deckCount])
      ).toEqual([
        [2, 4],
        [2, 4],
      ]);
    }
  );

  it("connects real initial observations to constrained sampling and fresh instances independently of secrets", () => {
    const deck = Array.from({ length: 40 }, (_, i) => definitions[i % 2]);
    const state = initializeGame({
      decks: [[...deck], [...deck]],
      preserveDeckOrder: true,
      skipPreGame: true,
    });
    for (const player of state.players) {
      const deck = state.cardInstances.filter(
        (card) => card.ownerPlayerId === player.id && card.zone === "deck"
      );
      deck.at(-1)!.deckKnowledge = {
        audience: "actor_only",
        actorPlayerId: player.id,
      };
      deck.at(-2)!.deckKnowledge = {
        audience: "both",
        actorPlayerId: player.id,
      };
    }
    const changed = structuredClone(state);
    const viewer = state.players[0].id;
    for (const card of changed.cardInstances) {
      card.instanceId = `unrelated-live-${card.instanceId}`;
      if (
        card.ownerPlayerId !== viewer &&
        card.deckKnowledge?.audience !== "both"
      ) {
        card.definitionId = C;
        card.originalDefinitionId = C;
      }
    }
    const slots = changed.cardInstances.flatMap((card, index) =>
      card.ownerPlayerId === viewer &&
      card.zone === "deck" &&
      !card.deckKnowledge
        ? [index]
        : []
    );
    const reverse = slots
      .map((index) => changed.cardInstances[index])
      .reverse();
    slots.forEach((index, i) => {
      changed.cardInstances[index] = reverse[i];
    });
    const materialize = (source: typeof state) => {
      const observed = buildAiObservation({
        state: source,
        viewpointPlayerId: viewer,
        getCardDefinitionById: (id) => definitions.find((d) => d.cardNo === id),
      });
      const knowledge = projectAiSearchDeckKnowledge(observed);
      const samples = (["me", "opp"] as const).map((owner) =>
        sampleAiSearchDeck(
          knowledge,
          owner,
          [{ weight: 1, cardNos: deck.map((card) => card.cardNo) }],
          definitions,
          31415
        )
      );
      const instances = materializeAiSearchDecks(samples, definitions);
      for (const player of knowledge.players) {
        const deck = instances.filter(
          (card) =>
            card.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS[player.owner] &&
            card.zone === "deck"
        );
        for (const slot of player.knownDeck)
          expect(deck.at(-1 - slot.indexFromBottom)!.definitionId).toBe(
            slot.cardNo
          );
      }
      return instances;
    };
    const first = materialize(state),
      second = materialize(changed);
    expect(first).toEqual(second);
    expect(first).toHaveLength(80);
    expect(
      first.some((card) =>
        state.cardInstances.some((real) => real.instanceId === card.instanceId)
      )
    ).toBe(false);
    // Advancing the common factory's global counter cannot affect slot IDs.
    createCardInstance(definitions[0], { ownerPlayerId: "unrelated" });
    expect(materialize(state)).toEqual(first);
    expect(
      materializeAiSearchDecks(input().reverse(), [...definitions].reverse())
    ).toEqual(materializeAiSearchDecks(input(), definitions));
  });

  it("materializes effect-created populations without reapplying deck construction limits", () => {
    const samples = input();
    samples[0] = {
      ...samples[0],
      prior: "registered_with_observed_changes",
      hand: [C, C],
      deckFromBottom: [],
    };
    expect(
      materializeAiSearchDecks(samples, definitions).filter(
        (card) => card.definitionId === C
      )
    ).toHaveLength(2);
  });

  it("rejects missing/duplicate owners, malformed zones and unknown/duplicate public definitions", () => {
    expect(() => materializeAiSearchDecks([sample("me")], definitions)).toThrow(
      /input/
    );
    expect(() =>
      materializeAiSearchDecks([sample("me"), sample("me")], definitions)
    ).toThrow(/binding/);
    expect(() =>
      materializeAiSearchDecks(
        [{ ...sample("me"), owner: "secret" } as never, sample("opp")],
        definitions
      )
    ).toThrow(/binding/);
    expect(() =>
      materializeAiSearchDecks(
        [{ ...sample("me"), hand: null } as never, sample("opp")],
        definitions
      )
    ).toThrow(/zones/);
    expect(() =>
      materializeAiSearchDecks(
        [{ ...sample("me"), hand: ["missing"] }, sample("opp")],
        definitions
      )
    ).toThrow(/unknown public/);
    expect(() =>
      materializeAiSearchDecks(input(), [...definitions, definitions[0]])
    ).toThrow(/duplicate public/);
    expect(() =>
      materializeAiSearchDecks(
        [{ ...sample("me"), hand: new Array(1) }, sample("opp")],
        definitions
      )
    ).toThrow(/unknown public/);
  });
});
