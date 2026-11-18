#!/usr/bin/env node
/**
 * Reconcile runner-maintained supervisor state with the external lock file.
 *
 * This is intentionally conservative: it only changes a "running" state when
 * both the runner state and supervisor lock are older than the stale TTL, or
 * when the lock is gone and the state itself is stale. It never starts/stops
 * the scheduled task and never edits worker trees.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

const repo = resolve(argValue("--repo", process.cwd()));
const stateFile = resolve(
  argValue("--state", join(repo, "logs", "codex-supervisor-state.json"))
);
const lane = argValue("--lane", "supervisor");
const lockDir =
  process.env.ORICA_SUPERVISOR_LOCK_DIR ||
  argValue("--lock-dir", "C:\\dev\\orica-wt");
const lockFile = resolve(
  argValue(
    "--lock",
    process.env.ORICA_SUPERVISOR_LOCK ||
      join(
        lockDir,
        lane === "supervisor"
          ? "orica-supervisor.lock.json"
          : `orica-supervisor.${lane}.lock.json`
      )
  )
);
const ttlMinArg = argValue(
  "--ttl-min",
  process.env.ORICA_SUPERVISOR_LOCK_TTL_MIN || null
);
const hasExplicitTtl =
  args.includes("--ttl-min") ||
  Boolean(process.env.ORICA_SUPERVISOR_LOCK_TTL_MIN);
const shouldWrite = args.includes("--write");
const shouldReport = args.includes("--report");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function fileAgeMin(path) {
  try {
    return (Date.now() - statSync(path).mtimeMs) / 60000;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isoAgeMin(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return Infinity;
  return (Date.now() - ms) / 60000;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function reportControl(text) {
  const reportScript = join(repo, "scripts", "supervisor-report.mjs");
  spawnSync(
    process.execPath,
    [reportScript, "--repo", repo, "--kind", "control", "--stdin"],
    {
      cwd: repo,
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
    }
  );
}

function main() {
  let ttlMin = Number(ttlMinArg);
  if (!hasExplicitTtl) {
    const lock = readJson(lockFile);
    const lockTtlMin = Number(lock?.ttlMin);
    ttlMin = Number.isFinite(lockTtlMin) && lockTtlMin > 0 ? lockTtlMin : 60;
  }
  if (!Number.isFinite(ttlMin) || ttlMin <= 0) {
    throw new Error(`invalid --ttl-min: ${ttlMin}`);
  }

  const state = readJson(stateFile);
  if (!state) {
    console.log(`[supervisor:reconcile] state missing: ${stateFile}`);
    return;
  }
  if (state.status !== "running") {
    console.log(
      `[supervisor:reconcile] no-op: status=${state.status || "unknown"}`
    );
    return;
  }

  const stateAge = isoAgeMin(state.updatedAt);
  const lockAge = fileAgeMin(lockFile);
  const lockState =
    lockAge === null ? "missing" : lockAge >= ttlMin ? "stale" : "healthy";
  const stateStale = stateAge >= ttlMin;

  if (!stateStale || lockState === "healthy") {
    console.log(
      `[supervisor:reconcile] no-op: stateAge=${stateAge.toFixed(1)}min lock=${lockState}`
    );
    return;
  }

  const finishedAt = new Date().toISOString();
  const text =
    `reconciled stale supervisor state: state updated ${stateAge.toFixed(
      1
    )}min ago, lock=${lockState}` +
    (lockAge === null ? "" : ` (${lockAge.toFixed(1)}min old)`);

  if (!shouldWrite) {
    console.log(`[supervisor:reconcile] would mark stale: ${text}`);
    return;
  }

  state.status = "stale";
  state.finishedAt = state.finishedAt || finishedAt;
  state.exitCode = state.exitCode ?? 4;
  state.updatedAt = finishedAt;
  state.recentEvents = Array.isArray(state.recentEvents)
    ? state.recentEvents
    : [];
  state.recentEvents.push({ at: finishedAt, text });
  state.recentEvents = state.recentEvents.slice(-20);
  writeJsonAtomic(stateFile, state);
  console.log(`[supervisor:reconcile] marked stale: ${text}`);

  if (shouldReport) {
    reportControl(
      [
        "supervisor running state was reconciled as stale.",
        "",
        `- stateFile: ${stateFile}`,
        `- lockFile: ${lockFile}`,
        `- ttlMin: ${ttlMin}`,
        `- stateAgeMin: ${stateAge.toFixed(1)}`,
        `- lock: ${lockState}`,
        `- action: marked status=stale; no worker/task was started or stopped`,
      ].join("\n")
    );
  }
}

main();
