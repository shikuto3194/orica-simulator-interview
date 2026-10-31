import { measureAiWork, type AiWorkTelemetry } from "./ai-work-telemetry";
import type {
  EncodedAiKnownDeckEntry,
  EncodedAiObservation,
} from "./ai-observation-encoder";
import {
  AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX,
  AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION,
  AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION,
  AI_OBSERVATION_ENCODER_SCHEMA_VERSION,
  AI_OBSERVATION_GLOBAL_PUBLIC_DISCLOSURE_HISTORY_INDEX,
  type AiObservationEncoderSchemaVersion,
} from "./ai-observation-encoder";
import type {
  EncodedTrainingReplayBatch,
  TrainingReplayBatchSampleMetadata,
} from "./training-replay-buffer";
import {
  TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT,
  TRAINING_CHOICE_FEAT_DIM,
} from "./training-action-encoder";
import type {
  PolicyValueInferenceInput,
  PolicyValuePrediction,
  PolicyValuePredictor,
} from "./training-policy-value";

export interface TinyPolicyValueNetworkOptions {
  telemetry?: AiWorkTelemetry;
  seed?: number;
  hiddenDim?: number;
  checkpoint?: TinyPolicyValueNetworkCheckpoint;
}

export interface TinyPolicyValueForwardInput {
  observation: EncodedAiObservation;
  choiceFeatures: readonly (readonly number[])[];
  choiceSourceTokenIndices: readonly number[];
  choiceTargetTokenIndices: readonly number[];
  choiceMask?: readonly number[];
}

export interface TinyPolicyValueForwardResult extends PolicyValuePrediction {
  stateEmbedding: readonly number[];
  choiceEmbeddings: readonly (readonly number[])[];
}

export interface PolicyValueBatchEvaluation {
  sampleCount: number;
  policyUsableSampleCount: number;
  valueUsableSampleCount: number;
  policyLoss: number;
  valueLoss: number;
  totalLoss: number;
  policyAccuracy: number;
  valueMse: number;
}

export interface PolicyValueBatchTrainingOptions {
  learningRate?: number;
  epochs?: number;
  gradientClipNorm?: number;
}

export interface PolicyValueBatchTrainingEpoch {
  epoch: number;
  actorPolicyLoss: number;
  valueLoss: number;
  policyGradientSampleCount: number;
  valueGradientSampleCount: number;
  gradientNorm: number;
  appliedGradientNorm: number;
  clipped: boolean;
  updated: boolean;
}

export interface PolicyValueBatchTrainingResult {
  objective: "self_play_actor_critic_heads";
  learningRate: number;
  requestedEpochs: number;
  appliedUpdates: number;
  initialTrainingStep: number;
  finalTrainingStep: number;
  gradientClipNorm: number;
  initialEvaluation: PolicyValueBatchEvaluation;
  finalEvaluation: PolicyValueBatchEvaluation;
  epochs: PolicyValueBatchTrainingEpoch[];
}

export interface TinyPolicyValueNetworkParams {
  globalW: number[][];
  cardW: number[][];
  knownDeckW: number[][];
  stateBias: number[];
  choiceW: number[][];
  sourceW: number[][];
  targetW: number[][];
  choiceBias: number[];
  policyHead: number[];
  policyBias: number;
  valueHead: number[];
  valueBias: number;
  dims: {
    globalDim: number;
    cardSetDim: number;
    knownDeckSetDim: number;
    choiceDim: number;
    hiddenDim: number;
  };
}

export interface TinyPolicyValueNetworkCheckpoint {
  schemaVersion: 2;
  kind: "tiny-deepsets-policy-value";
  seed: number;
  hiddenDim: number;
  trainingStep: number;
  /** Missing means schema v1, for checkpoints written before this marker. */
  observationEncoderSchemaVersion?: AiObservationEncoderSchemaVersion;
  /**
   * Exact training choice-vector layout used to train `choiceW`.
   * Missing checkpoints predate this compatibility marker and cannot be
   * resumed safely.
   */
  trainingChoiceFeatureSchemaFingerprint?: string;
  params: TinyPolicyValueNetworkParams;
}

const DEFAULT_LEARNING_RATE = 0.001;
const DEFAULT_TRAINING_EPOCHS = 1;
const DEFAULT_GRADIENT_CLIP_NORM = 5;

export class PolicyCheckpointInputSchemaMismatchError extends Error {
  readonly code = "policy_checkpoint_input_schema_mismatch";

