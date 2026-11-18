import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  runRolloutBaseline,
  runRolloutBaselineCli,
} from "../src/rollout-baseline";

describe("rollout-baseline CLI runner", () => {
  it("runs non-learning random/heuristic evaluation with alternating seats", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-rollout-baseline-"));

    const summary = await runRolloutBaseline({
      games: 2,
      maxSteps: 24,
      seed: 11,
      maxGeneratedChoices: 64,
      outDir,
      experimentId: "test-rollout-baseline",
      agentA: "random",
      agentB: "heuristic",
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.profile).toBe("rollout-baseline");
    expect(summary.config.agentA).toBe("random");
    expect(summary.config.agentB).toBe("heuristic");
    expect(summary.config.commitHash).toMatch(/^(unknown|[0-9a-f]{12})$/);
    expect(summary.aggregate.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.games).toHaveLength(2);
    expect(summary.games[0]?.seatAgents).toEqual({
      alice: "random",
      bob: "heuristic",
    });
    expect(summary.games[1]?.seatAgents).toEqual({
      alice: "heuristic",
      bob: "random",
    });
    expect(summary.aggregate.totalTraceEntries).toBeGreaterThan(0);

    const artifact = JSON.parse(
      await readFile(join(outDir, "baseline.json"), "utf8")
    ) as typeof summary;
    expect(artifact.experimentId).toBe("test-rollout-baseline");
    expect(artifact.games[0]?.seed).toBe(summary.games[0]?.seed);
  });

  it("loads a JSON run config and lets CLI flags override it", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "orica-baseline-config-"));
    const configPath = join(configDir, "baseline.config.json");
    const outDir = join(configDir, "baseline-out");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "rollout-baseline",
        experimentId: "config-rollout-baseline",
        games: 2,
        maxSteps: 20,
        seed: 23,
        maxGeneratedChoices: 32,
        deckSize: 12,
        outDir: "baseline-out",
        agents: {
          agentA: "heuristic",
          agentB: "random",
        },
      }),
      "utf8"
    );

    await runRolloutBaselineCli(["--config", configPath, "--agentA", "random"]);

    const artifact = JSON.parse(
      await readFile(join(outDir, "baseline.json"), "utf8")
    ) as Awaited<ReturnType<typeof runRolloutBaseline>>;
    expect(artifact.experimentId).toBe("config-rollout-baseline");
    expect(artifact.outputDir).toBe(outDir);
    expect(artifact.config.configPath).toBe(configPath);
    expect(artifact.config.agentA).toBe("random");
    expect(artifact.config.agentB).toBe("random");
    expect(artifact.games[0]?.seatAgents).toEqual({
      alice: "random",
      bob: "random",
    });
  });

  it("accepts MCTS as a non-learning baseline agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-rollout-mcts-"));

    const summary = await runRolloutBaseline({
      games: 1,
      maxSteps: 8,
      seed: 31,
      maxGeneratedChoices: 32,
      deckSize: 12,
      outDir,
      experimentId: "test-rollout-mcts",
      skipPreGame: true,
      agentA: "mcts",
      agentB: "random",
    });

    expect(summary.config.agentA).toBe("mcts");
    expect(summary.config.agentB).toBe("random");
    expect(summary.games[0]?.seatAgents).toEqual({
      alice: "mcts",
      bob: "random",
    });
    expect(summary.aggregate.agentWins).toHaveProperty("mcts");
  });
});
