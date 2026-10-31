#!/usr/bin/env node
import {
  writeCompressedReplay,
  writeCompressedText,
} from "./compressed-artifact.js";
import {
  ArtifactWriteBudget,
  acquireArtifactWriter,
} from "./artifact-storage.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildEncodedTrainingReplayBatch,
  buildTrainingReplaySamples,
  createTinyPolicyValueNetwork,
  evaluatePolicyValueBatch,
  makePolicyValueTrainingPolicy,
  mulberry32,
  PolicyCheckpointInputSchemaMismatchError,
  playTrainingTraceSmoke,
  randomDeck,
  summarizeTrainingReplaySamples,
  trainPolicyValueBatch,
  type CardDefinition,
  type PolicyValueBatchTrainingResult,
  type TinyPolicyValueNetworkCheckpoint,
  type TrainingReplayBufferStats,
  type TrainingReplaySample,
  type TrainingTraceSmokeMetrics,
  type TrainingTraceSmokeResult,
} from "@orica/rules-core";

import {
  assertTraceSmokeOutputValid,
  validateTraceSmokeOutput,
} from "./trace-artifacts";
import { createTrainingEngine } from "./trace-smoke";
import {
  chooseTrainingDeck,
  cloneTrainingDeckCards,
  loadTrainingDeckPool,
  summarizeTrainingDeck,
  type TrainingDeckDescriptor,
  type TrainingDeckPool,
} from "./training-deck-pool";
import {
  currentGitCommitHash,
  loadTrainingRunConfig,
  mergeDefinedOptions,
  requireTrainingRunProfile,
  trainingRunConfigToPolicyBootstrapOptions,
  type TrainingDeckSelectionSetName,
} from "./training-config";

export interface PolicyBootstrapCliOptions {
  games?: number;
  maxSteps?: number;
  seed?: number;
  maxGeneratedChoices?: number;
  deckSize?: number;
  outDir?: string;
  experimentId?: string;
  skipPreGame?: boolean;
  configPath?: string;
  commitHash?: string;
  dryRun?: boolean;
  hiddenDim?: number;
  batchSize?: number;
  maxCards?: number;
  maxKnownDeckEntries?: number;
  maxChoices?: number;
  deckSelectionPath?: string;
  deckSet?: TrainingDeckSelectionSetName;
  checkpointIn?: string;
  checkpointOut?: string;
  restartIncompatibleCheckpoint?: boolean;
  learningRate?: number;
  epochs?: number;
  gradientClipNorm?: number;
  explorationRate?: number;
}

type DeckSourceKind = "random" | "selection";

export interface PolicyBootstrapGameSummary {
  gameIndex: number;
  seed: number;
  deckSource: DeckSourceKind;
  decks: {
    alice: TrainingDeckDescriptor | null;
    bob: TrainingDeckDescriptor | null;
  };
  outcome: TrainingTraceSmokeMetrics["outcome"];
  winner: string | null;
  steps: number;
  decisionFrames: number;
  traceEntries: number;
  truncatedNodeCount: number;
  maxChoiceCount: number;
  replayFile: string;
}