  constructor(args: {
    checkpointFingerprint?: string | undefined;
    checkpointChoiceDim: number;
  }) {
    super(
      "policy checkpoint training choice feature schema is incompatible: " +
        JSON.stringify({
          checkpointFingerprint: args.checkpointFingerprint ?? null,
          checkpointChoiceDim: args.checkpointChoiceDim,
          currentFingerprint: TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT,
          currentChoiceDim: TRAINING_CHOICE_FEAT_DIM,
        })
    );
    this.name = "PolicyCheckpointInputSchemaMismatchError";
  }
}

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMatrix(
  rows: number,
  cols: number,
  rng: () => number,
  scale: number
): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (rng() * 2 - 1) * scale)
  );
}

function randomVector(
  length: number,
  rng: () => number,
  scale: number
): number[] {
  return Array.from({ length }, () => (rng() * 2 - 1) * scale);
}

function dot(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index++) {
    sum += left[index]! * right[index]!;
  }
  return sum;
}

function addMatVec(
  target: number[],
  matrix: readonly (readonly number[])[],
  vector: readonly number[]
): void {
  for (let row = 0; row < target.length; row++) {
    target[row] = (target[row] ?? 0) + dot(matrix[row] ?? [], vector);
  }
}

function tanhVector(values: readonly number[]): number[] {
  return values.map((value) => Math.tanh(value));
}

function assertFiniteVector(name: string, values: readonly number[]): void {
  const badIndex = values.findIndex((value) => !Number.isFinite(value));
  if (badIndex >= 0) {
    throw new Error(`${name} contains non-finite value at index ${badIndex}`);
  }
}

function cardEmbeddingRatio(
  embIndex: number,
  observation: EncodedAiObservation
): number {
  return observation.metadata.cardVocabSize <= 1
    ? 0
    : embIndex / (observation.metadata.cardVocabSize - 1);
}

function meanMaskedRows<T extends { mask: 0 | 1; embIndex: number }>(
  rows: readonly T[],
  observation: EncodedAiObservation,
  featureOf: (row: T) => readonly number[]
): number[] {
  const first = rows.find((row) => row.mask === 1) ?? rows[0];
  const featureDim = first ? featureOf(first).length + 1 : 1;
  const sums = new Array(featureDim).fill(0);
  let count = 0;
  for (const row of rows) {
    if (row.mask !== 1) continue;
    const features = featureOf(row);
    for (let index = 0; index < features.length; index++) {
      sums[index] += features[index]!;
    }
    sums[featureDim - 1] += cardEmbeddingRatio(row.embIndex, observation);
    count += 1;
  }
  if (count === 0) return sums;
  return sums.map((value) => value / count);
}

function knownDeckFeatures(row: EncodedAiKnownDeckEntry): readonly number[] {
  return row.features;
}

// Resolve only into the encoded observation. Never look up a raw state or an
// instance ID supplied by a choice. A missing binding is the explicit -1 value;
// malformed or truncated bindings must not silently become an absent card.
function boundCardFeatures(
  observation: EncodedAiObservation,
  indices: readonly number[],
  choiceCount: number
): (number[] | null)[] {
  if (!Array.isArray(indices) || indices.length !== choiceCount)
    throw new Error("choice token bindings must match choice count");
  return Array.from(indices, (index) => {
    if (index === -1) return null;
    const card = observation.cards[index];
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !card ||
      card.mask !== 1 ||
      observation.cardMask[index] !== 1 ||
      !observation.cardInstanceIds[index] ||
      observation.cardInstanceIds[index] !== card.instanceId ||
      card.features.length !== observation.metadata.cardFeatureDim ||
      !Number.isSafeInteger(card.embIndex) ||
      card.embIndex < 0 ||
      card.embIndex >= observation.metadata.cardVocabSize
    )
      throw new Error("choice token binding must reference a visible card");
    const features = [
      ...card.features,
      cardEmbeddingRatio(card.embIndex, observation),
    ];
    assertFiniteVector("bound card features", features);
    return features;
  });
}

function maskedLogits(
  logits: readonly number[],
  mask: readonly number[] | undefined
): number[] {
  return logits.map((logit, index) =>
    mask?.[index] === 0 ? Number.NEGATIVE_INFINITY : logit
  );
}

