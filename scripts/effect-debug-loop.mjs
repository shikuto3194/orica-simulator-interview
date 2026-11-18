#!/usr/bin/env node
/**
 * effect-debug-loop — 1 tick 分の effect-debug harvest/triage 制御。
 *
 * open EDH cluster がある間は harvest を増やさず、修正 lane に渡す。
 */

import { spawnSync } from "node:child_process";
import { checkStorage } from "./artifact-storage.mjs";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  countEffectDebugClusters,
  triageEffectDebugArtifacts,
} from "./effect-debug-triage.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(SCRIPT_DIR, ".."));
const DEFAULT_STAGE_GAMES = [10, 50, 100, 200, 1000, 3000];
const DEFAULT_FINAL_STAGE_GAMES = 3000;
const DEFAULT_POST_SATURATION_SOAK_GAMES = [5000, 10000];
const DEFAULT_FULL_STAGE_GAMES = [
  ...DEFAULT_STAGE_GAMES,
  ...DEFAULT_POST_SATURATION_SOAK_GAMES,
];
const DEFAULT_PROMOTE_CAPPED_REPEATS = 2;
const STATE_SCHEMA_VERSION = 5;
const HARVEST_GAME_SEED_STRIDE = 0x9e3779b9;
const BATCH_SEED_STRIDE = 0x85ebca6b;
const POLICY_TRAINING_SEED_XOR = 0xa511e9b3;
const DEFAULT_MAX_NOVEL_SEMANTIC_KEYS = 8;
const DEFAULT_MAX_NOVEL_SEMANTIC_RATE = 0.01;
const DEFAULT_MIN_COVERAGE_COHORTS = 2;
const DEFAULT_PER_GAME_TIMEOUT_MS = 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_RUN_BUDGET_MS = 45 * 60 * 1000;
const DEFAULT_MAX_GAME_DURATION_CEILING_MS = 4 * 60 * 1000;
const DEFAULT_MAX_GAME_DURATION_RETRIES = 2;
const DEFAULT_MAX_GAME_DURATION_MULTIPLIER = 2;
const DEFAULT_STRESS_MAX_GAMES = 10;
const BEHAVIOR_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "packages/rules-core/package.json",
  "packages/rules-core/src",
  "packages/card-data/package.json",
  "packages/card-data/src",
  "apps/cli/package.json",
  "apps/cli/src",
  "apps/playground-web/test/selfplay-driver.ts",
  "apps/playground-web/test/selfplay-fuzz.test.ts",
  "scripts/effect-debug-harvest.mjs",
  "scripts/effect-debug-loop.mjs",
  "scripts/effect-debug-triage.mjs",
  "scripts/policy-bootstrap.mjs",
  "scripts/run-fuzz.mjs",
  "scripts/fuzz-seed-ledger.mjs",
  "scripts/cluster-claim.mjs",
];

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--json":
        out.json = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return out;
}

function usage() {
  return "Usage: node scripts/effect-debug-loop.mjs [--json]";
}

function pathEnv(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : resolve(raw);
}

function runtimePaths() {
  const repoRoot = pathEnv(
    "ORICA_EFFECT_DEBUG_HUB_ROOT",
    pathEnv("ORICA_SUPERVISOR_HUB_REPO", ROOT)
  );
  const worktreeRoot = pathEnv("ORICA_EFFECT_DEBUG_WORKTREE", ROOT);
  return {
    repoRoot,
    worktreeRoot,
    clusterRegistry:
      process.env.ORICA_CLUSTER_REGISTRY ||
      join(repoRoot, "autorun-queue", "cluster-registry.json"),
    harvestScript:
      process.env.ORICA_EFFECT_DEBUG_HARVEST ||
      join(worktreeRoot, "scripts", "effect-debug-harvest.mjs"),
    policyScript:
      process.env.ORICA_POLICY_SHADOW_SCRIPT ||
      join(worktreeRoot, "scripts", "policy-bootstrap.mjs"),
    reportScript:
      process.env.ORICA_EFFECT_DEBUG_REPORT ||
      join(repoRoot, "scripts", "supervisor-report.mjs"),
    stateFile:
      process.env.ORICA_EFFECT_DEBUG_STATE ||
      join(repoRoot, "logs", "effect-debug-loop-state.json"),
  };
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : fallback;
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const DEFAULT_EFFECT_DEBUG_MAX_OLD_SPACE_MB = 8192;

export function effectDebugNodeArgs(
  harvestScript,
  args,
  maxOldSpaceMb = intEnv(
    "ORICA_EFFECT_DEBUG_MAX_OLD_SPACE_MB",
    DEFAULT_EFFECT_DEBUG_MAX_OLD_SPACE_MB
  )
) {
  if (!Number.isInteger(maxOldSpaceMb) || maxOldSpaceMb <= 0) {
    throw new Error(
      "ORICA_EFFECT_DEBUG_MAX_OLD_SPACE_MB must be a positive integer"
    );
  }
  return [`--max-old-space-size=${maxOldSpaceMb}`, harvestScript, ...args];
}

export function policyShadowArgs(config) {
  const args = [
    "--games",
    String(config.games),
    "--maxSteps",
    String(config.maxSteps),
    "--seed",
    String(config.seed),
    "--maxGeneratedChoices",
    String(config.maxGeneratedChoices),
    "--deckSize",
    String(config.deckSize),
    "--skipPreGame",
    String(config.skipPreGame),
    "--dryRun",
    "false",
    "--hiddenDim",
    String(config.hiddenDim),
    "--batchSize",
    String(config.batchSize),
    "--maxChoices",
    String(config.maxChoices),
    "--learningRate",
    String(config.learningRate),
    "--epochs",
    String(config.epochs),
    "--gradientClipNorm",
    String(config.gradientClipNorm),
    "--explorationRate",
    String(config.explorationRate),
    "--restartIncompatibleCheckpoint",
    String(config.restartIncompatibleCheckpoint ?? true),
    "--experiment",
    config.experimentId,
    "--out",
    config.outDir,
    "--checkpointOut",
    config.checkpointOut,
  ];
  if (config.checkpointIn) {
    args.push("--checkpointIn", config.checkpointIn);
  }
  return args;
}

function nonNegativeNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function unitIntervalEnv(name, fallback) {
  const value = nonNegativeNumberEnv(name, fallback);
  return value <= 1 ? value : fallback;
}

function intListEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return parseStageGames(raw, fallback);
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function gitHeadShort(root = runtimePaths().worktreeRoot) {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

export function behaviorArtifactKey(behaviorFingerprint) {
  const normalized = String(behaviorFingerprint || "unknown")
    .replace(/^sha256-/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return (normalized || "unknown").slice(0, 12);
}

export function effectDebugExperimentId({
  behaviorFingerprint,
  head,
  games,
  stageIndex,
  seed,
}) {
  return (
    "edh-loop-b" +
    behaviorArtifactKey(behaviorFingerprint) +
    "-h" +
    behaviorArtifactKey(head) +
    "-g" +
    games +
    "-s" +
    stageIndex +
    "-seed" +
    seed
  );
}

export function policyCheckpointIdentityError(config) {
  if (config.agentA !== "policy" && config.agentB !== "policy") return null;
  if (!config.policyCheckpointPath) {
    return "policy agent requires a policy checkpoint";
  }
  if (!config.policyCheckpointSha256) {
    return "policy checkpoint is missing its fixed SHA-256 identity";
  }
  let actualSha256;
  try {
    actualSha256 = createHash("sha256")
      .update(readFileSync(config.policyCheckpointPath))
      .digest("hex");
  } catch (error) {
    return (
      "policy checkpoint cannot be read: " +
      (error instanceof Error ? error.message : String(error))
    );
  }
  return actualSha256 === config.policyCheckpointSha256
    ? null
    : `policy checkpoint SHA-256 changed: expected=${config.policyCheckpointSha256} actual=${actualSha256}`;
}

export function behaviorFingerprintFromGit(root = runtimePaths().worktreeRoot) {
  const result = spawnSync(
    "git",
    ["ls-tree", "-r", "HEAD", "--", ...BEHAVIOR_PATHS],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  );
  if (result.status !== 0) {
    throw new Error("cannot compute effect-debug behavior fingerprint");
  }
  return createHash("sha256").update(result.stdout).digest("hex");
}

function worktreeStatusLines(root = runtimePaths().worktreeRoot) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return ["git status failed"];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function porcelainPaths(line) {
  const rawPath = line.length > 3 ? line.slice(3).trim() : "";
  if (!rawPath) return [];
  const parts = rawPath.includes(" -> ") ? rawPath.split(" -> ") : [rawPath];
  return parts.map((path) => path.replace(/^"|"$/g, ""));
}

export function isIgnorableDirtyStatusLine(line) {
  const paths = porcelainPaths(line);
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        !path.includes("/") &&
        !path.includes("\\") &&
        path.startsWith(".verifier-")
    )
  );
}

function proofDirtyLines(root) {
  return worktreeStatusLines(root).filter(
    (line) => !isIgnorableDirtyStatusLine(line)
  );
}

function hourSeed(date = new Date()) {
  return Math.floor(date.getTime() / (60 * 60 * 1000)) >>> 0;
}

export function parseStageGames(raw, fallback = DEFAULT_STAGE_GAMES) {
  const tokens = String(raw ?? "")
    .split(",")
    .map((part) => part.trim());
  if (tokens.length === 0) return [...fallback];
  const values = tokens.map((part) => Number(part));
  const invalid = tokens.filter(
    (_part, index) => !Number.isInteger(values[index]) || values[index] <= 0
  );
  if (invalid.length > 0) {
    throw new Error(`invalid stage game value(s): ${invalid.join(", ")}`);
  }
  return values.length > 0 ? values : [...fallback];
}

export function normalizeStageGames(stageGames, finalStageGames) {
  for (let index = 1; index < stageGames.length; index += 1) {
    if (stageGames[index] <= stageGames[index - 1]) {
      throw new Error(
        `stage games must be strictly increasing: ${stageGames.join(",")}`
      );
    }
  }
  const values = [];
  for (const games of stageGames) {
    if (games >= finalStageGames) break;
    values.push(games);
  }
  if (values.at(-1) !== finalStageGames) values.push(finalStageGames);
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      throw new Error(
        `stage games must be strictly increasing: ${values.join(",")}`
      );
    }
  }
  return values;
}

export function parsePostSaturationSoakGames(
  raw,
  baselineStageGames = DEFAULT_FINAL_STAGE_GAMES
) {
  const values =
    raw === undefined || String(raw).trim() === ""
      ? DEFAULT_POST_SATURATION_SOAK_GAMES.filter(
          (games) => games > baselineStageGames
        )
      : parseStageGames(raw, []);
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      throw new Error(
        `post-saturation soak games must be strictly increasing: ${values.join(",")}`
      );
    }
  }
  if (values.some((games) => games <= baselineStageGames)) {
    throw new Error(
      `post-saturation soak games must exceed baseline ${baselineStageGames}: ${values.join(",")}`
    );
  }
  return values;
}

