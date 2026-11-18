import "./artifact-free-space-fixture";

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  runPositionBiasDiagnose,
  runPositionBiasDiagnoseCli,
} from "../src/position-bias-diagnose";
import { writeDeckSelectionFixture } from "./deck-selection-fixture";

describe("position-bias diagnose runner", () => {
  it("writes cohorts and swaps the same paired decks across seats", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-position-bias-"));

    const summary = await runPositionBiasDiagnose({
      games: 2,
      maxSteps: 12,
      seed: 47,
      maxGeneratedChoices: 32,
      deckSize: 12,
      outDir,
      experimentId: "test-position-bias",
      skipPreGame: true,
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.profile).toBe("position-bias-diagnose");
    expect(summary.config.agent).toBe("random");
    expect(summary.cohorts.map((cohort) => cohort.cohort)).toEqual([
      "random_decks",
      "mirror_deck",
      "paired_deck_swap",
    ]);
    expect(summary.games).toHaveLength(6);
    expect(summary.ruleReference.path).toContain("02_turn-flow-and-timing.md");

    const paired = summary.games.filter(
      (game) => game.cohort === "paired_deck_swap"
    );
    expect(paired).toHaveLength(2);
    expect(paired[0]?.pairingIndex).toBe(0);
    expect(paired[1]?.pairingIndex).toBe(0);
    expect(paired[0]?.swappedDeckSeats).toBe(false);
    expect(paired[1]?.swappedDeckSeats).toBe(true);
    expect(paired[0]?.deckSeed).toBe(paired[1]?.deckSeed);
    expect(paired[0]?.deckSignature.alice).toBe(paired[1]?.deckSignature.bob);
    expect(paired[0]?.deckSignature.bob).toBe(paired[1]?.deckSignature.alice);

    const artifact = JSON.parse(
      await readFile(join(outDir, "position-bias.json"), "utf8")
    ) as Awaited<ReturnType<typeof runPositionBiasDiagnose>>;
    expect(artifact.experimentId).toBe("test-position-bias");
    expect(artifact.games).toHaveLength(6);
  });

  it("loads a JSON run config and lets CLI flags override it", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "orica-bias-config-"));
    const configPath = join(configDir, "bias.config.json");
    const outDir = join(configDir, "bias-out");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "position-bias-diagnose",
        experimentId: "config-position-bias",
        games: 1,
        maxSteps: 16,
        seed: 53,
        maxGeneratedChoices: 32,
        deckSize: 12,
        skipPreGame: true,
        outDir: "bias-out",
        agents: { agentA: "random" },
      }),
      "utf8"
    );

    await runPositionBiasDiagnoseCli([
      "--config",
      configPath,
      "--games",
      "2",
      "--agent",
      "heuristic",
      "--mctsIterations",
      "2",
      "--mctsRolloutDepth",
      "3",
    ]);

    const artifact = JSON.parse(
      await readFile(join(outDir, "position-bias.json"), "utf8")
    ) as Awaited<ReturnType<typeof runPositionBiasDiagnose>>;
    expect(artifact.experimentId).toBe("config-position-bias");
    expect(artifact.outputDir).toBe(outDir);
    expect(artifact.config.configPath).toBe(configPath);
    expect(artifact.config.games).toBe(2);
    expect(artifact.config.agent).toBe("heuristic");
    expect(artifact.config.mctsIterations).toBe(2);
    expect(artifact.config.mctsRolloutDepth).toBe(3);
    expect(artifact.games).toHaveLength(6);
  });

  it("uses selected gauntlet decks for mirror and paired-swap cohorts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "orica-bias-decks-"));
    const deckSelectionPath = await writeDeckSelectionFixture(outDir);

    const summary = await runPositionBiasDiagnose({
      games: 2,
      maxSteps: 8,
      seed: 61,
      maxGeneratedChoices: 32,
      deckSize: 12,
      outDir: join(outDir, "run"),
      experimentId: "test-position-bias-selected-decks",
      skipPreGame: true,
      deckSelectionPath,
      deckSet: "gauntletCore",
    });

    expect(summary.config.deckSource).toBe("selection");
    expect(summary.deckPool?.setName).toBe("gauntletCore");
    const mirror = summary.games.find((game) => game.cohort === "mirror_deck");
    expect(mirror?.decks.alice?.id).toBe(mirror?.decks.bob?.id);
    expect(mirror?.deckSignature.alice).toBe(mirror?.deckSignature.bob);

    const paired = summary.games.filter(
      (game) => game.cohort === "paired_deck_swap"
    );
    expect(paired[0]?.deckSource).toBe("selection");
    expect(paired[0]?.decks.alice?.id).toBe(paired[1]?.decks.bob?.id);
    expect(paired[0]?.decks.bob?.id).toBe(paired[1]?.decks.alice?.id);
    expect(paired[0]?.deckSignature.alice).toBe(paired[1]?.deckSignature.bob);
    expect(paired[0]?.deckSignature.bob).toBe(paired[1]?.deckSignature.alice);
  });
});