function softmax(logits: readonly number[]): number[] {
  const finite = logits.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return logits.map(() => 0);
  const max = Math.max(...finite);
  const exps = logits.map((value) =>
    Number.isFinite(value) ? Math.exp(value - max) : 0
  );
  const total = exps.reduce((sum, value) => sum + value, 0);
  return total <= 0 ? logits.map(() => 0) : exps.map((value) => value / total);
}

function argMax(values: readonly number[]): number {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function selectedTargetIndex(target: readonly number[]): number {
  return argMax(target);
}

function targetChoiceCount(
  sample: TrainingReplayBatchSampleMetadata | undefined,
  mask: readonly number[]
): number {
  if (sample) return sample.choiceCount;
  return mask.filter((value) => value !== 0).length;
}

function cloneMatrix(values: readonly (readonly number[])[]): number[][] {
  return values.map((row) => [...row]);
}

function cloneParams(
  params: TinyPolicyValueNetworkParams
): TinyPolicyValueNetworkParams {
  return {
    globalW: cloneMatrix(params.globalW),
    cardW: cloneMatrix(params.cardW),
    knownDeckW: cloneMatrix(params.knownDeckW),
    stateBias: [...params.stateBias],
    choiceW: cloneMatrix(params.choiceW),
    sourceW: cloneMatrix(params.sourceW),
    targetW: cloneMatrix(params.targetW),
    choiceBias: [...params.choiceBias],
    policyHead: [...params.policyHead],
    policyBias: params.policyBias,
    valueHead: [...params.valueHead],
    valueBias: params.valueBias,
    dims: { ...params.dims },
  };
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(name + " must be a positive finite number");
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(name + " must be a positive integer");
  }
}

function assertCheckpointShape(
  checkpoint: TinyPolicyValueNetworkCheckpoint
): void {
  if (
    checkpoint.schemaVersion !== 2 ||
    checkpoint.kind !== "tiny-deepsets-policy-value"
  ) {
    throw new Error("unsupported tiny policy/value checkpoint");
  }
  const encoderSchemaVersion =
    checkpoint.observationEncoderSchemaVersion ??
    AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION;
  if (
    encoderSchemaVersion !== AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION &&
    encoderSchemaVersion !== AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION &&
    encoderSchemaVersion !== AI_OBSERVATION_ENCODER_SCHEMA_VERSION
  ) {
    throw new Error("unsupported checkpoint observation encoder schema");
  }
  if (
    checkpoint.trainingChoiceFeatureSchemaFingerprint !==
      TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT ||
    checkpoint.params.dims.choiceDim !== TRAINING_CHOICE_FEAT_DIM
  ) {
    throw new PolicyCheckpointInputSchemaMismatchError({
      checkpointFingerprint: checkpoint.trainingChoiceFeatureSchemaFingerprint,
      checkpointChoiceDim: checkpoint.params.dims.choiceDim,
    });
  }
  assertPositiveInteger("checkpoint.hiddenDim", checkpoint.hiddenDim);
  if (
    !Number.isInteger(checkpoint.trainingStep) ||
    checkpoint.trainingStep < 0
  ) {
    throw new Error("checkpoint.trainingStep must be a non-negative integer");
  }
  const { params } = checkpoint;
  if (params.dims.hiddenDim !== checkpoint.hiddenDim) {
    throw new Error("checkpoint hiddenDim does not match parameter dims");
  }
  const matrices: Array<
    [string, readonly (readonly number[])[], number, number]
  > = [
    ["globalW", params.globalW, checkpoint.hiddenDim, params.dims.globalDim],
    ["cardW", params.cardW, checkpoint.hiddenDim, params.dims.cardSetDim],
    [
      "knownDeckW",
      params.knownDeckW,
      checkpoint.hiddenDim,
      params.dims.knownDeckSetDim,
    ],
    ["choiceW", params.choiceW, checkpoint.hiddenDim, params.dims.choiceDim],
    ["sourceW", params.sourceW, checkpoint.hiddenDim, params.dims.cardSetDim],
    ["targetW", params.targetW, checkpoint.hiddenDim, params.dims.cardSetDim],
  ];
  for (const [name, matrix, rows, columns] of matrices) {
    if (
      matrix.length !== rows ||
      matrix.some((row) => row.length !== columns)
    ) {
      throw new Error("checkpoint " + name + " shape is invalid");
    }
    for (const row of matrix) {
      assertFiniteVector("checkpoint." + name, row);
    }
  }
  const vectors: Array<[string, readonly number[]]> = [
    ["stateBias", params.stateBias],
    ["choiceBias", params.choiceBias],
    ["policyHead", params.policyHead],
    ["valueHead", params.valueHead],
  ];
  for (const [name, vector] of vectors) {
    if (vector.length !== checkpoint.hiddenDim) {
      throw new Error("checkpoint " + name + " shape is invalid");
    }
    assertFiniteVector("checkpoint." + name, vector);
  }
  if (
    !Number.isFinite(params.policyBias) ||
    !Number.isFinite(params.valueBias)
  ) {
    throw new Error("checkpoint bias must be finite");
  }
}

