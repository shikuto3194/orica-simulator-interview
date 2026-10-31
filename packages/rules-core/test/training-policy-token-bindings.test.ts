import { describe, expect, it } from "vitest";
import {
  buildAiObservation,
  buildEncodedTrainingReplayBatch,
  buildPolicyValueInferenceInput,
  buildTrainingReplaySample,
  createCardInstance,
  createEmptyGameState,
  createTinyPolicyValueNetwork,
  type CardDefinition,
  type Engine,
  type TinyPolicyValueNetworkCheckpoint,
  type TrainingDecisionNode,
  type TrainingTraceSmokeFrame,
} from "../src";

const card: CardDefinition = {
  cardNo: "TOKEN-BINDING-SPIRIT",
  name: "Token binding spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 3, bp: 5000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
};
const engine: Engine = {
  cards: [card],
  getCardDefinitionById: (id) => (id === card.cardNo ? card : undefined),
  lookups: {} as Engine["lookups"],
};

function fixture() {
  const instances = [
    ["source-a", "alice", 1],
    ["source-b", "alice", 3],
    ["target-a", "bob", 1],
    ["target-b", "bob", 4],
  ] as const;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: instances.map(([instanceId, ownerPlayerId, cores]) =>
      createCardInstance(card, {
        instanceId,
        ownerPlayerId,
        cores,
        zone: "field",
      })
    ),
  });
  const node: TrainingDecisionNode = {
    nodeId: "token-bindings",
    kind: "legal_action",
    actingPlayerId: "alice",
    fields: [],
    choices: [
      ["source-a", "target-a"],
      ["source-b", "target-a"],
      ["source-a", "target-b"],
      ["source-b", "target-b"],
    ].map(([sourceInstanceId, targetInstanceId], index) => ({
      choiceId: `choice-${index}`,
      label: `choice ${index}`,
      action: {
        kind: "attack",
        actionId: `attack-${index}`,
        can: true,
        reason: "encoder fixture",
        actingPlayerId: "alice",
        sourceInstanceId: sourceInstanceId!,
        sourceDefinitionId: card.cardNo,
        sourceCardNo: card.cardNo,
        battleEntityId: sourceInstanceId!,
        targetInstanceId: targetInstanceId!,
      },
    })),
    truncated: false,
  };
  const inputFor = (decision = node, currentState = state) =>
    buildPolicyValueInferenceInput({
      state: currentState,
      node: decision,
      engine,
      maxCards: 8,
      maxKnownDeckEntries: 1,
    });
  const input = inputFor();
  const observation = buildAiObservation({
    state,
    viewpointPlayerId: "alice",
    mode: "player",
    getCardDefinitionById: engine.getCardDefinitionById,
  });
  const batchFor = (decision = node) => {
    const frame: TrainingTraceSmokeFrame = {
      frameIndex: 0,
      stateHash: "state",
      observationHash: "observation",
      state,
      observation,
      node: decision,
      selected: {
        step: 0,
        nodeKind: decision.kind,
        actingPlayerId: "alice",
        choiceId: node.choices[2]!.choiceId,
        choiceCount: 4,
        fields: [],
        truncated: false,
      },
    };
    return buildEncodedTrainingReplayBatch(
      [
        buildTrainingReplaySample(
          { outcome: "natural", winner: "alice" },
          frame,
          { gameId: "binding", gameIndex: 0, seed: 17 }
        ),
      ],
      { maxCards: 8, maxKnownDeckEntries: 1, maxChoices: 6 }
    );
  };
  return { state, node, input, inputFor, batchFor };
}

function forwardInput(
  input: ReturnType<typeof buildPolicyValueInferenceInput>
) {
  return {
    observation: input.observation,
    choiceFeatures: input.choices.map((choice) => choice.feats),
    choiceSourceTokenIndices: input.choices.map(
      (choice) => choice.action.sourceTokenIndex
    ),
    choiceTargetTokenIndices: input.choices.map(
      (choice) => choice.action.targetTokenIndex
    ),
    choiceMask: input.choiceMask,
  };
}

