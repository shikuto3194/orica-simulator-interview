import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { AI_OBSERVATION_SCHEMA_VERSION } from "@orica/rules-core";

import { validateTraceSmokeOutput } from "../src/trace-artifacts";
import { runTraceSmoke, runTraceSmokeCli } from "../src/trace-smoke";

describe("trace-smoke CLI runner", () => {
  it("writes metrics, replay, trace, and observation frames without training", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-trace-smoke-"));

    const summary = await runTraceSmoke({
      games: 1,
      maxSteps: 24,
      seed: 7,
      maxGeneratedChoices: 64,
      outDir,
      experimentId: "test-trace-smoke",
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.profile).toBe("trace-smoke");
    expect(summary.config.games).toBe(1);
    expect(summary.config.commitHash).toMatch(/^(unknown|[0-9a-f]{12})$/);
    expect(summary.aggregate.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.aggregate.totalDecisionFrames).toBeGreaterThan(0);
    expect(summary.games[0]?.replayFile).toBe(join(outDir, "replay.json"));
    expect(summary.replayBuffer.file).toBe(join(outDir, "replay-buffer.jsonl"));
    expect(summary.replayBuffer.sampleCount).toBe(
      summary.aggregate.totalDecisionFrames
    );

    const metrics = JSON.parse(
      await readFile(join(outDir, "metrics.json"), "utf8")
    ) as typeof summary;
    expect(metrics.experimentId).toBe("test-trace-smoke");
    expect(metrics.aggregate.totalTraceEntries).toBe(
      summary.aggregate.totalTraceEntries
    );

    const replay = JSON.parse(
      await readFile(join(outDir, "replay.json"), "utf8")
    ) as { frames: Array<{ state?: unknown; traceEntry?: unknown }> };
    expect(replay.frames.length).toBeGreaterThan(0);
    expect(replay.frames[0]?.state).toBeDefined();

    const traceLines = (await readFile(join(outDir, "trace.jsonl"), "utf8"))
      .trim()
      .split(/\r?\n/);
    expect(traceLines.length).toBe(summary.aggregate.totalTraceEntries);

    const frameLines = (await readFile(join(outDir, "frames.jsonl"), "utf8"))
      .trim()
      .split(/\r?\n/);
    expect(frameLines.length).toBe(summary.aggregate.totalDecisionFrames);
    const firstFrame = JSON.parse(frameLines[0]!) as {
      state?: unknown;
      stateHash?: string;
      observation?: { schemaVersion?: number; cards?: unknown[] };
      node?: { choices?: unknown[] };
      selected?: { choiceId?: string };
    };
    expect(firstFrame.state).toBeUndefined();
    expect(firstFrame.stateHash).toMatch(/^[0-9a-f]{8}$/);
    expect(firstFrame.observation?.schemaVersion).toBe(
      AI_OBSERVATION_SCHEMA_VERSION
    );
    expect(firstFrame.node?.choices?.length).toBeGreaterThan(0);
    expect(firstFrame.selected?.choiceId).toBeTruthy();

    const replaySampleLines = (
      await readFile(join(outDir, "replay-buffer.jsonl"), "utf8")
    )
      .trim()
      .split(/\r?\n/);
    expect(replaySampleLines.length).toBe(
      summary.aggregate.totalDecisionFrames
    );
    const firstSample = JSON.parse(replaySampleLines[0]!) as {
      schemaVersion?: number;
      state?: unknown;
      observation?: { schemaVersion?: number };
      node?: { choices?: Array<{ choiceId?: string }> };
      selected?: { choiceId?: string };
      policyTarget?: {
        selectedChoiceId?: string;
        selectedChoiceIndex?: number;
        choiceCount?: number;
        distribution?: number[];
      };
      weights?: { policy?: number; value?: number };
      truncated?: boolean;
    };
    expect(firstSample.schemaVersion).toBe(1);
    expect(firstSample.state).toBeUndefined();
    expect(firstSample.observation?.schemaVersion).toBe(
      AI_OBSERVATION_SCHEMA_VERSION
    );
    expect(firstSample.policyTarget?.selectedChoiceId).toBe(
      firstSample.selected?.choiceId
    );
    expect(firstSample.policyTarget?.choiceCount).toBe(
      firstSample.node?.choices?.length
    );
    expect(
      firstSample.policyTarget?.distribution?.reduce(
        (sum, value) => sum + value,
        0
      )
    ).toBe(1);
    expect(
      firstSample.node?.choices?.[
        firstSample.policyTarget?.selectedChoiceIndex ?? -1
      ]?.choiceId
    ).toBe(firstSample.policyTarget?.selectedChoiceId);
    expect(firstSample.weights?.policy).toBe(firstSample.truncated ? 0 : 1);

    const validation = await validateTraceSmokeOutput(outDir);
    expect(validation.issueCount).toBe(0);
    expect(validation.frameCount).toBe(summary.aggregate.totalDecisionFrames);
    expect(validation.replaySampleCount).toBe(
      summary.aggregate.totalDecisionFrames
    );
    // Containers retain their own v1 schema. Only the nested raw observation
    // changed: a saved v1 observation cannot recover the public contract fact.
    for (const [file, lines] of [
      ["frames.jsonl", frameLines],
      ["replay-buffer.jsonl", replaySampleLines],
    ] as const) {
      const first = JSON.parse(lines[0]!);
      first.observation.schemaVersion = 1;
      await writeFile(
        join(outDir, file),
        [JSON.stringify(first), ...lines.slice(1)].join("\n") + "\n",
        "utf8"
      );
      const rejected = await validateTraceSmokeOutput(outDir);
      expect(rejected.issues).toEqual([
        {
          path: `${join(outDir, file)}:1.observation.schemaVersion`,
          message: `must be ${AI_OBSERVATION_SCHEMA_VERSION}`,
        },
      ]);
      await writeFile(join(outDir, file), lines.join("\n") + "\n", "utf8");
    }
    expect((await validateTraceSmokeOutput(outDir)).issueCount).toBe(0);
  });

  it("loads a JSON run config and lets CLI flags override it", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "orica-trace-config-"));
    const configPath = join(configDir, "trace.config.json");
    const outDir = join(configDir, "trace-out");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "trace-smoke",
        experimentId: "config-trace-smoke",
        games: 1,
        maxSteps: 16,
        seed: 19,
        maxGeneratedChoices: 32,
        deckSize: 12,
        outDir: "trace-out",
      }),
      "utf8"
    );

    await runTraceSmokeCli(["--config", configPath, "--maxSteps", "8"]);

    const metrics = JSON.parse(
      await readFile(join(outDir, "metrics.json"), "utf8")
    ) as Awaited<ReturnType<typeof runTraceSmoke>>;
    expect(metrics.experimentId).toBe("config-trace-smoke");
    expect(metrics.outputDir).toBe(outDir);
    expect(metrics.config.configPath).toBe(configPath);
    expect(metrics.config.maxSteps).toBe(8);
    expect(metrics.config.deckSize).toBe(12);
  });
});
