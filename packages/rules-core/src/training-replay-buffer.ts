import type { AiObservation } from "./ai-observation";
import {
  AI_OBSERVATION_ENCODER_DEFAULT_MAX_CARDS,
  AI_OBSERVATION_ENCODER_DEFAULT_MAX_KNOWN_DECK_ENTRIES,
  AI_OBSERVATION_ENCODER_SCHEMA_VERSION,
  buildAiObservationCardVocabulary,
  collectKnownCardNosFromAiObservation,
  encodeAiObservation,
  type AiObservationCardVocabulary,
  type AiObservationEncoderSchemaVersion,
  type EncodedAiObservation,
} from "./ai-observation-encoder";
import type { AiDecisionApplyOptionField } from "./player-decision-contract";
import {
  ACTION_FEAT_DIM,
  ACTION_KIND_UNK,
  TRAINING_CHOICE_FEAT_DIM,
  encodeTrainingDecisionChoice,
} from "./training-action-encoder";
import type { LegalAction } from "./legal/legal-actions-types";
import type {
  TrainingDecisionNode,
  TrainingDecisionNodeKind,
  TrainingDecisionTraceEntry,
  TrainingGameResult,
  TrainingSystemActionKind,
  TrainingTraceSmokeFrame,
  TrainingTraceSmokeResult,
} from "./training-decision-surface";

export const TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION = 1;

export type TrainingReplayValueResult = "win" | "loss" | "draw" | "unresolved";

export interface TrainingReplayPolicyTarget {
  selectedChoiceId: string;
  selectedChoiceIndex: number;
  choiceCount: number;
  distribution: readonly number[];
}

export interface TrainingReplayValueTarget {
  outcome: TrainingGameResult["outcome"];
  winner: string | null;
  result: TrainingReplayValueResult;
  value: number;
  terminalOutcomeKnown: boolean;
}

export interface TrainingReplaySampleWeights {
  policy: number;
  value: number;
}

export interface TrainingReplaySample {
  schemaVersion: typeof TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION;
  sampleId: string;
  experimentId?: string;
  gameId: string;
  gameIndex: number;
  seed: number;
  frameIndex: number;
  step: number;
  stateHash: string;
  observationHash: string;
  actingPlayerId: string;
  nodeKind: TrainingDecisionNodeKind;
  actionKind?: LegalAction["kind"];
  systemActionKind?: TrainingSystemActionKind;
  fields: readonly AiDecisionApplyOptionField[];
  truncated: boolean;
  observation: AiObservation;
  node: TrainingDecisionNode;
  selected: TrainingDecisionTraceEntry;
  policyTarget: TrainingReplayPolicyTarget;
  valueTarget: TrainingReplayValueTarget;
  weights: TrainingReplaySampleWeights;
}

export interface TrainingReplaySampleBuildContext {
  gameId: string;
  gameIndex: number;
  seed: number;
  experimentId?: string;
}

export interface TrainingReplayBufferStats {
  sampleCount: number;
  policyWeightSum: number;
  valueWeightSum: number;
  truncatedSampleCount: number;
  nodeKindCounts: Record<TrainingDecisionNodeKind, number>;
}

export interface BuildTrainingReplayBatchOptions {
  cardVocabulary?: AiObservationCardVocabulary;
  maxCards?: number;
  maxKnownDeckEntries?: number;
  maxChoices?: number;
}

export interface TrainingReplayBatchSampleMetadata {
  sampleId: string;
  gameId: string;
  gameIndex: number;
  seed: number;
  frameIndex: number;
  step: number;
  nodeKind: TrainingDecisionNodeKind;
  choiceCount: number;
  selectedChoiceIndex: number;
  policyWeight: number;
  valueWeight: number;
}