function stageKey(stageGames) {
  return stageGames.join(",");
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function coverageCohorts(state) {
  return Array.isArray(state.coverageCohorts)
    ? state.coverageCohorts
    : state.cleanBatches || [];
}

function ineligibleCohorts(state) {
  return Array.isArray(state.ineligibleCohorts) ? state.ineligibleCohorts : [];
}

function stressCohorts(state) {
  return Array.isArray(state.stressCohorts) ? state.stressCohorts : [];
}

function stressCohortKey(cohort) {
  if (typeof cohort?.artifactDir === "string" && cohort.artifactDir !== "") {
    return "artifact:" + cohort.artifactDir;
  }
  return (
    "fallback:" + (cohort?.experimentId ?? "") + ":" + (cohort?.seed ?? "")
  );
}

export function upsertStressCohort(cohorts, cohort) {
  const key = stressCohortKey(cohort);
  return [
    ...(Array.isArray(cohorts) ? cohorts : []).filter(
      (existing) =>
        !Number.isInteger(existing?.seed) || stressCohortKey(existing) !== key
    ),
    cohort,
  ].slice(-256);
}

function evidenceCohorts(state) {
  return [
    ...coverageCohorts(state),
    ...ineligibleCohorts(state),
    ...stressCohorts(state),
  ];
}

function priorObservedTickets(state) {
  return evidenceCohorts(state).flatMap((cohort) =>
    Array.isArray(cohort.observedTickets) ? cohort.observedTickets : []
  );
}

export function stressPriorObservedTickets(state, currentCoverageTickets = []) {
  return [
    ...priorObservedTickets(state),
    ...(Array.isArray(currentCoverageTickets) ? currentCoverageTickets : []),
  ];
}

function cleanGamesFromCohorts(cohorts) {
  return cohorts.reduce((sum, cohort) => sum + (cohort.games || 0), 0);
}

function evidenceSeeds(state) {
  return evidenceCohorts(state)
    .map((cohort) => cohort?.seed)
    .filter((seed) => Number.isInteger(seed));
}

function gameSeedsForBatch(seed, games) {
  const out = [];
  for (let index = 0; index < games; index += 1) {
    out.push((seed + Math.imul(index, HARVEST_GAME_SEED_STRIDE)) >>> 0);
  }
  return out;
}

function attemptedGameSeeds(state) {
  return evidenceCohorts(state).flatMap((batch) =>
    Array.isArray(batch.gameSeeds)
      ? batch.gameSeeds
      : Number.isInteger(batch.seed) && Number.isInteger(batch.games)
        ? gameSeedsForBatch(batch.seed >>> 0, batch.games)
        : []
  );
}

function gameSeedCollision(state, seed, games) {
  const usedGameSeeds = new Set(attemptedGameSeeds(state));
  return gameSeedsForBatch(seed, games).some((gameSeed) =>
    usedGameSeeds.has(gameSeed)
  );
}

function cappedRepeatAcrossBatches(state, observedTickets, threshold) {
  const bySignature = new Map();
  const add = (ticket) => {
    if (ticket?.kind !== "capped" || !ticket.signature) return;
    if (!bySignature.has(ticket.signature))
      bySignature.set(ticket.signature, new Set());
    if (Number.isInteger(ticket.seed))
      bySignature.get(ticket.signature).add(ticket.seed);
  };
  for (const batch of evidenceCohorts(state)) {
    for (const ticket of batch.observedTickets || []) add(ticket);
  }
  for (const ticket of observedTickets || []) add(ticket);
  return [...bySignature.entries()]
    .filter(([, seeds]) => seeds.size >= threshold)
    .map(([signature, seeds]) => ({
      signature,
      seeds: [...seeds].sort((a, b) => a - b),
    }));
}

function freshState({
  head,
  stageGames,
  reason,
  policyTraining = null,
  behaviorFingerprint = head,
}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    head,
    behaviorFingerprint,
    stageKey: stageKey(stageGames),
    stageIndex: 0,
    cleanBatches: [],
    coverageCohorts: [],
    ineligibleCohorts: [],
    stressCohorts: [],
    activeBatch: null,
    policyTraining,
    cleanGames: 0,
    stopReady: false,
    invalidSinceReset: 0,
    promotedSinceReset: 0,
    resetReason: reason,
    startedAt: now,
    updatedAt: now,
  };
}

export function normalizeStageState(
  raw,
  { head, stageGames, behaviorFingerprint = head }
) {
  const key = stageKey(stageGames);
  if (!raw || typeof raw !== "object") {
    return freshState({
      head,
      stageGames,
      reason: "missing",
      behaviorFingerprint,
    });
  }
  if (raw.schemaVersion !== STATE_SCHEMA_VERSION) {
    return freshState({
      head,
      stageGames,
      reason: "schema",
      behaviorFingerprint,
    });
  }
  if (raw.behaviorFingerprint !== behaviorFingerprint) {
    return freshState({
      head,
      stageGames,
      reason: "behavior",
      policyTraining: raw.policyTraining ?? null,
      behaviorFingerprint,
    });
  }
  const headChanged = raw.head !== head;
  if (raw.stageKey !== key) {
    return freshState({
      head,
      stageGames,
      reason: "config",
      policyTraining: raw.policyTraining ?? null,
      behaviorFingerprint,
    });
  }
  const stageIndex = Number.isInteger(raw.stageIndex)
    ? Math.max(0, Math.min(raw.stageIndex, stageGames.length))
    : 0;
  const cleanBatches = Array.isArray(raw.cleanBatches)
    ? raw.cleanBatches
        .filter(
          (batch) =>
            batch &&
            typeof batch === "object" &&
            Number.isInteger(batch.stageIndex) &&
            Number.isInteger(batch.games)
        )
        .slice(0, stageGames.length)
    : [];
  const coverageCohorts = Array.isArray(raw.coverageCohorts)
    ? raw.coverageCohorts.filter(
        (batch) =>
          batch &&
          typeof batch === "object" &&
          Number.isInteger(batch.stageIndex) &&
          Number.isInteger(batch.games)
      )
    : cleanBatches;
  const ineligibleCohorts = Array.isArray(raw.ineligibleCohorts)
    ? raw.ineligibleCohorts.filter(
        (batch) =>
          batch &&
          typeof batch === "object" &&
          Number.isInteger(batch.stageIndex) &&
          Number.isInteger(batch.games)
      )
    : [];
  const normalizedStressCohorts = Array.isArray(raw.stressCohorts)
    ? raw.stressCohorts
        .filter(
          (batch) =>
            batch &&
            typeof batch === "object" &&
            Number.isInteger(batch.stageIndex)
        )
        .reduce((cohorts, cohort) => upsertStressCohort(cohorts, cohort), [])
    : [];
  const cleanGames = cleanGamesFromCohorts(coverageCohorts);
  const normalized = {
    ...raw,
    head,
    behaviorFingerprint,
    stageKey: key,
    stageIndex,
    cleanBatches,
    coverageCohorts,
    ineligibleCohorts,
    stressCohorts: normalizedStressCohorts,
    activeBatch:
      !headChanged &&
      raw.activeBatch &&
      typeof raw.activeBatch === "object" &&
      Number.isInteger(raw.activeBatch.stageIndex) &&
      Number.isInteger(raw.activeBatch.seed)
        ? raw.activeBatch
        : null,
    cleanGames,
    invalidSinceReset: Number.isInteger(raw.invalidSinceReset)
      ? Math.max(0, raw.invalidSinceReset)
      : 0,
    promotedSinceReset: Number.isInteger(raw.promotedSinceReset)
      ? Math.max(0, raw.promotedSinceReset)
      : 0,
    stopReady: false,
    resetReason: headChanged ? null : raw.resetReason,
  };
  return {
    ...normalized,
    stopReady:
      Boolean(raw.stopReady) && stopConditions(normalized, stageGames, 0).ready,
  };
}

export function currentStagePlan(state, stageGames) {
  if (state.stopReady || state.stageIndex >= stageGames.length) {
    return {
      stopReady: true,
      games: 0,
      stageIndex: state.stageIndex,
      remainingStages: 0,
      batchGames: stageGames.at(-1),
    };
  }
  const batchGames = stageGames[state.stageIndex];
  return {
    stopReady: false,
    games: batchGames,
    stageIndex: state.stageIndex,
    remainingStages: stageGames.length - state.stageIndex,
    batchGames,
  };
}

function semanticKeys(coverage) {
  return Array.isArray(coverage?.semanticKeys) ? coverage.semanticKeys : [];
}

export function evaluateCoverageSaturation(
  priorCohorts,
  coverage,
  {
    minCohorts = DEFAULT_MIN_COVERAGE_COHORTS,
    maxNovelSemanticKeys = DEFAULT_MAX_NOVEL_SEMANTIC_KEYS,
    maxNovelSemanticRate = DEFAULT_MAX_NOVEL_SEMANTIC_RATE,
  } = {}
) {
  const priorKeys = new Set(
    priorCohorts.flatMap((cohort) => semanticKeys(cohort.coverage))
  );
  const currentKeys = semanticKeys(coverage);
  const novelKeys = currentKeys.filter((key) => !priorKeys.has(key));
  const combinedKeys = new Set([...priorKeys, ...currentKeys]);
  const noveltyRate =
    combinedKeys.size === 0 ? 1 : novelKeys.length / combinedKeys.size;
  const coverageEligible = coverage?.coverageEligible === true;
  const minCohortsMet = priorCohorts.length + 1 >= minCohorts;
  const saturationThresholdMet =
    novelKeys.length <= maxNovelSemanticKeys &&
    noveltyRate <= maxNovelSemanticRate;
  return {
    coverageEligible,
    cohortCount: priorCohorts.length + 1,
    minCohorts,
    totalSemanticKeys: combinedKeys.size,
    novelSemanticKeys: novelKeys.length,
    noveltyRate,
    maxNovelSemanticKeys,
    maxNovelSemanticRate,
    minCohortsMet,
    saturationThresholdMet,
    saturated: coverageEligible && minCohortsMet && saturationThresholdMet,
  };
}

function stageSeed(baseSeed, state, games) {
  const forced = process.env.ORICA_EFFECT_DEBUG_SEED;
  if (forced !== undefined && forced !== "")
    return intEnv("ORICA_EFFECT_DEBUG_SEED", baseSeed);
  const usedGameSeeds = new Set(attemptedGameSeeds(state));
  let seed = baseSeed >>> 0;
  let guard = 0;
  while (
    gameSeedsForBatch(seed, games).some((gameSeed) =>
      usedGameSeeds.has(gameSeed)
    ) &&
    guard < 1024
  ) {
    seed = (seed + BATCH_SEED_STRIDE) >>> 0;
    guard += 1;
  }
  return seed;
}

export function stopConditions(
  state,
  stageGames,
  openClusters = 0,
  promoteCappedRepeats = DEFAULT_PROMOTE_CAPPED_REPEATS
) {
  const cleanBatches = state.cleanBatches || [];
  const cohorts = evidenceCohorts(state);
  const seeds = evidenceSeeds(state);
  const gameSeeds = attemptedGameSeeds(state);
  const cleanStages = cleanBatches.every(
    (batch, index) =>
      batch.stageIndex === index && batch.games === stageGames[index]
  );
  const finalStageClean =
    cleanBatches.length >= stageGames.length &&
    cleanBatches[stageGames.length - 1]?.games === stageGames.at(-1) &&
    cleanBatches[stageGames.length - 1]?.coverageGate?.saturated === true;
  const allBatchesSeeded = cohorts.length === seeds.length;
  const conditions = {
    openClustersZero: openClusters === 0,
    headStable: state.resetReason !== "head",
    noInvalidSinceReset: state.invalidSinceReset === 0,
    noPromotedSinceReset: state.promotedSinceReset === 0,
    allBatchesSeeded,
    uniqueSeeds: seeds.length === new Set(seeds).size,
    allGameSeedsUnique: gameSeeds.length === new Set(gameSeeds).size,
    noCrossBatchCappedRepeats:
      cappedRepeatAcrossBatches(state, [], promoteCappedRepeats).length === 0,
    allStageBatchesClean:
      cleanBatches.length >= stageGames.length && cleanStages,
    finalStageClean,
    noActiveBatch:
      state.activeBatch === null || state.activeBatch === undefined,
  };
  return {
    ...conditions,
    ready: Object.values(conditions).every(Boolean),
  };
}

