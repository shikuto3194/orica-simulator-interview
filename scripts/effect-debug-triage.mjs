#!/usr/bin/env node
/**
 * effect-debug-triage — effect-debug-harvest artifacts を検証し、修正 cluster へ昇格する。
 *
 * 結果は promoted / clean / invalid の 3 値だけ。invalid は 0 件扱いしない。
 */

import { spawnSync } from "node:child_process";
import { readJsonRecords, resolveJsonlSource } from "./lib/artifact-io.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(SCRIPT_DIR, ".."));

const DETECTOR_MANIFEST = {
  schemaVersion: 1,
  cleanGateVersion: 9,
  ticketKinds: [
    "hard_failure",
    "capped",
    "slow_game",
    "state_invariant",
    "truncated_choice_surface",
    "wide_choice_surface",
  ],
  autoPromote: ["hard_failure", "state_invariant", "truncated_choice_surface"],
  conditionalPromote: ["capped:repeated-signature"],
  suspiciousOnly: ["slow_game", "wide_choice_surface"],
};
const EXPECTED_DETECTOR_MANIFEST_HASH =
  "sha256-1c3ede8921e9e68a1867892de66bb736bcfb8810b9765d7e8ed630c130849c94";

const DEFAULTS = {
  minDecisionFrames: 1,
  minEffectDecisions: 1,
  minUniqueCards: 1,
  promoteCappedRepeats: 2,
};

function detectorManifestHash() {
  return `sha256-${createHash("sha256")
    .update(JSON.stringify(DETECTOR_MANIFEST))
    .digest("hex")}`;
}

function parseArgs(argv) {
  const out = {
    dir: null,
    metrics: null,
    requestedGames: null,
    minDecisionFrames: DEFAULTS.minDecisionFrames,
    minEffectDecisions: DEFAULTS.minEffectDecisions,
    minUniqueCards: DEFAULTS.minUniqueCards,
    promoteCappedRepeats: DEFAULTS.promoteCappedRepeats,
    expectedDetectorHash: EXPECTED_DETECTOR_MANIFEST_HASH,
    promote: false,
    dryRun: false,
    json: false,
    evidence: false,
    clusterId: process.env.ORICA_CLUSTER_ID || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--dir":
        out.dir = next();
        break;
      case "--metrics":
        out.metrics = next();
        break;
      case "--requested-games":
        out.requestedGames = Number(next());
        break;
      case "--min-decision-frames":
        out.minDecisionFrames = Number(next());
        break;
      case "--min-effect-decisions":
        out.minEffectDecisions = Number(next());
        break;
      case "--min-unique-cards":
        out.minUniqueCards = Number(next());
        break;
      case "--promote-capped-repeats":
        out.promoteCappedRepeats = Number(next());
        break;
      case "--expected-detector-hash":
        out.expectedDetectorHash = next();
        break;
      case "--promote":
        out.promote = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--evidence":
        out.evidence = true;
        break;
      case "--cluster-id":
        out.clusterId = next();
        break;
      case "--repo-root":
      case "--hub-root":
        out.repoRoot = next();
        break;
      case "--worktree":
      case "--worktree-root":
        out.worktreeRoot = next();
        break;
      case "--cluster-registry":
        out.clusterRegistry = next();
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
  return [
    "Usage:",
    "  node scripts/effect-debug-triage.mjs --dir artifacts/effect-debug/<run> --promote --json",
    "  node scripts/effect-debug-triage.mjs --evidence --cluster-id edh-...",
  ].join("\n");
}

function pathOption(value, fallback) {
  return value === undefined || String(value).trim() === ""
    ? fallback
    : resolve(String(value));
}

function defaultRepoRoot() {
  return pathOption(
    process.env.ORICA_EFFECT_DEBUG_HUB_ROOT,
    pathOption(process.env.ORICA_SUPERVISOR_HUB_REPO, ROOT)
  );
}

function defaultWorktreeRoot() {
  return pathOption(process.env.ORICA_EFFECT_DEBUG_WORKTREE, ROOT);
}

function defaultClusterRegistry(repoRoot = defaultRepoRoot()) {
  return (
    process.env.ORICA_CLUSTER_REGISTRY ||
    join(repoRoot, "autorun-queue", "cluster-registry.json")
  );
}

export function normalizeTriageOptions(options = {}) {
  const raw = {
    ...DEFAULTS,
    expectedDetectorHash: EXPECTED_DETECTOR_MANIFEST_HASH,
    ...options,
  };
  const repoRoot = pathOption(raw.repoRoot, defaultRepoRoot());
  const worktreeRoot = pathOption(raw.worktreeRoot, defaultWorktreeRoot());
  return {
    ...raw,
    repoRoot,
    worktreeRoot,
    priorObservedTickets: Array.isArray(raw.priorObservedTickets)
      ? raw.priorObservedTickets.filter(
          (ticket) =>
            ticket &&
            typeof ticket.signature === "string" &&
            Number.isInteger(ticket.seed)
        )
      : [],
    clusterRegistry: pathOption(
      raw.clusterRegistry,
      defaultClusterRegistry(repoRoot)
    ),
    clusterClaimScript: pathOption(
      raw.clusterClaimScript,
      join(worktreeRoot, "scripts", "cluster-claim.mjs")
    ),
  };
}

function parseJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => JSON.parse(line));
}