export interface PolicyBootstrapRunSummary {
  schemaVersion: 1;
  profile: "policy-bootstrap";
  dryRun: boolean;
  experimentId: string;
  createdAt: string;
  outputDir: string;
  config: {
    profile: "policy-bootstrap";
    configPath: string | null;
    commitHash: string;
    games: number;
    maxSteps: number;
    seed: number;
    maxGeneratedChoices: number;
    deckSize: number;
    skipPreGame: boolean;
    hiddenDim: number;
    batchSize: number;
    maxCards: number;
    maxKnownDeckEntries: number;
    maxChoices: number | null;
    deckSource: DeckSourceKind;
    deckSelectionPath: string | null;
    deckSet: TrainingDeckSelectionSetName | null;
    checkpointIn: string | null;
    checkpointOut: string;
    restartIncompatibleCheckpoint: boolean;
    learningRate: number;
    epochs: number;
    gradientClipNorm: number;
    explorationRate: number;
  };
  deckPool: {
    sourcePath: string;
    setName: TrainingDeckSelectionSetName;
    exportedAt: string | null;
    tierSource: {
      path: string | null;
      latestEntry: string | null;
    };
    deckCount: number;
    decks: TrainingDeckDescriptor[];
  } | null;
  aggregate: {
    outcomeCounts: Record<TrainingTraceSmokeMetrics["outcome"], number>;
    winnerCounts: Record<string, number>;
    totalSteps: number;
    averageSteps: number;
    totalDecisionFrames: number;
    totalTraceEntries: number;
    truncatedNodeCount: number;
    truncatedNodeRate: number;
    maxChoiceCount: number;
    nodeKindCounts: TrainingTraceSmokeMetrics["nodeKindCounts"];
    durationMs: number;
    stepsPerSecond: number;
  };
  replayBuffer: {
    sampleSchemaVersion: TrainingReplaySample["schemaVersion"];
    file: string;
  } & TrainingReplayBufferStats;
  batch: {
    sampleCount: number;
    evaluatedSampleCount: number;
    maxChoices: number;
    cardVocabularySize: number;
  };
  network: {
    kind: "tiny-deepsets-policy-value";
    hiddenDim: number;
    seed: number;
  };
  checkpointResume: {
    requestedFile: string | null;
    resumedFile: string | null;
    discardedFile: string | null;
    discardReason: "training_choice_feature_schema_mismatch" | null;
  };
  loss: ReturnType<typeof evaluatePolicyValueBatch>;
  training: PolicyValueBatchTrainingResult | null;
  checkpoint:
    | {
        written: false;
        reason: "dry_run";
      }
    | {
        written: true;
        file: string;
        sha256: string;
        trainingStep: number;
      };
  games: PolicyBootstrapGameSummary[];
}

export interface PolicyCheckpointArtifact {
  schemaVersion: 1;
  kind: "orica-policy-value-checkpoint";
  profile: "policy-bootstrap";
  experimentId: string;
  createdAt: string;
  commitHash: string;
  network: TinyPolicyValueNetworkCheckpoint;
}

interface ParsedArgs extends PolicyBootstrapCliOptions {
  help?: boolean;
}

const DEFAULT_GAMES = 2;
const DEFAULT_MAX_STEPS = 80;
const DEFAULT_SEED = 1;
const DEFAULT_MAX_GENERATED_CHOICES = 256;
const DEFAULT_DECK_SIZE = 40;
const DEFAULT_HIDDEN_DIM = 64;
const DEFAULT_BATCH_SIZE = 256;
const DEFAULT_MAX_CARDS = 160;
const DEFAULT_MAX_KNOWN_DECK_ENTRIES = 64;
const DEFAULT_DECK_SET: TrainingDeckSelectionSetName = "policyBootstrap";
const DEFAULT_LEARNING_RATE = 0.001;
const DEFAULT_EPOCHS = 1;
const DEFAULT_GRADIENT_CLIP_NORM = 5;
const DEFAULT_EXPLORATION_RATE = 0.15;

function timestampId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function normalizeOptions(options: PolicyBootstrapCliOptions) {
  const experimentId =
    options.experimentId ?? `${timestampId()}-policy-bootstrap`;
  const outDir = resolve(
    options.outDir ?? join("artifacts", "policy-bootstrap", experimentId)
  );
  return {
    games: options.games ?? DEFAULT_GAMES,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    seed: options.seed ?? DEFAULT_SEED,
    maxGeneratedChoices:
      options.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES,
    deckSize: options.deckSize ?? DEFAULT_DECK_SIZE,
    skipPreGame: options.skipPreGame ?? false,
    configPath: options.configPath ? resolve(options.configPath) : null,
    commitHash: options.commitHash ?? currentGitCommitHash(),
    dryRun: options.dryRun ?? true,
    hiddenDim: options.hiddenDim ?? DEFAULT_HIDDEN_DIM,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    maxCards: options.maxCards ?? DEFAULT_MAX_CARDS,
    maxKnownDeckEntries:
      options.maxKnownDeckEntries ?? DEFAULT_MAX_KNOWN_DECK_ENTRIES,
    maxChoices: options.maxChoices ?? null,
    deckSelectionPath: options.deckSelectionPath
      ? resolve(options.deckSelectionPath)
      : null,
    deckSet: options.deckSet ?? DEFAULT_DECK_SET,
    checkpointIn: options.checkpointIn ? resolve(options.checkpointIn) : null,
    checkpointOut: resolve(
      options.checkpointOut ?? join(outDir, "checkpoint.json")
    ),
    restartIncompatibleCheckpoint:
      options.restartIncompatibleCheckpoint ?? false,
    learningRate: options.learningRate ?? DEFAULT_LEARNING_RATE,
    epochs: options.epochs ?? DEFAULT_EPOCHS,
    gradientClipNorm: options.gradientClipNorm ?? DEFAULT_GRADIENT_CLIP_NORM,
    explorationRate: options.explorationRate ?? DEFAULT_EXPLORATION_RATE,
    experimentId,
    outDir,
  };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(name + " must be between 0 and 1");
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(name + " must be a positive finite number");
  }
}