// Isolate the bound-card path: the unchanged average state pool and all flat
// choice features contribute zero. Only the referenced cards can change logits.
function controlledNetwork(
  input: ReturnType<typeof buildPolicyValueInferenceInput>
) {
  const network = createTinyPolicyValueNetwork({ seed: 17, hiddenDim: 4 });
  network.predict(input);
  const checkpoint = network.exportCheckpoint();
  const params = checkpoint.params;
  for (const matrix of [
    params.globalW,
    params.cardW,
    params.knownDeckW,
    params.choiceW,
    params.sourceW,
    params.targetW,
  ])
    matrix.forEach((row) => row.fill(0));
  for (const vector of [
    params.stateBias,
    params.choiceBias,
    params.policyHead,
    params.valueHead,
  ])
    vector.fill(0);
  params.policyBias = params.valueBias = 0;
  const features = (
    choiceIndex: number,
    role: "sourceTokenIndex" | "targetTokenIndex"
  ) =>
    input.observation.cards[input.choices[choiceIndex]!.action[role]]!.features;
  const sourceFeature = features(0, "sourceTokenIndex").findIndex(
    (value, index) => value !== features(1, "sourceTokenIndex")[index]
  );
  const targetFeature = features(0, "targetTokenIndex").findIndex(
    (value, index) => value !== features(2, "targetTokenIndex")[index]
  );
  expect(sourceFeature).toBeGreaterThanOrEqual(0);
  expect(targetFeature).toBeGreaterThanOrEqual(0);
  params.sourceW[0]![sourceFeature] = 1;
  params.targetW[1]![targetFeature] = 2;
  params.policyHead[0] = params.policyHead[1] = 1;
  return createTinyPolicyValueNetwork({ checkpoint });
}

