import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  buildAiObservation,
  clearKnownDeckCardsForPlayer,
  createEmptyGameState,
  initializeGame,
  materializeAiSearchDecksWithKnowledge,
  projectAiSearchDeckKnowledgeWithVisibility,
  sampleAiSearchDeck,
  type AiSearchDeckKnowledgeWithVisibility,
  type CardDefinition,
  type GameState,
} from "../src";
import { disclosureAudienceCanView } from "../src/public-disclosure";
import {
  drawCardsToHand,
  replaceCardInstances,
} from "../src/zone/card-instance-state";

const definitions: CardDefinition[] = ["A", "B", "SECRET-ALTERNATIVE"].map(
  (name) => ({
    cardNo: `KNOWN-WORLD-${name}`,
    name,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    maxDeckCount: 40,
  })
);
const deck = Array.from({ length: 40 }, (_, index) => definitions[index % 2]);
const lookup = (id: string) =>
  definitions.find((definition) => definition.cardNo === id);
const observe = (state: GameState, viewer: string) =>
  buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });

function fixture() {
  const state = initializeGame({
    decks: [[...deck], [...deck]],
    preserveDeckOrder: true,
    skipPreGame: true,
  });
  for (const player of state.players) {
    const cards = state.cardInstances.filter(
      (card) => card.zone === "deck" && card.ownerPlayerId === player.id
    );
    let index = 0;
    for (const audience of ["both", "actor_only", "opponent_only"] as const)
      for (const actor of state.playerOrder)
        cards.at(-1 - index++)!.deckKnowledge = {
          audience,
          actorPlayerId: actor,
        };
  }
  return state;
}

function materialize(state: GameState, viewer: string) {
  const knowledge = projectAiSearchDeckKnowledgeWithVisibility(
    observe(state, viewer)
  );
  const samples = (["me", "opp"] as const).map((owner) =>
    sampleAiSearchDeck(
      knowledge,
      owner,
      [{ weight: 1, cardNos: deck.map((card) => card.cardNo) }],
      definitions,
      31415
    )
  );
  const cards = materializeAiSearchDecksWithKnowledge(
    samples,
    knowledge,
    definitions
  );
  const empty = createEmptyGameState({
    playerIds: [AI_SEARCH_WORLD_PLAYERS.me, AI_SEARCH_WORLD_PLAYERS.opp],
    startingDeckCount: 0,
    playerOverrides: [{ handCount: 0 }, { handCount: 0 }],
  });
  return {
    knowledge,
    samples,
    cards,
    world: replaceCardInstances({ ...empty, zoneCountMode: undefined }, cards),
  };
}

