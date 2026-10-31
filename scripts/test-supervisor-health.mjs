import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { clearTimeout, setTimeout } from "node:timers";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { collectSupervisorHealth } from "./supervisor-health.mjs";
import { recordAutoMerge } from "./auto-merge-status.mjs";
import { gateLeasePath } from "./harness/gate-lease.mjs";
import { buildVerificationTree } from "./verifier-tree.mjs";
import { readWindowsProcesses } from "./harness/recover-gate-lease.mjs";

const temp = mkdtempSync(join(tmpdir(), "orica-health-"));
if (
  !resolve(temp).startsWith(resolve(tmpdir()) + "/") &&
  !resolve(temp).startsWith(resolve(tmpdir()) + "\\")
)
  throw Error("Unexpected fixture root");
const repo = join(temp, "repo"),
  lane = join(temp, "lane"),
  remote = join(temp, "remote.git");
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const save = (file, data) => {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
};
const now = Date.now(),
  start = new Date(now - 3 * 3600000).toISOString();
const rows = [
  {
    pid: 2,
    parentPid: 1,
    name: "node.exe",
    processStartedAt: start,
    commandLine: `node worker-codex-stream.mjs --label supervisor --workdir ${lane} --lock-token owner-token`,
  },
  { pid: 3, parentPid: 2, name: "codex.exe", commandLine: `codex -C ${lane}` },
];
let lease;
try {
  if (process.platform === "win32") {
    // CP932's trailing 0x5c in 表 can break JSON; Greek and non-BMP text also
    // expose lossy decoding even if the census happens to remain parseable.
    // Inspect only this owned child and never print any process command line.
    const sentinel = "ORICA_日本語_表現_α_🙂_END";
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdout.write('ready'); process.stdin.resume();",
        sentinel,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    const exited = once(child, "exit");
    try {
      await once(child.stdout, "data");
      const row = readWindowsProcesses().find(
        (process) => process.pid === child.pid
      );
      assert(
        row?.commandLine?.includes(sentinel),
        "Windows census must preserve Unicode command arguments"
      );
      assert.equal(row.parentPid, process.pid);
    } finally {
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "health fixture");
  git(repo, "config", "user.email", "health@example.invalid");
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  writeFileSync(join(repo, ".gitignore"), "logs/\n.verifier*\n");
  const pin = {
    schemaVersion: 1,
    workerWorktree: "../lane",
    workerRef: "refs/heads/lane",
    integrationWorktree: ".",
    integrationRef: "refs/heads/main",
  };
  save(join(repo, "scripts/full-run-checkouts.json"), pin);
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");
  git(repo, "worktree", "add", "-b", "lane", lane);
  writeFileSync(join(lane, "pending.txt"), "kept\n");
  const ticketId = randomUUID();
  const stateFile = join(repo, "logs/codex-supervisor-state.json"),
    ticketFile = join(repo, "logs/supervisor-integrations", ticketId + ".json");
  const runner = {
    label: "supervisor",
    runnerPid: 2,
    runId: "run-current",
    integrationRequest: ticketFile,
    status: "running",
    startedAt: start,
    threadId: "thread-current",
    model: "gpt-6.1-sol",
    reasoningEffort: "xhigh",
    recentEvents: [
      {
        at: new Date(now - 60000).toISOString(),
        text: "item.completed: file_change: scripts/repair.mjs",
      },
      {
        at: new Date(now).toISOString(),
        text: "item.completed: command: Get-Content logs/harness/latest.json",
      },
      { at: new Date(now).toISOString(), text: "lock heartbeat refreshed" },
    ],
  };
  save(stateFile, runner);
  save(join(repo, "logs/supervisor-runs/current.json"), {
    runId: "run-current",
    startedAt: start,
    workdir: lane,
    before: { pending: ["one"] },
  });
  const ticket = {
    schemaVersion: 1,
    runId: ticketId,
    file: ticketFile,
    workdir: lane,
    status: "idle",
  };
  save(ticketFile, ticket);
  const head = git(repo, "rev-parse", "HEAD");
  save(join(repo, "logs/supervisor-integrations/old-success.json"), {
    workdir: lane,
    status: "completed",
    head,
    remoteHead: head,
    finishedAt: new Date(now - 4 * 3600000).toISOString(),
  });
  const collect = (extra = {}) =>
    collectSupervisorHealth({ repo, now, processes: rows, ...extra });
  let h = collect();
  assert.equal(h.runId, "run-current");
  assert.equal(h.integration.phase, "awaiting_worker");
  assert.equal(h.progress.startPending, 1);
  assert.equal(h.progress.endPending, null);
  assert(h.alerts.some((a) => a.code === "integration_progress_overdue"));
  assert.equal(h.progress.lastWorkAt, new Date(now - 60000).toISOString());
  assert.equal(h.lane.dirtyFiles, 1);
  assert.equal(h.health, "watch");
  assert(!h.alerts.some((a) => a.code === "primary_unavailable"));
  const watcher = fileURLToPath(
    new URL("./watch-supervisor-events.mjs", import.meta.url)
  );
  // Exercise the CLI consumer, including runner completion before publication.
  for (const status of [
    "completed",
    "worker_completed",
    "publication_pending",
    "failed",
    "lock_lost",
    "stale",
    "running",
    "integrating",
  ]) {
    save(stateFile, { ...runner, status });
    const terminal = !["running", "integrating"].includes(status);
    const watched = spawnSync(
      process.execPath,
      [
        watcher,
        "--state",
        stateFile,
        "--exit-on-finish",
        "--no-color",
        "--interval-ms",
        "250",
      ],
      {
        cwd: temp,
        encoding: "utf8",
        windowsHide: true,
        timeout: terminal ? 5000 : 1500,
      }
    );
    assert(
      watched.stdout.includes(`[${status}]`),
      watched.stdout + watched.stderr
    );
    if (terminal) {
      assert.equal(watched.error, undefined);
      assert.equal(watched.status, 0);
    } else {
      assert.equal(
        watched.error?.code,
        "ETIMEDOUT",
        `${status} must keep watching`
      );
    }
  }
  save(stateFile, runner);
  for (const options of [[], ["--repo", repo], ["--state", stateFile]]) {
    const observed = spawnSync(
      process.execPath,
      [watcher, "--once", "--json", ...options],
      {
        cwd: options.length ? temp : lane,
        encoding: "utf8",
        windowsHide: true,
      }
    );
    const cliSnapshot = JSON.parse(observed.stdout);
    assert.equal(cliSnapshot.runId, "run-current");
    assert.equal(cliSnapshot.main.worktree, repo);
  }
  const missingGit = spawnSync(
    process.execPath,
    [watcher, "--once", "--json"],
    {
      cwd: temp,
      encoding: "utf8",
      windowsHide: true,
    }
  );
  const missingGitSnapshot = JSON.parse(missingGit.stdout);
  assert.equal(missingGit.status, 1);
  assert.equal(missingGitSnapshot.main, null);
  assert(
    missingGitSnapshot.alerts.some((a) => a.code === "main_inspection_failed")
  );
  // Hub discovery must survive the same main abnormalities the snapshot reports.
  // Keep these mutations confined to this temporary Git fixture.
  const integration = join(temp, "integration");
  git(repo, "switch", "-c", "monitor-abnormal");
  git(repo, "worktree", "add", integration, "main");
  try {
    const integrationPin = { ...pin, integrationWorktree: "../integration" };
    save(join(integration, "scripts/full-run-checkouts.json"), integrationPin);
    const abnormalSnapshot = () => {
      const before = git(repo, "worktree", "list", "--porcelain");
      const observed = spawnSync(
        process.execPath,
        [watcher, "--once", "--json"],
        {
          cwd: lane,
          encoding: "utf8",
          windowsHide: true,
        }
      );
      const snapshot = JSON.parse(observed.stdout);
      assert.equal(observed.status, 1);
      assert(["attention", "unknown"].includes(snapshot.health));
      assert.equal(snapshot.runId, "run-current");
      assert.equal(snapshot.main, null);
      assert(snapshot.alerts.some((a) => a.code === "main_inspection_failed"));
      assert.equal(git(repo, "worktree", "list", "--porcelain"), before);
    };
    git(repo, "worktree", "lock", "--reason", "monitor fixture", integration);
    try {
      abnormalSnapshot();
      const unavailable = collect({
        processes: null,
        readProcesses: () => {
          throw Error("fixture process census unavailable");
        },
      });
      assert.equal(unavailable.processes.censusAvailable, false);
      assert.equal(unavailable.health, "unknown");
      assert(
        unavailable.alerts.some((a) => a.code === "main_inspection_failed")
      );
    } finally {
      git(repo, "worktree", "unlock", integration);
    }
    save(join(integration, "scripts/full-run-checkouts.json"), pin);
    abnormalSnapshot();
    save(join(integration, "scripts/full-run-checkouts.json"), integrationPin);
    const moved = join(temp, "integration-moved");
    renameSync(integration, moved);
    try {
      assert(git(repo, "worktree", "list", "--porcelain").includes("prunable"));
      abnormalSnapshot();
    } finally {
      renameSync(moved, integration);
    }
  } finally {
    save(join(integration, "scripts/full-run-checkouts.json"), pin);
    git(repo, "worktree", "remove", integration);
    git(repo, "switch", "main");
  }
  const inspectionRows = [
    ...rows,
    {
      pid: 8,
      parentPid: 3,
      name: "pwsh.exe",
      commandLine: `pwsh -Command "Get-Content ${lane}/scripts/auto-merge.ps1; Get-Content scripts/test-regression.mjs"`,
    },
    {
      pid: 7,
      parentPid: 3,
      name: "node.exe",
      commandLine: `node -e "console.log('scripts/test-regression.mjs')"`,
    },
    {
      pid: 6,
      parentPid: 3,
      name: "node.exe",
      commandLine: `node worker-codex-stream.mjs --label verifier --workdir ${lane}`,
    },
  ];
  h = collect({ processes: inspectionRows });
  assert.equal(h.integration.phase, "awaiting_worker");
  assert.deepEqual(h.processes.runnerPids, [2]);
  assert.equal(h.processes.validators.length, 0);

  const mcpEntry = 'node "C:/cache/node_modules/@playwright/mcp/cli.js"';
  for (const commandLine of [
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" -y @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" --yes=true @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" --yes=false @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" --no-install=true @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" --no-install=false @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" --quiet @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" --loglevel=error @playwright/mcp@latest',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" exec --quiet -- @playwright/mcp@latest',
    'node "C:/cache/pnpm.cjs" dlx @playwright/mcp@latest',
  ]) {
    h = collect({
      processes: [
        ...rows,
        { pid: 30, parentPid: 3, name: "node.exe", commandLine },
        { pid: 31, parentPid: 30, name: "node.exe", commandLine: mcpEntry },
      ],
    });
    assert.equal(h.validation.status, "free");
    assert.deepEqual(h.processes.validators, []);
    assert.equal(h.integration.phase, "awaiting_worker");
  }
  h = collect({
    processes: [
      ...rows,
      {
        pid: 30,
        parentPid: 3,
        name: "node.exe",
        commandLine: 'node "C:\\cache\\node_modules\\@playwright\\mcp\\cli.js"',
      },
    ],
  });
  assert.deepEqual(h.processes.validators, []);
  assert.equal(h.integration.phase, "awaiting_worker");

  // A launcher alone is preparing; an actual test child establishes validation.
  const playwrightEntry = 'node "C:/cache/node_modules/playwright/cli.js" test';
  for (const commandLine of [
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" playwright test',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" -p @playwright/mcp@latest playwright test',
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" exec -- playwright test',
    'node "C:/cache/pnpm.cjs" exec playwright test',
  ]) {
    const launcher = { pid: 30, parentPid: 3, name: "node.exe", commandLine };
    h = collect({ processes: [...rows, launcher] });
    assert.deepEqual(h.processes.validators, []);
    assert.equal(h.integration.phase, "awaiting_worker");
    h = collect({
      processes: [
        ...rows,
        launcher,
        {
          pid: 31,
          parentPid: 30,
          name: "node.exe",
          commandLine: playwrightEntry,
        },
      ],
    });
    assert.deepEqual(
      h.processes.validators.map((v) => v.pid),
      [31]
    );
    assert.equal(h.processes.validators[0].kind, "regression_or_style");
    assert.equal(h.integration.phase, "worker_validating");
  }
  for (const commandLine of [
    playwrightEntry,
    'node "C:/cache/node_modules/@playwright/test/cli.js" test',
  ]) {
    h = collect({
      processes: [
        ...rows,
        { pid: 30, parentPid: 3, name: "node.exe", commandLine },
      ],
    });
    assert.equal(h.processes.validators.length, 1);
    assert.equal(h.processes.validators[0].kind, "regression_or_style");
    assert.equal(h.integration.phase, "worker_validating");
  }
  const neighboringLaneRows = [
    ...rows,
    {
      ...rows[0],
      pid: 10,
      commandLine: `node worker-codex-stream.mjs --label supervisor --workdir "${lane}-other"`,
    },
    {
      pid: 11,
      parentPid: 10,
      name: "codex.exe",
      commandLine: `codex -C "${lane}-other"`,
    },
    {
      pid: 5,
      parentPid: 1,
      name: "pwsh.exe",
      processStartedAt: start,
      commandLine: `pwsh -File auto-merge.ps1 -Worktree "${lane}-other"`,
    },
    {
      pid: 12,
      parentPid: 5,
      name: "node.exe",
      processStartedAt: start,
      commandLine: `node ${lane}-other/scripts/harness/run-gates.mjs`,
    },
  ];
  h = collect({ processes: neighboringLaneRows });
  assert.equal(h.integration.phase, "awaiting_worker");
  assert.deepEqual(h.processes.runnerPids, [2]);
  assert.deepEqual(h.processes.codexPids, [3]);
  assert.deepEqual(h.processes.integrationPids, []);
  assert.deepEqual(h.processes.validators, []);
  assert(!h.alerts.some((a) => a.code === "duplicate_workers"));
  h = collect({ processes: [...rows, { ...rows[0], pid: 10 }] });
  assert(h.alerts.some((a) => a.code === "duplicate_workers"));
  save(stateFile, { ...runner, runnerPid: 999 });
  assert(collect().alerts.some((a) => a.code === "worker_identity_mismatch"));
  save(stateFile, runner);
  h = collect({ processes: [{ ...rows[0], commandLine: null }, rows[1]] });
  assert.equal(h.health, "unknown");
  assert(h.alerts.some((a) => a.code === "worker_identity_unavailable"));
  assert(
    !h.alerts.some(
      (a) =>
        a.code === "worker_process_missing" ||
        a.code === "worker_identity_mismatch"
    )
  );
  h = collect({
    processes: [
      { ...rows[0], processStartedAt: new Date(now).toISOString() },
      rows[1],
    ],
  });
  assert(h.alerts.some((a) => a.code === "worker_identity_mismatch"));
  save(stateFile, { ...runner, status: "completed" });
  assert(
    collect({ processes: [] }).alerts.some(
      (a) => a.code === "unintegrated_completion"
    )
  );
  save(stateFile, runner);
  rmSync(join(lane, "pending.txt"));
  save(stateFile, { ...runner, status: "completed" });
  h = collect({ processes: [] });
  assert.equal(h.health, "observed");
  assert.equal(h.integration.phase, "idle");
  writeFileSync(join(lane, "pending.txt"), "kept\n");
  save(stateFile, runner);
  const unchanged = collect();
  h = collect({
    previous: {
      ...unchanged,
      observedAtUTC: new Date(now - 15 * 60000).toISOString(),
      progressUnchangedSince: new Date(now - 25 * 60000).toISOString(),
    },
  });
  assert(h.alerts.some((a) => a.code === "progress_unchanged"));
  for (const command of [
    "rg --files",
    `git -C ${lane} status --porcelain`,
    "node scripts/watch-supervisor-events.mjs --once --json",
  ]) {
    save(stateFile, {
      ...runner,
      recentEvents: [
        ...runner.recentEvents,
        {
          at: new Date(now).toISOString(),
          text: "item.completed: command: " + command,
        },
      ],
    });
    const stalled = collect({
      previous: {
        ...unchanged,
        progressUnchangedSince: new Date(now - 25 * 60000).toISOString(),
      },
    });
    assert.equal(stalled.progressToken, unchanged.progressToken);
    assert(stalled.alerts.some((a) => a.code === "progress_unchanged"));
  }
  save(stateFile, runner);
  writeFileSync(join(lane, "pending.txt"), "real source repair\n");
  assert.notEqual(collect().progressToken, unchanged.progressToken);
  writeFileSync(join(lane, "pending.txt"), "kept\n");
  git(lane, "add", "pending.txt");
  git(lane, "commit", "-m", "lane progress one");
  const cleanBefore = collect();
  assert.equal(cleanBefore.lane.dirtyFiles, 0);
  writeFileSync(join(lane, "next.txt"), "next repair\n");
  git(lane, "add", "next.txt");
  git(lane, "commit", "-m", "lane progress two");
  h = collect({
    previous: {
      ...cleanBefore,
      progressUnchangedSince: new Date(now - 25 * 60000).toISOString(),
    },
  });
  assert.equal(h.lane.dirtyFiles, 0);
  assert.notEqual(h.progressToken, cleanBefore.progressToken);
  assert(!h.alerts.some((a) => a.code === "progress_unchanged"));
  const staleFile = join(repo, "logs/auto-merge-runs/stale.json");
  save(staleFile, {
    id: "stale",
    pid: 5,
    workdir: lane,
    status: "running",
    phase: "pushing",
    startedAt: new Date(now - 4 * 3600000).toISOString(),
  });
  h = collect({
    processes: [
      ...rows,
      {
        pid: 5,
        parentPid: 1,
        name: "chrome.exe",
        commandLine: "chrome",
        processStartedAt: new Date(now).toISOString(),
      },
    ],
  });
  assert.equal(h.integration.phase, "awaiting_worker");
  assert.equal(h.health, "attention");
  assert(!h.processes.integrationPids.includes(5));
  assert(h.alerts.some((a) => a.code === "previous_attempt_unfinished"));
  rmSync(staleFile);
  const invalidSuccess = join(
    repo,
    "logs/supervisor-integrations/invalid.json"
  );
  save(invalidSuccess, {
    workdir: lane,
    status: "completed",
    finishedAt: new Date(now).toISOString(),
  });
  assert(collect().alerts.some((a) => a.code === "invalid_success_record"));
  rmSync(invalidSuccess);
  h = collect({ processes: [] });
  assert.equal(h.health, "attention");
  assert(h.alerts.some((a) => a.code === "worker_process_missing"));
  h = collectSupervisorHealth({
    repo,
    now,
    readProcesses: () => {
      throw Error("access denied");
    },
  });
  assert.equal(h.health, "unknown");
  assert.equal(h.processes.censusAvailable, false);
  assert(!h.alerts.some((a) => a.code === "worker_process_missing"));
  save(ticketFile, {
    ...ticket,
    status: "requested",
    requestedAt: new Date(now - 11 * 60000).toISOString(),
  });
  h = collect();
  assert.equal(h.integration.phase, "handoff_wait");
  assert(h.alerts.some((a) => a.code === "handoff_overdue"));
  assert(!h.alerts.some((a) => a.code === "previous_integration_unfinished"));
  save(ticketFile, {
    ...ticket,
    status: "requested",
    requestedAt: new Date(now - 60000).toISOString(),
  });
  h = collect();
  assert(!h.alerts.some((a) => a.code === "handoff_overdue"));
  assert(!h.alerts.some((a) => a.severity === "error"));
  save(ticketFile, { ...ticket, status: "running" });
  assert(
    collect().alerts.some((a) => a.code === "integration_process_missing")
  );
  assert.equal(
    collect({
      processes: [
        ...rows,
        {
          pid: 5,
          parentPid: 2,
          name: "pwsh.exe",
          processStartedAt: new Date(now - 60000).toISOString(),
          commandLine: `pwsh -NoProfile -File auto-merge.ps1 -Worktree ${lane}`,
        },
      ],
    }).integration.phase,
    "integrating"
  );
  save(ticketFile, ticket);
  lease = gateLeasePath(repo);
  const gateRows = [
    ...rows,
    {
      pid: 4,
      parentPid: 3,
      name: "node.exe",
      processStartedAt: new Date(now - 45 * 60000).toISOString(),
      commandLine: `node ${lane}/scripts/harness/codex-finish-check.mjs`,
    },
  ];
  save(lease, {
    pid: 4,
    token: "kept-lease",
    root: lane,
    started: now - 40 * 60000,
  });
  mkdirSync(join(lane, "logs/harness/output"), { recursive: true });
  writeFileSync(
    join(lane, "logs/harness/output/current-4-gate.log"),
    "progress\n"
  );
  writeFileSync(
    join(lane, "logs/harness/latest.json"),
    "invalid active receipt must not be read"
  );
  h = collect({ processes: gateRows });
  assert.equal(h.integration.phase, "worker_validating");
  assert(h.alerts.some((a) => a.code === "long_validation"));
  assert.equal(h.activeHarnessReceiptRead, false);
  assert(!h.alerts.some((a) => a.code === "validation_inspection_failed"));
  const beforeToken = h.progressToken;
  writeFileSync(
    join(lane, "logs/harness/output/current-4-gate.log"),
    "more progress\n"
  );
  assert.notEqual(collect({ processes: gateRows }).progressToken, beforeToken);
  h = collect({ processes: gateRows });
  assert(!h.alerts.some((a) => a.code === "integration_progress_overdue"));
  assert(
    h.alerts.some(
      (a) => a.code === "integration_age_context" && a.severity === "info"
    )
  );
  const stalledValidation = collect({
    processes: gateRows,
    previous: {
      ...h,
      progressUnchangedSince: new Date(now - 25 * 60000).toISOString(),
    },
  });
  assert(
    stalledValidation.alerts.some(
      (a) => a.code === "integration_progress_overdue"
    )
  );
  assert(stalledValidation.alerts.some((a) => a.code === "progress_unchanged"));
  save(lease, { pid: 9, token: "kept-lease", root: lane, started: now });
  assert.equal(
    collect({
      processes: [
        ...gateRows,
        {
          pid: 9,
          parentPid: 1,
          name: "node.exe",
          processStartedAt: new Date(now - 60000).toISOString(),
          commandLine: `node ${lane}/scripts/harness/run-gates.mjs`,
        },
      ],
    }).integration.phase,
    "validation_wait"
  );
  const leaseText = readFileSync(lease, "utf8");
  h = collect();
  assert.equal(h.validation.status, "orphaned");
  assert(h.alerts.some((a) => a.code === "validation_owner_missing"));
  assert.equal(readFileSync(lease, "utf8"), leaseText);
  save(lease, { root: lane, started: now });
  h = collect();
  assert(
    h.alerts.some(
      (a) =>
        a.code === "validation_inspection_failed" && a.severity === "unknown"
    )
  );
  assert.equal(h.validation.status, "unknown");
  writeFileSync(lease, "partial json");
  h = collect();
  assert.equal(h.validation.status, "unknown");
  assert(h.alerts.some((a) => a.code === "validation_inspection_failed"));
  for (const value of [null, false, 0, true, "text", []]) {
    save(lease, value);
    h = collect();
    assert.equal(h.validation.status, "unknown");
    assert(h.alerts.some((a) => a.code === "validation_inspection_failed"));
  }
  rmSync(lease);
  lease = null;
  // Durable completion metadata reports failure and review without trusting
  // command chatter or reading the active latest.json receipt.
  const runFile = join(lane, "logs/harness/runs/current.json");
  const outputLog = join(lane, "logs/harness/output/current-4-gate.log");
  const completion = {
    schemaVersion: 2,
    profile: "finish",
    root: lane,
    completionGate: true,
    startedAt: now - 120000,
    finishedAt: now - 60000,
    status: "failed",
    gates: [{ id: "handoff", status: "failed", outputLog }],
  };
  save(runFile, completion);
  h = collect();
  assert.equal(h.integration.phase, "worker_validation_failed");
  assert.equal(h.health, "attention");
  assert.deepEqual(h.validation.gateRun.failedGates, ["handoff"]);
  save(join(lane, "logs/harness/runs/targeted.json"), {
    ...completion,
    startedAt: now - 30000,
    status: "passed",
    completionGate: false,
  });
  assert.equal(collect().integration.phase, "worker_validation_failed");
  save(join(lane, "logs/harness/runs/targeted.json"), {
    ...completion,
    startedAt: now - 30000,
    status: "passed",
    gates: [],
  });
  assert.equal(collect().integration.phase, "worker_validation_failed");
  const blockedFile = join(
    lane,
    "logs/harness/runs/latest-finish-blocked.json"
  );
  save(blockedFile, {
    ...completion,
    startedAt: now - 30000,
    completionGate: false,
    gates: [],
  });
  assert.equal(collect().validation.gateRun.file, blockedFile);
  assert.equal(collect().integration.phase, "worker_validation_failed");
  rmSync(blockedFile);
  save(runFile, {
    ...completion,
    status: "passed",
    gates: [{ id: "handoff", status: "passed", outputLog }],
  });
  const contextFile = join(lane, ".verifier-context.json");
  const evidenceFile = join(lane, ".verifier-result.json");
  const untrackedName = "review-untracked.txt";
  const untrackedPath = join(lane, untrackedName);
  writeFileSync(untrackedPath, "reviewed untracked source\n");
  assert.equal(git(lane, "ls-files", "--", untrackedName), "");
  assert.equal(
    git(lane, "status", "--porcelain=v1", "--", untrackedName),
    "?? " + untrackedName
  );
  const context = {
    schemaVersion: 1,
    headTree: buildVerificationTree(lane).headTree,
    generatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  assert.equal(
    git(lane, "show", context.headTree + ":" + untrackedName),
    "reviewed untracked source"
  );
  save(contextFile, context);
  h = collect();
  assert.equal(h.integration.phase, "review_wait");
  assert.equal(h.review.headTree, context.headTree);
  assert.equal(h.validation.gateRun.passedGates, 1);
  assert(!h.alerts.some((a) => a.code === "integration_progress_overdue"));
  const reviewSnapshot = h;
  save(contextFile, {
    ...context,
    generatedAt: new Date(Date.parse(context.generatedAt) + 1000).toISOString(),
  });
  h = collect({
    previous: {
      ...reviewSnapshot,
      progressUnchangedSince: new Date(now - 25 * 60000).toISOString(),
    },
  });
  assert(h.alerts.some((a) => a.code === "progress_unchanged"));
  save(evidenceFile, {
    headTree: "b".repeat(40),
    refuted: 0,
    verifiedAt: new Date(Date.parse(context.generatedAt) + 2000).toISOString(),
  });
  assert.equal(collect().review.status, "waiting");
  save(evidenceFile, {
    headTree: context.headTree,
    refuted: 0,
    verifiedAt: new Date(Date.parse(context.generatedAt) + 2000).toISOString(),
  });
  assert.equal(collect().integration.phase, "awaiting_commit");
  // Deletions after a recorded review change the frozen target even though
  // the absent source has no mtime. A reviewed deletion is valid again.
  const trackedPath = join(lane, "tracked.txt");
  const trackedText = readFileSync(trackedPath, "utf8");
  const trackedStat = statSync(trackedPath);
  const frozenSnapshot = collect();
  rmSync(trackedPath);
  h = collect();
  assert.equal(h.review.status, "outdated");
  assert.equal(h.integration.phase, "awaiting_worker");
  assert.notEqual(h.progressToken, frozenSnapshot.progressToken);
  save(contextFile, {
    ...context,
    headTree: buildVerificationTree(lane).headTree,
  });
  assert.equal(collect().review.status, "waiting");
  writeFileSync(trackedPath, trackedText);
  utimesSync(trackedPath, trackedStat.atime, trackedStat.mtime);
  save(contextFile, context);
  // A staged rename also removes the old tracked path. Restoring its old
  // mtime must not hide the structural change from review observation.
  const renamedPath = join(lane, "renamed.txt");
  renameSync(trackedPath, renamedPath);
  git(lane, "add", "--", "tracked.txt", "renamed.txt");
  h = collect();
  assert.equal(h.review.status, "outdated");
  renameSync(renamedPath, trackedPath);
  git(lane, "restore", "--staged", "--", "tracked.txt", "renamed.txt");
  // This path is still untracked: deleting it disappears from status entirely.
  assert.equal(git(lane, "ls-files", "--", untrackedName), "");
  const untrackedText = readFileSync(untrackedPath, "utf8"),
    untrackedStat = statSync(untrackedPath);
  rmSync(untrackedPath);
  // A failed auto-merge exit 75 is a normal publication wait only when the
  // successful worker's durable attempt history binds the entire attempt.
  const waitId = randomUUID().replaceAll("-", "");
  const waitFile = join(repo, "logs/auto-merge-runs", waitId + ".json");
  const waitStarted = new Date(now - 60000).toISOString();
  const waitFinished = new Date(now - 30000).toISOString();
  const waitingAttempt = {
    id: waitId,
    repo,
    workdir: lane,
    branch: "lane",
    sourceHead: head,
    head: "b".repeat(40),
    status: "failed",
    exitCode: 75,
    startedAt: waitStarted,
    updatedAt: waitFinished,
    finishedAt: waitFinished,
    error: "validation lease busy",
  };
  const waitingTicket = {
    ...ticket,
    repo,
    branch: "lane",
    head,
    workerExitCode: 0,
    status: "waiting",
    exitCode: 75,
    attemptId: waitId,
    requestedAt: start,
    attempts: [
      {
        id: waitId,
        status: "waiting",
        exitCode: 75,
        startedAt: new Date(now - 61000).toISOString(),
        finishedAt: new Date(now - 29000).toISOString(),
      },
    ],
  };
  save(waitFile, waitingAttempt);
  save(ticketFile, waitingTicket);
  save(stateFile, { ...runner, status: "publication_pending" });
  h = collect({ processes: [] });
  assert.equal(h.integration.phase, "publication_pending");
  assert(!h.alerts.some((a) => a.code === "integration_failed"));
  const publicationBlockedFile = join(
    lane,
    "logs/harness/runs/publication-push-blocked.json"
  );
  const publicationBlocked = {
    schemaVersion: 2,
    root: lane,
    profile: "push",
    status: "failed",
    gates: [],
    requestedAt: now - 59000,
    startedAt: now - 59000,
    finishedAt: now - 31000,
    leaseWaitMs: 28000,
    durationMs: 0,
    failureCode: "VALIDATION_BUSY",
  };
  for (const profile of ["merge", "push"]) {
    save(publicationBlockedFile, { ...publicationBlocked, profile });
    h = collect({ processes: [] });
    assert.equal(h.integration.phase, "publication_pending");
    assert.equal(h.validation.gateRun.publicationWait, true);
    assert.equal(h.validation.gateRun.failureCode, "VALIDATION_BUSY");
    assert(
      !h.alerts.some((a) =>
        ["integration_failed", "worker_validation_failed"].includes(a.code)
      )
    );
    const observed = spawnSync(
      process.execPath,
      [watcher, "--once", "--json", "--repo", repo],
      { cwd: temp, encoding: "utf8", windowsHide: true }
    );
    assert.equal(observed.status, 0, observed.stdout + observed.stderr);
  }
  for (const mutation of [
    { failureCode: "EPERM" },
    { failureCode: "VALIDATION_UNKNOWN" },
    { profile: "finish" },
    { gates: [{ id: "handoff", status: "failed" }] },
    { startedAt: now - 61000, requestedAt: now - 61000, leaseWaitMs: 30000 },
    { finishedAt: now - 29000, leaseWaitMs: 30000 },
  ]) {
    save(publicationBlockedFile, { ...publicationBlocked, ...mutation });
    assert(
      collect().alerts.some((a) => a.code === "worker_validation_failed"),
      JSON.stringify(mutation)
    );
  }
  save(publicationBlockedFile, publicationBlocked);
  save(ticketFile, {
    ...waitingTicket,
    status: "running",
    attemptId: "c".repeat(32),
  });
  assert(
    !collect().alerts.some((a) => a.code === "integration_failed"),
    "a retry preserves the old wait history"
  );
  for (const mutation of [
    { workerExitCode: 1 },
    { workerExitCode: undefined },
    { head: "d".repeat(40) },
    { branch: "other" },
    { workdir: temp },
    { repo: temp },
    { attempts: [] },
    { attempts: [{ ...waitingTicket.attempts[0], id: "c".repeat(32) }] },
    { attempts: [{ ...waitingTicket.attempts[0], status: "failed" }] },
    { attempts: [{ ...waitingTicket.attempts[0], exitCode: 1 }] },
    { attempts: [{ ...waitingTicket.attempts[0], finishedAt: waitStarted }] },
    { attempts: [{ ...waitingTicket.attempts[0], startedAt: "invalid" }] },
  ]) {
    save(ticketFile, { ...waitingTicket, ...mutation });
    h = collect();
    assert(
      h.alerts.some((a) => a.code === "integration_failed"),
      JSON.stringify(mutation)
    );
    assert(
      h.alerts.some((a) => a.code === "worker_validation_failed"),
      "unbound wait must not hide a gate failure"
    );
  }
  save(ticketFile, waitingTicket);
  for (const mutation of [
    { exitCode: 1 },
    { exitCode: 2, error: "lock lost" },
    { sourceHead: null },
    { id: "legacy" },
    { repo: temp },
    { startedAt: "invalid" },
    { updatedAt: new Date(now).toISOString() },
  ]) {
    save(waitFile, { ...waitingAttempt, ...mutation });
    assert(
      collect().alerts.some((a) => a.code === "integration_failed"),
      JSON.stringify(mutation)
    );
  }
  save(waitFile, waitingAttempt);
  const realFailureFile = join(repo, "logs/auto-merge-runs/real-failure.json");
  save(realFailureFile, {
    ...waitingAttempt,
    id: "e".repeat(32),
    exitCode: 1,
    error: "real gate failure",
  });
  h = collect();
  assert(
    h.alerts.some(
      (a) => a.code === "integration_failed" && a.reason === "real gate failure"
    )
  );
  rmSync(realFailureFile);
  rmSync(waitFile);
  rmSync(publicationBlockedFile);
  save(ticketFile, ticket);
  save(stateFile, runner);
  h = collect();
  assert.equal(h.lane.dirtyFiles, 0);
  assert.equal(h.review.status, "outdated");
  assert.equal(h.integration.phase, "awaiting_worker");
  writeFileSync(untrackedPath, untrackedText);
  utimesSync(untrackedPath, untrackedStat.atime, untrackedStat.mtime);
  assert.equal(
    git(lane, "status", "--porcelain=v1", "--", untrackedName),
    "?? " + untrackedName
  );
  assert.equal(collect().review.status, "evidence_recorded");
  const reviewLater = Date.parse(context.generatedAt) + 25 * 60000;
  assert(
    !collect({ now: reviewLater }).alerts.some(
      (a) => a.code === "review_wait_long"
    )
  );
  rmSync(evidenceFile);
  assert(
    collect({ now: reviewLater }).alerts.some(
      (a) => a.code === "review_wait_long"
    )
  );
  save(contextFile, {
    ...context,
    generatedAt: new Date(now - 90000).toISOString(),
  });
  assert.equal(collect().review.status, "outdated");
  assert.equal(collect().integration.phase, "awaiting_worker");
  save(runFile, {
    ...completion,
    status: "running",
    finishedAt: null,
    currentGate: "handoff",
    outputLog,
    gates: [],
  });
  h = collect({ processes: gateRows });
  assert.equal(h.integration.phase, "worker_validating");
  assert.equal(h.validation.gateRun.currentGate, "handoff");
  const runningSnapshot = h;
  writeFileSync(outputLog, "new gate output\n");
  assert.notEqual(
    collect({ processes: gateRows }).progressToken,
    runningSnapshot.progressToken
  );
  save(runFile, { ...completion, root: repo });
  assert.equal(collect().validation.gateRun, null);
  save(runFile, { ...completion, startedAt: Date.parse(start) - 1000 });
  assert.equal(collect().validation.gateRun, null);
  writeFileSync(runFile, "broken metadata");
  assert(
    collect().alerts.some(
      (a) => a.code === "gate_progress_unreadable" && a.severity === "unknown"
    )
  );
  rmSync(runFile);
  rmSync(join(lane, "logs/harness/runs/targeted.json"));
  rmSync(contextFile);
  rmSync(untrackedPath);
  const id = randomUUID(),
    binding = {
      id,
      pid: 5,
      branch: "lane",
      workdir: lane,
      status: "running",
      phase: "preconditions",
    };
  recordAutoMerge(repo, binding);
  recordAutoMerge(repo, { ...binding, phase: "pushing", head });
  const autoRow = {
    pid: 5,
    parentPid: 2,
    name: "pwsh.exe",
    processStartedAt: new Date(now - 60000).toISOString(),
    commandLine: `pwsh -NoProfile -File auto-merge.ps1 -Worktree ${lane}`,
  };
  assert.equal(
    collect({ processes: [...rows, autoRow] }).integration.phase,
    "integrating"
  );
  h = collect({ processes: neighboringLaneRows });
  assert.equal(h.integration.phase, "integration_orphaned");
  assert.deepEqual(h.processes.integrationPids, []);
  for (const commandLine of [
    `pwsh auto-merge.ps1 -Worktree ${lane}`,
    `pwsh -NoProfile -ExecutionPolicy Bypass scripts/auto-merge.ps1 -Worktree ${lane}`,
  ]) {
    assert.equal(
      collect({ processes: [...rows, { ...autoRow, commandLine }] }).integration
        .phase,
      "integrating"
    );
  }
  h = collect({
    processes: [
      ...rows,
      {
        ...autoRow,
        commandLine: `pwsh reader.ps1 auto-merge.ps1 -Worktree ${lane}`,
      },
    ],
  });
  assert.equal(h.integration.phase, "integration_orphaned");
  h = collect({
    processes: [
      ...rows,
      {
        ...autoRow,
        processStartedAt: new Date(Date.now() + 10000).toISOString(),
      },
    ],
  });
  assert.equal(h.integration.phase, "integration_orphaned");
  assert(!h.processes.integrationPids.includes(5));
  h = collect({ processes: [...rows, { ...autoRow, commandLine: null }] });
  assert.equal(h.health, "unknown");
  assert.equal(h.integration.phase, "integration_identity_unknown");
  assert.throws(
    () => recordAutoMerge(repo, { ...binding, pid: 6 }),
    /binding changed/
  );
  assert.throws(
    () =>
      recordAutoMerge(repo, {
        ...binding,
        status: "completed",
        phase: "published",
        head: "a".repeat(40),
        sourceHead: head,
        publicationGuard: join(temp, "unread-before-head-mismatch.json"),
      }),
    /does not match/
  );
  assert.equal(
    JSON.parse(readFileSync(join(repo, "logs/auto-merge-runs", id + ".json")))
      .status,
    "running"
  );
  assert.throws(
    () =>
      recordAutoMerge(repo, {
        ...binding,
        status: "completed",
        phase: "published",
        head,
        sourceHead: head,
      }),
    /requires a publication guard/
  );
  assert.equal(
    JSON.parse(readFileSync(join(repo, "logs/auto-merge-runs", id + ".json")))
      .status,
    "running"
  );
  // Historical receipt display does not revalidate the current live lane.
  // New guarded writer completion is exercised by the real remote-main fixture.
  const completed = {
    ...JSON.parse(
      readFileSync(join(repo, "logs/auto-merge-runs", id + ".json"))
    ),
    status: "completed",
    phase: "published",
    head,
    sourceHead: head,
    remoteHead: head,
    publishedHead: head,
    publicationVerified: true,
    exitCode: 0,
    finishedAt: new Date().toISOString(),
  };
  save(join(repo, "logs/auto-merge-runs", id + ".json"), completed);
  assert.equal(completed.remoteHead, head);
  assert.throws(() => recordAutoMerge(repo, binding), /already finished/);
  h = collect();
  assert.equal(h.integration.lastSuccess.head, head);
  assert.equal(h.integration.lastSuccess.finishedAt, completed.finishedAt);
  const failedId = randomUUID();
  recordAutoMerge(repo, { ...binding, id: failedId });
  recordAutoMerge(
    repo,
    {
      ...binding,
      id: failedId,
      status: "failed",
      phase: "pushing",
      error: "pre-push failed",
      exitCode: 1,
    },
    { now: new Date(Date.now() + 1000).toISOString() }
  );
  assert(collect().alerts.some((a) => a.code === "integration_failed"));
  // A newer malformed completion must not hide a previous integration failure.
  const publishedTree = git(repo, "rev-parse", head + "^{tree}");
  const publication = git(
    repo,
    "commit-tree",
    publishedTree,
    "-p",
    head,
    "-m",
    "fixture publication"
  );
  const laterRemote = git(
    repo,
    "commit-tree",
    publishedTree,
    "-p",
    publication,
    "-m",
    "fixture later remote"
  );
  const foreign = git(
    repo,
    "commit-tree",
    publishedTree,
    "-m",
    "fixture foreign history"
  );
  const modernFile = join(
    repo,
    "logs/supervisor-integrations/modern-fixture.json"
  );
  const modern = {
    workdir: lane,
    status: "completed",
    head,
    publishedHead: publication,
    remoteHead: laterRemote,
    publicationVerified: true,
    validatedTree: publishedTree,
    finishedAt: new Date(Date.now() + 5000).toISOString(),
  };
  for (const mutation of [
    { remoteHead: undefined },
    { remoteHead: "invalid" },
    { publicationVerified: false, remoteHead: head },
    { publicationVerified: undefined, remoteHead: head },
    { publishedHead: undefined, remoteHead: head },
    { publishedHead: "0".repeat(40), remoteHead: "0".repeat(40) },
    { head: foreign },
    { remoteHead: foreign },
    { remoteHead: head },
    { validatedTree: "0".repeat(40) },
    { validatedTree: null },
    { validatedTree: undefined },
    { sourceHead: foreign },
    { sourceHead: "invalid" },
  ]) {
    save(modernFile, { ...modern, ...mutation });
    const invalid = collect();
    assert(invalid.alerts.some((a) => a.code === "invalid_success_record"));
    assert(invalid.alerts.some((a) => a.code === "integration_failed"));
    assert(invalid.integration.lastSuccess.file.endsWith(id + ".json"));
  }
  save(modernFile, modern);
  const validModern = collect();
  assert.equal(validModern.integration.lastSuccess.head, publication);
  assert(!validModern.alerts.some((a) => a.code === "invalid_success_record"));
  assert(!validModern.alerts.some((a) => a.code === "integration_failed"));
  rmSync(modernFile);
  const modernAutoFile = join(repo, "logs/auto-merge-runs/modern-fixture.json");
  save(modernAutoFile, { ...modern, sourceHead: head });
  assert(collect().alerts.some((a) => a.code === "invalid_success_record"));
  save(modernAutoFile, {
    ...modern,
    head: publication,
    sourceHead: head,
    validatedTree: "0".repeat(40),
  });
  assert(collect().alerts.some((a) => a.code === "invalid_success_record"));
  // A modern auto-merge completion must retain its original request SHA.
  for (const sourceHead of [undefined, null, "invalid", foreign]) {
    save(modernAutoFile, { ...modern, head: publication, sourceHead });
    const invalid = collect();
    assert(invalid.alerts.some((a) => a.code === "invalid_success_record"));
    assert(invalid.alerts.some((a) => a.code === "integration_failed"));
    assert(invalid.integration.lastSuccess.file.endsWith(id + ".json"));
  }
  // Auto-merge records bind the published commit; only parent tickets require
  // a separate validatedTree. An optional tree must still match when present.
  for (const validatedTree of [undefined, publishedTree]) {
    save(modernAutoFile, {
      ...modern,
      head: publication,
      sourceHead: head,
      validatedTree,
    });
    const validAuto = collect();
    assert.equal(validAuto.integration.lastSuccess.head, publication);
    assert(!validAuto.alerts.some((a) => a.code === "invalid_success_record"));
  }
  rmSync(modernAutoFile);
  const resolvedFile = join(
    repo,
    "logs/supervisor-integrations/resolved-fixture.json"
  );
  const resolvedAt = new Date(Date.now() + 10000).toISOString();
  const resolution = {
    kind: "included_in_remote",
    head,
    remoteHead: laterRemote,
    observedAt: resolvedAt,
    previousStatus: "failed",
  };
  const lastPublication = collect().integration.lastSuccess;
  save(resolvedFile, { ...modern, finishedAt: resolvedAt, resolution });
  assert.deepEqual(
    collect().integration.lastSuccess,
    lastPublication,
    "reconciliation time is not a new publication time"
  );
  assert.equal(collect().integration.lastReconciliation.head, head);
  assert(!collect().alerts.some((a) => a.code === "invalid_success_record"));
  // Recovery may finish without launching another worker (for example while
  // usage is limited). The historical runner snapshot must not conceal the
  // current ticket's verified publication or remote-inclusion outcome.
  const beforeRecoveryState = readFileSync(stateFile);
  const beforeRecoveryTicket = readFileSync(ticketFile);
  const pendingRunner = { ...runner, status: "publication_pending" };
  const terminalTicket = {
    ...ticket,
    ...modern,
    repo,
    branch: "lane",
    exitCode: 0,
    requestedAt: new Date(Date.parse(start) + 1000).toISOString(),
  };
  try {
    save(stateFile, pendingRunner);
    for (const outcome of [
      terminalTicket,
      { ...terminalTicket, finishedAt: resolvedAt, resolution },
    ]) {
      writeFileSync(ticketFile, beforeRecoveryTicket);
      const previousPublication = collect({ processes: [] }).integration
        .lastSuccess;
      save(ticketFile, outcome);
      const recovered = collect({ processes: [] });
      const kind = outcome.resolution ? "included_in_remote" : "published";
      assert.equal(recovered.integration.phase, "idle");
      assert.equal(recovered.integration.currentOutcome.kind, kind);
      assert.equal(recovered.integration.currentOutcome.head, head);
      assert.equal(recovered.workerStatus, "publication_pending");
      assert.deepEqual(recovered.processes.runnerPids, []);
      if (outcome.resolution) {
        assert.deepEqual(
          recovered.integration.lastSuccess,
          previousPublication
        );
        assert.equal(
          recovered.integration.lastReconciliation.observedAt,
          resolvedAt
        );
        assert.equal(recovered.integration.currentOutcome.publishedHead, null);
      } else {
        assert.equal(recovered.integration.lastSuccess.head, publication);
        assert.equal(
          recovered.integration.lastSuccess.finishedAt,
          modern.finishedAt
        );
      }
      assert.equal(
        collect().integration.phase,
        "awaiting_worker",
        "a live worker keeps priority"
      );
      const observed = spawnSync(
        process.execPath,
        [watcher, "--once", "--state", stateFile, "--no-color"],
        {
          cwd: temp,
          encoding: "utf8",
          windowsHide: true,
        }
      );
      assert.equal(observed.error, undefined);
      assert(
        observed.stdout.includes("integration=idle"),
        observed.stdout + observed.stderr
      );
      assert(
        observed.stdout.includes(
          `worker-history=publication_pending; current-publication=${kind}`
        )
      );
      assert(
        observed.stdout.includes("[worker-history] [publication_pending]")
      );
      assert.deepEqual(
        JSON.parse(readFileSync(stateFile, "utf8")),
        pendingRunner
      );
      assert.deepEqual(JSON.parse(readFileSync(ticketFile, "utf8")), outcome);
    }
    for (const mutation of [
      { schemaVersion: 2 },
      { runId: randomUUID() },
      { runId: undefined },
      {
        file: join(
          repo,
          "logs/supervisor-integrations",
          randomUUID() + ".json"
        ),
      },
      { file: undefined },
      { repo: temp },
      { branch: "other" },
      { exitCode: 75 },
      { resolution: { kind: "unknown" } },
      { publicationVerified: false },
      { status: "failed", exitCode: 1 },
      { requestedAt: new Date(Date.parse(start) - 1000).toISOString() },
      { requestedAt: "invalid" },
      { finishedAt: start },
      { validatedTree: "0".repeat(40) },
      { remoteHead: foreign },
      { head: foreign },
    ]) {
      save(ticketFile, { ...terminalTicket, ...mutation });
      const invalid = collect({ processes: [] });
      assert.equal(
        invalid.integration.currentOutcome,
        null,
        JSON.stringify(mutation)
      );
      assert.notEqual(
        invalid.integration.phase,
        "idle",
        JSON.stringify(mutation)
      );
      if (mutation.status === "failed")
        assert(invalid.alerts.some((a) => a.code === "integration_failed"));
    }
    save(ticketFile, terminalTicket);
    save(stateFile, { ...pendingRunner, integrationRequest: null });
    assert.equal(
      collect({ processes: [] }).integration.currentOutcome,
      null,
      "an unbound historical completion cannot finish the current run"
    );
  } finally {
    writeFileSync(stateFile, beforeRecoveryState);
    writeFileSync(ticketFile, beforeRecoveryTicket);
  }
  // A past remote observation resolves only matching records already present
  // at that time. A later same-HEAD request/failure must remain visible.
  const historyFile = join(
    repo,
    "logs/auto-merge-runs/resolution-history.json"
  );
  const failedFile = join(repo, "logs/auto-merge-runs", failedId + ".json");
  const originalFailed = readFileSync(failedFile);
  rmSync(failedFile);
  const resolutionRecord = {
    ...modern,
    branch: "lane",
    finishedAt: resolvedAt,
    resolution,
  };
  save(resolvedFile, resolutionRecord);
  const pastFailure = {
    id: "f".repeat(32),
    workdir: lane,
    branch: "lane",
    sourceHead: head,
    head,
    status: "failed",
    exitCode: 1,
    startedAt: completed.startedAt,
    finishedAt: new Date(Date.parse(resolvedAt) - 1000).toISOString(),
  };
  save(historyFile, pastFailure);
  assert(!collect().alerts.some((a) => a.code === "integration_failed"));
  const later = new Date(Date.parse(resolvedAt) + 1000).toISOString();
  for (const mutation of [
    { startedAt: later, finishedAt: later },
    { updatedAt: later },
    { startedAt: "invalid" },
    { finishedAt: "invalid" },
    { branch: "other" },
    { branch: undefined },
    { sourceHead: foreign },
  ]) {
    save(historyFile, { ...pastFailure, ...mutation });
    assert(
      collect().integration.lastFailure?.file.endsWith(
        "resolution-history.json"
      ),
      JSON.stringify(mutation)
    );
  }
  save(historyFile, {
    ...pastFailure,
    status: "running",
    startedAt: later,
    updatedAt: later,
    finishedAt: null,
  });
  assert.equal(
    collect().integration.phase,
    "integration_orphaned",
    "a later same-HEAD running attempt is not resolved"
  );
  save(historyFile, {
    ...pastFailure,
    status: "running",
    updatedAt: pastFailure.finishedAt,
    finishedAt: null,
  });
  assert.notEqual(
    collect().integration.phase,
    "integration_orphaned",
    "an old matching attempt is resolved"
  );
  rmSync(historyFile);
  save(ticketFile, {
    ...pastFailure,
    sourceHead: undefined,
    runId: "new-request",
    startedAt: later,
    requestedAt: later,
    finishedAt: later,
  });
  assert(
    collect().alerts.some((a) => a.code === "integration_failed"),
    "a new same-HEAD ticket failure stays visible"
  );
  save(ticketFile, ticket);
  writeFileSync(failedFile, originalFailed);
  for (const mutation of [
    { head: foreign },
    { remoteHead: foreign },
    { observedAt: start },
  ]) {
    save(resolvedFile, {
      ...modern,
      finishedAt: resolvedAt,
      resolution: { ...resolution, ...mutation },
    });
    assert(collect().alerts.some((a) => a.code === "invalid_success_record"));
  }
  rmSync(resolvedFile);
  const local = recordAutoMerge(repo, {
    ...binding,
    id: randomUUID(),
    status: "local_only",
    phase: "local_merged",
    head,
  });
  assert(!local.remoteHead);
  assert.equal(
    collect().integration.lastSuccess.file.endsWith(id + ".json"),
    true
  );
  assert.equal(readFileSync(join(lane, "pending.txt"), "utf8"), "kept\n");
  // The primary checkout can change branch and contain user work while main is
  // clean in its registered integration checkout.
  const mainTree = join(temp, "main");
  save(join(repo, "scripts/full-run-checkouts.json"), {
    ...pin,
    integrationWorktree: "../main",
  });
  git(repo, "add", "scripts/full-run-checkouts.json");
  git(repo, "commit", "-m", "fixture pins dedicated main");
  git(repo, "switch", "-c", "interactive");
  git(repo, "worktree", "add", mainTree, "main");
  writeFileSync(join(repo, "user-work.txt"), "preserved primary work\n");
  h = collect();
  assert.equal(h.main.worktree, mainTree);
  assert.equal(h.main.ready, true);
  assert(!h.alerts.some((a) => a.code === "integration_checkout_unavailable"));
  writeFileSync(join(mainTree, "busy.txt"), "busy integration checkout\n");
  assert(
    collect().alerts.some((a) => a.code === "integration_checkout_unavailable")
  );
  assert.equal(git(repo, "symbolic-ref", "--short", "HEAD"), "interactive");
  assert.equal(
    readFileSync(join(repo, "user-work.txt"), "utf8"),
    "preserved primary work\n"
  );
  rmSync(join(mainTree, "busy.txt"));
  git(mainTree, "rm", "scripts/full-run-checkouts.json");
  git(mainTree, "commit", "-m", "fixture removes pin");
  h = collect();
  assert.equal(h.main.ready, false);
  assert.equal(h.main.reason, "configuration-missing");
  assert(h.alerts.some((a) => a.code === "integration_checkout_unavailable"));
  console.log(
    "[test-supervisor-health] passed: current run, idle/requested/orphaned integration, real process census, long validation/lease wait, output progress, read-only locks and receipts, verified publication and failure history"
  );
} finally {
  if (lease && existsSync(lease)) rmSync(lease);
  rmSync(temp, { recursive: true, force: true });
}
