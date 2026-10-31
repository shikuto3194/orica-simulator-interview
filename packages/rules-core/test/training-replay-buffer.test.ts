import { describe, expect, it } from "vitest";

import {
  buildAiObservation,
  buildPolicyValueInferenceInput,
  buildEncodedTrainingReplayBatch,
  buildTrainingReplaySample,
  createEmptyGameState,
  summarizeTrainingReplaySamples,
  TRAINING_CHOICE_FEAT_DIM,
  trainingReplayValueTargetForActor,
  type AiObservation,
  type Engine,
  type TrainingTraceSmokeFrame,
} from "../src";

function observation() {
  const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return buildAiObservation({
    state,
    viewpointPlayerId: "alice",
    mode: "player",
    getCardDefinitionById: () => undefined,
  });
}

function frame(overrides: Partial<TrainingTraceSmokeFrame> = {}) {
  return {
    frameIndex: 2,
    stateHash: "aaaaaaaa",
    observationHash: "bbbbbbbb",
    state: {} as TrainingTraceSmokeFrame["state"],
    observation: {} as AiObservation,
    node: {
      nodeId: "node-1",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        { choiceId: "choice-a", label: "A" },
        { choiceId: "choice-b", label: "B" },
      ],
      truncated: false,
    },
    selected: {
      step: 3,
      nodeKind: "legal_action",
      actingPlayerId: "alice",
      choiceId: "choice-b",
      choiceCount: 2,
      fields: [],
      truncated: false,
    },
    ...overrides,
  } satisfies TrainingTraceSmokeFrame;
}

