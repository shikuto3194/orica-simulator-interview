import { describe, expect, it } from "vitest";

import {
  buildPolicyValueInferenceInput,
  createEmptyGameState,
  makePolicyValueTrainingPolicy,
  TRAINING_CHOICE_FEAT_DIM,
  type Engine,
  type PolicyValueInferenceInput,
  type PolicyValuePredictor,
  type TrainingDecisionNode,
} from "../src";

const engine: Engine = {
  cards: [],
  getCardDefinitionById: () => undefined,
  lookups: {} as Engine["lookups"],
};

function node(): TrainingDecisionNode {
  return {
    nodeId: "node-1",
    kind: "legal_action",
    actingPlayerId: "alice",
    fields: [],
    choices: [
      {
        choiceId: "advance",
        label: "advance_step",
        systemAction: { kind: "advance_step", actingPlayerId: "alice" },
      },
      {
        choiceId: "manual-core",
        label: "manual_core_move",
        systemAction: {
          kind: "manual_core_move",
          actingPlayerId: "alice",
          drafts: [],
        },
      },
    ],
    truncated: false,
  };
}

describe("policy/value inference adapter", () => {
  it("builds encoded inference input from a TrainingDecisionNode", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });

    expect(input.observation.cards).toHaveLength(4);
    expect(input.observation.knownDeck).toHaveLength(2);
    expect(input.choices).toHaveLength(2);
    expect(input.choices[0]?.feats).toHaveLength(TRAINING_CHOICE_FEAT_DIM);
    expect(input.choiceMask).toEqual([1, 1]);
    expect(input.metadata).toMatchObject({
      actingPlayerId: "alice",
      nodeId: "node-1",
      nodeKind: "legal_action",
      choiceCount: 2,
    });
  });

  it("wraps a predictor as a synchronous TrainingPolicy", () => {
    let seenInput: PolicyValueInferenceInput | null = null;
    const predictor: PolicyValuePredictor = {
      predict: (input) => {
        seenInput = input;
        return { policyLogits: [0.1, 0.9], value: -0.2 };
      },
    };
    const policy = makePolicyValueTrainingPolicy(predictor, {
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });

    const selected = policy(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node(),
      engine,
      () => 0
    );

    expect(seenInput?.choices).toHaveLength(2);
    expect(selected.choiceId).toBe("manual-core");
  });

  it("uses the game RNG for deterministic epsilon exploration", () => {
    const predictor: PolicyValuePredictor = {
      predict: () => {
        throw new Error("predictor should not run during forced exploration");
      },
    };
    const policy = makePolicyValueTrainingPolicy(predictor, {
      explorationRate: 1,
    });
    const values = [0, 0.75];
    const selected = policy(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node(),
      engine,
      () => values.shift() ?? 0
    );

    expect(selected.choiceId).toBe("manual-core");
  });

  it("rejects an exploration rate outside the unit interval", () => {
    const predictor: PolicyValuePredictor = {
      predict: () => ({ policyLogits: [0, 0], value: 0 }),
    };
    expect(() =>
      makePolicyValueTrainingPolicy(predictor, { explorationRate: 1.1 })
    ).toThrow(/between 0 and 1/);
  });
});