export interface EncodedTrainingReplayBatch {
  schemaVersion: 1;
  sampleSchemaVersion: typeof TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION;
  observationEncoderSchemaVersion: AiObservationEncoderSchemaVersion;
  observations: EncodedAiObservation[];
  choiceMask: number[][];
  choiceFeatures: number[][][];
  choiceActionKindIndices: number[][];
  choiceSourceTokenIndices: number[][];
  choiceTargetTokenIndices: number[][];
  policyTargets: number[][];
  valueTargets: number[];
  policyWeights: number[];
  valueWeights: number[];
  metadata: {
    sampleCount: number;
    maxCards: number;
    maxKnownDeckEntries: number;
    maxChoices: number;
    cardVocabularySize: number;
    policyUsableSampleCount: number;
    valueUsableSampleCount: number;
    choiceTruncatedByBatchCount: number;
    samples: TrainingReplayBatchSampleMetadata[];
  };
}

function padFrameIndex(frameIndex: number): string {
  return String(frameIndex).padStart(6, "0");
}

function selectedChoiceIndex(frame: TrainingTraceSmokeFrame): number {
  const index = frame.node.choices.findIndex((choice) => {
    return choice.choiceId === frame.selected.choiceId;
  });
  if (index < 0) {
    throw new Error(
      `selected choice ${frame.selected.choiceId} is not present in frame ${frame.frameIndex}`
    );
  }
  return index;
}

function oneHot(length: number, selectedIndex: number): number[] {
  return Array.from({ length }, (_value, index) =>
    index === selectedIndex ? 1 : 0
  );
}

function normalizePositiveInteger(
  name: string,
  value: number | undefined,
  fallback: number
): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return normalized;
}

function vocabularySize(vocabulary: AiObservationCardVocabulary): number {
  if (vocabulary instanceof Map) return vocabulary.size;
  return Object.keys(vocabulary).length;
}

function buildReplayBatchCardVocabulary(
  samples: readonly TrainingReplaySample[],
  vocabulary: AiObservationCardVocabulary | undefined
): AiObservationCardVocabulary {
  if (vocabulary !== undefined) return vocabulary;
  return buildAiObservationCardVocabulary(
    samples.flatMap((sample) => {
      return collectKnownCardNosFromAiObservation(sample.observation);
    })
  );
}

function maxChoiceCount(samples: readonly TrainingReplaySample[]): number {
  return Math.max(
    1,
    ...samples.map((sample) => sample.policyTarget.choiceCount)
  );
}

function paddedNumbers(values: readonly number[], length: number): number[] {
  const padded = values.slice(0, length);
  while (padded.length < length) padded.push(0);
  return padded;
}

function choiceMask(choiceCount: number, maxChoices: number): number[] {
  return Array.from({ length: maxChoices }, (_value, index) =>
    index < Math.min(choiceCount, maxChoices) ? 1 : 0
  );
}

function paddedChoiceFeatureRows(
  sample: TrainingReplaySample,
  encodedObservation: EncodedAiObservation,
  cardVocabulary: AiObservationCardVocabulary,
  maxChoices: number
) {
  const encoded = sample.node.choices.slice(0, maxChoices).map((choice) =>
    encodeTrainingDecisionChoice({
      node: sample.node,
      choice,
      encodedObservation,
      cardVocabulary,
    })
  );
  while (encoded.length < maxChoices) {
    encoded.push({
      choiceId: "",
      channelIndex: -1,
      action: {
        kindIndex: ACTION_KIND_UNK,
        sourceEmbIndex: 0,
        sourceTokenIndex: -1,
        targetTokenIndex: -1,
        feats: new Array(ACTION_FEAT_DIM).fill(0),
      },
      feats: new Array(TRAINING_CHOICE_FEAT_DIM).fill(0),
    });
  }
  return encoded;
}

