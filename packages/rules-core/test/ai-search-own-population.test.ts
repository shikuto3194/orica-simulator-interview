import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AiWorkTelemetry,
  buildAiObservation,
  initializeGame,
  moveCardZone,
  projectAiSearchDeckKnowledge,
  reconstructAiSearchOwnPopulation,
  sampleAiSearchDeck,
  sampleAiSearchOwnRegisteredDeck,
  type AiSearchDeckKnowledge,
  type AiSearchCardCount,
  type AiSearchOwnPopulationChanges,
  type CardDefinition,
} from "../src";

const definitions: CardDefinition[] = ["A", "B", "CREATED"].map((suffix) => ({
  cardNo: `OWN-POPULATION-${suffix}`,
  name: suffix,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  maxDeckCount: suffix === "CREATED" ? 0 : 20,
}));
const [A, B, C] = definitions.map((definition) => definition.cardNo);
const registered = Array.from({ length: 40 }, (_, i) => (i % 2 ? B : A));
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const history = (
  events: AiSearchOwnPopulationChanges["events"] = []
): AiSearchOwnPopulationChanges => ({
  schemaVersion: 1,
  kind: "viewer-known-own-population-changes",
  events,
});
const event = (
  eventId: number,
  removed: { cardNo: string; count: number }[],
  added: { cardNo: string; count: number }[]
) => ({ eventId, removed, added });
function fixture() {
  return initializeGame({
    decks: [
      registered.map((id) => lookup(id)!),
      registered.map((id) => lookup(id)!),
    ],
    preserveDeckOrder: true,
    skipPreGame: true,
  });
}
function observation(state = fixture()) {
  return buildAiObservation({
    state,
    viewpointPlayerId: state.players[0].id,
    getCardDefinitionById: lookup,
  });
}
const counts = (values: readonly string[]) =>
  [A, B, C].map((id) => values.filter((value) => value === id).length);
const expand = (values: readonly AiSearchCardCount[]) =>
  values.flatMap(({ cardNo, count }) =>
    Array.from({ length: count }, () => cardNo)
  );