function gameSeed(baseSeed: number, gameIndex: number): number {
  return (baseSeed + Math.imul(gameIndex, 0x9e3779b9)) >>> 0;
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function loadPolicyCheckpointArtifact(
  path: string
): Promise<PolicyCheckpointArtifact> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as
    | PolicyCheckpointArtifact
    | undefined;
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.kind !== "orica-policy-value-checkpoint" ||
    parsed.profile !== "policy-bootstrap" ||
    parsed.network?.kind !== "tiny-deepsets-policy-value"
  ) {
    throw new Error("unsupported policy checkpoint artifact: " + path);
  }
  return parsed;
}

async function writePolicyCheckpointArtifact(
  path: string,
  artifact: PolicyCheckpointArtifact
): Promise<{ file: string; sha256: string }> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  const text = JSON.stringify(artifact, null, 2) + "\n";
  const tempPath = resolved + "." + process.pid + "." + Date.now() + ".tmp";
  await writeFile(tempPath, text, "utf8");
  await rename(tempPath, resolved);
  return { file: resolved, sha256: sha256(text) };
}

function frameRecord(
  gameIndex: number,
  frame: TrainingTraceSmokeResult["frames"][number]
) {
  const { state: _state, ...rest } = frame;
  void _state;
  return { gameIndex, ...rest };
}

function replaySampleGameId(experimentId: string, gameIndex: number): string {
  return `${experimentId}:game-${String(gameIndex).padStart(4, "0")}`;
}

function deterministicSpread<T>(values: readonly T[], count: number): T[] {
  if (count >= values.length) return [...values];
  return Array.from(
    { length: count },
    (_, index) => values[Math.floor((index * values.length) / count)]!
  );
}

export function selectPolicyBootstrapBatchSamples(
  samples: readonly TrainingReplaySample[],
  batchSize: number
): TrainingReplaySample[] {
  const valueSamples = samples.filter((sample) => sample.weights.value > 0);
  if (valueSamples.length === 0) return samples.slice(0, batchSize);
  const selectedValue = deterministicSpread(
    valueSamples,
    Math.min(batchSize, valueSamples.length)
  );
  if (selectedValue.length >= batchSize) return selectedValue;
  const nonValueSamples = samples.filter((sample) => sample.weights.value <= 0);
  return [
    ...selectedValue,
    ...deterministicSpread(
      nonValueSamples,
      Math.min(batchSize - selectedValue.length, nonValueSamples.length)
    ),
  ];
}

function emptyOutcomeCounts(): Record<
  TrainingTraceSmokeMetrics["outcome"],
  number
> {
  return { natural: 0, capped: 0, stuck: 0, error: 0 };
}

function emptyNodeKindCounts(): TrainingTraceSmokeMetrics["nodeKindCounts"] {
  return { pregame: 0, legal_action: 0, action_input: 0 };
}

function addNodeKindCounts(
  target: TrainingTraceSmokeMetrics["nodeKindCounts"],
  source: TrainingTraceSmokeMetrics["nodeKindCounts"]
): void {
  target.pregame += source.pregame;
  target.legal_action += source.legal_action;
  target.action_input += source.action_input;
}

