import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyLegalAction,
  buildAiObservation,
  createEmptyGameState,
  getLegalActions,
  initializeGame,
  materializeAiSearchDecksWithHandRefs,
  projectAiSearchCards,
  projectAiSearchDeckKnowledgeWithVisibility,
  sampleAiSearchDeck,
  type AiSearchCard,
  type AiSearchDeckKnowledgeWithVisibility,
  type CardDefinition,
  type GameState,
} from "../src";
import { replaceCardInstances } from "../src/zone/card-instance-state";

const definitions: CardDefinition[] = ["A", "B", "SECRET"].map((name) => ({
  cardNo: `HAND-REF-${name}`,
  name,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  maxDeckCount: 40,
}));
const deck = Array.from({ length: 40 }, (_, i) => definitions[i % 2]);
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const observe = (state: GameState, viewer: string) =>
  buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });
const fixture = () =>
  initializeGame({
    decks: [[...deck], [...deck]],
    preserveDeckOrder: true,
    skipPreGame: true,
  });

function project(state: GameState, viewer: string) {
  const observation = observe(state, viewer);
  const knowledge = projectAiSearchDeckKnowledgeWithVisibility(observation);
  const visible = projectAiSearchCards(observation);
  const samples = (["me", "opp"] as const).map((owner) =>
    sampleAiSearchDeck(
      knowledge,
      owner,
      [{ weight: 1, cardNos: deck.map((card) => card.cardNo) }],
      definitions,
      31415
    )
  );
  return { knowledge, visible, samples };
}

function materialize(input: ReturnType<typeof project>) {
  return materializeAiSearchDecksWithHandRefs(
    input.samples,
    input.knowledge,
    input.visible,
    definitions
  );
}

