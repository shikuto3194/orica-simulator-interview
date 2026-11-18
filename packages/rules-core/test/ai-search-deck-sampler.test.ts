import { describe, expect, expectTypeOf, it } from "vitest";
import {
  buildAiObservation,
  AiWorkTelemetry,
  clearKnownDeckCardsForPlayer,
  initializeGame,
  projectAiSearchDeckKnowledge,
  sampleAiSearchDeck,
  type AiObservation,
  type AiSearchDeckKnowledge,
  type CardDefinition,
  type GameState,
} from "../src";
import { validateMainDeckDefinitions } from "../src/card/card-filter";

const definitions: CardDefinition[] = ["A", "B", "C", "D"].map((suffix) => ({
  cardNo: `SEARCH-DECK-${suffix}`,
  name: `公開カード${suffix}`,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  keywordTags: [],
  textLines: [],
  maxDeckCount: 40,
}));
const [A, B, C, D] = definitions.map((definition) => definition.cardNo);
const lookup = (id: string) =>
  definitions.find((definition) => definition.cardNo === id);
const population = Array.from(
  { length: 40 },
  (_, index) => definitions[index % 3]
);
const hypothesis = [
  { weight: 1, cardNos: population.map((definition) => definition.cardNo) },
];

function fixture(): GameState {
  const state = initializeGame({
    decks: [[...population], [...population]],
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
    deck.at(-2)!.deckKnowledge = { audience: "both", actorPlayerId: player.id };
  }
  return state;
}

function observe(state = fixture(), viewer = state.players[0].id) {
  return buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });
}

function sorted(values: readonly string[]) {
  return [...values].sort();
}

