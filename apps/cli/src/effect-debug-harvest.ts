#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  CompressedArtifactWriter,
  CompressedReplayWriter,
  writeCompressedText,
} from "./compressed-artifact.js";
import { pathToFileURL } from "node:url";
import {
  ArtifactWriteBudget,
  acquireArtifactWriter,
} from "./artifact-storage.js";

import {
  collectGameStateInvariantIssues,
  createTinyPolicyValueNetwork,
  getCardDefinitionMainDeckMaxCount,
  heuristicTrainingPolicy,
  isContractDefinition,
  makeMctsTrainingPolicy,
  makePolicyValueTrainingPolicy,
  mulberry32,
  playTrainingTraceSmoke,
  randomDeck,
  randomTrainingPolicy,
  type CardDefinition,
  type GameStateInvariantIssue,
  type TrainingDecisionTraceEntry,
  type TrainingGameResult,
  type TrainingPolicy,
  type TrainingTraceSmokeMetrics,
  type TrainingTraceSmokeResult,
} from "@orica/rules-core";

import { createTrainingEngine } from "./trace-smoke";
import { loadPolicyCheckpointArtifact } from "./policy-bootstrap";
import {
  currentGitCommitHash,
  loadTrainingRunConfig,
  mergeDefinedOptions,
  requireTrainingRunProfile,
  TRAINING_RUN_AGENTS,
  trainingRunConfigToEffectDebugHarvestOptions,
  type TrainingRunAgentName,
} from "./training-config";

export type EffectDebugTicketKind =
  | "hard_failure"
  | "capped"
  | "slow_game"
  | "state_invariant"
  | "truncated_choice_surface"
  | "wide_choice_surface";

export type EffectDebugTicketSeverity = "critical" | "high" | "medium" | "low";

export interface EffectDebugHarvestCliOptions {
  games?: number;
  maxSteps?: number;
  maxForcedTransitions?: number;
  maxRepeatedStateTransitions?: number;
  /** Per-game elapsed-time cap that materializes a durable capped artifact. */
  maxGameDurationMs?: number;
  /** Retry only elapsed-time caps with the same seed before quarantining them. */
  maxGameDurationRetries?: number;
  /** Multiplier used for each elapsed-time retry. */
  maxGameDurationMultiplier?: number;
  /** Upper bound for an elapsed-time retry. */
  maxGameDurationCeilingMs?: number;
  /** Extra deterministic seeds available to replace elapsed-time-capped games. */
  maxReplacementGames?: number;
  seed?: number;
  maxGeneratedChoices?: number;
  deckSize?: number;
  deckStrategy?: "random" | "coverage_guided";
  focusCardCount?: number;
  outDir?: string;
  experimentId?: string;
  skipPreGame?: boolean;
  agentA?: TrainingRunAgentName;
  agentB?: TrainingRunAgentName;
  wideChoiceThreshold?: number;
  configPath?: string;
  commitHash?: string;
  /**
   * Durable per-game progress ledger. A rerun with the same deterministic
   * configuration resumes only the games recorded here.
   */
  checkpointFile?: string;
  policyCheckpointPath?: string;
  policyExplorationRate?: number;
  /** Deterministic per-attempt game clock injection for bounded tests. */
  gameClockFactory?: (context: {
    gameIndex: number;
    seed: number;
    attemptIndex: number;
    maxDurationMs: number;
  }) => () => number;
}

export interface EffectDebugTicket {
  schemaVersion: 1;
  ticketId: string;
  kind: EffectDebugTicketKind;
  severity: EffectDebugTicketSeverity;
  confidence: "reproducible" | "suspicious";
  title: string;
  gameIndex: number;
  seed: number;
  /** Zero-based transition coordinate of the suspect recorded in the replay. */
  step: number;
  /** Number of policy-controlled decisions consumed by the run. */
  decisionSteps: number;
  /** Number of executed transitions in the run. */
  transitionSteps: number;
  replayFile: string;
  ticketFile: string;
  rerunCommand: string;
  lastError?: string;
  suspect: {
    nodeKind?: TrainingDecisionTraceEntry["nodeKind"];
    actionKind?: string;
    actionId?: string;
    systemActionKind?: string;
    choiceId?: string;
    sourceCardNo?: string;
    sourceDefinitionId?: string;
    fields: readonly string[];
  };
  details: Record<string, unknown>;
}

export interface EffectDebugGameSummary {
  gameIndex: number;
  seed: number;
  seatAgents: Record<"alice" | "bob", TrainingRunAgentName>;
  outcome: TrainingGameResult["outcome"];
  winner: string | null;
  /** Backward-compatible alias for transitionSteps. */
  steps: number;
  decisionSteps: number;
  transitionSteps: number;
  terminationReason?: TrainingGameResult["terminationReason"];
  decisionFrames: number;
  traceEntries: number;
  truncatedNodeCount: number;
  maxChoiceCount: number;
  durationMs: number;
  durationAttemptsMs: number[];
  timeLimitRetryCount: number;
  effectiveMaxGameDurationMs: number;
  deckStrategy: "random" | "coverage_guided";
  focusedCardNos: string[];
  replayFile: string;
  ticketIds: string[];
}

export interface EffectDebugSemanticCoverage {
  /** Executed effect-bearing cards, keyed by printed card number. */
  cards: Record<string, number>;
  /** Executed effect references, such as `BSSG01-R01#effect:1`. */
  effects: Record<string, number>;
  /** Executed DSL step references when an action preserves step metadata. */
  dslSteps: Record<string, number>;
  /** Executed legal-action kinds. */
  actions: Record<string, number>;
  executedActionFrames: number;
  /** Actions whose kind was unavailable and therefore cannot be classified. */
  unattributedActionFrames: number;
  /** Effect index metadata without a source card; never semantic evidence. */
  unattributedEffectRefs: number;
  /** DSL step metadata without source/effect provenance; never evidence. */
  unattributedDslStepRefs: number;
}

export interface EffectDebugChoiceSurfaceCoverage {
  decisionFrames: number;
  cappedGameCount: number;
  truncatedDecisionFrames: number;
  maxChoiceCount: number;
  wideDecisionFrames: number;
  choiceCountBuckets: Record<string, number>;
  truncatedByAction: Record<string, number>;
  truncatedByCard: Record<string, number>;
}

export interface EffectDebugCoverageReport {
  schemaVersion: 1;
  semantic: EffectDebugSemanticCoverage;
  choiceSurface: EffectDebugChoiceSurfaceCoverage;
}

export interface EffectDebugHarvestRunSummary {
  schemaVersion: 1;
  profile: "effect-debug-harvest";
  experimentId: string;
  createdAt: string;
  outputDir: string;
  config: {
    profile: "effect-debug-harvest";
    configPath: string | null;
    commitHash: string;
    games: number;
    maxSteps: number;
    maxForcedTransitions: number;
    maxRepeatedStateTransitions: number;
    maxGameDurationMs: number;
    maxGameDurationRetries: number;
    maxGameDurationMultiplier: number;
    maxGameDurationCeilingMs: number;
    maxReplacementGames: number;
    seed: number;
    maxGeneratedChoices: number;
    deckSize: number;
    deckStrategy: "random" | "coverage_guided";
    focusCardCount: number;
    skipPreGame: boolean;
    agentA: TrainingRunAgentName;
    agentB: TrainingRunAgentName;
    wideChoiceThreshold: number;
    checkpointFile: string;
    policyCheckpointPath: string | null;
    policyCheckpointSha256: string | null;
    policyExplorationRate: number;
  };
  aggregate: {
    outcomeCounts: Record<TrainingGameResult["outcome"], number>;
    winnerCounts: Record<string, number>;
    ticketCounts: Record<EffectDebugTicketKind, number>;
    severityCounts: Record<EffectDebugTicketSeverity, number>;
    totalTickets: number;
    /** Backward-compatible alias for totalTransitionSteps. */
    totalSteps: number;
    averageSteps: number;
    totalDecisionSteps: number;
    totalTransitionSteps: number;
    averageDecisionSteps: number;
    averageTransitionSteps: number;
    totalDecisionFrames: number;
    totalTraceEntries: number;
    truncatedNodeCount: number;
    truncatedNodeRate: number;
    maxChoiceCount: number;
    durationMs: number;
    attemptedGames: number;
    qualifyingGames: number;
    elapsedTimeReplacementCount: number;
    retriedGameCount: number;
    totalTimeLimitRetries: number;
    stepsPerSecond: number;
    coverage: EffectDebugCoverageReport;
    cleanCoverage: EffectDebugCoverageReport;
  };
  ticketsFile: string;
  ticketsDir: string;
  games: EffectDebugGameSummary[];
  tickets: EffectDebugTicket[];
}

interface NormalizedOptions {
  games: number;
  maxSteps: number;
  maxForcedTransitions: number;
  maxRepeatedStateTransitions: number;
  maxGameDurationMs: number;
  maxGameDurationRetries: number;
  maxGameDurationMultiplier: number;
  maxGameDurationCeilingMs: number;
  maxReplacementGames: number;
  seed: number;
  maxGeneratedChoices: number;
  deckSize: number;
  deckStrategy: "random" | "coverage_guided";
  focusCardCount: number;
  skipPreGame: boolean;
  agentA: TrainingRunAgentName;
  agentB: TrainingRunAgentName;
  wideChoiceThreshold: number;
  configPath: string | null;
  commitHash: string;
  experimentId: string;
  outDir: string;
  checkpointFile: string;
  policyCheckpointPath: string | null;
  policyCheckpointSha256: string | null;
  policyExplorationRate: number;
}