export function trainingReplayValueTargetForActor(
  result: Pick<TrainingGameResult, "outcome" | "winner">,
  actingPlayerId: string
): TrainingReplayValueTarget {
  if (result.outcome !== "natural") {
    return {
      outcome: result.outcome,
      winner: result.winner,
      result: "unresolved",
      value: 0,
      terminalOutcomeKnown: false,
    };
  }

  if (result.winner === null) {
    return {
      outcome: result.outcome,
      winner: null,
      result: "draw",
      value: 0,
      terminalOutcomeKnown: true,
    };
  }

  const won = result.winner === actingPlayerId;
  return {
    outcome: result.outcome,
    winner: result.winner,
    result: won ? "win" : "loss",
    value: won ? 1 : -1,
    terminalOutcomeKnown: true,
  };
}

export function buildTrainingReplaySample(
  result: Pick<TrainingGameResult, "outcome" | "winner">,
  frame: TrainingTraceSmokeFrame,
  context: TrainingReplaySampleBuildContext
): TrainingReplaySample {
  const selectedIndex = selectedChoiceIndex(frame);
  const choiceCount = frame.node.choices.length;
  const valueTarget = trainingReplayValueTargetForActor(
    result,
    frame.selected.actingPlayerId
  );
  const sample = {
    schemaVersion: TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION,
    sampleId: `${context.gameId}:frame-${padFrameIndex(frame.frameIndex)}`,
    ...(context.experimentId ? { experimentId: context.experimentId } : {}),
    gameId: context.gameId,
    gameIndex: context.gameIndex,
    seed: context.seed,
    frameIndex: frame.frameIndex,
    step: frame.selected.step,
    stateHash: frame.stateHash,
    observationHash: frame.observationHash,
    actingPlayerId: frame.selected.actingPlayerId,
    nodeKind: frame.selected.nodeKind,
    ...(frame.selected.actionKind
      ? { actionKind: frame.selected.actionKind }
      : {}),
    ...(frame.selected.systemActionKind
      ? { systemActionKind: frame.selected.systemActionKind }
      : {}),
    fields: frame.selected.fields,
    truncated: frame.selected.truncated,
    observation: frame.observation,
    node: frame.node,
    selected: frame.selected,
    policyTarget: {
      selectedChoiceId: frame.selected.choiceId,
      selectedChoiceIndex: selectedIndex,
      choiceCount,
      distribution: oneHot(choiceCount, selectedIndex),
    },
    valueTarget,
    weights: {
      policy: frame.selected.truncated ? 0 : 1,
      value: valueTarget.terminalOutcomeKnown ? 1 : 0,
    },
  } satisfies TrainingReplaySample;
  return sample;
}

export function buildTrainingReplaySamples(
  result: TrainingTraceSmokeResult,
  context: TrainingReplaySampleBuildContext
): TrainingReplaySample[] {
  return result.frames.map((frame) => {
    return buildTrainingReplaySample(result, frame, context);
  });
}

export function summarizeTrainingReplaySamples(
  samples: readonly TrainingReplaySample[]
): TrainingReplayBufferStats {
  const nodeKindCounts: Record<TrainingDecisionNodeKind, number> = {
    pregame: 0,
    legal_action: 0,
    action_input: 0,
  };
  let policyWeightSum = 0;
  let valueWeightSum = 0;
  let truncatedSampleCount = 0;

  for (const sample of samples) {
    nodeKindCounts[sample.nodeKind] += 1;
    policyWeightSum += sample.weights.policy;
    valueWeightSum += sample.weights.value;
    if (sample.truncated) truncatedSampleCount += 1;
  }

  return {
    sampleCount: samples.length,
    policyWeightSum,
    valueWeightSum,
    truncatedSampleCount,
    nodeKindCounts,
  };
}

