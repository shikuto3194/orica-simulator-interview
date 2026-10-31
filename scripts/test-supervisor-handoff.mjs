#!/usr/bin/env node

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync as createTempDirectory,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, URL } from "node:url";
import {
  enqueueFollowup,
  hasActionableUnresolved,
  listPendingFollowups,
  resolveFollowup,
  shouldQueueFollowup,
} from "./supervisor-followup.mjs";
import { backfillClusterResolvedCommits } from "./backfill-cluster-resolved-commits.mjs";

// Static sibling imports can run past another module's top-level await. Long
// synchronous Git/PowerShell fixtures then starve its child-process callbacks
// and expire otherwise healthy heartbeat deadlines. Finish each suite first.
for (const suite of [
  "./test-supervisor-health.mjs",
  "./test-supervisor-followup.mjs",
  "./test-supervisor-followup-evidence.mjs",
  "./test-supervisor-publication-recovery.mjs",
  "./test-supervisor-work-recovery.mjs",
  "./test-supervisor-work-plan.mjs",
  "./test-primary-main.mjs",
  "./test-full-run-checkouts.mjs",
  "./test-fuzz-runner.mjs",
  "./test-sync-worktree-failures.mjs",
  "./test-vitest-process-policy.mjs",
  "./test-lock-heartbeat-command.mjs",
  "./test-supervisor-environment.mjs",
  // Auto-merge publication has a dedicated gate so scoped candidates need not
  // rerun this entire handoff suite.
  "./test-remote-main-integration.mjs",
]) {
  const started = performance.now();
  await import(suite);
  console.log(
    `[handoff] ${suite}: ${Math.round(performance.now() - started)}ms`
  );
}

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const fixtureDirectories = [];
function mkdtempSync(prefix) {
  const directory = createTempDirectory(prefix);
  fixtureDirectories.push(directory);
  return directory;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
  );
  return result.stdout.trim();
}

// Exercise the shared Git contract used by auto-merge and verifier staging.
// New producers and file formats must not need another ignore exception.
const artifactRepo = mkdtempSync(
  join(tmpdir(), "orica-artifact-contract-test-")
);
run("git", ["init", "-b", "main"], artifactRepo);
run("git", ["config", "user.email", "test@example.invalid"], artifactRepo);
run("git", ["config", "user.name", "Artifact Contract Test"], artifactRepo);
writeFileSync(
  join(artifactRepo, ".gitignore"),
  readFileSync(join(ROOT, ".gitignore"))
);
writeFileSync(join(artifactRepo, "source.ts"), "export const value = 1;\n");
run("git", ["add", ".gitignore", "source.ts"], artifactRepo);
run(
  "git",
  ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"],
  artifactRepo
);
const runtimeOutputs = [
  "artifacts/supervisor-engine-full-test.stdout.log",
  "artifacts/supervisor-engine-full-test-final.stderr.log",
  "artifacts/policy-shadow/new-run/checkpoint.json",
  "artifacts/effect-debug/new-run/replay.jsonl",
  "artifacts/new-producer/new-format.data",
  "artifacts/new-producer/nested/no-extension",
  "artifacts/review screenshot.png",
  "artifacts/summary.json",
  "logs/new-producer.stdout.log",
  "test-results/new-failed-test/error-context.md",
  ".codex-temp/playwright-test-results/new-failed-test/trace.zip",
];
for (const path of runtimeOutputs) {
  const target = join(artifactRepo, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, "runtime output\n");
}
assert.equal(
  run("git", ["status", "--porcelain"], artifactRepo),
  "",
  "new runtime artifacts must not block auto-merge on an otherwise clean tree"
);
// git add -A is the verified-commit path; generated evidence must stay out of it.
run("git", ["add", "-A", "--", "."], artifactRepo);
assert.equal(run("git", ["diff", "--cached", "--name-only"], artifactRepo), "");
const sourceFiles = [
  "source.ts",
  "manual/review.json",
  "packages/example/test/fixtures/artifacts/replay.json",
];
for (const path of sourceFiles) {
  const target = join(artifactRepo, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, "reviewable source change\n");
}
const sourceStatus = run(
  "git",
  ["status", "--porcelain", "-uall"],
  artifactRepo
);
assert.match(sourceStatus, /M source\.ts/);
assert.match(sourceStatus, /\?\? manual\/review\.json/);
assert.match(
  sourceStatus,
  /\?\? packages\/example\/test\/fixtures\/artifacts\/replay\.json/
);
run("git", ["add", "-A", "--", "."], artifactRepo);
assert.deepEqual(
  run("git", ["diff", "--cached", "--name-only"], artifactRepo)
    .split("\n")
    .sort(),
  [...sourceFiles].sort()
);
// Even a legacy tracked artifact remains protected by the dirty-tree guard.
run("git", ["add", "-f", "artifacts/summary.json"], artifactRepo);
run(
  "git",
  ["-c", "commit.gpgsign=false", "commit", "-m", "legacy tracked artifact"],
  artifactRepo
);
writeFileSync(
  join(artifactRepo, "artifacts/summary.json"),
  "changed tracked output\n"
);
assert.equal(
  run("git", ["status", "--porcelain"], artifactRepo),
  "M artifacts/summary.json"
);