interface EffectDebugGameCheckpointRecordV1 {
  schemaVersion: 1;
  game: EffectDebugGameSummary;
  metrics: TrainingTraceSmokeMetrics;
  traceLines: string[];
  frameLines: string[];
  tickets: EffectDebugTicket[];
}

interface EffectDebugGameCheckpointRecordV2 {
  schemaVersion: 2;
  game: EffectDebugGameSummary;
  metrics: TrainingTraceSmokeMetrics;
  traceFile: string;
  framesFile: string;
  coverage: EffectDebugCoverageReport;
  tickets: EffectDebugTicket[];
}

type EffectDebugGameCheckpointRecord =
  | EffectDebugGameCheckpointRecordV1
  | EffectDebugGameCheckpointRecordV2;

interface ElapsedTimeAttemptEvidence {
  attemptIndex: number;
  maxDurationMs: number;
  durationMs: number;
  result: TrainingTraceSmokeResult;
  replayFile: string;
  traceFile: string;
  framesFile: string;
}

interface EffectDebugCheckpoint {
  schemaVersion: 1;
  config: Pick<
    NormalizedOptions,
    | "commitHash"
    | "games"
    | "maxSteps"
    | "maxForcedTransitions"
    | "maxRepeatedStateTransitions"
    | "maxGameDurationMs"
    | "maxGameDurationRetries"
    | "maxGameDurationMultiplier"
    | "maxGameDurationCeilingMs"
    | "maxReplacementGames"
    | "seed"
    | "maxGeneratedChoices"
    | "deckSize"
    | "deckStrategy"
    | "focusCardCount"
    | "skipPreGame"
    | "agentA"
    | "agentB"
    | "wideChoiceThreshold"
    | "policyCheckpointPath"
    | "policyCheckpointSha256"
    | "policyExplorationRate"
  >;
  createdAt: string;
  updatedAt: string;
  completedGameIndexes: number[];
  runtime: {
    totalGameDurationMs: number;
    maxGameDurationMs: number;
    lastGameDurationMs: number | null;
  };
}

interface ParsedArgs extends EffectDebugHarvestCliOptions {
  help?: boolean;
}

const DEFAULT_GAMES = 10;
const DEFAULT_MAX_STEPS = 4000;
const DEFAULT_MAX_FORCED_TRANSITIONS = 1000;
const DEFAULT_MAX_REPEATED_STATE_TRANSITIONS = 4;
const DEFAULT_MAX_GAME_DURATION_MS = 60_000;
const DEFAULT_MAX_GAME_DURATION_RETRIES = 2;
const DEFAULT_MAX_GAME_DURATION_MULTIPLIER = 2;
const DEFAULT_MAX_GAME_DURATION_CEILING_MS = 240_000;
const DEFAULT_MAX_REPLACEMENT_GAMES = 0;
const DEFAULT_SEED = 1;
const DEFAULT_MAX_GENERATED_CHOICES = 1024;
const DEFAULT_DECK_SIZE = 40;
const DEFAULT_DECK_STRATEGY = "random" as const;
const DEFAULT_FOCUS_CARD_COUNT = 8;
const DEFAULT_WIDE_CHOICE_THRESHOLD = 128;
const DEFAULT_POLICY_EXPLORATION_RATE = 0.15;

