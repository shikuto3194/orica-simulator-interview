import { describe, expect, it } from "vitest";
import {
  buildAiObservation,
  buildPolicyValueInferenceInput,
  createCardInstance,
  createEmptyGameState,
  createTinyPolicyValueNetwork,
  executePeekDeck,
  executeShuffleZone,
  type AiObservationMode,
  type CardDefinition,
  type Engine,
  type GameState,
  type TrainingDecisionNode,
} from "../src";

const first: CardDefinition = {
  cardNo: "AI-KNOWLEDGE-A",
  name: "既知情報境界A",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
};
const second: CardDefinition = { ...first, cardNo: "AI-KNOWLEDGE-B" };
const engine: Engine = {
  cards: [first, second],
  getCardDefinitionById: (id) =>
    [first, second].find((definition) => definition.cardNo === id),
  lookups: {} as Engine["lookups"],
};
const node: TrainingDecisionNode = {
  nodeId: "same-observed-decision",
  kind: "legal_action",
  actingPlayerId: "alice",
  fields: [],
  choices: [
    {
      choiceId: "advance",
      label: "advance_step",
      systemAction: { kind: "advance_step", actingPlayerId: "alice" },
    },
  ],
  truncated: false,
};

function state(cards: readonly CardDefinition[] = [first, second, first]) {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards.map((definition, index) =>
      createCardInstance(definition, {
        instanceId: `deck-${index}`,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    ),
    playerOverrides: [{ deckCount: cards.length }, {}],
  });
}

function observe(input: GameState, mode: AiObservationMode = "player") {
  return buildAiObservation({
    state: input,
    mode,
    viewpointPlayerId: "alice",
    getCardDefinitionById: engine.getCardDefinitionById,
  });
}

function ownCounts(input: GameState, mode: AiObservationMode = "player") {
  return observe(input, mode).players.find((player) => player.relative === "me")
    ?.ownDeckCardNoCounts;
}

describe("AiObservation own deck knowledge boundary", () => {
  it("unknown own deck identities do not change observation, NN input or prediction", () => {
    const a = state([first, first, first]);
    const b = state([second, first, second]);
    expect(observe(a)).toEqual(observe(b));
    expect(ownCounts(a)).toBeUndefined();
    const inference = (input: GameState) =>
      buildPolicyValueInferenceInput({ state: input, node, engine });
    const inputA = inference(a);
    const inputB = inference(b);
    expect(inputA).toEqual(inputB);
    const model = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
    expect(model.predict(inputA)).toEqual(model.predict(inputB));
  });

  it("partial private knowledge retains known slots without claiming the full multiset", () => {
    const peek = (input: GameState) =>
      executePeekDeck(input, "alice", {
        kind: "peek_deck",
        count: 1,
        revealTo: "self",
      });
    const a = peek(state([first, first, first]));
    const b = peek(state([first, second, second]));
    expect(observe(a)).toEqual(observe(b));
    expect(observe(a).knownDeck).toMatchObject([
      { indexFromBottom: 2, definitionIdSnapshot: first.cardNo },
    ]);
    expect(ownCounts(a)).toBeUndefined();
  });

  it("all privately observed slots provide an exact detached own multiset", () => {
    const input = executePeekDeck(state(), "alice", {
      kind: "peek_deck",
      count: 3,
      revealTo: "self",
    });
    const observation = observe(input);
    expect(ownCounts(input)).toEqual({ [first.cardNo]: 2, [second.cardNo]: 1 });
    expect(observation.knownDeck).toHaveLength(3);
    const opponent = buildAiObservation({
      state: input,
      viewpointPlayerId: "bob",
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    expect(opponent.knownDeck).toEqual([]);
    expect(
      opponent.players.every((player) =>
        player.relative === "opp"
          ? player.ownDeckCardNoCounts === undefined
          : true
      )
    ).toBe(true);
    input.cardInstances[0]!.definitionId = second.cardNo;
    expect(observation.players[0]!.ownDeckCardNoCounts).toEqual({
      [first.cardNo]: 2,
      [second.cardNo]: 1,
    });
  });

  it("opponent-only knowledge cannot authorize an own multiset", () => {
    const input = executePeekDeck(state(), "alice", {
      kind: "peek_deck",
      count: 3,
      revealTo: "opponent",
    });
    expect(observe(input).knownDeck).toEqual([]);
    expect(ownCounts(input)).toBeUndefined();
  });

  it("shuffle invalidates the position-derived multiset instead of consulting raw cards", () => {
    const known = executePeekDeck(state(), "alice", {
      kind: "peek_deck",
      count: 3,
      revealTo: "self",
    });
    expect(ownCounts(known)).toBeDefined();
    const shuffled = executeShuffleZone(known, "alice", {
      kind: "shuffle_zone",
      zone: "deck",
    });
    expect(observe(shuffled).knownDeck).toEqual([]);
    expect(ownCounts(shuffled)).toBeUndefined();
  });

  it("an empty deck has a known empty multiset", () => {
    expect(ownCounts(state([]))).toEqual({});
  });

  it.each(["debug_perfect", "spectator_full"] as const)(
    "%s retains the explicit full-information baseline",
    (mode) => {
      expect(ownCounts(state(), mode)).toEqual({
        [first.cardNo]: 2,
        [second.cardNo]: 1,
      });
    }
  );
});
