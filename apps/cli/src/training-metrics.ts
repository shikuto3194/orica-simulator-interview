#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { EffectDebugHarvestRunSummary } from "./effect-debug-harvest";
import type { PolicyBootstrapRunSummary } from "./policy-bootstrap";
import type { PositionBiasDiagnoseRunSummary } from "./position-bias-diagnose";
import type { RolloutBaselineRunSummary } from "./rollout-baseline";
import type { TraceSmokeRunSummary } from "./trace-smoke";
import {
  TRAINING_RUN_PROFILES,
  type TrainingRunProfile,
} from "./training-config";

type TrainingArtifact =
  | TraceSmokeRunSummary
  | RolloutBaselineRunSummary
  | EffectDebugHarvestRunSummary
  | PolicyBootstrapRunSummary
  | PositionBiasDiagnoseRunSummary;
type AggregateTrainingArtifact = Exclude<
  TrainingArtifact,
  PositionBiasDiagnoseRunSummary
>;

export interface TrainingMetricsRow {
  sourcePath: string;
  profile: TrainingRunProfile;
  experimentId: string;
  commitHash: string | null;
  games: number;
  totalSteps: number;
  averageSteps: number;
  totalTraceEntries: number;
  totalDecisionFrames: number | null;
  truncatedNodeCount: number;
  truncatedNodeRate: number;
  maxChoiceCount: number;
  durationMs: number | null;
  stepsPerSecond: number | null;
  outcomeCounts: Record<string, number>;
  winnerCounts: Record<string, number>;
  seatWins?: Record<string, number>;
  agentWins?: Record<string, number>;
  policyLoss?: number;
  valueLoss?: number;
  totalLoss?: number;
  policyAccuracy?: number;
  firstSeatWinRateByCohort?: Record<string, number | null>;
  nondecisiveRateByCohort?: Record<string, number>;
}

export interface TrainingMetricsReport {
  schemaVersion: 1;
  createdAt: string;
  sourceCount: number;
  rows: TrainingMetricsRow[];
  aggregate: {
    games: number;
    totalSteps: number;
    totalTraceEntries: number;
    totalDecisionFrames: number;
    truncatedNodeCount: number;
    truncatedNodeRate: number;
    outcomeCounts: Record<string, number>;
    byProfile: Record<
      TrainingRunProfile,
      {
        runs: number;
        games: number;
        totalSteps: number;
        totalTraceEntries: number;
        totalDecisionFrames: number;
        truncatedNodeCount: number;
        outcomeCounts: Record<string, number>;
      }
    >;
  };
}

interface ParsedArgs {
  help?: boolean;
  json?: boolean;
  out?: string;
  paths: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${path}: invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const record: Record<string, number> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "number" && Number.isFinite(entryValue)) {
      record[key] = entryValue;
    }
  }
  return record;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isKnownTrainingRunProfile(
  value: unknown
): value is TrainingRunProfile {
  return (
    typeof value === "string" &&
    TRAINING_RUN_PROFILES.includes(value as TrainingRunProfile)
  );
}

function detectProfile(artifact: unknown, path: string): TrainingRunProfile {
  if (!isRecord(artifact)) throw new Error(`${path}: artifact must be object`);
  const profile = artifact.profile;
  if (isKnownTrainingRunProfile(profile)) {
    return profile;
  }
  if ("baseline.json" === path.split(/[\\/]/).at(-1)) return "rollout-baseline";
  if ("position-bias.json" === path.split(/[\\/]/).at(-1)) {
    return "position-bias-diagnose";
  }
  return "trace-smoke";
}

