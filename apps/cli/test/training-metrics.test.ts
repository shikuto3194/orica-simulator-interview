import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTrainingMetricsReport,
  formatTrainingMetricsReport,
} from "../src/training-metrics";

describe("training metrics reporter", () => {
  it("summarizes all current training artifact profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "orica-training-metrics-"));
    const traceDir = join(root, "trace");
    const baselineDir = join(root, "baseline");
    const policyDir = join(root, "policy");
    const biasDir = join(root, "bias");
    await mkdir(traceDir);
    await mkdir(baselineDir);
    await mkdir(policyDir);
    await mkdir(biasDir);

    await writeFile(
      join(traceDir, "metrics.json"),
      JSON.stringify({
        schemaVersion: 1,
        profile: "trace-smoke",
        experimentId: "trace-a",
        createdAt: "2026-08-12T00:00:00.000Z",
        outputDir: traceDir,
        config: {
          profile: "trace-smoke",
          configPath: null,
          commitHash: "abc123456789",
          games: 1,
          maxSteps: 10,
          seed: 1,
          maxGeneratedChoices: 16,
          deckSize: 8,
          skipPreGame: false,
        },
        aggregate: {
          outcomeCounts: { natural: 0, capped: 1, stuck: 0, error: 0 },
          winnerCounts: { none: 1 },
          totalSteps: 10,
          averageSteps: 10,
          totalDecisionFrames: 7,
          totalTraceEntries: 7,
          truncatedNodeCount: 1,
          truncatedNodeRate: 1 / 7,
          maxChoiceCount: 3,
          nodeKindCounts: { pregame: 1, legal_action: 5, action_input: 1 },
          durationMs: 500,
          stepsPerSecond: 20,
        },
        games: [{}],
      }),
      "utf8"
    );
    await writeFile(
      join(baselineDir, "baseline.json"),
      JSON.stringify({
        schemaVersion: 1,
        profile: "rollout-baseline",
        experimentId: "baseline-a",
        createdAt: "2026-08-12T00:00:00.000Z",
        outputDir: baselineDir,
        config: {
          profile: "rollout-baseline",
          configPath: null,
          commitHash: "abc123456789",
          games: 2,
          maxSteps: 10,
          seed: 1,
          maxGeneratedChoices: 16,
          deckSize: 8,
          skipPreGame: false,
          agentA: "random",
          agentB: "heuristic",
        },
        aggregate: {
          outcomeCounts: { natural: 1, capped: 1, stuck: 0, error: 0 },
          agentWins: { random: 1, heuristic: 0 },
          seatWins: { alice: 1, bob: 0, none: 1 },
          totalSteps: 20,
          averageSteps: 10,
          totalTraceEntries: 12,
          truncatedNodeCount: 2,
          maxChoiceCount: 4,
          nodeKindCounts: { pregame: 2, legal_action: 8, action_input: 2 },
          durationMs: 1000,
          stepsPerSecond: 20,
        },
        games: [{}, {}],
      }),
      "utf8"
    );
    await writeFile(
      join(policyDir, "metrics.json"),
      JSON.stringify({
        schemaVersion: 1,
        profile: "policy-bootstrap",
        dryRun: true,
        experimentId: "policy-a",
        createdAt: "2026-08-12T00:00:00.000Z",
        outputDir: policyDir,
        config: {
          profile: "policy-bootstrap",
          configPath: null,
          commitHash: "abc123456789",
          games: 1,
          maxSteps: 10,
          seed: 1,
          maxGeneratedChoices: 16,
          deckSize: 8,
          skipPreGame: true,
          hiddenDim: 16,
          batchSize: 8,
          maxCards: 16,
          maxKnownDeckEntries: 4,
          maxChoices: null,
        },
        aggregate: {
          outcomeCounts: { natural: 1, capped: 0, stuck: 0, error: 0 },
          winnerCounts: { alice: 1 },
          totalSteps: 8,
          averageSteps: 8,
          totalDecisionFrames: 5,
          totalTraceEntries: 5,
          truncatedNodeCount: 0,
          truncatedNodeRate: 0,
          maxChoiceCount: 2,
          nodeKindCounts: { pregame: 0, legal_action: 4, action_input: 1 },
          durationMs: 400,
          stepsPerSecond: 20,
        },
        loss: {
          sampleCount: 5,
          policyUsableSampleCount: 5,
          valueUsableSampleCount: 5,
          policyLoss: 0.7,
          valueLoss: 0.2,
          totalLoss: 0.9,
          policyAccuracy: 0.4,
          valueMse: 0.2,
        },
        checkpoint: { written: false, reason: "dry_run" },
        games: [{}],
      }),
      "utf8"
    );
    await writeFile(
      join(biasDir, "position-bias.json"),
      JSON.stringify({
        schemaVersion: 1,
        profile: "position-bias-diagnose",
        experimentId: "bias-a",
        createdAt: "2026-08-12T00:00:00.000Z",
        outputDir: biasDir,
        config: {
          profile: "position-bias-diagnose",
          configPath: null,
          commitHash: "abc123456789",
          games: 2,
          maxSteps: 10,
          seed: 1,
          maxGeneratedChoices: 16,
          deckSize: 8,
          skipPreGame: true,
        },
        cohorts: [
          {
            cohort: "random_decks",
            games: 2,
            outcomeCounts: { natural: 1, capped: 1, stuck: 0, error: 0 },
            winnerCounts: { alice: 1, bob: 0, none: 1 },
            firstSeatWinRateAmongDecisive: 1,
            nondecisiveRate: 0.5,
            averageTurnNumber: 3,
            averageSteps: 9,
            reasonByLoser: { alice: {}, bob: { life: 1 } },
          },
          {
            cohort: "mirror_deck",
            games: 2,
            outcomeCounts: { natural: 1, capped: 1, stuck: 0, error: 0 },
            winnerCounts: { alice: 0, bob: 1, none: 1 },
            firstSeatWinRateAmongDecisive: 0,
            nondecisiveRate: 0.5,
            averageTurnNumber: 4,
            averageSteps: 10,
            reasonByLoser: { alice: { life: 1 }, bob: {} },
          },
          {
            cohort: "paired_deck_swap",
            games: 2,
            outcomeCounts: { natural: 0, capped: 0, stuck: 2, error: 0 },
            winnerCounts: { alice: 0, bob: 0, none: 2 },
            firstSeatWinRateAmongDecisive: null,
            nondecisiveRate: 1,
            averageTurnNumber: 2,
            averageSteps: 8,
            reasonByLoser: { alice: {}, bob: {} },
          },
        ],
        games: [
          { steps: 9, traceEntries: 4 },
          { steps: 9, traceEntries: 4 },
          { steps: 10, traceEntries: 5 },
          { steps: 10, traceEntries: 5 },
          { steps: 8, traceEntries: 3 },
          { steps: 8, traceEntries: 3 },
        ],
      }),
      "utf8"
    );

    const report = await buildTrainingMetricsReport([
      traceDir,
      baselineDir,
      policyDir,
      biasDir,
    ]);

    expect(report.sourceCount).toBe(4);
    expect(report.aggregate.games).toBe(10);
    expect(report.aggregate.totalSteps).toBe(92);
    expect(report.aggregate.outcomeCounts).toEqual({
      natural: 4,
      capped: 4,
      stuck: 2,
      error: 0,
    });
    expect(report.aggregate.byProfile["trace-smoke"].runs).toBe(1);
    expect(report.aggregate.byProfile["rollout-baseline"].games).toBe(2);
    expect(report.aggregate.byProfile["policy-bootstrap"].games).toBe(1);
    expect(report.aggregate.byProfile["position-bias-diagnose"].games).toBe(6);
    expect(
      report.rows.find((row) => row.profile === "policy-bootstrap")?.totalLoss
    ).toBe(0.9);
    expect(
      report.rows.find((row) => row.profile === "position-bias-diagnose")
        ?.firstSeatWinRateByCohort?.mirror_deck
    ).toBe(0);
    expect(formatTrainingMetricsReport(report)).toContain("baseline-a");
  });
});
