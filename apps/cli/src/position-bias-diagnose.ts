#!/usr/bin/env node
import {
  writeCompressedReplay,
  writeCompressedText,
} from "./compressed-artifact.js";
import {
  ArtifactWriteBudget,
  acquireArtifactWriter,
} from "./artifact-storage.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  heuristicTrainingPolicy,
  makeMctsTrainingPolicy,
  mulberry32,
  playTrainingGame,
  playTrainingTraceSmoke,
  randomDeck,
  randomTrainingPolicy,
  type CardDefinition,
  type GameState,
  type TrainingGameResult,
  type TrainingPolicy,
} from "@orica/rules-core";

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
  trainingRunConfigToPositionBiasOptions,
  TRAINING_RUN_AGENTS,
  type TrainingDeckSelectionSetName,
  type TrainingRunAgentName,
} from "./training-config";

export interface PositionBiasDiagnoseCliOptions {
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
  deckSelectionPath?: string;
  deckSet?: TrainingDeckSelectionSetName;
  writeTrace?: boolean;
  agent?: TrainingRunAgentName;
  mctsIterations?: number;
  mctsRolloutDepth?: number;
}

type DeckSourceKind = "random" | "selection";

type PositionBiasCohortName =
  | "random_decks"
  | "mirror_deck"
  | "paired_deck_swap";

interface PositionBiasGameSummary {
  gameIndex: number;
  seed: number;
  deckSeed: number;
  cohort: PositionBiasCohortName;
  deckSource: DeckSourceKind;
  decks: {
    alice: TrainingDeckDescriptor | null;
    bob: TrainingDeckDescriptor | null;
  };
  pairingIndex: number | null;
  swappedDeckSeats: boolean;
  outcome: TrainingGameResult["outcome"];
  winner: string | null;
  loser: string | null;
  reason: string | null;
  errorMessage?: string;
  lastError?: string;
  turnNumber: number;
  steps: number;
  traceEntries: number;
  replayFile: string | null;
  deckSignature: {
    alice: string;
    bob: string;
  };
}

interface PositionBiasCohortSummary {
  cohort: PositionBiasCohortName;
  games: number;
  outcomeCounts: Record<TrainingGameResult["outcome"], number>;
  winnerCounts: Record<"alice" | "bob" | "none", number>;
  firstSeatWinRateAmongDecisive: number | null;
  nondecisiveRate: number;
  averageTurnNumber: number;
  averageSteps: number;
  reasonByLoser: Record<"alice" | "bob", Record<string, number>>;
}

