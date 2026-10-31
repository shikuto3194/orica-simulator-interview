import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AI_UNKNOWN_CARD,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  projectAiSearchCards,
} from "../src";
import type { AiObservation, CardDefinition, GameState } from "../src";

const card: CardDefinition = {
  cardNo: "SEARCH-CARD-PUBLIC",
  name: "可視カード",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
};

function fixture(secret = "secret-A", players = ["alice", "bob"]): GameState {
  const [alice, bob] = players;
  const make = (
    id: string,
    owner: string,
    zone: "hand" | "deck" | "field" | "burst",
    definition = card
  ) =>
    createCardInstance(definition, {
      instanceId: `${secret}-${id}`,
      ownerPlayerId: owner,
      zone,
      ...(zone === "field" ? { cores: 1 } : {}),
    });
  return createEmptyGameState({
    playerIds: [alice, bob],
    cardInstances: [
      make("field", alice, "field"),
      make("own-hand", alice, "hand"),
      make("opp-burst", bob, "burst", { ...card, cardNo: secret }),
      make("opp-hand", bob, "hand", { ...card, cardNo: secret }),
      make("own-deck", alice, "deck", { ...card, cardNo: secret }),
      ...[0, 1].map((i) =>
        make(`opp-deck-${i}`, bob, "deck", {
          ...card,
          cardNo: `${secret}-${i}`,
        })
      ),
    ],
  });
}

function observe(state = fixture(), viewpointPlayerId = state.players[0].id) {
  return buildAiObservation({
    state,
    viewpointPlayerId,
    getCardDefinitionById: (id) => (id === card.cardNo ? card : undefined),
  });
}