assert.equal(hasActionableUnresolved("未解決:\n- なし"), false);
assert.equal(
  hasActionableUnresolved("未解決:\n- なし\n- 実際には残件あり"),
  true
);
assert.equal(hasActionableUnresolved("未解決:\n- replay が再発"), true);
assert.equal(hasActionableUnresolved("Unresolved: checkpoint stalled"), true);
assert.equal(shouldQueueFollowup({ kind: "error", text: "plain error" }), true);
assert.equal(
  shouldQueueFollowup({ kind: "progress", text: "ordinary progress" }),
  false
);
assert.equal(
  shouldQueueFollowup({
    kind: "progress",
    text: "ordinary prose",
    explicit: true,
  }),
  true
);

// Active/re-enableable scheduled paths must never dispatch to Claude. Legacy command names
// remain as compatibility shims, but they are required to forward to the Codex supervisor.
const supervisorWrapper = readFileSync(
  join(ROOT, "scripts", "run-supervisor-iteration.ps1"),
  "utf8"
);
const cardWrapper = readFileSync(
  join(ROOT, "scripts", "run-card-impl-iteration.ps1"),
  "utf8"
);
const legacyClaudeWrapper = readFileSync(
  join(ROOT, "scripts", "run-claude-iteration.ps1"),
  "utf8"
);
const legacyClaudeRegister = readFileSync(
  join(ROOT, "scripts", "register-claude-task.ps1"),
  "utf8"
);
const forbiddenClaudeDispatch =
  /worker-claude-stream|--claude\b|Get-Command\s+claude|claude\.(?:cmd|exe)/i;
for (const [label, source] of [
  ["supervisor", supervisorWrapper],
  ["card-impl", cardWrapper],
  ["legacy-engine-shim", legacyClaudeWrapper],
]) {
  assert.doesNotMatch(
    source,
    forbiddenClaudeDispatch,
    `${label} must not dispatch to Claude`
  );
}
assert.match(cardWrapper, /worker-codex-stream\.mjs/);
assert.match(cardWrapper, /"--codex",\s*\$codex/);
assert.match(supervisorWrapper, /\$CodexOnly\s*=\s*\$true/);
const workerPrompt = supervisorWrapper.match(/\$prompt = @'([\s\S]*?)'@/)[1];
assert.match(workerPrompt, /pnpm test:unit <repo相対の\.test\.tsファイル/);
assert.match(
  workerPrompt,
  /単体成功を最終finish・独立査読・ledger・fuzz・統合検証の代用にしない/
);
for (const source of [
  supervisorWrapper,
  readFileSync(
    join(ROOT, "manual/ai-reference/30_plan/engine-drain-runbook.md"),
    "utf8"
  ),
]) {
  assert.doesNotMatch(source, /--skip-fuzz/);
  assert.match(source, /fuzz省略は要求しない/);
}
assert.match(legacyClaudeWrapper, /run-supervisor-iteration\.ps1/);
assert.match(legacyClaudeRegister, /register-supervisor-task\.ps1/);
assert.doesNotMatch(legacyClaudeRegister, /Register-ScheduledTask/);

const followupRepo = mkdtempSync(join(tmpdir(), "orica-followup-test-"));
const first = enqueueFollowup({
  repo: followupRepo,
  kind: "error",
  lane: "codex",
  text: "checkpoint did not advance",
  createdAt: "2026-08-31T00:00:00.000Z",
});
const duplicate = enqueueFollowup({
  repo: followupRepo,
  kind: "error",
  lane: "codex",
  text: "checkpoint did not advance",
  createdAt: "2026-08-31T01:00:00.000Z",
});
assert.equal(first.id, duplicate.id);
assert.equal(duplicate.occurrenceCount, 2);
assert.equal(listPendingFollowups({ repo: followupRepo }).length, 1);
resolveFollowup({
  repo: followupRepo,
  id: first.id,
  note: "fixed by regression test",
  resolvedAt: "2026-08-31T02:00:00.000Z",
});
assert.equal(listPendingFollowups({ repo: followupRepo }).length, 0);

