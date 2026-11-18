#!/usr/bin/env node
/**
 * node scripts/preflight-publish.mjs — checks the cheap, known causes of an aborted
 * auto-merge before it starts, and estimates the wall-clock cost of the gates
 * the merge profile would select (from recorded timings).
 *
 * It only reads: no tree, remote or ref change. The one write is Git's own
 * index stat refresh (`update-index --refresh`), which makes the clean-tree
 * check see the same state Git commands do.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gateLeasePath } from "./harness/gate-lease.mjs";
import { assertVerifierEvidence } from "./remote-main-integration.mjs";

// The agreed publication budget: a run beyond this is stopped and discussed.
export const PUBLISH_BUDGET_SECONDS = 1200;
// Time outside the gates (preconditions, rebase, lock wait, push, final check)
// measured on two publications: 159s and 160s.
const OVERHEAD_SECONDS = 160;
// 200 games split over the two compute workers: 137s and 149s measured.
const FUZZ_SECONDS = 140;

const git = (root, args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median seconds per gate over runs that actually executed it. */
export function gateSecondsFromTimings(...directories) {
  const samples = new Map();
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory)) {
      let report;
      try {
        report = JSON.parse(readFileSync(join(directory, file), "utf8"));
      } catch {
        continue;
      }
      for (const gate of report.gates ?? []) {
        if (gate.status !== "passed" || gate.reused || !gate.durationMs)
          continue;
        const list = samples.get(gate.id) ?? [];
        list.push(gate.durationMs / 1000);
        samples.set(gate.id, list);
      }
    }
  }
  return new Map([...samples].map(([id, list]) => [id, median(list)]));
}

export function estimateSeconds(gateIds, perGate, { fuzz = false } = {}) {
  const known = [];
  const unknown = [];
  let total = OVERHEAD_SECONDS + (fuzz ? FUZZ_SECONDS : 0);
  for (const id of gateIds) {
    const seconds = perGate.get(id);
    if (seconds === undefined) unknown.push(id);
    else {
      known.push(id);
      total += seconds;
    }
  }
  return { total: Math.round(total), known, unknown };
}

/** Text files whose index copy is LF but whose checkout copy is CRLF. */
export function crlfCheckoutFiles(eolListing) {
  return eolListing
    .split(/\r?\n/)
    .filter(
      (line) =>
        /^i\/lf\s+w\/crlf\s/.test(line) &&
        !/\beol=crlf\b/.test(line) &&
        !/\s(?:\S+\.)?(?:ps1|bat|cmd)$/.test(line)
    )
    .map((line) => line.split("\t").at(-1).trim());
}

export function shellCheck(env) {
  return env.MSYSTEM
    ? {
        ok: false,
        detail: `launched from Git Bash (MSYSTEM=${env.MSYSTEM})`,
        fix: "start auto-merge from the PowerShell tool; Git Bash has made pc-api-build-storage fail",
      }
    : { detail: "not Git Bash" };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error.code === "EPERM";
  }
}

/**
 * Auto-merge attempts still recorded as `running` whose process is gone: the
 * session or machine ended mid-publication, so nothing will ever finish or
 * report them. Old orphans are ignored unless they belong to this branch.
 */
export function orphanedRuns(
  directory,
  { isAlive = processAlive, now = Date.now(), branch = null } = {}
) {
  const recentMs = 24 * 60 * 60 * 1000;
  const found = [];
  if (!existsSync(directory)) return found;
  for (const file of readdirSync(directory)) {
    let run;
    try {
      run = JSON.parse(readFileSync(join(directory, file), "utf8"));
    } catch {
      continue;
    }
    if (run.status !== "running" || !Number.isInteger(run.pid)) continue;
    if (isAlive(run.pid)) continue;
    const updated = Date.parse(run.updatedAt ?? run.startedAt ?? "");
    const recent = Number.isFinite(updated) && now - updated <= recentMs;
    if (recent || (branch !== null && run.branch === branch))
      found.push({
        id: run.id,
        branch: run.branch,
        phase: run.phase,
        updatedAt: run.updatedAt ?? null,
      });
  }
  return found;
}

