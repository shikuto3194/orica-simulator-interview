// One bounded engine game through the existing shared reservation and Windows
// scheduler. This is a decision-surface baseline, not ISMCTS/calibration acceptance.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { programPaths, hash, safePath } from "./shared.mjs";
import {
  runObservedReservedJob,
  observeReservedWindowsJob,
  telemetryPersistenceMs,
} from "./runtime-telemetry.mjs";
import { executeOwnedWindowsJob } from "./windows-budget-admission.mjs";
import { checkIsmctsStorageAdmission } from "./storage-admission.mjs";
import { writeReservedArtifact } from "./managed-output.mjs";
import { createCallerMeter, callerCutoff } from "./caller-meter.mjs";
import { budgetStatus } from "./budget.mjs";
import { bindWindowsServiceReader } from "./windows-service-state.mjs";
import {
  readFixedDeckManifest,
  fixedDeckManifestHash,
  resolveFixedDecks,
  fixedEvaluationSchedule,
} from "./fixed-decks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const smokeLimits = Object.freeze({
  threads: 1,
  games: 1,
  maxDecisions: 120,
  maxDurationMs: 60000,
  maxForcedTransitions: 256,
  // Includes admission, native compile, thirty-second load recovery and output.
  wallMs: 600000,
  outputBytes: 1024 * 1024,
});

export function fixedSmokeInput(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 16)
    throw new Error("invalid fixed smoke game index");
  const game = fixedEvaluationSchedule("smoke")[index];
  return Object.freeze({
    id: game.id,
    seed: game.seed,
    seat: game.seat,
    decks: game.decks,
    manifestHash: fixedDeckManifestHash,
  });
}

// Allowlist all persisted fields. Never serialize state, choices, environment,
// exception text, or objects supplied by the game engine.
export function projectSmokeResult(input, result, durationMs, truncatedNodes) {
  if (
    !["natural", "capped", "stuck", "error"].includes(result?.outcome) ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    !Number.isSafeInteger(result.decisionSteps) ||
    result.decisionSteps < 0 ||
    result.decisionSteps > smokeLimits.maxDecisions ||
    !Number.isSafeInteger(result.transitionSteps) ||
    result.transitionSteps < 0 ||
    !Number.isSafeInteger(truncatedNodes) ||
    truncatedNodes < 0 ||
    ![null, "alice", "bob"].includes(result.winner) ||
    (result.outcome !== "natural" && result.winner !== null)
  )
    throw new Error("invalid bounded smoke result");
  const terminationReason = result.terminationReason ?? null;
  if (
    ![
      null,
      "decision_limit",
      "elapsed_time_limit",
      "forced_transition_limit",
      "repeated_state",
      "advance_error",
    ].includes(terminationReason)
  )
    throw new Error("invalid smoke termination reason");
  return {
    schemaVersion: 1,
    kind: "i0-fixed-engine-smoke",
    input,
    limits: smokeLimits,
    agent: "uniform-training-decision-baseline",
    outcome: result.outcome,
    winner: result.winner,
    terminationReason,
    decisionSteps: result.decisionSteps,
    transitionSteps: result.transitionSteps,
    durationMs,
    truncatedNodes,
    attempted: 1,
    completed:
      result.outcome === "natural" &&
      truncatedNodes === 0 &&
      durationMs <= smokeLimits.maxDurationMs
        ? 1
        : 0,
    failed: ["stuck", "error"].includes(result.outcome) ? 1 : 0,
    capped: result.outcome === "capped" ? 1 : 0,
    deferred: 0,
    provesRuntimeAcceptance: false,
    provesSearchCalibration: false,
    provesStrength: false,
  };
}

// Trusted catalog seam, also used by bounded regression fixtures. Re-read the
// frozen input; only the explicitly projected result leaves the game.
export function playFixedSmokeGame(catalog, index, telemetry) {
  const input = fixedSmokeInput(index);
  const pool = resolveFixedDecks(readFixedDeckManifest(), catalog);
  const decks = input.decks.map((deckId) => [
    ...pool.decks.find((d) => d.id === deckId).cards,
  ]);
  let truncatedNodes = 0;
  const started = performance.now();
  const policy = (_state, node, _engine, rng) =>
    node.choices[Math.floor(rng() * node.choices.length)];
  const game = catalog.core.playTrainingTraceSmoke({
    engine: catalog.engine,
    ...(telemetry ? { telemetry } : {}),
    decks,
    rng: catalog.core.mulberry32(input.seed),
    policies: { alice: policy, bob: policy },
    maxSteps: smokeLimits.maxDecisions,
    maxDurationMs: smokeLimits.maxDurationMs,
    maxForcedTransitions: smokeLimits.maxForcedTransitions,
    skipPreGame: false,
    recording: {
      retainFrames: false,
      retainReplay: false,
      onFrame(frame) {
        if (frame.node.truncated) truncatedNodes++;
      },
    },
  });
  return projectSmokeResult(
    input,
    game,
    performance.now() - started,
    truncatedNodes
  );
}

export function readFixedSmokeResult(directory, id, index) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
    throw new Error("invalid fixed smoke reservation identity");
  const input = fixedSmokeInput(index);
  const file = safePath(
    resolve(directory, "managed-output", id, "artifact-fixed-smoke-result.bin")
  );
  const bytes = readFileSync(file);
  const value = JSON.parse(bytes);
  const projected = projectSmokeResult(
    input,
    value,
    value.durationMs,
    value.truncatedNodes
  );
  if (JSON.stringify(value) !== JSON.stringify(projected))
    throw new Error("fixed smoke output differs from validated projection");
  return { path: file, sha256: hash(bytes), result: projected };
}