function summarizeDeckPool(
  pool: TrainingDeckPool | null
): PolicyBootstrapRunSummary["deckPool"] {
  if (pool === null) return null;
  return {
    sourcePath: pool.sourcePath,
    setName: pool.setName,
    exportedAt: pool.exportedAt,
    tierSource: pool.tierSource,
    deckCount: pool.decks.length,
    decks: pool.decks.map(summarizeTrainingDeck),
  };
}

function buildSummary(args: {
  options: ReturnType<typeof normalizeOptions>;
  deckPool: TrainingDeckPool | null;
  createdAt: string;
  games: PolicyBootstrapGameSummary[];
  metrics: TrainingTraceSmokeMetrics[];
  replayBufferFile: string;
  replayBufferStats: TrainingReplayBufferStats;
  evaluatedSampleCount: number;
  batchMaxChoices: number;
  cardVocabularySize: number;
  loss: ReturnType<typeof evaluatePolicyValueBatch>;
  training: PolicyValueBatchTrainingResult | null;
  checkpoint: PolicyBootstrapRunSummary["checkpoint"];
  checkpointResume: PolicyBootstrapRunSummary["checkpointResume"];
  networkCheckpoint: TinyPolicyValueNetworkCheckpoint;
  durationMs: number;
}): PolicyBootstrapRunSummary {
  const outcomeCounts = emptyOutcomeCounts();
  const winnerCounts: Record<string, number> = {};
  const nodeKindCounts = emptyNodeKindCounts();
  let totalSteps = 0;
  let totalDecisionFrames = 0;
  let totalTraceEntries = 0;
  let truncatedNodeCount = 0;
  let maxChoiceCount = 0;

  for (const metric of args.metrics) {
    outcomeCounts[metric.outcome] += 1;
    winnerCounts[metric.winner ?? "none"] =
      (winnerCounts[metric.winner ?? "none"] ?? 0) + 1;
    addNodeKindCounts(nodeKindCounts, metric.nodeKindCounts);
    totalSteps += metric.steps;
    totalDecisionFrames += metric.decisionFrames;
    totalTraceEntries += metric.traceEntries;
    truncatedNodeCount += metric.truncatedNodeCount;
    maxChoiceCount = Math.max(maxChoiceCount, metric.maxChoiceCount);
  }

  return {
    schemaVersion: 1,
    profile: "policy-bootstrap",
    dryRun: args.options.dryRun,
    experimentId: args.options.experimentId,
    createdAt: args.createdAt,
    outputDir: args.options.outDir,
    config: {
      profile: "policy-bootstrap",
      configPath: args.options.configPath,
      commitHash: args.options.commitHash,
      games: args.options.games,
      maxSteps: args.options.maxSteps,
      seed: args.options.seed,
      maxGeneratedChoices: args.options.maxGeneratedChoices,
      deckSize: args.options.deckSize,
      skipPreGame: args.options.skipPreGame,
      hiddenDim: args.options.hiddenDim,
      batchSize: args.options.batchSize,
      maxCards: args.options.maxCards,
      maxKnownDeckEntries: args.options.maxKnownDeckEntries,
      maxChoices: args.options.maxChoices,
      deckSource:
        args.options.deckSelectionPath === null ? "random" : "selection",
      deckSelectionPath: args.options.deckSelectionPath,
      deckSet:
        args.options.deckSelectionPath === null ? null : args.options.deckSet,
      checkpointIn: args.options.checkpointIn,
      checkpointOut: args.options.checkpointOut,
      restartIncompatibleCheckpoint: args.options.restartIncompatibleCheckpoint,
      learningRate: args.options.learningRate,
      epochs: args.options.epochs,
      gradientClipNorm: args.options.gradientClipNorm,
      explorationRate: args.options.explorationRate,
    },
    deckPool: summarizeDeckPool(args.deckPool),
    aggregate: {
      outcomeCounts,
      winnerCounts,
      totalSteps,
      averageSteps:
        args.metrics.length === 0 ? 0 : totalSteps / args.metrics.length,
      totalDecisionFrames,
      totalTraceEntries,
      truncatedNodeCount,
      truncatedNodeRate:
        totalDecisionFrames === 0
          ? 0
          : truncatedNodeCount / totalDecisionFrames,
      maxChoiceCount,
      nodeKindCounts,
      durationMs: args.durationMs,
      stepsPerSecond:
        args.durationMs <= 0 ? 0 : totalSteps / (args.durationMs / 1000),
    },
    replayBuffer: {
      sampleSchemaVersion: 1,
      file: args.replayBufferFile,
      ...args.replayBufferStats,
    },
    batch: {
      sampleCount: args.replayBufferStats.sampleCount,
      evaluatedSampleCount: args.evaluatedSampleCount,
      maxChoices: args.batchMaxChoices,
      cardVocabularySize: args.cardVocabularySize,
    },
    network: {
      kind: "tiny-deepsets-policy-value",
      hiddenDim: args.networkCheckpoint.hiddenDim,
      seed: args.networkCheckpoint.seed,
    },
    checkpointResume: args.checkpointResume,
    loss: args.loss,
    training: args.training,
    checkpoint: args.checkpoint,
    games: args.games,
  };
}

