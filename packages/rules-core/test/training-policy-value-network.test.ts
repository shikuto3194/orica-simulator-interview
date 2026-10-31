import { describe, expect, it } from "vitest";

import {
  AiWorkTelemetry,
  AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX,
  AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION,
  AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION,
  AI_OBSERVATION_ENCODER_SCHEMA_VERSION,
  AI_OBSERVATION_GLOBAL_PUBLIC_DISCLOSURE_HISTORY_INDEX,
  buildPolicyValueInferenceInput,
  createEmptyGameState,
  createTinyPolicyValueNetwork,
  evaluatePolicyValueBatch,
  trainPolicyValueBatch,
  PolicyCheckpointInputSchemaMismatchError,
  TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT,
  TRAINING_CHOICE_FEAT_DIM,
  type EncodedTrainingReplayBatch,
  type Engine,
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

function tokenBindings(
  input: ReturnType<typeof buildPolicyValueInferenceInput>
) {
  return {
    choiceSourceTokenIndices: input.choices.map(
      (choice) => choice.action.sourceTokenIndex
    ),
    choiceTargetTokenIndices: input.choices.map(
      (choice) => choice.action.targetTokenIndex
    ),
  };
}

function batchFromInput(
  input: ReturnType<typeof buildPolicyValueInferenceInput>
): EncodedTrainingReplayBatch {
  return {
    schemaVersion: 1,
    sampleSchemaVersion: 1,
    observationEncoderSchemaVersion: input.observation.schemaVersion,
    observations: [input.observation],
    choiceMask: [[...input.choiceMask]],
    choiceFeatures: [input.choices.map((choice) => choice.feats)],
    choiceActionKindIndices: [
      input.choices.map((choice) => choice.action.kindIndex),
    ],
    choiceSourceTokenIndices: [
      input.choices.map((choice) => choice.action.sourceTokenIndex),
    ],
    choiceTargetTokenIndices: [
      input.choices.map((choice) => choice.action.targetTokenIndex),
    ],
    policyTargets: [[0, 1]],
    valueTargets: [0.5],
    policyWeights: [1],
    valueWeights: [1],
    metadata: {
      sampleCount: 1,
      maxCards: input.observation.metadata.maxCards,
      maxKnownDeckEntries: input.observation.metadata.maxKnownDeckEntries,
      maxChoices: input.choices.length,
      cardVocabularySize: input.observation.metadata.cardVocabSize,
      policyUsableSampleCount: 1,
      valueUsableSampleCount: 1,
      choiceTruncatedByBatchCount: 0,
      samples: [
        {
          sampleId: "sample-1",
          gameId: "game-1",
          gameIndex: 0,
          seed: 1,
          frameIndex: 0,
          step: 0,
          nodeKind: "legal_action",
          choiceCount: input.choices.length,
          selectedChoiceIndex: 1,
          policyWeight: 1,
          valueWeight: 1,
        },
      ],
    },
  };
}

describe("tiny policy/value network", () => {
  it("keeps semantic choice features, logits and probabilities aligned when candidates are reordered", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const originalNode = node();
    const reorderedNode = {
      ...originalNode,
      // Delivery labels/IDs and enumeration order are not choice semantics.
      choices: [...originalNode.choices].reverse().map((choice, index) => ({
        ...choice,
        choiceId: `reordered-${index}`,
        label: `new display label ${index}`,
      })),
    };
    const inputFor = (decision: TrainingDecisionNode) =>
      buildPolicyValueInferenceInput({
        state,
        node: decision,
        engine,
        maxCards: 4,
        maxKnownDeckEntries: 2,
      });
    const original = inputFor(originalNode);
    const reordered = inputFor(reorderedNode);
    expect(reordered.choices.map((choice) => choice.feats)).toEqual(
      original.choices.map((choice) => choice.feats).reverse()
    );
    const probabilities = (logits: readonly number[]) => {
      const max = Math.max(...logits);
      const weights = logits.map((value) => Math.exp(value - max));
      const total = weights.reduce((sum, value) => sum + value, 0);
      return weights.map((value) => value / total);
    };
    const network = createTinyPolicyValueNetwork({ seed: 17, hiddenDim: 16 });
    const assertAligned = (predictor: typeof network) => {
      const expected = predictor.predict(original);
      const actual = predictor.predict(reordered);
      expect(actual.value).toBe(expected.value);
      expect(actual.policyLogits).toEqual([...expected.policyLogits].reverse());
      expect(probabilities(actual.policyLogits)).toEqual(
        probabilities(expected.policyLogits).reverse()
      );
      // A mask belongs to the semantic choice and must move with that choice.
      expect(
        predictor.predict({ ...reordered, choiceMask: [0, 1] }).policyLogits
      ).toEqual(
        [
          ...predictor.predict({ ...original, choiceMask: [1, 0] })
            .policyLogits,
        ].reverse()
      );
    };
    assertAligned(network);
    const training = network.trainBatch(batchFromInput(original), {
      epochs: 3,
    });
    expect(training.appliedUpdates).toBe(3);
    assertAligned(network);
    assertAligned(
      createTinyPolicyValueNetwork({ checkpoint: network.exportCheckpoint() })
    );
    expect(state).toEqual(
      createEmptyGameState({ playerIds: ["alice", "bob"] })
    );
  });

  it("rejects the former positional choice checkpoint instead of reinterpreting its weights", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    const network = createTinyPolicyValueNetwork({ seed: 17, hiddenDim: 8 });
    network.predict(input);
    const checkpoint = network.exportCheckpoint();
    const descriptor = JSON.parse(TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT);
    expect(
      descriptor.featureLayout.some(
        (feature: { id: string }) => feature.id === "choice_index"
      )
    ).toBe(false);
    descriptor.featureLayout.splice(-1, 0, {
      kind: "ratio",
      id: "choice_index",
      denominator: "choice_count_min_1",
    });
    const oldCheckpoint = structuredClone(checkpoint);
    oldCheckpoint.trainingChoiceFeatureSchemaFingerprint =
      JSON.stringify(descriptor);
    oldCheckpoint.params.dims.choiceDim++;
    oldCheckpoint.params.choiceW.forEach((row) => row.splice(-1, 0, 0.25));
    const preserved = structuredClone(oldCheckpoint);
    expect(() =>
      createTinyPolicyValueNetwork({ checkpoint: oldCheckpoint })
    ).toThrow(PolicyCheckpointInputSchemaMismatchError);
    expect(oldCheckpoint).toEqual(preserved);
    expect(() =>
      network.forward({
        observation: input.observation,
        ...tokenBindings(input),
        choiceFeatures: input.choices.map((choice) => {
          const oldFeatures = [...choice.feats];
          oldFeatures.splice(-1, 0, 0.5);
          return oldFeatures;
        }),
      })
    ).toThrow(
      `training choice feature dimension must be ${TRAINING_CHOICE_FEAT_DIM}`
    );
    expect(network.exportCheckpoint()).toEqual(checkpoint);
  });

  it("telemetry preserves inference and checkpoints and counts actual updates separately from batches", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    const batch = batchFromInput(input);
    const telemetry = new AiWorkTelemetry();
    const plain = createTinyPolicyValueNetwork({ seed: 41, hiddenDim: 8 });
    const measured = createTinyPolicyValueNetwork({
      seed: 41,
      hiddenDim: 8,
      telemetry,
    });
    expect(measured.predict(input)).toEqual(plain.predict(input));
    const result = measured.trainBatch(batch, { epochs: 2 });
    expect(result).toEqual(plain.trainBatch(batch, { epochs: 2 }));
    expect(measured.exportCheckpoint()).toEqual(plain.exportCheckpoint());
    const updates = telemetry
      .snapshot()
      .measurements.find((row) => row.operation === "training_update")!;
    expect(updates.returned).toBe(2);
    expect(updates.returned).toBe(result.appliedUpdates);
    expect(updates.returned).toBe(
      result.finalTrainingStep - result.initialTrainingStep
    );
    const noData = { ...batch, policyWeights: [0], valueWeights: [0] };
    expect(measured.trainBatch(noData, { epochs: 2 }).appliedUpdates).toBe(0);
    const rows = telemetry.snapshot().measurements;
    expect(
      rows.find((row) => row.operation === "training_update")!.returned
    ).toBe(updates.returned);
    expect(rows.find((row) => row.operation === "nn_training")!.returned).toBe(
      2
    );
    expect(
      rows.find((row) => row.operation === "nn_inference")!.returned
    ).toBeGreaterThan(1);
  });

  it.each([
    AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION,
    AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION,
  ] as const)(
    "adapts schema-v3 observations for schema-v%s checkpoints",
    (legacyVersion) => {
      const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
      state.publicDisclosures = [
        {
          id: "public-disclosure:1",
          sequence: 1,
          turnNumber: state.turnNumber,
          step: state.step,
          actorPlayerId: "alice",
          audience: "both",
          kind: "state_changed",
          targets: [],
          results: [],
        },
      ];
      state.publicDisclosures.push({
        ...state.publicDisclosures[0]!,
        id: "public-disclosure:2",
        sequence: 2,
      });
      const input = buildPolicyValueInferenceInput({
        state,
        node: node(),
        engine,
        maxCards: 4,
        maxKnownDeckEntries: 2,
      });
      const current = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 16 });
      current.forward({
        observation: input.observation,
        ...tokenBindings(input),
        choiceFeatures: input.choices.map((choice) => choice.feats),
        choiceMask: input.choiceMask,
      });
      const checkpoint = current.exportCheckpoint();
      const {
        observationEncoderSchemaVersion: _currentSchema,
        ...legacyCheckpoint
      } = checkpoint;
      const oldCheckpoint = {
        ...legacyCheckpoint,
        ...(legacyVersion === 2
          ? { observationEncoderSchemaVersion: legacyVersion }
          : {}),
        params: {
          ...legacyCheckpoint.params,
          dims: {
            ...legacyCheckpoint.params.dims,
            cardSetDim: legacyCheckpoint.params.dims.cardSetDim - 1,
          },
          sourceW: legacyCheckpoint.params.sourceW.map((row) =>
            row.filter(
              (_, index) => index !== AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX
            )
          ),
          targetW: legacyCheckpoint.params.targetW.map((row) =>
            row.filter(
              (_, index) => index !== AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX
            )
          ),
          cardW: legacyCheckpoint.params.cardW.map((row) =>
            row.filter(
              (_, index) => index !== AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX
            )
          ),
        },
      };
      const legacy = createTinyPolicyValueNetwork({
        checkpoint: oldCheckpoint,
      });
      const legacyObservation = {
        ...input.observation,
        schemaVersion: legacyVersion,
        global: [...input.observation.global],
        cards: input.observation.cards.map((card) => ({
          ...card,
          features: card.features.filter(
            (_, index) => index !== AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX
          ),
        })),
        metadata: {
          ...input.observation.metadata,
          cardFeatureDim: input.observation.metadata.cardFeatureDim - 1,
        },
      };
      legacyObservation.global[
        AI_OBSERVATION_GLOBAL_PUBLIC_DISCLOSURE_HISTORY_INDEX
      ] = legacyVersion === 1 ? 2 / 100 : 1;
      const forwardInput = {
        ...tokenBindings(input),
        choiceFeatures: input.choices.map((choice) => choice.feats),
        choiceMask: input.choiceMask,
      };

      expect(checkpoint.observationEncoderSchemaVersion).toBe(
        AI_OBSERVATION_ENCODER_SCHEMA_VERSION
      );
      expect(input.observation.metadata.publicDisclosureHistoryCount).toBe(2);
      expect(
        legacy.forward({ observation: input.observation, ...forwardInput })
      ).toEqual(
        legacy.forward({ observation: legacyObservation, ...forwardInput })
      );
      const overflowingObservation = {
        ...input.observation,
        metadata: {
          ...input.observation.metadata,
          publicDisclosureHistoryCount: 101,
        },
      };
      const clampedLegacyObservation = {
        ...legacyObservation,
        global: [...legacyObservation.global],
      };
      clampedLegacyObservation.global[
        AI_OBSERVATION_GLOBAL_PUBLIC_DISCLOSURE_HISTORY_INDEX
      ] = 1;
      expect(
        legacy.forward({ observation: overflowingObservation, ...forwardInput })
      ).toEqual(
        legacy.forward({
          observation: clampedLegacyObservation,
          ...forwardInput,
        })
      );
      expect(() =>
        current.forward({ observation: legacyObservation, ...forwardInput })
      ).toThrow(`does not support observation schema ${legacyVersion}`);
    }
  );

  it("produces deterministic finite logits and value estimates", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    expect(input.choices[0]?.feats).toHaveLength(TRAINING_CHOICE_FEAT_DIM);

    const first = createTinyPolicyValueNetwork({ seed: 17, hiddenDim: 16 });
    const second = createTinyPolicyValueNetwork({ seed: 17, hiddenDim: 16 });

    const firstForward = first.forward({
      observation: input.observation,
      ...tokenBindings(input),
      choiceFeatures: input.choices.map((choice) => choice.feats),
      choiceMask: input.choiceMask,
    });
    const secondForward = second.forward({
      observation: input.observation,
      ...tokenBindings(input),
      choiceFeatures: input.choices.map((choice) => choice.feats),
      choiceMask: input.choiceMask,
    });

    expect(firstForward.policyLogits).toHaveLength(2);
    expect(firstForward.policyLogits.every(Number.isFinite)).toBe(true);
    expect(firstForward.value).toBeGreaterThanOrEqual(-1);
    expect(firstForward.value).toBeLessThanOrEqual(1);
    expect(firstForward.policyLogits).toEqual(secondForward.policyLogits);
    expect(firstForward.value).toBe(secondForward.value);
  });

  it("evaluates a replay batch without mutating weights", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    const network = createTinyPolicyValueNetwork({ seed: 23, hiddenDim: 16 });

    const evaluation = evaluatePolicyValueBatch(network, batchFromInput(input));

    expect(evaluation.sampleCount).toBe(1);
    expect(evaluation.policyUsableSampleCount).toBe(1);
    expect(evaluation.valueUsableSampleCount).toBe(1);
    expect(Number.isFinite(evaluation.totalLoss)).toBe(true);
    expect(evaluation.policyAccuracy).toBeGreaterThanOrEqual(0);
    expect(evaluation.policyAccuracy).toBeLessThanOrEqual(1);
  });

  it("updates policy/value heads and round-trips a deterministic checkpoint", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    const batch = batchFromInput(input);
    const network = createTinyPolicyValueNetwork({ seed: 29, hiddenDim: 16 });
    const forwardInput = {
      observation: input.observation,
      ...tokenBindings(input),
      choiceFeatures: input.choices.map((choice) => choice.feats),
      choiceMask: input.choiceMask,
    };
    const before = network.forward(forwardInput);

    const training = trainPolicyValueBatch(network, batch, {
      learningRate: 0.01,
      epochs: 3,
      gradientClipNorm: 1,
    });
    const after = network.forward(forwardInput);
    const checkpoint = network.exportCheckpoint();
    const restored = createTinyPolicyValueNetwork({ checkpoint });

    expect(training.objective).toBe("self_play_actor_critic_heads");
    expect(training.appliedUpdates).toBe(3);
    expect(training.finalTrainingStep).toBe(3);
    expect(after.policyLogits).not.toEqual(before.policyLogits);
    expect(after.value).not.toBe(before.value);
    expect(checkpoint.trainingStep).toBe(3);
    expect(restored.forward(forwardInput)).toEqual(after);
  });

  it("rejects checkpoints whose training choice feature layout is unknown or changed", () => {
    const input = buildPolicyValueInferenceInput({
      state: createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node: node(),
      engine,
      maxCards: 4,
      maxKnownDeckEntries: 2,
    });
    const network = createTinyPolicyValueNetwork({ seed: 41, hiddenDim: 16 });
    network.forward({
      observation: input.observation,
      ...tokenBindings(input),
      choiceFeatures: input.choices.map((choice) => choice.feats),
      choiceMask: input.choiceMask,
    });
    const checkpoint = network.exportCheckpoint();
    const {
      trainingChoiceFeatureSchemaFingerprint: _fingerprint,
      ...legacyCheckpoint
    } = checkpoint;

    expect(checkpoint.trainingChoiceFeatureSchemaFingerprint).toBe(
      TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT
    );
    expect(() =>
      createTinyPolicyValueNetwork({ checkpoint: legacyCheckpoint })
    ).toThrow(PolicyCheckpointInputSchemaMismatchError);
    const changedNormalizationDescriptor = JSON.parse(
      TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT
    ) as {
      featureLayout: Array<{
        id: string;
        denominator?: number | string;
        values?: string[];
      }>;
    };
    const cost = changedNormalizationDescriptor.featureLayout.find(
      (feature) => feature.id === "cost"
    );
    if (!cost) throw new Error("cost feature must be present in the schema");
    cost.denominator = 13;
    expect(() =>
      createTinyPolicyValueNetwork({
        checkpoint: {
          ...checkpoint,
          trainingChoiceFeatureSchemaFingerprint: JSON.stringify(
            changedNormalizationDescriptor
          ),
        },
      })
    ).toThrow(PolicyCheckpointInputSchemaMismatchError);
    const changedPassKindDescriptor = JSON.parse(
      TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT
    ) as {
      featureLayout: Array<{
        id: string;
        values?: string[];
      }>;
    };
    const passKind = changedPassKindDescriptor.featureLayout.find(
      (feature) => feature.id === "is_pass_kind"
    );
    if (!passKind?.values?.length) {
      throw new Error("pass-kind membership must be present in the schema");
    }
    passKind.values = passKind.values.slice(1);
    expect(() =>
      createTinyPolicyValueNetwork({
        checkpoint: {
          ...checkpoint,
          trainingChoiceFeatureSchemaFingerprint: JSON.stringify(
            changedPassKindDescriptor
          ),
        },
      })
    ).toThrow(PolicyCheckpointInputSchemaMismatchError);
  });
});
