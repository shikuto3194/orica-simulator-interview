import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertContained,
  compactStorage,
  summarizeStorage,
  stringifyMachineJson,
  inspectStorage,
  maintainStorage,
  policy,
} from "./artifact-storage.mjs";
const base = mkdtempSync(join(tmpdir(), "orica-storage-test-"));
const hub = join(base, "hub"),
  worker = join(base, "worker");
const old = new Date(Date.now() - 48 * 3600000);
const context = {
  hub,
  roots: [hub, worker],
  policy: {
    ...policy,
    warningGiB: 0,
    maximumGiB: 1,
    targetGiB: 0,
    minimumFreeGiB: 0,
    warningFreeGiB: 0,
    keepLatestRuns: 1,
  },
};
function json(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
function run(root, name, { recent = false, bucket = "effect-debug" } = {}) {
  const dir = join(root, "artifacts", bucket, name);
  mkdirSync(join(dir, "replays"), { recursive: true });
  writeFileSync(join(dir, "replays", "game.json"), "x".repeat(100));
  writeFileSync(join(dir, "frames.jsonl"), "y".repeat(100));
  json(join(dir, "metrics.json"), { clean: true });
  json(join(dir, "checkpoint.json"), { completedGameIndexes: [0] });
  if (!recent)
    for (const p of [
      join(dir, "replays", "game.json"),
      join(dir, "frames.jsonl"),
      join(dir, "metrics.json"),
      join(dir, "checkpoint.json"),
      dir,
    ])
      utimesSync(p, old, old);
  return dir;
}
try {
  const machineSummary = summarizeStorage({
    context,
    now: Date.now(),
    bytes: 1,
    logicalBytes: 1,
    freeBytes: 1,
    status: "warning",
    selected: [],
    runs: Array.from({ length: 1000 }, (_, i) => ({
      path: "run-" + i,
      bytes: i,
      reasons: ["referenced-evidence"],
    })),
  });
  assert.equal(machineSummary.protectedCount, 1000);
  assert.equal(machineSummary.protected.length, 20);
  assert.equal(machineSummary.protectedTruncated, true);
  const transport = stringifyMachineJson(machineSummary);
  assert.ok([...transport].every((char) => char.charCodeAt(0) <= 127));
  assert.deepEqual(JSON.parse(transport), machineSummary);
  json(join(hub, "autorun-queue", "cluster-registry.json"), {
    clusters: [
      {
        status: "open",
        queueRefs: ["artifacts/effect-debug/evidence/tickets/t.md"],
      },
    ],
  });
  json(join(worker, "autorun-queue", "cluster-registry.json"), {
    clusters: [],
  });
  const obsolete = run(hub, "obsolete");
  const issueEvidence = run(hub, "issue-evidence");
  const followupEvidence = run(worker, "followup-evidence");
  const directoryEvidence = run(hub, "directory-evidence");
  const caseEvidence = run(worker, "CASE-EVIDENCE");
  const spacedEvidence = run(hub, "evidence with spaces");
  const encodedEvidence = run(worker, "encoded evidence");
  const bracketEvidence = run(hub, "bracket-evidence");
  mkdirSync(join(hub, "issues"), { recursive: true });
  writeFileSync(
    join(hub, "issues", "active.md"),
    [
      "Evidence: `artifacts/effect-debug/issue-evidence/replays/game.json`",
      "[run](artifacts/effect-debug/directory-evidence)",
      "[artifacts/effect-debug/bracket-evidence]",
      "`artifacts/effect-debug/evidence with spaces/replays/game.json`",
      "[encoded](artifacts/effect-debug/encoded%20evidence)",
      "Reproduces 100% of the time.",
      process.platform === "win32"
        ? "[case](ARTIFACTS/EFFECT-DEBUG/case-evidence)"
        : "[case](artifacts/effect-debug/CASE-EVIDENCE)",
      // A longer, unrelated name must not retain the obsolete run.
      "`artifacts/effect-debug/obsolete-longer/replays/game.json`",
    ].join("\n")
  );
  json(
    join(worker, "logs", "codex-supervisor-followups", "pending", "work.json"),
    {
      prompt:
        "Inspect `artifacts/effect-debug/followup-evidence/replays/game.json`",
    }
  );
  const evidence = run(hub, "evidence"),
    counterpart = run(worker, "evidence");
  const recent = run(hub, "recent", { recent: true });
  const active = run(worker, "active");
  json(join(active, ".storage-writer.json"), { pid: process.pid });
  utimesSync(join(active, ".storage-writer.json"), old, old);
  utimesSync(active, old, old);
  run(worker, "newest", { recent: true });
  const checkpoint = run(hub, "model", { bucket: "policy-shadow" });
  json(join(evidence, "metrics.json"), {
    policyCheckpoint: checkpoint + "/checkpoint.json",
  });
  utimesSync(join(evidence, "metrics.json"), old, old);
  const before = inspectStorage(context);
  assert.ok(before.selected.some((item) => item.path === obsolete));
  for (const path of [
    evidence,
    counterpart,
    recent,
    active,
    checkpoint,
    issueEvidence,
    followupEvidence,
    directoryEvidence,
    caseEvidence,
    spacedEvidence,
    encodedEvidence,
    bracketEvidence,
  ])
    assert.ok(!before.selected.some((item) => item.path === path), path);
  assert.ok(
    existsSync(join(obsolete, "replays", "game.json")),
    "inspection is read-only"
  );
  const cleaned = maintainStorage(context);
  assert.equal(cleaned.removedFiles, 2);
  assert.equal(cleaned.removedDirectories, 1);
  assert.ok(!existsSync(join(obsolete, "replays")));
  assert.ok(!existsSync(join(obsolete, "replays", "game.json")));
  for (const name of [
    "checkpoint.json",
    "metrics.json",
    ".storage-pruned.json",
  ])
    assert.ok(existsSync(join(obsolete, name)));
  for (const path of [
    evidence,
    counterpart,
    recent,
    active,
    checkpoint,
    issueEvidence,
    followupEvidence,
    directoryEvidence,
    caseEvidence,
    spacedEvidence,
    encodedEvidence,
    bracketEvidence,
  ])
    assert.ok(existsSync(join(path, "replays", "game.json")), path);
  assert.equal(maintainStorage(context).removedFiles, 0);

  // Empty-only cleanup works below limits and preserves files and run roots.
  mkdirSync(join(obsolete, "replays", "nested"), { recursive: true });
  mkdirSync(join(obsolete, "games"), { recursive: true });
  writeFileSync(join(obsolete, "games", "keep.json"), "keep");
  for (const path of [active, recent, evidence]) mkdirSync(join(path, "empty"));
  const roomy = {
    ...context,
    policy: { ...context.policy, targetGiB: 100, warningGiB: 150 },
  };
  assert.equal(inspectStorage(roomy).selected.length, 0);
  assert.ok(existsSync(join(obsolete, "replays", "nested")));
  const runMtime = lstatSync(obsolete).mtimeMs;
  const emptyCleaned = maintainStorage(roomy, { emptyOnly: true });
  assert.ok(Math.abs(lstatSync(obsolete).mtimeMs - runMtime) < 1);
  assert.equal(emptyCleaned.removedFiles, 0);
  assert.equal(emptyCleaned.removedDirectories, 2);
  assert.ok(!existsSync(join(obsolete, "replays")));
  assert.equal(
    readFileSync(join(obsolete, "games", "keep.json"), "utf8"),
    "keep"
  );
  for (const path of [active, recent, evidence])
    assert.ok(existsSync(join(path, "empty")));
  assert.ok(existsSync(obsolete));
  assert.equal(
    maintainStorage(roomy, { emptyOnly: true }).removedDirectories,
    0
  );
  assert.ok(
    readFileSync(emptyCleaned.auditPath, "utf8").includes("emptyDirectory")
  );

  // Empty-only must not delete bulk files even with a pending capacity plan.
  const bulkKept = run(hub, "empty-only-bulk-kept");
  assert.ok(inspectStorage(context).selected.some((r) => r.path === bulkKept));
  assert.equal(maintainStorage(context, { emptyOnly: true }).removedFiles, 0);
  assert.ok(existsSync(join(bulkKept, "replays", "game.json")));
  writeFileSync(
    join(hub, "issues", "empty-only-kept.md"),
    "artifacts/effect-debug/empty-only-bulk-kept/replays/game.json"
  );

  // A file created after the emptiness check must survive non-recursive rmdir.
  const raced = join(obsolete, "raced");
  mkdirSync(raced);
  const originalRmdir = fs.rmdirSync;
  fs.rmdirSync = (path, ...args) => {
    if (path === raced) writeFileSync(join(raced, "new.json"), "new");
    return originalRmdir(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(
      maintainStorage(roomy, { emptyOnly: true }).removedDirectories,
      0
    );
    assert.equal(readFileSync(join(raced, "new.json"), "utf8"), "new");
  } finally {
    fs.rmdirSync = originalRmdir;
    syncBuiltinESMExports();
  }

  // A collector can publish a new dependency between the plan and deletion.
  // Intercept the capacity probe after initial reference expansion to exercise
  // that race with real files, without adding test hooks to the cleanup API.
  const lateDependency = run(hub, "late-dependency");
  assert.ok(
    inspectStorage(context).selected.some(
      (item) => item.path === lateDependency
    )
  );
  const originalStatfs = fs.statfsSync;
  let published = false;
  fs.statfsSync = (...args) => {
    if (!published) {
      published = true;
      json(join(recent, "metrics.json"), {
        evidence: "artifacts/effect-debug/late-dependency/replays/game.json",
      });
    }
    return originalStatfs(...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(maintainStorage(context).removedFiles, 0);
    assert.ok(published);
    assert.ok(existsSync(join(lateDependency, "replays", "game.json")));
  } finally {
    fs.statfsSync = originalStatfs;
    syncBuiltinESMExports();
  }

  if (process.platform === "win32") {
    const retained = run(hub, "compact-retained");
    const payload = "lossless retained evidence ".repeat(100000);
    const file = join(retained, "replays", "game.json");
    writeFileSync(file, payload);
    utimesSync(file, old, old);
    const before = inspectStorage(context);
    assert.ok(compactStorage(context).compactFiles > 0);
    const compacted = compactStorage(context, true);
    assert.ok(compacted.compactedFiles > 0);
    assert.equal(readFileSync(file, "utf8"), payload);
    const after = inspectStorage(context);
    assert.ok(after.bytes < before.bytes);
    assert.equal(after.logicalBytes, before.logicalBytes);
    assert.equal(compactStorage(context).compactFiles, 0);
    const gzipFile = join(retained, "games.trace.jsonl.gz");
    writeFileSync(gzipFile, "compressed-format");
    assert.ok(
      inspectStorage(context)
        .runs.find((run) => run.path === retained)
        .files.some((file) => file.path === gzipFile)
    );
  }

  assert.throws(() => assertContained(hub, worker), /unsafe/);
  assert.throws(() => assertContained(hub, hub), /unsafe/);
  const external = join(base, "outside");
  mkdirSync(external);
  writeFileSync(join(external, "keep.jsonl"), "must survive");
  const linked = join(hub, "artifacts", "effect-debug", "escape");
  symlinkSync(
    external,
    linked,
    process.platform === "win32" ? "junction" : "dir"
  );
  assert.throws(() => inspectStorage(context), /linked/);
  assert.equal(
    readFileSync(join(external, "keep.jsonl"), "utf8"),
    "must survive"
  );
  rmSync(linked);
  writeFileSync(join(hub, "autorun-queue", "cluster-registry.json"), "broken");
  assert.throws(() => maintainStorage(context), /JSON|Unexpected/);
  assert.ok(existsSync(join(evidence, "replays", "game.json")));
  console.log(
    "[test-artifact-storage] passed: evidence, Markdown/Windows/encoded/follow-up references, concurrent dependencies, checkpoints, writer, age, junctions, boundaries, malformed metadata, idempotence"
  );
} finally {
  rmSync(base, { recursive: true, force: true });
}
