import "./artifact-free-space-fixture";

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { TrainingReplaySample } from "@orica/rules-core";

import {
  loadPolicyCheckpointArtifact,
  runPolicyBootstrap,
  runPolicyBootstrapCli,
  selectPolicyBootstrapBatchSamples,
} from "../src/policy-bootstrap";
import { writeDeckSelectionFixture } from "./deck-selection-fixture";

describe("policy-bootstrap CLI runner", () => {
  it("prioritizes terminal-value samples in a bounded training batch", () => {
    const sample = (sampleId: string, value: number) =>
      ({ sampleId, weights: { value } }) as TrainingReplaySample;
    const selected = selectPolicyBootstrapBatchSamples(
      [
        sample("capped-a", 0),
        sample("capped-b", 0),
        sample("natural-a", 1),
        sample("natural-b", 1),
        sample("natural-c", 1),
      ],
      2
    );

    expect(selected.map((entry) => entry.sampleId)).toEqual([
      "natural-a",
      "natural-b",
    ]);
  });

  it("runs a dry-run self-play batch and does not write a checkpoint", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-policy-bootstrap-"));

    const summary = await runPolicyBootstrap({
      games: 1,
      maxSteps: 12,
      seed: 41,
      maxGeneratedChoices: 32,
      deckSize: 12,
      hiddenDim: 16,
      batchSize: 16,
      outDir,
      experimentId: "test-policy-bootstrap",
      skipPreGame: true,
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.profile).toBe("policy-bootstrap");
    expect(summary.dryRun).toBe(true);
    expect(summary.checkpoint).toEqual({
      written: false,
      reason: "dry_run",
    });
    expect(summary.network).toMatchObject({
      kind: "tiny-deepsets-policy-value",
      hiddenDim: 16,
      seed: 41,
    });
    expect(summary.replayBuffer.sampleCount).toBeGreaterThan(0);
    expect(summary.batch.evaluatedSampleCount).toBeLessThanOrEqual(16);
    expect(Number.isFinite(summary.loss.totalLoss)).toBe(true);

    const artifact = JSON.parse(
      await readFile(join(outDir, "metrics.json"), "utf8")
    ) as Awaited<ReturnType<typeof runPolicyBootstrap>>;
    expect(artifact.experimentId).toBe("test-policy-bootstrap");
    expect(artifact.config.skipPreGame).toBe(true);
    expect(artifact.checkpoint.written).toBe(false);
  });

  it("loads a JSON run config and lets CLI flags override it", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "orica-policy-config-"));
    const configPath = join(configDir, "policy.config.json");
    const outDir = join(configDir, "policy-out");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "policy-bootstrap",
        experimentId: "config-policy-bootstrap",
        games: 1,
        maxSteps: 16,
        seed: 43,
        maxGeneratedChoices: 32,
        deckSize: 12,
        skipPreGame: true,
        outDir: "policy-out",
        dryRun: true,
        hiddenDim: 32,
        batchSize: 24,
      }),
      "utf8"
    );

    await runPolicyBootstrapCli([
      "--config",
      configPath,
      "--hiddenDim",
      "16",
      "--batchSize",
      "8",
    ]);

    const artifact = JSON.parse(
      await readFile(join(outDir, "metrics.json"), "utf8")
    ) as Awaited<ReturnType<typeof runPolicyBootstrap>>;
    expect(artifact.experimentId).toBe("config-policy-bootstrap");
    expect(artifact.outputDir).toBe(outDir);
    expect(artifact.config.configPath).toBe(configPath);
    expect(artifact.config.hiddenDim).toBe(16);
    expect(artifact.config.batchSize).toBe(8);
  });

  it("writes and resumes a versioned training checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "orica-policy-checkpoint-"));
    const firstOut = join(root, "first");
    const firstCheckpoint = join(root, "policy-v1.json");
    const first = await runPolicyBootstrap({
      games: 1,
      maxSteps: 12,
      seed: 47,
      maxGeneratedChoices: 32,
      deckSize: 12,
      hiddenDim: 16,
      batchSize: 16,
      outDir: firstOut,
      experimentId: "test-policy-training-first",
      skipPreGame: true,
      dryRun: false,
      checkpointOut: firstCheckpoint,
      epochs: 1,
    });

    expect(first.dryRun).toBe(false);
    expect(first.training).not.toBeNull();
    expect(first.checkpoint).toMatchObject({
      written: true,
      file: firstCheckpoint,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const artifact = await loadPolicyCheckpointArtifact(firstCheckpoint);
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      kind: "orica-policy-value-checkpoint",
      experimentId: "test-policy-training-first",
      network: { kind: "tiny-deepsets-policy-value", hiddenDim: 16 },
    });

    const secondCheckpoint = join(root, "policy-v2.json");
    const second = await runPolicyBootstrap({
      games: 1,
      maxSteps: 12,
      seed: 49,
      maxGeneratedChoices: 32,
      deckSize: 12,
      hiddenDim: 32,
      batchSize: 16,
      outDir: join(root, "second"),
      experimentId: "test-policy-training-resume",
      skipPreGame: true,
      dryRun: false,
      checkpointIn: firstCheckpoint,
      checkpointOut: secondCheckpoint,
      epochs: 1,
    });

    expect(second.config.checkpointIn).toBe(firstCheckpoint);
    expect(second.network.hiddenDim).toBe(16);
    expect(second.checkpoint).toMatchObject({
      written: true,
      file: secondCheckpoint,
    });
    expect(second.checkpointResume).toEqual({
      requestedFile: firstCheckpoint,
      resumedFile: firstCheckpoint,
      discardedFile: null,
      discardReason: null,
    });

    const legacyCheckpoint = join(root, "legacy-policy.json");
    const legacyArtifact = JSON.parse(await readFile(firstCheckpoint, "utf8"));
    delete legacyArtifact.network.trainingChoiceFeatureSchemaFingerprint;
    await writeFile(legacyCheckpoint, JSON.stringify(legacyArtifact), "utf8");
    const restarted = await runPolicyBootstrap({
      games: 1,
      maxSteps: 12,
      seed: 53,
      maxGeneratedChoices: 32,
      deckSize: 12,
      hiddenDim: 16,
      batchSize: 16,
      outDir: join(root, "restarted"),
      experimentId: "test-policy-training-restarted",
      skipPreGame: true,
      dryRun: false,
      checkpointIn: legacyCheckpoint,
      checkpointOut: join(root, "restarted-policy.json"),
      restartIncompatibleCheckpoint: true,
      epochs: 1,
    });
    expect(restarted.checkpointResume).toEqual({
      requestedFile: legacyCheckpoint,
      resumedFile: null,
      discardedFile: legacyCheckpoint,
      discardReason: "training_choice_feature_schema_mismatch",
    });
  });

  it("can draw self-play decks from a selected tier deck pool", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-policy-decks-"));
    const deckSelectionPath = await writeDeckSelectionFixture(outDir);

    const summary = await runPolicyBootstrap({
      games: 1,
      maxSteps: 8,
      seed: 59,
      maxGeneratedChoices: 32,
      deckSize: 12,
      hiddenDim: 16,
      batchSize: 8,
      outDir: join(outDir, "run"),
      experimentId: "test-policy-selected-decks",
      skipPreGame: true,
      deckSelectionPath,
      deckSet: "policyBootstrap",
    });

    expect(summary.config.deckSource).toBe("selection");
    expect(summary.config.deckSelectionPath).toBe(deckSelectionPath);
    expect(summary.deckPool?.setName).toBe("policyBootstrap");
    expect(summary.deckPool?.deckCount).toBe(2);
    expect(summary.games[0]?.deckSource).toBe("selection");
    expect(summary.games[0]?.decks.alice?.name).toMatch(/^Fixture /);
    expect(summary.games[0]?.decks.bob?.name).toMatch(/^Fixture /);
  });
});
