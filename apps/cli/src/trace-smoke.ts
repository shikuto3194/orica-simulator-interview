#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ALL_CARDS } from "@orica/card-data";
import {
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  buildTrainingReplaySamples,
  mulberry32,
  playTrainingTraceSmoke,
  randomDeck,
  summarizeTrainingReplaySamples,
  type CardDefinition,
  type Engine,
  type TrainingReplayBufferStats,
  type TrainingReplaySample,
  type TrainingTraceSmokeMetrics,
  type TrainingTraceSmokeResult,
} from "@orica/rules-core";
import {
  assertTraceSmokeOutputValid,
  validateTraceSmokeOutput,
} from "./trace-artifacts";
import {
  currentGitCommitHash,
  loadTrainingRunConfig,
  mergeDefinedOptions,
  requireTrainingRunProfile,
  trainingRunConfigToTraceSmokeOptions,
} from "./training-config";

export interface TraceSmokeCliOptions {
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
}

export interface TraceSmokeGameSummary {
  gameIndex: number;
  seed: number;
  outcome: TrainingTraceSmokeMetrics["outcome"];
  winner: string | null;
  steps: number;
  decisionFrames: number;
  traceEntries: number;
  truncatedNodeCount: number;
  maxChoiceCount: number;
  replayFile: string;
}

export interface TraceSmokeRunSummary {
  schemaVersion: 1;
  profile: "trace-smoke";
  experimentId: string;
  createdAt: string;
  outputDir: string;
  config: {
    profile: "trace-smoke";
    configPath: string | null;
    commitHash: string;
    games: number;
    maxSteps: number;
    seed: number;
    maxGeneratedChoices: number;
    deckSize: number;
    skipPreGame: boolean;
  };
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
  games: TraceSmokeGameSummary[];
}

interface ParsedArgs extends TraceSmokeCliOptions {
  help?: boolean;
}

const DEFAULT_GAMES = 1;
const DEFAULT_MAX_STEPS = 80;
const DEFAULT_SEED = 1;
const DEFAULT_MAX_GENERATED_CHOICES = 256;
const DEFAULT_DECK_SIZE = 40;

export function createTrainingEngine(
  cards: readonly CardDefinition[] = ALL_CARDS as CardDefinition[]
): Engine {
  const expanded = expandCardDefinitionsWithBackFaces([...cards]);
  const cardNoMap = new Map(expanded.map((card) => [card.cardNo, card]));
  return {
    cards: [...cards],
    getCardDefinitionById: (id) => cardNoMap.get(id),
    lookups: {
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
      getRegisteredBurstActions: buildBurstEffectLookup(expanded),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(expanded),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(expanded),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(expanded),
      getRegisteredMagicActions: buildMagicLookup(expanded),
    },
  };
}

function timestampId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function normalizeOptions(options: TraceSmokeCliOptions) {
  const experimentId = options.experimentId ?? `${timestampId()}-trace-smoke`;
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
    experimentId,
    outDir: resolve(
      options.outDir ?? join("artifacts", "trace-smoke", experimentId)
    ),
  };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function gameSeed(baseSeed: number, gameIndex: number): number {
  return (baseSeed + Math.imul(gameIndex, 0x9e3779b9)) >>> 0;
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
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

function buildSummary(args: {
  options: ReturnType<typeof normalizeOptions>;
  createdAt: string;
  games: TraceSmokeGameSummary[];
  metrics: TrainingTraceSmokeMetrics[];
  replayBufferFile: string;
  replayBufferStats: TrainingReplayBufferStats;
  durationMs: number;
}): TraceSmokeRunSummary {
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
    profile: "trace-smoke",
    experimentId: args.options.experimentId,
    createdAt: args.createdAt,
    outputDir: args.options.outDir,
    config: {
      profile: "trace-smoke",
      configPath: args.options.configPath,
      commitHash: args.options.commitHash,
      games: args.options.games,
      maxSteps: args.options.maxSteps,
      seed: args.options.seed,
      maxGeneratedChoices: args.options.maxGeneratedChoices,
      deckSize: args.options.deckSize,
      skipPreGame: args.options.skipPreGame,
    },
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
    games: args.games,
  };
}

