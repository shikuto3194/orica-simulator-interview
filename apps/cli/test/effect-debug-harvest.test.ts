import "./artifact-free-space-fixture";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, basename, join } from "node:path";
import { existsSync } from "node:fs";
import {
  readArtifactText,
  readJsonRecords,
  readReplayArtifact,
  resolveJsonlSource,
} from "../../../scripts/lib/artifact-io.mjs";

import { isContractDefinition, mulberry32 } from "@orica/rules-core";
import { describe, expect, it } from "vitest";

import {
  buildCoverageGuidedDeck,
  collectEffectDebugCoverageFromFrames,
  runEffectDebugHarvest,
  runEffectDebugHarvestCli,
} from "../src/effect-debug-harvest";
import { runPolicyBootstrap } from "../src/policy-bootstrap";
import { createTrainingEngine } from "../src/trace-smoke";

// Read generated evidence through the public reader, including legacy artifacts.
async function readEvidence(path: string, _encoding: "utf8"): Promise<string> {
  if (
    path.endsWith(".jsonl.gz") &&
    (path.replaceAll("\\", "/").includes("/replays/") ||
      basename(path) === "replay.jsonl.gz")
  )
    return JSON.stringify(await readReplayArtifact(path));
  if (
    !existsSync(path) &&
    ["frames.jsonl", "trace.jsonl"].includes(basename(path))
  ) {
    const lines: string[] = [];
    for await (const record of readJsonRecords(
      resolveJsonlSource(dirname(path), basename(path).replace(".jsonl", ""))
    ))
      lines.push(JSON.stringify(record));
    return lines.join("\n") + "\n";
  }
  return path.endsWith(".gz") ? readArtifactText(path) : readFile(path, "utf8");
}

function jsonLines(text: string): unknown[] {
  const trimmed = text.trim();
  return trimmed.length === 0
    ? []
    : trimmed.split(/\r?\n/).map((line) => JSON.parse(line) as unknown);
}