function adaptObservationForCheckpoint(
  observation: EncodedAiObservation,
  checkpointEncoderSchemaVersion: AiObservationEncoderSchemaVersion
): EncodedAiObservation {
  if (observation.schemaVersion === checkpointEncoderSchemaVersion) {
    return observation;
  }
  if (
    (observation.schemaVersion === AI_OBSERVATION_ENCODER_SCHEMA_VERSION ||
      observation.schemaVersion ===
        AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION) &&
    observation.schemaVersion > checkpointEncoderSchemaVersion
  ) {
    const global = [...observation.global];
    if (
      checkpointEncoderSchemaVersion ===
      AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION
    ) {
      global[AI_OBSERVATION_GLOBAL_PUBLIC_DISCLOSURE_HISTORY_INDEX] = Math.max(
        0,
        Math.min(1, observation.metadata.publicDisclosureHistoryCount / 100)
      );
    }
    const removeTokenPoolBit =
      observation.schemaVersion === AI_OBSERVATION_ENCODER_SCHEMA_VERSION;
    return {
      ...observation,
      schemaVersion: checkpointEncoderSchemaVersion,
      global,
      cards: removeTokenPoolBit
        ? observation.cards.map((card) => ({
            ...card,
            features: card.features.filter(
              (_, index) => index !== AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX
            ),
          }))
        : observation.cards,
      metadata: {
        ...observation.metadata,
        cardFeatureDim:
          observation.metadata.cardFeatureDim - (removeTokenPoolBit ? 1 : 0),
      },
    };
  }
  throw new Error(
    `checkpoint encoder schema ${checkpointEncoderSchemaVersion} does not support observation schema ${observation.schemaVersion}`
  );
}