/**
 * The shared verification lease when its owner process is gone. Stopping an
 * auto-merge mid-gate leaves it behind, and the next run then exits 75
 * ("Verification owner exited"). Recover it with
 * `node scripts/harness/recover-gate-lease.mjs --root <owner root>`.
 */
export function staleLease(root, { isAlive = processAlive } = {}) {
  const file = gateLeasePath(root);
  if (!existsSync(file)) return null;
  let lease;
  try {
    lease = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!Number.isInteger(lease.pid) || isAlive(lease.pid)) return null;
  return { pid: lease.pid, root: lease.root ?? null, file };
}

/**
 * Commits on the local main that origin/main does not have. The merge plan
 * diffs against the local main, so a main that already holds the candidate
 * shows an empty change set and falls back to every gate.
 */
export function unpublishedMain(
  root,
  base = "origin/main",
  main = "refs/heads/main"
) {
  const exists = (ref) =>
    spawnSync("git", ["-C", root, "rev-parse", "--verify", "-q", ref], {
      windowsHide: true,
    }).status === 0;
  if (!exists(main) || !exists(base)) return [];
  return git(root, ["log", "--format=%h %s", `${base}..${main}`])
    .split(/\r?\n/)
    .filter(Boolean);
}

function check(name, run) {
  try {
    const detail = run();
    return { name, ok: detail?.ok ?? true, ...detail };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

export function runPreflight(
  root,
  { base = "origin/main", env = process.env } = {}
) {
  const results = [];
  results.push(check("shell", () => shellCheck(env)));
  results.push(
    check("tree", () => {
      git(root, ["update-index", "-q", "--refresh"]);
      const dirty = git(root, ["status", "--porcelain"]).trim();
      return dirty
        ? {
            ok: false,
            detail: dirty.split(/\r?\n/).slice(0, 8).join("; "),
            fix: "commit or discard the changes; if only stat info is stale, `git add` the file",
          }
        : { detail: "clean" };
    })
  );
  results.push(
    check("line endings", () => {
      const bad = crlfCheckoutFiles(git(root, ["ls-files", "--eol"]));
      return bad.length
        ? {
            ok: false,
            detail: bad.slice(0, 8).join(", "),
            fix: "rewrite these files with LF (the index copy is LF); format:check fails on CRLF",
          }
        : { detail: "no CRLF checkout of an LF file" };
    })
  );
  results.push(
    check("base", () => {
      git(root, ["fetch", "-q", "origin", "main"]);
      const tip = git(root, ["rev-parse", "--short", base]).trim();
      const ok =
        spawnSync("git", [
          "-C",
          root,
          "merge-base",
          "--is-ancestor",
          base,
          "HEAD",
        ]).status === 0;
      return ok
        ? { detail: `contains ${base} (${tip})` }
        : {
            ok: false,
            detail: `HEAD does not contain ${base} (${tip})`,
            fix: "rebase onto main first, then regenerate the independent review against main",
          };
    })
  );
  const primary = dirname(
    resolve(
      git(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]).trim()
    )
  );
  results.push(
    check("interrupted publication", () => {
      const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      const orphans = orphanedRuns(join(primary, "logs/auto-merge-runs"), {
        branch,
      });
      return orphans.length
        ? {
            ok: false,
            detail: orphans
              .map((run) => `${run.id.slice(0, 8)} ${run.branch} @${run.phase}`)
              .join("; "),
            fix: "an earlier auto-merge ended without finishing; inspect the local main and the run record before starting another",
          }
        : { detail: "no orphaned auto-merge run" };
    })
  );
  results.push(
    check("verification lease", () => {
      const stale = staleLease(root);
      return stale
        ? {
            ok: false,
            detail: `owner pid ${stale.pid} is gone (root ${stale.root})`,
            fix: `node scripts/harness/recover-gate-lease.mjs --root "${stale.root}"`,
          }
        : { detail: "no stale verification lease" };
    })
  );
  results.push(
    check("unpublished main", () => {
      const ahead = unpublishedMain(root, base);
      return ahead.length
        ? {
            ok: false,
            detail: `${ahead.length} commit(s) on local main not in ${base}: ${ahead
              .slice(0, 3)
              .map((line) => line.slice(0, 80))
              .join("; ")}`,
            fix: "finish or release that publication first; the plan diffs against local main and would select every gate (see primary-main-recovery.md)",
          }
        : { detail: `local main has nothing beyond ${base}` };
    })
  );
  let plan = null;
  results.push(
    check("selection", () => {
      const run = spawnSync(
        process.execPath,
        [
          join(root, "scripts/harness/run-gates.mjs"),
          "--profile",
          "merge",
          "--plan",
        ],
        { cwd: root, encoding: "utf8", windowsHide: true }
      );
      if (run.status !== 0)
        return {
          ok: false,
          detail: (run.stderr || run.stdout)
            .trim()
            .split(/\r?\n/)
            .slice(-3)
            .join("; "),
          fix: "classify the changed script/path in scripts/harness/gate-manifest.json",
        };
      plan = JSON.parse(run.stdout);
      return { detail: `${plan.gates.length} gates` };
    })
  );
  results.push(
    check("classification", () => {
      if (plan === null) return { detail: "no plan to classify" };
      const found = [
        ...(plan.unresolved ?? []),
        ...(plan.classification ?? []),
      ];
      return found.length
        ? {
            ok: false,
            detail: found
              .slice(0, 6)
              .map(
                (item) =>
                  `UNCLASSIFIED: ${item.file ?? "comparison base"} (${item.reason})`
              )
              .join("; "),
            fix: "Establish the comparison base or register the affected checks per manual/ai-reference/00_meta/validation-scope.md",
          }
        : { detail: "every changed path is classified" };
    })
  );
  results.push(
    check("verifier evidence", () => {
      assertVerifierEvidence(root);
      return { detail: "covers HEAD against main" };
    })
  );
  const timings = join(primary, "logs/harness/timing");
  const baseIsCurrent = results.some(
    (result) => result.name === "base" && result.ok
  );
  let estimate = null;
  if (plan) {
    // The advisory plan can report a ledger receipt for the current main;
    // the actual runner deliberately repeats this main-dependent gate.
    const remaining = plan.gates.filter(
      (gate) =>
        gate === "ledger" ||
        !baseIsCurrent ||
        !plan.evidence?.passed?.includes(gate)
    );
    estimate = estimateSeconds(
      remaining,
      gateSecondsFromTimings(timings, join(root, "logs/harness/runs")),
      {
        fuzz: plan.fuzzRequired === true,
      }
    );
    results.push({
      name: "estimate",
      ok:
        estimate.unknown.length === 0 &&
        estimate.total <= PUBLISH_BUDGET_SECONDS,
      detail:
        `${estimate.unknown.length ? "at least " : "~"}${estimate.total}s of ${PUBLISH_BUDGET_SECONDS}s budget` +
        (estimate.unknown.length
          ? ` (no timing yet for: ${estimate.unknown.join(", ")})`
          : ""),
      fix: estimate.unknown.length
        ? "measure the remaining gates on the fixed candidate before publishing"
        : "over budget: stop and discuss before publishing",
    });
  }
  return { results, plan, estimate };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { results } = runPreflight(root);
  for (const item of results)
    console.log(
      `${item.ok ? "ok  " : "FAIL"} ${item.name}: ${item.detail ?? ""}` +
        (item.ok || !item.fix ? "" : `\n     -> ${item.fix}`)
    );
  process.exitCode = results.every((item) => item.ok) ? 0 : 1;
}