/**
 * Visit a JSONL file one line at a time without materializing it as one JS
 * string. Effect-debug frame logs can exceed V8's maximum string length long
 * before their individual JSON records become large.
 */
async function forEachJsonLine(path, visit, options) {
  for await (const record of readJsonRecords(path, options)) visit(record);
}

function gitHeadShort(root = defaultWorktreeRoot()) {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function latestEffectDebugDir(repoRoot = defaultRepoRoot()) {
  const base = join(repoRoot, "artifacts", "effect-debug");
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base)
    .map((name) => join(base, name))
    .filter((path) => {
      try {
        return (
          statSync(path).isDirectory() && existsSync(join(path, "metrics.json"))
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs[0] || null;
}

function resolveMetricsPath(options) {
  if (options.metrics) return resolve(options.metrics);
  if (options.dir) return resolve(options.dir, "metrics.json");
  const latest = latestEffectDebugDir(options.repoRoot);
  if (!latest) throw new Error("effect-debug artifact directory not found");
  return join(latest, "metrics.json");
}

function stringValue(value, key) {
  return value && typeof value === "object" && typeof value[key] === "string"
    ? value[key]
    : null;
}

function sourceCardNosFromValue(value, out = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) sourceCardNosFromValue(item, out);
    return out;
  }
  const sourceCardNo = stringValue(value, "sourceCardNo");
  if (sourceCardNo) out.add(sourceCardNo);
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object")
      sourceCardNosFromValue(nested, out);
  }
  return out;
}

function sourceCardNoFromAction(frame, action) {
  const declaredSource =
    stringValue(action, "sourceCardNo") ??
    stringValue(action, "sourceDefinitionId");
  if (declaredSource) return declaredSource;

  const sourceInstanceId = stringValue(action, "sourceInstanceId");
  const observedCards = frame?.observation?.cards;
  if (!sourceInstanceId || !Array.isArray(observedCards)) return null;
  const sourceCard = observedCards.find(
    (card) =>
      card &&
      typeof card === "object" &&
      stringValue(card, "instanceId") === sourceInstanceId
  );
  if (stringValue(sourceCard, "identityVisibility") !== "known") return null;
  const observedCardNo = stringValue(sourceCard, "cardNoOrUnknown");
  return observedCardNo;
}

/**
 * Returns the action actually executed by a persisted frame. Candidate choices
 * are deliberately excluded: an offered card is not coverage until the policy
 * selected that choice.
 */
export function selectedActionFromFrame(frame) {
  const node = frame?.node;
  const selected = frame?.selected;
  if (!node || typeof node !== "object") return null;
  const selectedChoiceId = stringValue(selected, "choiceId");
  const choices = Array.isArray(node.choices) ? node.choices : [];
  const selectedChoice = choices.find(
    (choice) =>
      choice &&
      typeof choice === "object" &&
      stringValue(choice, "choiceId") === selectedChoiceId
  );
  const action = selectedChoice?.action ?? node.action;
  return action && typeof action === "object" ? action : null;
}

function incrementRecord(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function actionNumberFields(action, suffix) {
  return Object.entries(action).flatMap(([key, value]) =>
    (key === suffix.charAt(0).toLowerCase() + suffix.slice(1) ||
      key.endsWith(suffix)) &&
    Number.isInteger(value)
      ? [[key, Number(value)]]
      : []
  );
}

function choiceCountBucket(choiceCount) {
  if (choiceCount <= 1) return "1";
  if (choiceCount <= 4) return "2-4";
  if (choiceCount <= 16) return "5-16";
  if (choiceCount <= 64) return "17-64";
  if (choiceCount <= 256) return "65-256";
  return "257+";
}

function emptyArtifactCoverage() {
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

/**
 * Independently reconstruct the coverage contract from persisted selected
 * frames. This intentionally does not trust metrics.aggregate.coverage.
 */
export function coverageFromPersistedFrames(
  frames,
  { wideChoiceThreshold = 0, cappedGameCount = 0 } = {}
) {
  const coverage = emptyArtifactCoverage();
  coverage.choiceSurface.cappedGameCount = cappedGameCount;
  for (const frame of frames)
    accumulateCoverageFrame(coverage, frame, wideChoiceThreshold);
  return coverage;
}

function accumulateCoverageFrame(coverage, frame, wideChoiceThreshold) {
  const selected =
    frame?.selected && typeof frame.selected === "object"
      ? frame.selected
      : null;
  const action = selectedActionFromFrame(frame);
  const choiceCount = Number.isInteger(selected?.choiceCount)
    ? Number(selected.choiceCount)
    : 0;
  coverage.choiceSurface.decisionFrames += 1;
  coverage.choiceSurface.maxChoiceCount = Math.max(
    coverage.choiceSurface.maxChoiceCount,
    choiceCount
  );
  incrementRecord(
    coverage.choiceSurface.choiceCountBuckets,
    choiceCountBucket(choiceCount)
  );
  if (choiceCount >= wideChoiceThreshold) {
    coverage.choiceSurface.wideDecisionFrames += 1;
  }

  const actionKind = action ? stringValue(action, "kind") : null;
  const sourceCardNo = action ? sourceCardNoFromAction(frame, action) : null;
  if (action) {
    coverage.semantic.executedActionFrames += 1;
    if (actionKind) incrementRecord(coverage.semantic.actions, actionKind);
    else coverage.semantic.unattributedActionFrames += 1;
    if (sourceCardNo) incrementRecord(coverage.semantic.cards, sourceCardNo);
    const effectFields = actionNumberFields(action, "EffectIndex");
    for (const [field, effectIndex] of effectFields) {
      if (sourceCardNo) {
        incrementRecord(
          coverage.semantic.effects,
          `${sourceCardNo}#${field}:${effectIndex}`
        );
      } else {
        coverage.semantic.unattributedEffectRefs += 1;
      }
    }
    for (const [field, stepIndex] of actionNumberFields(action, "StepIndex")) {
      const effectKey = effectFields[0]
        ? `${effectFields[0][0]}:${effectFields[0][1]}`
        : "effect:unknown";
      if (sourceCardNo && effectFields.length > 0) {
        incrementRecord(
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
    incrementRecord(
      coverage.choiceSurface.truncatedByAction,
      actionKind ?? "unknown"
    );
    incrementRecord(
      coverage.choiceSurface.truncatedByCard,
      sourceCardNo ?? "unknown"
    );
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableJson(nested)])
  );
}

async function coverageFromPersistedArtifacts(
  artifactDir,
  { wideChoiceThreshold, expectedGames }
) {
  const framesPath = resolveJsonlSource(artifactDir, "frames");
  const gamesDir = join(artifactDir, "games");
  if (!existsSync(framesPath)) {
    return {
      error: "frames.jsonl missing",
      coverage: null,
      gameRecordCount: 0,
    };
  }
  if (!existsSync(gamesDir)) {
    return {
      error: "games checkpoint directory missing",
      coverage: null,
      gameRecordCount: 0,
    };
  }
  try {
    const gameRecords = readdirSync(gamesDir)
      .filter((name) => /^game-\d+\.json$/.test(name))
      .sort()
      .map((name) => parseJsonFile(join(gamesDir, name)));
    if (
      gameRecords.some(
        (record) =>
          (record?.schemaVersion !== 1 && record?.schemaVersion !== 2) ||
          !record?.game
      )
    ) {
      return {
        error: "invalid per-game checkpoint record",
        coverage: null,
        gameRecordCount: gameRecords.length,
      };
    }
    if (gameRecords.length !== expectedGames) {
      return {
        error: `per-game checkpoint count ${gameRecords.length} != requested ${expectedGames}`,
        coverage: null,
        gameRecordCount: gameRecords.length,
      };
    }
    const cappedGameCount = gameRecords.filter(
      (record) => record.game.outcome === "capped"
    ).length;
    const qualifyingRecords = gameRecords.filter(
      (record) =>
        !(
          record.game.outcome === "capped" &&
          record.game.terminationReason === "elapsed_time_limit"
        )
    );
    const analysis = await analyzePersistedFrames(framesPath, {
      wideChoiceThreshold,
      cappedGameCount,
      cleanGameIndexes: new Set(
        qualifyingRecords.map((record) => record.game.gameIndex)
      ),
      cleanCappedGameCount: qualifyingRecords.filter(
        (record) => record.game.outcome === "capped"
      ).length,
    });
    return {
      error: null,
      ...analysis,
      cleanDecisionFrames: qualifyingRecords.reduce(
        (sum, record) => sum + (record.game.decisionFrames ?? 0),
        0
      ),
      gameRecordCount: gameRecords.length,
    };
  } catch (error) {
    return {
      error: `cannot reconstruct persisted coverage: ${error.message}`,
      coverage: null,
      gameRecordCount: 0,
    };
  }
}

export function frameStatsFromFrames(frames) {
  const stats = emptyFrameStats();
  const unique = new Set();
  for (const frame of frames) accumulateFrameStats(stats, unique, frame);
  stats.uniqueSourceCardNos = [...unique].sort();
  return stats;
}

function emptyFrameStats() {
  return {
    totalFrames: 0,
    effectDecisionFrames: 0,
    uniqueSourceCardNos: [],
  };
}

function accumulateFrameStats(stats, unique, frame) {
  stats.totalFrames += 1;
  const action = selectedActionFromFrame(frame);
  const actionSources = sourceCardNosFromValue(action);
  const sourceCardNo = action ? sourceCardNoFromAction(frame, action) : null;
  if (sourceCardNo) actionSources.add(sourceCardNo);
  if (actionSources.size > 0) {
    stats.effectDecisionFrames += 1;
    for (const cardNo of actionSources) unique.add(cardNo);
  }
}

export async function analyzePersistedFrames(
  framesPath,
  {
    wideChoiceThreshold = 0,
    cappedGameCount = 0,
    cleanGameIndexes = null,
    cleanCappedGameCount = 0,
    chunkSize,
    maxRecordBytes,
  } = {}
) {
  const coverage = emptyArtifactCoverage();
  coverage.choiceSurface.cappedGameCount = cappedGameCount;
  const cleanCoverage =
    cleanGameIndexes instanceof Set ? emptyArtifactCoverage() : null;
  if (cleanCoverage) {
    cleanCoverage.choiceSurface.cappedGameCount = cleanCappedGameCount;
  }
  const stats = emptyFrameStats();
  const unique = new Set();
  const cleanStats = cleanCoverage ? emptyFrameStats() : null;
  const cleanUnique = new Set();
  await forEachJsonLine(
    framesPath,
    (frame) => {
      accumulateCoverageFrame(coverage, frame, wideChoiceThreshold);
      if (cleanCoverage && cleanGameIndexes.has(frame?.gameIndex)) {
        accumulateCoverageFrame(cleanCoverage, frame, wideChoiceThreshold);
        accumulateFrameStats(cleanStats, cleanUnique, frame);
      }
      accumulateFrameStats(stats, unique, frame);
    },
    chunkSize === undefined && maxRecordBytes === undefined
      ? undefined
      : { chunkSize, maxRecordBytes }
  );
  stats.uniqueSourceCardNos = [...unique].sort();
  if (cleanStats) cleanStats.uniqueSourceCardNos = [...cleanUnique].sort();
  return {
    coverage,
    ...(cleanCoverage ? { cleanCoverage, cleanStats } : {}),
    stats,
  };
}

function nonNegativeNumberRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.some(
      ([key, count]) =>
        typeof key !== "string" || !Number.isFinite(count) || Number(count) < 0
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    entries.map(([key, count]) => [key, Number(count)])
  );
}

/**
 * Coverage is intentionally evaluated from executed frames emitted by the
 * harvester, never from cards:coverage's non-empty effects proxy. Capped games
 * and truncated decision nodes remain observable but are ineligible evidence
 * for semantic saturation.
 */
export function coverageGateFromMetrics(metrics) {
  return coverageGateFromReport(
    metrics?.aggregate?.cleanCoverage ?? metrics?.aggregate?.coverage
  );
}

export function coverageGateFromReport(coverage) {
  const semantic = coverage?.semantic;
  const choiceSurface = coverage?.choiceSurface;
  const cards = nonNegativeNumberRecord(semantic?.cards);
  const effects = nonNegativeNumberRecord(semantic?.effects);
  const dslSteps = nonNegativeNumberRecord(semantic?.dslSteps);
  const actions = nonNegativeNumberRecord(semantic?.actions);
  const valid =
    coverage?.schemaVersion === 1 &&
    cards !== null &&
    effects !== null &&
    dslSteps !== null &&
    actions !== null &&
    Number.isInteger(semantic?.executedActionFrames) &&
    semantic.executedActionFrames >= 0 &&
    Number.isInteger(semantic?.unattributedActionFrames) &&
    semantic.unattributedActionFrames >= 0 &&
    Number.isInteger(semantic?.unattributedEffectRefs) &&
    semantic.unattributedEffectRefs >= 0 &&
    Number.isInteger(semantic?.unattributedDslStepRefs) &&
    semantic.unattributedDslStepRefs >= 0 &&
    Number.isInteger(choiceSurface?.cappedGameCount) &&
    choiceSurface.cappedGameCount >= 0 &&
    Number.isInteger(choiceSurface?.truncatedDecisionFrames) &&
    choiceSurface.truncatedDecisionFrames >= 0 &&
    Number.isInteger(choiceSurface?.decisionFrames) &&
    choiceSurface.decisionFrames >= 0;
  const semanticKeys = valid
    ? [
        ...Object.keys(cards).map((key) => `card:${key}`),
        ...Object.keys(effects).map((key) => `effect:${key}`),
        ...Object.keys(dslSteps).map((key) => `dsl-step:${key}`),
        ...Object.keys(actions).map((key) => `action:${key}`),
      ].sort()
    : [];
  return {
    valid,
    semanticKeys,
    cards: cards ?? {},
    effects: effects ?? {},
    dslSteps: dslSteps ?? {},
    actions: actions ?? {},
    executedActionFrames: valid ? semantic.executedActionFrames : 0,
    unattributedActionFrames: valid ? semantic.unattributedActionFrames : 0,
    unattributedEffectRefs: valid ? semantic.unattributedEffectRefs : 0,
    unattributedDslStepRefs: valid ? semantic.unattributedDslStepRefs : 0,
    cappedGameCount: valid ? choiceSurface.cappedGameCount : 0,
    truncatedDecisionFrames: valid ? choiceSurface.truncatedDecisionFrames : 0,
    coverageEligible:
      valid &&
      choiceSurface.cappedGameCount === 0 &&
      choiceSurface.truncatedDecisionFrames === 0 &&
      semantic.unattributedActionFrames === 0 &&
      semantic.unattributedEffectRefs === 0 &&
      semantic.unattributedDslStepRefs === 0,
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[0-9a-f]{8,}/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 160);
}

function normalizedSourceCardNo(value) {
  const sourceCardNo = String(value ?? "").trim();
  return sourceCardNo ? sourceCardNo.slice(0, 160) : "unknown-card";
}

function normalizedInvariantDetail(ticket) {
  if (!Array.isArray(ticket.details?.issues)) return "";
  return ticket.details.issues
    .map((issue) =>
      normalizeText(
        [issue?.code, issue?.path, issue?.message]
          .filter((value) => value !== undefined && value !== null)
          .join("|")
      )
    )
    .filter(Boolean)
    .sort()
    .join(";");
}

export function ticketSignature(ticket) {
  const suspect = ticket.suspect || {};
  // 既知 cardNo はそのまま signature に残す。数値を <n> へ一般化すると
  // BSTH02.5-X01 と BSTH02.7-X01 のような別カードまで同一 cluster になる。
  const sourceCardNo = normalizedSourceCardNo(suspect.sourceCardNo);
  const sourceCardUnknown = /^(?:unknown|unknown-card)$/i.test(sourceCardNo);
  const invariantCode =
    Array.isArray(ticket.details?.issues) && ticket.details.issues[0]
      ? normalizeText(
          ticket.details.issues[0].code ||
            ticket.details.issues[0].message ||
            JSON.stringify(ticket.details.issues[0])
        )
      : "";
  const error = normalizeText(
    ticket.lastError || ticket.details?.lastError || ""
  );
  const signature = [
    ticket.kind || "unknown",
    sourceCardNo,
    suspect.actionKind || "unknown-action",
    suspect.nodeKind || "unknown-node",
    invariantCode || error || normalizeText(ticket.title),
  ];
  // sourceCardNo が取れない ticket は action/node/code だけでは異なる原因を
  // 同一 cluster に畳んでしまう。state invariant の path/message 等を安定化して
  // 加え、unknown provenance でも修正単位を分離する。
  if (sourceCardUnknown) {
    const detail = normalizedInvariantDetail(ticket);
    if (detail) signature.push(detail);
  }
  return signature.join("|");
}

function shortHash(text, length = 12) {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function clusterIdForTicket(ticket) {
  const kind = String(ticket.kind || "ticket").replace(/_/g, "-");
  return `edh-${kind}-${shortHash(ticketSignature(ticket))}`;
}

function classifyTicket(ticket, signatureSeeds, options) {
  const kind = ticket.kind;
  if (
    kind === "hard_failure" ||
    kind === "state_invariant" ||
    kind === "truncated_choice_surface"
  ) {
    return { action: "promote", reason: `${kind} is reproducible debug debt` };
  }
  if (
    kind === "capped" &&
    (signatureSeeds.get(ticketSignature(ticket))?.size ?? 0) >=
      options.promoteCappedRepeats
  ) {
    return {
      action: "promote",
      reason: "capped signature repeated across distinct seeds",
    };
  }
  return { action: "observe", reason: "suspicious only" };
}

function validateTicket(ticket, index, issues) {
  const path = `tickets[${index}]`;
  for (const key of [
    "schemaVersion",
    "ticketId",
    "kind",
    "severity",
    "confidence",
    "title",
    "gameIndex",
    "seed",
    "step",
    "replayFile",
    "ticketFile",
    "rerunCommand",
    "suspect",
    "details",
  ]) {
    if (!(key in ticket)) issues.push(`${path}.${key} missing`);
  }
  if (ticket.schemaVersion !== 1)
    issues.push(`${path}.schemaVersion must be 1`);
  if (!DETECTOR_MANIFEST.ticketKinds.includes(ticket.kind)) {
    issues.push(`${path}.kind unsupported: ${ticket.kind}`);
  }
}

function runCanary(options) {
  const canary = {
    schemaVersion: 1,
    ticketId: "EDH-CANARY",
    kind: "hard_failure",
    severity: "critical",
    confidence: "reproducible",
    title: "canary hard failure",
    gameIndex: 0,
    seed: 1,
    step: 1,
    replayFile: "canary-replay.json",
    ticketFile: "canary.md",
    rerunCommand: "pnpm effect:debug -- --games 1 --seed 1",
    suspect: {
      nodeKind: "legal_action",
      actionKind: "resolve_pending_triggered_effect",
      sourceCardNo: "CANARY-CARD",
      fields: [],
    },
    details: { outcome: "error", lastError: "canary" },
  };
  const signatureSeeds = new Map([[ticketSignature(canary), new Set([1])]]);
  return classifyTicket(canary, signatureSeeds, options).action === "promote";
}

function rel(path, root = defaultRepoRoot()) {
  const resolved = resolve(path);
  const relativePath = relative(root, resolved).replace(/\\/g, "/");
  return relativePath.startsWith("..") ? resolved : relativePath;
}

function b64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function clusterEvidenceForTicket(ticket, options) {
  const signature = ticketSignature(ticket);
  const records = [
    ...(options.currentTickets || []).filter(
      (record) => ticketSignature(record) === signature
    ),
    ...(options.priorObservedTickets || []).filter(
      (record) => record?.signature === signature
    ),
  ];
  const seen = new Set();
  return records
    .filter((record) => record?.ticketFile)
    .map((record) => ({
      ticketFile: rel(record.ticketFile, options.repoRoot),
      replayFile: record.replayFile
        ? rel(record.replayFile, options.repoRoot)
        : null,
      seed: record.seed,
    }))
    .filter((record) => {
      if (seen.has(record.ticketFile)) return false;
      seen.add(record.ticketFile);
      return true;
    });
}

function proposeCluster(ticket, artifactDir, options) {
  const id = clusterIdForTicket(ticket);
  const evidence = clusterEvidenceForTicket(ticket, options);
  const queueRefs = evidence.map((record) => record.ticketFile);
  const queueRef = queueRefs[0];
  const replayRef = rel(ticket.replayFile, options.repoRoot);
  const signature = ticketSignature(ticket);
  const scope = [
    `${ticket.kind} from effect-debug-harvest (${ticket.ticketId})`,
    `signature=${signature}`,
    `ticket=${queueRef}`,
    `replay=${replayRef}`,
    `rerun=${ticket.rerunCommand}`,
    ...evidence
      .slice(1)
      .map(
        (record) =>
          `relatedTicket=${record.ticketFile} seed=${record.seed ?? "unknown"} replay=${
            record.replayFile ?? "unknown"
          }`
      ),
  ].join(" / ");
  const doneDefinition = [
    "元 ticket の rerunCommand を同 seed で再実行して同 signature の ticket が再発しない",
    "原因に対応する回帰テストを追加する",
    "pnpm check / pnpm test / pnpm check:ssot / pnpm check:wiring / verifier が green",
  ].join("。");
  const guardrails = [
    "effect-debug replay/ticket を最初に読む",
    "ルール解釈が必要なら needs-ruling + Telegram へ park し推測で仕様確定しない",
    "ticket を握りつぶすための detector/threshold 変更は禁止",
  ].join("。");
  if (options.dryRun) {
    return { id, status: "dry-run", queueRefs, scope };
  }
  const result = spawnSync(
    process.execPath,
    [
      options.clusterClaimScript,
      "propose",
      "--id",
      id,
      "--lane",
      "codex",
      "--scope-b64",
      b64(scope),
      "--queue-refs-b64",
      b64(JSON.stringify(queueRefs)),
      "--note-b64",
      b64(
        `auto-promoted from ${rel(join(artifactDir, "metrics.json"), options.repoRoot)}`
      ),
      "--done-definition-b64",
      b64(doneDefinition),
      "--guardrails-b64",
      b64(guardrails),
      "--evidence",
      "effect-debug-ticket",
      "--source-b64",
      b64("effect-debug-harvest"),
    ],
    {
      cwd: options.worktreeRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ORICA_CLUSTER_REGISTRY: options.clusterRegistry,
        ORICA_SUPERVISOR_HUB_REPO: options.repoRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `cluster propose failed for ${id}: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return JSON.parse(result.stdout || "{}");
}

export function shouldDeferCleanMinimums({
  allowIncompleteElapsed,
  qualifyingGames,
  requestedGames,
}) {
  return (
    allowIncompleteElapsed === true &&
    Number.isInteger(qualifyingGames) &&
    qualifyingGames >= 0 &&
    qualifyingGames < requestedGames
  );
}

function validateMetrics(
  metrics,
  options,
  artifactDir,
  tickets,
  stats,
  persisted
) {
  const issues = [];
  if (metrics.schemaVersion !== 1)
    issues.push("metrics.schemaVersion must be 1");
  if (metrics.profile !== "effect-debug-harvest") {
    issues.push(
      `metrics.profile must be effect-debug-harvest, got ${metrics.profile}`
    );
  }
  if (metrics.config?.profile !== "effect-debug-harvest") {
    issues.push("metrics.config.profile must be effect-debug-harvest");
  }
  const requestedGames = options.requestedGames ?? metrics.config?.games;
  if (metrics.config?.games !== requestedGames) {
    issues.push(
      `games mismatch: metrics=${metrics.config?.games}, requested=${requestedGames}`
    );
  }
  const attemptedGames =
    metrics.aggregate?.attemptedGames ?? metrics.games?.length ?? 0;
  const qualifyingGames =
    metrics.aggregate?.qualifyingGames ?? metrics.games?.length ?? 0;
  if (!Number.isInteger(attemptedGames) || attemptedGames < requestedGames) {
    issues.push(
      `attemptedGames ${attemptedGames} < requested ${requestedGames}`
    );
  }
  if (!Number.isInteger(qualifyingGames) || qualifyingGames < 0) {
    issues.push(
      `qualifyingGames must be a non-negative integer, got ${qualifyingGames}`
    );
  } else if (
    !options.allowIncompleteElapsed &&
    qualifyingGames < requestedGames
  ) {
    issues.push(
      `qualifyingGames ${qualifyingGames} < requested ${requestedGames}`
    );
  }
  const deferCleanMinimums = shouldDeferCleanMinimums({
    allowIncompleteElapsed: options.allowIncompleteElapsed,
    qualifyingGames,
    requestedGames,
  });
  const head = gitHeadShort(options.worktreeRoot);
  if (metrics.config?.commitHash !== head) {
    issues.push(
      `commit mismatch: metrics=${metrics.config?.commitHash}, HEAD=${head}`
    );
  }
  const cleanStats = persisted.cleanStats ?? stats;
  const cleanDecisionFrames =
    persisted.cleanDecisionFrames ??
    metrics.aggregate?.totalDecisionFrames ??
    0;
  if (!deferCleanMinimums) {
    if (cleanDecisionFrames < options.minDecisionFrames) {
      issues.push(
        `cleanDecisionFrames ${cleanDecisionFrames} < ${options.minDecisionFrames}`
      );
    }
    if (cleanStats.effectDecisionFrames < options.minEffectDecisions) {
      issues.push(
        `cleanEffectDecisionFrames ${cleanStats.effectDecisionFrames} < ${options.minEffectDecisions}`
      );
    }
    if (cleanStats.uniqueSourceCardNos.length < options.minUniqueCards) {
      issues.push(
        `cleanUniqueSourceCardNos ${cleanStats.uniqueSourceCardNos.length} < ${options.minUniqueCards}`
      );
    }
  }
  const coverageGate = coverageGateFromMetrics(metrics);
  if (!coverageGate.valid) {
    issues.push(
      "metrics.aggregate.coverage must expose schemaVersion 1 semantic and choice-surface coverage"
    );
  } else {
    if (persisted.error) {
      issues.push(persisted.error);
    } else if (
      JSON.stringify(stableJson(metrics.aggregate.coverage)) !==
      JSON.stringify(stableJson(persisted.coverage))
    ) {
      issues.push(
        "metrics.aggregate.coverage does not match persisted selected frames and per-game checkpoints"
      );
    } else if (
      metrics.aggregate.cleanCoverage !== undefined &&
      JSON.stringify(stableJson(metrics.aggregate.cleanCoverage)) !==
        JSON.stringify(stableJson(persisted.cleanCoverage))
    ) {
      issues.push(
        "metrics.aggregate.cleanCoverage does not match qualifying per-game frames"
      );
    }
  }
  const hash = detectorManifestHash();
  if (hash !== options.expectedDetectorHash) {
    issues.push(
      `detector manifest hash mismatch: current=${hash}, expected=${options.expectedDetectorHash}`
    );
  }
  if (!existsSync(join(artifactDir, "tickets.jsonl"))) {
    issues.push("tickets.jsonl missing");
  }
  for (const [index, ticket] of tickets.entries())
    validateTicket(ticket, index, issues);
  if (!runCanary(options))
    issues.push("triage canary did not promote hard_failure");
  return issues;
}

export function countEffectDebugClusters(
  registryPath = defaultClusterRegistry(defaultRepoRoot())
) {
  if (!existsSync(registryPath)) return 0;
  const registry = parseJsonFile(registryPath);
  return (registry.clusters || []).filter(
    (cluster) =>
      (cluster.status === "open" || cluster.status === "in_progress") &&
      (cluster.source === "effect-debug-harvest" ||
        /^edh-/.test(cluster.id || ""))
  ).length;
}

export async function triageEffectDebugArtifacts(options) {
  const effectiveOptions = normalizeTriageOptions(options);
  const metricsPath = resolveMetricsPath(effectiveOptions);
  const artifactDir = dirname(metricsPath);
  const metrics = parseJsonFile(metricsPath);
  const ticketsPath = join(artifactDir, "tickets.jsonl");
  const tickets = readJsonLines(ticketsPath);
  const persisted = await coverageFromPersistedArtifacts(artifactDir, {
    wideChoiceThreshold: metrics.config?.wideChoiceThreshold,
    expectedGames:
      metrics.aggregate?.attemptedGames ??
      effectiveOptions.requestedGames ??
      metrics.config?.games,
  });
  const stats = persisted.stats ?? emptyFrameStats();
  const coverageGate = coverageGateFromMetrics(metrics);
  const signatureSeeds = new Map();
  const addSignatureSeed = (signature, seed) => {
    if (typeof signature !== "string" || !Number.isInteger(seed)) return;
    if (!signatureSeeds.has(signature))
      signatureSeeds.set(signature, new Set());
    signatureSeeds.get(signature).add(seed);
  };
  for (const ticket of effectiveOptions.priorObservedTickets) {
    addSignatureSeed(ticket.signature, ticket.seed);
  }
  for (const ticket of tickets) {
    const signature = ticketSignature(ticket);
    addSignatureSeed(signature, ticket.seed);
  }

  const invalidReasons = validateMetrics(
    metrics,
    effectiveOptions,
    artifactDir,
    tickets,
    stats,
    persisted
  );
  const promoted = [];
  const observed = [];
  let ignoredHighReproducible = 0;
  for (const ticket of tickets) {
    const classified = classifyTicket(ticket, signatureSeeds, effectiveOptions);
    if (
      classified.action !== "promote" &&
      (ticket.severity === "critical" || ticket.severity === "high") &&
      ticket.confidence === "reproducible"
    ) {
      ignoredHighReproducible += 1;
    }
    const record = {
      ticketId: ticket.ticketId,
      kind: ticket.kind,
      severity: ticket.severity,
      confidence: ticket.confidence,
      seed: ticket.seed,
      signature: ticketSignature(ticket),
      reason: classified.reason,
      ticketFile: ticket.ticketFile,
      replayFile: ticket.replayFile,
    };
    if (classified.action === "promote") promoted.push({ ticket, record });
    else observed.push(record);
  }
  if (ignoredHighReproducible > 0) {
    invalidReasons.push(
      `ignored critical/high reproducible tickets: ${ignoredHighReproducible}`
    );
  }

  const proposedClusters = [];
  if (invalidReasons.length === 0 && effectiveOptions.promote) {
    const proposedSignatures = new Set();
    const proposalOptions = { ...effectiveOptions, currentTickets: tickets };
    for (const item of promoted) {
      const signature = ticketSignature(item.ticket);
      if (proposedSignatures.has(signature)) continue;
      proposedSignatures.add(signature);
      proposedClusters.push(
        proposeCluster(item.ticket, artifactDir, proposalOptions)
      );
    }
  }

  const status =
    invalidReasons.length > 0
      ? "invalid"
      : promoted.length > 0
        ? "promoted"
        : "clean";
  return {
    schemaVersion: 1,
    status,
    artifactDir,
    metricsFile: metricsPath,
    detectorManifestHash: detectorManifestHash(),
    invalidReasons,
    cleanGate: {
      requestedGames:
        effectiveOptions.requestedGames ?? metrics.config?.games ?? null,
      attemptedGames:
        metrics.aggregate?.attemptedGames ?? metrics.games?.length ?? 0,
      qualifyingGames:
        metrics.aggregate?.qualifyingGames ?? metrics.games?.length ?? 0,
      elapsedTimeReplacementCount:
        metrics.aggregate?.elapsedTimeReplacementCount ?? 0,
      gameSeeds: Array.isArray(metrics.games)
        ? metrics.games
            .map((game) => game?.seed)
            .filter((seed) => Number.isInteger(seed))
        : [],
      qualifyingGameSeeds: Array.isArray(metrics.games)
        ? metrics.games
            .filter(
              (game) =>
                !(
                  game?.outcome === "capped" &&
                  game?.terminationReason === "elapsed_time_limit"
                )
            )
            .map((game) => game?.seed)
            .filter((seed) => Number.isInteger(seed))
        : [],
      minDecisionFrames: effectiveOptions.minDecisionFrames,
      minEffectDecisions: effectiveOptions.minEffectDecisions,
      minUniqueCards: effectiveOptions.minUniqueCards,
      totalDecisionFrames:
        persisted.cleanDecisionFrames ??
        metrics.aggregate?.totalDecisionFrames ??
        0,
      effectDecisionFrames:
        persisted.cleanStats?.effectDecisionFrames ??
        stats.effectDecisionFrames,
      uniqueSourceCardNos:
        persisted.cleanStats?.uniqueSourceCardNos ?? stats.uniqueSourceCardNos,
      coverage: coverageGate,
    },
    tickets: {
      total: tickets.length,
      promoted: promoted.map((item) => item.record),
      observed,
    },
    proposedClusters,
  };
}

function evidenceForCluster(clusterId, options = {}) {
  const effectiveOptions = normalizeTriageOptions(options);
  if (!clusterId) throw new Error("--cluster-id or ORICA_CLUSTER_ID required");
  const registry = parseJsonFile(effectiveOptions.clusterRegistry);
  const cluster = (registry.clusters || []).find(
    (entry) => entry.id === clusterId
  );
  if (!cluster) throw new Error(`cluster not found: ${clusterId}`);
  const queueRefs = cluster.queueRefs || [];
  const lines = [
    `cluster: ${cluster.id}`,
    `source: ${cluster.source || "unknown"}`,
    `scope: ${cluster.scope || ""}`,
  ];
  for (const ticketRef of queueRefs) {
    const ticketPath = resolve(effectiveOptions.repoRoot, ticketRef);
    if (existsSync(ticketPath)) {
      lines.push(
        "",
        `ticket: ${ticketRef}`,
        readFileSync(ticketPath, "utf8").slice(0, 6000)
      );
    } else {
      lines.push("", `ticket file not found: ${ticketRef}`);
    }
  }
  return lines.join("\n");
}

export async function runEffectDebugTriageCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.evidence) {
    console.log(evidenceForCluster(options.clusterId, options));
    return;
  }
  const result = await triageEffectDebugArtifacts(options);
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(
    [
      `effect-debug-triage: ${result.status}`,
      `artifact=${result.artifactDir}`,
      `tickets=${result.tickets.total}, promoted=${result.tickets.promoted.length}`,
      `invalid=${result.invalidReasons.length ? result.invalidReasons.join("; ") : "none"}`,
    ].join("\n")
  );
}

function isDirectExecution() {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(entry).href : false;
}

if (isDirectExecution()) {
  try {
    await runEffectDebugTriageCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