function timestampId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function normalizeOptions(
  options: EffectDebugHarvestCliOptions
): NormalizedOptions {
  const experimentId =
    options.experimentId ?? `${timestampId()}-effect-debug-harvest`;
  const outDir = resolve(
    options.outDir ?? join("artifacts", "effect-debug", experimentId)
  );
  return {
    games: options.games ?? DEFAULT_GAMES,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    maxForcedTransitions:
      options.maxForcedTransitions ?? DEFAULT_MAX_FORCED_TRANSITIONS,
    maxRepeatedStateTransitions:
      options.maxRepeatedStateTransitions ??
      DEFAULT_MAX_REPEATED_STATE_TRANSITIONS,
    maxGameDurationMs:
      options.maxGameDurationMs ?? DEFAULT_MAX_GAME_DURATION_MS,
    maxGameDurationRetries:
      options.maxGameDurationRetries ?? DEFAULT_MAX_GAME_DURATION_RETRIES,
    maxGameDurationMultiplier:
      options.maxGameDurationMultiplier ?? DEFAULT_MAX_GAME_DURATION_MULTIPLIER,
    maxGameDurationCeilingMs: Math.max(
      options.maxGameDurationMs ?? DEFAULT_MAX_GAME_DURATION_MS,
      options.maxGameDurationCeilingMs ?? DEFAULT_MAX_GAME_DURATION_CEILING_MS
    ),
    maxReplacementGames:
      options.maxReplacementGames ?? DEFAULT_MAX_REPLACEMENT_GAMES,
    seed: options.seed ?? DEFAULT_SEED,
    maxGeneratedChoices:
      options.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES,
    deckSize: options.deckSize ?? DEFAULT_DECK_SIZE,
    deckStrategy: options.deckStrategy ?? DEFAULT_DECK_STRATEGY,
    focusCardCount: options.focusCardCount ?? DEFAULT_FOCUS_CARD_COUNT,
    skipPreGame: options.skipPreGame ?? false,
    agentA: options.agentA ?? "random",
    agentB: options.agentB ?? "random",
    wideChoiceThreshold:
      options.wideChoiceThreshold ?? DEFAULT_WIDE_CHOICE_THRESHOLD,
    configPath: options.configPath ? resolve(options.configPath) : null,
    commitHash: options.commitHash ?? currentGitCommitHash(),
    experimentId,
    outDir,
    checkpointFile: resolve(
      options.checkpointFile ?? join(outDir, "checkpoint.json")
    ),
    policyCheckpointPath: options.policyCheckpointPath
      ? resolve(options.policyCheckpointPath)
      : null,
    policyCheckpointSha256: null,
    policyExplorationRate:
      options.policyExplorationRate ?? DEFAULT_POLICY_EXPLORATION_RATE,
  } satisfies NormalizedOptions;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function gameSeed(baseSeed: number, gameIndex: number): number {
  return (baseSeed + Math.imul(gameIndex, 0x9e3779b9)) >>> 0;
}

function focusOrder(cardNo: string, salt: number): number {
  let hash = salt >>> 0;
  for (let index = 0; index < cardNo.length; index += 1) {
    hash = Math.imul(hash ^ cardNo.charCodeAt(index), 0x45d9f3b) >>> 0;
  }
  return hash;
}

export function buildCoverageGuidedDeck(
  cards: readonly CardDefinition[],
  size: number,
  rng: () => number,
  observedCardCounts: Readonly<Record<string, number>>,
  focusCardCount = DEFAULT_FOCUS_CARD_COUNT,
  salt = 0
): { deck: CardDefinition[]; focusedCardNos: string[] } {
  // Keep random filler contract-free. A single least-covered contract is added
  // below as an explicit focus card, so setup can present it deterministically
  // without a second contract displacing the intended opening cards.
  const ordinaryCards = cards.filter((card) => !isContractDefinition(card));
  const deck = randomDeck(
    ordinaryCards.length > 0 ? ordinaryCards : cards,
    size,
    rng
  );
  if (focusCardCount <= 0 || deck.length === 0) {
    return { deck, focusedCardNos: [] };
  }
  const uniqueCandidates = new Map<string, CardDefinition>();
  for (const card of cards) {
    if (
      getCardDefinitionMainDeckMaxCount(card) > 0 &&
      !uniqueCandidates.has(card.cardNo)
    ) {
      uniqueCandidates.set(card.cardNo, card);
    }
  }
  const ranked = [...uniqueCandidates.values()].sort((left, right) => {
    const countDelta =
      (observedCardCounts[left.cardNo] ?? 0) -
      (observedCardCounts[right.cardNo] ?? 0);
    if (countDelta !== 0) return countDelta;
    const orderDelta =
      focusOrder(left.cardNo, salt) - focusOrder(right.cardNo, salt);
    return orderDelta !== 0
      ? orderDelta
      : left.cardNo.localeCompare(right.cardNo);
  });
  const targetCount = Math.min(focusCardCount, size);
  const contractCandidate = ranked.find((card) => isContractDefinition(card));
  const ordinaryRanked = ranked.filter((card) => !isContractDefinition(card));
  const strata = new Map<string, CardDefinition[]>();
  for (const card of ordinaryRanked) {
    const key = [
      card.printedCategory,
      card.colors[0] ?? "none",
      card.keywordTags[0] ?? "plain",
    ].join("|");
    const stratum = strata.get(key) ?? [];
    stratum.push(card);
    strata.set(key, stratum);
  }
  const orderedStrata = [...strata.entries()].sort(
    ([leftKey, left], [rightKey, right]) => {
      const countDelta =
        (observedCardCounts[left[0]!.cardNo] ?? 0) -
        (observedCardCounts[right[0]!.cardNo] ?? 0);
      return countDelta !== 0
        ? countDelta
        : focusOrder(leftKey, salt) - focusOrder(rightKey, salt);
    }
  );
  const candidates: CardDefinition[] =
    contractCandidate && targetCount > 0 ? [contractCandidate] : [];
  while (
    candidates.length < targetCount &&
    orderedStrata.some(([, stratum]) => stratum.length > 0)
  ) {
    for (const [, stratum] of orderedStrata) {
      const candidate = stratum.shift();
      if (candidate) candidates.push(candidate);
      if (candidates.length >= targetCount) break;
    }
  }

  const counts = new Map<string, number>();
  for (const card of deck) {
    counts.set(card.cardNo, (counts.get(card.cardNo) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    if ((counts.get(candidate.cardNo) ?? 0) === 0) {
      const victimIndex = deck.findLastIndex(
        (card) =>
          !candidates.some((focused) => focused.cardNo === card.cardNo) &&
          (counts.get(card.cardNo) ?? 0) > 0
      );
      if (victimIndex >= 0) {
        const victim = deck[victimIndex]!;
        counts.set(victim.cardNo, (counts.get(victim.cardNo) ?? 1) - 1);
        deck[victimIndex] = candidate;
        counts.set(candidate.cardNo, 1);
      }
    }
  }

  const focusedCardNos: string[] = [];
  for (const candidate of candidates.reverse()) {
    const index = deck.findIndex((card) => card.cardNo === candidate.cardNo);
    if (index < 0) continue;
    const [card] = deck.splice(index, 1);
    deck.unshift(card!);
    focusedCardNos.unshift(candidate.cardNo);
  }
  return { deck, focusedCardNos };
}

function isElapsedTimeCap(game: {
  outcome: TrainingGameResult["outcome"];
  terminationReason?: TrainingGameResult["terminationReason"];
}): boolean {
  return (
    game.outcome === "capped" && game.terminationReason === "elapsed_time_limit"
  );
}

function addQualifyingObservedCardCounts(
  target: Record<string, number>,
  game: Pick<EffectDebugGameSummary, "outcome" | "terminationReason">,
  coverage: EffectDebugCoverageReport
): void {
  if (isElapsedTimeCap(game)) return;
  for (const [cardNo, count] of Object.entries(coverage.semantic.cards)) {
    target[cardNo] = (target[cardNo] ?? 0) + count;
  }
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.partial`;
  await writeFile(tempPath, text, "utf8");
  await rename(tempPath, path);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function checkpointConfig(
  options: NormalizedOptions
): EffectDebugCheckpoint["config"] {
  return {
    commitHash: options.commitHash,
    games: options.games,
    maxSteps: options.maxSteps,
    maxForcedTransitions: options.maxForcedTransitions,
    maxRepeatedStateTransitions: options.maxRepeatedStateTransitions,
    maxGameDurationMs: options.maxGameDurationMs,
    maxGameDurationRetries: options.maxGameDurationRetries,
    maxGameDurationMultiplier: options.maxGameDurationMultiplier,
    maxGameDurationCeilingMs: options.maxGameDurationCeilingMs,
    maxReplacementGames: options.maxReplacementGames,
    seed: options.seed,
    maxGeneratedChoices: options.maxGeneratedChoices,
    deckSize: options.deckSize,
    deckStrategy: options.deckStrategy,
    focusCardCount: options.focusCardCount,
    skipPreGame: options.skipPreGame,
    agentA: options.agentA,
    agentB: options.agentB,
    wideChoiceThreshold: options.wideChoiceThreshold,
    policyCheckpointPath: options.policyCheckpointPath,
    policyCheckpointSha256: options.policyCheckpointSha256,
    policyExplorationRate: options.policyExplorationRate,
  };
}

function compatibleCheckpointConfig(
  left: EffectDebugCheckpoint["config"],
  right: EffectDebugCheckpoint["config"]
): boolean {
  const { maxReplacementGames: leftReplacementGames, ...leftStable } = left;
  const { maxReplacementGames: rightReplacementGames, ...rightStable } = right;
  return (
    JSON.stringify(leftStable) === JSON.stringify(rightStable) &&
    rightReplacementGames >= leftReplacementGames
  );
}

function gameRecordPath(outDir: string, gameIndex: number): string {
  return join(
    outDir,
    "games",
    `game-${String(gameIndex).padStart(4, "0")}.json`
  );
}

async function loadCheckpoint(
  options: NormalizedOptions
): Promise<EffectDebugCheckpoint> {
  const existing = await readJsonFile<EffectDebugCheckpoint>(
    options.checkpointFile
  );
  if (existing === null) {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      config: checkpointConfig(options),
      createdAt: now,
      updatedAt: now,
      completedGameIndexes: [],
      runtime: {
        totalGameDurationMs: 0,
        maxGameDurationMs: 0,
        lastGameDurationMs: null,
      },
    };
  }
  if (existing.schemaVersion !== 1) {
    throw new Error(
      `unsupported effect-debug checkpoint schema: ${existing.schemaVersion}`
    );
  }
  const nextConfig = checkpointConfig(options);
  if (!compatibleCheckpointConfig(existing.config, nextConfig)) {
    throw new Error(
      "effect-debug checkpoint configuration differs; use a new --checkpoint/--out directory"
    );
  }
  const completedGameIndexes = [
    ...new Set(existing.completedGameIndexes ?? []),
  ].sort((a, b) => a - b);
  const maxAttemptedGames = options.games + options.maxReplacementGames;
  if (
    completedGameIndexes.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= maxAttemptedGames
    )
  ) {
    throw new Error(
      "effect-debug checkpoint contains an invalid completed game index"
    );
  }
  return {
    ...existing,
    config: nextConfig,
    completedGameIndexes,
    runtime: {
      totalGameDurationMs:
        existing.runtime?.totalGameDurationMs &&
        Number.isFinite(existing.runtime.totalGameDurationMs)
          ? existing.runtime.totalGameDurationMs
          : 0,
      maxGameDurationMs:
        existing.runtime?.maxGameDurationMs &&
        Number.isFinite(existing.runtime.maxGameDurationMs)
          ? existing.runtime.maxGameDurationMs
          : 0,
      lastGameDurationMs:
        existing.runtime?.lastGameDurationMs !== undefined &&
        existing.runtime?.lastGameDurationMs !== null &&
        Number.isFinite(existing.runtime.lastGameDurationMs)
          ? existing.runtime.lastGameDurationMs
          : null,
    },
  };
}

function emptyCoverageReport(): EffectDebugCoverageReport {
  return {
    schemaVersion: 1,
    semantic: {
      cards: {},
      effects: {},
      dslSteps: {},
      actions: {},
      executedActionFrames: 0,
      unattributedActionFrames: 0,
      unattributedEffectRefs: 0,
      unattributedDslStepRefs: 0,
    },
    choiceSurface: {
      decisionFrames: 0,
      cappedGameCount: 0,
      truncatedDecisionFrames: 0,
      maxChoiceCount: 0,
      wideDecisionFrames: 0,
      choiceCountBuckets: {},
      truncatedByAction: {},
      truncatedByCard: {},
    },
  };
}

function increment(
  target: Record<string, number>,
  key: string | undefined
): void {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function choiceCountBucket(choiceCount: number): string {
  if (choiceCount <= 1) return "1";
  if (choiceCount <= 4) return "2-4";
  if (choiceCount <= 16) return "5-16";
  if (choiceCount <= 64) return "17-64";
  if (choiceCount <= 256) return "65-256";
  return "257+";
}

function stringField(
  value: Record<string, unknown>,
  field: string
): string | null {
  return typeof value[field] === "string" ? String(value[field]) : null;
}

function numberFields(
  value: Record<string, unknown>,
  suffix: "EffectIndex" | "StepIndex"
): Array<[string, number]> {
  return Object.entries(value).flatMap(([key, item]) =>
    (key === suffix.charAt(0).toLowerCase() + suffix.slice(1) ||
      key.endsWith(suffix)) &&
    Number.isInteger(item)
      ? [[key, Number(item)]]
      : []
  );
}

function selectedAction(
  frame: Record<string, unknown>
): Record<string, unknown> | null {
  const node = frame.node;
  const selected = frame.selected;
  if (!node || typeof node !== "object") return null;
  const nodeRecord = node as Record<string, unknown>;
  const selectedRecord =
    selected && typeof selected === "object"
      ? (selected as Record<string, unknown>)
      : null;
  const selectedChoiceId = stringField(selectedRecord ?? {}, "choiceId");
  const choices = Array.isArray(nodeRecord.choices) ? nodeRecord.choices : [];
  const choice = choices.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      stringField(entry as Record<string, unknown>, "choiceId") ===
        selectedChoiceId
  ) as Record<string, unknown> | undefined;
  const action = choice?.action ?? nodeRecord.action;
  return action && typeof action === "object"
    ? (action as Record<string, unknown>)
    : null;
}

function sourceCardNoFromAction(
  frame: Record<string, unknown>,
  action: Record<string, unknown>
): string | null {
  const declaredSource =
    stringField(action, "sourceCardNo") ??
    stringField(action, "sourceDefinitionId");
  if (declaredSource) return declaredSource;

  const sourceInstanceId = stringField(action, "sourceInstanceId");
  const observation = frame.observation;
  if (!sourceInstanceId || !observation || typeof observation !== "object") {
    return null;
  }
  const observedCards = (observation as Record<string, unknown>).cards;
  if (!Array.isArray(observedCards)) return null;
  const sourceCard = observedCards.find(
    (card) =>
      card &&
      typeof card === "object" &&
      stringField(card as Record<string, unknown>, "instanceId") ===
        sourceInstanceId
  );
  if (
    !sourceCard ||
    stringField(sourceCard as Record<string, unknown>, "identityVisibility") !==
      "known"
  ) {
    return null;
  }
  const observedCardNo = sourceCard
    ? stringField(sourceCard as Record<string, unknown>, "cardNoOrUnknown")
    : null;
  return observedCardNo;
}

function addCoverageFromFrame(
  coverage: EffectDebugCoverageReport,
  frame: Record<string, unknown>,
  wideChoiceThreshold: number
): void {
  const selected = frame.selected as Record<string, unknown> | undefined;
  const action = selectedAction(frame);
  const choiceCount =
    selected && Number.isInteger(selected.choiceCount)
      ? Number(selected.choiceCount)
      : 0;
  coverage.choiceSurface.decisionFrames += 1;
  coverage.choiceSurface.maxChoiceCount = Math.max(
    coverage.choiceSurface.maxChoiceCount,
    choiceCount
  );
  increment(
    coverage.choiceSurface.choiceCountBuckets,
    choiceCountBucket(choiceCount)
  );
  if (choiceCount >= wideChoiceThreshold) {
    coverage.choiceSurface.wideDecisionFrames += 1;
  }

  const actionKind = action ? stringField(action, "kind") : null;
  const sourceCardNo = action ? sourceCardNoFromAction(frame, action) : null;
  if (action) {
    coverage.semantic.executedActionFrames += 1;
    if (actionKind) increment(coverage.semantic.actions, actionKind);
    else coverage.semantic.unattributedActionFrames += 1;
    if (sourceCardNo) increment(coverage.semantic.cards, sourceCardNo);
    const effectFields = numberFields(action, "EffectIndex");
    for (const [field, effectIndex] of effectFields) {
      if (sourceCardNo) {
        increment(
          coverage.semantic.effects,
          `${sourceCardNo}#${field}:${effectIndex}`
        );
      } else {
        coverage.semantic.unattributedEffectRefs += 1;
      }
    }
    for (const [field, stepIndex] of numberFields(action, "StepIndex")) {
      const effectKey = effectFields[0]
        ? `${effectFields[0][0]}:${effectFields[0][1]}`
        : "effect:unknown";
      if (sourceCardNo && effectFields.length > 0) {
        increment(
          coverage.semantic.dslSteps,
          `${sourceCardNo}#${effectKey}/${field}:${stepIndex}`
        );
      } else {
        coverage.semantic.unattributedDslStepRefs += 1;
      }
    }
  }

  if (selected?.truncated === true) {
    coverage.choiceSurface.truncatedDecisionFrames += 1;
    increment(
      coverage.choiceSurface.truncatedByAction,
      actionKind ?? "unknown"
    );
    increment(
      coverage.choiceSurface.truncatedByCard,
      sourceCardNo ?? "unknown"
    );
  }
}