describe("I1 registered own list plus viewer-known population changes (composition seam)", () => {
  it("composes registration, visible hand departure/return and the existing constrained sampler", () => {
    let state = fixture();
    const visible = observation(state).cards.find(
      (card) => card.owner === "me" && card.zone === "hand"
    )!;
    // The test supplies the future producer's delta from the visible identity.
    // No production history completeness or automatic extraction is claimed.
    const changes = history([
      event(0, [{ cardNo: visible.cardNoOrUnknown, count: 1 }], []),
    ]);
    state = moveCardZone(state, visible.instanceId!, "trash");
    const knowledge = projectAiSearchDeckKnowledge(observation(state));
    for (const seed of [0, 1, 99, 0xffffffff]) {
      const sample = sampleAiSearchOwnRegisteredDeck(
        knowledge,
        registered,
        changes,
        definitions,
        seed
      );
      expect(sample.prior).toBe("registered_with_observed_changes");
      expect(sample.owner).toBe("me");
      expect(sample.hand).toHaveLength(3);
      expect(sample.deckFromBottom).toHaveLength(36);
      expect([...sample.hand, ...sample.deckFromBottom].sort()).toEqual(
        expand(
          reconstructAiSearchOwnPopulation(registered, changes, definitions)
        ).sort()
      );
      // The original full list no longer substitutes for current contents.
      expect(() =>
        sampleAiSearchDeck(
          knowledge,
          "me",
          [{ weight: 1, cardNos: registered }],
          definitions,
          seed
        )
      ).toThrow(/own population/);
    }
    state = moveCardZone(state, visible.instanceId!, "deck");
    const returned = history([
      ...changes.events,
      event(1, [], [{ cardNo: visible.cardNoOrUnknown, count: 1 }]),
    ]);
    const sample = sampleAiSearchOwnRegisteredDeck(
      projectAiSearchDeckKnowledge(observation(state)),
      registered,
      returned,
      definitions,
      99
    );
    expect(sample.hand).toHaveLength(3);
    expect(sample.deckFromBottom).toHaveLength(37);
    expect(counts([...sample.hand, ...sample.deckFromBottom])).toEqual([
      20, 20, 0,
    ]);
  });

  it("is invariant to real opponent secrets, all live IDs and unknown own deck order", () => {
    const first = fixture(),
      second = structuredClone(first);
    for (const card of second.cardInstances) {
      card.instanceId = `renamed-secret-${card.instanceId}`;
      if (card.ownerPlayerId === second.players[1].id) {
        card.definitionId = C;
        card.originalDefinitionId = C;
      }
    }
    const deckSlots = second.cardInstances.flatMap((card, index) =>
      card.ownerPlayerId === second.players[0].id && card.zone === "deck"
        ? [index]
        : []
    );
    const reversed = deckSlots
      .map((index) => second.cardInstances[index])
      .reverse();
    deckSlots.forEach((index, i) => {
      second.cardInstances[index] = reversed[i];
    });
    const one = projectAiSearchDeckKnowledge(observation(first));
    const two = projectAiSearchDeckKnowledge(observation(second));
    expect(two).toEqual(one);
    expectTypeOf<
      Parameters<typeof sampleAiSearchOwnRegisteredDeck>[0]
    >().toEqualTypeOf<AiSearchDeckKnowledge>();
    for (const seed of [0, 1, 99])
      expect(
        sampleAiSearchOwnRegisteredDeck(
          two,
          registered,
          history(),
          definitions,
          seed
        )
      ).toEqual(
        sampleAiSearchOwnRegisteredDeck(
          one,
          registered,
          history(),
          definitions,
          seed
        )
      );
    expect(
      JSON.stringify(
        sampleAiSearchOwnRegisteredDeck(
          two,
          registered,
          history(),
          definitions,
          99
        )
      )
    ).not.toMatch(/renamed-secret|instanceId|alice|bob|CREATED/);
    expect(() =>
      sampleAiSearchOwnRegisteredDeck(
        first as never,
        registered,
        history(),
        definitions,
        99
      )
    ).toThrow(/sampler input/);
  });

  it("applies atomic generation, identity replacement and removal without construction caps on current cards", () => {
    const changes = history([
      event(
        0,
        [],
        [
          { cardNo: A, count: 2 },
          { cardNo: C, count: 1 },
        ]
      ),
      event(1, [{ cardNo: B, count: 1 }], [{ cardNo: C, count: 1 }]),
      event(2, [{ cardNo: C, count: 1 }], []),
    ]);
    const current = expand(
      reconstructAiSearchOwnPopulation(registered, changes, definitions)
    );
    expect(counts(current)).toEqual([22, 19, 1]);
    const knowledge = structuredClone(
      projectAiSearchDeckKnowledge(observation())
    );
    knowledge.players[0].deckCount += 2;
    const sample = sampleAiSearchOwnRegisteredDeck(
      knowledge,
      registered,
      changes,
      definitions,
      5
    );
    expect(counts([...sample.hand, ...sample.deckFromBottom])).toEqual([
      22, 19, 1,
    ]);
    expect(sample.deckFromBottom).toContain(C);
    // The generic arbitrary-prior path retains its existing validation contract.
    expect(() =>
      sampleAiSearchDeck(
        knowledge,
        "me",
        [{ weight: 1, cardNos: current }],
        definitions,
        5
      )
    ).toThrow(/invalid main-deck/);
    expect(() =>
      reconstructAiSearchOwnPopulation(
        [...registered, C],
        history(),
        definitions
      )
    ).toThrow(/registered main deck/);
    expect(() =>
      reconstructAiSearchOwnPopulation(
        [...registered, A],
        history(),
        definitions
      )
    ).toThrow(/registered main deck/);
  });

  it("never replaces incompatible own counts, known hand or known deck slots with an unknown prior", () => {
    for (const mutate of [
      (k: AiSearchDeckKnowledge) => {
        k.players[0].deckCount--;
      },
      (k: AiSearchDeckKnowledge) => {
        k.players[0].knownHand = [{ cardNo: C, count: 4 }];
      },
      (k: AiSearchDeckKnowledge) => {
        k.players[0].knownDeck = [{ indexFromBottom: 0, cardNo: C }];
      },
    ]) {
      const knowledge = structuredClone(
        projectAiSearchDeckKnowledge(observation())
      );
      mutate(knowledge);
      expect(() =>
        sampleAiSearchOwnRegisteredDeck(
          knowledge,
          registered,
          history(),
          definitions,
          5
        )
      ).toThrow(/inconsistent_observation/);
    }
  });

  it("rejects incomplete/reordered events and impossible intermediate removal even if later addition would hide it", () => {
    for (const changes of [
      history([event(1, [], [{ cardNo: A, count: 1 }])]),
      history([
        event(0, [], [{ cardNo: A, count: 1 }]),
        event(0, [{ cardNo: A, count: 1 }], []),
      ]),
      history([
        event(0, [{ cardNo: C, count: 1 }], []),
        event(1, [], [{ cardNo: C, count: 1 }]),
      ]),
      history([event(0, [], [])]),
      history([
        event(0, [{ cardNo: A, count: 21 }], [{ cardNo: A, count: 21 }]),
      ]),
    ])
      expect(() =>
        reconstructAiSearchOwnPopulation(registered, changes, definitions)
      ).toThrow();
    // Count-preserving missing/relabelled history cannot be detected here;
    // the future trusted producer must prove its completeness independently.
    const knowledge = structuredClone(
      projectAiSearchDeckKnowledge(observation())
    );
    knowledge.players[0].deckCount--;
    expect(() =>
      sampleAiSearchOwnRegisteredDeck(
        knowledge,
        registered,
        history(),
        definitions,
        1
      )
    ).toThrow(/own population/);
    const sparse = history();
    (sparse.events as unknown[]).length = 1;
    expect(() =>
      reconstructAiSearchOwnPopulation(registered, sparse, definitions)
    ).toThrow(/data property/);
  });

  it("validates minimum size, public DB identities, event counts and duplicate entries", () => {
    expect(() =>
      reconstructAiSearchOwnPopulation(
        registered.slice(1),
        history(),
        definitions
      )
    ).toThrow(/input/);
    expect(() =>
      reconstructAiSearchOwnPopulation(registered, history(), [
        ...definitions,
        definitions[0],
      ])
    ).toThrow(/duplicate/);
    for (const count of [
      0,
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() =>
        reconstructAiSearchOwnPopulation(
          registered,
          history([event(0, [], [{ cardNo: A, count }])]),
          definitions
        )
      ).toThrow(/count/);
    for (const entries of [
      [{ cardNo: "not-public", count: 1 }],
      [
        { cardNo: A, count: 1 },
        { cardNo: A, count: 1 },
      ],
    ])
      expect(() =>
        reconstructAiSearchOwnPopulation(
          registered,
          history([event(0, [], entries)]),
          definitions
        )
      ).toThrow();
  });

  it("reads only named event data without invoking accessors or serialization hooks and keeps inputs detached", () => {
    const changes = history([event(0, [{ cardNo: A, count: 1 }], [])]);
    Object.assign(changes.events[0], {
      rawState: fixture(),
      toJSON() {
        throw new Error("unused");
      },
    });
    const expected = reconstructAiSearchOwnPopulation(
      registered,
      changes,
      definitions
    );
    const malicious = history([event(0, [], [{ cardNo: A, count: 1 }])]);
    Object.defineProperty(malicious.events[0].added[0], "cardNo", {
      get() {
        throw new Error("secret getter invoked");
      },
    });
    expect(() =>
      reconstructAiSearchOwnPopulation(registered, malicious, definitions)
    ).toThrow(/data property/);
    changes.events[0].removed[0].count = 2;
    expect(counts(expand(expected))).toEqual([19, 20, 0]);
    expect(
      counts(
        expand(
          reconstructAiSearchOwnPopulation(registered, changes, definitions)
        )
      )
    ).toEqual([18, 20, 0]);
    expect(registered).toHaveLength(40);
    expect(definitions[0].maxDeckCount).toBe(20);
  });

  it.each(["added", "removed"] as const)(
    "rejects %s array index accessors without invoking them",
    (side) => {
      const changes = history([event(0, [], [])]);
      let getterCalls = 0;
      Object.defineProperty(changes.events[0][side], "0", {
        get() {
          getterCalls++;
          return { cardNo: A, count: 1 };
        },
      });
      Object.freeze(changes.events[0][side]);
      expect(() =>
        reconstructAiSearchOwnPopulation(registered, changes, definitions)
      ).toThrow(/data property/);
      const knowledge = projectAiSearchDeckKnowledge(observation());
      knowledge.players[0].deckCount += side === "added" ? 1 : -1;
      expect(() =>
        sampleAiSearchOwnRegisteredDeck(
          knowledge,
          registered,
          changes,
          definitions,
          99
        )
      ).toThrow(/data property/);
      expect(getterCalls).toBe(0);
    }
  );

  it("rejects enormous mismatched changes before expanding the compact multiset", () => {
    const changes = history([
      event(0, [], [{ cardNo: A, count: 1_000_000_000 }]),
    ]);
    expect(
      reconstructAiSearchOwnPopulation(registered, changes, definitions)
    ).toEqual([
      { cardNo: A, count: 1_000_000_020 },
      { cardNo: B, count: 20 },
    ]);
    expect(() =>
      sampleAiSearchOwnRegisteredDeck(
        projectAiSearchDeckKnowledge(observation()),
        registered,
        changes,
        definitions,
        5
      )
    ).toThrow(/own population count/);
  });

  it("uses the common population telemetry for reconstruction/allocation and retains failed attempts", () => {
    const telemetry = new AiWorkTelemetry();
    const knowledge = projectAiSearchDeckKnowledge(observation());
    sampleAiSearchOwnRegisteredDeck(
      knowledge,
      registered,
      history(),
      definitions,
      5,
      telemetry
    );
    expect(() =>
      sampleAiSearchOwnRegisteredDeck(
        knowledge,
        registered.slice(1),
        history(),
        definitions,
        5,
        telemetry
      )
    ).toThrow();
    const snapshot = telemetry.snapshot();
    expect(
      snapshot.measurements.find(
        (value) => value.operation === "hidden_zone_sampling"
      )
    ).toMatchObject({
      attempted: 2,
      returned: 1,
      threw: 1,
      unit: "population",
      observed: true,
    });
    expect(
      snapshot.measurements.find((value) => value.operation === "game")!
        .observed
    ).toBe(false);
    console.log(
      "AI_OWN_POPULATION_BOUNDED_FIXTURE " + JSON.stringify(snapshot)
    );
  });
});
