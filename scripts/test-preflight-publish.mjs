import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PUBLISH_BUDGET_SECONDS,
  crlfCheckoutFiles,
  estimateSeconds,
  gateSecondsFromTimings,
  orphanedRuns,
  shellCheck,
  staleLease,
  unpublishedMain,
} from "./preflight-publish.mjs";
import { archiveRunTiming } from "./harness/run-gates.mjs";
import { gateLeasePath } from "./harness/gate-lease.mjs";

// Git Bash is the launch shell that made a full-suite test fail after 46 min.
assert.equal(shellCheck({ MSYSTEM: "MINGW64" }).ok, false);
assert.notEqual(shellCheck({}).ok, false);

// Only an LF index copy checked out as CRLF fails format:check; .ps1 files are
// stored with eol=crlf on purpose.
assert.deepEqual(
  crlfCheckoutFiles(
    [
      "i/lf    w/crlf  attr/text=auto eol=lf \t.mcp.json",
      "i/lf    w/crlf  attr/text eol=crlf    \tscripts/auto-merge.ps1",
      "i/lf    w/lf    attr/text=auto eol=lf \tREADME.md",
      "i/lf    w/crlf  attr/text=auto eol=lf \tdocs/a b.md",
    ].join("\n")
  ),
  [".mcp.json", "docs/a b.md"]
);

const directory = mkdtempSync(join(tmpdir(), "orica-preflight-"));
try {
  const run = (name, gates) =>
    writeFileSync(join(directory, name), JSON.stringify({ gates }) + "\n");
  run("1.json", [
    { id: "vitest", status: "passed", reused: false, durationMs: 600_000 },
    { id: "docs", status: "passed", reused: false, durationMs: 10_000 },
    { id: "lint", status: "passed", reused: true, durationMs: 1 },
  ]);
  run("2.json", [
    { id: "vitest", status: "passed", reused: false, durationMs: 640_000 },
    { id: "docs", status: "failed", reused: false, durationMs: 99_000 },
  ]);
  writeFileSync(join(directory, "broken.json"), "{");
  const perGate = gateSecondsFromTimings(directory);
  // Reused and failed executions say nothing about the cost of running a gate.
  assert.equal(perGate.get("vitest"), 620);
  assert.equal(perGate.get("docs"), 10);
  assert.equal(perGate.has("lint"), false);
  const estimate = estimateSeconds(["vitest", "docs", "lint"], perGate, {
    fuzz: true,
  });
  assert.deepEqual(estimate.unknown, ["lint"]);
  assert.equal(estimate.total, 620 + 10 + 160 + 140);
  assert.ok(estimate.total <= PUBLISH_BUDGET_SECONDS);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
// Per-gate timings survive the removal of a temporary candidate worktree: they
// are written under the primary checkout (parent of the shared git dir).
const primary = mkdtempSync(join(tmpdir(), "orica-timing-"));
try {
  assert.equal(
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: primary }).status,
    0
  );
  archiveRunTiming(primary, {
    profile: "merge",
    status: "passed",
    root: primary,
    startedAt: 1000,
    finishedAt: 5000,
    durationMs: 4000,
    selectedGates: ["docs", "vitest"],
    gates: [
      {
        id: "docs",
        status: "passed",
        reused: false,
        durationMs: 1200,
        outputLog: "secret/path.log",
      },
      { id: "vitest", status: "passed", reused: true, durationMs: 3 },
    ],
  });
  const directory = join(primary, "logs/harness/timing");
  assert.equal(existsSync(directory), true);
  const [file] = readdirSync(directory);
  const saved = JSON.parse(readFileSync(join(directory, file), "utf8"));
  assert.deepEqual(saved.gates, [
    { id: "docs", status: "passed", reused: false, durationMs: 1200 },
    { id: "vitest", status: "passed", reused: true, durationMs: 3 },
  ]);
  assert.equal(saved.durationMs, 4000);
  // Observability must never throw into a verification run.
  assert.doesNotThrow(() => archiveRunTiming(join(primary, "missing"), {}));
} finally {
  rmSync(primary, { recursive: true, force: true });
}
// An auto-merge recorded as running whose process is gone ended mid-publication
// (the session or machine stopped); old orphans only count for the same branch.
const runs = mkdtempSync(join(tmpdir(), "orica-runs-"));
try {
  const now = Date.parse("2026-11-01T06:00:00Z");
  const record = (id, over) =>
    writeFileSync(
      join(runs, id + ".json"),
      JSON.stringify({
        id,
        branch: "feature/x",
        status: "running",
        phase: "pushing",
        pid: 111,
        updatedAt: "2026-11-01T05:00:00Z",
        ...over,
      })
    );
  record("recent-dead");
  record("recent-alive", { pid: 222 });
  record("finished", { status: "completed" });
  record("old-dead", { updatedAt: "2026-10-01T00:00:00Z" });
  record("old-dead-same-branch", {
    updatedAt: "2026-10-01T00:00:00Z",
    branch: "feature/mine",
  });
  writeFileSync(join(runs, "broken.json"), "{");
  const isAlive = (pid) => pid === 222;
  const ids = (found) => found.map((run) => run.id).sort();
  assert.deepEqual(ids(orphanedRuns(runs, { isAlive, now })), ["recent-dead"]);
  assert.deepEqual(
    ids(orphanedRuns(runs, { isAlive, now, branch: "feature/mine" })),
    ["old-dead-same-branch", "recent-dead"]
  );
  assert.deepEqual(orphanedRuns(join(runs, "missing"), { isAlive, now }), []);
} finally {
  rmSync(runs, { recursive: true, force: true });
}