/**
 * Public for artifact-contract tests. `frames` must be the persisted frame
 * records (state omitted), and only each frame's selected choice is counted.
 */
export function collectEffectDebugCoverageFromFrames(
  frames: readonly Record<string, unknown>[],
  wideChoiceThreshold: number
): EffectDebugCoverageReport {
  const coverage = emptyCoverageReport();
  for (const frame of frames) {
    addCoverageFromFrame(coverage, frame, wideChoiceThreshold);
  }
  return coverage;
}

function mergeCounts(
  target: Record<string, number>,
  source: Record<string, number>
): void {
  for (const [key, count] of Object.entries(source))
    target[key] = (target[key] ?? 0) + count;
}

function mergeCoverageReport(
  target: EffectDebugCoverageReport,
  source: EffectDebugCoverageReport
): void {
  mergeCounts(target.semantic.cards, source.semantic.cards);
  mergeCounts(target.semantic.effects, source.semantic.effects);
  mergeCounts(target.semantic.dslSteps, source.semantic.dslSteps);
  mergeCounts(target.semantic.actions, source.semantic.actions);
  target.semantic.executedActionFrames += source.semantic.executedActionFrames;
  target.semantic.unattributedActionFrames +=
    source.semantic.unattributedActionFrames;
  target.semantic.unattributedEffectRefs +=
    source.semantic.unattributedEffectRefs;
  target.semantic.unattributedDslStepRefs +=
    source.semantic.unattributedDslStepRefs;
  target.choiceSurface.decisionFrames += source.choiceSurface.decisionFrames;
  target.choiceSurface.cappedGameCount += source.choiceSurface.cappedGameCount;
  target.choiceSurface.truncatedDecisionFrames +=
    source.choiceSurface.truncatedDecisionFrames;
  target.choiceSurface.maxChoiceCount = Math.max(
    target.choiceSurface.maxChoiceCount,
    source.choiceSurface.maxChoiceCount
  );
  target.choiceSurface.wideDecisionFrames +=
    source.choiceSurface.wideDecisionFrames;
  mergeCounts(
    target.choiceSurface.choiceCountBuckets,
    source.choiceSurface.choiceCountBuckets
  );
  mergeCounts(
    target.choiceSurface.truncatedByAction,
    source.choiceSurface.truncatedByAction
  );
  mergeCounts(
    target.choiceSurface.truncatedByCard,
    source.choiceSurface.truncatedByCard
  );
}
function emptyOutcomeCounts(): Record<TrainingGameResult["outcome"], number> {
  return { natural: 0, capped: 0, stuck: 0, error: 0 };
}

function emptyTicketCounts(): Record<EffectDebugTicketKind, number> {
  return {
    hard_failure: 0,
    capped: 0,
    slow_game: 0,
    state_invariant: 0,
    truncated_choice_surface: 0,
    wide_choice_surface: 0,
  };
}

function emptySeverityCounts(): Record<EffectDebugTicketSeverity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function addTraceMetrics(
  target: TrainingTraceSmokeMetrics["nodeKindCounts"],
  source: TrainingTraceSmokeMetrics["nodeKindCounts"]
): void {
  target.pregame += source.pregame;
  target.legal_action += source.legal_action;
  target.action_input += source.action_input;
}

async function buildAgentPolicies(options: NormalizedOptions): Promise<{
  options: NormalizedOptions;
  policies: Record<TrainingRunAgentName, TrainingPolicy>;
}> {
  let policy = randomTrainingPolicy;
  let policyCheckpointSha256: string | null = null;
  const requiresPolicy =
    options.agentA === "policy" || options.agentB === "policy";
  if (requiresPolicy) {
    if (options.policyCheckpointPath === null) {
      throw new Error(
        "policyCheckpointPath is required when an effect-debug agent is policy"
      );
    }
    const checkpointText = await readFile(options.policyCheckpointPath, "utf8");
    policyCheckpointSha256 = createHash("sha256")
      .update(checkpointText)
      .digest("hex");
    const artifact = await loadPolicyCheckpointArtifact(
      options.policyCheckpointPath
    );
    const network = createTinyPolicyValueNetwork({
      checkpoint: artifact.network,
    });
    policy = makePolicyValueTrainingPolicy(network, {
      explorationRate: options.policyExplorationRate,
    });
  }
  return {
    options: { ...options, policyCheckpointSha256 },
    policies: {
      random: randomTrainingPolicy,
      heuristic: heuristicTrainingPolicy,
      // Keep the normal 16x12 search for ordinary states (and its existing
      // deterministic fixtures). A long game history can make every virtual
      // branch expensive to clone, so cap only those oversized states through a
      // deterministic serialized-state budget.
      mcts: makeMctsTrainingPolicy({
        iterations: 16,
        rolloutDepth: 12,
        maxStateSerializedChars: 128_000,
        maxGeneratedChoices: options.maxGeneratedChoices,
        suppressManualCoreMovesWhenLegalActionsExist: true,
        factorManualCoreMovesThroughReserve: true,
      }),
      policy,
    },
  };
}

function recordValue(
  value: unknown,
  key: string
): string | number | boolean | null | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ||
    typeof entry === "number" ||
    typeof entry === "boolean" ||
    entry === null
    ? entry
    : undefined;
}

function lastDecision(
  result: TrainingTraceSmokeResult,
  preferredFrame?: TrainingTraceSmokeResult["lastFrame"]
) {
  const frame = preferredFrame ?? result.lastFrame ?? result.frames.at(-1);
  const selected = frame?.selected ?? result.trace.at(-1);
  const selectedChoice = frame?.node.choices.find(
    (choice) => choice.choiceId === selected?.choiceId
  );
  const action = frame?.node.action ?? selectedChoice?.action;
  return {
    selected,
    action,
    frame,
  };
}

function suspectFromResult(
  result: TrainingTraceSmokeResult,
  preferredFrame?: TrainingTraceSmokeResult["lastFrame"]
): EffectDebugTicket["suspect"] {
  const { selected, action } = lastDecision(result, preferredFrame);
  const sourceCardNo =
    recordValue(action, "sourceCardNo") ??
    recordValue(action, "sourceDefinitionId");
  return {
    ...(selected?.nodeKind ? { nodeKind: selected.nodeKind } : {}),
    ...(selected?.actionKind ? { actionKind: selected.actionKind } : {}),
    ...(selected?.actionId ? { actionId: selected.actionId } : {}),
    ...(selected?.systemActionKind
      ? { systemActionKind: selected.systemActionKind }
      : {}),
    ...(selected?.choiceId ? { choiceId: selected.choiceId } : {}),
    ...(sourceCardNo !== undefined
      ? { sourceCardNo: String(sourceCardNo) }
      : {}),
    ...(recordValue(action, "sourceDefinitionId") !== undefined
      ? {
          sourceDefinitionId: String(recordValue(action, "sourceDefinitionId")),
        }
      : {}),
    fields: selected?.fields ?? [],
  };
}