export function advanceStageAfterClean(
  state,
  stageGames,
  cleanGate,
  {
    artifactDir,
    seed,
    observedTickets = [],
    coverageGate = { saturated: true },
    runtime = null,
  }
) {
  const batchGameSeeds = Array.isArray(cleanGate.gameSeeds)
    ? cleanGate.gameSeeds
    : gameSeedsForBatch(seed, cleanGate.requestedGames);
  const qualifyingGameSeeds = Array.isArray(cleanGate.qualifyingGameSeeds)
    ? cleanGate.qualifyingGameSeeds
    : batchGameSeeds;
  const cohort = {
    stageIndex: state.stageIndex,
    games: cleanGate.requestedGames,
    attemptedGames: cleanGate.attemptedGames ?? batchGameSeeds.length,
    elapsedTimeReplacementCount: cleanGate.elapsedTimeReplacementCount ?? 0,
    seed,
    firstGameSeed: batchGameSeeds[0],
    lastGameSeed: batchGameSeeds.at(-1),
    gameSeedCount: batchGameSeeds.length,
    gameSeeds: batchGameSeeds,
    qualifyingGameSeeds,
    artifactDir,
    observedTickets,
    decisionFrames: cleanGate.totalDecisionFrames,
    effectDecisionFrames: cleanGate.effectDecisionFrames,
    uniqueSourceCardCount: cleanGate.uniqueSourceCardNos.length,
    coverage: cleanGate.coverage,
    coverageGate,
    runtime,
    completedAt: new Date().toISOString(),
  };
  const cohorts = [...coverageCohorts(state), cohort];
  const stageAdvanced = coverageGate.saturated === true;
  const cleanBatches = stageAdvanced
    ? [...(state.cleanBatches || []), cohort]
    : state.cleanBatches || [];
  const nextStageIndex = state.stageIndex + (stageAdvanced ? 1 : 0);
  const nextState = {
    ...state,
    stageIndex: nextStageIndex,
    cleanBatches,
    coverageCohorts: cohorts,
    activeBatch: null,
    cleanGames: cleanGamesFromCohorts(cohorts),
    stopReady: nextStageIndex >= stageGames.length,
    invalidSinceReset: 0,
    promotedSinceReset: 0,
    resetReason: null,
    lastCleanAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastCoverageGate: coverageGate,
    stageAdvanced,
  };
  return {
    ...nextState,
    stopReady: stopConditions(nextState, stageGames, 0).ready,
  };
}

export function resetStageState(
  state,
  { reason, invalid = false, promoted = false }
) {
  const now = new Date().toISOString();
  return {
    ...state,
    stageIndex: 0,
    cleanBatches: [],
    coverageCohorts: [],
    ineligibleCohorts: [
      ...ineligibleCohorts(state),
      ...coverageCohorts(state),
    ].slice(-256),
    stressCohorts: stressCohorts(state).slice(-256),
    activeBatch: null,
    cleanGames: 0,
    stopReady: false,
    invalidSinceReset: invalid ? 1 : 0,
    promotedSinceReset: promoted ? 1 : 0,
    resetReason: reason,
    startedAt: now,
    updatedAt: now,
  };
}