describe("policy/value visible source and target bindings", () => {
  it("distinguishes same-feature actions by their actual source and target and preserves reorderings through replay, training and restore", () => {
    const { node, input, inputFor, batchFor } = fixture();
    expect(
      input.choices.every(
        (choice) =>
          JSON.stringify(choice.feats) ===
          JSON.stringify(input.choices[0]!.feats)
      )
    ).toBe(true);
    const network = controlledNetwork(input);
    const before = network.predict(input);
    expect(before.policyLogits[0]).not.toBe(before.policyLogits[1]);
    expect(before.policyLogits[0]).not.toBe(before.policyLogits[2]);
    const reordered = {
      ...node,
      choices: [...node.choices].reverse().map((choice, i) => ({
        ...choice,
        choiceId: `delivery-${i}`,
        label: "new label",
      })),
    };
    const reorderedInput = inputFor(reordered);
    const batch = batchFor();
    const replayInput = {
      observation: batch.observations[0]!,
      choiceFeatures: batch.choiceFeatures[0]!.slice(0, 4),
      choiceSourceTokenIndices: batch.choiceSourceTokenIndices[0]!.slice(0, 4),
      choiceTargetTokenIndices: batch.choiceTargetTokenIndices[0]!.slice(0, 4),
      choiceMask: batch.choiceMask[0]!.slice(0, 4),
    };
    expect(network.forward(replayInput).policyLogits).toEqual(
      before.policyLogits
    );
    const assertPermutation = () => {
      const original = network.predict(input);
      const actual = network.predict(reorderedInput);
      expect(actual.value).toBe(original.value);
      expect(actual.policyLogits).toEqual([...original.policyLogits].reverse());
      const probabilities = (logits: readonly number[]) => {
        const exps = logits.map(Math.exp);
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map((value) => value / sum);
      };
      probabilities(actual.policyLogits).forEach((p, i) =>
        expect(p).toBeCloseTo(
          probabilities(original.policyLogits).reverse()[i]!,
          14
        )
      );
    };
    assertPermutation();
    // Exact one-step head gradient checks training consumes the very same
    // source/target-conditioned embeddings as live inference and evaluation.
    const forward = network.forward(replayInput);
    const exps = forward.policyLogits.map(Math.exp);
    const sum = exps.reduce((a, b) => a + b, 0);
    const previous = network.exportCheckpoint();
    const expectedHead = previous.params.policyHead.map(
      (weight, hidden) =>
        weight -
        0.01 *
          exps.reduce(
            (gradient, value, choice) =>
              gradient +
              (value / sum - (choice === 2 ? 1 : 0)) *
                forward.choiceEmbeddings[choice]![hidden]!,
            0
          )
    );
    const training = network.trainBatch(batch, {
      learningRate: 0.01,
      gradientClipNorm: 100,
    });
    expect(training.appliedUpdates).toBe(1);
    network
      .exportCheckpoint()
      .params.policyHead.forEach((weight, i) =>
        expect(weight).toBeCloseTo(expectedHead[i]!, 14)
      );
    assertPermutation();
    const restored = createTinyPolicyValueNetwork({
      checkpoint: network.exportCheckpoint(),
    });
    expect(restored.predict(input)).toEqual(network.predict(input));
    expect(restored.predict(reorderedInput).policyLogits).toEqual(
      [...network.predict(input).policyLogits].reverse()
    );
    const reorderedBatch = batchFor({
      ...node,
      choices: [...node.choices].reverse(),
    });
    const twin = createTinyPolicyValueNetwork({ checkpoint: previous });
    twin.trainBatch(reorderedBatch, {
      learningRate: 0.01,
      gradientClipNorm: 100,
    });
    twin
      .predict(input)
      .policyLogits.forEach((logit, i) =>
        expect(logit).toBeCloseTo(network.predict(input).policyLogits[i]!, 14)
      );
  });

  it("uses encoded references consistently after token permutation and ignores secret state and renamed IDs", () => {
    const { input, inputFor, state } = fixture();
    const network = controlledNetwork(input);
    const expected = network.predict(input);
    const encoded = forwardInput(input);
    const permutation = input.observation.cards
      .map((_, index) => index)
      .reverse();
    const remap = (indices: readonly number[]) =>
      indices.map((index) => (index === -1 ? -1 : permutation.indexOf(index)));
    expect(
      network.forward({
        ...encoded,
        observation: {
          ...input.observation,
          cards: permutation.map((i) => input.observation.cards[i]!),
          cardMask: permutation.map((i) => input.observation.cardMask[i]!),
          cardInstanceIds: permutation.map(
            (i) => input.observation.cardInstanceIds[i]!
          ),
        },
        choiceSourceTokenIndices: remap(encoded.choiceSourceTokenIndices),
        choiceTargetTokenIndices: remap(encoded.choiceTargetTokenIndices),
      }).policyLogits
    ).toEqual(expected.policyLogits);
    const secretState = structuredClone(state);
    secretState.cardInstances.push(
      createCardInstance(card, {
        instanceId: "secret-hand-id",
        ownerPlayerId: "bob",
        zone: "hand",
      })
    );
    const first = inputFor(undefined, secretState);
    secretState.cardInstances.at(-1)!.instanceId = "different-secret-id";
    secretState.cardInstances.at(-1)!.definitionId =
      "unknown-secret-definition";
    const second = inputFor(undefined, secretState);
    expect(second).toEqual(first);
    expect(network.predict(second)).toEqual(network.predict(first));
    const renamed = structuredClone(input);
    renamed.observation.cards.forEach((token, index) => {
      if (token.instanceId) {
        token.instanceId = `renamed-${index}`;
        renamed.observation.cardInstanceIds[index] = token.instanceId;
      }
    });
    expect(network.predict(renamed)).toEqual(expected);
  });

  it("rejects missing, out-of-range, masked and non-finite bindings before modifying a checkpoint", () => {
    const { input } = fixture();
    const network = controlledNetwork(input);
    const checkpoint = network.exportCheckpoint();
    for (const index of [
      -2,
      0.5,
      NaN,
      999,
      input.observation.cards.length - 1,
    ]) {
      expect(() =>
        network.forward({
          ...forwardInput(input),
          choiceSourceTokenIndices: [index, -1, -1, -1],
        })
      ).toThrow("visible card");
    }
    expect(() =>
      network.forward({ ...forwardInput(input), choiceTargetTokenIndices: [] })
    ).toThrow("match choice count");
    for (const role of [
      "choiceSourceTokenIndices",
      "choiceTargetTokenIndices",
    ] as const) {
      expect(() =>
        network.forward({ ...forwardInput(input), [role]: new Array(4) })
      ).toThrow("visible card");
    }
    const broken = structuredClone(input);
    broken.observation.cards[
      broken.choices[0]!.action.sourceTokenIndex
    ]!.features[0] = Infinity;
    expect(() => network.predict(broken)).toThrow("non-finite");
    expect(network.exportCheckpoint()).toEqual(checkpoint);
  });

  it("rejects schema 1 checkpoints and malformed role weights while preserving their bytes", () => {
    const { input } = fixture();
    const checkpoint = controlledNetwork(input).exportCheckpoint();
    expect(checkpoint.schemaVersion).toBe(2);
    const legacy = {
      ...checkpoint,
      schemaVersion: 1,
    } as unknown as TinyPolicyValueNetworkCheckpoint;
    const saved = JSON.stringify(legacy);
    expect(() => createTinyPolicyValueNetwork({ checkpoint: legacy })).toThrow(
      "unsupported tiny policy/value checkpoint"
    );
    expect(JSON.stringify(legacy)).toBe(saved);
    const broken = structuredClone(checkpoint);
    broken.params.sourceW[0]!.pop();
    expect(() => createTinyPolicyValueNetwork({ checkpoint: broken })).toThrow(
      "sourceW shape"
    );
    broken.params.sourceW = checkpoint.params.sourceW;
    broken.params.targetW[0]![0] = NaN;
    expect(() => createTinyPolicyValueNetwork({ checkpoint: broken })).toThrow(
      "non-finite"
    );
  });
});
