import assert from "node:assert/strict";
import { reapOrphanedVitest } from "./lib/vitest-process-policy.mjs";

const now = Date.now();
const testProcess = {
  pid: 101,
  parentPid: 100,
  name: "node.exe",
  commandLine: 'node "C:\\repo\\node_modules\\vitest\\vitest.mjs" run',
  processStartedAt: new Date(now - 7_200_000).toISOString(),
  cpuSec: 3600,
};
const parent = {
  pid: 100,
  parentPid: 99,
  name: "cmd.exe",
  commandLine: "cmd /c pnpm fuzz",
};
function run(snapshots, options = {}) {
  const stopped = [];
  let index = 0;
  const result = reapOrphanedVitest({
    readProcesses: () => snapshots[Math.min(index++, snapshots.length - 1)],
    inspectParent: () => "dead",
    killProcess: (pid) => stopped.push(pid),
    protectedPids: new Set(),
    now,
    ...options,
  });
  return { stopped, result };
}
const retained = (snapshots, options) => {
  const { stopped, result } = run(snapshots, options);
  assert.deepEqual(stopped, []);
  assert.deepEqual(result, []);
};

// Regression: a healthy fuzz worker exceeded CPU=600s and age=1800s and
// previously matched both independent reapers despite its living parent.
retained([[testProcess, parent]]);
retained([[testProcess]], { inspectParent: () => "alive" });
retained([[testProcess]], { inspectParent: () => "unknown" });
retained([[]]);
retained([[testProcess]], {
  readProcesses: () => {
    throw Error("access denied");
  },
});
retained([[{ ...testProcess, processStartedAt: null }]]);
retained([[{ ...testProcess, processStartedAt: new Date(now).toISOString() }]]);
retained([[{ ...testProcess, parentPid: 0 }]]);
retained([[testProcess]], { protectedPids: new Set([101]) });

// A live lease coordinator can own descendants through an exited shell.
for (const commandLine of [
  "node scripts/harness/run-gates.mjs --profile full",
  "node scripts/run-fuzz.mjs",
  "node scripts/worker-codex-stream.mjs --lock-token owner",
  "node scripts/spawn-verifier.mjs",
  "pwsh -File scripts/auto-merge.ps1",
  null,
]) {
  const coordinator = { ...parent, pid: 500, commandLine };
  retained([[testProcess, coordinator]]);
  retained([[testProcess], [testProcess, coordinator]]);
}

// PID reuse, parent appearance, changed command and incomplete second census
// must all preserve the candidate. No process or lease is mutated by fixtures.
retained([
  [testProcess],
  [{ ...testProcess, processStartedAt: new Date(now).toISOString() }],
]);
retained([[testProcess], [testProcess, parent]]);
retained([[testProcess], [{ ...testProcess, commandLine: "node other.js" }]]);
retained([[testProcess], []]);
retained([[testProcess], [{ ...testProcess, parentPid: 200 }]]);
retained([[testProcess], [{ ...testProcess, name: "other.exe" }]]);
retained([[testProcess]], { killProcess: () => false });
let parentChecks = 0;
retained([[testProcess]], {
  inspectParent: () => (++parentChecks === 1 ? "dead" : "alive"),
});

const orphan = run([[testProcess]]);
assert.deepEqual(orphan.stopped, [101]);
assert.equal(orphan.result[0].reason.startsWith("confirmed-orphan"), true);
const dry = run([[testProcess]], { dryRun: true });
assert.deepEqual(dry.stopped, []);
assert.equal(dry.result.length, 1);
console.log(
  "vitest process policy: passed (live/unknown owners, coordinator leases, PID reuse, orphan and dry-run)"
);