function positionBiasArtifactRow(
  sourcePath: string,
  artifact: PositionBiasDiagnoseRunSummary
): TrainingMetricsRow {
  const config = artifact.config as Record<string, unknown>;
  const games = Array.isArray(artifact.games) ? artifact.games.length : 0;
  const totalSteps = Array.isArray(artifact.games)
    ? artifact.games.reduce((sum, game) => sum + finiteNumber(game.steps), 0)
    : 0;
  const totalTraceEntries = Array.isArray(artifact.games)
    ? artifact.games.reduce(
        (sum, game) => sum + finiteNumber(game.traceEntries),
        0
      )
    : 0;
  const outcomeCounts: Record<string, number> = {};
  const winnerCounts: Record<string, number> = {};
  const firstSeatWinRateByCohort: Record<string, number | null> = {};
  const nondecisiveRateByCohort: Record<string, number> = {};

  for (const cohort of artifact.cohorts ?? []) {
    addCounts(outcomeCounts, numberRecord(cohort.outcomeCounts));
    addCounts(winnerCounts, numberRecord(cohort.winnerCounts));
    firstSeatWinRateByCohort[cohort.cohort] = nullableFiniteNumber(
      cohort.firstSeatWinRateAmongDecisive
    );
    nondecisiveRateByCohort[cohort.cohort] = finiteNumber(
      cohort.nondecisiveRate
    );
  }

  return {
    sourcePath,
    profile: "position-bias-diagnose",
    experimentId: stringValue(artifact.experimentId, "unknown"),
    commitHash:
      typeof config.commitHash === "string" ? config.commitHash : null,
    games,
    totalSteps,
    averageSteps: games === 0 ? 0 : totalSteps / games,
    totalTraceEntries,
    totalDecisionFrames: null,
    truncatedNodeCount: 0,
    truncatedNodeRate: 0,
    maxChoiceCount: 0,
    durationMs: null,
    stepsPerSecond: null,
    outcomeCounts,
    winnerCounts,
    firstSeatWinRateByCohort,
    nondecisiveRateByCohort,
  };
}

function artifactRow(
  sourcePath: string,
  artifact: TrainingArtifact,
  profile: TrainingRunProfile
): TrainingMetricsRow {
  if (profile === "position-bias-diagnose") {
    return positionBiasArtifactRow(
      sourcePath,
      artifact as PositionBiasDiagnoseRunSummary
    );
  }

  const aggregateArtifact = artifact as AggregateTrainingArtifact;
  const aggregate = aggregateArtifact.aggregate as Record<string, unknown>;
  const config = aggregateArtifact.config as Record<string, unknown>;
  const games = Array.isArray(aggregateArtifact.games)
    ? aggregateArtifact.games.length
    : finiteNumber(config.games);
  const totalSteps = finiteNumber(aggregate.totalSteps);
  const totalTraceEntries = finiteNumber(aggregate.totalTraceEntries);
  const totalDecisionFrames =
    typeof aggregate.totalDecisionFrames === "number"
      ? finiteNumber(aggregate.totalDecisionFrames)
      : null;
  const truncatedNodeCount = finiteNumber(aggregate.truncatedNodeCount);
  const denominator =
    totalDecisionFrames ?? Math.max(totalTraceEntries, truncatedNodeCount);
  return {
    sourcePath,
    profile,
    experimentId: stringValue(artifact.experimentId, "unknown"),
    commitHash:
      typeof config.commitHash === "string" ? config.commitHash : null,
    games,
    totalSteps,
    averageSteps: finiteNumber(aggregate.averageSteps),
    totalTraceEntries,
    totalDecisionFrames,
    truncatedNodeCount,
    truncatedNodeRate:
      typeof aggregate.truncatedNodeRate === "number"
        ? aggregate.truncatedNodeRate
        : denominator <= 0
          ? 0
          : truncatedNodeCount / denominator,
    maxChoiceCount: finiteNumber(aggregate.maxChoiceCount),
    durationMs: nullableFiniteNumber(aggregate.durationMs),
    stepsPerSecond: nullableFiniteNumber(aggregate.stepsPerSecond),
    outcomeCounts: numberRecord(aggregate.outcomeCounts),
    winnerCounts: numberRecord(aggregate.winnerCounts),
    ...(profile === "rollout-baseline"
      ? {
          seatWins: numberRecord(aggregate.seatWins),
          agentWins: numberRecord(aggregate.agentWins),
        }
      : {}),
    ...(profile === "policy-bootstrap" && "loss" in aggregateArtifact
      ? {
          policyLoss: finiteNumber(aggregateArtifact.loss.policyLoss),
          valueLoss: finiteNumber(aggregateArtifact.loss.valueLoss),
          totalLoss: finiteNumber(aggregateArtifact.loss.totalLoss),
          policyAccuracy: finiteNumber(aggregateArtifact.loss.policyAccuracy),
        }
      : {}),
  };
}

async function artifactFileFromPath(inputPath: string): Promise<string> {
  const resolved = resolve(inputPath);
  const stats = await stat(resolved);
  if (!stats.isDirectory()) return resolved;
  for (const filename of [
    "metrics.json",
    "baseline.json",
    "position-bias.json",
  ]) {
    const artifactPath = join(resolved, filename);
    try {
      await stat(artifactPath);
      return artifactPath;
    } catch {
      // Try the next known artifact filename.
    }
  }
  return join(resolved, "metrics.json");
}