// A local main that already holds the candidate makes the merge plan diff to
// nothing and select every gate; the preflight must see those commits.
const repo = mkdtempSync(join(tmpdir(), "orica-ahead-"));
try {
  const git = (...args) =>
    spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const commit = (message) => {
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t.invalid",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      message
    );
    return git("rev-parse", "HEAD").stdout.trim();
  };
  git("init", "-q", "-b", "main");
  assert.deepEqual(unpublishedMain(repo), [], "no refs yet");
  const first = commit("published");
  git("update-ref", "refs/remotes/origin/main", first);
  assert.deepEqual(unpublishedMain(repo), []);
  commit("only on local main");
  const ahead = unpublishedMain(repo);
  assert.equal(ahead.length, 1);
  assert.match(ahead[0], /only on local main/);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
// Stopping an auto-merge mid-gate leaves the verification lease behind; the next
// run exits 75. Only a lease whose owner process is gone counts as stale.
const leaseRoot = mkdtempSync(join(tmpdir(), "orica-lease-"));
// The lease path is derived from the repository's shared git directory.
assert.equal(
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: leaseRoot }).status,
  0
);
const lease = gateLeasePath(leaseRoot);
try {
  assert.equal(staleLease(leaseRoot), null, "no lease file");
  writeFileSync(lease, JSON.stringify({ pid: 4242, root: "C:\\wt\\gone" }));
  const stale = staleLease(leaseRoot, { isAlive: () => false });
  assert.equal(stale.pid, 4242);
  assert.equal(stale.root, "C:\\wt\\gone");
  assert.equal(staleLease(leaseRoot, { isAlive: () => true }), null, "live");
  writeFileSync(lease, "{");
  assert.equal(staleLease(leaseRoot, { isAlive: () => false }), null, "broken");
  writeFileSync(lease, JSON.stringify({ root: "C:\\wt\\x" }));
  assert.equal(staleLease(leaseRoot, { isAlive: () => false }), null, "no pid");
} finally {
  rmSync(leaseRoot, { force: true, recursive: true });
  rmSync(lease, { force: true });
}
console.log("preflight-publish regression passed");
