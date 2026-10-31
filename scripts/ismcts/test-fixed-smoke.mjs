import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixedSmokeInput,
  smokeLimits,
  projectSmokeResult,
  playFixedSmokeGame,
  readFixedSmokeResult,
  fixedSmokeExitCode,
} from "./fixed-smoke.mjs";
import {
  withFixedDeckCatalog,
  resolveFixedDecks,
  readFixedDeckManifest,
  fixedEvaluationGames,
} from "./fixed-decks.mjs";

export async function testFixedSmoke() {
  let completed = 0;
  const check = (name, fn) => {
    fn();
    console.log(`fixed-smoke ok ${++completed} - ${name}`);
  };
  const input = fixedSmokeInput(0);
  const natural = {
    outcome: "natural",
    winner: "alice",
    decisionSteps: 20,
    transitionSteps: 50,
  };
  check(
    "caps, errors and truncated games cannot become completed results",
    () => {
      for (const outcome of ["capped", "error", "stuck"]) {
        const result = projectSmokeResult(
          input,
          { ...natural, outcome, winner: null },
          5,
          0
        );
        assert.equal(result.completed, 0);
        assert.equal(result.attempted, 1);
        assert.equal(result.provesSearchCalibration, false);
        assert.equal(result.failed, outcome === "capped" ? 0 : 1);
      }
      assert.equal(projectSmokeResult(input, natural, 5, 1).completed, 0);
      assert.equal(projectSmokeResult(input, natural, 60001, 0).completed, 0);
      const result = projectSmokeResult(input, natural, 5, 0);
      assert.equal(result.completed, 1);
      assert.equal(result.provesRuntimeAcceptance, false);
      assert.equal(
        fixedSmokeExitCode({
          execution: { status: "completed" },
          game: { result },
        }),
        2
      );
      assert.equal(fixedSmokeExitCode({ status: "deferred_load" }), 2);
      assert.equal(fixedSmokeExitCode({ execution: { status: "stopped" } }), 1);
      assert.equal(
        fixedSmokeExitCode({
          execution: { status: "completed" },
          game: { result: { failed: 1 } },
        }),
        1
      );
    }
  );
  check("invalid indices and fabricated counters fail closed", () => {
    for (const index of [-1, 16, 0.1, "0", NaN])
      assert.throws(() => fixedSmokeInput(index), /index/);
    for (const extra of [
      { decisionSteps: 121 },
      { transitionSteps: -1 },
      { winner: "secret" },
      { outcome: "capped" },
      { terminationReason: "secret" },
    ])
      assert.throws(
        () => projectSmokeResult(input, { ...natural, ...extra }, 5, 0),
        /invalid/
      );
  });
  check(
    "projection drops raw state and exception hooks without serializing them",
    () => {
      let called = 0;
      const game = {
        ...natural,
        finalState: { secret: "SMOKE-CANARY" },
        lastError: "SMOKE-CANARY",
        toJSON() {
          called++;
          throw new Error();
        },
      };
      assert.equal(
        JSON.stringify(projectSmokeResult(input, game, 5, 0)).includes(
          "SMOKE-CANARY"
        ),
        false
      );
      assert.equal(called, 0);
    }
  );
  check(
    "nested managed readback rejects missing, replaced, forged and escaping results",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "orica-fixed-smoke-"));
      const id = "11111111-1111-4111-8111-111111111111";
      const destination = join(directory, "managed-output", id);
      try {
        assert.throws(() => readFixedSmokeResult(directory, id, 0), /ENOENT/);
        assert.throws(
          () => readFixedSmokeResult(directory, "../escape", 0),
          /identity/
        );
        mkdirSync(destination, { recursive: true });
        const file = join(destination, "artifact-fixed-smoke-result.bin");
        const value = projectSmokeResult(input, natural, 5, 0);
        writeFileSync(file, JSON.stringify(value));
        assert.deepEqual(readFixedSmokeResult(directory, id, 0).result, value);
        assert.throws(() => readFixedSmokeResult(directory, id, 1), /differs/);
        for (const mutate of [
          (v) => v.completed++,
          (v) => v.input.seed++,
          (v) => v.limits.maxDecisions++,
          (v) => (v.secret = "SMOKE-CANARY"),
        ]) {
          const altered = JSON.parse(JSON.stringify(value));
          mutate(altered);
          writeFileSync(file, JSON.stringify(altered));
          assert.throws(
            () => readFixedSmokeResult(directory, id, 0),
            /differs/
          );
        }
      } finally {
        assert.ok(directory.startsWith(join(tmpdir(), "orica-fixed-smoke-")));
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
  await withFixedDeckCatalog((catalog) => {
    const pool = resolveFixedDecks(readFixedDeckManifest(), catalog);
    const scheduled = fixedEvaluationGames(pool, "smoke");
    check(
      "each standalone game preserves the frozen pair, seed and both seats",
      () => {
        for (let i = 0; i < 16; i++) {
          const game = fixedSmokeInput(i);
          for (const key of ["id", "decks", "seed", "seat"])
            assert.deepEqual(game[key], scheduled[i][key]);
          assert.throws(() => game.decks.pop(), TypeError);
        }
      }
    );
    check(
      "workload forwards bounded full pregame and counts incomplete surfaces",
      () => {
        let calls = 0;
        const telemetry = new catalog.core.AiWorkTelemetry();
        const result = playFixedSmokeGame(
          {
            ...catalog,
            core: {
              ...catalog.core,
              playTrainingTraceSmoke(options) {
                calls++;
                assert.equal(options.telemetry, telemetry);
                assert.equal(options.maxSteps, 120);
                assert.equal(options.maxDurationMs, 60000);
                assert.equal(options.maxForcedTransitions, 256);
                assert.equal(options.skipPreGame, false);
                assert.equal(options.recording.retainFrames, false);
                assert.equal(options.recording.retainReplay, false);
                assert.deepEqual(
                  options.decks.map((deck) => deck.map((card) => card.cardNo)),
                  input.decks.map(
                    (id) => pool.decks.find((deck) => deck.id === id).cardNos
                  )
                );
                const forbidden = new Proxy(
                  {},
                  {
                    get() {
                      throw new Error("raw state access");
                    },
                  }
                );
                const choices = [{ id: "first" }, { id: "second" }];
                for (const policy of Object.values(options.policies)) {
                  assert.equal(
                    policy(forbidden, { choices }, forbidden, () => 0),
                    choices[0]
                  );
                  assert.equal(
                    policy(forbidden, { choices }, forbidden, () => 0.75),
                    choices[1]
                  );
                }
                options.recording.onFrame({ node: { truncated: true } });
                return natural;
              },
            },
          },
          0,
          telemetry
        );
        assert.equal(calls, smokeLimits.games);
        assert.equal(result.truncatedNodes, 1);
        assert.equal(result.completed, 0);
      }
    );
  });
  return { completed };
}