function vectorNorm(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function combinedHeadGradientNorm(
  policyHead: readonly number[],
  policyBias: number,
  valueHead: readonly number[],
  valueBias: number
): number {
  const policyNorm = vectorNorm(policyHead);
  const valueNorm = vectorNorm(valueHead);
  return Math.sqrt(
    policyNorm * policyNorm +
      policyBias * policyBias +
      valueNorm * valueNorm +
      valueBias * valueBias
  );
}

function scaleVector(values: number[], scale: number): void {
  for (let index = 0; index < values.length; index++) {
    values[index]! *= scale;
  }
}

export class TinyPolicyValueNetwork implements PolicyValuePredictor {
  private readonly telemetry: AiWorkTelemetry | undefined;
  private readonly seed: number;
  private readonly hiddenDim: number;
  private readonly observationEncoderSchemaVersion: AiObservationEncoderSchemaVersion;
  private params: TinyPolicyValueNetworkParams | null = null;
  private trainingStep = 0;

  constructor(options: TinyPolicyValueNetworkOptions = {}) {
    this.telemetry = options.telemetry;
    if (options.checkpoint) {
      assertCheckpointShape(options.checkpoint);
      if (
        options.seed !== undefined &&
        options.seed !== options.checkpoint.seed
      ) {
        throw new Error("seed does not match checkpoint");
      }
      if (
        options.hiddenDim !== undefined &&
        options.hiddenDim !== options.checkpoint.hiddenDim
      ) {
        throw new Error("hiddenDim does not match checkpoint");
      }
      this.seed = options.checkpoint.seed;
      this.hiddenDim = options.checkpoint.hiddenDim;
      this.observationEncoderSchemaVersion =
        options.checkpoint.observationEncoderSchemaVersion ??
        AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION;
      this.params = cloneParams(options.checkpoint.params);
      this.trainingStep = options.checkpoint.trainingStep;
      return;
    }
    this.seed = options.seed ?? 1;
    this.hiddenDim = options.hiddenDim ?? 64;
    this.observationEncoderSchemaVersion =
      AI_OBSERVATION_ENCODER_SCHEMA_VERSION;
  }

  predict(input: PolicyValueInferenceInput): PolicyValuePrediction {
    const result = this.forward({
      observation: input.observation,
      choiceFeatures: input.choices.map((choice) => choice.feats),
      choiceSourceTokenIndices: input.choices.map(
        (choice) => choice.action.sourceTokenIndex
      ),
      choiceTargetTokenIndices: input.choices.map(
        (choice) => choice.action.targetTokenIndex
      ),
      choiceMask: input.choiceMask,
    });
    return {
      policyLogits: result.policyLogits,
      value: result.value,
    };
  }

  forward(input: TinyPolicyValueForwardInput): TinyPolicyValueForwardResult {
    return measureAiWork(this.telemetry, "nn_inference", () =>
      this.forwardInner(input)
    );
  }

  private forwardInner(
    input: TinyPolicyValueForwardInput
  ): TinyPolicyValueForwardResult {
    const normalizedInput = {
      ...input,
      observation: adaptObservationForCheckpoint(
        input.observation,
        this.observationEncoderSchemaVersion
      ),
    };
    const sources = boundCardFeatures(
      normalizedInput.observation,
      normalizedInput.choiceSourceTokenIndices,
      normalizedInput.choiceFeatures.length
    );
    const targets = boundCardFeatures(
      normalizedInput.observation,
      normalizedInput.choiceTargetTokenIndices,
      normalizedInput.choiceFeatures.length
    );
    const params = this.ensureParams(normalizedInput);
    const cardPool = meanMaskedRows(
      normalizedInput.observation.cards,
      normalizedInput.observation,
      (card) => card.features
    );
    const knownDeckPool = meanMaskedRows(
      normalizedInput.observation.knownDeck,
      normalizedInput.observation,
      knownDeckFeatures
    );

    const statePre = [...params.stateBias];
    addMatVec(statePre, params.globalW, normalizedInput.observation.global);
    addMatVec(statePre, params.cardW, cardPool);
    addMatVec(statePre, params.knownDeckW, knownDeckPool);
    const stateEmbedding = tanhVector(statePre);
    assertFiniteVector("stateEmbedding", stateEmbedding);

    const choiceEmbeddings = normalizedInput.choiceFeatures.map(
      (choiceFeatures, index) => {
        const choicePre = params.choiceBias.map(
          (bias, index) => bias + stateEmbedding[index]!
        );
        addMatVec(choicePre, params.choiceW, choiceFeatures);
        if (sources[index])
          addMatVec(choicePre, params.sourceW, sources[index]!);
        if (targets[index])
          addMatVec(choicePre, params.targetW, targets[index]!);
        const choiceEmbedding = tanhVector(choicePre);
        assertFiniteVector("choiceEmbedding", choiceEmbedding);
        return choiceEmbedding;
      }
    );
    const rawLogits = choiceEmbeddings.map(
      (embedding) => dot(params.policyHead, embedding) + params.policyBias
    );
    const policyLogits = maskedLogits(rawLogits, normalizedInput.choiceMask);
    assertFiniteVector(
      "policyLogits",
      policyLogits.filter((value) => Number.isFinite(value))
    );

    const value = Math.tanh(
      dot(params.valueHead, stateEmbedding) + params.valueBias
    );
    if (!Number.isFinite(value)) {
      throw new Error("value must be finite");
    }

    return {
      policyLogits,
      value,
      stateEmbedding,
      choiceEmbeddings,
    };
  }

  exportCheckpoint(): TinyPolicyValueNetworkCheckpoint {
    if (!this.params) {
      throw new Error("cannot export an uninitialized policy/value network");
    }
    return {
      schemaVersion: 2,
      kind: "tiny-deepsets-policy-value",
      seed: this.seed,
      hiddenDim: this.hiddenDim,
      trainingStep: this.trainingStep,
      observationEncoderSchemaVersion: this.observationEncoderSchemaVersion,
      trainingChoiceFeatureSchemaFingerprint:
        TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT,
      params: cloneParams(this.params),
    };
  }

  trainBatch(
    batch: EncodedTrainingReplayBatch,
    options: PolicyValueBatchTrainingOptions = {}
  ): PolicyValueBatchTrainingResult {
    return measureAiWork(this.telemetry, "nn_training", () =>
      this.trainBatchInner(batch, options)
    );
  }

  private trainBatchInner(
    batch: EncodedTrainingReplayBatch,
    options: PolicyValueBatchTrainingOptions = {}
  ): PolicyValueBatchTrainingResult {
    const learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;
    const epochs = options.epochs ?? DEFAULT_TRAINING_EPOCHS;
    const gradientClipNorm =
      options.gradientClipNorm ?? DEFAULT_GRADIENT_CLIP_NORM;
    assertPositiveFinite("learningRate", learningRate);
    assertPositiveInteger("epochs", epochs);
    assertPositiveFinite("gradientClipNorm", gradientClipNorm);
    if (batch.observations.length === 0) {
      throw new Error("training batch must contain at least one sample");
    }

    const initialEvaluation = evaluatePolicyValueBatch(this, batch);
    const initialTrainingStep = this.trainingStep;
    const history: PolicyValueBatchTrainingEpoch[] = [];
    let appliedUpdates = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let policyWeightSum = 0;
      let valueWeightSum = 0;
      for (let index = 0; index < batch.observations.length; index++) {
        const valueWeight = batch.valueWeights[index] ?? 0;
        if (valueWeight <= 0) continue;
        policyWeightSum += batch.policyWeights[index] ?? 0;
        valueWeightSum += valueWeight;
      }

      let params: TinyPolicyValueNetworkParams | null = null;
      let policyHeadGradient: number[] = [];
      let valueHeadGradient: number[] = [];
      let policyBiasGradient = 0;
      let valueBiasGradient = 0;
      let actorPolicyLoss = 0;
      let valueLoss = 0;
      let policyGradientSampleCount = 0;
      let valueGradientSampleCount = 0;

      for (let index = 0; index < batch.observations.length; index++) {
        const observation = batch.observations[index]!;
        const choiceMask = batch.choiceMask[index] ?? [];
        const choiceCount = targetChoiceCount(
          batch.metadata.samples[index],
          choiceMask
        );
        const choiceFeatures = (batch.choiceFeatures[index] ?? []).slice(
          0,
          choiceCount
        );
        const forward = this.forward({
          observation,
          choiceFeatures,
          choiceSourceTokenIndices: batch.choiceSourceTokenIndices[
            index
          ]!.slice(0, choiceCount),
          choiceTargetTokenIndices: batch.choiceTargetTokenIndices[
            index
          ]!.slice(0, choiceCount),
          choiceMask: choiceMask.slice(0, choiceCount),
        });
        params = this.params;
        if (!params) {
          throw new Error("policy/value parameters were not initialized");
        }
        if (policyHeadGradient.length === 0) {
          policyHeadGradient = params.policyHead.map(() => 0);
          valueHeadGradient = params.valueHead.map(() => 0);
        }

        const probabilities = softmax(forward.policyLogits);
        const policyTarget = (batch.policyTargets[index] ?? []).slice(
          0,
          choiceCount
        );
        const policyWeight = batch.policyWeights[index] ?? 0;
        const valueWeight = batch.valueWeights[index] ?? 0;
        const targetValue = batch.valueTargets[index] ?? 0;
        const choiceEmbeddings = forward.choiceEmbeddings;

        if (policyWeight > 0 && valueWeight > 0 && policyWeightSum > 0) {
          const advantage = targetValue - forward.value;
          let crossEntropy = 0;
          for (let choiceIndex = 0; choiceIndex < choiceCount; choiceIndex++) {
            const target = policyTarget[choiceIndex] ?? 0;
            if (target > 0) {
              crossEntropy -=
                target *
                Math.log(Math.max(1e-12, probabilities[choiceIndex] ?? 0));
            }
          }
          actorPolicyLoss +=
            (policyWeight / policyWeightSum) * advantage * crossEntropy;
          policyGradientSampleCount += 1;
          const coefficient = (policyWeight / policyWeightSum) * advantage;
          for (let choiceIndex = 0; choiceIndex < choiceCount; choiceIndex++) {
            const logitGradient =
              coefficient *
              ((probabilities[choiceIndex] ?? 0) -
                (policyTarget[choiceIndex] ?? 0));
            const choiceEmbedding = choiceEmbeddings[choiceIndex] ?? [];
            for (
              let hiddenIndex = 0;
              hiddenIndex < params.dims.hiddenDim;
              hiddenIndex++
            ) {
              policyHeadGradient[hiddenIndex]! +=
                logitGradient * (choiceEmbedding[hiddenIndex] ?? 0);
            }
            policyBiasGradient += logitGradient;
          }
        }

        if (valueWeight > 0 && valueWeightSum > 0) {
          const diff = forward.value - targetValue;
          valueLoss += (valueWeight / valueWeightSum) * diff * diff;
          valueGradientSampleCount += 1;
          const valuePreGradient =
            (valueWeight / valueWeightSum) *
            2 *
            diff *
            (1 - forward.value * forward.value);
          for (
            let hiddenIndex = 0;
            hiddenIndex < params.dims.hiddenDim;
            hiddenIndex++
          ) {
            valueHeadGradient[hiddenIndex]! +=
              valuePreGradient * (forward.stateEmbedding[hiddenIndex] ?? 0);
          }
          valueBiasGradient += valuePreGradient;
        }
      }

      if (!params) {
        throw new Error("training batch did not initialize network parameters");
      }
      const rawGradientNorm = combinedHeadGradientNorm(
        policyHeadGradient,
        policyBiasGradient,
        valueHeadGradient,
        valueBiasGradient
      );
      const clipped = rawGradientNorm > gradientClipNorm;
      if (clipped) {
        const scale = gradientClipNorm / rawGradientNorm;
        scaleVector(policyHeadGradient, scale);
        scaleVector(valueHeadGradient, scale);
        policyBiasGradient *= scale;
        valueBiasGradient *= scale;
      }
      const appliedGradientNorm = combinedHeadGradientNorm(
        policyHeadGradient,
        policyBiasGradient,
        valueHeadGradient,
        valueBiasGradient
      );
      const updated = appliedGradientNorm > 0;
      if (updated) {
        measureAiWork(this.telemetry, "training_update", () => {
          for (let index = 0; index < params.policyHead.length; index++) {
            params.policyHead[index]! -=
              learningRate * (policyHeadGradient[index] ?? 0);
            params.valueHead[index]! -=
              learningRate * (valueHeadGradient[index] ?? 0);
          }
          params.policyBias -= learningRate * policyBiasGradient;
          params.valueBias -= learningRate * valueBiasGradient;
        });
        this.trainingStep += 1;
        appliedUpdates += 1;
      }
      history.push({
        epoch: epoch + 1,
        actorPolicyLoss,
        valueLoss,
        policyGradientSampleCount,
        valueGradientSampleCount,
        gradientNorm: rawGradientNorm,
        appliedGradientNorm,
        clipped,
        updated,
      });
    }

    return {
      objective: "self_play_actor_critic_heads",
      learningRate,
      requestedEpochs: epochs,
      appliedUpdates,
      initialTrainingStep,
      finalTrainingStep: this.trainingStep,
      gradientClipNorm,
      initialEvaluation,
      finalEvaluation: evaluatePolicyValueBatch(this, batch),
      epochs: history,
    };
  }

  private ensureParams(
    input: TinyPolicyValueForwardInput
  ): TinyPolicyValueNetworkParams {
    const cardSetDim = input.observation.metadata.cardFeatureDim + 1;
    const knownDeckSetDim = input.observation.metadata.knownDeckFeatureDim + 1;
    const choiceDim = input.choiceFeatures[0]?.length ?? 0;
    if (
      choiceDim !== TRAINING_CHOICE_FEAT_DIM ||
      input.choiceFeatures.some(
        (choiceFeatures) => choiceFeatures.length !== TRAINING_CHOICE_FEAT_DIM
      )
    ) {
      throw new Error(
        `training choice feature dimension must be ${TRAINING_CHOICE_FEAT_DIM}`
      );
    }
    const dims = {
      globalDim: input.observation.metadata.globalDim,
      cardSetDim,
      knownDeckSetDim,
      choiceDim,
      hiddenDim: this.hiddenDim,
    };

    if (this.params) {
      const existing = this.params.dims;
      if (
        existing.globalDim !== dims.globalDim ||
        existing.cardSetDim !== dims.cardSetDim ||
        existing.knownDeckSetDim !== dims.knownDeckSetDim ||
        existing.choiceDim !== dims.choiceDim ||
        existing.hiddenDim !== dims.hiddenDim
      ) {
        throw new Error(
          `TinyPolicyValueNetwork input dims changed: ${JSON.stringify({ existing, next: dims })}`
        );
      }
      return this.params;
    }

    const rng = seededRng(this.seed);
    const scale = 1 / Math.sqrt(Math.max(1, dims.hiddenDim));
    this.params = {
      globalW: randomMatrix(dims.hiddenDim, dims.globalDim, rng, scale),
      cardW: randomMatrix(dims.hiddenDim, dims.cardSetDim, rng, scale),
      knownDeckW: randomMatrix(
        dims.hiddenDim,
        dims.knownDeckSetDim,
        rng,
        scale
      ),
      stateBias: randomVector(dims.hiddenDim, rng, scale),
      choiceW: randomMatrix(dims.hiddenDim, dims.choiceDim, rng, scale),
      sourceW: randomMatrix(dims.hiddenDim, dims.cardSetDim, rng, scale),
      targetW: randomMatrix(dims.hiddenDim, dims.cardSetDim, rng, scale),
      choiceBias: randomVector(dims.hiddenDim, rng, scale),
      policyHead: randomVector(dims.hiddenDim, rng, scale),
      policyBias: (rng() * 2 - 1) * scale,
      valueHead: randomVector(dims.hiddenDim, rng, scale),
      valueBias: (rng() * 2 - 1) * scale,
      dims,
    };
    return this.params;
  }
}