describe("I1 observed known-deck audience on sampled instances (partial world)", () => {
  it.each([0, 1])(
    "reprojects observed slots for either root seat %s without disclosing private positions",
    (seat) => {
      const source = fixture(),
        viewer = source.playerOrder[seat];
      const { knowledge, cards, world } = materialize(source, viewer);
      expect(
        knowledge.players.map((player) => player.knownDeck.length)
      ).toEqual([4, 4]);
      expect(
        projectAiSearchDeckKnowledgeWithVisibility(
          observe(world, AI_SEARCH_WORLD_PLAYERS.me)
        )
      ).toEqual(knowledge);
      for (const player of knowledge.players) {
        const syntheticDeck = cards.filter(
          (card) =>
            card.zone === "deck" &&
            card.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS[player.owner]
        );
        expect(syntheticDeck.filter((card) => card.deckKnowledge)).toHaveLength(
          4
        );
        for (const slot of player.knownDeck)
          expect(
            syntheticDeck.at(-1 - slot.indexFromBottom)!.deckKnowledge
          ).toEqual({
            audience: slot.audience,
            actorPlayerId: AI_SEARCH_WORLD_PLAYERS[slot.actor],
          });
      }
      const other = projectAiSearchDeckKnowledgeWithVisibility(
        observe(world, AI_SEARCH_WORLD_PLAYERS.opp)
      );
      for (const player of other.players) {
        // Only the shared subset is known to BOTH observers. Opponent-private
        // slots absent from the root observation are intentionally not invented.
        const original = knowledge.players.find(
          (value) => value.owner !== player.owner
        )!;
        expect(player.knownDeck).toEqual(
          original.knownDeck
            .filter((slot) => slot.audience === "both")
            .map((slot) => ({
              ...slot,
              actor: slot.actor === "me" ? "opp" : "me",
            }))
        );
        expect(player.knownDeck).toHaveLength(2);
      }
      expect(
        cards.some((card) =>
          source.cardInstances.some(
            (real) => real.instanceId === card.instanceId
          )
        )
      ).toBe(false);
    }
  );

  it("does not depend on hidden identities/order, live player IDs or instance IDs at the same seed", () => {
    const source = fixture(),
      viewer = source.playerOrder[0];
    const changed = structuredClone(source);
    for (const card of changed.cardInstances) {
      card.instanceId = `renamed-${card.instanceId}`;
      if (
        card.ownerPlayerId !== viewer &&
        (card.zone === "hand" ||
          (card.zone === "deck" &&
            (!card.deckKnowledge ||
              !disclosureAudienceCanView(
                card.deckKnowledge.audience,
                card.deckKnowledge.actorPlayerId,
                viewer
              ))))
      ) {
        card.definitionId = definitions[2].cardNo;
        card.originalDefinitionId = definitions[2].cardNo;
      }
    }
    const unknown = changed.cardInstances.flatMap((card, index) =>
      card.ownerPlayerId === viewer &&
      card.zone === "deck" &&
      !card.deckKnowledge
        ? [index]
        : []
    );
    const reversed = unknown
      .map((index) => changed.cardInstances[index])
      .reverse();
    unknown.forEach((index, i) => {
      changed.cardInstances[index] = reversed[i];
    });
    const first = materialize(source, viewer);
    expect(materialize(changed, viewer).cards).toEqual(first.cards);
    const rename = (id: string) => `different-${id}`;
    changed.playerOrder = changed.playerOrder.map(rename);
    changed.activePlayerId = rename(changed.activePlayerId);
    for (const player of changed.players) player.id = rename(player.id);
    for (const card of changed.cardInstances) {
      card.ownerPlayerId = rename(card.ownerPlayerId);
      card.controllerPlayerId = rename(card.controllerPlayerId);
      if (card.deckKnowledge)
        card.deckKnowledge.actorPlayerId = rename(
          card.deckKnowledge.actorPlayerId
        );
    }
    expect(materialize(changed, rename(viewer)).cards).toEqual(first.cards);
  });

  it("expires sampled known slots through the existing knowledge reset and real top/bottom draws", () => {
    const source = fixture();
    const { world, knowledge } = materialize(source, source.playerOrder[0]);
    // Resolve from the actual world binding, never from a live instance ID.
    const owner = AI_SEARCH_WORLD_PLAYERS.me;
    const cleared = clearKnownDeckCardsForPlayer(world, owner);
    expect(
      projectAiSearchDeckKnowledgeWithVisibility(
        observe(cleared, owner)
      ).players.find((player) => player.owner === "me")!.knownDeck
    ).toEqual([]);
    for (const position of ["top", "bottom"] as const) {
      const drawn = drawCardsToHand(world, owner, 1, position);
      expect(drawn.amount).toBe(1);
      const next = projectAiSearchDeckKnowledgeWithVisibility(
        observe(drawn.state, owner)
      ).players.find((player) => player.owner === "me")!;
      const prior = knowledge.players.find((player) => player.owner === "me")!;
      expect(next.deckCount).toBe(prior.deckCount - 1);
      expect(next.handCount).toBe(prior.handCount + 1);
      expect(next.knownDeck).toEqual(
        prior.knownDeck
          .filter((slot) =>
            position === "top"
              ? slot.indexFromBottom < prior.deckCount - 1
              : slot.indexFromBottom > 0
          )
          .map((slot) => ({
            ...slot,
            indexFromBottom:
              slot.indexFromBottom - (position === "bottom" ? 1 : 0),
          }))
      );
    }
  });

  it("rejects inconsistent counts, hands, slots, audiences and bindings without mutating trusted inputs", () => {
    const source = fixture();
    const { samples, knowledge } = materialize(source, source.playerOrder[0]);
    const before = structuredClone({ samples, knowledge });
    const reject = (
      change: (value: AiSearchDeckKnowledgeWithVisibility) => void
    ) => {
      const invalid = structuredClone(knowledge);
      change(invalid);
      expect(() =>
        materializeAiSearchDecksWithKnowledge(samples, invalid, definitions)
      ).toThrow();
    };
    // Trusted components are readonly to callers; deliberately corrupt copies.
    reject((value) => {
      (value.players[0] as { deckCount: number }).deckCount++;
    });
    reject((value) => {
      (value.players[0].knownHand[0] as { count: number }).count++;
    });
    reject((value) => {
      (value.players[0].knownDeck[0] as { cardNo: string }).cardNo =
        definitions[2].cardNo;
    });
    reject((value) => {
      (
        value.players[0].knownDeck[0] as { indexFromBottom: number }
      ).indexFromBottom = -1;
    });
    reject((value) => {
      (value.players[0].knownDeck as unknown[]).push(
        value.players[0].knownDeck[0]
      );
    });
    reject((value) => {
      Object.assign(value.players[0].knownDeck[0], {
        audience: "actor_only",
        actor: "opp",
      });
    });
    reject((value) => {
      Object.assign(value.players[0].knownDeck[0], {
        audience: "opponent_only",
        actor: "me",
      });
    });
    reject((value) => {
      Object.assign(value.players[0].knownDeck[0], { audience: "invalid" });
    });
    reject((value) => {
      Object.assign(value.players[0].knownDeck[0], { actor: "live-player" });
    });
    reject((value) => {
      Object.assign(value.players[0], { owner: "opp" });
    });
    expect({ samples, knowledge }).toEqual(before);
    const cards = materializeAiSearchDecksWithKnowledge(
      samples,
      knowledge,
      definitions
    );
    cards.find((card) => card.deckKnowledge)!.deckKnowledge!.actorPlayerId =
      "mutated";
    expect({ samples, knowledge }).toEqual(before);
    expect(
      materializeAiSearchDecksWithKnowledge(samples, knowledge, definitions)
    ).not.toEqual(cards);
  });
});