async function loadArtifact(inputPath: string): Promise<TrainingMetricsRow> {
  const filePath = await artifactFileFromPath(inputPath);
  const value = parseJson(await readFile(filePath, "utf8"), filePath);
  const profile = detectProfile(value, filePath);
  return artifactRow(filePath, value as TrainingArtifact, profile);
}

function addCounts(
  target: Record<string, number>,
  source: Record<string, number>
) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function emptyProfileAggregate(): TrainingMetricsReport["aggregate"]["byProfile"][TrainingRunProfile] {
  return {
    runs: 0,
    games: 0,
    totalSteps: 0,
    totalTraceEntries: 0,
    totalDecisionFrames: 0,
    truncatedNodeCount: 0,
    outcomeCounts: {},
  };
}

function buildAggregate(rows: readonly TrainingMetricsRow[]) {
  const byProfile = Object.fromEntries(
    TRAINING_RUN_PROFILES.map((profile) => [profile, emptyProfileAggregate()])
  ) as TrainingMetricsReport["aggregate"]["byProfile"];
  const aggregate: TrainingMetricsReport["aggregate"] = {
    games: 0,
    totalSteps: 0,
    totalTraceEntries: 0,
    totalDecisionFrames: 0,
    truncatedNodeCount: 0,
    truncatedNodeRate: 0,
    outcomeCounts: {},
    byProfile,
  };
  for (const row of rows) {
    aggregate.games += row.games;
    aggregate.totalSteps += row.totalSteps;
    aggregate.totalTraceEntries += row.totalTraceEntries;
    aggregate.totalDecisionFrames += row.totalDecisionFrames ?? 0;
    aggregate.truncatedNodeCount += row.truncatedNodeCount;
    addCounts(aggregate.outcomeCounts, row.outcomeCounts);

    const profile = aggregate.byProfile[row.profile];
    profile.runs += 1;
    profile.games += row.games;
    profile.totalSteps += row.totalSteps;
    profile.totalTraceEntries += row.totalTraceEntries;
    profile.totalDecisionFrames += row.totalDecisionFrames ?? 0;
    profile.truncatedNodeCount += row.truncatedNodeCount;
    addCounts(profile.outcomeCounts, row.outcomeCounts);
  }
  const denominator =
    aggregate.totalDecisionFrames > 0
      ? aggregate.totalDecisionFrames
      : aggregate.totalTraceEntries;
  aggregate.truncatedNodeRate =
    denominator <= 0 ? 0 : aggregate.truncatedNodeCount / denominator;
  return aggregate;
}

export async function buildTrainingMetricsReport(
  paths: readonly string[]
): Promise<TrainingMetricsReport> {
  const rows = await Promise.all(paths.map((path) => loadArtifact(path)));
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceCount: rows.length,
    rows,
    aggregate: buildAggregate(rows),
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatTrainingMetricsReport(
  report: TrainingMetricsReport
): string {
  const lines = [
    `training metrics: ${report.sourceCount} run(s), games=${report.aggregate.games}, truncated=${formatPercent(report.aggregate.truncatedNodeRate)}`,
    "profile experiment games outcome truncated steps/s source",
  ];
  for (const row of report.rows) {
    const outcome = Object.entries(row.outcomeCounts)
      .map(([key, value]) => `${key}:${value}`)
      .join(",");
    lines.push(
      [
        row.profile,
        row.experimentId,
        String(row.games),
        outcome || "-",
        formatPercent(row.truncatedNodeRate),
        row.stepsPerSecond === null ? "-" : row.stepsPerSecond.toFixed(1),
        row.sourcePath,
      ].join(" ")
    );
  }
  return lines.join("\n");
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--":
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--out":
      case "--output":
        parsed.out = next();
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
        parsed.paths.push(arg);
        break;
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "orica training-metrics",
    "",
    "Usage:",
    "  node apps/cli/dist/training-metrics.js artifacts/trace-smoke/run artifacts/baseline/run",
    "",
    "Options:",
    "  --json          print the report JSON",
    "  --out <file>    write report JSON to a file",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

export async function runTrainingMetricsCli(
  argv: readonly string[]
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  if (parsed.paths.length === 0) {
    throw new Error("at least one artifact path is required");
  }
  const report = await buildTrainingMetricsReport(parsed.paths);
  if (parsed.out !== undefined) {
    await writeFile(parsed.out, JSON.stringify(report, null, 2), "utf8");
  }
  console.log(
    parsed.json
      ? JSON.stringify(report, null, 2)
      : formatTrainingMetricsReport(report)
  );
}

if (isDirectExecution()) {
  runTrainingMetricsCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