function report(kind, text, paths = runtimePaths()) {
  const result = spawnSync(
    process.execPath,
    [paths.reportScript, "--kind", kind, "--repo", paths.repoRoot, "--stdin"],
    {
      cwd: paths.repoRoot,
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  return result.status === 0;
}

export function runShadowTraining(config) {
  const previous = config.state.policyTraining;
  const checkpointIn =
    previous?.checkpointFile && existsSync(previous.checkpointFile)
      ? previous.checkpointFile
      : null;
  const runIndex =
    (Number.isInteger(previous?.runIndex) ? previous.runIndex : 0) + 1;
  const seed = (config.seed ^ POLICY_TRAINING_SEED_XOR) >>> 0;
  const experimentBaseId = `policy-shadow-${config.state.head}-r${runIndex}-seed${seed}`;
  let experimentId = experimentBaseId;
  let outDir = join(
    config.repoRoot,
    "artifacts",
    "policy-shadow",
    experimentId
  );
  let retryIndex = 1;
  while (existsSync(outDir)) {
    experimentId = `${experimentBaseId}-retry${retryIndex}`;
    outDir = join(config.repoRoot, "artifacts", "policy-shadow", experimentId);
    retryIndex += 1;
  }
  const checkpointOut = join(outDir, "checkpoint.json");
  mkdirSync(outDir, { recursive: true });
  const trainingConfig = {
    ...config.shadowTraining,
    seed,
    experimentId,
    outDir,
    checkpointIn,
    checkpointOut,
    restartIncompatibleCheckpoint: true,
  };
  const startedAtMs = Date.now();
  const result = spawnSync(
    process.execPath,
    [config.policyScript, ...policyShadowArgs(trainingConfig)],
    {
      cwd: config.worktreeRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.shadowTraining.timeoutMs,
    }
  );
  const elapsedMs = Date.now() - startedAtMs;
  if (result.status !== 0) {
    return {
      status: "failed",
      detail: String(result.stderr || result.stdout || "no output").slice(
        -4000
      ),
      timedOut: result.error?.code === "ETIMEDOUT",
      elapsedMs,
      experimentId,
      outDir,
    };
  }
  const metricsFile = join(outDir, "metrics.json");
  const metrics = readJson(metricsFile);
  const training = metrics?.training;
  const sampleCount = metrics?.replayBuffer?.sampleCount;
  const evaluatedSampleCount = metrics?.loss?.sampleCount;
  const valueUsableSampleCount = metrics?.loss?.valueUsableSampleCount;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    metrics?.profile !== "policy-bootstrap" ||
    metrics?.dryRun !== false ||
    metrics?.checkpoint?.written !== true ||
    typeof metrics.checkpoint.file !== "string" ||
    resolve(metrics.checkpoint.file) !== resolve(checkpointOut) ||
    !existsSync(checkpointOut) ||
    ![
      training?.appliedUpdates,
      training?.initialTrainingStep,
      training?.finalTrainingStep,
      metrics.checkpoint.trainingStep,
      sampleCount,
      evaluatedSampleCount,
      valueUsableSampleCount,
    ].every(count) ||
    !Number.isFinite(training.learningRate) ||
    training.learningRate <= 0 ||
    training.finalTrainingStep - training.initialTrainingStep !==
      training.appliedUpdates ||
    metrics.checkpoint.trainingStep !== training.finalTrainingStep ||
    valueUsableSampleCount > evaluatedSampleCount ||
    evaluatedSampleCount > sampleCount ||
    (training.appliedUpdates > 0 && valueUsableSampleCount === 0) ||
    readJson(checkpointOut)?.network?.trainingStep !==
      training.finalTrainingStep ||
    createHash("sha256").update(readFileSync(checkpointOut)).digest("hex") !==
      metrics.checkpoint.sha256
  ) {
    return {
      status: "failed",
      detail: `invalid shadow training metrics/checkpoint: ${metricsFile}`,
      timedOut: false,
      elapsedMs,
      experimentId,
      outDir,
    };
  }
  // This debug path trains actor/value heads from natural-result samples.
  // A written checkpoint, historical trainingStep or replay rows alone do not
  // establish a new update. Keep it separate from the I6 production learner.
  const status =
    valueUsableSampleCount === 0
      ? "no_data"
      : training.appliedUpdates === 0
        ? "no_update"
        : "trained";
  return {
    status,
    scope: "debug-shadow",
    reason:
      status === "no_data"
        ? "no_usable_value_samples"
        : status === "no_update"
          ? "zero_applied_updates"
          : "updates_applied",
    runIndex,
    commitHash: config.state.head,
    experimentId,
    artifactDir: outDir,
    metricsFile,
    checkpointFile: metrics.checkpoint.file,
    checkpointSha256: metrics.checkpoint.sha256,
    parentCheckpointFile: metrics.checkpointResume?.resumedFile ?? null,
    discardedCheckpointFile: metrics.checkpointResume?.discardedFile ?? null,
    discardedCheckpointReason: metrics.checkpointResume?.discardReason ?? null,
    trainingStep: metrics.checkpoint.trainingStep,
    initialTrainingStep: training.initialTrainingStep,
    trainingStepDelta:
      training.finalTrainingStep - training.initialTrainingStep,
    appliedUpdates: training.appliedUpdates,
    sampleCount,
    evaluatedSampleCount,
    valueUsableSampleCount,
    loss: metrics.loss ?? null,
    elapsedMs,
    completedAt: new Date().toISOString(),
  };
}

export function effectDebugHarvestArgs(config) {
  const args = [
    "--games",
    String(config.games),
    "--maxSteps",
    String(config.maxSteps),
    "--maxForcedTransitions",
    String(config.maxForcedTransitions),
    "--maxRepeatedStateTransitions",
    String(config.maxRepeatedStateTransitions),
    "--maxGameDurationMs",
    String(config.maxGameDurationMs),
    "--maxGameDurationRetries",
    String(config.maxGameDurationRetries),
    "--maxGameDurationMultiplier",
    String(config.maxGameDurationMultiplier),
    "--maxGameDurationCeilingMs",
    String(config.maxGameDurationCeilingMs),
    "--maxReplacementGames",
    String(config.maxReplacementGames),
    "--seed",
    String(config.seed),
    "--maxGeneratedChoices",
    String(config.maxGeneratedChoices),
    "--deckSize",
    String(config.deckSize),
    "--deckStrategy",
    config.deckStrategy,
    "--focusCardCount",
    String(config.focusCardCount),
    "--skipPreGame",
    String(config.skipPreGame),
    "--agentA",
    config.agentA,
    "--agentB",
    config.agentB,
    "--wideChoiceThreshold",
    String(config.wideChoiceThreshold),
    "--experiment",
    config.experimentId,
    "--out",
    config.outDir,
    "--checkpoint",
    config.checkpointFile,
  ];
  if (config.policyCheckpointPath) {
    args.push(
      "--policyCheckpoint",
      config.policyCheckpointPath,
      "--policyExplorationRate",
      String(config.policyExplorationRate)
    );
  }
  return args;
}

function runHarvest(config) {
  mkdirSync(config.outDir, { recursive: true });
  const args = effectDebugHarvestArgs(config);
  const startedAtMs = Date.now();
  const result = spawnSync(
    process.execPath,
    effectDebugNodeArgs(config.harvestScript, args),
    {
      cwd: config.worktreeRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.timeoutMs,
    }
  );
  return {
    ...result,
    elapsedMs: Date.now() - startedAtMs,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

export function classifyMctsStress(cleanGate, games) {
  const qualifyingGames = cleanGate?.qualifyingGames ?? 0;
  const coverageEligible = cleanGate?.coverage?.coverageEligible === true;
  if (qualifyingGames >= games && coverageEligible) return "clean";
  return qualifyingGames < games && coverageEligible
    ? "performance"
    : "invalid";
}

export function selectStressSeed({
  coverageSeed,
  games,
  usedGameSeeds,
  priorSeed = null,
}) {
  if (Number.isInteger(priorSeed)) return priorSeed >>> 0;
  const used = new Set(usedGameSeeds);
  let seed = (coverageSeed ^ 0xc2b2ae35) >>> 0;
  while (gameSeedsForBatch(seed, games).some((value) => used.has(value))) {
    seed = (seed + BATCH_SEED_STRIDE) >>> 0;
  }
  return seed;
}

export function classifyStressHarvestFailure({
  timedOut,
  completedGames,
  priorCompletedGames,
}) {
  if (!timedOut) return "invalid";
  if (priorCompletedGames === null || completedGames > priorCompletedGames) {
    return "checkpointed-timeout";
  }
  return "checkpoint-stalled";
}

async function runMctsStress(config, currentCoverageTickets = []) {
  const experimentId = config.experimentId + "-mcts-stress";
  const outDir = join(
    config.repoRoot,
    "artifacts",
    "effect-debug",
    experimentId
  );
  const priorStress = [...stressCohorts(config.state)]
    .reverse()
    .find((cohort) => cohort.artifactDir === outDir);
  const seed = selectStressSeed({
    coverageSeed: config.seed,
    games: config.stressGames,
    usedGameSeeds: [
      ...attemptedGameSeeds(config.state),
      ...gameSeedsForBatch(
        config.seed,
        config.games + config.maxReplacementGames
      ),
    ],
    priorSeed: priorStress?.seed ?? null,
  });
  const checkpointFile = join(outDir, "checkpoint.json");
  const checkpoint = checkpointRuntime(checkpointFile);
  const stressTimeout = stressHarvestTimeout({
    games: config.stressGames,
    checkpoint,
    historicalStressCohorts: stressCohorts(config.state),
    fallbackPerGameMs: config.fallbackPerGameMs,
    startupGraceMs: config.startupGraceMs,
    minimumPerGameBudgetMs: config.retrySequenceBudgetMs,
    minimumTimeoutMs: config.minimumHarvestTimeoutMs,
    runBudgetMs: config.runBudgetMs,
  });
  const stressConfig = {
    ...config,
    games: config.stressGames,
    seed,
    experimentId,
    outDir,
    checkpointFile,
    checkpoint,
    adaptiveTimeout: stressTimeout.adaptiveTimeout,
    requiredBatchTimeoutMs: stressTimeout.requiredTimeoutMs,
    checkpointsAcrossRuns: stressTimeout.requiredTimeoutMs > config.runBudgetMs,
    timeoutMs: stressTimeout.timeoutMs,
    agentB: config.stressAgentB,
    deckStrategy: "random",
    focusCardCount: 0,
    maxReplacementGames: 0,
  };
  const harvest = runHarvest(stressConfig);
  const base = {
    stageIndex: config.state.stageIndex,
    games: config.stressGames,
    seed,
    artifactDir: outDir,
    profile: "mcts-stress",
    agentA: stressConfig.agentA,
    agentB: stressConfig.agentB,
    completedAt: new Date().toISOString(),
  };
  if (harvest.status !== 0) {
    const runtime = checkpointRuntime(stressConfig.checkpointFile);
    const priorCompletedGames = priorStress?.runtime?.completedGames ?? null;
    const status = classifyStressHarvestFailure({
      timedOut: harvest.timedOut,
      completedGames: runtime.completedGames,
      priorCompletedGames,
    });
    return {
      status,
      cohort: {
        ...base,
        status,
        observedTickets: [],
        gameSeeds: gameSeedsForBatch(seed, config.stressGames),
        runtime,
        detail: String(harvest.stderr || harvest.stdout || "no output").slice(
          -2000
        ),
      },
    };
  }

  const triage = await triageEffectDebugArtifacts({
    dir: outDir,
    requestedGames: config.stressGames,
    minDecisionFrames: 0,
    minEffectDecisions: 0,
    minUniqueCards: 0,
    promoteCappedRepeats: config.promoteCappedRepeats,
    promote: true,
    dryRun: false,
    allowIncompleteElapsed: true,
    repoRoot: config.repoRoot,
    worktreeRoot: config.worktreeRoot,
    clusterRegistry: config.clusterRegistry,
    priorObservedTickets: stressPriorObservedTickets(
      config.state,
      currentCoverageTickets
    ),
  });
  const runtime = checkpointRuntime(stressConfig.checkpointFile);
  const stressStatus = classifyMctsStress(triage.cleanGate, config.stressGames);
  const cohort = {
    ...base,
    status:
      stressStatus === "clean"
        ? "clean"
        : stressStatus === "performance"
          ? "performance-observed"
          : "correctness-invalid",
    observedTickets: triage.tickets.observed,
    gameSeeds: triage.cleanGate.gameSeeds,
    qualifyingGameSeeds: triage.cleanGate.qualifyingGameSeeds,
    attemptedGames: triage.cleanGate.attemptedGames,
    coverage: triage.cleanGate.coverage,
    runtime: {
      ...runtime,
      averageGameDurationMs:
        runtime.completedGames > 0
          ? runtime.totalGameDurationMs / runtime.completedGames
          : 0,
    },
  };
  if (triage.status === "promoted") {
    return { status: "promoted", cohort, triage };
  }
  if (triage.status === "invalid") {
    return { status: "invalid", cohort, triage };
  }
  return {
    status: stressStatus,
    cohort,
    triage,
  };
}

function checkpointRuntime(checkpointFile) {
  const checkpoint = readJson(checkpointFile);
  const runtime = checkpoint?.runtime;
  const completedGames = Array.isArray(checkpoint?.completedGameIndexes)
    ? checkpoint.completedGameIndexes.length
    : 0;
  return {
    completedGames,
    totalGameDurationMs:
      Number.isFinite(runtime?.totalGameDurationMs) &&
      runtime.totalGameDurationMs >= 0
        ? runtime.totalGameDurationMs
        : 0,
    maxGameDurationMs:
      Number.isFinite(runtime?.maxGameDurationMs) &&
      runtime.maxGameDurationMs >= 0
        ? runtime.maxGameDurationMs
        : 0,
    lastGameDurationMs:
      Number.isFinite(runtime?.lastGameDurationMs) &&
      runtime.lastGameDurationMs >= 0
        ? runtime.lastGameDurationMs
        : null,
  };
}

export function adaptiveHarvestTimeout({
  games,
  checkpoint,
  historicalCohorts = [],
  fallbackPerGameMs = DEFAULT_PER_GAME_TIMEOUT_MS,
  startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
  minimumPerGameBudgetMs = 0,
}) {
  const completedGames = Math.min(
    games,
    Math.max(0, checkpoint?.completedGames ?? 0)
  );
  const observedDurations = [
    checkpoint?.maxGameDurationMs,
    checkpoint?.lastGameDurationMs,
    ...(historicalCohorts || []).flatMap((cohort) => [
      cohort?.runtime?.maxGameDurationMs,
      cohort?.runtime?.averageGameDurationMs,
    ]),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const observedMaxMs = observedDurations.length
    ? Math.max(...observedDurations)
    : 0;
  const observedAverageMs =
    checkpoint?.completedGames > 0 && checkpoint.totalGameDurationMs > 0
      ? checkpoint.totalGameDurationMs / checkpoint.completedGames
      : 0;
  const perGameTimeoutMs = Math.ceil(
    Math.max(fallbackPerGameMs, observedMaxMs * 2, observedAverageMs * 4)
  );
  const parentPerGameBudgetMs = Math.ceil(
    Math.max(perGameTimeoutMs, minimumPerGameBudgetMs)
  );
  const remainingGames = Math.max(0, games - completedGames);
  return {
    completedGames,
    remainingGames,
    observedMaxMs,
    observedAverageMs,
    perGameTimeoutMs,
    parentPerGameBudgetMs,
    startupGraceMs,
    timeoutMs: startupGraceMs + parentPerGameBudgetMs * remainingGames,
  };
}

export function elapsedRetryBudgetMs({
  initialMaxGameDurationMs,
  maxGameDurationRetries,
  maxGameDurationMultiplier,
  maxGameDurationCeilingMs,
}) {
  let attemptBudgetMs = initialMaxGameDurationMs;
  let totalBudgetMs = 0;
  for (
    let attemptIndex = 0;
    attemptIndex <= maxGameDurationRetries;
    attemptIndex += 1
  ) {
    totalBudgetMs += attemptBudgetMs;
    if (attemptBudgetMs >= maxGameDurationCeilingMs) break;
    attemptBudgetMs = Math.min(
      maxGameDurationCeilingMs,
      Math.ceil(attemptBudgetMs * maxGameDurationMultiplier)
    );
  }
  return totalBudgetMs;
}

export function capHarvestTimeoutForRun(
  requiredTimeoutMs,
  runBudgetMs = DEFAULT_RUN_BUDGET_MS
) {
  if (!Number.isInteger(requiredTimeoutMs) || requiredTimeoutMs <= 0) {
    throw new Error("required harvest timeout must be a positive integer");
  }
  if (!Number.isInteger(runBudgetMs) || runBudgetMs <= 0) {
    throw new Error("effect-debug run budget must be a positive integer");
  }
  return Math.min(requiredTimeoutMs, runBudgetMs);
}

export function stressHarvestTimeout({
  games,
  checkpoint,
  historicalStressCohorts = [],
  fallbackPerGameMs = DEFAULT_PER_GAME_TIMEOUT_MS,
  startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
  minimumPerGameBudgetMs = 0,
  minimumTimeoutMs = 0,
  runBudgetMs = DEFAULT_RUN_BUDGET_MS,
}) {
  const adaptiveTimeout = adaptiveHarvestTimeout({
    games,
    checkpoint,
    historicalCohorts: historicalStressCohorts,
    fallbackPerGameMs,
    startupGraceMs,
    minimumPerGameBudgetMs,
  });
  const requiredTimeoutMs = Math.max(
    adaptiveTimeout.timeoutMs,
    minimumTimeoutMs
  );
  return {
    adaptiveTimeout,
    requiredTimeoutMs,
    timeoutMs: capHarvestTimeoutForRun(requiredTimeoutMs, runBudgetMs),
  };
}
export function recordParentTimeout(activeBatch, completedGames, now) {
  const previousCompletedGames = Number.isInteger(
    activeBatch?.lastCheckpointCompletedGames
  )
    ? Math.max(0, activeBatch.lastCheckpointCompletedGames)
    : 0;
  const madeProgress = completedGames > previousCompletedGames;
  const previousNoProgressTimeoutCount = Number.isInteger(
    activeBatch?.noProgressTimeoutCount
  )
    ? Math.max(0, activeBatch.noProgressTimeoutCount)
    : 0;
  const noProgressTimeoutCount = madeProgress
    ? 0
    : previousNoProgressTimeoutCount + 1;
  const recordedAt = now ?? new Date().toISOString();

  return {
    previousCompletedGames,
    madeProgress,
    noProgressTimeoutCount,
    activeBatch: {
      ...activeBatch,
      lastCheckpointCompletedGames: completedGames,
      noProgressTimeoutCount,
      lastParentTimeoutAt: recordedAt,
      ...(madeProgress
        ? { parentTimeoutStalledAt: null }
        : {
            parentTimeoutStalledAt:
              activeBatch?.parentTimeoutStalledAt ?? recordedAt,
          }),
    },
  };
}

export function loopConfig() {
  const paths = runtimePaths();
  const baselineStageGames = intEnv(
    "ORICA_EFFECT_DEBUG_FINAL_STAGE_GAMES",
    intEnv("ORICA_EFFECT_DEBUG_FINAL_CLEAN_GAMES", DEFAULT_FINAL_STAGE_GAMES)
  );
  const configuredStageGames =
    process.env.ORICA_EFFECT_DEBUG_STAGE_GAMES !== undefined
      ? intListEnv("ORICA_EFFECT_DEBUG_STAGE_GAMES", DEFAULT_STAGE_GAMES)
      : [...DEFAULT_STAGE_GAMES];
  const baselineStages = normalizeStageGames(
    configuredStageGames,
    baselineStageGames
  );
  const soakStages = parsePostSaturationSoakGames(
    process.env.ORICA_EFFECT_DEBUG_POST_SATURATION_SOAK_GAMES,
    baselineStageGames
  );
  const stageGames = [...baselineStages, ...soakStages];
  const stateFile = paths.stateFile;
  const head = gitHeadShort(paths.worktreeRoot);
  const behaviorFingerprint = behaviorFingerprintFromGit(paths.worktreeRoot);
  const state = normalizeStageState(readJson(stateFile), {
    head,
    stageGames,
    behaviorFingerprint,
  });
  const stagePlan = currentStagePlan(state, stageGames);
  const activeBatch =
    state.activeBatch?.stageIndex === stagePlan.stageIndex &&
    state.activeBatch?.games === stagePlan.games
      ? state.activeBatch
      : null;
  const plannedReplacementGames =
    activeBatch?.maxReplacementGames ??
    intEnv(
      "ORICA_EFFECT_DEBUG_MAX_REPLACEMENT_GAMES",
      Math.max(5, Math.ceil(stagePlan.games * 0.1))
    );
  const seed =
    activeBatch?.seed ??
    stageSeed(hourSeed(), state, stagePlan.games + plannedReplacementGames);
  const experimentId =
    activeBatch?.experimentId ??
    effectDebugExperimentId({
      behaviorFingerprint,
      head,
      games: stagePlan.games,
      stageIndex: stagePlan.stageIndex,
      seed,
    });
  const outDir =
    activeBatch?.outDir ??
    join(paths.repoRoot, "artifacts", "effect-debug", experimentId);
  const checkpointFile =
    activeBatch?.checkpointFile ?? join(outDir, "checkpoint.json");
  const checkpoint = checkpointRuntime(checkpointFile);
  const fallbackPerGameMs = intEnv(
    "ORICA_EFFECT_DEBUG_PER_GAME_TIMEOUT_MS",
    DEFAULT_PER_GAME_TIMEOUT_MS
  );
  const startupGraceMs = intEnv(
    "ORICA_EFFECT_DEBUG_STARTUP_GRACE_MS",
    DEFAULT_STARTUP_GRACE_MS
  );
  const maxGameDurationCeilingMs =
    activeBatch?.maxGameDurationCeilingMs ??
    positiveIntEnv(
      "ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_CEILING_MS",
      DEFAULT_MAX_GAME_DURATION_CEILING_MS
    );
  const maxGameDurationRetries =
    activeBatch?.maxGameDurationRetries ??
    intEnv(
      "ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_RETRIES",
      DEFAULT_MAX_GAME_DURATION_RETRIES
    );
  const maxGameDurationMultiplier =
    activeBatch?.maxGameDurationMultiplier ??
    nonNegativeNumberEnv(
      "ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_MULTIPLIER",
      DEFAULT_MAX_GAME_DURATION_MULTIPLIER
    );
  const observedAdaptiveTimeout = adaptiveHarvestTimeout({
    games: stagePlan.games + plannedReplacementGames,
    checkpoint,
    historicalCohorts: evidenceCohorts(state),
    fallbackPerGameMs,
    startupGraceMs,
  });
  const adaptiveMaxGameDurationMs = Math.min(
    maxGameDurationCeilingMs,
    Math.max(
      positiveIntEnv(
        "ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_MS",
        DEFAULT_PER_GAME_TIMEOUT_MS
      ),
      observedAdaptiveTimeout.perGameTimeoutMs
    )
  );
  const maxGameDurationMs =
    activeBatch?.maxGameDurationMs ?? adaptiveMaxGameDurationMs;
  const retrySequenceBudgetMs = elapsedRetryBudgetMs({
    initialMaxGameDurationMs: maxGameDurationMs,
    maxGameDurationRetries,
    maxGameDurationMultiplier,
    maxGameDurationCeilingMs,
  });
  const adaptiveTimeout = adaptiveHarvestTimeout({
    games: stagePlan.games + plannedReplacementGames,
    checkpoint,
    historicalCohorts: evidenceCohorts(state),
    fallbackPerGameMs,
    startupGraceMs,
    minimumPerGameBudgetMs: retrySequenceBudgetMs,
  });
  const maxReplacementGames = plannedReplacementGames;
  const minimumHarvestTimeoutMs = intEnv("ORICA_EFFECT_DEBUG_TIMEOUT_MS", 0);
  const requiredBatchTimeoutMs = Math.max(
    adaptiveTimeout.timeoutMs,
    minimumHarvestTimeoutMs
  );
  const runBudgetMs = positiveIntEnv(
    "ORICA_EFFECT_DEBUG_RUN_BUDGET_MS",
    DEFAULT_RUN_BUDGET_MS
  );
  const shadowTrainingEnabled = boolEnv("ORICA_POLICY_SHADOW_TRAINING", true);
  const policyCheckpointPath =
    activeBatch?.policyCheckpointPath ??
    (state.policyTraining?.checkpointFile &&
    existsSync(state.policyTraining.checkpointFile)
      ? state.policyTraining.checkpointFile
      : null);
  const policyCheckpointSha256 =
    activeBatch?.policyCheckpointSha256 ??
    (policyCheckpointPath === state.policyTraining?.checkpointFile
      ? (state.policyTraining?.checkpointSha256 ?? null)
      : null);
  return {
    experimentId,
    repoRoot: paths.repoRoot,
    worktreeRoot: paths.worktreeRoot,
    clusterRegistry: paths.clusterRegistry,
    harvestScript: paths.harvestScript,
    policyScript: paths.policyScript,
    reportScript: paths.reportScript,
    games: stagePlan.games,
    stageGames,
    stagePlan,
    state,
    stateFile,
    behaviorFingerprint,
    baselineStageGames,
    finalStageGames: stageGames.at(-1),
    soakStages,
    stopOnFinalClean: boolEnv("ORICA_EFFECT_DEBUG_STOP_ON_FINAL_CLEAN", true),
    shadowTrainingEnabled,
    shadowTraining: {
      games: intEnv("ORICA_POLICY_SHADOW_GAMES", 4),
      maxSteps: intEnv("ORICA_POLICY_SHADOW_MAX_STEPS", 4000),
      maxGeneratedChoices: intEnv("ORICA_POLICY_SHADOW_MAX_CHOICES", 1024),
      deckSize: intEnv("ORICA_POLICY_SHADOW_DECK_SIZE", 40),
      skipPreGame: boolEnv("ORICA_POLICY_SHADOW_SKIP_PREGAME", false),
      hiddenDim: intEnv("ORICA_POLICY_SHADOW_HIDDEN_DIM", 64),
      batchSize: intEnv("ORICA_POLICY_SHADOW_BATCH_SIZE", 512),
      maxChoices: intEnv("ORICA_POLICY_SHADOW_BATCH_MAX_CHOICES", 256),
      learningRate: nonNegativeNumberEnv(
        "ORICA_POLICY_SHADOW_LEARNING_RATE",
        0.001
      ),
      epochs: intEnv("ORICA_POLICY_SHADOW_EPOCHS", 1),
      gradientClipNorm: nonNegativeNumberEnv(
        "ORICA_POLICY_SHADOW_GRADIENT_CLIP_NORM",
        5
      ),
      explorationRate: unitIntervalEnv(
        "ORICA_POLICY_SHADOW_EXPLORATION_RATE",
        0.15
      ),
      timeoutMs: intEnv("ORICA_POLICY_SHADOW_TIMEOUT_MS", 15 * 60 * 1000),
    },
    policyCheckpointPath,
    policyCheckpointSha256,
    policyExplorationRate:
      activeBatch?.policyExplorationRate ??
      unitIntervalEnv("ORICA_EFFECT_DEBUG_POLICY_EXPLORATION_RATE", 0.15),
    maxSteps:
      activeBatch?.maxSteps ?? intEnv("ORICA_EFFECT_DEBUG_MAX_STEPS", 4000),
    maxForcedTransitions:
      activeBatch?.maxForcedTransitions ??
      intEnv("ORICA_EFFECT_DEBUG_MAX_FORCED_TRANSITIONS", 1000),
    maxRepeatedStateTransitions:
      activeBatch?.maxRepeatedStateTransitions ??
      intEnv("ORICA_EFFECT_DEBUG_MAX_REPEATED_STATE_TRANSITIONS", 4),
    maxGameDurationMs,
    maxGameDurationRetries,
    maxGameDurationMultiplier,
    maxGameDurationCeilingMs,
    maxReplacementGames,
    seed,
    maxGeneratedChoices:
      activeBatch?.maxGeneratedChoices ??
      intEnv("ORICA_EFFECT_DEBUG_MAX_CHOICES", 1024),
    deckSize:
      activeBatch?.deckSize ?? intEnv("ORICA_EFFECT_DEBUG_DECK_SIZE", 40),
    deckStrategy:
      activeBatch?.deckStrategy ??
      process.env.ORICA_EFFECT_DEBUG_DECK_STRATEGY ??
      "coverage_guided",
    focusCardCount:
      activeBatch?.focusCardCount ??
      intEnv("ORICA_EFFECT_DEBUG_FOCUS_CARD_COUNT", 8),
    stressGames:
      activeBatch?.stressGames ??
      Math.min(
        positiveIntEnv(
          "ORICA_EFFECT_DEBUG_STRESS_MAX_GAMES",
          DEFAULT_STRESS_MAX_GAMES
        ),
        Math.max(1, Math.ceil(stagePlan.games * 0.02))
      ),
    skipPreGame:
      activeBatch?.skipPreGame ??
      boolEnv("ORICA_EFFECT_DEBUG_SKIP_PREGAME", false),
    agentA:
      activeBatch?.agentA ??
      process.env.ORICA_EFFECT_DEBUG_AGENT_A ??
      (shadowTrainingEnabled ? "policy" : "random"),
    agentB:
      activeBatch?.agentB ?? process.env.ORICA_EFFECT_DEBUG_AGENT_B ?? "random",
    stressAgentB:
      activeBatch?.stressAgentB ??
      process.env.ORICA_EFFECT_DEBUG_STRESS_AGENT_B ??
      "mcts",
    wideChoiceThreshold:
      activeBatch?.wideChoiceThreshold ??
      intEnv("ORICA_EFFECT_DEBUG_WIDE_THRESHOLD", 128),
    minDecisionFrames: intEnv("ORICA_EFFECT_DEBUG_MIN_DECISION_FRAMES", 1),
    minEffectDecisions: intEnv("ORICA_EFFECT_DEBUG_MIN_EFFECT_DECISIONS", 1),
    minUniqueCards: intEnv("ORICA_EFFECT_DEBUG_MIN_UNIQUE_CARDS", 1),
    promoteCappedRepeats: intEnv(
      "ORICA_EFFECT_DEBUG_PROMOTE_CAPPED_REPEATS",
      DEFAULT_PROMOTE_CAPPED_REPEATS
    ),
    minCoverageCohorts: intEnv(
      "ORICA_EFFECT_DEBUG_MIN_COVERAGE_COHORTS",
      DEFAULT_MIN_COVERAGE_COHORTS
    ),
    maxNovelSemanticKeys: intEnv(
      "ORICA_EFFECT_DEBUG_MAX_NOVEL_SEMANTIC_KEYS",
      DEFAULT_MAX_NOVEL_SEMANTIC_KEYS
    ),
    maxNovelSemanticRate: nonNegativeNumberEnv(
      "ORICA_EFFECT_DEBUG_MAX_NOVEL_SEMANTIC_RATE",
      DEFAULT_MAX_NOVEL_SEMANTIC_RATE
    ),
    checkpointFile,
    checkpoint,
    adaptiveTimeout,
    fallbackPerGameMs,
    startupGraceMs,
    retrySequenceBudgetMs,
    minimumHarvestTimeoutMs,
    requiredBatchTimeoutMs,
    runBudgetMs,
    checkpointsAcrossRuns: requiredBatchTimeoutMs > runBudgetMs,
    // The adaptive estimate still protects a single game from an undersized
    // legacy timeout. The per-supervisor budget intentionally slices a large
    // cohort; completed games are atomic and the next run resumes the ledger.
    timeoutMs: capHarvestTimeoutForRun(requiredBatchTimeoutMs, runBudgetMs),
    outDir,
  };
}

export async function runEffectDebugLoop() {
  const paths = runtimePaths();
  if (process.env.ORICA_EFFECT_DEBUG_LOOP === "0") {
    return {
      schemaVersion: 1,
      action: "disabled",
      skipWorker: false,
      openClusters: countEffectDebugClusters(paths.clusterRegistry),
    };
  }

  const openClusters = countEffectDebugClusters(paths.clusterRegistry);
  if (openClusters > 0) {
    const priorState = readJson(paths.stateFile);
    const state = freshState({
      head: gitHeadShort(paths.worktreeRoot),
      stageGames: DEFAULT_FULL_STAGE_GAMES,
      reason: "open-clusters",
      policyTraining: priorState?.policyTraining ?? null,
    });
    writeJsonAtomic(
      paths.stateFile,
      resetStageState(state, { reason: "open-clusters" })
    );
    return {
      schemaVersion: 1,
      action: "repair-existing",
      skipWorker: false,
      openClusters,
    };
  }

  let config;
  try {
    config = loopConfig();
  } catch (error) {
    const state = freshState({
      head: gitHeadShort(paths.worktreeRoot),
      stageGames: DEFAULT_FULL_STAGE_GAMES,
      reason: "stage-config-invalid",
    });
    writeJsonAtomic(
      paths.stateFile,
      resetStageState(state, {
        reason: "stage-config-invalid",
        invalid: true,
      })
    );
    const message = error instanceof Error ? error.message : String(error);
    report(
      "error",
      [
        "effect-debug-harvest invalid: stage config parse failed",
        message,
        "clean 証拠には数えず、段階を先頭へ戻します。",
      ].join("\n"),
      paths
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: true,
      openClusters,
      invalidReasons: [message],
    };
  }

  const dirtyLines = proofDirtyLines(config.worktreeRoot);
  if (dirtyLines.length > 0) {
    report(
      "error",
      [
        "effect-debug-harvest invalid: worktree is dirty",
        ...dirtyLines.slice(0, 20).map((line) => `- ${line}`),
        "clean 証拠には数えず、段階を先頭へ戻します。",
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, { reason: "dirty-worktree", invalid: true })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: false,
      openClusters: 0,
      invalidReasons: ["dirty worktree"],
    };
  }

  if (config.stagePlan.stopReady) {
    const conditions = stopConditions(
      config.state,
      config.stageGames,
      0,
      config.promoteCappedRepeats
    );
    if (config.stopOnFinalClean && conditions.ready) {
      return {
        schemaVersion: 1,
        action: "stop-ready",
        skipWorker: true,
        openClusters: 0,
        cleanGames: config.state.cleanGames,
        finalStageGames: config.finalStageGames,
        stopConditions: conditions,
      };
    }
    const reason = conditions.ready
      ? "continue-after-final-clean"
      : "invalid-stage-state";
    if (!conditions.ready) {
      report(
        "error",
        [
          "effect-debug-harvest invalid: staged clean state is inconsistent",
          `stopConditions=${JSON.stringify(conditions)}`,
          "clean 証拠には数えず、段階を先頭へ戻します。",
        ].join("\n"),
        config
      );
    }
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason,
        invalid: !conditions.ready,
      })
    );
    return {
      schemaVersion: 1,
      action: conditions.ready ? "final-clean-continued" : "invalid",
      skipWorker: true,
      openClusters: 0,
      cleanGames: config.state.cleanGames,
      finalStageGames: config.finalStageGames,
      stopConditions: conditions,
    };
  }

  if (
    evidenceSeeds(config.state).includes(config.seed) ||
    gameSeedCollision(
      config.state,
      config.seed,
      config.games + config.maxReplacementGames
    )
  ) {
    report(
      "error",
      [
        "effect-debug-harvest invalid: duplicate seed in staged clean run",
        `seed=${config.seed}`,
        `stageIndex=${config.state.stageIndex}`,
        "clean 証拠には数えず、段階を先頭へ戻します。",
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, { reason: "duplicate-seed", invalid: true })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: true,
      openClusters: 0,
      invalidReasons: [`duplicate seed: ${config.seed}`],
    };
  }

  if (!config.state.activeBatch && config.shadowTrainingEnabled) {
    const shadowTraining = runShadowTraining(config);
    if (shadowTraining.status !== "trained") {
      const noProgress = ["no_data", "no_update"].includes(
        shadowTraining.status
      );
      const message = shadowTraining.timedOut
        ? "policy shadow training timed out"
        : noProgress
          ? `policy shadow training made no update: ${shadowTraining.reason}`
          : "policy shadow training failed";
      report(
        "error",
        [
          message,
          `experiment=${shadowTraining.experimentId}`,
          `artifact=${shadowTraining.artifactDir ?? shadowTraining.outDir}`,
          `scope=debug-shadow status=${shadowTraining.status}`,
          `appliedUpdates=${shadowTraining.appliedUpdates ?? "unknown"} trainingStepDelta=${shadowTraining.trainingStepDelta ?? "unknown"} valueUsableSamples=${shadowTraining.valueUsableSampleCount ?? "unknown"}`,
          shadowTraining.detail,
          "effect-debug cohort was not started; diagnostics are returned for worker review.",
        ].join("\n"),
        config
      );
      writeJsonAtomic(config.stateFile, {
        ...resetStageState(config.state, {
          reason: noProgress
            ? "policy-training-no-progress"
            : "policy-training-failed",
          invalid: true,
        }),
        // Preserve the prior usable checkpoint. A no-progress attempt is
        // diagnostic state, never a replacement model or clean cohort.
        lastPolicyTrainingAttempt: shadowTraining,
      });
      return {
        schemaVersion: 1,
        action: noProgress
          ? "policy-training-no-progress"
          : "policy-training-failed",
        skipWorker: false,
        openClusters: 0,
        artifactDir: shadowTraining.artifactDir ?? shadowTraining.outDir,
        training: shadowTraining,
        error: shadowTraining.detail,
      };
    }
    config.state = {
      ...config.state,
      policyTraining: shadowTraining,
      updatedAt: new Date().toISOString(),
    };
    config.policyCheckpointPath = shadowTraining.checkpointFile;
    config.policyCheckpointSha256 = shadowTraining.checkpointSha256;
  }

  if (
    (config.agentA === "policy" || config.agentB === "policy") &&
    !config.policyCheckpointPath
  ) {
    const message = "policy agent requires a policy checkpoint";
    report(
      "error",
      [
        `effect-debug-harvest invalid: ${message}`,
        "Enable ORICA_POLICY_SHADOW_TRAINING=1 or restore a valid policyTraining checkpoint state.",
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason: "policy-checkpoint-missing",
        invalid: true,
      })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: false,
      openClusters: 0,
      invalidReasons: [message],
    };
  }

  const policyIdentityError = policyCheckpointIdentityError(config);
  if (policyIdentityError) {
    report(
      "error",
      [
        `effect-debug-harvest invalid: ${policyIdentityError}`,
        "The active cohort was not resumed with mixed policy weights.",
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason: "policy-checkpoint-identity-mismatch",
        invalid: true,
      })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: false,
      openClusters: 0,
      invalidReasons: [policyIdentityError],
    };
  }

  if (!config.state.activeBatch) {
    config.state = {
      ...config.state,
      activeBatch: {
        stageIndex: config.stagePlan.stageIndex,
        games: config.games,
        seed: config.seed,
        experimentId: config.experimentId,
        outDir: config.outDir,
        checkpointFile: config.checkpointFile,
        policyCheckpointPath: config.policyCheckpointPath,
        policyCheckpointSha256: config.policyCheckpointSha256,
        policyTrainingStep: config.state.policyTraining?.trainingStep ?? null,
        maxSteps: config.maxSteps,
        maxForcedTransitions: config.maxForcedTransitions,
        maxRepeatedStateTransitions: config.maxRepeatedStateTransitions,
        maxGameDurationMs: config.maxGameDurationMs,
        maxGameDurationRetries: config.maxGameDurationRetries,
        maxGameDurationMultiplier: config.maxGameDurationMultiplier,
        maxGameDurationCeilingMs: config.maxGameDurationCeilingMs,
        maxReplacementGames: config.maxReplacementGames,
        maxGeneratedChoices: config.maxGeneratedChoices,
        deckSize: config.deckSize,
        deckStrategy: config.deckStrategy,
        focusCardCount: config.focusCardCount,
        skipPreGame: config.skipPreGame,
        agentA: config.agentA,
        agentB: config.agentB,
        wideChoiceThreshold: config.wideChoiceThreshold,
        policyExplorationRate: config.policyExplorationRate,
        stressGames: config.stressGames,
        stressAgentB: config.stressAgentB,
        lastCheckpointCompletedGames: config.checkpoint.completedGames,
        noProgressTimeoutCount: 0,
        startedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(config.stateFile, config.state);
  }

  const harvest = runHarvest(config);
  if (harvest.status !== 0) {
    const detail = (harvest.stderr || harvest.stdout || "no output").slice(
      0,
      2000
    );
    const checkpoint = checkpointRuntime(config.checkpointFile);
    const reachedRunBudget =
      harvest.timedOut && config.checkpointsAcrossRuns === true;
    const diagnostics = {
      schemaVersion: 1,
      kind: reachedRunBudget
        ? "run_budget_checkpoint"
        : harvest.timedOut
          ? "parent_timeout"
          : "process_failure",
      experimentId: config.experimentId,
      checkpointFile: config.checkpointFile,
      completedGames: checkpoint.completedGames,
      requestedGames: config.games,
      signal: harvest.signal ?? null,
      exitCode: harvest.status ?? null,
      errorCode: harvest.error?.code ?? null,
      errorMessage: harvest.error?.message ?? null,
      parentElapsedMs: harvest.elapsedMs,
      parentTimeoutMs: config.timeoutMs,
      runBudgetMs: config.runBudgetMs,
      requiredBatchTimeoutMs: config.requiredBatchTimeoutMs,
      adaptiveTimeout: config.adaptiveTimeout,
      stdoutTail: String(harvest.stdout || "").slice(-4000),
      stderrTail: String(harvest.stderr || "").slice(-4000),
      recordedAt: new Date().toISOString(),
    };
    writeJsonAtomic(
      join(config.outDir, "parent-diagnostics.json"),
      diagnostics
    );
    if (harvest.timedOut) {
      const timeoutRecord = recordParentTimeout(
        config.state.activeBatch,
        checkpoint.completedGames
      );
      const timeoutState = {
        ...config.state,
        activeBatch: timeoutRecord.activeBatch,
        updatedAt: new Date().toISOString(),
      };
      writeJsonAtomic(config.stateFile, timeoutState);
      const commonLines = [
        `experiment=${config.experimentId}`,
        `signal=${diagnostics.signal ?? "none"} exit=${diagnostics.exitCode ?? "none"} error=${diagnostics.errorCode ?? "none"}`,
        `elapsedMs=${diagnostics.parentElapsedMs} timeoutMs=${diagnostics.parentTimeoutMs}`,
        `checkpoint=${config.checkpointFile}`,
        `completedGames=${checkpoint.completedGames}/${config.games} previousCompletedGames=${timeoutRecord.previousCompletedGames}`,
        `perGameTimeoutMs=${config.adaptiveTimeout.perGameTimeoutMs} observedMaxMs=${config.adaptiveTimeout.observedMaxMs}`,
        `diagnostics=${join(config.outDir, "parent-diagnostics.json")}`,
      ];
      if (timeoutRecord.madeProgress) {
        const progressTitle = reachedRunBudget
          ? "effect-debug-harvest run budget reached after checkpoint progress; next run will resume"
          : "effect-debug-harvest parent timeout after checkpoint progress; will resume";
        report("progress", [progressTitle, ...commonLines].join("\n"), config);
        return {
          schemaVersion: 1,
          action: reachedRunBudget
            ? "checkpointed-progress"
            : "checkpointed-timeout",
          skipWorker: true,
          openClusters: 0,
          artifactDir: config.outDir,
          checkpointFile: config.checkpointFile,
          completedGames: checkpoint.completedGames,
          previousCompletedGames: timeoutRecord.previousCompletedGames,
          diagnostics,
        };
      }
      if (timeoutRecord.noProgressTimeoutCount === 1) {
        report(
          "error",
          [
            "effect-debug-harvest parent timeout made no checkpoint progress; starting Codex worker to diagnose",
            ...commonLines,
          ].join("\n"),
          config
        );
      }
      return {
        schemaVersion: 1,
        action: "checkpoint-stalled",
        skipWorker: false,
        openClusters: 0,
        artifactDir: config.outDir,
        checkpointFile: config.checkpointFile,
        completedGames: checkpoint.completedGames,
        previousCompletedGames: timeoutRecord.previousCompletedGames,
        noProgressTimeoutCount: timeoutRecord.noProgressTimeoutCount,
        diagnostics,
      };
    }
    report(
      "error",
      [
        "effect-debug-harvest invalid: process failed",
        `experiment=${config.experimentId}`,
        `exit=${harvest.status} signal=${harvest.signal ?? "none"}`,
        `diagnostics=${join(config.outDir, "parent-diagnostics.json")}`,
        detail,
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason: "invalid-process",
        invalid: true,
      })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: true,
      openClusters: 0,
      artifactDir: config.outDir,
      error: detail,
    };
  }

  const postHarvestDirtyLines = proofDirtyLines(config.worktreeRoot);
  if (postHarvestDirtyLines.length > 0) {
    report(
      "error",
      [
        "effect-debug-harvest invalid: worktree changed during harvest",
        ...postHarvestDirtyLines.slice(0, 20).map((line) => `- ${line}`),
        "clean 証拠には数えず、段階を先頭へ戻します。",
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason: "dirty-worktree-after-harvest",
        invalid: true,
      })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: false,
      openClusters: 0,
      artifactDir: config.outDir,
      invalidReasons: ["worktree changed during harvest"],
    };
  }

  const triage = await triageEffectDebugArtifacts({
    dir: config.outDir,
    requestedGames: config.games,
    minDecisionFrames: config.minDecisionFrames,
    minEffectDecisions: config.minEffectDecisions,
    minUniqueCards: config.minUniqueCards,
    promoteCappedRepeats: config.promoteCappedRepeats,
    priorObservedTickets: priorObservedTickets(config.state),
    repoRoot: config.repoRoot,
    worktreeRoot: config.worktreeRoot,
    clusterRegistry: config.clusterRegistry,
    promote: true,
    dryRun: false,
    allowIncompleteElapsed: true,
  });

  if (triage.status === "invalid") {
    report(
      "error",
      [
        "effect-debug-harvest invalid: clean gate failed",
        `artifact=${triage.artifactDir}`,
        ...triage.invalidReasons.map((reason) => `- ${reason}`),
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, { reason: "invalid-gate", invalid: true })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: true,
      openClusters: 0,
      artifactDir: triage.artifactDir,
      invalidReasons: triage.invalidReasons,
    };
  }

  if (triage.status === "promoted") {
    report(
      "progress",
      [
        "effect-debug-harvest promoted repair cluster(s)",
        `artifact=${triage.artifactDir}`,
        `promoted=${triage.tickets.promoted.length}`,
        `clusters=${triage.proposedClusters.map((c) => c.id).join(", ")}`,
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, { reason: "promoted", promoted: true })
    );
    return {
      schemaVersion: 1,
      action: "promoted",
      skipWorker: false,
      openClusters: triage.tickets.promoted.length,
      artifactDir: triage.artifactDir,
      proposedClusters: triage.proposedClusters,
    };
  }

  if (triage.cleanGate.qualifyingGames < triage.cleanGate.requestedGames) {
    const replacementExtension = Math.max(5, Math.ceil(config.games * 0.1));
    const expandedReplacementGames =
      config.maxReplacementGames + replacementExtension;
    const checkpoint = checkpointRuntime(config.checkpointFile);
    const progressState = {
      ...config.state,
      activeBatch: {
        ...config.state.activeBatch,
        maxReplacementGames: expandedReplacementGames,
        lastCheckpointCompletedGames: checkpoint.completedGames,
      },
      resetReason: "collecting-replacements",
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(config.stateFile, progressState);
    report(
      "progress",
      [
        "effect-debug-harvest is accumulating qualifying replacements",
        `artifact=${triage.artifactDir}`,
        `qualifyingGames=${triage.cleanGate.qualifyingGames}/${triage.cleanGate.requestedGames}`,
        `attemptedGames=${triage.cleanGate.attemptedGames}`,
        `elapsedTimeReplacements=${triage.cleanGate.elapsedTimeReplacementCount}`,
        `nextReplacementLimit=${expandedReplacementGames}`,
      ].join("\n"),
      config
    );
    return {
      schemaVersion: 1,
      action: "replacement-progress",
      skipWorker: true,
      openClusters: 0,
      artifactDir: triage.artifactDir,
      checkpointFile: config.checkpointFile,
      qualifyingGames: triage.cleanGate.qualifyingGames,
      requestedGames: triage.cleanGate.requestedGames,
      attemptedGames: triage.cleanGate.attemptedGames,
      nextReplacementLimit: expandedReplacementGames,
    };
  }

  const coverage = triage.cleanGate.coverage;
  if (!coverage.coverageEligible) {
    const batchGameSeeds = Array.isArray(triage.cleanGate.gameSeeds)
      ? triage.cleanGate.gameSeeds
      : gameSeedsForBatch(config.seed, config.games);
    const qualifyingGameSeeds = Array.isArray(
      triage.cleanGate.qualifyingGameSeeds
    )
      ? triage.cleanGate.qualifyingGameSeeds
      : batchGameSeeds;
    const ineligibleCohort = {
      stageIndex: config.state.stageIndex,
      games: config.games,
      attemptedGames: triage.cleanGate.attemptedGames ?? batchGameSeeds.length,
      elapsedTimeReplacementCount:
        triage.cleanGate.elapsedTimeReplacementCount ?? 0,
      seed: config.seed,
      firstGameSeed: batchGameSeeds[0],
      lastGameSeed: batchGameSeeds.at(-1),
      gameSeedCount: batchGameSeeds.length,
      gameSeeds: batchGameSeeds,
      qualifyingGameSeeds,
      artifactDir: triage.artifactDir,
      observedTickets: triage.tickets.observed,
      coverage,
      runtime: (() => {
        const value = checkpointRuntime(config.checkpointFile);
        return {
          ...value,
          averageGameDurationMs:
            value.completedGames > 0
              ? value.totalGameDurationMs / value.completedGames
              : 0,
        };
      })(),
      policyCheckpointPath: config.policyCheckpointPath,
      policyCheckpointSha256: config.policyCheckpointSha256,
      policyTrainingStep: config.state.policyTraining?.trainingStep ?? null,
      completedAt: new Date().toISOString(),
    };
    const incompleteState = {
      ...config.state,
      activeBatch: null,
      ineligibleCohorts: [
        ...ineligibleCohorts(config.state),
        ineligibleCohort,
      ].slice(-256),
      invalidSinceReset: 1,
      resetReason: "coverage-incomplete",
      lastCoverageGate: {
        coverageEligible: false,
        cappedGameCount: coverage.cappedGameCount,
        truncatedDecisionFrames: coverage.truncatedDecisionFrames,
        unattributedActionFrames: coverage.unattributedActionFrames,
        unattributedEffectRefs: coverage.unattributedEffectRefs,
        unattributedDslStepRefs: coverage.unattributedDslStepRefs,
      },
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(config.stateFile, incompleteState);
    report(
      "error",
      [
        "effect-debug-harvest coverage incomplete: capped/truncated/unattributed decisions are not clean coverage",
        `artifact=${triage.artifactDir}`,
        `cappedGames=${coverage.cappedGameCount}`,
        `truncatedDecisionFrames=${coverage.truncatedDecisionFrames}`,
        `unattributedActionFrames=${coverage.unattributedActionFrames}`,
        `unattributedEffectRefs=${coverage.unattributedEffectRefs}`,
        `unattributedDslStepRefs=${coverage.unattributedDslStepRefs}`,
        "次 cohort は別 seed で再実行し、cap を隠したまま stage を前進させません。",
      ].join("\n"),
      config
    );
    return {
      schemaVersion: 1,
      action: "coverage-incomplete",
      skipWorker: true,
      openClusters: 0,
      artifactDir: triage.artifactDir,
      coverage,
    };
  }

  const stress = await runMctsStress(config, triage.tickets.observed);
  config.state = {
    ...config.state,
    stressCohorts: upsertStressCohort(
      stressCohorts(config.state),
      stress.cohort
    ),
    updatedAt: new Date().toISOString(),
  };
  if (stress.status === "checkpointed-timeout") {
    report(
      "progress",
      [
        "effect-debug MCTS stress parent timeout after checkpoint progress; next run will resume the same stress artifact",
        "artifact=" + stress.cohort.artifactDir,
        "completedGames=" +
          stress.cohort.runtime.completedGames +
          "/" +
          stress.cohort.games,
      ].join("\n"),
      config
    );
    writeJsonAtomic(config.stateFile, config.state);
    return {
      schemaVersion: 1,
      action: "stress-checkpointed-timeout",
      skipWorker: true,
      openClusters: 0,
      artifactDir: stress.cohort.artifactDir,
      completedGames: stress.cohort.runtime.completedGames,
    };
  }
  if (stress.status === "checkpoint-stalled") {
    report(
      "error",
      [
        "effect-debug MCTS stress parent timeout made no checkpoint progress; starting worker diagnosis",
        "artifact=" + stress.cohort.artifactDir,
        "completedGames=" +
          stress.cohort.runtime.completedGames +
          "/" +
          stress.cohort.games,
      ].join("\n"),
      config
    );
    writeJsonAtomic(config.stateFile, config.state);
    return {
      schemaVersion: 1,
      action: "stress-checkpoint-stalled",
      skipWorker: false,
      openClusters: 0,
      artifactDir: stress.cohort.artifactDir,
      completedGames: stress.cohort.runtime.completedGames,
    };
  }
  if (stress.status === "promoted") {
    report(
      "progress",
      [
        "effect-debug MCTS stress promoted repair cluster(s)",
        `artifact=${stress.cohort.artifactDir}`,
        `promoted=${stress.triage.tickets.promoted.length}`,
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason: "stress-promoted",
        promoted: true,
      })
    );
    return {
      schemaVersion: 1,
      action: "promoted",
      skipWorker: false,
      openClusters: stress.triage.tickets.promoted.length,
      artifactDir: stress.cohort.artifactDir,
      proposedClusters: stress.triage.proposedClusters,
    };
  }
  if (stress.status === "invalid") {
    const invalidReasons = stress.triage?.invalidReasons ?? [
      stress.cohort.detail ?? "stress failed",
    ];
    report(
      "error",
      [
        "effect-debug MCTS stress invalid",
        `artifact=${stress.cohort.artifactDir}`,
        ...invalidReasons,
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, { reason: "stress-invalid", invalid: true })
    );
    return {
      schemaVersion: 1,
      action: "invalid",
      skipWorker: true,
      openClusters: 0,
      artifactDir: stress.cohort.artifactDir,
      invalidReasons,
    };
  }
  if (stress.status === "performance") {
    report(
      "progress",
      [
        "effect-debug MCTS stress recorded a performance-only timeout",
        `artifact=${stress.cohort.artifactDir}`,
        "coverage cohort remains eligible; repeated signatures still escalate.",
      ].join("\n"),
      config
    );
  }

  const repeatedCapped = cappedRepeatAcrossBatches(
    config.state,
    triage.tickets.observed,
    config.promoteCappedRepeats
  );
  if (repeatedCapped.length > 0) {
    const repeatedTriage = await triageEffectDebugArtifacts({
      dir: config.outDir,
      requestedGames: config.games,
      minDecisionFrames: config.minDecisionFrames,
      minEffectDecisions: config.minEffectDecisions,
      minUniqueCards: config.minUniqueCards,
      promoteCappedRepeats: config.promoteCappedRepeats,
      priorObservedTickets: priorObservedTickets(config.state),
      repoRoot: config.repoRoot,
      worktreeRoot: config.worktreeRoot,
      clusterRegistry: config.clusterRegistry,
      promote: true,
      dryRun: false,
      allowIncompleteElapsed: true,
    });
    if (repeatedTriage.status !== "promoted") {
      throw new Error(
        "repeated capped signature was detected but no repair cluster was proposed"
      );
    }
    report(
      "progress",
      [
        "effect-debug capped signature promoted across coverage and stress cohorts",
        ...repeatedCapped
          .slice(0, 10)
          .map((item) => `- ${item.signature} seeds=${item.seeds.join(",")}`),
        `clusters=${repeatedTriage.proposedClusters
          .map((cluster) => cluster.id)
          .join(", ")}`,
      ].join("\n"),
      config
    );
    writeJsonAtomic(
      config.stateFile,
      resetStageState(config.state, {
        reason: "cross-batch-capped-promoted",
        promoted: true,
      })
    );
    return {
      schemaVersion: 1,
      action: "promoted",
      skipWorker: false,
      openClusters: repeatedTriage.tickets.promoted.length,
      artifactDir: repeatedTriage.artifactDir,
      proposedClusters: repeatedTriage.proposedClusters,
    };
  }

  const isBaselineStage =
    config.games === config.baselineStageGames &&
    config.stagePlan.stageIndex ===
      config.stageGames.indexOf(config.baselineStageGames);
  const coverageGate = isBaselineStage
    ? evaluateCoverageSaturation(coverageCohorts(config.state), coverage, {
        minCohorts: config.minCoverageCohorts,
        maxNovelSemanticKeys: config.maxNovelSemanticKeys,
        maxNovelSemanticRate: config.maxNovelSemanticRate,
      })
    : {
        coverageEligible: true,
        cohortCount: coverageCohorts(config.state).length + 1,
        saturated: true,
        reason:
          config.games > config.baselineStageGames
            ? "post-saturation-soak"
            : "baseline-warmup-cohort",
      };
  const runtime = checkpointRuntime(config.checkpointFile);
  const nextState = advanceStageAfterClean(
    config.state,
    config.stageGames,
    triage.cleanGate,
    {
      artifactDir: triage.artifactDir,
      seed: config.seed,
      observedTickets: triage.tickets.observed,
      coverageGate,
      runtime: {
        ...runtime,
        policyCheckpointPath: config.policyCheckpointPath,
        policyCheckpointSha256: config.policyCheckpointSha256,
        policyTrainingStep: config.state.policyTraining?.trainingStep ?? null,
        averageGameDurationMs:
          runtime.completedGames > 0
            ? runtime.totalGameDurationMs / runtime.completedGames
            : 0,
      },
    }
  );
  const nextPlan = currentStagePlan(nextState, config.stageGames);
  const conditions = stopConditions(
    nextState,
    config.stageGames,
    0,
    config.promoteCappedRepeats
  );
  const reachedFinalStage = nextState.stageIndex >= config.stageGames.length;
  if (reachedFinalStage) {
    if (!conditions.ready) {
      report(
        "error",
        [
          "effect-debug-harvest invalid: final staged clean conditions failed",
          `artifact=${triage.artifactDir}`,
          `stopConditions=${JSON.stringify(conditions)}`,
          "clean 証拠には数えず、段階を先頭へ戻します。",
        ].join("\n"),
        config
      );
      writeJsonAtomic(
        config.stateFile,
        resetStageState(nextState, {
          reason: "final-conditions-failed",
          invalid: true,
        })
      );
      return {
        schemaVersion: 1,
        action: "invalid",
        skipWorker: true,
        openClusters: 0,
        artifactDir: triage.artifactDir,
        invalidReasons: ["final staged clean conditions failed"],
        stopConditions: conditions,
      };
    }
    if (!config.stopOnFinalClean) {
      writeJsonAtomic(
        config.stateFile,
        resetStageState(nextState, { reason: "continue-after-final-clean" })
      );
      report(
        "progress",
        [
          "effect-debug final clean reached; continuing",
          `artifact=${triage.artifactDir}`,
          `cleanGames=${nextState.cleanGames}`,
          `lastBatchGames=${triage.cleanGate.requestedGames}`,
          `finalStageGames=${config.finalStageGames}`,
          `policyTrainingStep=${config.state.policyTraining?.trainingStep ?? "none"}`,
          `policyCheckpointSha256=${config.policyCheckpointSha256 ?? "none"}`,
          "state を先頭へ戻しました。次 tick から再探索します。",
        ].join("\n"),
        config
      );
      return {
        schemaVersion: 1,
        action: "final-clean-continued",
        skipWorker: true,
        openClusters: 0,
        artifactDir: triage.artifactDir,
        cleanGames: nextState.cleanGames,
        finalStageGames: config.finalStageGames,
        stopReady: false,
        stopConditions: conditions,
      };
    }
    writeJsonAtomic(config.stateFile, nextState);
    report(
      "progress",
      [
        "effect-debug final clean reached",
        `artifact=${triage.artifactDir}`,
        `cleanGames=${nextState.cleanGames}`,
        `lastBatchGames=${triage.cleanGate.requestedGames}`,
        `finalStageGames=${config.finalStageGames}`,
        `policyTrainingStep=${config.state.policyTraining?.trainingStep ?? "none"}`,
        `policyCheckpointSha256=${config.policyCheckpointSha256 ?? "none"}`,
        `stopConditions=${JSON.stringify(conditions)}`,
        "フルラン停止可能。task disable はユーザー指示待ち。",
      ].join("\n"),
      config
    );
    return {
      schemaVersion: 1,
      action: "final-clean",
      skipWorker: true,
      openClusters: 0,
      artifactDir: triage.artifactDir,
      cleanGames: nextState.cleanGames,
      finalStageGames: config.finalStageGames,
      stopReady: true,
      stopConditions: conditions,
    };
  }

  writeJsonAtomic(config.stateFile, nextState);
  report(
    "progress",
    [
      "effect-debug-harvest clean",
      `artifact=${triage.artifactDir}`,
      `games=${triage.cleanGate.requestedGames}`,
      `cleanGames=${nextState.cleanGames}`,
      `nextGames=${nextPlan.games}`,
      `stage=${nextState.stageIndex}/${config.stageGames.length}`,
      `seed=${config.seed}`,
      `policyTrainingStep=${config.state.policyTraining?.trainingStep ?? "none"}`,
      `policyCheckpointSha256=${config.policyCheckpointSha256 ?? "none"}`,
      `decisionFrames=${triage.cleanGate.totalDecisionFrames}`,
      `effectDecisionFrames=${triage.cleanGate.effectDecisionFrames}`,
      `uniqueSourceCardNos=${triage.cleanGate.uniqueSourceCardNos.length}`,
      `semanticKeys=${coverage.semanticKeys.length}`,
      `coverageSaturated=${coverageGate.saturated}`,
      `novelSemanticKeys=${coverageGate.novelSemanticKeys ?? 0}`,
      `noveltyRate=${coverageGate.noveltyRate ?? 0}`,
    ].join("\n"),
    config
  );
  return {
    schemaVersion: 1,
    action: "clean",
    skipWorker: true,
    openClusters: 0,
    artifactDir: triage.artifactDir,
    cleanGames: nextState.cleanGames,
    nextGames: nextPlan.games,
    finalStageGames: config.finalStageGames,
    stageIndex: nextState.stageIndex,
    stageCount: config.stageGames.length,
    policyTrainingStep: config.state.policyTraining?.trainingStep ?? null,
    policyCheckpointSha256: config.policyCheckpointSha256,
  };
}

export async function runEffectDebugLoopCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  checkStorage(runtimePaths().repoRoot);
  const result = await runEffectDebugLoop();
  if (args.json) console.log(JSON.stringify(result));
  else console.log(`effect-debug-loop: ${result.action}`);
}

function isDirectExecution() {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(entry).href : false;
}

if (isDirectExecution()) {
  try {
    await runEffectDebugLoopCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