describe("I1 root hand references on sampled instances (partial world)", () => {
  it.each([0, 1])(
    "binds each visible copy once for root seat %s and applies the selected copy through real summon and placement",
    (seat) => {
      const source = fixture();
      const input = project(source, source.playerOrder[seat]);
      const before = structuredClone(input);
      const { cards, handBindings } = materialize(input);
      const hand = input.visible.filter((card) => card.zone === "hand");
      expect(handBindings).toHaveLength(hand.length);
      expect(
        new Set(handBindings.map((binding) => binding.instanceId)).size
      ).toBe(hand.length);
      for (const ref of hand) {
        const binding = handBindings.find(
          (value) => value.cardRef === ref.cardRef
        )!;
        expect(
          cards.find((card) => card.instanceId === binding.instanceId)
        ).toMatchObject({
          zone: "hand",
          definitionId: ref.cardNoOrUnknown,
          ownerPlayerId: AI_SEARCH_WORLD_PLAYERS[ref.owner],
        });
        expect(
          source.cardInstances.some(
            (card) => card.instanceId === binding.instanceId
          )
        ).toBe(false);
      }
      // Two equal printed cards must remain separately selectable. Exercise the
      // second observed copy, then check the first stays in hand after resolution.
      const copies = hand.filter(
        (card) => card.cardNoOrUnknown === hand[0].cardNoOrUnknown
      );
      expect(copies.length).toBeGreaterThan(1);
      const id = (ref: number) =>
        handBindings.find((value) => value.cardRef === ref)!.instanceId;
      const chosenId = id(copies[1].cardRef),
        untouchedId = id(copies[0].cardRef);
      const me = AI_SEARCH_WORLD_PLAYERS.me,
        opp = AI_SEARCH_WORLD_PLAYERS.opp;
      let world = replaceCardInstances(
        {
          ...createEmptyGameState({
            playerIds: [me, opp],
            startingDeckCount: 0,
            playerOverrides: [{ handCount: 0 }, { handCount: 0 }],
          }),
          zoneCountMode: undefined,
          step: "main",
          activePlayerId: me,
        },
        cards
      );
      const options = {
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      };
      const summon = getLegalActions({
        state: world,
        actingPlayerId: me,
        ...options,
      }).find(
        (action) =>
          action.kind === "summon" && action.sourceInstanceId === chosenId
      );
      expect(summon).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: summon!,
        paymentSources: [],
        ...options,
      }).state;
      const pass = getLegalActions({
        state: world,
        actingPlayerId: opp,
        ...options,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: pass!,
        ...options,
      }).state;
      const place = getLegalActions({
        state: world,
        actingPlayerId: me,
        ...options,
      }).find(
        (action) => action.kind === "resolve_pending_enter_field_placement"
      );
      expect(place).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: place!,
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        ...options,
      }).state;
      expect(
        world.cardInstances.find((card) => card.instanceId === chosenId)
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(
        world.cardInstances.find((card) => card.instanceId === untouchedId)
      ).toMatchObject({ zone: "hand", normalCoreCount: 0 });
      expect(world.pendingEnterFieldPlacement).toBeNull();
      expect(world.stackWindow).toBeNull();
      expect(world.players.find((player) => player.id === me)!.handCount).toBe(
        hand.length - 1
      );
      expect(input).toEqual(before);
    }
  );

  it("keeps bindings identical after secret changes, live ID renaming and projected-card order changes", () => {
    const source = fixture(),
      viewer = source.playerOrder[0];
    const changed = structuredClone(source);
    const rename = (id: string) => `different-${id}`;
    for (const card of changed.cardInstances) {
      card.instanceId = rename(card.instanceId);
      if (
        card.zone === "deck" ||
        (card.zone === "hand" && card.ownerPlayerId !== viewer)
      ) {
        card.definitionId = definitions[2].cardNo;
        card.originalDefinitionId = definitions[2].cardNo;
      }
      card.ownerPlayerId = rename(card.ownerPlayerId);
      card.controllerPlayerId = rename(card.controllerPlayerId);
    }
    changed.playerOrder = changed.playerOrder.map(rename);
    changed.activePlayerId = rename(changed.activePlayerId);
    for (const player of changed.players) player.id = rename(player.id);
    const original = project(source, viewer),
      other = project(changed, rename(viewer));
    expect(other).toEqual(original);
    expect(materialize(other)).toEqual(materialize(original));
    expect(
      materialize({ ...other, visible: [...other.visible].reverse() })
    ).toEqual(materialize(original));
    // Extra runtime/serialization fields are not consulted or copied.
    Object.defineProperty(other.visible[0], "instanceId", {
      get() {
        throw new Error("live ID read");
      },
    });
    Object.defineProperty(other.visible[0], "toJSON", {
      get() {
        throw new Error("serialization hook read");
      },
    });
    expect(materialize(other)).toEqual(materialize(original));
  });

  it("rejects missing, duplicate, hidden, historical or mismatched hand references and preserves inputs", () => {
    const source = fixture(),
      input = project(source, source.playerOrder[0]);
    const before = structuredClone(input);
    const reject = (change: (cards: AiSearchCard[]) => void) => {
      const visible = structuredClone(input.visible) as AiSearchCard[];
      change(visible);
      expect(() => materialize({ ...input, visible })).toThrow();
    };
    reject((cards) => cards.pop());
    reject((cards) => cards.push({ ...cards[0] }));
    reject((cards) => Object.assign(cards[0], { cardRef: -1 }));
    reject((cards) => Object.assign(cards[0], { cardRef: 0.5 }));
    reject((cards) =>
      Object.assign(cards[0], { cardNoOrUnknown: definitions[2].cardNo })
    );
    reject((cards) => Object.assign(cards[0], { owner: "opp" }));
    reject((cards) => Object.assign(cards[0], { owner: "live-player" }));
    reject((cards) =>
      Object.assign(cards[0], { identityVisibility: "unknown" })
    );
    reject((cards) =>
      Object.assign(cards[0], { identityVisibility: "public_memory" })
    );
    reject((cards) => Object.assign(cards[0], { zone: "deck" }));
    expect(input).toEqual(before);
    const result = materialize(input);
    result.cards[0].definitionId = "mutated";
    expect(input).toEqual(before);
    expect(materialize(input)).not.toEqual(result);
  });

  it("matches the exact known-hand multiset and does not fill unseen opponent hand bindings", () => {
    const source = fixture(),
      input = project(source, source.playerOrder[0]);
    const result = materialize(input);
    expect(
      result.cards.filter(
        (card) =>
          card.zone === "hand" &&
          card.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS.opp
      ).length
    ).toBeGreaterThan(0);
    expect(
      result.handBindings.every(
        (binding) =>
          result.cards.find((card) => card.instanceId === binding.instanceId)!
            .ownerPlayerId === AI_SEARCH_WORLD_PLAYERS.me
      )
    ).toBe(true);
    const invalid = structuredClone(
      input.knowledge
    ) as AiSearchDeckKnowledgeWithVisibility;
    Object.assign(invalid.players[0].knownHand[0], {
      count: input.knowledge.players[0].knownHand[0].count + 1,
    });
    expect(() => materialize({ ...input, knowledge: invalid })).toThrow(
      /inconsistent_observation/
    );
  });
});