function ticketId(
  gameIndex: number,
  index: number,
  kind: EffectDebugTicketKind
) {
  return `EDH-${String(gameIndex).padStart(4, "0")}-${String(index).padStart(
    2,
    "0"
  )}-${kind.replace(/_/g, "-")}`;
}

function ticketFileName(ticketIdValue: string): string {
  return `${ticketIdValue}.md`;
}

function rerunCommand(options: NormalizedOptions, gameIndex: number): string {
  const args = [
    "pnpm effect:debug --",
    `--games ${gameIndex + 1}`,
    `--seed ${options.seed}`,
    `--maxSteps ${options.maxSteps}`,
    `--maxForcedTransitions ${options.maxForcedTransitions}`,
    `--maxRepeatedStateTransitions ${options.maxRepeatedStateTransitions}`,
    `--maxGameDurationMs ${options.maxGameDurationMs}`,
    `--maxGameDurationRetries ${options.maxGameDurationRetries}`,
    `--maxGameDurationMultiplier ${options.maxGameDurationMultiplier}`,
    `--maxGameDurationCeilingMs ${options.maxGameDurationCeilingMs}`,
    `--maxReplacementGames 0`,
    `--maxGeneratedChoices ${options.maxGeneratedChoices}`,
    `--deckSize ${options.deckSize}`,
    `--deckStrategy ${options.deckStrategy}`,
    `--focusCardCount ${options.focusCardCount}`,
    `--skipPreGame ${options.skipPreGame}`,
    `--agentA ${options.agentA}`,
    `--agentB ${options.agentB}`,
    `--wideChoiceThreshold ${options.wideChoiceThreshold}`,
  ];
  if (options.policyCheckpointPath !== null) {
    args.push(
      "--policyCheckpoint " + JSON.stringify(options.policyCheckpointPath),
      "--policyExplorationRate " + options.policyExplorationRate
    );
  }
  return args.join(" ");
}

function makeTicket(args: {
  options: NormalizedOptions;
  kind: EffectDebugTicketKind;
  severity: EffectDebugTicketSeverity;
  confidence: EffectDebugTicket["confidence"];
  title: string;
  gameIndex: number;
  ticketIndex: number;
  seed: number;
  result: TrainingTraceSmokeResult;
  suspectFrame?: TrainingTraceSmokeResult["lastFrame"];
  replayFile: string;
  ticketsDir: string;
  seatAgents: Record<"alice" | "bob", TrainingRunAgentName>;
  details: Record<string, unknown>;
  lastError?: string;
}): EffectDebugTicket {
  const id = ticketId(args.gameIndex, args.ticketIndex, args.kind);
  const { selected } = lastDecision(args.result, args.suspectFrame);
  return {
    schemaVersion: 1,
    ticketId: id,
    kind: args.kind,
    severity: args.severity,
    confidence: args.confidence,
    title: args.title,
    gameIndex: args.gameIndex,
    seed: args.seed,
    step: selected?.step ?? args.result.transitionSteps,
    decisionSteps: args.result.decisionSteps,
    transitionSteps: args.result.transitionSteps,
    replayFile: args.replayFile,
    ticketFile: join(args.ticketsDir, ticketFileName(id)),
    rerunCommand: rerunCommand(args.options, args.gameIndex),
    ...(args.lastError ? { lastError: args.lastError } : {}),
    suspect: suspectFromResult(args.result, args.suspectFrame),
    details: args.details,
  };
}

function collectInvariantIssues(
  result: TrainingTraceSmokeResult,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameStateInvariantIssue[] {
  return collectGameStateInvariantIssues(result.finalState, {
    getCardDefinitionById,
  });
}

function detectTickets(args: {
  options: NormalizedOptions;
  gameIndex: number;
  seed: number;
  result: TrainingTraceSmokeResult;
  replayFile: string;
  ticketsDir: string;
  seatAgents: Record<"alice" | "bob", TrainingRunAgentName>;
  invariantIssues: readonly GameStateInvariantIssue[];
  durationAttemptsMs: readonly number[];
  timeLimitRetryCount: number;
  effectiveMaxGameDurationMs: number;
  elapsedTimeAttempts: readonly ElapsedTimeAttemptEvidence[];
}): EffectDebugTicket[] {
  const tickets: EffectDebugTicket[] = [];
  const make = (
    ticket: Omit<
      Parameters<typeof makeTicket>[0],
      | "options"
      | "gameIndex"
      | "ticketIndex"
      | "seed"
      | "result"
      | "suspectFrame"
      | "replayFile"
      | "ticketsDir"
      | "seatAgents"
    >,
    evidence?: Partial<
      Pick<
        Parameters<typeof makeTicket>[0],
        "result" | "replayFile" | "suspectFrame"
      >
    >
  ) => {
    tickets.push(
      makeTicket({
        ...ticket,
        options: args.options,
        gameIndex: args.gameIndex,
        ticketIndex: tickets.length,
        seed: args.seed,
        result: evidence?.result ?? args.result,
        ...(evidence?.suspectFrame
          ? { suspectFrame: evidence.suspectFrame }
          : {}),
        replayFile: evidence?.replayFile ?? args.replayFile,
        ticketsDir: args.ticketsDir,
        seatAgents: args.seatAgents,
      })
    );
  };

  if (args.result.outcome === "stuck" || args.result.outcome === "error") {
    make({
      kind: "hard_failure",
      severity: "critical",
      confidence: "reproducible",
      title: `${args.result.outcome} after training decision replay`,
      ...(args.result.lastError ? { lastError: args.result.lastError } : {}),
      details: {
        outcome: args.result.outcome,
        terminationReason: args.result.terminationReason ?? null,
        lastError: args.result.lastError ?? null,
        traceEntries: args.result.trace.length,
      },
    });
  }

  if (args.result.outcome === "capped") {
    const elapsedTimeLimit =
      args.result.terminationReason === "elapsed_time_limit";
    make({
      kind: "capped",
      severity: "medium",
      confidence: "suspicious",
      title: elapsedTimeLimit
        ? `game reached maxGameDurationMs=${args.effectiveMaxGameDurationMs}`
        : `game reached maxSteps=${args.options.maxSteps}`,
      ...(args.result.lastError ? { lastError: args.result.lastError } : {}),
      details: {
        maxSteps: args.options.maxSteps,
        maxGameDurationMs: args.effectiveMaxGameDurationMs,
        initialMaxGameDurationMs: args.options.maxGameDurationMs,
        terminationReason: args.result.terminationReason ?? "decision_limit",
        traceEntries: args.result.trace.length,
        lastError: args.result.lastError ?? null,
      },
    });
  }

  if (args.timeLimitRetryCount > 0) {
    const elapsedAttempt = args.elapsedTimeAttempts.at(-1);
    if (!elapsedAttempt) {
      throw new Error("elapsed-time retry is missing its attempt evidence");
    }
    make(
      {
        kind: "slow_game",
        severity: "low",
        confidence: "reproducible",
        title:
          "game required " +
          args.timeLimitRetryCount +
          " elapsed-time retry(s)",
        details: {
          initialMaxGameDurationMs: args.options.maxGameDurationMs,
          effectiveMaxGameDurationMs: args.effectiveMaxGameDurationMs,
          durationAttemptsMs: [...args.durationAttemptsMs],
          recovered: !isElapsedTimeCap(args.result),
          elapsedTimeAttempts: args.elapsedTimeAttempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            maxDurationMs: attempt.maxDurationMs,
            durationMs: attempt.durationMs,
            transitionSteps: attempt.result.transitionSteps,
            decisionSteps: attempt.result.decisionSteps,
            replayFile: attempt.replayFile,
            traceFile: attempt.traceFile,
            framesFile: attempt.framesFile,
          })),
        },
      },
      {
        result: elapsedAttempt.result,
        replayFile: elapsedAttempt.replayFile,
      }
    );
  }
  if (args.invariantIssues.length > 0) {
    make({
      kind: "state_invariant",
      severity: "high",
      confidence: "reproducible",
      title: `${args.invariantIssues.length} final state invariant issue(s)`,
      details: {
        issueCount: args.invariantIssues.length,
        issues: args.invariantIssues.slice(0, 20),
      },
    });
  }

  if (args.result.metrics.truncatedNodeCount > 0) {
    const firstTruncatedFrame = args.result.firstTruncatedFrame;
    if (!firstTruncatedFrame) {
      throw new Error(
        "truncated decision metrics are missing their first frame evidence"
      );
    }
    make(
      {
        kind: "truncated_choice_surface",
        severity: "medium",
        confidence: "suspicious",
        title: `${args.result.metrics.truncatedNodeCount} truncated decision node(s)`,
        details: {
          truncatedNodeCount: args.result.metrics.truncatedNodeCount,
          truncatedNodeRate: args.result.metrics.truncatedNodeRate,
          maxGeneratedChoices: args.options.maxGeneratedChoices,
        },
      },
      {
        suspectFrame: firstTruncatedFrame,
      }
    );
  }

  if (
    args.options.wideChoiceThreshold > 0 &&
    args.result.metrics.maxChoiceCount >= args.options.wideChoiceThreshold
  ) {
    make({
      kind: "wide_choice_surface",
      severity: "low",
      confidence: "suspicious",
      title: `choice surface reached ${args.result.metrics.maxChoiceCount} choices`,
      details: {
        maxChoiceCount: args.result.metrics.maxChoiceCount,
        wideChoiceThreshold: args.options.wideChoiceThreshold,
      },
    });
  }

  return tickets;
}