export async function runFixedDeckSmoke(index = 0) {
  const callerMeter = createCallerMeter();
  if (process.platform !== "win32")
    throw new Error("fixed smoke Windows runtime unavailable");
  fixedSmokeInput(index);
  const directory = programPaths(root).shared;
  const admit = (bytes) => checkIsmctsStorageAdmission(root, bytes);
  const result = await runObservedReservedJob(
    directory,
    {
      module: resolve(root, "scripts/ismcts/fixed-smoke-admission-worker.mjs"),
      args: [String(index)],
      cwd: root,
      threads: smokeLimits.threads,
      wallMs: smokeLimits.wallMs,
      outputBytes: smokeLimits.outputBytes,
    },
    { serviceBusy: false },
    admit,
    async (owned, controls, reservation) => {
      return executeOwnedWindowsJob(
        {
          ...owned,
          args: [String(index), reservation.id, reservation.owner],
        },
        controls,
        reservation
      );
    },
    callerMeter
  );
  if (!result.reservation) return result;
  // Only a completed/drained root may supply a normal game result. Missing,
  // stopped or malformed output is retained as an incomplete attempt.
  let game = null;
  if (result.execution?.status === "completed") {
    game = readFixedSmokeResult(directory, result.reservation.id, index);
  }
  return { ...result, game };
}

// Trusted continuation shared by the fixed worker and private OS regressions.
// The public worker fixes the real directory, storage check and native factory.
// Reuse the parent's one reservation; never allocate a child budget allowance.
export async function runFixedSmokeAdmission(
  directory,
  index,
  id,
  owner,
  admit,
  execute = executeOwnedWindowsJob
) {
  const callerMeter = createCallerMeter();
  const input = fixedSmokeInput(index);
  const entry = budgetStatus(directory).active.find(
    (value) => value.id === id && value.owner === owner
  );
  if (
    !entry ||
    entry.threads !== smokeLimits.threads ||
    entry.monitor !== false ||
    entry.reserved.wallMs > smokeLimits.wallMs ||
    entry.reserved.outputBytes !== smokeLimits.outputBytes
  )
    throw new Error("fixed smoke envelope reservation mismatch");
  // Leave the parent's original persistence headroom intact. Inner execution
  // and its telemetry also share this deadline, never a fresh ten-minute budget.
  const deadlineAt =
    entry.startedAt + entry.reserved.wallMs - telemetryPersistenceMs;
  const remaining = Math.floor(deadlineAt - Date.now());
  const started = performance.now();
  const checkOutputDeadline = () => {
    if (Date.now() >= deadlineAt || performance.now() - started >= remaining)
      throw new Error("fixed smoke envelope deadline elapsed");
  };
  if (remaining <= telemetryPersistenceMs)
    throw new Error("fixed smoke envelope headroom unavailable");
  const reservation = Object.freeze({
    id: entry.id,
    owner: entry.owner,
    outputBytes: entry.reserved.outputBytes,
    callerMeter,
    checkOutputDeadline,
  });
  checkOutputDeadline();
  if (admit(reservation.outputBytes) !== undefined)
    throw new Error("invalid fixed smoke storage admission result");
  // The attempt and its capacity helper now run inside the owning outer Job.
  // A killed root or missing result remains an incomplete, durable attempt.
  writeReservedArtifact(
    directory,
    id,
    owner,
    "fixed-smoke-attempt",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "i0-fixed-smoke-attempt",
        input,
        limits: smokeLimits,
        attempted: 1,
        completed: 0,
      })
    ),
    admit,
    Date.now(),
    checkOutputDeadline
  );
  checkOutputDeadline();
  const result = await observeReservedWindowsJob(
    directory,
    {
      module: resolve(root, "scripts/ismcts/fixed-smoke-worker.mjs"),
      args: [String(index), id, owner],
      cwd: root,
      threads: smokeLimits.threads,
      wallMs: Math.floor(
        Math.min(
          deadlineAt - Date.now(),
          remaining - (performance.now() - started)
        )
      ),
      resourceWatchdog: true,
    },
    { serviceBusy: bindWindowsServiceReader(directory, false) },
    reservation,
    admit,
    execute,
    "fixed-smoke-inner-runtime"
  );
  return { ...result, callerCutoff: callerCutoff(callerMeter) };
}

export function fixedSmokeExitCode(result) {
  return (result.execution && result.execution.status !== "completed") ||
    (result.game && result.game.result.failed > 0)
    ? 1
    : 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (
    process.argv.length > 3 ||
    (process.argv[2] && !/^(?:[0-9]|1[0-5])$/.test(process.argv[2]))
  )
    throw new Error("Usage: node scripts/ismcts/fixed-smoke.mjs [0..15]");
  try {
    const result = await runFixedDeckSmoke(Number(process.argv[2] ?? 0));
    console.log(JSON.stringify(result));
    // Full accounting is still unreconciled; this command never emits an
    // acceptance success, even when its one bounded engine game ends naturally.
    process.exitCode = fixedSmokeExitCode(result);
  } catch {
    console.error(
      "fixed smoke failed; retain reservation and partial artifacts"
    );
    process.exitCode = 1;
  }
}