describe("effect-debug-harvest CLI runner", () => {
  it("accepts the shared policy agent name before enforcing its checkpoint requirement", async () => {
    await expect(
      runEffectDebugHarvestCli(["--agentA", "policy"])
    ).rejects.toThrow(
      "policyCheckpointPath is required when an effect-debug agent is policy"
    );
  });

  it("counts only selected actions and marks missing effect provenance", () => {
    const coverage = collectEffectDebugCoverageFromFrames(
      [
        {
          node: {
            choices: [
              {
                choiceId: "offered-effect",
                action: {
                  kind: "use_magic",
                  sourceCardNo: "OFFERED-001",
                  effectIndex: 0,
                },
              },
              { choiceId: "selected-system", action: { kind: "pass" } },
            ],
          },
          selected: {
            choiceId: "selected-system",
            choiceCount: 2,
            truncated: false,
          },
        },
        {
          node: {
            action: { kind: "use_magic", effectIndex: 0, stepIndex: 0 },
          },
          selected: {
            choiceId: "direct-action",
            choiceCount: 1,
            truncated: false,
          },
        },
      ],
      16
    );

    expect(coverage.semantic.cards).not.toHaveProperty("OFFERED-001");
    expect(coverage.semantic.effects).toEqual({});
    expect(coverage.semantic.dslSteps).toEqual({});
    expect(coverage.semantic.actions).toEqual({ pass: 1, use_magic: 1 });
    expect(coverage.semantic.unattributedEffectRefs).toBe(1);
    expect(coverage.semantic.unattributedDslStepRefs).toBe(1);
    expect(coverage.semantic.cards).not.toHaveProperty("unknown");
  });

  it("attributes selected pending-step actions through their visible source instance", () => {
    const coverage = collectEffectDebugCoverageFromFrames(
      [
        {
          observation: {
            cards: [
              {
                instanceId: "pending-source",
                cardNoOrUnknown: "PENDING-001",
                identityVisibility: "known",
              },
            ],
          },
          node: {
            choices: [
              {
                choiceId: "resolve-pending-step",
                action: {
                  kind: "resolve_pending_step_optional_choice",
                  sourceInstanceId: "pending-source",
                  effectIndex: 2,
                  stepIndex: 3,
                },
              },
            ],
          },
          selected: {
            choiceId: "resolve-pending-step",
            choiceCount: 2,
            truncated: false,
          },
        },
      ],
      16
    );

    expect(coverage.semantic).toMatchObject({
      cards: { "PENDING-001": 1 },
      effects: { "PENDING-001#effectIndex:2": 1 },
      dslSteps: { "PENDING-001#effectIndex:2/stepIndex:3": 1 },
      unattributedEffectRefs: 0,
      unattributedDslStepRefs: 0,
    });
  });

  it("keeps hidden and missing pending-step sources unattributed", () => {
    const coverage = collectEffectDebugCoverageFromFrames(
      [
        {
          observation: {
            cards: [
              {
                instanceId: "hidden-source",
                cardNoOrUnknown: "UNK_CARD",
                identityVisibility: "unknown",
              },
            ],
          },
          node: {
            choices: [
              {
                choiceId: "resolve-hidden-step",
                action: {
                  kind: "resolve_pending_step_optional_choice",
                  sourceInstanceId: "hidden-source",
                  effectIndex: 2,
                  stepIndex: 3,
                },
              },
            ],
          },
          selected: { choiceId: "resolve-hidden-step", choiceCount: 2 },
        },
        {
          observation: { cards: [] },
          node: {
            choices: [
              {
                choiceId: "resolve-missing-step",
                action: {
                  kind: "resolve_pending_step_optional_choice",
                  sourceInstanceId: "missing-source",
                  effectIndex: 2,
                  stepIndex: 3,
                },
              },
            ],
          },
          selected: { choiceId: "resolve-missing-step", choiceCount: 2 },
        },
      ],
      16
    );

    expect(coverage.semantic.cards).not.toHaveProperty("UNK_CARD");
    expect(coverage.semantic.effects).toEqual({});
    expect(coverage.semantic.dslSteps).toEqual({});
    expect(coverage.semantic.unattributedEffectRefs).toBe(2);
    expect(coverage.semantic.unattributedDslStepRefs).toBe(2);
  });

  it("writes replay-backed draft tickets without training", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-debug-"));

    const summary = await runEffectDebugHarvest({
      games: 1,
      maxSteps: 1,
      seed: 41,
      maxGeneratedChoices: 32,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug",
      skipPreGame: true,
      agentA: "random",
      agentB: "random",
      wideChoiceThreshold: 0,
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.profile).toBe("effect-debug-harvest");
    expect(summary.aggregate.outcomeCounts.capped).toBe(1);
    expect(summary.aggregate.ticketCounts.capped).toBe(1);
    expect(summary.aggregate.totalTickets).toBeGreaterThan(0);
    expect(summary.aggregate.coverage).toMatchObject({
      schemaVersion: 1,
      semantic: {
        actions: expect.any(Object),
        cards: expect.any(Object),
      },
      choiceSurface: {
        cappedGameCount: 1,
        truncatedDecisionFrames: expect.any(Number),
      },
    });
    expect(summary.games[0]?.ticketIds).toContain("EDH-0000-00-capped");
    expect(summary.games[0]).toMatchObject({
      steps: 4,
      decisionSteps: 1,
      transitionSteps: 4,
      terminationReason: "decision_limit",
    });

    const ticketsPath = join(outDir, "tickets.jsonl");
    const originalTicketsText = await readEvidence(ticketsPath, "utf8");
    const ticketLines = jsonLines(originalTicketsText);
    expect(ticketLines).toHaveLength(summary.aggregate.totalTickets);
    const cappedTicket = ticketLines[0] as {
      step: number;
      decisionSteps: number;
      transitionSteps: number;
    };
    expect(cappedTicket).toMatchObject({
      step: 3,
      decisionSteps: 1,
      transitionSteps: 4,
    });
    const replay = JSON.parse(
      await readEvidence(summary.games[0]!.replayFile, "utf8")
    ) as {
      frames: Array<{
        label: string;
        traceEntry?: { step: number };
      }>;
    };
    expect(replay.frames.at(-2)?.traceEntry?.step).toBe(cappedTicket.step);
    expect(replay.frames.at(-1)?.label).toBe(
      "final / capped / transitions 4 / decisions 1"
    );
    const gameLedger = JSON.parse(
      await readEvidence(join(outDir, "games", "game-0000.json"), "utf8")
    ) as {
      schemaVersion: number;
      framesFile: string;
      traceFile: string;
      frameLines?: unknown;
    };
    expect(gameLedger.schemaVersion).toBe(2);
    expect(gameLedger.traceFile).toContain(
      "game-0000.attempt-00.trace.jsonl.gz"
    );
    expect(existsSync(join(outDir, "trace.jsonl"))).toBe(false);
    expect(existsSync(join(outDir, "frames.jsonl"))).toBe(false);
    const manifest = JSON.parse(
      await readFile(join(outDir, "frames.manifest.json"), "utf8")
    ) as { files: string[] };
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.files.every((file) => file.endsWith(".jsonl.gz"))).toBe(
      true
    );
    expect(gameLedger).not.toHaveProperty("frameLines");
    const persistedFrames = jsonLines(
      await readEvidence(gameLedger.framesFile, "utf8")
    ) as Array<{ state?: unknown }>;
    expect(persistedFrames).toHaveLength(summary.games[0]!.decisionFrames);
    expect(persistedFrames[0]?.state).toBeUndefined();
    const ticketText = await readEvidence(
      join(outDir, "tickets", "EDH-0000-00-capped.md"),
      "utf8"
    );
    expect(ticketText).toContain("pnpm effect:debug");
    expect(ticketText).toContain("step: 3 (suspect transition index)");
    expect(
      JSON.parse(await readEvidence(join(outDir, "metrics.json"), "utf8"))
    ).toMatchObject({
      profile: "effect-debug-harvest",
      experimentId: "test-effect-debug",
    });

    const { triageEffectDebugArtifacts } =
      await import("../../../scripts/effect-debug-triage.mjs");
    const triage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
    });
    expect(triage.status).not.toBe("invalid");
    expect(triage.invalidReasons).not.toContainEqual(
      expect.stringContaining("detector manifest hash mismatch")
    );

    const cappedObservation = triage.tickets.observed.find(
      (ticket: { kind: string }) => ticket.kind === "capped"
    );
    expect(cappedObservation).toBeDefined();
    const sameSeedTriage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
      priorObservedTickets: [cappedObservation],
    });
    expect(sameSeedTriage.status).toBe("clean");
    const priorTicketFile = join(outDir, "prior-capped-ticket.md");
    const priorReplayFile = join(outDir, "prior-capped-replay.json");
    const distinctSeedTriage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
      priorObservedTickets: [
        {
          ...cappedObservation,
          seed: 42,
          ticketFile: priorTicketFile,
          replayFile: priorReplayFile,
        },
      ],
      promote: true,
      dryRun: true,
    });
    expect(distinctSeedTriage.status).toBe("promoted");
    expect(distinctSeedTriage.tickets.promoted[0]?.reason).toContain(
      "distinct seeds"
    );
    expect(distinctSeedTriage.proposedClusters[0]?.queueRefs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("EDH-0000-00-capped.md"),
        priorTicketFile,
      ])
    );
    expect(distinctSeedTriage.proposedClusters[0]?.scope).toContain(
      `relatedTicket=${priorTicketFile}`
    );

    const siblingTicketFile = join(outDir, "sibling-capped-ticket.md");
    const siblingTicket = {
      ...summary.tickets[0]!,
      ticketId: "EDH-0001-00-capped",
      gameIndex: 1,
      seed: 42,
      ticketFile: siblingTicketFile,
      replayFile: join(outDir, "sibling-capped-replay.json"),
    };
    await writeFile(
      ticketsPath,
      originalTicketsText.trimEnd() +
        "\n" +
        JSON.stringify(siblingTicket) +
        "\n",
      "utf8"
    );
    const sameBatchTriage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
      promote: true,
      dryRun: true,
    });
    expect(sameBatchTriage.status).toBe("promoted");
    expect(sameBatchTriage.proposedClusters).toHaveLength(1);
    expect(sameBatchTriage.proposedClusters[0]?.queueRefs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("EDH-0000-00-capped.md"),
        siblingTicketFile,
      ])
    );
    expect(sameBatchTriage.proposedClusters[0]?.scope).toContain(
      "relatedTicket=" + siblingTicketFile
    );
    await writeFile(ticketsPath, originalTicketsText, "utf8");

    const tamperedMetrics = JSON.parse(
      await readEvidence(join(outDir, "metrics.json"), "utf8")
    ) as Awaited<ReturnType<typeof runEffectDebugHarvest>>;
    tamperedMetrics.aggregate.coverage.choiceSurface.cappedGameCount = 0;
    await writeFile(
      join(outDir, "metrics.json"),
      JSON.stringify(tamperedMetrics),
      "utf8"
    );
    const tamperedTriage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
    });
    expect(tamperedTriage.status).toBe("invalid");
    expect(tamperedTriage.invalidReasons).toContain(
      "metrics.aggregate.coverage does not match persisted selected frames and per-game checkpoints"
    );

    const cleanTamperedMetrics = structuredClone(summary);
    cleanTamperedMetrics.aggregate.cleanCoverage.semantic.executedActionFrames += 1;
    await writeFile(
      join(outDir, "metrics.json"),
      JSON.stringify(cleanTamperedMetrics),
      "utf8"
    );
    const cleanTamperedTriage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
    });
    expect(cleanTamperedTriage.status).toBe("invalid");
    expect(cleanTamperedTriage.invalidReasons).toContain(
      "metrics.aggregate.cleanCoverage does not match qualifying per-game frames"
    );
  });

  it("turns a per-game elapsed limit into a durable capped checkpoint", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-time-cap-"));
    const summary = await runEffectDebugHarvest({
      games: 1,
      maxSteps: 4000,
      maxGameDurationMs: 1,
      maxGameDurationRetries: 0,
      seed: 43,
      maxGeneratedChoices: 16,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug-time-cap",
      skipPreGame: true,
      agentA: "random",
      agentB: "random",
      wideChoiceThreshold: 0,
    });

    expect(summary.config.maxGameDurationMs).toBe(1);
    expect(summary.games[0]).toMatchObject({
      outcome: "capped",
      terminationReason: "elapsed_time_limit",
    });
    const ticket = summary.tickets.find((item) => item.kind === "capped");
    expect(ticket).toMatchObject({
      title: "game reached maxGameDurationMs=1",
      details: expect.objectContaining({
        maxGameDurationMs: 1,
        terminationReason: "elapsed_time_limit",
      }),
    });
    expect(ticket?.rerunCommand).toContain("--maxGameDurationMs 1");

    const checkpoint = JSON.parse(
      await readEvidence(join(outDir, "checkpoint.json"), "utf8")
    ) as {
      config: { maxGameDurationMs?: number };
      completedGameIndexes: number[];
    };
    expect(checkpoint.config.maxGameDurationMs).toBe(1);
    expect(checkpoint.completedGameIndexes).toEqual([0]);
  });

  it("retries the same seed with an expanded elapsed cap and records recovery", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-time-retry-"));
    const seenAttempts: Array<{
      gameIndex: number;
      seed: number;
      attemptIndex: number;
      maxDurationMs: number;
    }> = [];
    const summary = await runEffectDebugHarvest({
      games: 1,
      maxSteps: 1,
      maxGameDurationMs: 1,
      maxGameDurationRetries: 1,
      maxGameDurationMultiplier: 2,
      maxGameDurationCeilingMs: 2,
      seed: 47,
      maxGeneratedChoices: 16,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug-time-retry",
      skipPreGame: true,
      agentA: "random",
      agentB: "random",
      wideChoiceThreshold: 0,
      gameClockFactory: (context) => {
        seenAttempts.push(context);
        let tick = 0;
        return context.attemptIndex === 0 ? () => tick++ : () => 0;
      },
    });

    expect(seenAttempts).toEqual([
      { gameIndex: 0, seed: 47, attemptIndex: 0, maxDurationMs: 1 },
      { gameIndex: 0, seed: 47, attemptIndex: 1, maxDurationMs: 2 },
    ]);
    expect(summary.games[0]).toMatchObject({
      seed: 47,
      outcome: "capped",
      terminationReason: "decision_limit",
      durationAttemptsMs: expect.any(Array),
      timeLimitRetryCount: 1,
      effectiveMaxGameDurationMs: 2,
    });
    expect(summary.games[0]?.durationAttemptsMs).toHaveLength(2);
    expect(summary.aggregate).toMatchObject({
      attemptedGames: 1,
      qualifyingGames: 1,
      elapsedTimeReplacementCount: 0,
      retriedGameCount: 1,
      totalTimeLimitRetries: 1,
    });
    const recoveredSlowTicket = summary.tickets.find(
      (ticket) => ticket.kind === "slow_game"
    );
    expect(recoveredSlowTicket).toMatchObject({
      seed: 47,
      replayFile: expect.stringContaining(".attempt-00.jsonl.gz"),
      details: expect.objectContaining({
        initialMaxGameDurationMs: 1,
        effectiveMaxGameDurationMs: 2,
        recovered: true,
      }),
    });
    expect(summary.games[0]?.replayFile).toContain(".attempt-01.jsonl.gz");
    expect(summary.games[0]?.replayFile).not.toBe(
      recoveredSlowTicket?.replayFile
    );
    const recoveredElapsedAttempts = recoveredSlowTicket?.details
      .elapsedTimeAttempts as Array<{
      transitionSteps: number;
      replayFile: string;
      traceFile: string;
      framesFile: string;
    }>;
    expect(recoveredElapsedAttempts).toHaveLength(1);
    expect(recoveredElapsedAttempts[0]).toMatchObject({
      transitionSteps: recoveredSlowTicket?.transitionSteps,
      replayFile: recoveredSlowTicket?.replayFile,
    });
    await Promise.all(
      [
        recoveredElapsedAttempts[0]?.replayFile,
        recoveredElapsedAttempts[0]?.traceFile,
        recoveredElapsedAttempts[0]?.framesFile,
        summary.games[0]?.replayFile,
      ].map((file) => readEvidence(file!, "utf8"))
    );
  });

  it("resumes after a persistent elapsed cap and replaces only clean coverage", async () => {
    const outDir = await mkdtemp(
      join(tmpdir(), "orica-effect-time-replacement-")
    );
    const baseOptions = {
      games: 1,
      maxSteps: 1,
      maxGameDurationMs: 1,
      maxGameDurationRetries: 1,
      maxGameDurationMultiplier: 2,
      maxGameDurationCeilingMs: 2,
      seed: 53,
      maxGeneratedChoices: 16,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug-time-replacement",
      skipPreGame: true,
      agentA: "random" as const,
      agentB: "random" as const,
      wideChoiceThreshold: 0,
    };
    const elapsedClock = () => {
      let tick = 0;
      return () => tick++;
    };
    const first = await runEffectDebugHarvest({
      ...baseOptions,
      maxReplacementGames: 0,
      gameClockFactory: elapsedClock,
    });

    expect(first.aggregate).toMatchObject({
      attemptedGames: 1,
      qualifyingGames: 0,
      elapsedTimeReplacementCount: 1,
      retriedGameCount: 1,
      totalTimeLimitRetries: 1,
    });
    expect(first.games[0]).toMatchObject({
      seed: 53,
      outcome: "capped",
      terminationReason: "elapsed_time_limit",
      timeLimitRetryCount: 1,
      effectiveMaxGameDurationMs: 2,
    });
    const firstSlowTicket = first.tickets.find(
      (ticket) => ticket.kind === "slow_game"
    );
    expect(firstSlowTicket).toMatchObject({
      seed: 53,
      replayFile: expect.stringContaining(".attempt-01.jsonl.gz"),
      details: expect.objectContaining({ recovered: false }),
    });
    const persistentElapsedAttempts = firstSlowTicket?.details
      .elapsedTimeAttempts as Array<{
      attemptIndex: number;
      replayFile: string;
      traceFile: string;
      framesFile: string;
    }>;
    expect(persistentElapsedAttempts).toHaveLength(2);
    expect(
      persistentElapsedAttempts.map((attempt) => attempt.attemptIndex)
    ).toEqual([0, 1]);
    expect(firstSlowTicket?.replayFile).toBe(
      persistentElapsedAttempts.at(-1)?.replayFile
    );
    expect(
      new Set(persistentElapsedAttempts.map((attempt) => attempt.replayFile))
        .size
    ).toBe(2);
    await Promise.all(
      persistentElapsedAttempts.flatMap((attempt) =>
        [attempt.replayFile, attempt.traceFile, attempt.framesFile].map(
          (file) => readEvidence(file, "utf8")
        )
      )
    );
    expect(first.tickets.some((ticket) => ticket.kind === "capped")).toBe(true);
    expect(first.aggregate.coverage.choiceSurface.cappedGameCount).toBe(1);
    expect(first.aggregate.cleanCoverage).toMatchObject({
      semantic: {
        executedActionFrames: 0,
      },
      choiceSurface: {
        decisionFrames: 0,
        cappedGameCount: 0,
      },
    });

    const checkpointPath = join(outDir, "checkpoint.json");
    const firstGamePath = join(outDir, "games", "game-0000.json");
    const firstGameRecord = JSON.parse(
      await readEvidence(firstGamePath, "utf8")
    ) as {
      game: { durationMs: number; replayFile: string };
      coverage: unknown;
      tickets: Array<{ kind: string }>;
    };
    const cappedReplay = JSON.parse(
      await readEvidence(firstGameRecord.game.replayFile, "utf8")
    ) as {
      frames: Array<{ state?: unknown; label: string }>;
    };
    expect(cappedReplay.frames.at(-1)).toMatchObject({
      state: expect.any(Object),
      label: expect.stringContaining("final / capped"),
    });
    firstGameRecord.game.durationMs = -1;
    await writeFile(firstGamePath, JSON.stringify(firstGameRecord), "utf8");

    const resumedAttempts: Array<{
      gameIndex: number;
      seed: number;
      attemptIndex: number;
      maxDurationMs: number;
    }> = [];
    const resumed = await runEffectDebugHarvest({
      ...baseOptions,
      maxReplacementGames: 1,
      gameClockFactory: (context) => {
        resumedAttempts.push(context);
        return () => 0;
      },
    });
    const replacementRecord = JSON.parse(
      await readEvidence(join(outDir, "games", "game-0001.json"), "utf8")
    ) as { coverage: unknown };
    const resumedCheckpoint = JSON.parse(
      await readEvidence(checkpointPath, "utf8")
    ) as { completedGameIndexes: number[] };

    expect(resumedAttempts).toEqual([
      {
        gameIndex: 1,
        seed: (53 + 0x9e3779b9) >>> 0,
        attemptIndex: 0,
        maxDurationMs: 1,
      },
    ]);
    expect(resumed.games).toHaveLength(2);
    expect(resumed.games[0]?.durationMs).toBe(-1);
    expect(resumed.games[1]).toMatchObject({
      seed: (53 + 0x9e3779b9) >>> 0,
      terminationReason: "decision_limit",
      timeLimitRetryCount: 0,
    });
    expect(resumed.aggregate).toMatchObject({
      attemptedGames: 2,
      qualifyingGames: 1,
      elapsedTimeReplacementCount: 1,
      retriedGameCount: 1,
      totalTimeLimitRetries: 1,
    });
    expect(resumed.aggregate.cleanCoverage).toEqual(replacementRecord.coverage);
    expect(resumed.aggregate.coverage.choiceSurface.cappedGameCount).toBe(2);
    expect(resumed.aggregate.cleanCoverage.choiceSurface.cappedGameCount).toBe(
      1
    );
    expect(resumedCheckpoint.completedGameIndexes).toEqual([0, 1]);
    expect(
      resumed.tickets.find((ticket) => ticket.kind === "slow_game")
    ).toEqual(firstSlowTicket);
  });
  it("does not let elapsed-cap coverage demote cards in the replacement deck", async () => {
    const outDir = await mkdtemp(
      join(tmpdir(), "orica-effect-clean-guidance-")
    );
    const baseOptions = {
      games: 1,
      maxSteps: 1,
      maxGameDurationMs: 1,
      maxGameDurationRetries: 0,
      maxGameDurationMultiplier: 2,
      maxGameDurationCeilingMs: 2,
      seed: 61,
      maxGeneratedChoices: 16,
      deckSize: 12,
      deckStrategy: "coverage_guided" as const,
      focusCardCount: 4,
      outDir,
      experimentId: "test-effect-clean-guidance",
      skipPreGame: true,
      agentA: "random" as const,
      agentB: "random" as const,
      wideChoiceThreshold: 0,
    };
    const first = await runEffectDebugHarvest({
      ...baseOptions,
      maxReplacementGames: 0,
      gameClockFactory: () => {
        let tick = 0;
        return () => tick++;
      },
    });
    expect(first.games[0]).toMatchObject({
      outcome: "capped",
      terminationReason: "elapsed_time_limit",
    });

    const engine = createTrainingEngine();
    const replacementSeed = (61 + 0x9e3779b9) >>> 0;
    const focusedForCounts = (observedCardCounts: Record<string, number>) => {
      const rng = mulberry32(replacementSeed);
      const focusedCardNos: string[] = [];
      for (let seat = 0; seat < 2; seat += 1) {
        focusedCardNos.push(
          ...buildCoverageGuidedDeck(
            engine.cards,
            baseOptions.deckSize,
            rng,
            observedCardCounts,
            baseOptions.focusCardCount,
            (replacementSeed ^ Math.imul(seat + 1, 0x85ebca6b)) >>> 0
          ).focusedCardNos
        );
      }
      return [...new Set(focusedCardNos)].sort();
    };
    const expectedFocusedCardNos = focusedForCounts({});
    const elapsedOnlyCounts = Object.fromEntries(
      expectedFocusedCardNos.map((cardNo) => [cardNo, 1000])
    );
    expect(focusedForCounts(elapsedOnlyCounts)).not.toEqual(
      expectedFocusedCardNos
    );

    const elapsedGamePath = join(outDir, "games", "game-0000.json");
    const elapsedGameRecord = JSON.parse(
      await readEvidence(elapsedGamePath, "utf8")
    ) as {
      coverage: { semantic: { cards: Record<string, number> } };
    };
    elapsedGameRecord.coverage.semantic.cards = elapsedOnlyCounts;
    await writeFile(elapsedGamePath, JSON.stringify(elapsedGameRecord), "utf8");

    const resumed = await runEffectDebugHarvest({
      ...baseOptions,
      maxReplacementGames: 1,
      gameClockFactory: (context) => {
        expect(context.gameIndex).toBe(1);
        return () => 0;
      },
    });
    expect(resumed.games[1]).toMatchObject({
      terminationReason: "decision_limit",
      focusedCardNos: expectedFocusedCardNos,
    });
  });

  it("promotes a truncated choice surface immediately", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-truncated-"));
    const summary = await runEffectDebugHarvest({
      games: 1,
      maxSteps: 3,
      seed: 41,
      maxGeneratedChoices: 1,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug-truncated",
      skipPreGame: true,
      agentA: "random",
      agentB: "random",
      wideChoiceThreshold: 0,
    });
    expect(
      summary.aggregate.ticketCounts.truncated_choice_surface
    ).toBeGreaterThan(0);

    const persistedFrames = (
      await readEvidence(join(outDir, "frames.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            selected: {
              step: number;
              nodeKind: string;
              choiceId: string;
              fields: string[];
              truncated: boolean;
            };
          }
      );
    const firstTruncatedFrame = persistedFrames.find(
      (frame) => frame.selected.truncated
    );
    const truncatedTicket = summary.tickets.find(
      (ticket) => ticket.kind === "truncated_choice_surface"
    );
    expect(firstTruncatedFrame).toBeDefined();
    expect(persistedFrames.at(-1)?.selected.choiceId).not.toBe(
      firstTruncatedFrame?.selected.choiceId
    );
    expect(truncatedTicket).toMatchObject({
      step: firstTruncatedFrame?.selected.step,
      suspect: {
        nodeKind: firstTruncatedFrame?.selected.nodeKind,
        choiceId: firstTruncatedFrame?.selected.choiceId,
        fields: firstTruncatedFrame?.selected.fields,
      },
    });

    const { triageEffectDebugArtifacts } =
      await import("../../../scripts/effect-debug-triage.mjs");
    const triage = await triageEffectDebugArtifacts({
      dir: outDir,
      requestedGames: 1,
      minDecisionFrames: 0,
      minEffectDecisions: 0,
      minUniqueCards: 0,
    });
    expect(triage.status).toBe("promoted");
    expect(triage.tickets.promoted).toContainEqual(
      expect.objectContaining({ kind: "truncated_choice_surface" })
    );
  });

  it("loads an effect-debug JSON run config and lets CLI flags override it", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "orica-effect-config-"));
    const configPath = join(configDir, "effect-debug.config.json");
    const outDir = join(configDir, "effect-out");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "effect-debug-harvest",
        experimentId: "config-effect-debug",
        games: 1,
        maxSteps: 1,
        maxGameDurationMs: 2,
        maxGameDurationRetries: 0,
        maxGameDurationMultiplier: 2,
        maxGameDurationCeilingMs: 8,
        maxReplacementGames: 1,
        seed: 53,
        maxGeneratedChoices: 16,
        deckSize: 12,
        deckStrategy: "coverage_guided",
        focusCardCount: 2,
        skipPreGame: true,
        wideChoiceThreshold: 0,
        outDir: "effect-out",
        agents: {
          agentA: "heuristic",
          agentB: "random",
        },
      }),
      "utf8"
    );

    await runEffectDebugHarvestCli([
      "--config",
      configPath,
      "--agentA",
      "random",
    ]);

    const artifact = JSON.parse(
      await readEvidence(join(outDir, "metrics.json"), "utf8")
    ) as Awaited<ReturnType<typeof runEffectDebugHarvest>>;
    expect(artifact.experimentId).toBe("config-effect-debug");
    expect(artifact.outputDir).toBe(outDir);
    expect(artifact.config.configPath).toBe(configPath);
    expect(artifact.config.agentA).toBe("random");
    expect(artifact.config.agentB).toBe("random");
    expect(artifact.config.maxGameDurationMs).toBe(2);
    expect(artifact.config).toMatchObject({
      maxGameDurationRetries: 0,
      maxGameDurationCeilingMs: 8,
      maxReplacementGames: 1,
      deckStrategy: "coverage_guided",
      focusCardCount: 2,
    });
    expect(artifact.games[0]?.seatAgents).toEqual({
      alice: "random",
      bob: "random",
    });
    expect(artifact.games[0]?.focusedCardNos.length).toBeGreaterThan(0);
  });

  it("replays coverage-guided tickets from the cohort seed through the target game", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-debug-seat-"));

    const summary = await runEffectDebugHarvest({
      games: 2,
      maxSteps: 1,
      seed: 71,
      maxGeneratedChoices: 16,
      deckSize: 12,
      deckStrategy: "coverage_guided",
      focusCardCount: 4,
      outDir,
      experimentId: "test-effect-debug-seat",
      skipPreGame: false,
      agentA: "random",
      agentB: "heuristic",
      wideChoiceThreshold: 0,
    });

    expect(summary.games[1]?.seatAgents).toEqual({
      alice: "heuristic",
      bob: "random",
    });
    const ticketLines = jsonLines(
      await readEvidence(join(outDir, "tickets.jsonl"), "utf8")
    ) as Array<{ ticketId: string; rerunCommand: string }>;
    const gameOneTicket = ticketLines.find((t) =>
      t.ticketId.startsWith("EDH-0001-")
    );
    expect(gameOneTicket?.rerunCommand).toContain("--games 2");
    expect(gameOneTicket?.rerunCommand).toContain("--seed 71");
    expect(gameOneTicket?.rerunCommand).toContain("--agentA random");
    expect(gameOneTicket?.rerunCommand).toContain("--agentB heuristic");

    const rerun = await runEffectDebugHarvest({
      games: 2,
      maxSteps: 1,
      seed: 71,
      maxGeneratedChoices: 16,
      deckSize: 12,
      deckStrategy: "coverage_guided",
      focusCardCount: 4,
      outDir: await mkdtemp(join(tmpdir(), "orica-effect-debug-rerun-")),
      experimentId: "test-effect-debug-seat-rerun",
      skipPreGame: false,
      agentA: "random",
      agentB: "heuristic",
      wideChoiceThreshold: 0,
    });
    expect(rerun.games[1]?.focusedCardNos).toEqual(
      summary.games[1]?.focusedCardNos
    );
    expect(rerun.games[1]?.seatAgents).toEqual(summary.games[1]?.seatAgents);

    const replay = JSON.parse(
      await readEvidence(summary.games[1]!.replayFile, "utf8")
    ) as {
      frames: Array<{
        state: {
          cardInstances: Array<{ definitionId: string; zone: string }>;
        };
      }>;
    };
    const engine = createTrainingEngine();
    const initialHandCardNos = new Set(
      replay.frames[0]!.state.cardInstances.flatMap((card) => {
        const cardNo = engine.getCardDefinitionById(card.definitionId)?.cardNo;
        return card.zone === "hand" && cardNo ? [cardNo] : [];
      })
    );
    expect(summary.games[1]?.focusedCardNos.length).toBeGreaterThan(0);
    expect(
      summary.games[1]?.focusedCardNos.some((cardNo) => {
        const definition = engine.getCardDefinitionById(cardNo);
        return definition ? isContractDefinition(definition) : false;
      })
    ).toBe(true);
    expect(
      summary.games[1]?.focusedCardNos.every((cardNo) =>
        initialHandCardNos.has(cardNo)
      )
    ).toBe(true);
  });

  it("runs a learned policy from a hashed checkpoint and records it in reruns", async () => {
    const root = await mkdtemp(join(tmpdir(), "orica-effect-policy-"));
    const policyCheckpointPath = join(root, "policy.json");
    const training = await runPolicyBootstrap({
      games: 1,
      maxSteps: 8,
      seed: 73,
      maxGeneratedChoices: 16,
      deckSize: 12,
      hiddenDim: 16,
      batchSize: 8,
      outDir: join(root, "training"),
      experimentId: "test-effect-policy-training",
      skipPreGame: true,
      dryRun: false,
      checkpointOut: policyCheckpointPath,
    });
    if (!training.checkpoint.written) {
      throw new Error("test setup did not write a policy checkpoint");
    }

    const summary = await runEffectDebugHarvest({
      games: 1,
      maxSteps: 1,
      seed: 79,
      maxGeneratedChoices: 16,
      deckSize: 12,
      outDir: join(root, "harvest"),
      experimentId: "test-effect-policy-agent",
      skipPreGame: true,
      agentA: "policy",
      agentB: "heuristic",
      wideChoiceThreshold: 0,
      policyCheckpointPath,
      policyExplorationRate: 0.2,
    });

    expect(summary.config).toMatchObject({
      agentA: "policy",
      agentB: "heuristic",
      policyCheckpointPath,
      policyCheckpointSha256: training.checkpoint.sha256,
      policyExplorationRate: 0.2,
    });
    expect(summary.games[0]?.seatAgents).toEqual({
      alice: "policy",
      bob: "heuristic",
    });
    expect(summary.tickets[0]?.rerunCommand).toContain(
      `--policyCheckpoint ${JSON.stringify(policyCheckpointPath)}`
    );
    expect(summary.tickets[0]?.rerunCommand).toContain(
      "--policyExplorationRate 0.2"
    );
  });

  it("resumes a durable checkpoint without duplicating completed games", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-debug-resume-"));
    const options = {
      games: 2,
      maxSteps: 1,
      maxReplacementGames: 0,
      seed: 89,
      maxGeneratedChoices: 16,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug-resume",
      skipPreGame: true,
      agentA: "random" as const,
      agentB: "random" as const,
      wideChoiceThreshold: 0,
    };

    await runEffectDebugHarvest(options);
    const firstTrace = await readEvidence(join(outDir, "trace.jsonl"), "utf8");
    const checkpointPath = join(outDir, "checkpoint.json");
    const checkpoint = JSON.parse(
      await readEvidence(checkpointPath, "utf8")
    ) as {
      completedGameIndexes: number[];
    };
    const completedGamePath = join(outDir, "games", "game-0000.json");
    const completedGame = JSON.parse(
      await readEvidence(completedGamePath, "utf8")
    ) as { game: { durationMs: number } };
    // A sentinel makes this a real partial-resume assertion: game 0 must be
    // preserved, while game 1 is rebuilt from the durable ledger.
    completedGame.game.durationMs = -1;
    checkpoint.completedGameIndexes = [0];
    await writeFile(completedGamePath, JSON.stringify(completedGame), "utf8");
    await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8");
    await rm(join(outDir, "games", "game-0001.json"));

    const resumed = await runEffectDebugHarvest({
      ...options,
      maxReplacementGames: 1,
    });
    const resumedTrace = await readEvidence(
      join(outDir, "trace.jsonl"),
      "utf8"
    );
    const resumedCheckpoint = JSON.parse(
      await readEvidence(checkpointPath, "utf8")
    ) as { completedGameIndexes: number[] };

    expect(resumed.games).toHaveLength(2);
    expect(resumed.games[0]?.durationMs).toBe(-1);
    expect(resumedTrace).toBe(firstTrace);
    expect(resumedCheckpoint.completedGameIndexes).toEqual([0, 1]);
    expect(resumed.config.maxReplacementGames).toBe(1);
  });

  it("does not count a forced terminal transition as policy-controlled", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-effect-debug-final-"));
    const summary = await runEffectDebugHarvest({
      games: 1,
      // Exercise real terminal-transition accounting with a small deterministic
      // random game. Tree-search cost is unrelated to the accounting assertions
      // and makes this fixture depend on the CI host's available CPU.
      maxSteps: 160,
      seed: 2028305019,
      maxGeneratedChoices: 16,
      deckSize: 12,
      outDir,
      experimentId: "test-effect-debug-final-policy-decision",
      skipPreGame: true,
      agentA: "random",
      agentB: "random",
      wideChoiceThreshold: 128,
    });

    const game = summary.games[0]!;
    const replay = JSON.parse(await readEvidence(game.replayFile, "utf8")) as {
      frames: Array<{
        traceEntry?: { step: number; choiceCount: number; truncated: boolean };
      }>;
    };
    const policyTransitionSteps = new Set(
      replay.frames.flatMap((frame) => {
        const entry = frame.traceEntry;
        return entry && (entry.choiceCount > 1 || entry.truncated)
          ? [entry.step]
          : [];
      })
    );
    const finalTransition = replay.frames.at(-2)?.traceEntry;

    expect(game.outcome).toBe("natural");
    expect(finalTransition).toMatchObject({ choiceCount: 1, truncated: false });
    expect(policyTransitionSteps.has(finalTransition!.step)).toBe(false);
    expect(game.decisionSteps).toBeGreaterThan(0);
    expect(game.transitionSteps).toBeGreaterThan(game.decisionSteps);
    expect(policyTransitionSteps.size).toBe(game.decisionSteps);
    expect(game.steps).toBe(game.transitionSteps);
    expect(summary.aggregate.totalSteps).toBe(game.transitionSteps);
    expect(summary.aggregate.totalDecisionSteps).toBe(game.decisionSteps);
    expect(summary.aggregate.totalTransitionSteps).toBe(game.transitionSteps);
  });
});
