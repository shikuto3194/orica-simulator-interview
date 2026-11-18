import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireGateLease } from "./harness/gate-lease.mjs";
import state from "./harness/verification-state.cjs";
import {
  DEFAULT_FUZZ_REGRESSION_SEEDS,
  reserveFuzzSeedRange,
} from "./fuzz-seed-ledger.mjs";

/** Games a shard plays: the indices congruent to `index` modulo `shards`. */
export function shardGameCount(games, shards, index) {
  return Math.floor((games - index + shards - 1) / shards);
}

/**
 * A shard passes only when Vitest exited 0 AND its own summary line reports the
 * exact games it owns, all natural. A silent exit 0 (no summary) is a failure.
 */
export function verifyShardOutput({ output, index, shards, games, status }) {
  if (status !== 0) return `shard ${index}/${shards} exited ${status}`;
  const expected = shardGameCount(games, shards, index);
  const pattern = new RegExp(
    "\\[fuzz\\] shard=" +
      index +
      "/" +
      shards +
      " games=(\\d+) total=" +
      games +
      " regression=\\d+ discovery=\\d+ seedBase=\\S+" +
      " natural=(\\d+) capped=(\\d+) stuck=(\\d+) error=(\\d+)"
  );
  const match = pattern.exec(output ?? "");
  if (!match) return `shard ${index}/${shards} printed no summary line`;
  const [, played, natural, capped, stuck, error] = match.map(Number);
  if (played !== expected || natural !== expected)
    return `shard ${index}/${shards} played ${played} (natural ${natural}) of ${expected} games`;
  if (capped || stuck || error)
    return `shard ${index}/${shards} found capped=${capped} stuck=${stuck} error=${error}`;
  return null;
}

