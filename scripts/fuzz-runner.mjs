import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireGateLease } from "./harness/gate-lease.mjs";
import state from "./harness/verification-state.cjs";
import {
  DEFAULT_FUZZ_REGRESSION_SEEDS,
  reserveFuzzSeedRange,
} from "./fuzz-seed-ledger.mjs";

// Fuzz shares the repository lease with regular gates, including direct runs.
export async function runFuzz({
  root,
  env = process.env,
  execute = spawnSync,
  acquire = acquireGateLease,
  leaseOptions,
  log = console.log,
}) {
  const games = Number(env.FUZZ_GAMES ?? 200);
  if (!Number.isInteger(games) || games <= 0)
    throw new Error("FUZZ_GAMES must be a positive integer");
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
    const result = execute(
      process.execPath,
      [
        join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "apps/playground-web/test/selfplay-fuzz.test.ts",
      ],
      {
        cwd: root,
        stdio: "inherit",
        shell: false,
        env: { ...env, RUN_FUZZ: "1", FUZZ_SEED_BASE: seedBase },
      }
    );
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