describe("training replay buffer samples", () => {
  it("aligns reordered replay features and policy targets with live inference without encoding position", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const engine: Engine = {
      cards: [],
      getCardDefinitionById: () => undefined,
      lookups: {} as Engine["lookups"],
    };
    const original = frame({ observation: observation() });
    original.node.choices = [
      {
        choiceId: "choice-a",
        label: "advance",
        systemAction: { kind: "advance_step", actingPlayerId: "alice" },
      },
      {
        choiceId: "choice-b",
        label: "move cores",
        systemAction: {
          kind: "manual_core_move",
          actingPlayerId: "alice",
          drafts: [],
        },
      },
    ];
    const reordered = {
      ...original,
      node: { ...original.node, choices: [...original.node.choices].reverse() },
    };
    const batchFor = (value: TrainingTraceSmokeFrame) =>
      buildEncodedTrainingReplayBatch(
        [
          buildTrainingReplaySample(
            { outcome: "natural", winner: "alice" },
            value,
            { gameId: "permutation", gameIndex: 0, seed: 7 }
          ),
        ],
        { maxCards: 4, maxKnownDeckEntries: 2, maxChoices: 3 }
      );
    const before = batchFor(original);
    const after = batchFor(reordered);
    const live = buildPolicyValueInferenceInput({
      state,
      node: reordered.node,
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    expect(after.choiceFeatures[0]!.slice(0, 2)).toEqual(
      before.choiceFeatures[0]!.slice(0, 2).reverse()
    );
    expect(after.choiceFeatures[0]!.slice(0, 2)).toEqual(
      live.choices.map((choice) => choice.feats)
    );
    expect(after.choiceFeatures[0]![2]).toEqual(
      new Array(TRAINING_CHOICE_FEAT_DIM).fill(0)
    );
    expect(before.policyTargets).toEqual([[0, 1, 0]]);
    expect(after.policyTargets).toEqual([[1, 0, 0]]);
    expect(after.choiceMask).toEqual([[1, 1, 0]]);
    expect(after.metadata.samples[0]!.selectedChoiceIndex).toBe(0);
    expect(after.valueTargets).toEqual(before.valueTargets);
  });

  it("builds policy and value targets from a trace-smoke frame", () => {
    const sample = buildTrainingReplaySample(
      { outcome: "natural", winner: "alice" },
      frame(),
      {
        experimentId: "exp-1",
        gameId: "exp-1:game-0000",
        gameIndex: 0,
        seed: 7,
      }
    );

    expect(sample.schemaVersion).toBe(1);
    expect(sample.sampleId).toBe("exp-1:game-0000:frame-000002");
    expect(sample.policyTarget.selectedChoiceIndex).toBe(1);
    expect(sample.policyTarget.distribution).toEqual([0, 1]);
    expect(sample.valueTarget).toMatchObject({
      result: "win",
      value: 1,
      terminalOutcomeKnown: true,
    });
    expect(sample.weights).toEqual({ policy: 1, value: 1 });
  });

  it("zeros unsafe targets for truncated or unresolved frames", () => {
    const sample = buildTrainingReplaySample(
      { outcome: "capped", winner: null },
      frame({
        node: {
          nodeId: "node-1",
          kind: "legal_action",
          actingPlayerId: "alice",
          fields: [],
          choices: [
            { choiceId: "choice-a", label: "A" },
            { choiceId: "choice-b", label: "B" },
          ],
          truncated: true,
        },
        selected: {
          step: 3,
          nodeKind: "legal_action",
          actingPlayerId: "alice",
          choiceId: "choice-b",
          choiceCount: 2,
          fields: [],
          truncated: true,
        },
      }),
      {
        gameId: "exp-1:game-0000",
        gameIndex: 0,
        seed: 7,
      }
    );

    expect(sample.valueTarget).toMatchObject({
      result: "unresolved",
      value: 0,
      terminalOutcomeKnown: false,
    });
    expect(sample.weights).toEqual({ policy: 0, value: 0 });
    expect(summarizeTrainingReplaySamples([sample])).toMatchObject({
      sampleCount: 1,
      policyWeightSum: 0,
      valueWeightSum: 0,
      truncatedSampleCount: 1,
    });
  });

  it("maps natural results from the acting player's perspective", () => {
    expect(
      trainingReplayValueTargetForActor(
        { outcome: "natural", winner: "bob" },
        "alice"
      )
    ).toMatchObject({ result: "loss", value: -1 });
    expect(
      trainingReplayValueTargetForActor(
        { outcome: "natural", winner: null },
        "alice"
      )
    ).toMatchObject({ result: "draw", value: 0 });
  });

  it("builds fixed-shape observation and target batches", () => {
    const sample = buildTrainingReplaySample(
      { outcome: "natural", winner: "bob" },
      frame({ observation: observation() }),
      {
        gameId: "exp-1:game-0000",
        gameIndex: 0,
        seed: 7,
      }
    );

    const batch = buildEncodedTrainingReplayBatch([sample], {
      maxCards: 4,
      maxKnownDeckEntries: 2,
      maxChoices: 4,
    });

    expect(batch.schemaVersion).toBe(1);
    expect(batch.observations).toHaveLength(1);
    expect(batch.observations[0]?.cards).toHaveLength(4);
    expect(batch.observations[0]?.knownDeck).toHaveLength(2);
    expect(batch.choiceMask).toEqual([[1, 1, 0, 0]]);
    expect(batch.choiceFeatures[0]).toHaveLength(4);
    expect(batch.choiceFeatures[0]?.[0]).toHaveLength(TRAINING_CHOICE_FEAT_DIM);
    expect(batch.choiceActionKindIndices[0]).toHaveLength(4);
    expect(batch.policyTargets).toEqual([[0, 1, 0, 0]]);
    expect(batch.valueTargets).toEqual([-1]);
    expect(batch.policyWeights).toEqual([1]);
    expect(batch.valueWeights).toEqual([1]);
    expect(batch.metadata).toMatchObject({
      sampleCount: 1,
      maxCards: 4,
      maxKnownDeckEntries: 2,
      maxChoices: 4,
      policyUsableSampleCount: 1,
      valueUsableSampleCount: 1,
    });
  });
});
