import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function def(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
defMap.set("DECK-A", def("DECK-A"));
defMap.set("DECK-B", def("DECK-B"));
defMap.set("DECK-C", def("DECK-C"));

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id);
}

function deckCard(
  instanceId: string,
  owner: string,
  definitionId = "DECK-A"
): CardInstance {
  return createCardInstance(defMap.get(definitionId)!, {
    instanceId,
    ownerPlayerId: owner,
    zone: "deck",
  });
}

function runEffect(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:peek-deck-action:54",
    state,
    effect,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

describe("P3-14 A-3: peek_deck action", () => {
  it("デッキ上から count 枚を log に開示する", () => {
    const a = deckCard("a-1", ALICE, "DECK-A");
    const b = deckCard("a-2", ALICE, "DECK-B");
    const c = deckCard("a-3", ALICE, "DECK-C");
    const state = createEmptyGameState({
      cardInstances: [a, b, c],
      playerOverrides: [{ deckCount: 3 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "peek_deck", count: 2, revealTo: "self" } }],
    };

    const result = runEffect(state, effect);
    const log = result.log.find((l) => l.includes("effect:peek_deck"));
    expect(log).toBeDefined();
    expect(log).toContain(`:${ALICE}:`);
    expect(log).toContain("revealTo=self");
    expect(log).toContain("count=2");
    expect(log).toContain("a-1");
    expect(log).toContain("a-2");
    expect(log).not.toContain("a-3");
  });

  it("カードのゾーンは変化しない（純粋な閲覧）", () => {
    const a = deckCard("a-1", ALICE, "DECK-A");
    const state = createEmptyGameState({
      cardInstances: [a],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "peek_deck", count: 1, revealTo: "both" } }],
    };

    const result = runEffect(state, effect);
    expect(result.cardInstances.find((c) => c.instanceId === "a-1")?.zone).toBe(
      "deck"
    );
    expect(result.players.find((p) => p.id === ALICE)?.deckCount).toBe(1);
  });

  it("player=opponent で相手のデッキを閲覧する", () => {
    const b1 = deckCard("b-1", BOB, "DECK-A");
    const b2 = deckCard("b-2", BOB, "DECK-B");
    const state = createEmptyGameState({
      cardInstances: [b1, b2],
      playerOverrides: [{}, { deckCount: 2 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "peek_deck",
            player: "opponent",
            count: 2,
            revealTo: "self",
          },
        },
      ],
    };

    const result = runEffect(state, effect);
    const log = result.log.find((l) => l.includes("effect:peek_deck"));
    expect(log).toBeDefined();
    expect(log).toContain(`:${BOB}:`);
    expect(log).toContain("count=2");
  });

  it("デッキ枚数 < count のときは存在分のみ開示する", () => {
    const a = deckCard("a-only", ALICE, "DECK-A");
    const state = createEmptyGameState({
      cardInstances: [a],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "peek_deck", count: 5, revealTo: "self" } }],
    };

    const result = runEffect(state, effect);
    const log = result.log.find((l) => l.includes("effect:peek_deck"));
    expect(log).toBeDefined();
    expect(log).toContain("count=1");
  });

  it("デッキが空のときは no-op (log に開示記録なし)", () => {
    const state = createEmptyGameState({
      cardInstances: [],
      playerOverrides: [{ deckCount: 0 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "peek_deck", count: 3, revealTo: "self" } }],
    };

    const result = runEffect(state, effect);
    expect(result.log.some((l) => l.includes("effect:peek_deck"))).toBe(false);
  });
});