const reportRepo = mkdtempSync(join(tmpdir(), "orica-report-followup-test-"));
run(
  process.execPath,
  [
    join(ROOT, "scripts", "supervisor-report.mjs"),
    "--repo",
    reportRepo,
    "--kind",
    "completed",
    "--lane",
    "codex",
    "--no-relay",
    "未解決:\n- verifier output missing",
  ],
  ROOT
);
assert.equal(listPendingFollowups({ repo: reportRepo }).length, 1);
run(
  process.execPath,
  [
    join(ROOT, "scripts", "supervisor-report.mjs"),
    "--repo",
    reportRepo,
    "--kind",
    "progress",
    "--lane",
    "codex",
    "--no-relay",
    "ordinary progress",
  ],
  ROOT
);
assert.equal(listPendingFollowups({ repo: reportRepo }).length, 1);

const gitRepo = mkdtempSync(join(tmpdir(), "orica-cluster-backfill-test-"));
const queueDir = join(gitRepo, "autorun-queue");
const registryPath = join(queueDir, "cluster-registry.json");
mkdirSync(queueDir, { recursive: true });
run("git", ["init", "-b", "main"], gitRepo);
run("git", ["config", "user.email", "test@example.invalid"], gitRepo);
run("git", ["config", "user.name", "Supervisor Handoff Test"], gitRepo);
writeFileSync(
  registryPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      updated: "2026-08-30",
      clusters: [
        {
          id: "edh-test",
          lane: "codex",
          status: "open",
          scope: "fixture",
        },
        {
          id: "legacy-missing-commit",
          lane: "codex",
          status: "open",
          scope: "fixture without resolvedCommit",
        },
      ],
    },
    null,
    2
  )}\n`,
  "utf8"
);
run("git", ["add", "autorun-queue/cluster-registry.json"], gitRepo);
run("git", ["commit", "-m", "test: add open cluster"], gitRepo);
const resolvedRegistry = JSON.parse(readFileSync(registryPath, "utf8"));
resolvedRegistry.clusters[0].status = "done";
resolvedRegistry.clusters[0].resolvedAt = "2026-08-31";
resolvedRegistry.clusters[0].resolvedCommit = "pending";
resolvedRegistry.clusters[0].resolvedNote = "fixture resolved";
resolvedRegistry.clusters[1].status = "done";
resolvedRegistry.clusters[1].resolvedAt = "2026-08-31";
resolvedRegistry.clusters[1].resolvedNote = "legacy fixture resolved";
writeFileSync(
  registryPath,
  `${JSON.stringify(resolvedRegistry, null, 2)}\n`,
  "utf8"
);
run("git", ["add", "autorun-queue/cluster-registry.json"], gitRepo);
run("git", ["commit", "-m", "fix: resolve fixture cluster"], gitRepo);
const resolutionCommit = run("git", ["rev-parse", "HEAD"], gitRepo);
const backfill = backfillClusterResolvedCommits({
  root: gitRepo,
  registryPath,
  apply: true,
});
assert.equal(backfill.backfilled.length, 2);
assert.equal(backfill.unresolved.length, 0);
assert.equal(
  JSON.parse(readFileSync(registryPath, "utf8")).clusters[0].resolvedCommit,
  resolutionCommit
);
assert.equal(
  JSON.parse(readFileSync(registryPath, "utf8")).clusters[1].resolvedCommit,
  resolutionCommit
);

run("git", ["add", "autorun-queue/cluster-registry.json"], gitRepo);
run("git", ["commit", "-m", "chore: backfill fixture cluster"], gitRepo);
const reopenedRegistry = JSON.parse(readFileSync(registryPath, "utf8"));
const priorResolution = reopenedRegistry.clusters[0];
reopenedRegistry.clusters[0] = {
  ...priorResolution,
  scope: "recurred fixture",
  queueRefs: ["recurred-ticket.md"],
  resolvedAt: "2026-09-01",
  resolvedCommit: "pending",
  resolvedNote: "recurred fixture resolved",
  reopenedFrom: {
    resolvedAt: priorResolution.resolvedAt,
    resolvedCommit: priorResolution.resolvedCommit,
  },
};
writeFileSync(
  registryPath,
  `${JSON.stringify(reopenedRegistry, null, 2)}\n`,
  "utf8"
);
run("git", ["add", "autorun-queue/cluster-registry.json"], gitRepo);
run("git", ["commit", "-m", "fix: resolve recurred fixture cluster"], gitRepo);
const recurredResolutionCommit = run("git", ["rev-parse", "HEAD"], gitRepo);
const recurredBackfill = backfillClusterResolvedCommits({
  root: gitRepo,
  registryPath,
  apply: true,
});
assert.equal(recurredBackfill.backfilled.length, 1);
assert.equal(recurredBackfill.unresolved.length, 0);
assert.equal(
  JSON.parse(readFileSync(registryPath, "utf8")).clusters[0].resolvedCommit,
  recurredResolutionCommit
);

const semanticRepo = mkdtempSync(
  join(tmpdir(), "orica-cluster-backfill-semantic-test-")
);
const semanticQueueDir = join(semanticRepo, "autorun-queue");
const semanticRegistryPath = join(semanticQueueDir, "cluster-registry.json");
mkdirSync(semanticQueueDir, { recursive: true });
run("git", ["init", "-b", "main"], semanticRepo);
run("git", ["config", "user.email", "test@example.invalid"], semanticRepo);
run("git", ["config", "user.name", "Semantic Backfill Test"], semanticRepo);
writeFileSync(
  semanticRegistryPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      updated: "2026-08-30",
      clusters: [
        {
          id: "semantic-fallback",
          lane: "codex",
          status: "open",
          scope: "old fallback scope",
          queueRefs: ["old-fallback-ticket.md"],
        },
        {
          id: "semantic-stale",
          lane: "codex",
          status: "open",
          scope: "old stale scope",
          queueRefs: ["old-stale-ticket.md"],
        },
      ],
    },
    null,
    2
  )}\n`,
  "utf8"
);
run("git", ["add", "autorun-queue/cluster-registry.json"], semanticRepo);
run("git", ["commit", "-m", "test: add semantic fixtures"], semanticRepo);
const semanticResolutionRegistry = JSON.parse(
  readFileSync(semanticRegistryPath, "utf8")
);
semanticResolutionRegistry.clusters[0] = {
  ...semanticResolutionRegistry.clusters[0],
  status: "done",
  scope: "current fallback scope",
  queueRefs: ["old-fallback-ticket.md", "current-fallback-ticket.md"],
  resolvedAt: "2026-09-01",
  resolvedCommit: "pending",
  resolvedNote: "current fallback resolved",
};
semanticResolutionRegistry.clusters[1] = {
  ...semanticResolutionRegistry.clusters[1],
  status: "done",
  scope: "shared stale scope",
  queueRefs: ["old-stale-ticket.md", "shared-stale-ticket.md"],
  resolvedAt: "2026-09-01",
  resolvedCommit: "pending",
  resolvedNote: "old stale resolution",
};
writeFileSync(
  semanticRegistryPath,
  `${JSON.stringify(semanticResolutionRegistry, null, 2)}\n`,
  "utf8"
);
run("git", ["add", "autorun-queue/cluster-registry.json"], semanticRepo);
run("git", ["commit", "-m", "fix: resolve semantic fixtures"], semanticRepo);
const fallbackResolutionCommit = run(
  "git",
  ["rev-parse", "HEAD"],
  semanticRepo
);
const semanticMetadataRegistry = JSON.parse(
  readFileSync(semanticRegistryPath, "utf8")
);
semanticMetadataRegistry.clusters[0].resolvedCommit = "manual";
semanticMetadataRegistry.clusters[1].resolvedAt = "2026-09-02";
semanticMetadataRegistry.clusters[1].resolvedCommit = "manual";
semanticMetadataRegistry.clusters[1].resolvedNote = "new stale metadata";
writeFileSync(
  semanticRegistryPath,
  `${JSON.stringify(semanticMetadataRegistry, null, 2)}\n`,
  "utf8"
);
run("git", ["add", "autorun-queue/cluster-registry.json"], semanticRepo);
run(
  "git",
  ["commit", "-m", "chore: touch semantic fixture metadata"],
  semanticRepo
);
const semanticBackfill = backfillClusterResolvedCommits({
  root: semanticRepo,
  registryPath: semanticRegistryPath,
  apply: true,
});
assert.deepEqual(semanticBackfill.backfilled, [
  { id: "semantic-fallback", commit: fallbackResolutionCommit },
]);
assert.equal(semanticBackfill.unresolved.length, 1);
assert.equal(semanticBackfill.unresolved[0].id, "semantic-stale");
const semanticResult = JSON.parse(readFileSync(semanticRegistryPath, "utf8"));
assert.equal(
  semanticResult.clusters[0].resolvedCommit,
  fallbackResolutionCommit
);
assert.equal(semanticResult.clusters[1].resolvedCommit, "manual");

// Preserve failed fixtures for diagnosis; successful repeated gates leave no
// accumulating repositories in the user's TEMP directory.
for (const directory of fixtureDirectories) {
  assert.equal(dirname(realpathSync(directory)), realpathSync(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
}
console.log("[test-supervisor-handoff] ok");