describe("I1 observed deck constraints and hidden-zone allocation (partial sampler)", () => {
  it("receives only a player observation/constraint component, never GameState", () => {
    expectTypeOf<
      Parameters<typeof projectAiSearchDeckKnowledge>[0]
    >().toEqualTypeOf<AiObservation>();
    expectTypeOf<
      Parameters<typeof sampleAiSearchDeck>[0]
    >().toEqualTypeOf<AiSearchDeckKnowledge>();
    expect(() => projectAiSearchDeckKnowledge(fixture() as never)).toThrow(
      /player observation/
    );
    expect(() =>
      sampleAiSearchDeck(fixture() as never, "opp", hypothesis, definitions, 7)
    ).toThrow(/sampler input/);
    for (const mode of ["spectator_full", "debug_perfect"] as const)
      expect(() =>
        projectAiSearchDeckKnowledge({ ...observe(), mode })
      ).toThrow(/player observation/);
  });

  it("real initialized/sanitized states with different hidden identities, order and IDs give identical constraints and samples", () => {
    const first = fixture(),
      second = structuredClone(first);
    for (const card of second.cardInstances) {
      card.instanceId = `secret-renamed-${card.instanceId}`;
      if (card.ownerPlayerId === second.players[1].id && !card.deckKnowledge) {
        card.definitionId = D;
        card.originalDefinitionId = D;
      }
    }
    // Reorder unknown slots only: known bottom positions must remain the same.
    for (const player of second.players) {
      const indices = second.cardInstances.flatMap((card, index) =>
        card.ownerPlayerId === player.id &&
        card.zone === "deck" &&
        !card.deckKnowledge
          ? [index]
          : []
      );
      const reverse = indices
        .map((index) => second.cardInstances[index])
        .reverse();
      indices.forEach((index, i) => {
        second.cardInstances[index] = reverse[i];
      });
    }
    const one = projectAiSearchDeckKnowledge(observe(first));
    const two = projectAiSearchDeckKnowledge(observe(second));
    expect(two).toEqual(one);
    expect(
      second.cardInstances
        .filter((card) => card.ownerPlayerId === "bob" && card.zone === "hand")
        .every((card) => card.definitionId === D)
    ).toBe(true);
    for (const owner of ["me", "opp"] as const)
      for (const seed of [0, 1, 19, 0xffffffff])
        expect(
          sampleAiSearchDeck(two, owner, hypothesis, definitions, seed)
        ).toEqual(
          sampleAiSearchDeck(one, owner, hypothesis, definitions, seed)
        );
    const serialized = JSON.stringify({
      one,
      sample: sampleAiSearchDeck(one, "opp", hypothesis, definitions, 19),
    });
    for (const forbidden of [
      "instanceId",
      "card-",
      "alice",
      "bob",
      "secret-renamed",
      D,
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("keeps viewer-specific known slots, own complete hand and bottom-index semantics for every seed", () => {
    const state = fixture();
    for (const viewer of ["alice", "bob"]) {
      const knowledge = projectAiSearchDeckKnowledge(observe(state, viewer));
      expect(
        knowledge.players.map((player) => [
          player.owner,
          player.knownDeck.length,
        ])
      ).toEqual([
        ["me", 2],
        ["opp", 1],
      ]);
      expect(
        knowledge.players[0].knownHand.reduce(
          (sum, entry) => sum + entry.count,
          0
        )
      ).toBe(4);
      expect(knowledge.players[1].knownHand).toEqual([]);
      for (const owner of ["me", "opp"] as const) {
        const constraints = knowledge.players.find(
          (player) => player.owner === owner
        )!;
        for (let seed = 0; seed < 20; seed++) {
          const sample = sampleAiSearchDeck(
            knowledge,
            owner,
            hypothesis,
            definitions,
            seed
          );
          expect(sample.hand).toHaveLength(4);
          expect(sample.deckFromBottom).toHaveLength(36);
          expect(sorted([...sample.hand, ...sample.deckFromBottom])).toEqual(
            sorted(hypothesis[0].cardNos)
          );
          for (const known of constraints.knownDeck)
            expect(sample.deckFromBottom[known.indexFromBottom]).toBe(
              known.cardNo
            );
          if (owner === "me")
            expect(sorted(sample.hand)).toEqual(sorted([A, B, C, A]));
          expect(
            validateMainDeckDefinitions(
              [...sample.hand, ...sample.deckFromBottom].map(
                (id) => lookup(id)!
              )
            )
          ).toEqual([]);
        }
      }
    }
  });

  it("the real known-deck invalidation path removes slots without reconstructing them from hidden cards", () => {
    const state = fixture();
    const cleared = clearKnownDeckCardsForPlayer(state, "alice");
    const before = projectAiSearchDeckKnowledge(observe(state));
    const after = projectAiSearchDeckKnowledge(observe(cleared));
    expect(before.players[0].knownDeck).toHaveLength(2);
    expect(after.players[0].knownDeck).toEqual([]);
    expect(after.players[1]).toEqual(before.players[1]);
  });

  it("unknown opponent archetype uses only the public DB and preserves all constraints", () => {
    const knowledge = projectAiSearchDeckKnowledge(observe());
    const changed = structuredClone(knowledge);
    changed.players[1].knownDeck[0].cardNo = D;
    const sample = sampleAiSearchDeck(
      changed,
      "opp",
      hypothesis,
      definitions,
      9
    );
    expect(sample.prior).toBe("unknown_archetype");
    expect(
      sample.deckFromBottom[changed.players[1].knownDeck[0].indexFromBottom]
    ).toBe(D);
    expect(sample.hand.length + sample.deckFromBottom.length).toBe(40);
    expect(
      validateMainDeckDefinitions(
        [...sample.hand, ...sample.deckFromBottom].map((id) => lookup(id)!)
      )
    ).toEqual([]);
    expect(
      sampleAiSearchDeck(
        changed,
        "opp",
        hypothesis,
        [...definitions].reverse(),
        9
      )
    ).toEqual(sample);
    expect(sampleAiSearchDeck(changed, "opp", [], definitions, 9)).toEqual(
      sample
    );
    expect(() =>
      sampleAiSearchDeck(
        changed,
        "opp",
        hypothesis,
        definitions.filter((definition) => definition.cardNo !== D),
        9
      )
    ).toThrow(/unknown public hypothesis card|inconsistent_observation/);
    expect(() => sampleAiSearchDeck(changed, "me", [], definitions, 9)).toThrow(
      /own population/
    );
  });

  it("conditions and renormalizes supplied priors before sampling; candidate order inside a population is irrelevant", () => {
    const knowledge = projectAiSearchDeckKnowledge(observe());
    const other = hypothesis[0].cardNos.map((id) => (id === B ? D : id));
    for (const weight of [1, Number.MAX_VALUE]) {
      const priors = [
        { weight, cardNos: other },
        { weight, cardNos: [...hypothesis[0].cardNos].reverse() },
      ];
      // The public known slot contains C, so both populations are compatible.
      expect(
        sampleAiSearchDeck(knowledge, "opp", priors, definitions, 1)
      ).toEqual(
        sampleAiSearchDeck(
          knowledge,
          "opp",
          priors.map((prior) => ({
            ...prior,
            cardNos: [...prior.cardNos].reverse(),
          })),
          definitions,
          1
        )
      );
    }
    const incompatible = [
      {
        weight: Number.MAX_VALUE,
        cardNos: Array.from({ length: 40 }, () => D),
      },
      ...hypothesis,
    ];
    expect(
      sampleAiSearchDeck(knowledge, "opp", incompatible, definitions, 0).prior
    ).toBe("supplied_population");
    expect(
      sorted([
        ...sampleAiSearchDeck(knowledge, "opp", incompatible, definitions, 0)
          .hand,
        ...sampleAiSearchDeck(knowledge, "opp", incompatible, definitions, 0)
          .deckFromBottom,
      ])
    ).toEqual(sorted(hypothesis[0].cardNos));
  });

  it("rejects impossible knowledge, duplicate slots, unknown definitions and malformed priors without weakening constraints", () => {
    const knowledge = projectAiSearchDeckKnowledge(observe());
    const noCapacity = definitions.map((definition) => ({
      ...definition,
      maxDeckCount: 3,
    }));
    expect(() =>
      sampleAiSearchDeck(knowledge, "opp", [], noCapacity, 1)
    ).toThrow(/inconsistent_observation/);
    const ownConflict = structuredClone(knowledge);
    ownConflict.players[0].knownDeck[0].cardNo = D;
    expect(() =>
      sampleAiSearchDeck(ownConflict, "me", hypothesis, definitions, 1)
    ).toThrow(/own population/);
    for (const index of [-1, 36, 1.5]) {
      const invalid = structuredClone(knowledge);
      invalid.players[1].knownDeck[0].indexFromBottom = index;
      expect(() =>
        sampleAiSearchDeck(invalid, "opp", hypothesis, definitions, 1)
      ).toThrow(/known search deck slot/);
    }
    const duplicate = structuredClone(knowledge);
    duplicate.players[1].knownDeck = [
      ...duplicate.players[1].knownDeck,
      ...duplicate.players[1].knownDeck,
    ];
    expect(() =>
      sampleAiSearchDeck(duplicate, "opp", hypothesis, definitions, 1)
    ).toThrow(/duplicate/);
    for (const weight of [0, -1, NaN, Infinity])
      expect(() =>
        sampleAiSearchDeck(
          knowledge,
          "opp",
          [{ ...hypothesis[0], weight }],
          definitions,
          1
        )
      ).toThrow(/prior/);
    expect(() =>
      sampleAiSearchDeck(
        knowledge,
        "opp",
        [{ weight: 1, cardNos: ["unknown"] }],
        definitions,
        1
      )
    ).toThrow(/unknown public hypothesis/);
    expect(() =>
      sampleAiSearchDeck(
        knowledge,
        "opp",
        hypothesis,
        [...definitions, definitions[0]],
        1
      )
    ).toThrow(/duplicate public card/);
    expect(() =>
      sampleAiSearchDeck(knowledge, "opp", hypothesis, noCapacity, 1)
    ).toThrow(/invalid main-deck hypothesis/);
    for (const seed of [-1, 0x100000000, 1.5, NaN])
      expect(() =>
        sampleAiSearchDeck(knowledge, "opp", hypothesis, definitions, seed)
      ).toThrow(/sampler input/);
  });

  it("uses normal main-deck eligibility and contract restrictions, including unknown-prior generation", () => {
    const knowledge = projectAiSearchDeckKnowledge(observe());
    for (const badDefinition of [
      { ...definitions[0], maxTokenDeckCount: 40 },
      { ...definitions[0], maxDeckCount: 0 },
    ])
      expect(() =>
        sampleAiSearchDeck(
          knowledge,
          "me",
          hypothesis,
          [badDefinition, ...definitions.slice(1)],
          1
        )
      ).toThrow(/invalid main-deck hypothesis/);
    const contractDefinitions = definitions.map((definition) => ({
      ...definition,
      keywordTags: ["contract"],
    }));
    expect(() =>
      sampleAiSearchDeck(knowledge, "opp", hypothesis, contractDefinitions, 1)
    ).toThrow(/invalid main-deck hypothesis/);
    const noKnowledge: AiSearchDeckKnowledge = {
      schemaVersion: 1,
      kind: "observed-hand-deck-constraints",
      players: [
        {
          owner: "me",
          handCount: 0,
          deckCount: 0,
          knownHand: [],
          knownDeck: [],
        },
        {
          owner: "opp",
          handCount: 4,
          deckCount: 36,
          knownHand: [],
          knownDeck: [],
        },
      ],
    };
    const sample = sampleAiSearchDeck(
      noKnowledge,
      "opp",
      [],
      contractDefinitions,
      1
    );
    expect(new Set([...sample.hand, ...sample.deckFromBottom]).size).toBe(1);
    expect(
      validateMainDeckDefinitions(
        [...sample.hand, ...sample.deckFromBottom].map(
          (id) =>
            contractDefinitions.find((definition) => definition.cardNo === id)!
        )
      )
    ).toEqual([]);
  });

  it("projects fresh named values, rejects accessors, and rechecks private-slot audience", () => {
    const observation = observe();
    const expected = projectAiSearchDeckKnowledge(observation);
    const hostile = structuredClone(observation);
    hostile.knownDeck = [
      ...hostile.knownDeck,
      {
        playerId: "bob",
        actorPlayerId: "bob",
        audience: "actor_only",
        indexFromBottom: 999,
        definitionIdSnapshot: "private-secret",
      },
    ];
    Object.assign(hostile, {
      rawState: fixture(),
      toJSON() {
        throw new Error("not called");
      },
    });
    expect(projectAiSearchDeckKnowledge(hostile)).toEqual(expected);
    for (const [key, value] of [
      ["indexFromBottom", -1],
      ["definitionIdSnapshot", "UNK_CARD"],
      ["audience", "invalid"],
    ] as const) {
      const invalid = structuredClone(observation);
      Object.assign(invalid.knownDeck[0], { [key]: value });
      expect(() => projectAiSearchDeckKnowledge(invalid)).toThrow(/invalid/);
    }
    const accessor = structuredClone(observation);
    Object.defineProperty(accessor.knownDeck[0], "definitionIdSnapshot", {
      get() {
        throw new Error("secret getter invoked");
      },
    });
    expect(() => projectAiSearchDeckKnowledge(accessor)).toThrow(
      /data property/
    );
    observation.knownDeck[0].definitionIdSnapshot = D;
    observation.cards[0].cardNoOrUnknown = D;
    expect(expected).toEqual(projectAiSearchDeckKnowledge(observe()));
    const invalidHand = observe();
    invalidHand.players[0].handCount++;
    expect(() => projectAiSearchDeckKnowledge(invalidHand)).toThrow(
      /hand count/
    );
  });

  it("does not mutate any constraint, hypothesis, public definition or observed array", () => {
    const observation = observe();
    const knowledge = projectAiSearchDeckKnowledge(observation);
    const before = JSON.stringify({
      observation,
      knowledge,
      hypothesis,
      definitions,
    });
    const sample = sampleAiSearchDeck(
      knowledge,
      "me",
      hypothesis,
      definitions,
      3
    );
    (sample.hand as string[])[0] = D;
    (sample.deckFromBottom as string[])[0] = D;
    expect(
      JSON.stringify({ observation, knowledge, hypothesis, definitions })
    ).toBe(before);
  });

  it("allocates a partial current population without claiming full registered-deck validation", () => {
    const knowledge = structuredClone(projectAiSearchDeckKnowledge(observe()));
    for (const player of knowledge.players) player.deckCount = 16;
    const current = [
      { weight: 1, cardNos: hypothesis[0].cardNos.slice(0, 20) },
    ];
    const me = sampleAiSearchDeck(knowledge, "me", current, definitions, 3);
    expect(me.hand).toHaveLength(4);
    expect(me.deckFromBottom).toHaveLength(16);
    expect(sorted([...me.hand, ...me.deckFromBottom])).toEqual(
      sorted(current[0].cardNos)
    );
    expect(
      sampleAiSearchDeck(
        knowledge,
        "me",
        [{ weight: 1, cardNos: [...current[0].cardNos].reverse() }],
        definitions,
        3
      )
    ).toEqual(me);
    // A full starting list cannot substitute for the current population.
    expect(() =>
      sampleAiSearchDeck(knowledge, "me", hypothesis, definitions, 3)
    ).toThrow(/own population/);
  });

  it("measures bounded allocation and failures in the common telemetry without claiming simulations or games", () => {
    const telemetry = new AiWorkTelemetry();
    const knowledge = projectAiSearchDeckKnowledge(observe());
    expect(
      sampleAiSearchDeck(knowledge, "me", hypothesis, definitions, 9, telemetry)
    ).toEqual(sampleAiSearchDeck(knowledge, "me", hypothesis, definitions, 9));
    expect(
      sampleAiSearchDeck(knowledge, "opp", [], definitions, 9, telemetry).prior
    ).toBe("unknown_archetype");
    expect(() =>
      sampleAiSearchDeck(knowledge, "me", [], definitions, 9, telemetry)
    ).toThrow(/own population/);
    const snapshot = telemetry.snapshot();
    const measurement = snapshot.measurements.find(
      (value) => value.operation === "hidden_zone_sampling"
    )!;
    expect(measurement).toMatchObject({
      unit: "population",
      observed: true,
      attempted: 3,
      returned: 2,
      threw: 1,
    });
    expect(measurement.inclusiveMs).toBeGreaterThan(0);
    expect(
      snapshot.measurements.find((value) => value.operation === "game")!
        .observed
    ).toBe(false);
    expect(
      snapshot.measurements.find((value) => value.operation === "simulation")!
        .observed
    ).toBe(false);
    for (const forbidden of ["alice", "bob", "SEARCH-DECK", "instanceId"])
      expect(JSON.stringify(snapshot)).not.toContain(forbidden);
    console.log("AI_DECK_SAMPLER_BOUNDED_FIXTURE " + JSON.stringify(snapshot));
  });
});