export function createTinyPolicyValueNetwork(
  options: TinyPolicyValueNetworkOptions = {}
): TinyPolicyValueNetwork {
  return new TinyPolicyValueNetwork(options);
}

export function trainPolicyValueBatch(
  network: TinyPolicyValueNetwork,
  batch: EncodedTrainingReplayBatch,
  options: PolicyValueBatchTrainingOptions = {}
): PolicyValueBatchTrainingResult {
  return network.trainBatch(batch, options);
}

export function evaluatePolicyValueBatch(
  network: TinyPolicyValueNetwork,
  batch: EncodedTrainingReplayBatch
): PolicyValueBatchEvaluation {
  let policyLossSum = 0;
  let policyWeightSum = 0;
  let policyCorrect = 0;
  let policyCount = 0;
  let valueLossSum = 0;
  let valueWeightSum = 0;

  for (let index = 0; index < batch.observations.length; index++) {
    const observation = batch.observations[index]!;
    const choiceMask = batch.choiceMask[index] ?? [];
    const choiceCount = targetChoiceCount(
      batch.metadata.samples[index],
      choiceMask
    );
    const forward = network.forward({
      observation,
      choiceFeatures: (batch.choiceFeatures[index] ?? []).slice(0, choiceCount),
      choiceSourceTokenIndices: batch.choiceSourceTokenIndices[index]!.slice(
        0,
        choiceCount
      ),
      choiceTargetTokenIndices: batch.choiceTargetTokenIndices[index]!.slice(
        0,
        choiceCount
      ),
      choiceMask: choiceMask.slice(0, choiceCount),
    });
    const probabilities = softmax(forward.policyLogits);
    const policyWeight = batch.policyWeights[index] ?? 0;
    const policyTarget = (batch.policyTargets[index] ?? []).slice(
      0,
      choiceCount
    );
    if (policyWeight > 0) {
      let sampleLoss = 0;
      for (let choiceIndex = 0; choiceIndex < choiceCount; choiceIndex++) {
        const target = policyTarget[choiceIndex] ?? 0;
        if (target <= 0) continue;
        sampleLoss -=
          target * Math.log(Math.max(1e-12, probabilities[choiceIndex] ?? 0));
      }
      policyLossSum += sampleLoss * policyWeight;
      policyWeightSum += policyWeight;
      policyCount += 1;
      if (argMax(forward.policyLogits) === selectedTargetIndex(policyTarget)) {
        policyCorrect += 1;
      }
    }

    const valueWeight = batch.valueWeights[index] ?? 0;
    if (valueWeight > 0) {
      const diff = forward.value - (batch.valueTargets[index] ?? 0);
      valueLossSum += diff * diff * valueWeight;
      valueWeightSum += valueWeight;
    }
  }

  const policyLoss = policyWeightSum <= 0 ? 0 : policyLossSum / policyWeightSum;
  const valueMse = valueWeightSum <= 0 ? 0 : valueLossSum / valueWeightSum;
  return {
    sampleCount: batch.metadata.sampleCount,
    policyUsableSampleCount: batch.metadata.policyUsableSampleCount,
    valueUsableSampleCount: batch.metadata.valueUsableSampleCount,
    policyLoss,
    valueLoss: valueMse,
    totalLoss: policyLoss + valueMse,
    policyAccuracy: policyCount <= 0 ? 0 : policyCorrect / policyCount,
    valueMse,
  };
}