export interface PositionBiasDiagnoseRunSummary {
  schemaVersion: 1;
  profile: "position-bias-diagnose";
  experimentId: string;
  createdAt: string;
  outputDir: string;
  config: {
    profile: "position-bias-diagnose";
    configPath: string | null;
    commitHash: string;
    games: number;
    maxSteps: number;
    seed: number;
    maxGeneratedChoices: number;
    deckSize: number;
    skipPreGame: boolean;
    deckSource: DeckSourceKind;
    deckSelectionPath: string | null;
    deckSet: TrainingDeckSelectionSetName | null;
    writeTrace: boolean;
    traceFile: string | null;
    replayDir: string | null;
    agent: TrainingRunAgentName;
    mctsIterations: number;
    mctsRolloutDepth: number;
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
  ruleReference: {
    path: string;
    summary: string;
  };
  cohorts: PositionBiasCohortSummary[];
  games: PositionBiasGameSummary[];
}

interface ParsedArgs extends PositionBiasDiagnoseCliOptions {
  help?: boolean;
}

const DEFAULT_GAMES = 20;
const DEFAULT_MAX_STEPS = 800;
const DEFAULT_SEED = 1;
const DEFAULT_MAX_GENERATED_CHOICES = 256;
const DEFAULT_DECK_SIZE = 40;
const DEFAULT_DECK_SET: TrainingDeckSelectionSetName = "gauntletCore";
const DEFAULT_AGENT: TrainingRunAgentName = "random";
const DEFAULT_MCTS_ITERATIONS = 16;
const DEFAULT_MCTS_ROLLOUT_DEPTH = 12;
const COHORTS: readonly PositionBiasCohortName[] = [
  "random_decks",
  "mirror_deck",
  "paired_deck_swap",
];

function timestampId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function normalizeOptions(options: PositionBiasDiagnoseCliOptions) {
  const experimentId = options.experimentId ?? `${timestampId()}-position-bias`;
  return {
    games: options.games ?? DEFAULT_GAMES,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    seed: options.seed ?? DEFAULT_SEED,
    maxGeneratedChoices:
      options.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES,
    deckSize: options.deckSize ?? DEFAULT_DECK_SIZE,
    skipPreGame: options.skipPreGame ?? true,
    configPath: options.configPath ? resolve(options.configPath) : null,
    commitHash: options.commitHash ?? currentGitCommitHash(),
    deckSelectionPath: options.deckSelectionPath
      ? resolve(options.deckSelectionPath)
      : null,
    deckSet: options.deckSet ?? DEFAULT_DECK_SET,
    writeTrace: options.writeTrace ?? false,
    agent: options.agent ?? DEFAULT_AGENT,
    mctsIterations: options.mctsIterations ?? DEFAULT_MCTS_ITERATIONS,
    mctsRolloutDepth: options.mctsRolloutDepth ?? DEFAULT_MCTS_ROLLOUT_DEPTH,
    experimentId,
    outDir: resolve(
      options.outDir ?? join("artifacts", "position-bias", experimentId)
    ),
  };
}

function buildAgentPolicy(
  agent: TrainingRunAgentName,
  options: { mctsIterations: number; mctsRolloutDepth: number }
): TrainingPolicy {
  switch (agent) {
    case "random":
      return randomTrainingPolicy;
    case "heuristic":
      return heuristicTrainingPolicy;
    case "mcts":
      return makeMctsTrainingPolicy({
        iterations: options.mctsIterations,
        rolloutDepth: options.mctsRolloutDepth,
      });
    case "policy":
      throw new Error(
        "position-bias-diagnose does not load policy checkpoints; use effect-debug-harvest for policy evaluation"
      );
  }
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function normalizeAgent(value: string): TrainingRunAgentName {
  if (TRAINING_RUN_AGENTS.includes(value as TrainingRunAgentName)) {
    return value as TrainingRunAgentName;
  }
  throw new Error(`unknown agent: ${value}`);
}

function gameSeed(
  baseSeed: number,
  cohortIndex: number,
  gameIndex: number
): number {
  return (
    (baseSeed +
      Math.imul(cohortIndex + 1, 0x85ebca6b) +
      Math.imul(gameIndex, 0x9e3779b9)) >>>
    0
  );
}

function deckSeed(
  baseSeed: number,
  cohortIndex: number,
  gameIndex: number
): number {
  return (
    (baseSeed +
      Math.imul(cohortIndex + 1, 0x85ebca6b) +
      Math.imul(Math.floor(gameIndex / 2), 0x9e3779b9)) >>>
    0
  );
}

function deckSignature(deck: readonly CardDefinition[]): string {
  const counts = new Map<string, number>();
  for (const card of deck)
    counts.set(card.cardNo, (counts.get(card.cardNo) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cardNo, count]) => `${cardNo}x${count}`)
    .join(",");
}

function resultFromFinalState(state: GameState | undefined): {
  loser: string | null;
  reason: string | null;
  turnNumber: number;
} {
  if (!state) return { loser: null, reason: null, turnNumber: 0 };
  const result = state.gameResult;
  return {
    loser:
      result && "losingPlayerId" in result
        ? (result.losingPlayerId ?? null)
        : null,
    reason: result?.reason ?? null,
    turnNumber: state.turnNumber,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PositionBiasDeckPlan {
  decks: [CardDefinition[], CardDefinition[]];
  deckSource: DeckSourceKind;
  deckSummaries: {
    alice: TrainingDeckDescriptor | null;
    bob: TrainingDeckDescriptor | null;
  };
  pairingIndex: number | null;
  swappedDeckSeats: boolean;
}

function randomPairedSwapDecks(
  cards: readonly CardDefinition[],
  size: number,
  seed: number,
  swapped: boolean
): [CardDefinition[], CardDefinition[]] {
  const rng = mulberry32(seed);
  const first = randomDeck(cards, size, rng);
  const second = randomDeck(cards, size, rng);
  return swapped ? [[...second], [...first]] : [first, second];
}

function selectedPairedSwapDecks(
  pool: TrainingDeckPool,
  seed: number,
  swapped: boolean
): PositionBiasDeckPlan {
  const rng = mulberry32(seed);
  const first = chooseTrainingDeck(pool, rng);
  const second = chooseTrainingDeck(pool, rng, first.id);
  const alice = swapped ? second : first;
  const bob = swapped ? first : second;
  return {
    decks: [cloneTrainingDeckCards(alice), cloneTrainingDeckCards(bob)],
    deckSource: "selection",
    deckSummaries: {
      alice: summarizeTrainingDeck(alice),
      bob: summarizeTrainingDeck(bob),
    },
    pairingIndex: null,
    swappedDeckSeats: swapped,
  };
}

function decksForCohort(args: {
  cohort: PositionBiasCohortName;
  cards: readonly CardDefinition[];
  deckSize: number;
  seed: number;
  gameIndex: number;
  deckPool: TrainingDeckPool | null;
}): PositionBiasDeckPlan {
  const rng = mulberry32(args.seed);
  switch (args.cohort) {
    case "random_decks": {
      if (args.deckPool !== null) {
        const alice = chooseTrainingDeck(args.deckPool, rng);
        const bob = chooseTrainingDeck(args.deckPool, rng, alice.id);
        return {
          decks: [cloneTrainingDeckCards(alice), cloneTrainingDeckCards(bob)],
          deckSource: "selection",
          deckSummaries: {
            alice: summarizeTrainingDeck(alice),
            bob: summarizeTrainingDeck(bob),
          },
          pairingIndex: null,
          swappedDeckSeats: false,
        };
      }
      return {
        decks: [
          randomDeck(args.cards, args.deckSize, rng),
          randomDeck(args.cards, args.deckSize, rng),
        ],
        deckSource: "random",
        deckSummaries: { alice: null, bob: null },
        pairingIndex: null,
        swappedDeckSeats: false,
      };
    }
    case "mirror_deck": {
      if (args.deckPool !== null) {
        const base = chooseTrainingDeck(args.deckPool, rng);
        return {
          decks: [cloneTrainingDeckCards(base), cloneTrainingDeckCards(base)],
          deckSource: "selection",
          deckSummaries: {
            alice: summarizeTrainingDeck(base),
            bob: summarizeTrainingDeck(base),
          },
          pairingIndex: null,
          swappedDeckSeats: false,
        };
      }
      const base = randomDeck(args.cards, args.deckSize, rng);
      return {
        decks: [[...base], [...base]],
        deckSource: "random",
        deckSummaries: { alice: null, bob: null },
        pairingIndex: null,
        swappedDeckSeats: false,
      };
    }
    case "paired_deck_swap": {
      const pairingIndex = Math.floor(args.gameIndex / 2);
      const swappedDeckSeats = args.gameIndex % 2 === 1;
      if (args.deckPool !== null) {
        return {
          ...selectedPairedSwapDecks(
            args.deckPool,
            args.seed ^ Math.imul(pairingIndex + 1, 0x27d4eb2d),
            swappedDeckSeats
          ),
          pairingIndex,
        };
      }
      return {
        decks: randomPairedSwapDecks(
          args.cards,
          args.deckSize,
          args.seed ^ Math.imul(pairingIndex + 1, 0x27d4eb2d),
          swappedDeckSeats
        ),
        deckSource: "random",
        deckSummaries: { alice: null, bob: null },
        pairingIndex,
        swappedDeckSeats,
      };
    }
  }
}

function emptyOutcomeCounts(): Record<TrainingGameResult["outcome"], number> {
  return { natural: 0, capped: 0, stuck: 0, error: 0 };
}

function summarizeCohort(
  cohort: PositionBiasCohortName,
  games: readonly PositionBiasGameSummary[]
): PositionBiasCohortSummary {
  const outcomeCounts = emptyOutcomeCounts();
  const winnerCounts: Record<"alice" | "bob" | "none", number> = {
    alice: 0,
    bob: 0,
    none: 0,
  };
  const reasonByLoser: Record<"alice" | "bob", Record<string, number>> = {
    alice: {},
    bob: {},
  };
  let turnSum = 0;
  let stepSum = 0;
  for (const game of games) {
    outcomeCounts[game.outcome] += 1;
    winnerCounts[
      game.winner === "alice" || game.winner === "bob" ? game.winner : "none"
    ] += 1;
    if (game.loser === "alice" || game.loser === "bob") {
      const reason = game.reason ?? "unknown";
      reasonByLoser[game.loser][reason] =
        (reasonByLoser[game.loser][reason] ?? 0) + 1;
    }
    turnSum += game.turnNumber;
    stepSum += game.steps;
  }
  const decisive = winnerCounts.alice + winnerCounts.bob;
  return {
    cohort,
    games: games.length,
    outcomeCounts,
    winnerCounts,
    firstSeatWinRateAmongDecisive:
      decisive === 0 ? null : winnerCounts.alice / decisive,
    nondecisiveRate: games.length === 0 ? 0 : winnerCounts.none / games.length,
    averageTurnNumber: games.length === 0 ? 0 : turnSum / games.length,
    averageSteps: games.length === 0 ? 0 : stepSum / games.length,
    reasonByLoser,
  };
}

function summarizeDeckPool(
  pool: TrainingDeckPool | null
): PositionBiasDiagnoseRunSummary["deckPool"] {
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

export async function runPositionBiasDiagnose(
  options: PositionBiasDiagnoseCliOptions = {}
): Promise<PositionBiasDiagnoseRunSummary> {
  const normalized = normalizeOptions(options);
  assertPositiveInteger("games", normalized.games);
  assertPositiveInteger("maxSteps", normalized.maxSteps);
  assertPositiveInteger("maxGeneratedChoices", normalized.maxGeneratedChoices);
  assertPositiveInteger("deckSize", normalized.deckSize);
  assertPositiveInteger("mctsIterations", normalized.mctsIterations);
  assertPositiveInteger("mctsRolloutDepth", normalized.mctsRolloutDepth);

  const engine = createTrainingEngine();
  const deckPool =
    normalized.deckSelectionPath === null
      ? null
      : await loadTrainingDeckPool({
          path: normalized.deckSelectionPath,
          setName: normalized.deckSet,
          engine,
        });
  const createdAt = new Date().toISOString();
  await mkdir(normalized.outDir, { recursive: true });
  const releaseWriter = acquireArtifactWriter(normalized.outDir);
  try {
    const storageBudget = new ArtifactWriteBudget(normalized.outDir);
    const policy = buildAgentPolicy(normalized.agent, normalized);
    const traceFile = normalized.writeTrace
      ? join(normalized.outDir, "trace.jsonl.gz")
      : null;
    const replayDir = normalized.writeTrace
      ? join(normalized.outDir, "replays")
      : null;
    if (replayDir !== null) await mkdir(replayDir, { recursive: true });

    const games: PositionBiasGameSummary[] = [];
    const traceLines: string[] = [];
    for (const [cohortIndex, cohort] of COHORTS.entries()) {
      for (let gameIndex = 0; gameIndex < normalized.games; gameIndex++) {
        const seed = gameSeed(normalized.seed, cohortIndex, gameIndex);
        const generatedDeckSeed =
          cohort === "paired_deck_swap"
            ? deckSeed(normalized.seed, cohortIndex, gameIndex)
            : seed;
        const deckPlan = decksForCohort({
          cohort,
          cards: engine.cards,
          deckSize: normalized.deckSize,
          seed: generatedDeckSeed,
          gameIndex,
          deckPool,
        });
        const deckSignatures = {
          alice: deckSignature(deckPlan.decks[0]),
          bob: deckSignature(deckPlan.decks[1]),
        };
        try {
          const replayFile =
            replayDir === null
              ? null
              : join(
                  replayDir,
                  `${cohort}-game-${String(gameIndex).padStart(4, "0")}.jsonl.gz`
                );
          const playOptions = {
            engine,
            rng: mulberry32(seed),
            maxSteps: normalized.maxSteps,
            maxGeneratedChoices: normalized.maxGeneratedChoices,
            skipPreGame: normalized.skipPreGame,
            decks: deckPlan.decks,
            policies: { alice: policy, bob: policy },
          };
          const result = normalized.writeTrace
            ? playTrainingTraceSmoke({
                ...playOptions,
                title: `${normalized.experimentId} ${cohort} game ${gameIndex}`,
              })
            : playTrainingGame(playOptions);
          const final = resultFromFinalState(result.finalState);
          if (replayFile !== null && "replay" in result) {
            await writeCompressedReplay(
              replayFile,
              result.replay,
              storageBudget
            );
          }
          if (normalized.writeTrace) {
            for (const entry of result.trace) {
              traceLines.push(
                jsonLine({
                  cohort,
                  gameIndex,
                  seed,
                  deckSeed: generatedDeckSeed,
                  ...entry,
                })
              );
            }
          }
          games.push({
            gameIndex,
            seed,
            deckSeed: generatedDeckSeed,
            cohort,
            deckSource: deckPlan.deckSource,
            decks: deckPlan.deckSummaries,
            pairingIndex: deckPlan.pairingIndex,
            swappedDeckSeats: deckPlan.swappedDeckSeats,
            outcome: result.outcome,
            winner: result.winner,
            loser: final.loser,
            reason: final.reason,
            ...(result.lastError ? { lastError: result.lastError } : {}),
            turnNumber: final.turnNumber,
            steps: result.steps,
            traceEntries: result.trace.length,
            replayFile,
            deckSignature: deckSignatures,
          });
        } catch (error) {
          storageBudget.assertHealthy();
          if (normalized.writeTrace) {
            traceLines.push(
              jsonLine({
                cohort,
                gameIndex,
                seed,
                deckSeed: generatedDeckSeed,
                kind: "error",
                message: errorMessage(error),
              })
            );
          }
          games.push({
            gameIndex,
            seed,
            deckSeed: generatedDeckSeed,
            cohort,
            deckSource: deckPlan.deckSource,
            decks: deckPlan.deckSummaries,
            pairingIndex: deckPlan.pairingIndex,
            swappedDeckSeats: deckPlan.swappedDeckSeats,
            outcome: "error",
            winner: null,
            loser: null,
            reason: "exception",
            errorMessage: errorMessage(error),
            turnNumber: 0,
            steps: 0,
            traceEntries: 0,
            replayFile: null,
            deckSignature: deckSignatures,
          });
        }
      }
    }

    const summary: PositionBiasDiagnoseRunSummary = {
      schemaVersion: 1,
      profile: "position-bias-diagnose",
      experimentId: normalized.experimentId,
      createdAt,
      outputDir: normalized.outDir,
      config: {
        profile: "position-bias-diagnose",
        configPath: normalized.configPath,
        commitHash: normalized.commitHash,
        games: normalized.games,
        maxSteps: normalized.maxSteps,
        seed: normalized.seed,
        maxGeneratedChoices: normalized.maxGeneratedChoices,
        deckSize: normalized.deckSize,
        skipPreGame: normalized.skipPreGame,
        deckSource:
          normalized.deckSelectionPath === null ? "random" : "selection",
        deckSelectionPath: normalized.deckSelectionPath,
        deckSet:
          normalized.deckSelectionPath === null ? null : normalized.deckSet,
        writeTrace: normalized.writeTrace,
        traceFile,
        replayDir,
        agent: normalized.agent,
        mctsIterations: normalized.mctsIterations,
        mctsRolloutDepth: normalized.mctsRolloutDepth,
      },
      deckPool: summarizeDeckPool(deckPool),
      ruleReference: {
        path: "manual/ai-reference/10_rules/02_turn-flow-and-timing.md",
        summary:
          "先攻1ターン目はアタック/コアステップをスキップし、ドローステップは行う。",
      },
      cohorts: COHORTS.map((cohort) =>
        summarizeCohort(
          cohort,
          games.filter((game) => game.cohort === cohort)
        )
      ),
      games,
    };

    await writeFile(
      join(normalized.outDir, "position-bias.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );
    if (traceFile !== null) {
      await writeCompressedText(
        traceFile,
        traceLines.join(""),
        storageBudget,
        true
      );
    }
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
      case "--writeTrace":
      case "--write-trace":
        parsed.writeTrace = parseBoolean(next());
        break;
      case "--agent":
        parsed.agent = normalizeAgent(next());
        break;
      case "--mctsIterations":
      case "--mcts-iterations":
        parsed.mctsIterations = Number(next());
        break;
      case "--mctsRolloutDepth":
      case "--mcts-rollout-depth":
        parsed.mctsRolloutDepth = Number(next());
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
    "orica position-bias-diagnose",
    "",
    "Usage:",
    "  node scripts/position-bias-diagnose.mjs --games 80 --maxSteps 1500 --seed 1",
    "",
    "Options:",
    "  --config <path>              JSON run profile; CLI options override it",
    "  --games <n>                  games per cohort",
    "  --skipPreGame true|false     true keeps alice as fixed first player",
    "  --deckSelection <path>       selected-decks.json from deck selection export",
    "  --deckSet <name>             selection set, default gauntletCore",
    "  --agent <name>               random | heuristic | mcts, default random",
    "  --mctsIterations <n>         MCTS iterations when --agent mcts, default 16",
    "  --mctsRolloutDepth <n>       MCTS rollout depth when --agent mcts, default 12",
    "  --writeTrace true|false      write trace.jsonl for stuck/cap inspection",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

export async function runPositionBiasDiagnoseCli(
  argv: readonly string[]
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const summary = await runPositionBiasDiagnose(
    await resolvePositionBiasOptions(parsed)
  );
  console.log(
    [
      `position-bias wrote ${summary.games.length} game(s) to ${summary.outputDir}`,
      `agent=${summary.config.agent}`,
      ...summary.cohorts.map((cohort) => {
        const rate =
          cohort.firstSeatWinRateAmongDecisive === null
            ? "n/a"
            : `${(cohort.firstSeatWinRateAmongDecisive * 100).toFixed(1)}%`;
        return `${cohort.cohort}: alice(first) decisive win-rate=${rate}, outcomes=${JSON.stringify(cohort.outcomeCounts)}`;
      }),
    ].join("\n")
  );
}

async function resolvePositionBiasOptions(
  parsed: ParsedArgs
): Promise<PositionBiasDiagnoseCliOptions> {
  if (parsed.configPath === undefined) return parsed;
  const loaded = await loadTrainingRunConfig(parsed.configPath);
  requireTrainingRunProfile(loaded, "position-bias-diagnose");
  return mergeDefinedOptions(
    trainingRunConfigToPositionBiasOptions(loaded),
    parsed
  ) as PositionBiasDiagnoseCliOptions;
}

if (isDirectExecution()) {
  runPositionBiasDiagnoseCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
