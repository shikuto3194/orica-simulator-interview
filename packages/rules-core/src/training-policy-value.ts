import { buildAiObservation, type AiObservationMode } from "./ai-observation";
import {
  buildAiObservationCardVocabulary,
  encodeAiObservation,
  type AiObservationCardVocabulary,
  type EncodedAiObservation,
} from "./ai-observation-encoder";
import {
  encodeTrainingDecisionChoice,
  type EncodedTrainingDecisionChoice,
} from "./training-action-encoder";
import type {
  Engine,
  Rng,
  TrainingDecisionChoice,
  TrainingDecisionNode,
  TrainingPolicy,
} from "./training-decision-surface";
import type { GameState } from "./model";

export interface PolicyValueInferenceInput {
  observation: EncodedAiObservation;
  choices: EncodedTrainingDecisionChoice[];
  choiceMask: readonly number[];
  metadata: {
    actingPlayerId: string;
    nodeId: string;
    nodeKind: TrainingDecisionNode["kind"];
    choiceCount: number;
  };
}

export interface PolicyValuePrediction {
  policyLogits: readonly number[];
  value: number;
}

export interface PolicyValuePredictor {
  predict(input: PolicyValueInferenceInput): PolicyValuePrediction;
}

export interface BuildPolicyValueInferenceInputOptions {
  state: GameState;
  node: TrainingDecisionNode;
  engine: Engine;
  mode?: Extract<AiObservationMode, "player" | "debug_perfect">;
  cardVocabulary?: AiObservationCardVocabulary;
  maxCards?: number;
  maxKnownDeckEntries?: number;
}

function choiceMask(choiceCount: number): number[] {
  return new Array(choiceCount).fill(1);
}

function defaultCardVocabulary(engine: Engine): AiObservationCardVocabulary {
  return buildAiObservationCardVocabulary(
    engine.cards.map((card) => card.cardNo)
  );
}

export function buildPolicyValueInferenceInput(
  options: BuildPolicyValueInferenceInputOptions
): PolicyValueInferenceInput {
  const cardVocabulary =
    options.cardVocabulary ?? defaultCardVocabulary(options.engine);
  const observation = buildAiObservation({
    state: options.state,
    viewpointPlayerId: options.node.actingPlayerId,
    mode: options.mode ?? "player",
    getCardDefinitionById: options.engine.getCardDefinitionById,
  });
  const encodedObservation = encodeAiObservation({
    observation,
    cardVocabulary,
    ...(options.maxCards !== undefined ? { maxCards: options.maxCards } : {}),
    ...(options.maxKnownDeckEntries !== undefined
      ? { maxKnownDeckEntries: options.maxKnownDeckEntries }
      : {}),
  });
  const choices = options.node.choices.map((choice) =>
    encodeTrainingDecisionChoice({
      node: options.node,
      choice,
      encodedObservation,
      cardVocabulary,
      getCardDefinitionById: options.engine.getCardDefinitionById,
    })
  );

  return {
    observation: encodedObservation,
    choices,
    choiceMask: choiceMask(choices.length),
    metadata: {
      actingPlayerId: options.node.actingPlayerId,
      nodeId: options.node.nodeId,
      nodeKind: options.node.kind,
      choiceCount: choices.length,
    },
  };
}

function assertFiniteLogit(value: number, index: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`policyLogits[${index}] must be finite`);
  }
}

export function choosePolicyValuePredictionChoice(
  node: TrainingDecisionNode,
  prediction: PolicyValuePrediction,
  rng: Rng = Math.random
): TrainingDecisionChoice {
  if (prediction.policyLogits.length < node.choices.length) {
    throw new Error(
      `policyLogits length ${prediction.policyLogits.length} is smaller than choice count ${node.choices.length}`
    );
  }
  let bestLogit = -Infinity;
  const bestIndexes: number[] = [];
  for (let index = 0; index < node.choices.length; index++) {
    const logit = prediction.policyLogits[index]!;
    assertFiniteLogit(logit, index);
    if (logit > bestLogit) {
      bestLogit = logit;
      bestIndexes.length = 0;
      bestIndexes.push(index);
    } else if (logit === bestLogit) {
      bestIndexes.push(index);
    }
  }
  const selectedIndex =
    bestIndexes[Math.floor(rng() * bestIndexes.length)] ?? 0;
  return node.choices[selectedIndex]!;
}

export type PolicyValueTrainingPolicyOptions = Omit<
  BuildPolicyValueInferenceInputOptions,
  "state" | "node" | "engine"
> & {
  /** Deterministic epsilon exploration driven by the game RNG. */
  explorationRate?: number;
};

export function makePolicyValueTrainingPolicy(
  predictor: PolicyValuePredictor,
  options: PolicyValueTrainingPolicyOptions = {}
): TrainingPolicy {
  const { explorationRate = 0, ...inferenceOptions } = options;
  if (
    !Number.isFinite(explorationRate) ||
    explorationRate < 0 ||
    explorationRate > 1
  ) {
    throw new Error("explorationRate must be between 0 and 1");
  }
  return (state, node, engine, rng) => {
    if (explorationRate > 0 && rng() < explorationRate) {
      const index = Math.floor(rng() * node.choices.length);
      return node.choices[index] ?? node.choices[0]!;
    }
    const input = buildPolicyValueInferenceInput({
      ...inferenceOptions,
      state,
      node,
      engine,
    });
    return choosePolicyValuePredictionChoice(
      node,
      predictor.predict(input),
      rng
    );
  };
}
