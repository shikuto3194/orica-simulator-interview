import { describe, expect, expectTypeOf, it } from "vitest";
import {
  appendPublicDisclosure,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  projectAiSearchHistory,
} from "../src";
import type {
  AiObservation,
  CardDefinition,
  GameState,
  PublicDisclosure,
} from "../src";

const card: CardDefinition = {
  cardNo: "SEARCH-HISTORY-PUBLIC",
  name: "履歴用公開カード",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
};

function fixture(secret: string, actorIds = ["alice", "bob"]): GameState {
  const [alice, bob] = actorIds;
  let state = createEmptyGameState({
    playerIds: [alice, bob],
    cardInstances: [
      createCardInstance(card, {
        instanceId: `${secret}-public`,
        ownerPlayerId: alice,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(
        { ...card, cardNo: `${secret}-hand` },
        {
          instanceId: `${secret}-hidden-hand`,
          ownerPlayerId: bob,
          zone: "hand",
        }
      ),
      ...[0, 1].map((index) =>
        createCardInstance(
          { ...card, cardNo: `${secret}-deck-${index}` },
          {
            instanceId: `${secret}-hidden-deck-${index}`,
            ownerPlayerId: bob,
            zone: "deck",
          }
        )
      ),
    ],
  });
  const append = (
    input: Omit<PublicDisclosure, "id" | "sequence" | "turnNumber" | "step">
  ) => {
    state = appendPublicDisclosure(state, {
      ...input,
      turnNumber: 1,
      step: "main",
    });
  };
  append({
    actorPlayerId: bob,
    audience: "actor_only",
    kind: "deck_revealed",
    targets: [
      {
        kind: "card",
        definitionIdSnapshot: `${secret}-private-peek`,
        actionLabel: "show_cards",
      },
    ],
    results: [],
  });
  append({
    actorPlayerId: alice,
    audience: "both",
    kind: "attack_declared",
    attackId: `${secret}-attack`,
    source: {
      instanceId: `${secret}-public`,
      registrationIndex: secret.length,
      effectIndex: 0,
      definitionPath: ["effects", 0],
    },
    targets: [{ kind: "player", playerId: bob, actionLabel: "attack_target" }],
    results: [],
  });
  append({
    actorPlayerId: bob,
    audience: "actor_only",
    kind: "zone_moved",
    source: { definitionIdSnapshot: `${secret}-private-source` },
    targets: [],
    results: [
      {
        kind: "card_move",
        instanceId: `${secret}-hidden-hand`,
        definitionIdSnapshot: `${secret}-hand`,
        playerId: bob,
        from: "hand",
        to: "deck",
        count: 1,
        actionLabel: "move_to_top",
        deckPositionSnapshot: "top",
        deckIndexFromBottomSnapshot: 2,
      },
    ],
  });
  append({
    actorPlayerId: alice,
    audience: "both",
    kind: "battle_resolved",
    attackId: `${secret}-attack`,
    targets: [
      {
        kind: "card",
        instanceId: `${secret}-public`,
        actionLabel: "battle_resolve",
      },
    ],
    results: [
      {
        kind: "core_move",
        playerId: alice,
        instanceId: `${secret}-public`,
        amount: 2,
        value: 3,
        actionLabel: "core_move",
      },
    ],
  });
  return state;
}

function observe(
  state: GameState,
  playerId = state.players[0].id
): AiObservation {
  return buildAiObservation({
    state,
    viewpointPlayerId: playerId,
    getCardDefinitionById: (id) => (id === card.cardNo ? card : undefined),
  });
}

describe("AiSearchHistory observation boundary", () => {
  it("accepts player observations rather than GameState and rejects debug/spectator modes", () => {
    expectTypeOf<
      Parameters<typeof projectAiSearchHistory>[0]
    >().toEqualTypeOf<AiObservation>();
    const state = fixture("private-A");
    expect(() => projectAiSearchHistory(state as never)).toThrow(
      /player observation/
    );
    for (const mode of ["debug_perfect", "spectator_full"] as const)
      expect(() => projectAiSearchHistory({ ...observe(state), mode })).toThrow(
        /player observation/
      );
  });

  it("real disclosure/sanitize/observation path is invariant to hidden identities, deck order and raw IDs", () => {
    const stateA = fixture("private-A");
    const stateB = fixture("longer-private-B");
    const decks = stateB.cardInstances.filter((entry) => entry.zone === "deck");
    stateB.cardInstances = [
      ...stateB.cardInstances.filter((entry) => entry.zone !== "deck"),
      ...decks.reverse(),
    ];
    const a = projectAiSearchHistory(observe(stateA));
    const b = projectAiSearchHistory(observe(stateB));
    expect(a).toEqual(b);
    const serialized = JSON.stringify(a);
    for (const secret of [
      "private-A",
      "longer-private-B",
      "instanceId",
      "registrationIndex",
      "sequence",
      "attackId",
    ])
      expect(serialized).not.toContain(secret);
    expect(a.events.map((event) => event.eventId)).toEqual([0, 1, 2]);
    expect(a.events[0].source?.definitionIdSnapshot).toBe(card.cardNo);
    expect(a.events[0].attackRef).toBe(0);
    expect(a.events[2].attackRef).toBe(0);
    expect(a.events[1]).toMatchObject({
      kind: "hidden_card_action",
      results: [
        {
          kind: "hidden_card_move",
          from: "hand",
          to: "deck",
          count: 1,
          player: "opp",
        },
      ],
    });
  });

  it("unseen event count and sequence gaps do not enter ordinals or attack references", () => {
    const first = observe(fixture("secret"));
    const other = observe(fixture("secret"));
    const privateEvent = fixture("secret").publicDisclosures![0];
    other.publicMemory = {
      disclosures: [
        privateEvent,
        privateEvent,
        ...other.publicMemory.disclosures.map((event) => ({
          ...event,
          sequence: event.sequence + 500,
          id: `secret-global-${event.sequence}`,
        })),
      ],
    };
    expect(projectAiSearchHistory(other)).toEqual(
      projectAiSearchHistory(first)
    );
  });

  it("player IDs are relative and each viewer receives only its own private snapshots", () => {
    expect(
      projectAiSearchHistory(
        observe(fixture("secret", ["renamed-first", "renamed-second"]))
      )
    ).toEqual(projectAiSearchHistory(observe(fixture("secret"))));
    const state = fixture("secret");
    const alice = projectAiSearchHistory(observe(state));
    const bob = projectAiSearchHistory(observe(state, "bob"));
    expect(JSON.stringify(alice)).not.toContain("secret-private-peek");
    expect(JSON.stringify(bob)).toContain("secret-private-peek");
    expect(bob.events[0].actor).toBe("me");
    expect(bob.events[1].actor).toBe("opp");
  });

  it("retains observed snapshot/position/order and numeric action meaning without live card tracking", () => {
    const observation = observe(fixture("secret"));
    const event = observation.publicMemory.disclosures[0];
    event.results = [
      {
        kind: "card_move",
        instanceId: "old-live",
        definitionIdSnapshot: "HISTORICAL-CARD",
        playerId: "alice",
        count: 1,
        amount: -1,
        value: 2,
        from: "field",
        to: "deck",
        zone: "deck",
        deckPositionSnapshot: "bottom",
        deckIndexFromBottomSnapshot: 0,
        deckCountSnapshot: 4,
        order: "bottom_to_top",
        exhaustState: "recovered",
        actionLabel: "action_execute",
        actionKind: "move_cards",
      },
    ];
    const first = projectAiSearchHistory(observation);
    expect(first.events[0].results[0]).toEqual({
      kind: "card_move",
      definitionIdSnapshot: "HISTORICAL-CARD",
      player: "me",
      count: 1,
      amount: -1,
      value: 2,
      from: "field",
      to: "deck",
      zone: "deck",
      deckPositionSnapshot: "bottom",
      deckIndexFromBottomSnapshot: 0,
      deckCountSnapshot: 4,
      order: "bottom_to_top",
      exhaustState: "recovered",
      actionLabel: "action_execute",
      actionKind: "move_cards",
    });
    event.results[0].amount = -2;
    expect(projectAiSearchHistory(observation)).not.toEqual(first);
    expect(first.events[0].results[0].amount).toBe(-1);
  });

  it("detaches nested data and never restores missing historical identity from live cards", () => {
    const observation = observe(fixture("secret"));
    const event = observation.publicMemory.disclosures[0];
    event.source = {
      instanceId: "secret-live-only",
      definitionPath: ["effects", 0],
    };
    const projected = projectAiSearchHistory(observation);
    expect(projected.events[0].source).toEqual({
      definitionPath: ["effects", 0],
    });
    (event.source.definitionPath as (string | number)[])[0] = "mutated";
    event.targets[0].actionLabel = "destroy";
    expect(projected.events[0].source?.definitionPath).toEqual(["effects", 0]);
    expect(projected.events[0].targets[0].actionLabel).toBe("attack_target");
  });

  it("hidden movement ignores stray identity/position fields without reading their accessors", () => {
    const observation = observe(fixture("secret"));
    const result = observation.publicMemory.disclosures[1].results[0];
    Object.defineProperty(result, "definitionIdSnapshot", {
      get() {
        throw new Error("secret read");
      },
    });
    Object.defineProperty(result, "deckPositionSnapshot", {
      get() {
        throw new Error("private position read");
      },
    });
    expect(projectAiSearchHistory(observation).events[1].results[0]).toEqual({
      kind: "hidden_card_move",
      count: 1,
      from: "hand",
      to: "deck",
      actionLabel: "move_to_top",
      hiddenReason: "without_showing_contents",
      player: "opp",
    });
  });

  it("does not read global IDs, registration IDs, extras or toJSON hooks", () => {
    const observation = observe(fixture("secret"));
    const event = observation.publicMemory.disclosures[0];
    for (const field of ["id", "sequence", "toJSON", "secretExtra"])
      Object.defineProperty(event, field, {
        get() {
          throw new Error("secret field read");
        },
      });
    Object.defineProperty(event.source!, "registrationIndex", {
      get() {
        throw new Error("registration read");
      },
    });
    Object.defineProperty(event.source!, "toJSON", {
      value: () => ({ secret: "leak" }),
    });
    expect(JSON.stringify(projectAiSearchHistory(observation))).not.toContain(
      "leak"
    );
  });

  it("rejects malformed scalar/path data and unknown actors/players instead of coercion", () => {
    const observation = observe(fixture("secret"));
    const event = observation.publicMemory.disclosures[0];
    Object.defineProperty(event, "kind", {
      value: { toJSON: () => "secret" },
      configurable: true,
    });
    expect(() => projectAiSearchHistory(observation)).toThrow(/scalar/);
    Object.defineProperty(event, "kind", { value: "attack_declared" });
    event.source!.definitionPath = ["effects", Number.NaN];
    expect(() => projectAiSearchHistory(observation)).toThrow(/scalar/);
    event.source!.definitionPath = ["effects", 0];
    event.actorPlayerId = "unknown";
    expect(() => projectAiSearchHistory(observation)).toThrow(
      /unknown.*player/
    );
    event.actorPlayerId = "alice";
    event.targets[0].playerId = "unknown";
    expect(() => projectAiSearchHistory(observation)).toThrow(
      /unknown.*player/
    );
  });

  it("keeps distinct observed attacks distinct, preserving repeated-reference equality", () => {
    const observation = observe(fixture("secret"));
    const events = observation.publicMemory.disclosures;
    observation.publicMemory = {
      disclosures: [
        ...events,
        { ...events[0], attackId: "second-raw-attack" },
        { ...events[0], attackId: "second-raw-attack" },
      ],
    };
    expect(
      projectAiSearchHistory(observation).events.map((event) => event.attackRef)
    ).toEqual([0, undefined, 0, 1, 1]);
  });

  it("rechecks both private audience directions", () => {
    const observation = observe(fixture("secret"));
    const sample = observation.publicMemory.disclosures[0];
    observation.publicMemory = {
      disclosures: [
        {
          ...sample,
          actorPlayerId: "alice",
          audience: "actor_only",
          kind: "picked",
        },
        {
          ...sample,
          actorPlayerId: "bob",
          audience: "actor_only",
          kind: "destroyed",
        },
        {
          ...sample,
          actorPlayerId: "bob",
          audience: "opponent_only",
          kind: "core_moved",
        },
        {
          ...sample,
          actorPlayerId: "alice",
          audience: "opponent_only",
          kind: "bp_modified",
        },
      ],
    };
    expect(
      projectAiSearchHistory(observation).events.map((event) => event.kind)
    ).toEqual(["picked", "core_moved"]);
  });

  it("rejects missing/null required values and duplicate viewpoint players", () => {
    const observation = observe(fixture("secret"));
    const event = observation.publicMemory.disclosures[0];
    Object.defineProperty(event, "kind", {
      value: undefined,
      configurable: true,
    });
    expect(() => projectAiSearchHistory(observation)).toThrow(
      /missing required/
    );
    Object.defineProperty(event, "kind", { value: null });
    expect(() => projectAiSearchHistory(observation)).toThrow(/scalar/);
    observation.players = [observation.players[0], observation.players[0]];
    expect(() => projectAiSearchHistory(observation)).toThrow(
      /player observation/
    );
  });
});