function executeShard(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const tee = (stream, sink) =>
      stream.on("data", (chunk) => {
        output += chunk;
        sink.write(chunk);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

// Fuzz shares the repository lease with regular gates, including direct runs.
// `shards` > 1 splits one seed list across that many Vitest processes under
// the same lease; callers must not exceed the compute worker limit.
export async function runFuzz({
  root,
  env = process.env,
  shards = 1,
  runShard = executeShard,
  execute = spawnSync,
  acquire = acquireGateLease,
  leaseOptions,
  log = console.log,
}) {
  const games = Number(env.FUZZ_GAMES ?? 200);
  if (!Number.isInteger(games) || games <= 0)
    throw new Error("FUZZ_GAMES must be a positive integer");
  if (!Number.isInteger(shards) || shards < 1 || shards > games)
    throw new Error("fuzz shards must be an integer from 1 to the game count");
  const requestedAt = Date.now();
  const fingerprint = state.sourceFingerprint(root);
  const sourceFingerprint = state.sourceFingerprintDetails(root, {
    includeEnvironment: false,
  }).fingerprint;
  let sourceHead = null;
  let sourceTree = null;
  try {
    sourceHead = state.git(root, ["rev-parse", "--verify", "HEAD"]).trim();
    sourceTree = state.git(root, ["rev-parse", "HEAD^{tree}"]).trim();
  } catch (error) {
    if (env.FUZZ_CANDIDATE_HEAD || env.FUZZ_CANDIDATE_TREE) throw error;
  }
  const candidateHead = env.FUZZ_CANDIDATE_HEAD?.trim() || null;
  const candidateTree = env.FUZZ_CANDIDATE_TREE?.trim() || null;
  if (Boolean(candidateHead) !== Boolean(candidateTree))
    throw new Error("Fuzz candidate identity must include both HEAD and tree");
  if (
    candidateHead &&
    (candidateHead !== sourceHead || candidateTree !== sourceTree)
  )
    throw new Error(
      "Fuzz candidate identity does not match the current Git tree"
    );
  const requestInput = JSON.stringify([
    // Reuse the worker/cron boundary's explicit metadata exclusions for queue
    // identity only. The source check after acquisition stays strict.
    state.followupFingerprint(root),
    Object.entries(env)
      .filter(([key]) => /^FUZZ_/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const report = {
    schemaVersion: 1,
    requestedAt,
    games,
    sourceHead,
    sourceTree,
    sourceFingerprint,
    candidateHead,
    candidateTree,
    status: "waiting",
    leaseWaitMs: null,
  };
  let release;
  try {
    release = await acquire(root, {
      ...leaseOptions,
      requestKey: "fuzz",
      requestInput,
    });
    report.queueReceipt = release.receipt || null;
    if (state.sourceFingerprint(root) !== fingerprint)
      throw new Error(
        "Source changed while fuzz was queued; submit a new request"
      );
    if (
      sourceHead &&
      (state.git(root, ["rev-parse", "--verify", "HEAD"]).trim() !==
        sourceHead ||
        state.git(root, ["rev-parse", "HEAD^{tree}"]).trim() !== sourceTree)
    )
      throw new Error("Git candidate changed while fuzz was queued");
    report.startedAt = Date.now();
    report.leaseWaitMs = report.startedAt - requestedAt;
    report.status = "running";
    let seedBase = env.FUZZ_SEED_BASE;
    if (seedBase === undefined || seedBase.trim() === "") {
      const head = execute("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (head.status !== 0)
        throw new Error("Cannot determine HEAD for fuzz seed reservation");
      seedBase = String(
        reserveFuzzSeedRange({
          stateFile: join(root, "logs", "fuzz-seed-ledger.json"),
          games,
          head: head.stdout.trim(),
        })
      );
    }
    log(
      `[fuzz] regressionSeeds=${env.FUZZ_REGRESSION_SEEDS ?? DEFAULT_FUZZ_REGRESSION_SEEDS.join(",")} rotatingSeedBase=${seedBase}`
    );
    report.seedBase = seedBase;
    // Avoid shell parsing of paths. The parent retains its lease until Vitest exits.
    const vitestArgs = [
      join(root, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "apps/playground-web/test/selfplay-fuzz.test.ts",
    ];
    let result;
    if (shards === 1) {
      result = execute(process.execPath, vitestArgs, {
        cwd: root,
        stdio: "inherit",
        shell: false,
        env: { ...env, RUN_FUZZ: "1", FUZZ_SEED_BASE: seedBase },
      });
    } else {
      report.shards = shards;
      const outcomes = await Promise.all(
        Array.from({ length: shards }, (_, index) =>
          runShard(process.execPath, vitestArgs, {
            cwd: root,
            shell: false,
            env: {
              ...env,
              RUN_FUZZ: "1",
              FUZZ_SEED_BASE: seedBase,
              FUZZ_SHARD_COUNT: String(shards),
              FUZZ_SHARD_INDEX: String(index),
            },
          })
            .then((outcome) => ({ index, ...outcome }))
            // Wait for every shard before the lease is released, even when
            // one fails to start.
            .catch((error) => ({ index, status: null, error: error.message }))
        )
      );
      const problems = outcomes
        .map((outcome) => verifyShardOutput({ ...outcome, shards, games }))
        .filter(Boolean);
      for (const outcome of outcomes)
        if (outcome.error)
          problems.push(`shard ${outcome.index}: ${outcome.error}`);
      if (problems.length) report.error = problems.join("; ");
      result = { status: problems.length ? 1 : 0 };
    }
    report.exitCode = result.status ?? 1;
    report.status = report.exitCode === 0 ? "passed" : "failed";
    if (
      report.status === "passed" &&
      (state.sourceFingerprint(root) !== fingerprint ||
        state.sourceFingerprintDetails(root, { includeEnvironment: false })
          .fingerprint !== sourceFingerprint ||
        (sourceHead &&
          (state.git(root, ["rev-parse", "--verify", "HEAD"]).trim() !==
            sourceHead ||
            state.git(root, ["rev-parse", "HEAD^{tree}"]).trim() !==
              sourceTree)))
    ) {
      report.status = "failed";
      report.exitCode = 1;
      report.error = "Source or Git candidate changed during fuzz";
      throw new Error(report.error);
    }
    return report.exitCode;
  } catch (error) {
    report.status = release ? "failed" : "blocked";
    report.error = error.message;
    report.failureCode = error.code || null;
    report.queueReceipt ??= error.receipt || null;
    throw error;
  } finally {
    report.finishedAt = Date.now();
    report.leaseWaitMs ??= report.finishedAt - requestedAt;
    try {
      state.atomicJson(
        join(root, "logs", "fuzz-runs", `${requestedAt}-${randomUUID()}.json`),
        report
      );
    } finally {
      release?.();
    }
  }
}
