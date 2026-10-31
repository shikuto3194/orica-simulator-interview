#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  heuristicTrainingPolicy,
  makeMctsTrainingPolicy,
  mulberry32,
  playTrainingGame,
  randomDeck,
  randomTrainingPolicy,
  type CardDefinition,
  type TrainingDecisionNodeKind,
  type TrainingGameResult,
  type TrainingPolicy,
} from "@orica/rules-core";

import { createTrainingEngine } from "./trace-smoke";
import {
  currentGitCommitHash,
  loadTrainingRunConfig,
  mergeDefinedOptions,
  requireTrainingRunProfile,
  trainingRunConfigToRolloutBaselineOptions,
  TRAINING_RUN_AGENTS,
  type TrainingRunAgentName,
} from "./training-config";

export type RolloutBaselineAgentName = TrainingRunAgentName;

export interface RolloutBaselineCliOptions {
  games?: number;
  maxSteps?: number;
  seed?: number;
  maxGeneratedChoices?: number;
  deckSize?: number;
  outDir?: string;
  experimentId?: string;
  skipPreGame?: boolean;
  agentA?: RolloutBaselineAgentName;
  agentB?: RolloutBaselineAgentName;
  configPath?: string;
  commitHash?: string;
}

export interface RolloutBaselineGameSummary {
  gameIndex: number;
  seed: number;
  seatAgents: Record<"alice" | "bob", RolloutBaselineAgentName>;
  outcome: TrainingGameResult["outcome"];
  winner: string | null;
  winnerAgent: RolloutBaselineAgentName | null;
  steps: number;
  traceEntries: number;
  truncatedNodeCount: number;
  maxChoiceCount: number;
  nodeKindCounts: Record<TrainingDecisionNodeKind, number>;
}

export interface RolloutBaselineRunSummary {
  schemaVersion: 1;
  profile: "rollout-baseline";
  experimentId: string;
  createdAt: string;
  outputDir: string;
  config: {
    profile: "rollout-baseline";
    configPath: string | null;
    commitHash: string;
    games: number;
    maxSteps: number;
    seed: number;
    maxGeneratedChoices: number;
    deckSize: number;
    skipPreGame: boolean;
    agentA: RolloutBaselineAgentName;
    agentB: RolloutBaselineAgentName;
  };
  aggregate: {
    outcomeCounts: Record<TrainingGameResult["outcome"], number>;
    agentWins: Record<RolloutBaselineAgentName, number>;
    seatWins: Record<"alice" | "bob" | "none", number>;
    totalSteps: number;
    averageSteps: number;
    totalTraceEntries: number;
    truncatedNodeCount: number;
    maxChoiceCount: number;
    nodeKindCounts: Record<TrainingDecisionNodeKind, number>;
    durationMs: number;
    stepsPerSecond: number;
  };
  games: RolloutBaselineGameSummary[];
}

interface ParsedArgs extends RolloutBaselineCliOptions {
  help?: boolean;
}

const AGENTS: Record<RolloutBaselineAgentName, TrainingPolicy> = {
  random: randomTrainingPolicy,
  heuristic: heuristicTrainingPolicy,
  mcts: makeMctsTrainingPolicy({ iterations: 16, rolloutDepth: 12 }),
  policy: () => {
    throw new Error(
      "rollout-baseline does not load policy checkpoints; use effect-debug-harvest for policy evaluation"
    );
  },
};

const DEFAULT_GAMES = 10;
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_SEED = 1;
const DEFAULT_MAX_GENERATED_CHOICES = 256;
const DEFAULT_DECK_SIZE = 40;

function timestampId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function normalizeAgent(value: string): RolloutBaselineAgentName {
  if (TRAINING_RUN_AGENTS.includes(value as RolloutBaselineAgentName)) {
    return value as RolloutBaselineAgentName;
  }
  throw new Error(`unknown agent: ${value}`);
}