describe("AiSearchCards visible reference boundary", () => {
  it("takes an observation rather than raw GameState and rejects full/debug modes", () => {
    expectTypeOf<
      Parameters<typeof projectAiSearchCards>[0]
    >().toEqualTypeOf<AiObservation>();
    expect(() => projectAiSearchCards(fixture() as never)).toThrow(
      /player observation/
    );
    for (const mode of ["debug_perfect", "spectator_full"] as const)
      expect(() => projectAiSearchCards({ ...observe(), mode })).toThrow(
        /player observation/
      );
  });

  it("real sanitize/observation path ignores hidden identities/order and raw ID renaming", () => {
    const a = fixture(),
      b = fixture("different-secret-B", ["first", "second"]);
    const deck = b.cardInstances.filter((value) => value.zone === "deck");
    b.cardInstances = [
      ...b.cardInstances.filter((value) => value.zone !== "deck"),
      ...deck.reverse(),
    ];
    const projected = projectAiSearchCards(observe(a));
    expect(projectAiSearchCards(observe(b))).toEqual(projected);
    expect(projected.map((value) => value.cardRef)).toEqual([0, 1, 2]);
    expect(projected[2].cardNoOrUnknown).toBe(AI_UNKNOWN_CARD);
    expect(projected[2].identityVisibility).toBe("unknown");
    for (const forbidden of [
      "secret-A",
      "alice",
      "bob",
      "instanceId",
      "tokenId",
      "deckIndex",
    ])
      expect(JSON.stringify(projected)).not.toContain(forbidden);
    // The input does contain live IDs: this guards against a vacuous fixture.
    expect(JSON.stringify(observe(a))).toContain("secret-A-field");
  });

  it("keeps the viewer's own hand and controller perspective without leaking the opponent's hand", () => {
    const state = fixture();
    const alice = projectAiSearchCards(observe(state));
    const bob = projectAiSearchCards(observe(state, "bob"));
    expect(alice.filter((value) => value.zone === "hand")).toHaveLength(1);
    expect(bob.find((value) => value.zone === "hand")?.owner).toBe("me");
    expect(bob.find((value) => value.zone === "burst")?.cardNoOrUnknown).toBe(
      "secret-A"
    );
    expect(bob.find((value) => value.zone === "field")?.owner).toBe("opp");
  });

  it("translates parent/children to visible ordinals and retains attachment order", () => {
    const observation = observe();
    const [host, child, other] = observation.cards;
    host.attachedChildrenIds = [other.instanceId!, child.instanceId!];
    child.attachedToInstanceId = host.instanceId;
    other.attachedToInstanceId = host.instanceId;
    const result = projectAiSearchCards(observation);
    expect(result[0].attachedChildren).toEqual([2, 1]);
    expect(result[1].attachedTo).toBe(0);
    expect(result[2].attachedTo).toBe(0);
    const renamed = structuredClone(observation);
    renamed.cards.forEach((value, i) => {
      value.instanceId = `rename-${2 - i}`;
      value.tokenId += 100;
      value.attachedChildrenIds = value.attachedChildrenIds.map(
        (id) =>
          `rename-${2 - observation.cards.findIndex((entry) => entry.instanceId === id)}`
      );
      if (value.attachedToInstanceId !== undefined)
        value.attachedToInstanceId = "rename-2";
    });
    expect(projectAiSearchCards(renamed)).toEqual(result);
  });

  it("preserves real field attachments through sanitize and observation before replacing live IDs", () => {
    const state = fixture();
    const host = state.cardInstances[0];
    const brave: CardDefinition = {
      ...card,
      cardNo: "SEARCH-BRAVE",
      printedCategory: "brave",
    };
    const child = createCardInstance(brave, {
      instanceId: "raw-brave-reference",
      ownerPlayerId: "alice",
      zone: "field",
    });
    host.attachedChildrenIds = [child.instanceId];
    child.attachedToInstanceId = host.instanceId;
    state.cardInstances.push(child);
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: "alice",
      getCardDefinitionById: (id) =>
        [card, brave].find((value) => value.cardNo === id),
    });
    const projected = projectAiSearchCards(observation);
    const parentRef = observation.cards.findIndex(
      (value) => value.instanceId === host.instanceId
    );
    const childRef = observation.cards.findIndex(
      (value) => value.instanceId === child.instanceId
    );
    expect(childRef).toBeGreaterThanOrEqual(0);
    expect(projected[parentRef].attachedChildren).toEqual([childRef]);
    expect(projected[childRef].attachedTo).toBe(parentRef);
    expect(projected[childRef].effectiveCategory).toBe("brave");
    expect(JSON.stringify(projected)).not.toContain("raw-brave-reference");
  });

  it("keeps distinct visible source/target cards distinct even with identical card definitions", () => {
    const observation = observe();
    const [first, second] = observation.cards;
    second.zone = first.zone;
    second.attachedChildrenIds = [];
    const result = projectAiSearchCards(observation);
    expect(result[0].cardNoOrUnknown).toBe(result[1].cardNoOrUnknown);
    expect(result[0].cardRef).not.toBe(result[1].cardRef);
  });

  it("preserves core/level/BP/symbol bundle facts and detaches every nested vector", () => {
    const observation = observe();
    const token = observation.cards[0];
    token.normalCoreCount = 2;
    token.soulCoreCount = 1;
    token.effectiveSymbolBundles = [
      { colors: ["red", "blue"], count: 1 },
      { colors: ["yellow"], count: 2 },
    ];
    token.combinedUnitSymbolBundles = [
      { colors: ["green", "white"], count: 1 },
    ];
    token.combinedUnitSymbols = ["green"];
    token.effectiveTribes = ["public-tribe"];
    const result = projectAiSearchCards(observation);
    expect(result[0]).toMatchObject({
      normalCoreCount: 2,
      soulCoreCount: 1,
      effectiveLevel: 1,
      effectiveBp: 1000,
      effectiveSymbolBundles: [
        { colors: ["red", "blue"], count: 1 },
        { colors: ["yellow"], count: 2 },
      ],
    });
    token.effectiveSymbolBundles[0].colors[0] = "black";
    token.combinedUnitSymbolBundles[0].colors[0] = "black";
    (token.combinedUnitSymbols as string[])[0] = "black";
    (token.effectiveTribes as string[])[0] = "changed";
    expect(result[0].effectiveSymbolBundles[0].colors[0]).toBe("red");
    expect(result[0].combinedUnitSymbolBundles![0].colors[0]).toBe("green");
    expect(result[0].combinedUnitSymbols).toEqual(["green"]);
    expect(result[0].effectiveTribes).toEqual(["public-tribe"]);
  });

  it("rejects missing/duplicate identities and dangling references without silently dropping cards", () => {
    for (const mutate of [
      (o: AiObservation) => {
        delete o.cards[0].instanceId;
      },
      (o: AiObservation) => {
        o.cards[1].instanceId = o.cards[0].instanceId;
      },
      (o: AiObservation) => {
        o.cards[0].attachedToInstanceId = "missing";
      },
      (o: AiObservation) => {
        o.cards[0].attachedChildrenIds = ["missing"];
      },
      (o: AiObservation) => {
        o.cards[0].ownerPlayerId = "unknown-player";
      },
    ]) {
      const observation = observe();
      mutate(observation);
      expect(() => projectAiSearchCards(observation)).toThrow();
    }
  });

  it("refuses deck and hidden hand tokens instead of transporting accidentally supplied secrets", () => {
    for (const zone of ["hand", "deck"] as const) {
      const observation = observe();
      observation.cards[2].zone = zone;
      expect(() => projectAiSearchCards(observation)).toThrow(
        /hidden hand\/deck/
      );
    }
  });

  it("does not read token IDs, deck positions, extras or serialization hooks", () => {
    const observation = observe();
    for (const field of [
      "tokenId",
      "deckIndexFromTop",
      "deckIndexFromBottom",
      "toJSON",
      "secretExtra",
    ])
      Object.defineProperty(observation.cards[0], field, {
        get() {
          throw new Error("secret read");
        },
      });
    expect(() =>
      JSON.stringify(projectAiSearchCards(observation))
    ).not.toThrow();
  });

  it("rejects accessors, object-valued scalars and nonfinite values without invoking them", () => {
    for (const value of [NaN, Infinity, {}]) {
      const observation = observe();
      observation.cards[0].effectiveBp = value as number;
      expect(() => projectAiSearchCards(observation)).toThrow(/scalar/);
    }
    const observation = observe();
    const getter = () => {
      throw new Error("accessor was invoked");
    };
    Object.defineProperty(observation.cards[0], "normalCoreCount", {
      get: getter,
    });
    expect(() => projectAiSearchCards(observation)).toThrow(/data property/);
  });
});