function chooseGameDecks(args: {
  engineCards: readonly CardDefinition[];
  deckSize: number;
  rng: () => number;
  deckPool: TrainingDeckPool | null;
}): {
  decks: [CardDefinition[], CardDefinition[]];
  source: DeckSourceKind;
  summary: {
    alice: TrainingDeckDescriptor | null;
    bob: TrainingDeckDescriptor | null;
  };
} {
  if (args.deckPool === null) {
    return {
      decks: [
        randomDeck(args.engineCards, args.deckSize, args.rng),
        randomDeck(args.engineCards, args.deckSize, args.rng),
      ],
      source: "random",
      summary: { alice: null, bob: null },
    };
  }

  const aliceDeck = chooseTrainingDeck(args.deckPool, args.rng);
  const bobDeck = chooseTrainingDeck(args.deckPool, args.rng, aliceDeck.id);
  return {
    decks: [cloneTrainingDeckCards(aliceDeck), cloneTrainingDeckCards(bobDeck)],
    source: "selection",
    summary: {
      alice: summarizeTrainingDeck(aliceDeck),
      bob: summarizeTrainingDeck(bobDeck),
    },
  };
}

export async function runPolicyBootstrap(
  options: PolicyBootstrapCliOptions = {}
): Promise<PolicyBootstrapRunSummary> {
  const normalized = normalizeOptions(options);
  assertPositiveInteger("games", normalized.games);
  assertPositiveInteger("maxSteps", normalized.maxSteps);
  assertPositiveInteger("maxGeneratedChoices", normalized.maxGeneratedChoices);
  assertPositiveInteger("deckSize", normalized.deckSize);
  assertPositiveInteger("hiddenDim", normalized.hiddenDim);
  assertPositiveInteger("batchSize", normalized.batchSize);
  assertPositiveInteger("maxCards", normalized.maxCards);
  assertPositiveInteger("maxKnownDeckEntries", normalized.maxKnownDeckEntries);
  if (normalized.maxChoices !== null) {
    assertPositiveInteger("maxChoices", normalized.maxChoices);
  }
  assertPositiveFinite("learningRate", normalized.learningRate);
  assertPositiveInteger("epochs", normalized.epochs);
  assertPositiveFinite("gradientClipNorm", normalized.gradientClipNorm);
  assertRate("explorationRate", normalized.explorationRate);

  const startedAtMs = Date.now();
  const createdAt = new Date(startedAtMs).toISOString();
  const engine = createTrainingEngine();
  const deckPool =
    normalized.deckSelectionPath === null
      ? null
      : await loadTrainingDeckPool({
          path: normalized.deckSelectionPath,
          setName: normalized.deckSet,
          engine,
        });
  const inputCheckpoint =
    normalized.checkpointIn === null
      ? null
      : await loadPolicyCheckpointArtifact(normalized.checkpointIn);
  let checkpointResume: PolicyBootstrapRunSummary["checkpointResume"] = {
    requestedFile: normalized.checkpointIn,
    resumedFile: null,
    discardedFile: null,
    discardReason: null,
  };
  let network: ReturnType<typeof createTinyPolicyValueNetwork>;
  if (inputCheckpoint === null) {
    network = createTinyPolicyValueNetwork({
      seed: normalized.seed,
      hiddenDim: normalized.hiddenDim,
    });
  } else {
    try {
      network = createTinyPolicyValueNetwork({
        checkpoint: inputCheckpoint.network,
      });
      checkpointResume = {
        ...checkpointResume,
        resumedFile: normalized.checkpointIn,
      };
    } catch (error) {
      if (
        !normalized.restartIncompatibleCheckpoint ||
        !(error instanceof PolicyCheckpointInputSchemaMismatchError)
      ) {
        throw error;
      }
      network = createTinyPolicyValueNetwork({
        seed: normalized.seed,
        hiddenDim: normalized.hiddenDim,
      });
      checkpointResume = {
        ...checkpointResume,
        discardedFile: normalized.checkpointIn,
        discardReason: "training_choice_feature_schema_mismatch",
      };
    }
  }
  const policy = makePolicyValueTrainingPolicy(network, {
    maxCards: normalized.maxCards,
    maxKnownDeckEntries: normalized.maxKnownDeckEntries,
    explorationRate: normalized.explorationRate,
  });

  await mkdir(normalized.outDir, { recursive: true });
  const replaysDir =
    normalized.games === 1
      ? normalized.outDir
      : join(normalized.outDir, "replays");
  if (normalized.games > 1) await mkdir(replaysDir, { recursive: true });

  const releaseWriter = acquireArtifactWriter(normalized.outDir);
  try {
    const storageBudget = new ArtifactWriteBudget(normalized.outDir);
    const traceLines: string[] = [];
    const frameLines: string[] = [];
    const replaySampleLines: string[] = [];
    const replaySamples: TrainingReplaySample[] = [];
    const gameSummaries: PolicyBootstrapGameSummary[] = [];
    const metrics: TrainingTraceSmokeMetrics[] = [];
    const replayBufferFile = join(normalized.outDir, "replay-buffer.jsonl.gz");

    for (let gameIndex = 0; gameIndex < normalized.games; gameIndex++) {
      const seed = gameSeed(normalized.seed, gameIndex);
      const rng = mulberry32(seed);
      const gameDecks = chooseGameDecks({
        engineCards: engine.cards,
        deckSize: normalized.deckSize,
        rng,
        deckPool,
      });
      const result = playTrainingTraceSmoke({
        engine,
        rng,
        maxSteps: normalized.maxSteps,
        maxGeneratedChoices: normalized.maxGeneratedChoices,
        skipPreGame: normalized.skipPreGame,
        title: `${normalized.experimentId} game ${gameIndex}`,
        decks: gameDecks.decks,
        policies: { alice: policy, bob: policy },
      });
      const replayFile =
        normalized.games === 1
          ? join(normalized.outDir, "replay.jsonl.gz")
          : join(
              replaysDir,
              `game-${String(gameIndex).padStart(4, "0")}.jsonl.gz`
            );
      await writeCompressedReplay(replayFile, result.replay, storageBudget);

      for (const entry of result.trace) {
        traceLines.push(jsonLine({ gameIndex, seed, ...entry }));
      }
      for (const frame of result.frames) {
        frameLines.push(jsonLine(frameRecord(gameIndex, frame)));
      }
      const samples = buildTrainingReplaySamples(result, {
        experimentId: normalized.experimentId,
        gameId: replaySampleGameId(normalized.experimentId, gameIndex),
        gameIndex,
        seed,
      });
      for (const sample of samples) {
        replaySamples.push(sample);
        replaySampleLines.push(jsonLine(sample));
      }

      metrics.push(result.metrics);
      gameSummaries.push({
        gameIndex,
        seed,
        deckSource: gameDecks.source,
        decks: gameDecks.summary,
        outcome: result.metrics.outcome,
        winner: result.metrics.winner,
        steps: result.metrics.steps,
        decisionFrames: result.metrics.decisionFrames,
        traceEntries: result.metrics.traceEntries,
        truncatedNodeCount: result.metrics.truncatedNodeCount,
        maxChoiceCount: result.metrics.maxChoiceCount,
        replayFile,
      });
    }

    const evaluatedSamples = selectPolicyBootstrapBatchSamples(
      replaySamples,
      normalized.batchSize
    );
    const batch = buildEncodedTrainingReplayBatch(evaluatedSamples, {
      maxCards: normalized.maxCards,
      maxKnownDeckEntries: normalized.maxKnownDeckEntries,
      ...(normalized.maxChoices === null
        ? {}
        : { maxChoices: normalized.maxChoices }),
    });
    const lossBeforeTraining = evaluatePolicyValueBatch(network, batch);
    const training = normalized.dryRun
      ? null
      : trainPolicyValueBatch(network, batch, {
          learningRate: normalized.learningRate,
          epochs: normalized.epochs,
          gradientClipNorm: normalized.gradientClipNorm,
        });
    const loss = training?.finalEvaluation ?? lossBeforeTraining;
    const networkCheckpoint = network.exportCheckpoint();
    const checkpoint: PolicyBootstrapRunSummary["checkpoint"] =
      normalized.dryRun
        ? { written: false, reason: "dry_run" }
        : {
            written: true,
            ...(await writePolicyCheckpointArtifact(normalized.checkpointOut, {
              schemaVersion: 1,
              kind: "orica-policy-value-checkpoint",
              profile: "policy-bootstrap",
              experimentId: normalized.experimentId,
              createdAt,
              commitHash: normalized.commitHash,
              network: networkCheckpoint,
            })),
            trainingStep: networkCheckpoint.trainingStep,
          };

    await writeCompressedText(
      join(normalized.outDir, "trace.jsonl.gz"),
      traceLines.join(""),
      storageBudget,
      true
    );
    await writeCompressedText(
      join(normalized.outDir, "frames.jsonl.gz"),
      frameLines.join(""),
      storageBudget,
      true
    );
    await writeCompressedText(
      replayBufferFile,
      replaySampleLines.join(""),
      storageBudget,
      true
    );
    const summary = buildSummary({
      options: normalized,
      deckPool,
      createdAt,
      games: gameSummaries,
      metrics,
      replayBufferFile,
      replayBufferStats: summarizeTrainingReplaySamples(replaySamples),
      evaluatedSampleCount: evaluatedSamples.length,
      batchMaxChoices: batch.metadata.maxChoices,
      cardVocabularySize: batch.metadata.cardVocabularySize,
      loss,
      training,
      checkpoint,
      checkpointResume,
      networkCheckpoint,
      durationMs: Date.now() - startedAtMs,
    });
    await writeFile(
      join(normalized.outDir, "metrics.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );
    assertTraceSmokeOutputValid(
      await validateTraceSmokeOutput(normalized.outDir)
    );
    return summary;
  } finally {
    releaseWriter();
  }
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`boolean option must be true or false: ${value}`);
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--games":
        parsed.games = Number(next());
        break;
      case "--maxSteps":
      case "--max-steps":
        parsed.maxSteps = Number(next());
        break;
      case "--seed":
        parsed.seed = Number(next());
        break;
      case "--maxGeneratedChoices":
      case "--max-generated-choices":
        parsed.maxGeneratedChoices = Number(next());
        break;
      case "--deckSize":
      case "--deck-size":
        parsed.deckSize = Number(next());
        break;
      case "--out":
      case "--outDir":
      case "--out-dir":
        parsed.outDir = next();
        break;
      case "--experiment":
      case "--experimentId":
      case "--experiment-id":
        parsed.experimentId = next();
        break;
      case "--skipPreGame":
      case "--skip-pregame":
        parsed.skipPreGame = parseBoolean(next());
        break;
      case "--dryRun":
      case "--dry-run":
        parsed.dryRun = parseBoolean(next());
        break;
      case "--hiddenDim":
      case "--hidden-dim":
        parsed.hiddenDim = Number(next());
        break;
      case "--batchSize":
      case "--batch-size":
        parsed.batchSize = Number(next());
        break;
      case "--maxCards":
      case "--max-cards":
        parsed.maxCards = Number(next());
        break;
      case "--maxKnownDeckEntries":
      case "--max-known-deck-entries":
        parsed.maxKnownDeckEntries = Number(next());
        break;
      case "--maxChoices":
      case "--max-choices":
        parsed.maxChoices = Number(next());
        break;
      case "--deckSelection":
      case "--deckSelectionPath":
      case "--deck-selection":
      case "--deck-selection-path":
        parsed.deckSelectionPath = next();
        break;
      case "--deckSet":
      case "--deck-set":
        parsed.deckSet = next() as TrainingDeckSelectionSetName;
        break;
      case "--checkpointIn":
      case "--checkpoint-in":
        parsed.checkpointIn = next();
        break;
      case "--checkpointOut":
      case "--checkpoint-out":
        parsed.checkpointOut = next();
        break;
      case "--restartIncompatibleCheckpoint":
      case "--restart-incompatible-checkpoint":
        parsed.restartIncompatibleCheckpoint = parseBoolean(next());
        break;
      case "--learningRate":
      case "--learning-rate":
        parsed.learningRate = Number(next());
        break;
      case "--epochs":
        parsed.epochs = Number(next());
        break;
      case "--gradientClipNorm":
      case "--gradient-clip-norm":
        parsed.gradientClipNorm = Number(next());
        break;
      case "--explorationRate":
      case "--exploration-rate":
        parsed.explorationRate = Number(next());
        break;
      case "--config":
      case "--configPath":
      case "--config-path":
        parsed.configPath = next();
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "orica policy-bootstrap",
    "",
    "Usage:",
    "  node scripts/policy-bootstrap.mjs --games 2 --maxSteps 120 --seed 1 --dryRun true",
    "",
    "Options:",
    "  --config <path>              JSON run profile; CLI options override it",
    "  --dryRun true|false          false updates weights and writes a checkpoint",
    "  --hiddenDim <n>              hidden width for the tiny policy/value network",
    "  --batchSize <n>              replay samples to evaluate in the dry-run batch",
    "  --checkpointIn <path>        resume a versioned policy checkpoint",
    "  --checkpointOut <path>       atomically write the updated checkpoint",
    "  --restartIncompatibleCheckpoint true|false  discard an incompatible input checkpoint and start fresh",
    "  --learningRate <n>           actor-critic head learning rate",
    "  --epochs <n>                 updates over the sampled replay batch",
    "  --explorationRate <0..1>     deterministic epsilon exploration",
    "  --deckSelection <path>       selected-decks.json from deck selection export",
    "  --deckSet <name>             selection set, default policyBootstrap",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

export async function runPolicyBootstrapCli(
  argv: readonly string[]
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const summary = await runPolicyBootstrap(
    await resolvePolicyBootstrapOptions(parsed)
  );
  const checkpointLine = summary.checkpoint.written
    ? "checkpoint=" +
      summary.checkpoint.file +
      " sha256=" +
      summary.checkpoint.sha256
    : "checkpoint=not-written (" + summary.checkpoint.reason + ")";
  console.log(
    [
      "policy-bootstrap " +
        (summary.dryRun ? "dry-run" : "training") +
        " wrote " +
        summary.config.games +
        " game(s) to " +
        summary.outputDir,
      "outcomes=" + JSON.stringify(summary.aggregate.outcomeCounts),
      "samples=" +
        summary.replayBuffer.sampleCount +
        ", loss=" +
        summary.loss.totalLoss.toFixed(4),
      checkpointLine,
    ].join("\n")
  );
}

async function resolvePolicyBootstrapOptions(
  parsed: ParsedArgs
): Promise<PolicyBootstrapCliOptions> {
  if (parsed.configPath === undefined) return parsed;
  const loaded = await loadTrainingRunConfig(parsed.configPath);
  requireTrainingRunProfile(loaded, "policy-bootstrap");
  return mergeDefinedOptions(
    trainingRunConfigToPolicyBootstrapOptions(loaded),
    parsed
  ) as PolicyBootstrapCliOptions;
}

if (isDirectExecution()) {
  runPolicyBootstrapCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