function normalizeOptions(options: RolloutBaselineCliOptions) {
  const experimentId =
    options.experimentId ?? `${timestampId()}-rollout-baseline`;
  return {
    games: options.games ?? DEFAULT_GAMES,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    seed: options.seed ?? DEFAULT_SEED,
    maxGeneratedChoices:
      options.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES,
    deckSize: options.deckSize ?? DEFAULT_DECK_SIZE,
    skipPreGame: options.skipPreGame ?? false,
    agentA: options.agentA ?? "random",
    agentB: options.agentB ?? "heuristic",
    configPath: options.configPath ? resolve(options.configPath) : null,
    commitHash: options.commitHash ?? currentGitCommitHash(),
    experimentId,
    outDir: resolve(
      options.outDir ?? join("artifacts", "baseline", experimentId)
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

function emptyOutcomeCounts(): Record<TrainingGameResult["outcome"], number> {
  return { natural: 0, capped: 0, stuck: 0, error: 0 };
}

function emptyNodeKindCounts(): Record<TrainingDecisionNodeKind, number> {
  return { pregame: 0, legal_action: 0, action_input: 0 };
}

function addNodeKindCounts(
  target: Record<TrainingDecisionNodeKind, number>,
  source: Record<TrainingDecisionNodeKind, number>
): void {
  target.pregame += source.pregame;
  target.legal_action += source.legal_action;
  target.action_input += source.action_input;
}

function traceMetrics(
  result: TrainingGameResult
): Pick<
  RolloutBaselineGameSummary,
  "traceEntries" | "truncatedNodeCount" | "maxChoiceCount" | "nodeKindCounts"
> {
  const nodeKindCounts = emptyNodeKindCounts();
  let truncatedNodeCount = 0;
  let maxChoiceCount = 0;
  for (const entry of result.trace) {
    nodeKindCounts[entry.nodeKind] += 1;
    if (entry.truncated) truncatedNodeCount += 1;
    maxChoiceCount = Math.max(maxChoiceCount, entry.choiceCount);
  }
  return {
    traceEntries: result.trace.length,
    truncatedNodeCount,
    maxChoiceCount,
    nodeKindCounts,
  };
}

function buildSummary(args: {
  options: ReturnType<typeof normalizeOptions>;
  createdAt: string;
  games: RolloutBaselineGameSummary[];
  durationMs: number;
}): RolloutBaselineRunSummary {
  const outcomeCounts = emptyOutcomeCounts();
  const agentWins: Record<RolloutBaselineAgentName, number> = {
    random: 0,
    heuristic: 0,
    mcts: 0,
    policy: 0,
  };
  const seatWins: Record<"alice" | "bob" | "none", number> = {
    alice: 0,
    bob: 0,
    none: 0,
  };
  const nodeKindCounts = emptyNodeKindCounts();
  let totalSteps = 0;
  let totalTraceEntries = 0;
  let truncatedNodeCount = 0;
  let maxChoiceCount = 0;

  for (const game of args.games) {
    outcomeCounts[game.outcome] += 1;
    seatWins[
      game.winner === "alice" || game.winner === "bob" ? game.winner : "none"
    ] += 1;
    if (game.winnerAgent) agentWins[game.winnerAgent] += 1;
    addNodeKindCounts(nodeKindCounts, game.nodeKindCounts);
    totalSteps += game.steps;
    totalTraceEntries += game.traceEntries;
    truncatedNodeCount += game.truncatedNodeCount;
    maxChoiceCount = Math.max(maxChoiceCount, game.maxChoiceCount);
  }

  return {
    schemaVersion: 1,
    profile: "rollout-baseline",
    experimentId: args.options.experimentId,
    createdAt: args.createdAt,
    outputDir: args.options.outDir,
    config: {
      profile: "rollout-baseline",
      configPath: args.options.configPath,
      commitHash: args.options.commitHash,
      games: args.options.games,
      maxSteps: args.options.maxSteps,
      seed: args.options.seed,
      maxGeneratedChoices: args.options.maxGeneratedChoices,
      deckSize: args.options.deckSize,
      skipPreGame: args.options.skipPreGame,
      agentA: args.options.agentA,
      agentB: args.options.agentB,
    },
    aggregate: {
      outcomeCounts,
      agentWins,
      seatWins,
      totalSteps,
      averageSteps:
        args.games.length === 0 ? 0 : totalSteps / args.games.length,
      totalTraceEntries,
      truncatedNodeCount,
      maxChoiceCount,
      nodeKindCounts,
      durationMs: args.durationMs,
      stepsPerSecond:
        args.durationMs <= 0 ? 0 : totalSteps / (args.durationMs / 1000),
    },
    games: args.games,
  };
}

function decksForGame(
  cards: readonly CardDefinition[],
  size: number,
  rng: () => number
): [CardDefinition[], CardDefinition[]] {
  return [randomDeck(cards, size, rng), randomDeck(cards, size, rng)];
}

export async function runRolloutBaseline(
  options: RolloutBaselineCliOptions = {}
): Promise<RolloutBaselineRunSummary> {
  const normalized = normalizeOptions(options);
  assertPositiveInteger("games", normalized.games);
  assertPositiveInteger("maxSteps", normalized.maxSteps);
  assertPositiveInteger("maxGeneratedChoices", normalized.maxGeneratedChoices);
  assertPositiveInteger("deckSize", normalized.deckSize);

  const engine = createTrainingEngine();
  await mkdir(normalized.outDir, { recursive: true });
  const games: RolloutBaselineGameSummary[] = [];
  const startedAtMs = Date.now();
  const createdAt = new Date(startedAtMs).toISOString();

  for (let gameIndex = 0; gameIndex < normalized.games; gameIndex++) {
    const seed = gameSeed(normalized.seed, gameIndex);
    const rng = mulberry32(seed);
    const swapped = gameIndex % 2 === 1;
    const seatAgents: Record<"alice" | "bob", RolloutBaselineAgentName> =
      swapped
        ? { alice: normalized.agentB, bob: normalized.agentA }
        : { alice: normalized.agentA, bob: normalized.agentB };
    const result = playTrainingGame({
      engine,
      rng,
      maxSteps: normalized.maxSteps,
      maxGeneratedChoices: normalized.maxGeneratedChoices,
      skipPreGame: normalized.skipPreGame,
      decks: decksForGame(engine.cards, normalized.deckSize, rng),
      policies: {
        alice: AGENTS[seatAgents.alice],
        bob: AGENTS[seatAgents.bob],
      },
    });
    const metrics = traceMetrics(result);
    games.push({
      gameIndex,
      seed,
      seatAgents,
      outcome: result.outcome,
      winner: result.winner,
      winnerAgent:
        result.winner === "alice" || result.winner === "bob"
          ? seatAgents[result.winner]
          : null,
      steps: result.steps,
      ...metrics,
    });
  }

  const summary = buildSummary({
    options: normalized,
    createdAt,
    games,
    durationMs: Date.now() - startedAtMs,
  });
  await writeFile(
    join(normalized.outDir, "baseline.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
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
      case "--agentA":
      case "--agent-a":
        parsed.agentA = normalizeAgent(next());
        break;
      case "--agentB":
      case "--agent-b":
        parsed.agentB = normalizeAgent(next());
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
    "orica rollout-baseline",
    "",
    "Usage:",
    "  node apps/cli/dist/rollout-baseline.js --games 20 --maxSteps 200 --seed 1 --agentA random --agentB mcts",
    "",
    "Options:",
    "  --config <path>              JSON run profile; CLI options override it",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

export async function runRolloutBaselineCli(
  argv: readonly string[]
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const summary = await runRolloutBaseline(
    await resolveRolloutBaselineOptions(parsed)
  );
  console.log(
    [
      `rollout-baseline wrote ${summary.config.games} game(s) to ${summary.outputDir}`,
      `agents=${summary.config.agentA} vs ${summary.config.agentB}`,
      `outcomes=${JSON.stringify(summary.aggregate.outcomeCounts)}`,
      `agentWins=${JSON.stringify(summary.aggregate.agentWins)}`,
    ].join("\n")
  );
}

async function resolveRolloutBaselineOptions(
  parsed: ParsedArgs
): Promise<RolloutBaselineCliOptions> {
  if (parsed.configPath === undefined) return parsed;
  const loaded = await loadTrainingRunConfig(parsed.configPath);
  requireTrainingRunProfile(loaded, "rollout-baseline");
  return mergeDefinedOptions(
    trainingRunConfigToRolloutBaselineOptions(loaded),
    parsed
  ) as RolloutBaselineCliOptions;
}

if (isDirectExecution()) {
  runRolloutBaselineCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