export function buildEncodedTrainingReplayBatch(
  samples: readonly TrainingReplaySample[],
  options: BuildTrainingReplayBatchOptions = {}
): EncodedTrainingReplayBatch {
  const maxCards = normalizePositiveInteger(
    "maxCards",
    options.maxCards,
    AI_OBSERVATION_ENCODER_DEFAULT_MAX_CARDS
  );
  const maxKnownDeckEntries = normalizePositiveInteger(
    "maxKnownDeckEntries",
    options.maxKnownDeckEntries,
    AI_OBSERVATION_ENCODER_DEFAULT_MAX_KNOWN_DECK_ENTRIES
  );
  const maxChoices = normalizePositiveInteger(
    "maxChoices",
    options.maxChoices,
    maxChoiceCount(samples)
  );
  const cardVocabulary = buildReplayBatchCardVocabulary(
    samples,
    options.cardVocabulary
  );

  const observations: EncodedAiObservation[] = [];
  const masks: number[][] = [];
  const choiceFeatures: number[][][] = [];
  const choiceActionKindIndices: number[][] = [];
  const choiceSourceTokenIndices: number[][] = [];
  const choiceTargetTokenIndices: number[][] = [];
  const policyTargets: number[][] = [];
  const valueTargets: number[] = [];
  const policyWeights: number[] = [];
  const valueWeights: number[] = [];
  const sampleMetadata: TrainingReplayBatchSampleMetadata[] = [];
  let policyUsableSampleCount = 0;
  let valueUsableSampleCount = 0;
  let choiceTruncatedByBatchCount = 0;

  for (const sample of samples) {
    const choiceCount = sample.policyTarget.choiceCount;
    const choiceTruncatedByBatch = choiceCount > maxChoices;
    const policyWeight = choiceTruncatedByBatch ? 0 : sample.weights.policy;
    if (choiceTruncatedByBatch) choiceTruncatedByBatchCount += 1;
    if (policyWeight > 0) policyUsableSampleCount += 1;
    if (sample.weights.value > 0) valueUsableSampleCount += 1;

    const encodedObservation = encodeAiObservation({
      observation: sample.observation,
      cardVocabulary,
      maxCards,
      maxKnownDeckEntries,
    });
    const encodedChoices = paddedChoiceFeatureRows(
      sample,
      encodedObservation,
      cardVocabulary,
      maxChoices
    );

    observations.push(encodedObservation);
    masks.push(choiceMask(choiceCount, maxChoices));
    choiceFeatures.push(encodedChoices.map((choice) => choice.feats));
    choiceActionKindIndices.push(
      encodedChoices.map((choice) => choice.action.kindIndex)
    );
    choiceSourceTokenIndices.push(
      encodedChoices.map((choice) => choice.action.sourceTokenIndex)
    );
    choiceTargetTokenIndices.push(
      encodedChoices.map((choice) => choice.action.targetTokenIndex)
    );
    policyTargets.push(
      paddedNumbers(sample.policyTarget.distribution, maxChoices)
    );
    valueTargets.push(sample.valueTarget.value);
    policyWeights.push(policyWeight);
    valueWeights.push(sample.weights.value);
    sampleMetadata.push({
      sampleId: sample.sampleId,
      gameId: sample.gameId,
      gameIndex: sample.gameIndex,
      seed: sample.seed,
      frameIndex: sample.frameIndex,
      step: sample.step,
      nodeKind: sample.nodeKind,
      choiceCount,
      selectedChoiceIndex: sample.policyTarget.selectedChoiceIndex,
      policyWeight,
      valueWeight: sample.weights.value,
    });
  }

  return {
    schemaVersion: 1,
    sampleSchemaVersion: TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION,
    observationEncoderSchemaVersion: AI_OBSERVATION_ENCODER_SCHEMA_VERSION,
    observations,
    choiceMask: masks,
    choiceFeatures,
    choiceActionKindIndices,
    choiceSourceTokenIndices,
    choiceTargetTokenIndices,
    policyTargets,
    valueTargets,
    policyWeights,
    valueWeights,
    metadata: {
      sampleCount: samples.length,
      maxCards,
      maxKnownDeckEntries,
      maxChoices,
      cardVocabularySize: vocabularySize(cardVocabulary),
      policyUsableSampleCount,
      valueUsableSampleCount,
      choiceTruncatedByBatchCount,
      samples: sampleMetadata,
    },
  };
}