function markdownTicket(ticket: EffectDebugTicket): string {
  const suspect = ticket.suspect;
  return [
    `# EFFECT-DEBUG draft: ${ticket.title}`,
    "",
    `- ticketId: ${ticket.ticketId}`,
    `- kind: ${ticket.kind}`,
    `- severity: ${ticket.severity}`,
    `- confidence: ${ticket.confidence}`,
    `- seed: ${ticket.seed}`,
    `- gameIndex: ${ticket.gameIndex}`,
    `- step: ${ticket.step} (suspect transition index)`,
    `- transitionSteps: ${ticket.transitionSteps}`,
    `- decisionSteps: ${ticket.decisionSteps}`,
    `- replay: ${ticket.replayFile}`,
    "",
    "## Suspect",
    "",
    `- nodeKind: ${suspect.nodeKind ?? "unknown"}`,
    `- actionKind: ${suspect.actionKind ?? "unknown"}`,
    `- actionId: ${suspect.actionId ?? "unknown"}`,
    `- systemActionKind: ${suspect.systemActionKind ?? "unknown"}`,
    `- choiceId: ${suspect.choiceId ?? "unknown"}`,
    `- sourceCardNo: ${suspect.sourceCardNo ?? "unknown"}`,
    `- sourceDefinitionId: ${suspect.sourceDefinitionId ?? "unknown"}`,
    `- fields: ${suspect.fields.length === 0 ? "[]" : suspect.fields.join(", ")}`,
    "",
    "## Reproduction",
    "",
    "```powershell",
    ticket.rerunCommand,
    "```",
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(ticket.details, null, 2),
    "```",
    "",
    ticket.lastError
      ? ["## Last Error", "", "```text", ticket.lastError, "```", ""].join("\n")
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildSummary(args: {
  options: NormalizedOptions;
  createdAt: string;
  games: EffectDebugGameSummary[];
  tickets: EffectDebugTicket[];
  ticketsFile: string;
  ticketsDir: string;
  metrics: TrainingTraceSmokeMetrics[];
  coverage: EffectDebugCoverageReport;
  cleanCoverage: EffectDebugCoverageReport;
  durationMs: number;
}): EffectDebugHarvestRunSummary {
  const outcomeCounts = emptyOutcomeCounts();
  const winnerCounts: Record<string, number> = {};
  const ticketCounts = emptyTicketCounts();
  const severityCounts = emptySeverityCounts();
  const nodeKindCounts: TrainingTraceSmokeMetrics["nodeKindCounts"] = {
    pregame: 0,
    legal_action: 0,
    action_input: 0,
  };
  let totalDecisionSteps = 0;
  let totalTransitionSteps = 0;
  let totalDecisionFrames = 0;
  let totalTraceEntries = 0;
  let truncatedNodeCount = 0;
  let maxChoiceCount = 0;

  for (const metric of args.metrics) {
    outcomeCounts[metric.outcome] += 1;
    winnerCounts[metric.winner ?? "none"] =
      (winnerCounts[metric.winner ?? "none"] ?? 0) + 1;
    addTraceMetrics(nodeKindCounts, metric.nodeKindCounts);
    totalDecisionSteps += metric.decisionSteps;
    totalTransitionSteps += metric.transitionSteps;
    totalDecisionFrames += metric.decisionFrames;
    totalTraceEntries += metric.traceEntries;
    truncatedNodeCount += metric.truncatedNodeCount;
    maxChoiceCount = Math.max(maxChoiceCount, metric.maxChoiceCount);
  }
  for (const ticket of args.tickets) {
    ticketCounts[ticket.kind] += 1;
    severityCounts[ticket.severity] += 1;
  }

  return {
    schemaVersion: 1,
    profile: "effect-debug-harvest",
    experimentId: args.options.experimentId,
    createdAt: args.createdAt,
    outputDir: args.options.outDir,
    config: {
      profile: "effect-debug-harvest",
      configPath: args.options.configPath,
      commitHash: args.options.commitHash,
      games: args.options.games,
      maxSteps: args.options.maxSteps,
      maxForcedTransitions: args.options.maxForcedTransitions,
      maxRepeatedStateTransitions: args.options.maxRepeatedStateTransitions,
      maxGameDurationMs: args.options.maxGameDurationMs,
      maxGameDurationRetries: args.options.maxGameDurationRetries,
      maxGameDurationMultiplier: args.options.maxGameDurationMultiplier,
      maxGameDurationCeilingMs: args.options.maxGameDurationCeilingMs,
      maxReplacementGames: args.options.maxReplacementGames,
      seed: args.options.seed,
      maxGeneratedChoices: args.options.maxGeneratedChoices,
      deckSize: args.options.deckSize,
      deckStrategy: args.options.deckStrategy,
      focusCardCount: args.options.focusCardCount,
      skipPreGame: args.options.skipPreGame,
      agentA: args.options.agentA,
      agentB: args.options.agentB,
      wideChoiceThreshold: args.options.wideChoiceThreshold,
      checkpointFile: args.options.checkpointFile,
      policyCheckpointPath: args.options.policyCheckpointPath,
      policyCheckpointSha256: args.options.policyCheckpointSha256,
      policyExplorationRate: args.options.policyExplorationRate,
    },
    aggregate: {
      outcomeCounts,
      winnerCounts,
      ticketCounts,
      severityCounts,
      totalTickets: args.tickets.length,
      totalSteps: totalTransitionSteps,
      averageSteps:
        args.metrics.length === 0
          ? 0
          : totalTransitionSteps / args.metrics.length,
      totalDecisionSteps,
      totalTransitionSteps,
      averageDecisionSteps:
        args.metrics.length === 0
          ? 0
          : totalDecisionSteps / args.metrics.length,
      averageTransitionSteps:
        args.metrics.length === 0
          ? 0
          : totalTransitionSteps / args.metrics.length,
      totalDecisionFrames,
      totalTraceEntries,
      truncatedNodeCount,
      truncatedNodeRate:
        totalDecisionFrames === 0
          ? 0
          : truncatedNodeCount / totalDecisionFrames,
      maxChoiceCount,
      durationMs: args.durationMs,
      attemptedGames: args.games.length,
      qualifyingGames: args.games.filter(
        (game) =>
          !(
            game.outcome === "capped" &&
            game.terminationReason === "elapsed_time_limit"
          )
      ).length,
      elapsedTimeReplacementCount: args.games.filter(
        (game) =>
          game.outcome === "capped" &&
          game.terminationReason === "elapsed_time_limit"
      ).length,
      retriedGameCount: args.games.filter(
        (game) => game.timeLimitRetryCount > 0
      ).length,
      totalTimeLimitRetries: args.games.reduce(
        (sum, game) => sum + game.timeLimitRetryCount,
        0
      ),
      stepsPerSecond:
        args.durationMs <= 0
          ? 0
          : totalTransitionSteps / (args.durationMs / 1000),
      coverage: args.coverage,
      cleanCoverage: args.cleanCoverage,
    },
    ticketsFile: args.ticketsFile,
    ticketsDir: args.ticketsDir,
    games: args.games,
    tickets: args.tickets,
  };
}

export async function runEffectDebugHarvest(
  options: EffectDebugHarvestCliOptions = {}
): Promise<EffectDebugHarvestRunSummary> {
  const gameClockFactory = options.gameClockFactory;
  let normalized = normalizeOptions(options);
  assertPositiveInteger("games", normalized.games);
  assertPositiveInteger("maxSteps", normalized.maxSteps);
  assertPositiveInteger(
    "maxForcedTransitions",
    normalized.maxForcedTransitions
  );
  assertPositiveInteger(
    "maxRepeatedStateTransitions",
    normalized.maxRepeatedStateTransitions
  );
  assertPositiveInteger("maxGameDurationMs", normalized.maxGameDurationMs);
  assertNonNegativeInteger(
    "maxGameDurationRetries",
    normalized.maxGameDurationRetries
  );
  if (
    !Number.isFinite(normalized.maxGameDurationMultiplier) ||
    normalized.maxGameDurationMultiplier <= 1
  ) {
    throw new Error("maxGameDurationMultiplier must be greater than 1");
  }
  assertPositiveInteger(
    "maxGameDurationCeilingMs",
    normalized.maxGameDurationCeilingMs
  );
  assertNonNegativeInteger(
    "maxReplacementGames",
    normalized.maxReplacementGames
  );
  assertPositiveInteger("maxGeneratedChoices", normalized.maxGeneratedChoices);
  assertPositiveInteger("deckSize", normalized.deckSize);
  assertNonNegativeInteger("focusCardCount", normalized.focusCardCount);
  assertNonNegativeInteger(
    "wideChoiceThreshold",
    normalized.wideChoiceThreshold
  );
  if (
    !Number.isFinite(normalized.policyExplorationRate) ||
    normalized.policyExplorationRate < 0 ||
    normalized.policyExplorationRate > 1
  ) {
    throw new Error("policyExplorationRate must be between 0 and 1");
  }

  const startedAtMs = Date.now();
  const createdAt = new Date(startedAtMs).toISOString();
  const engine = createTrainingEngine();
  const preparedAgents = await buildAgentPolicies(normalized);
  normalized = preparedAgents.options;
  const agents = preparedAgents.policies;
  const replaysDir = join(normalized.outDir, "replays");
  const ticketsDir = join(normalized.outDir, "tickets");
  const gamesDir = join(normalized.outDir, "games");
  const ticketsFile = join(normalized.outDir, "tickets.jsonl");
  await mkdir(replaysDir, { recursive: true });
  await mkdir(ticketsDir, { recursive: true });
  await mkdir(gamesDir, { recursive: true });

  const releaseWriter = acquireArtifactWriter(normalized.outDir);
  try {
    const storageBudget = new ArtifactWriteBudget(normalized.outDir);
    let checkpoint = await loadCheckpoint(normalized);
    await writeJsonAtomic(normalized.checkpointFile, checkpoint);
    const completed = new Set(checkpoint.completedGameIndexes);
    const maxAttemptedGames = normalized.games + normalized.maxReplacementGames;
    const observedCardCounts: Record<string, number> = {};
    let qualifyingGames = 0;
    for (const gameIndex of [...completed].sort(
      (left, right) => left - right
    )) {
      const record = await readJsonFile<EffectDebugGameCheckpointRecord>(
        gameRecordPath(normalized.outDir, gameIndex)
      );
      if (!record) {
        throw new Error(
          `effect-debug checkpoint is missing completed game artifact ${gameIndex}`
        );
      }
      if (!isElapsedTimeCap(record.game)) {
        qualifyingGames += 1;
        if (record.schemaVersion === 2) {
          addQualifyingObservedCardCounts(
            observedCardCounts,
            record.game,
            record.coverage
          );
        }
      }
    }

    for (
      let gameIndex = 0;
      gameIndex < maxAttemptedGames && qualifyingGames < normalized.games;
      gameIndex += 1
    ) {
      if (completed.has(gameIndex)) continue;
      const gameStartedAtMs = Date.now();
      const seed = gameSeed(normalized.seed, gameIndex);
      const swapped = gameIndex % 2 === 1;
      const seatAgents: Record<"alice" | "bob", TrainingRunAgentName> = swapped
        ? { alice: normalized.agentB, bob: normalized.agentA }
        : { alice: normalized.agentA, bob: normalized.agentB };
      const artifactStem = `game-${String(gameIndex).padStart(4, "0")}`;
      let replayFile: string;
      let gameTraceFile: string;
      let gameFramesFile: string;
      const durationAttemptsMs: number[] = [];
      const elapsedTimeAttempts: ElapsedTimeAttemptEvidence[] = [];
      let timeLimitRetryCount = 0;
      let effectiveMaxGameDurationMs = normalized.maxGameDurationMs;
      let result: TrainingTraceSmokeResult;
      let gameCoverage = emptyCoverageReport();
      let focusedCardNos: string[] = [];

      for (;;) {
        const attemptStartedAtMs = Date.now();
        const rng = mulberry32(seed);
        gameCoverage = emptyCoverageReport();
        focusedCardNos = [];
        const makeDeck = (seat: number): CardDefinition[] => {
          if (normalized.deckStrategy === "random") {
            return randomDeck(engine.cards, normalized.deckSize, rng);
          }
          const guided = buildCoverageGuidedDeck(
            engine.cards,
            normalized.deckSize,
            rng,
            observedCardCounts,
            normalized.focusCardCount,
            (seed ^ Math.imul(seat + 1, 0x85ebca6b)) >>> 0
          );
          focusedCardNos.push(...guided.focusedCardNos);
          return guided.deck;
        };
        const attemptStem = `${artifactStem}.attempt-${String(
          timeLimitRetryCount
        ).padStart(2, "0")}`;
        replayFile = join(replaysDir, `${attemptStem}.jsonl.gz`);
        gameTraceFile = join(gamesDir, `${attemptStem}.trace.jsonl.gz`);
        gameFramesFile = join(gamesDir, `${attemptStem}.frames.jsonl.gz`);
        const frameWriter = new CompressedArtifactWriter(
          gameFramesFile,
          storageBudget
        );
        const replayWriter = new CompressedReplayWriter(
          replayFile,
          `${normalized.experimentId} game ${gameIndex}`,
          storageBudget
        );
        try {
          result = playTrainingTraceSmoke({
            engine,
            rng,
            maxSteps: normalized.maxSteps,
            maxForcedTransitions: normalized.maxForcedTransitions,
            maxRepeatedStateTransitions: normalized.maxRepeatedStateTransitions,
            maxDurationMs: effectiveMaxGameDurationMs,
            ...(gameClockFactory
              ? {
                  now: gameClockFactory({
                    gameIndex,
                    seed,
                    attemptIndex: timeLimitRetryCount,
                    maxDurationMs: effectiveMaxGameDurationMs,
                  }),
                }
              : {}),
            maxGeneratedChoices: normalized.maxGeneratedChoices,
            suppressManualCoreMovesWhenLegalActionsExist: true,
            factorManualCoreMovesThroughReserve: true,
            skipPreGame:
              normalized.skipPreGame ||
              normalized.deckStrategy === "coverage_guided",
            preserveDeckOrder: normalized.deckStrategy === "coverage_guided",
            title: `${normalized.experimentId} game ${gameIndex}`,
            decks: [makeDeck(0), makeDeck(1)],
            policies: {
              alice: agents[seatAgents.alice],
              bob: agents[seatAgents.bob],
            },
            recording: {
              retainFrames: false,
              retainReplay: false,
              onFrame: (frame) => {
                const { state: _state, ...frameRecord } = frame;
                void _state;
                const persistedFrame = { gameIndex, seed, ...frameRecord };
                frameWriter.append(jsonLine(persistedFrame));
                addCoverageFromFrame(
                  gameCoverage,
                  persistedFrame,
                  normalized.wideChoiceThreshold
                );
              },
              onReplayFrame: (frame) => replayWriter.append(frame),
            },
          });
          storageBudget.assertHealthy();
          await frameWriter.commit();
          await replayWriter.commit();
        } catch (error) {
          frameWriter.abort();
          replayWriter.abort();
          throw error;
        }
        const attemptDurationMs = Date.now() - attemptStartedAtMs;
        durationAttemptsMs.push(attemptDurationMs);
        const traceLines = result.trace.map((entry) =>
          jsonLine({ gameIndex, seed, ...entry })
        );
        await writeCompressedText(
          gameTraceFile,
          traceLines.join(""),
          storageBudget
        );
        if (isElapsedTimeCap(result)) {
          elapsedTimeAttempts.push({
            attemptIndex: timeLimitRetryCount,
            maxDurationMs: effectiveMaxGameDurationMs,
            durationMs: attemptDurationMs,
            result,
            replayFile,
            traceFile: gameTraceFile,
            framesFile: gameFramesFile,
          });
        }

        const retryable =
          isElapsedTimeCap(result) &&
          timeLimitRetryCount < normalized.maxGameDurationRetries &&
          effectiveMaxGameDurationMs < normalized.maxGameDurationCeilingMs;
        if (!retryable) break;
        timeLimitRetryCount += 1;
        effectiveMaxGameDurationMs = Math.min(
          normalized.maxGameDurationCeilingMs,
          Math.ceil(
            effectiveMaxGameDurationMs * normalized.maxGameDurationMultiplier
          )
        );
      }

      if (result!.outcome === "capped") {
        gameCoverage.choiceSurface.cappedGameCount += 1;
      }

      const invariantIssues = collectInvariantIssues(
        result!,
        engine.getCardDefinitionById
      );
      const gameTickets = detectTickets({
        options: normalized,
        gameIndex,
        seed,
        result: result!,
        replayFile,
        ticketsDir,
        seatAgents,
        invariantIssues,
        durationAttemptsMs,
        timeLimitRetryCount,
        effectiveMaxGameDurationMs,
        elapsedTimeAttempts,
      });
      for (const ticket of gameTickets) {
        await writeFile(ticket.ticketFile, markdownTicket(ticket), "utf8");
      }

      const durationMs = Date.now() - gameStartedAtMs;
      const game: EffectDebugGameSummary = {
        gameIndex,
        seed,
        seatAgents,
        outcome: result!.outcome,
        winner: result!.winner,
        steps: result!.steps,
        decisionSteps: result!.decisionSteps,
        transitionSteps: result!.transitionSteps,
        ...(result!.terminationReason
          ? { terminationReason: result!.terminationReason }
          : {}),
        decisionFrames: result!.metrics.decisionFrames,
        traceEntries: result!.trace.length,
        truncatedNodeCount: result!.metrics.truncatedNodeCount,
        maxChoiceCount: result!.metrics.maxChoiceCount,
        durationMs,
        durationAttemptsMs,
        timeLimitRetryCount,
        effectiveMaxGameDurationMs,
        deckStrategy: normalized.deckStrategy,
        focusedCardNos: [...new Set(focusedCardNos)].sort(),
        replayFile,
        ticketIds: gameTickets.map((ticket) => ticket.ticketId),
      };
      const gameRecord: EffectDebugGameCheckpointRecord = {
        schemaVersion: 2,
        game,
        metrics: result!.metrics,
        traceFile: gameTraceFile,
        framesFile: gameFramesFile,
        coverage: gameCoverage,
        tickets: gameTickets,
      };
      await writeJsonAtomic(
        gameRecordPath(normalized.outDir, gameIndex),
        gameRecord
      );

      completed.add(gameIndex);
      if (!isElapsedTimeCap(game)) {
        qualifyingGames += 1;
        addQualifyingObservedCardCounts(observedCardCounts, game, gameCoverage);
      }
      checkpoint = {
        ...checkpoint,
        completedGameIndexes: [
          ...checkpoint.completedGameIndexes,
          gameIndex,
        ].sort((a, b) => a - b),
        runtime: {
          totalGameDurationMs:
            checkpoint.runtime.totalGameDurationMs + durationMs,
          maxGameDurationMs: Math.max(
            checkpoint.runtime.maxGameDurationMs,
            durationMs
          ),
          lastGameDurationMs: durationMs,
        },
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(normalized.checkpointFile, checkpoint);
    }

    const traceFiles: string[] = [];
    const framesFiles: string[] = [];
    await writeFile(ticketsFile, "", "utf8");
    const gameSummaries: EffectDebugGameSummary[] = [];
    const metrics: TrainingTraceSmokeMetrics[] = [];
    const tickets: EffectDebugTicket[] = [];
    const coverage = emptyCoverageReport();
    const cleanCoverage = emptyCoverageReport();
    for (const gameIndex of [...completed].sort(
      (left, right) => left - right
    )) {
      const record = await readJsonFile<EffectDebugGameCheckpointRecord>(
        gameRecordPath(normalized.outDir, gameIndex)
      );
      if (
        !record ||
        (record.schemaVersion !== 1 && record.schemaVersion !== 2)
      ) {
        throw new Error(
          `effect-debug checkpoint is missing completed game artifact ${gameIndex}`
        );
      }
      if (record.schemaVersion === 1) {
        const traceFile = join(
          gamesDir,
          `game-${String(gameIndex).padStart(4, "0")}.legacy.trace.jsonl.gz`
        );
        const framesFile = join(
          gamesDir,
          `game-${String(gameIndex).padStart(4, "0")}.legacy.frames.jsonl.gz`
        );
        await writeCompressedText(
          traceFile,
          record.traceLines.join(""),
          storageBudget
        );
        await writeCompressedText(
          framesFile,
          record.frameLines.join(""),
          storageBudget
        );
        traceFiles.push(relative(normalized.outDir, traceFile));
        framesFiles.push(relative(normalized.outDir, framesFile));
        const recordCoverage = emptyCoverageReport();
        for (const line of record.frameLines) {
          const frame = JSON.parse(line) as Record<string, unknown>;
          addCoverageFromFrame(coverage, frame, normalized.wideChoiceThreshold);
          addCoverageFromFrame(
            recordCoverage,
            frame,
            normalized.wideChoiceThreshold
          );
        }
        if (record.game.outcome === "capped") {
          coverage.choiceSurface.cappedGameCount += 1;
          recordCoverage.choiceSurface.cappedGameCount += 1;
        }
        if (!isElapsedTimeCap(record.game)) {
          mergeCoverageReport(cleanCoverage, recordCoverage);
        }
      } else {
        traceFiles.push(relative(normalized.outDir, record.traceFile));
        framesFiles.push(relative(normalized.outDir, record.framesFile));
        mergeCoverageReport(coverage, record.coverage);
        if (!isElapsedTimeCap(record.game)) {
          mergeCoverageReport(cleanCoverage, record.coverage);
        }
      }
      await appendFile(
        ticketsFile,
        record.tickets.map(jsonLine).join(""),
        "utf8"
      );
      gameSummaries.push(record.game);
      metrics.push(record.metrics);
      tickets.push(...record.tickets);
    }

    await writeJsonAtomic(join(normalized.outDir, "trace.manifest.json"), {
      schemaVersion: 1,
      format: "orica-jsonl-manifest",
      files: traceFiles,
    });
    await writeJsonAtomic(join(normalized.outDir, "frames.manifest.json"), {
      schemaVersion: 1,
      format: "orica-jsonl-manifest",
      files: framesFiles,
    });

    const summary = buildSummary({
      options: normalized,
      createdAt,
      games: gameSummaries,
      tickets,
      ticketsFile,
      ticketsDir,
      metrics,
      coverage,
      cleanCoverage,
      durationMs: Date.now() - startedAtMs,
    });
    await writeFile(
      join(normalized.outDir, "metrics.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
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

function normalizeAgent(value: string): TrainingRunAgentName {
  if (TRAINING_RUN_AGENTS.includes(value as TrainingRunAgentName)) {
    return value as TrainingRunAgentName;
  }
  throw new Error(`unknown agent: ${value}`);
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
      case "--maxForcedTransitions":
      case "--max-forced-transitions":
        parsed.maxForcedTransitions = Number(next());
        break;
      case "--maxRepeatedStateTransitions":
      case "--max-repeated-state-transitions":
        parsed.maxRepeatedStateTransitions = Number(next());
        break;
      case "--maxGameDurationMs":
      case "--max-game-duration-ms":
        parsed.maxGameDurationMs = Number(next());
        break;
      case "--maxGameDurationRetries":
      case "--max-game-duration-retries":
        parsed.maxGameDurationRetries = Number(next());
        break;
      case "--maxGameDurationMultiplier":
      case "--max-game-duration-multiplier":
        parsed.maxGameDurationMultiplier = Number(next());
        break;
      case "--maxGameDurationCeilingMs":
      case "--max-game-duration-ceiling-ms":
        parsed.maxGameDurationCeilingMs = Number(next());
        break;
      case "--maxReplacementGames":
      case "--max-replacement-games":
        parsed.maxReplacementGames = Number(next());
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
      case "--deckStrategy":
      case "--deck-strategy": {
        const value = next();
        if (value !== "random" && value !== "coverage_guided") {
          throw new Error(`unknown deck strategy: ${value}`);
        }
        parsed.deckStrategy = value;
        break;
      }
      case "--focusCardCount":
      case "--focus-card-count":
        parsed.focusCardCount = Number(next());
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
      case "--wideChoiceThreshold":
      case "--wide-choice-threshold":
        parsed.wideChoiceThreshold = Number(next());
        break;
      case "--config":
      case "--configPath":
      case "--config-path":
        parsed.configPath = next();
        break;
      case "--checkpoint":
      case "--checkpointFile":
      case "--checkpoint-file":
        parsed.checkpointFile = next();
        break;
      case "--policyCheckpoint":
      case "--policyCheckpointPath":
      case "--policy-checkpoint":
      case "--policy-checkpoint-path":
        parsed.policyCheckpointPath = next();
        break;
      case "--policyExplorationRate":
      case "--policy-exploration-rate":
        parsed.policyExplorationRate = Number(next());
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "orica effect-debug-harvest",
    "",
    "Usage:",
    "  pnpm effect:debug -- --games 50 --maxSteps 4000 --seed 1 --agentA random --agentB mcts",
    "",
    "Options:",
    "  --config <path>              JSON run profile; CLI options override it",
    "  --checkpoint <path>          Resume only completed deterministic games from this ledger",
    "  --policyCheckpoint <path>    versioned checkpoint required by a policy agent",
    "  --policyExplorationRate <n>   deterministic epsilon exploration (default 0.15)",
    "  --maxForcedTransitions <n>   stuck guard for forced transitions (default 1000)",
    "  --maxRepeatedStateTransitions <n> stuck guard for revisited logical states (default 4)",
    "  --maxGameDurationMs <n>      initial elapsed-time cap (default 60000)",
    "  --maxGameDurationRetries <n> retry an elapsed cap with the same seed (default 2)",
    "  --maxGameDurationCeilingMs <n> retry ceiling (default 240000)",
    "  --maxReplacementGames <n>    extra seeds replacing persistent elapsed caps",
    "  --deckStrategy <name>        random or coverage_guided",
    "  --focusCardCount <n>         least-covered cards injected per deck (default 8)",
    "  --wideChoiceThreshold <n>    create low-severity tickets for wide decision nodes (0 disables)",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

async function resolveEffectDebugHarvestOptions(
  parsed: ParsedArgs
): Promise<EffectDebugHarvestCliOptions> {
  if (parsed.configPath === undefined) return parsed;
  const loaded = await loadTrainingRunConfig(parsed.configPath);
  requireTrainingRunProfile(loaded, "effect-debug-harvest");
  return mergeDefinedOptions(
    trainingRunConfigToEffectDebugHarvestOptions(loaded),
    parsed
  ) as EffectDebugHarvestCliOptions;
}

export async function runEffectDebugHarvestCli(
  argv: readonly string[]
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const summary = await runEffectDebugHarvest(
    await resolveEffectDebugHarvestOptions(parsed)
  );
  console.log(
    [
      `effect-debug-harvest collected ${summary.aggregate.qualifyingGames}/${summary.config.games} qualifying game(s) in ${summary.aggregate.attemptedGames} attempt(s) at ${summary.outputDir}`,
      `agents=${summary.config.agentA} vs ${summary.config.agentB}`,
      `outcomes=${JSON.stringify(summary.aggregate.outcomeCounts)}`,
      `tickets=${summary.aggregate.totalTickets}`,
      `ticketCounts=${JSON.stringify(summary.aggregate.ticketCounts)}`,
    ].join("\n")
  );
}

if (isDirectExecution()) {
  runEffectDebugHarvestCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