export async function runTraceSmoke(
  options: TraceSmokeCliOptions = {}
): Promise<TraceSmokeRunSummary> {
  const normalized = normalizeOptions(options);
  assertPositiveInteger("games", normalized.games);
  assertPositiveInteger("maxSteps", normalized.maxSteps);
  assertPositiveInteger("maxGeneratedChoices", normalized.maxGeneratedChoices);
  assertPositiveInteger("deckSize", normalized.deckSize);

  const startedAtMs = Date.now();
  const createdAt = new Date(startedAtMs).toISOString();
  const engine = createTrainingEngine();
  await mkdir(normalized.outDir, { recursive: true });
  const replaysDir =
    normalized.games === 1
      ? normalized.outDir
      : join(normalized.outDir, "replays");
  if (normalized.games > 1) await mkdir(replaysDir, { recursive: true });

  const traceLines: string[] = [];
  const frameLines: string[] = [];
  const replaySampleLines: string[] = [];
  const replaySamples: TrainingReplaySample[] = [];
  const gameSummaries: TraceSmokeGameSummary[] = [];
  const metrics: TrainingTraceSmokeMetrics[] = [];
  const replayBufferFile = join(normalized.outDir, "replay-buffer.jsonl");

  for (let gameIndex = 0; gameIndex < normalized.games; gameIndex++) {
    const seed = gameSeed(normalized.seed, gameIndex);
    const rng = mulberry32(seed);
    const result = playTrainingTraceSmoke({
      engine,
      rng,
      maxSteps: normalized.maxSteps,
      maxGeneratedChoices: normalized.maxGeneratedChoices,
      skipPreGame: normalized.skipPreGame,
      title: `${normalized.experimentId} game ${gameIndex}`,
      decks: [
        randomDeck(engine.cards, normalized.deckSize, rng),
        randomDeck(engine.cards, normalized.deckSize, rng),
      ],
    });
    const replayFile =
      normalized.games === 1
        ? join(normalized.outDir, "replay.json")
        : join(replaysDir, `game-${String(gameIndex).padStart(4, "0")}.json`);
    await writeFile(replayFile, JSON.stringify(result.replay, null, 2), "utf8");

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

  await writeFile(
    join(normalized.outDir, "trace.jsonl"),
    traceLines.join(""),
    "utf8"
  );
  await writeFile(
    join(normalized.outDir, "frames.jsonl"),
    frameLines.join(""),
    "utf8"
  );
  await writeFile(replayBufferFile, replaySampleLines.join(""), "utf8");
  const summary = buildSummary({
    options: normalized,
    createdAt,
    games: gameSummaries,
    metrics,
    replayBufferFile,
    replayBufferStats: summarizeTrainingReplaySamples(replaySamples),
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
    "orica trace-smoke",
    "",
    "Usage:",
    "  node apps/cli/dist/trace-smoke.js --games 10 --maxSteps 200 --seed 1",
    "",
    "Options:",
    "  --games <n>                  number of random smoke games",
    "  --maxSteps <n>               max decision steps per game",
    "  --seed <n>                   base seed",
    "  --maxGeneratedChoices <n>    cap for generated action-input choices",
    "  --deckSize <n>               cards per random deck",
    "  --out <dir>                  output directory",
    "  --experiment <id>            experiment/run id",
    "  --config <path>              JSON run profile; CLI options override it",
    "  --skipPreGame true|false     bypass contract/janken/mulligan",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

if (isDirectExecution()) {
  runTraceSmokeCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export async function runTraceSmokeCli(argv: readonly string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
  } else {
    const summary = await runTraceSmoke(await resolveTraceSmokeOptions(parsed));
    console.log(
      [
        `trace-smoke wrote ${summary.config.games} game(s) to ${summary.outputDir}`,
        `outcomes=${JSON.stringify(summary.aggregate.outcomeCounts)}`,
        `frames=${summary.aggregate.totalDecisionFrames}, truncated=${summary.aggregate.truncatedNodeCount}`,
      ].join("\n")
    );
  }
}

async function resolveTraceSmokeOptions(
  parsed: ParsedArgs
): Promise<TraceSmokeCliOptions> {
  if (parsed.configPath === undefined) return parsed;
  const loaded = await loadTrainingRunConfig(parsed.configPath);
  requireTrainingRunProfile(loaded, "trace-smoke");
  return mergeDefinedOptions(
    trainingRunConfigToTraceSmokeOptions(loaded),
    parsed
  ) as TraceSmokeCliOptions;
}
