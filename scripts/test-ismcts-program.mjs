import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  cpSync,
  lstatSync,
  realpathSync,
  rmSync,
  existsSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import state from "./harness/verification-state.cjs";
import { auditInputFiles } from "./audit-inputs.mjs";
import {
  selectGates,
  fullGates,
  gates as harnessGates,
} from "./harness/gate-manifest.mjs";
import {
  profile,
  bootstrapProfile,
  bootstrapProfileHash,
  validateProfile,
  resourceMachine,
  checkResourceDocument,
  jstDay,
  nextJstDay,
} from "./ismcts/resources.mjs";
import {
  reserveBudget,
  reserveNextChunk,
  previewBudgetReservation,
  previewNextChunk,
  finishBudget,
  budgetStatus,
  migrateBudget,
} from "./ismcts/budget.mjs";
import {
  atomicJson,
  readJson,
  transaction,
  descriptor,
  contained,
  hash,
  safePath,
  sharedFile,
} from "./ismcts/shared.mjs";
import {
  scopeFingerprint,
  recordReceipt,
  verifyReceipt,
  evidenceStatus,
  finalizeReceipt,
  tasks,
} from "./ismcts/evidence.mjs";
import { makePlan, programCli } from "./ismcts-program.mjs";
import { hostEligibility } from "./ismcts/host-probe.mjs";
import { buildVerificationTree } from "./verifier-tree.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "orica-ismcts-test-"));
const fixtureTimings = { count: 0, setupMs: 0, evidenceMs: 0 };
let completed = 0;
async function test(name, fn) {
  await fn();
  completed++;
  console.log(`ok ${completed} - ${name}`);
}
const validSample = { cpuPercent: 20, freeRamGiB: 7, treeRssGiB: 0.5 };
const clock = Date.parse("2026-10-06T10:00:00+09:00");
const emptyUsage = {
  wallMs: 0,
  cpuMs: 0,
  gpuMs: 0,
  monitorMs: 0,
  outputBytes: 0,
};
const usage = (wallMs, cpuMs = wallMs) => ({ ...emptyUsage, wallMs, cpuMs });
const request = (overrides = {}) => ({
  wallMs: 1000,
  threads: 1,
  owner: "owned-test-job",
  ...overrides,
});
function privateDir(name) {
  const path = join(sandbox, name);
  mkdirSync(path, { recursive: true });
  return path;
}
function finish(dir, reserved, overrides = {}, now = clock + 1000) {
  return finishBudget(
    dir,
    reserved.id,
    reserved.owner,
    {
      status: "completed",
      treeExited: true,
      accountingComplete: true,
      usage: usage(1000),
      ...overrides,
    },
    now
  );
}
function child(code, args) {
  return new Promise((resolveChild, reject) => {
    const proc = spawn(
      process.execPath,
      ["--input-type=module", "-e", code, ...args],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "",
      stderr = "";
    proc.stdout.on("data", (bytes) => {
      stdout += bytes;
    });
    proc.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    proc.on("error", reject);
    proc.on("close", (exitCode) => resolveChild({ exitCode, stdout, stderr }));
  });
}

// Only immutable fixture inputs are shared. Each copy owns its Git metadata,
// source bytes and freshly generated evidence; nothing survives this process.
let receiptTemplatePath;
function fixtureGit(path) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
  );
  return (args) =>
    execFileSync("git", args, {
      cwd: path,
      env,
      windowsHide: true,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
}
function discardReceiptRepository(path) {
  assert.equal(dirname(resolve(path)), resolve(sandbox));
  assert.equal(lstatSync(path).isSymbolicLink(), false);
  assert.equal(dirname(realpathSync(path)), realpathSync(sandbox));
  rmSync(path, { recursive: true, force: true });
}
function getReceiptTemplate() {
  if (receiptTemplatePath) return receiptTemplatePath;
  const path = join(sandbox, "receipt-template");
  mkdirSync(path);
  const git = fixtureGit(path);
  try {
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Fixture"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    // Use the repository's explicit attributes regardless of the host's setting.
    // Windows source bytes deliberately differ from their canonical Git blobs.
    git(["config", "core.autocrlf", "false"]);
    const paths = [
      ".gitattributes",
      "pnpm-lock.yaml",
      "scripts/ismcts-program.mjs",
      "scripts/test-ismcts-program.mjs",
      "scripts/harness/gate-manifest.json",
      "scripts/harness/run-gates.mjs",
      "scripts/harness/gate-lease.mjs",
      "scripts/harness/gate-queue.mjs",
      "scripts/harness/verification-state.cjs",
      "scripts/verifier-evidence.mjs",
      "scripts/verifier-tree.mjs",
      "scripts/verifier-card-context.mjs",
      "scripts/quantified-effect-repeat.mjs",
      "scripts/verified-commit.mjs",
      "scripts/artifact-storage.mjs",
      "scripts/artifact-storage-policy.json",
      "scripts/lib/stored-file-sizes.mjs",
      "scripts/lib/stored-file-sizes.ps1",
      ...readdirSync(join(root, "scripts/ismcts")).map(
        (file) => `scripts/ismcts/${file}`
      ),
      ...readdirSync(join(root, "manual/ai-reference/30_plan/ismcts-full-run"))
        .filter((file) => file.endsWith(".md"))
        .map((file) => `manual/ai-reference/30_plan/ismcts-full-run/${file}`),
    ];
    for (const file of paths) {
      mkdirSync(dirname(join(path, file)), { recursive: true });
      copyFileSync(join(root, file), join(path, file));
    }
    const ps1 = join(path, "scripts/ismcts/windows-job.ps1");
    writeFileSync(ps1, readFileSync(ps1, "utf8").replace(/\r?\n/g, "\r\n"));
    writeFileSync(
      join(path, ".gitignore"),
      "logs/\nartifacts/\n.verifier*\n.env*\n"
    );
    git(["add", "."]);
    git(["commit", "-m", "fixture"]);
    receiptTemplatePath = path;
    return path;
  } catch (error) {
    discardReceiptRepository(path);
    throw error;
  }
}
function createReceiptRepository(name, copy = cpSync) {
  const template = getReceiptTemplate();
  const path = join(sandbox, name);
  assert.equal(dirname(resolve(path)), resolve(sandbox));
  assert.notEqual(path, template);
  // Exclusive creation prevents a failed copy from deleting an earlier case.
  mkdirSync(path);
  try {
    copy(template, path, { recursive: true, force: false, errorOnExist: true });
    return path;
  } catch (error) {
    discardReceiptRepository(path);
    throw error;
  }
}
function receiptFixture(name) {
  const setupStarted = performance.now();
  const path = createReceiptRepository(name);
  const git = fixtureGit(path);
  fixtureTimings.count++;
  fixtureTimings.setupMs += performance.now() - setupStarted;
  const evidenceStarted = performance.now();
  writeFileSync(
    join(path, "scripts/ismcts-program.mjs"),
    readFileSync(join(path, "scripts/ismcts-program.mjs"), "utf8") +
      "\n// private receipt fixture change\n"
  );
  const startedAt = Date.now() - 1000,
    finishedAt = startedAt + 100;
  const output = join(path, "logs/harness/output/fixture.log");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    'ok\nISMCTS_TEST_RESULT {"attempted":4,"completed":4,"failed":0,"deferred":0}\n'
  );
  const report = {
    schemaVersion: 2,
    root: path,
    profile: "finish",
    completionGate: true,
    status: "passed",
    startedAt,
    finishedAt,
    fingerprint: state.sourceFingerprint(path, {
      extraFiles: auditInputFiles(path),
    }),
    vitestArgs: [],
    changed: ["scripts/ismcts-program.mjs"],
    diffBases: [git(["rev-parse", "HEAD"])],
    sourceTree: buildVerificationTree(path, "HEAD").headTree,
    gates: [
      {
        id: "ismcts-program",
        status: "passed",
        reused: false,
        command: process.execPath,
        argv: [resolve(path, "scripts/test-ismcts-program.mjs")],
        startedAt,
        finishedAt,
        exitCode: 0,
        outputLog: output,
      },
    ],
  };
  // Synthetic reports model the complete selected gate set, not an isolated
  // acceptance with a falsely complete finish status. Only fixture data here.
  report.gates.push(
    ...selectGates(report.profile, report.changed)
      .filter((id) => id !== "ismcts-program")
      .map((id) => ({
        id,
        status: "passed",
        reused: false,
        exitCode: 0,
        startedAt,
        finishedAt,
      }))
  );
  const run = join(path, `logs/harness/runs/${startedAt}-1.json`);
  atomicJson(run, report);
  const directory = privateDir(`${name}-shared`);
  const record = () => recordReceipt(path, directory, "I0", "E1", run);
  fixtureTimings.evidenceMs += performance.now() - evidenceStarted;
  return { path, directory, run, output, report, git, record };
}

try {
  await test("current acceptance set keeps fallback, autonomous training and 72-hour proof pending", () => {
    const expected = {
      I0: ["E1", "R1-budget", "R1-runtime", "calibration"],
      I1: ["H1", "H2", "H3"],
      I2: ["T1", "T3"],
      I3: ["T2", "smoke16"],
      I4: ["S1", "gui-natural-game", "solo-fallback"],
      I5: ["deployment", "release400"],
      I6: ["nn-resume", "nn-evaluation", "training-loop", "model-lifecycle"],
      I7: ["O1", "monitor-live", "autonomy-soak"],
    };
    assert.deepEqual(tasks, expected);
    const fixture = receiptFixture("acceptance-migration");
    const status = evidenceStatus(fixture.path, fixture.directory);
    for (const [taskId, acceptanceIds] of Object.entries(expected)) {
      assert.deepEqual(
        status.taskStates.find((item) => item.taskId === taskId).acceptances,
        acceptanceIds.map((acceptanceId) => ({
          acceptanceId,
          state: "unverified",
          reason: "no_receipt",
        }))
      );
    }
    for (const [taskId, acceptanceId] of [
      ["I4", "solo-fallback"],
      ["I6", "training-loop"],
      ["I6", "model-lifecycle"],
      ["I7", "autonomy-soak"],
    ])
      assert.throws(
        () =>
          recordReceipt(
            fixture.path,
            fixture.directory,
            taskId,
            acceptanceId,
            fixture.run
          ),
        /gate not implemented/
      );
    assert.equal(existsSync(join(fixture.directory, "receipts")), false);

    const complete = {
      schemaVersion: 1,
      orphanInvalid: false,
      taskStates: Object.entries(expected).map(([taskId, acceptanceIds]) => ({
        taskId,
        state: "valid",
        acceptances: acceptanceIds.map((acceptanceId) => ({
          acceptanceId,
          state: "valid",
        })),
      })),
    };
    const monitor = makePlan(complete, {});
    assert.equal(monitor.action, "ismcts-monitor");
    assert.equal(
      monitor.skipWorker,
      false,
      "static receipts do not suppress initial LLM progress review"
    );
    for (const [taskId, acceptanceId] of [
      ["I4", "solo-fallback"],
      ["I6", "training-loop"],
      ["I6", "model-lifecycle"],
      ["I7", "autonomy-soak"],
    ]) {
      const old = JSON.parse(JSON.stringify(complete));
      const task = old.taskStates.find((item) => item.taskId === taskId);
      task.acceptances = task.acceptances.filter(
        (item) => item.acceptanceId !== acceptanceId
      );
      const plan = makePlan(old, {});
      assert.equal(plan.action, "ismcts-implementation-required");
      assert.equal(plan.nextTask, taskId);
      assert.equal(plan.skipWorker, false);
      assert.match(plan.workerFocus, new RegExp(acceptanceId));
    }
    assert.equal(makePlan({ ...complete, taskStates: [] }, {}).nextTask, "I0");
    const failed = JSON.parse(JSON.stringify(complete));
    failed.taskStates[6].acceptances[2].state = "invalid";
    assert.equal(makePlan(failed, {}).nextTask, "I0");
    for (const corrupt of [
      null,
      { ...complete, schemaVersion: 2 },
      { ...complete, orphanInvalid: undefined },
      {
        ...complete,
        taskStates: [...complete.taskStates, complete.taskStates[0]],
      },
      {
        ...complete,
        taskStates: [
          {
            ...complete.taskStates[0],
            acceptances: [{ acceptanceId: "E1", state: "passed" }],
          },
        ],
      },
      {
        ...complete,
        taskStates: [
          {
            ...complete.taskStates[0],
            acceptances: [{ acceptanceId: "unknown", state: "valid" }],
          },
        ],
      },
      {
        ...complete,
        taskStates: [
          {
            ...complete.taskStates[0],
            acceptances: [
              complete.taskStates[0].acceptances[0],
              complete.taskStates[0].acceptances[0],
            ],
          },
        ],
      },
    ])
      assert.throws(() => makePlan(corrupt, {}), /controller/);
  });
  await test("a fresh run repairs a stale acceptance without rewriting or discarding old receipts", () => {
    const fixture = receiptFixture("receipt-repair-history");
    const old = fixture.record();
    const oldFile = join(
      fixture.directory,
      "receipts",
      readdirSync(join(fixture.directory, "receipts"))[0]
    );
    const oldBytes = readFileSync(oldFile);
    writeFileSync(
      join(fixture.path, "scripts/ismcts/new-module.mjs"),
      "// new acceptance input\n"
    );
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, old).reason,
      "stale receipt scope"
    );
    const startedAt = fixture.report.finishedAt + 1;
    const report = {
      ...fixture.report,
      startedAt,
      finishedAt: startedAt + 100,
      fingerprint: state.sourceFingerprint(fixture.path, {
        extraFiles: auditInputFiles(fixture.path),
      }),
      changed: state.changedPaths(fixture.path),
      sourceTree: buildVerificationTree(fixture.path, "HEAD").headTree,
      gates: fixture.report.gates.map((gate) => ({
        ...gate,
        startedAt,
        finishedAt: startedAt + 100,
      })),
    };
    const run = join(fixture.path, `logs/harness/runs/${startedAt}-2.json`);
    atomicJson(run, report);
    const fresh = recordReceipt(
      fixture.path,
      fixture.directory,
      "I0",
      "E1",
      run
    );
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, fresh).state,
      "unverified"
    );
    const status = evidenceStatus(fixture.path, fixture.directory);
    assert.deepEqual(
      status.entries.map((entry) => entry.state),
      ["invalid", "unverified"]
    );
    assert.equal(
      status.taskStates[0].acceptances[0].reason,
      "pending_verified_commit_and_integration"
    );
    assert.equal(makePlan(status, {}).evidenceState, "unverified");
    assert.deepEqual(readFileSync(oldFile), oldBytes);
    assert.equal(fresh.finalization, null);
  });
  await test("approved profile exactly matches the documented JSON, including disabled GPU", () => {
    assert.equal(typeof checkResourceDocument(root), "string");
    assert.equal(profile.ram.startFreeGiB, 6);
    assert.equal(profile.compute.threads, 2);
    assert.equal(profile.gpu.enabled, false);
    assert.throws(
      () =>
        validateProfile({ ...profile, gpu: { ...profile.gpu, enabled: true } }),
      /mismatch/
    );
    assert.throws(
      () =>
        validateProfile({
          ...profile,
          offline: { ...profile.offline, wallMs: profile.offline.wallMs + 1 },
        }),
      /mismatch/
    );
    assert.throws(
      () =>
        validateProfile({
          ...profile,
          compute: { ...profile.compute, extra: true },
        }),
      /keys/
    );
  });
  await test("fresh start needs six GiB, a running job can use the four-to-six GiB band", () => {
    const machine = resourceMachine();
    assert.equal(
      machine.update({ ...validSample, freeRamGiB: 5.99 }, 0).action,
      "wait"
    );
    assert.equal(machine.update(validSample, 2000).action, "wait");
    for (let now = 4000; now < 32000; now += 2000)
      assert.equal(machine.update(validSample, now).action, "wait");
    assert.equal(machine.update(validSample, 32000).action, "resume");
    assert.equal(
      machine.update({ ...validSample, freeRamGiB: 4 }, 34000).action,
      "run"
    );
    assert.equal(
      machine.update({ ...validSample, freeRamGiB: 3.99 }, 36000).reason,
      "ram_free"
    );
  });
  await test("CPU stop and resume use sustained continuous windows and strict resume threshold", () => {
    const machine = resourceMachine();
    for (let now = 0; now < 10000; now += 2000)
      assert.equal(
        machine.update({ ...validSample, cpuPercent: 60 }, now).action,
        "run"
      );
    assert.equal(
      machine.update({ ...validSample, cpuPercent: 60 }, 10000).reason,
      "cpu_load"
    );
    for (let now = 12000; now <= 44000; now += 2000)
      assert.equal(
        machine.update({ ...validSample, cpuPercent: 40 }, now).action,
        "wait"
      );
    for (let now = 46000; now < 76000; now += 2000)
      assert.equal(machine.update(validSample, now).action, "wait");
    assert.equal(machine.update(validSample, 76000).action, "resume");
  });
  await test("RAM soft/hard, missing/NaN/stale telemetry and clock reversal fail closed", () => {
    assert.equal(
      resourceMachine().update({ ...validSample, treeRssGiB: 2 }, 0).reason,
      "ram_soft"
    );
    assert.equal(
      resourceMachine().update({ ...validSample, treeRssGiB: 3 }, 0).action,
      "terminate"
    );
    for (const input of [
      null,
      {},
      { ...validSample, cpuPercent: NaN },
      { ...validSample, freeRamGiB: -1 },
    ])
      assert.equal(
        resourceMachine().update(input, 0).reason,
        "measurement_missing"
      );
    const machine = resourceMachine({ stopped: true });
    machine.update(validSample, 0);
    assert.equal(machine.update(validSample, 30000).action, "wait");
    assert.throws(() => machine.update(validSample, 30000), /clock/);
  });
  await test("GPU threshold diagnostics do not enable a GPU job", () => {
    assert.equal(
      resourceMachine().update(
        {
          ...validSample,
          gpuEnabled: true,
          gpuPercent: 10,
          freeVramGiB: 8,
          aiVramGiB: 1,
          gpuCelsius: 45,
        },
        0
      ).reason,
      "gpu_not_accepted"
    );
    for (const gpu of [
      { percent: 10, freeGiB: 3.9, aiGiB: 1, celsius: 45 },
      { percent: 10, freeGiB: 8, aiGiB: 1, celsius: 80 },
    ])
      assert.equal(
        resourceMachine().update({ ...validSample, gpu }, 0).gpuDiagnostic.stop,
        true
      );
    const machine = resourceMachine();
    for (let now = 0; now < 10000; now += 2000)
      assert.equal(
        machine.update(
          {
            ...validSample,
            gpu: { percent: 70, freeGiB: 8, aiGiB: 1, celsius: 50 },
          },
          now
        ).gpuDiagnostic.stop,
        false
      );
    assert.equal(
      machine.update(
        {
          ...validSample,
          gpu: { percent: 70, freeGiB: 8, aiGiB: 1, celsius: 50 },
        },
        10000
      ).gpuDiagnostic.stop,
      true
    );
  });
  await test("GPU VRAM stop excludes resume until thirty seconds of complete recovery", () => {
    for (const aiGiB of [3, 4]) {
      const machine = resourceMachine();
      const gpu = { percent: 10, freeGiB: 8, aiGiB, celsius: 45 };
      for (let now = 0; now <= 30000; now += 2000)
        assert.deepEqual(
          machine.update({ ...validSample, gpu }, now).gpuDiagnostic,
          { stop: true, resume: false }
        );
      for (let now = 32000; now < 62000; now += 2000)
        assert.deepEqual(
          machine.update({ ...validSample, gpu: { ...gpu, aiGiB: 1 } }, now)
            .gpuDiagnostic,
          { stop: false, resume: false }
        );
      assert.deepEqual(
        machine.update({ ...validSample, gpu: { ...gpu, aiGiB: 1 } }, 62000)
          .gpuDiagnostic,
        { stop: false, resume: true }
      );
    }
  });
  await test("invalid optional GPU telemetry resets CPU/RAM recovery and CPU load windows", () => {
    const gpu = { percent: 10, freeGiB: 8, aiGiB: 1, celsius: 45 };
    for (const invalid of [
      { ...gpu, percent: NaN },
      { ...gpu, percent: 101 },
      { ...gpu, freeGiB: undefined },
      { ...gpu, aiGiB: -1 },
      { ...gpu, celsius: Infinity },
    ]) {
      for (const nextSample of [validSample, { ...validSample, gpu }]) {
        const recovering = resourceMachine({ stopped: true });
        for (let now = 0; now < 30000; now += 2000)
          assert.equal(
            recovering.update({ ...validSample, gpu }, now).action,
            "wait"
          );
        assert.deepEqual(
          recovering.update({ ...validSample, gpu: invalid }, 30000),
          { action: "stop", reason: "gpu_measurement_missing" }
        );
        for (let now = 32000; now < 62000; now += 2000)
          assert.equal(recovering.update(nextSample, now).action, "wait");
        assert.equal(recovering.update(nextSample, 62000).action, "resume");
      }
      const loaded = resourceMachine();
      const highCpu = { ...validSample, cpuPercent: 60, gpu };
      for (let now = 0; now < 10000; now += 2000)
        assert.equal(loaded.update(highCpu, now).action, "run");
      assert.equal(
        loaded.update({ ...highCpu, gpu: invalid }, 10000).reason,
        "gpu_measurement_missing"
      );
      for (let now = 12000; now < 22000; now += 2000)
        assert.equal(loaded.update(highCpu, now).reason, "deferred_load");
      assert.equal(loaded.update(highCpu, 22000).reason, "cpu_load");
    }
  });
  await test("known RAM hard usage terminates before GPU refusal or missing optional telemetry", () => {
    for (const input of [
      {
        ...validSample,
        gpuEnabled: true,
        gpuPercent: 10,
        freeVramGiB: 8,
        aiVramGiB: 1,
        gpuCelsius: 45,
      },
      {
        ...validSample,
        gpu: { percent: NaN, freeGiB: 8, aiGiB: 1, celsius: 45 },
      },
      { ...validSample, cpuPercent: NaN },
      { ...validSample, freeRamGiB: undefined },
    ]) {
      const machine = resourceMachine({ stopped: true });
      machine.update(validSample, 0);
      assert.deepEqual(machine.update({ ...input, treeRssGiB: 3 }, 2000), {
        action: "terminate",
        reason: "ram_hard",
      });
      for (let now = 4000; now < 34000; now += 2000)
        assert.equal(machine.update(validSample, now).action, "wait");
      assert.equal(machine.update(validSample, 34000).action, "resume");
    }
    for (const treeRssGiB of [NaN, Infinity, -1, undefined])
      assert.deepEqual(
        resourceMachine().update({ ...validSample, treeRssGiB }, 0),
        {
          action: "stop",
          reason: "measurement_missing",
        }
      );
  });
  await test("GPU missing, invalid or delayed points restart the dedicated sustained windows", () => {
    const high = { percent: 70, freeGiB: 8, aiGiB: 1, celsius: 50 },
      low = { ...high, percent: 10 };
    for (const [gpu, end, key] of [
      [high, 10000, "stop"],
      [low, 30000, "resume"],
    ]) {
      for (const point of [
        validSample,
        { ...validSample, gpu: { ...gpu, percent: NaN } },
        {
          ...validSample,
          gpuEnabled: true,
          gpuPercent: 10,
          freeVramGiB: 8,
          aiVramGiB: 1,
          gpuCelsius: 45,
        },
      ]) {
        const machine = resourceMachine();
        machine.update({ ...validSample, gpu }, 0);
        for (let now = 2000; now < end; now += 2000) machine.update(point, now);
        assert.equal(
          machine.update({ ...validSample, gpu }, end).gpuDiagnostic[key],
          false
        );
      }
      assert.equal(
        (() => {
          const machine = resourceMachine();
          machine.update({ ...validSample, gpu }, 0);
          return machine.update({ ...validSample, gpu }, end).gpuDiagnostic[
            key
          ];
        })(),
        false
      );
    }
    const machine = resourceMachine();
    for (let now = 0; now < 30000; now += 2000)
      assert.equal(
        machine.update({ ...validSample, gpu: low }, now).gpuDiagnostic.resume,
        false
      );
    assert.equal(
      machine.update({ ...validSample, gpu: low }, 30000).gpuDiagnostic.resume,
      true
    );
    const recovering = resourceMachine({ stopped: true });
    recovering.update(validSample, 0);
    for (let now = 2000; now < 30000; now += 2000)
      assert.equal(
        recovering.update(
          {
            ...validSample,
            cpuPercent: 100,
            gpuEnabled: true,
            gpuPercent: 10,
            freeVramGiB: 8,
            aiVramGiB: 1,
            gpuCelsius: 45,
          },
          now
        ).reason,
        "gpu_not_accepted"
      );
    for (let now = 30000; now < 60000; now += 2000)
      assert.equal(recovering.update(validSample, now).action, "wait");
    assert.equal(recovering.update(validSample, 60000).action, "resume");
  });
  await test("JST boundary is independent of host timezone", () => {
    const boundary = Date.parse("2026-10-06T15:00:00Z");
    assert.equal(jstDay(boundary - 1), "2026-10-06");
    assert.equal(jstDay(boundary), "2026-10-07");
    assert.equal(nextJstDay(boundary - 1), boundary);
    assert.equal(
      reserveBudget(privateDir("midnight"), request(), boundary - 500).reason,
      "jst_boundary"
    );
  });
  await test("host smoke eligibility requires real continuous CPU/RAM recovery, not only free RAM", () => {
    const samples = Array.from({ length: 16 }, (_, index) => ({
      cpuPercent: 20,
      freeRamGiB: 7,
      probeMs: 500,
      measuredAt: clock + index * 2000,
    }));
    const end = clock + 30000;
    assert.equal(hostEligibility(samples, clock, end), true);
    for (const cpuPercent of [40, 60, 100])
      assert.equal(
        hostEligibility(
          samples.map((item) => ({ ...item, cpuPercent })),
          clock,
          end
        ),
        false
      );
    for (const changed of [
      samples.slice(1),
      samples.slice(0, -1),
      samples.map((item, index) =>
        index === 8 ? { ...item, cpuPercent: 60 } : item
      ),
      samples.map((item, index) =>
        index === 8 ? { ...item, freeRamGiB: 5.99 } : item
      ),
      samples.map((item, index) =>
        index === 8 ? { ...item, probeMs: 5000 } : item
      ),
      samples.map((item, index) =>
        index === 8 ? { ...item, cpuPercent: NaN } : item
      ),
      samples.map((item, index) =>
        index === 8 ? { ...item, measuredAt: item.measuredAt + 1500 } : item
      ),
      samples.map((item, index) =>
        index === 8 ? { ...item, measuredAt: samples[7].measuredAt } : item
      ),
    ])
      assert.equal(hostEligibility(changed, clock, end), false);
    assert.equal(hostEligibility(samples, clock, end + 5000), false);
    assert.equal(hostEligibility(samples, clock, end - 1), false);
  });
  await test("read-only previews neither initialize storage nor authorize a stale budget", () => {
    const dir = join(sandbox, "preview-uninitialized");
    assert.deepEqual(previewBudgetReservation(dir, request(), clock), {
      status: "available",
    });
    assert.equal(existsSync(dir), false);
    const end = nextJstDay(clock) - 123;
    assert.equal(
      previewBudgetReservation(dir, request(), end).reason,
      "jst_boundary"
    );
    assert.equal(previewNextChunk(dir, request(), end).status, "available");
    assert.equal(existsSync(dir), false);
    const reserved = reserveNextChunk(dir, request(), end);
    assert.equal(reserved.reserved.wallMs, 123);
    const saved = readFileSync(join(dir, "usage.json"));
    assert.equal(
      previewNextChunk(dir, request(), end).reason,
      "owned_job_or_unreconciled_orphan"
    );
    assert.equal(
      reserveNextChunk(dir, request(), end).reason,
      "owned_job_or_unreconciled_orphan"
    );
    assert.deepEqual(readFileSync(join(dir, "usage.json")), saved);
    assert.equal(budgetStatus(dir, end).used.wallMs, 123);
    assert.throws(
      () => previewBudgetReservation(dir, request({ threads: 3 }), end),
      /unsupported/
    );
  });
  await test("shared reservation survives a fresh process; orphan ownership blocks the next job", async () => {
    const dir = privateDir("restart"),
      reserved = reserveBudget(dir, request({ threads: 2 }), clock);
    const code = `import { budgetStatus } from ${JSON.stringify(pathToFileURL(resolve(root, "scripts/ismcts/budget.mjs")).href)}; console.log(JSON.stringify(budgetStatus(process.argv[1], Number(process.argv[2]))));`;
    const result = await child(code, [dir, String(clock + 1)]);
    assert.equal(result.exitCode, 0, result.stderr);
    const persisted = JSON.parse(result.stdout);
    assert.equal(persisted.used.cpuMs, 2000);
    assert.equal(persisted.active[0].id, reserved.id);
    assert.equal(
      reserveBudget(dir, request({ owner: "other-worktree" }), clock + 1)
        .status,
      "deferred_load"
    );
    assert.throws(
      () => finishBudget(dir, reserved.id, "another-owner", {}, clock + 1),
      /ownership/
    );
    assert.throws(
      () => finish(dir, reserved, { treeExited: false }),
      /retained/
    );
    assert.equal(budgetStatus(dir, clock + 1).active.length, 1);
  });
  await test("two independent processes contend for one atomic job budget", async () => {
    const dir = privateDir("concurrent");
    const code = `import { reserveBudget } from ${JSON.stringify(pathToFileURL(resolve(root, "scripts/ismcts/budget.mjs")).href)}; try { console.log(JSON.stringify(reserveBudget(process.argv[1], { wallMs:1000, owner:String(process.pid) }, Number(process.argv[2])))); } catch(e) { console.log(JSON.stringify({status:'locked',reason:e.code})); }`;
    const results = await Promise.all([
      child(code, [dir, String(clock)]),
      child(code, [dir, String(clock)]),
    ]);
    for (const result of results)
      assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      results
        .map((result) => JSON.parse(result.stdout))
        .filter((result) => result.status === "reserved").length,
      1
    );
    assert.equal(budgetStatus(dir, clock + 1).used.wallMs, 1000);
  });
  await test("completed work returns measured unused budget; failed work stays fully charged", () => {
    const dir = privateDir("accounting"),
      reserved = reserveBudget(dir, request({ threads: 2 }), clock);
    finish(dir, reserved, { usage: usage(500, 700) });
    assert.equal(budgetStatus(dir, clock + 1000).used.cpuMs, 700);
    const failed = reserveBudget(dir, request({ threads: 2 }), clock + 1000);
    finish(dir, failed, { status: "failed", usage: usage(100) }, clock + 2000);
    assert.equal(budgetStatus(dir, clock + 2000).used.cpuMs, 2700);
    assert.throws(() => finish(dir, failed, {}, clock + 3000), /ownership/);
  });
  await test("daily wall/CPU/output/monitor and chunk limits are inclusive and persistent", () => {
    const dir = privateDir("daily");
    const dayStart = nextJstDay(clock) - 86400000;
    for (let i = 0; i < profile.offline.wallMs / profile.offline.chunkMs; i++) {
      const start = dayStart + i * profile.offline.chunkMs;
      const reserved = reserveBudget(
        dir,
        request({ wallMs: profile.offline.chunkMs, threads: 2 }),
        start
      );
      finish(
        dir,
        reserved,
        { status: "failed", usage: usage(0) },
        start + profile.offline.chunkMs - 1
      );
    }
    assert.equal(
      budgetStatus(dir, dayStart + profile.offline.wallMs - 1).remaining.wallMs,
      0
    );
    assert.equal(
      budgetStatus(dir, dayStart + profile.offline.wallMs - 1).remaining.cpuMs,
      0
    );
    assert.equal(
      reserveNextChunk(dir, request(), dayStart + profile.offline.wallMs - 1)
        .status,
      "deferred_budget"
    );
    assert.equal(
      reserveBudget(dir, request(), nextJstDay(clock)).status,
      "reserved"
    );
    const output = privateDir("output");
    const first = reserveBudget(
      output,
      request({ outputBytes: profile.offline.outputBytes }),
      clock
    );
    finish(output, first, { status: "failed", usage: usage(0) });
    assert.equal(
      reserveBudget(output, request({ outputBytes: 1 }), clock + 1000).status,
      "deferred_budget"
    );
    assert.throws(
      () =>
        reserveBudget(
          privateDir("monitor"),
          request({ monitor: true, wallMs: 600001 }),
          clock
        ),
      /monitor/
    );
    for (const overrides of [
      { wallMs: 1200001 },
      { threads: 3 },
      { gpu: true },
      { outputBytes: -1 },
      { owner: "" },
    ])
      assert.throws(
        () =>
          reserveBudget(privateDir("bad-budget"), request(overrides), clock),
        /reservation/
      );
  });
  await test("budget tampering, missing persisted ledger, incomplete accounting and rollback are rejected", () => {
    const dir = privateDir("tamper"),
      reserved = reserveBudget(dir, request(), clock);
    assert.throws(() => budgetStatus(dir, clock - 1), /timestamp/);
    assert.throws(
      () => finish(dir, reserved, { accountingComplete: false }),
      /retained/
    );
    assert.throws(
      () => finish(dir, reserved, { usage: usage(1001) }),
      /exceeds/
    );
    const ledger = readJson(join(dir, "usage.json"));
    ledger.days[jstDay(clock)].cpuMs = 0;
    atomicJson(join(dir, "usage.json"), ledger);
    assert.throws(() => budgetStatus(dir, clock), /totals/);
    rmSync(join(dir, "usage.json"));
    assert.throws(() => budgetStatus(dir, clock), /missing/);
  });
  await test("completed daily usage cannot be reassigned together with totals to an older day", () => {
    const dir = privateDir("day-reassignment");
    for (let i = 0; i < 9; i++) {
      const start = clock + i * profile.offline.chunkMs;
      const outputBytes = i === 0 ? profile.offline.outputBytes : 0;
      const reserved = reserveBudget(
        dir,
        request({ wallMs: profile.offline.chunkMs, threads: 2, outputBytes }),
        start
      );
      finish(
        dir,
        reserved,
        {
          usage: {
            ...usage(profile.offline.chunkMs, 2 * profile.offline.chunkMs),
            outputBytes,
          },
        },
        start + profile.offline.chunkMs
      );
    }
    const now = clock + 9 * profile.offline.chunkMs;
    const extra = request({
      wallMs: profile.offline.chunkMs,
      threads: 2,
      outputBytes: profile.offline.outputBytes,
    });
    assert.equal(reserveBudget(dir, extra, now).reason, "daily_limit");
    const ledger = readJson(join(dir, "usage.json"));
    const yesterday = jstDay(clock - 86400000);
    ledger.days[yesterday] = ledger.days[jstDay(clock)];
    delete ledger.days[jstDay(clock)];
    for (const entry of ledger.reservations) entry.day = yesterday;
    atomicJson(join(dir, "usage.json"), ledger);
    assert.throws(() => budgetStatus(dir, now), /reservation day/);
    assert.throws(() => reserveBudget(dir, extra, now), /reservation day/);
  });
  await test("past usage and a completion at midnight stay attributed to their start day", () => {
    const dir = privateDir("day-boundary-accounting");
    const start = nextJstDay(clock) - 1000;
    const reserved = reserveBudget(dir, request(), start);
    finish(dir, reserved, {}, start + 1000);
    const status = budgetStatus(dir, start + 1000);
    assert.equal(status.used.wallMs, 0);
    assert.equal(
      readJson(join(dir, "usage.json")).days[jstDay(start)].wallMs,
      1000
    );
    const current = reserveBudget(dir, request(), start + 1000);
    assert.equal(current.status, "reserved");
    assert.equal(budgetStatus(dir, start + 1000).used.wallMs, 1000);
  });
  function legacyBudget(name, active = false) {
    const dir = privateDir(name);
    const first = reserveBudget(dir, request({ threads: 2 }), clock - 86400000);
    finish(
      dir,
      first,
      { status: "failed", usage: usage(0) },
      clock - 86400000 + 1000
    );
    const second = reserveBudget(
      dir,
      request({ threads: 2, outputBytes: 500 }),
      clock
    );
    if (!active)
      finish(dir, second, { usage: { ...usage(500, 700), outputBytes: 200 } });
    const ledger = readJson(join(dir, "usage.json"));
    ledger.schemaVersion = 1;
    ledger.profileHash = bootstrapProfileHash;
    delete ledger.migration;
    // Model the historical bootstrap writer's marker, not the new schema2
    // checkpoint used by the fixture setup APIs.
    atomicJson(join(dir, "budget-initialized.json"), { schemaVersion: 1 });
    for (const name of readdirSync(dir))
      if (name.startsWith("budget-checkpoint-")) unlinkSync(join(dir, name));
    // Keep noncanonical whitespace as a byte-preservation counterexample.
    writeFileSync(join(dir, "usage.json"), JSON.stringify(ledger));
    return { dir, ledger, bytes: readFileSync(join(dir, "usage.json")) };
  }
  await test("24-hour profile changes only approved daily time ceilings; GPU stays disabled", () => {
    assert.equal(bootstrapProfile.offline.wallMs, 10800000);
    assert.equal(bootstrapProfile.offline.cpuMs, 21600000);
    assert.equal(bootstrapProfile.offline.gpuMs, 1800000);
    const expected = JSON.parse(JSON.stringify(bootstrapProfile));
    expected.schemaVersion = 2;
    Object.assign(expected.offline, {
      wallMs: 86400000,
      cpuMs: 172800000,
      gpuMs: 21600000,
    });
    assert.deepEqual(profile, expected);
    assert.equal(profile.gpu.enabled, false);
  });
  await test("explicit migration retains bootstrap bytes, days, usage and all reservations across restart", async () => {
    const { dir, ledger, bytes } = legacyBudget("migration");
    assert.throws(() => budgetStatus(dir, clock + 2000), /migration_required/);
    assert.throws(
      () => reserveBudget(dir, request(), clock + 2000),
      /migration_required/
    );
    const migrated = migrateBudget(dir, clock + 2000);
    assert.equal(migrated.status, "migrated");
    assert.deepEqual(
      readFileSync(join(dir, migrated.migration.source.path)),
      bytes
    );
    const current = readJson(join(dir, "usage.json"));
    assert.deepEqual(current.days, ledger.days);
    assert.deepEqual(current.reservations, ledger.reservations);
    assert.deepEqual(
      budgetStatus(dir, clock + 2000).used,
      ledger.days[jstDay(clock)]
    );
    const module = pathToFileURL(join(root, "scripts/ismcts/budget.mjs")).href;
    const restarted = await child(
      `import { budgetStatus } from ${JSON.stringify(module)}; console.log(JSON.stringify(budgetStatus(process.argv[1],Number(process.argv[2]))));`,
      [dir, String(clock + 2000)]
    );
    assert.equal(restarted.exitCode, 0, restarted.stderr);
    assert.deepEqual(
      JSON.parse(restarted.stdout).used,
      ledger.days[jstDay(clock)]
    );
    const oldHash = hash(readFileSync(join(dir, "usage.json")));
    assert.equal(migrateBudget(dir, clock + 3000).status, "already_current");
    assert.equal(hash(readFileSync(join(dir, "usage.json"))), oldHash);
    const extra = reserveBudget(dir, request(), clock + 3000);
    assert.equal(extra.status, "reserved");
    finish(dir, extra, {}, clock + 4000);
    assert.equal(budgetStatus(dir, clock + 4000).used.wallMs, 1500);
    assert.deepEqual(
      readFileSync(join(dir, migrated.migration.source.path)),
      bytes
    );
  });
  await test("completed migration binds its initial target after later completed and failed jobs", () => {
    for (const outcome of ["completed", "failed"]) {
      const x = legacyBudget(`migration-later-${outcome}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const journalFile = join(x.dir, "budget-migration-status.json");
      const journalBytes = readFileSync(journalFile);
      const initialTarget = readFileSync(join(x.dir, "usage.json"));
      assert.equal(hash(initialTarget), readJson(journalFile).targetHash);
      const extra = reserveBudget(x.dir, request(), clock + 3000);
      finish(
        x.dir,
        extra,
        { status: outcome, usage: usage(200) },
        clock + 4000
      );
      const currentBytes = readFileSync(join(x.dir, "usage.json"));
      assert.notEqual(hash(currentBytes), readJson(journalFile).targetHash);
      assert.equal(
        budgetStatus(x.dir, clock + 4000).used.wallMs,
        outcome === "completed" ? 700 : 1500
      );
      assert.equal(
        migrateBudget(x.dir, clock + 5000).status,
        "already_current"
      );
      assert.deepEqual(readFileSync(join(x.dir, "usage.json")), currentBytes);
      assert.deepEqual(readFileSync(journalFile), journalBytes);
      assert.deepEqual(
        readFileSync(join(x.dir, result.migration.source.path)),
        x.bytes
      );
      const next = reserveBudget(x.dir, request(), clock + 6000);
      assert.equal(next.status, "reserved");
      finish(x.dir, next, {}, clock + 7000);
      assert.deepEqual(readFileSync(journalFile), journalBytes);
    }
  });
  await test("completed target mutation and alternate retained source are rejected by every budget entry point", () => {
    const accepted = [];
    for (const mutation of ["target", "alternate-source"])
      for (const outcome of ["no-later-job", "completed", "failed"])
        for (const operation of ["status", "reserve", "migrate"])
          for (const attempt of [0, 1, 2]) {
            // Each operation/retry starts with independent private bytes so an
            // earlier refusal cannot hide a bypass via its repair diagnostic.
            const x = legacyBudget(
              `migration-completed-${mutation}-${outcome}-${operation}-${attempt}`
            );
            const result = migrateBudget(x.dir, clock + 2000);
            if (outcome !== "no-later-job") {
              const extra = reserveBudget(x.dir, request(), clock + 3000);
              finish(x.dir, extra, { status: outcome }, clock + 4000);
            }
            const file = join(x.dir, "usage.json");
            const journalFile = join(x.dir, "budget-migration-status.json");
            const journal = readJson(journalFile);
            if (mutation === "target") journal.targetHash = "0".repeat(64);
            else {
              const alternate = { ...x.ledger, days: {}, reservations: [] };
              const bytes = JSON.stringify(alternate);
              const source = {
                sha256: hash(bytes),
                path: `bootstrap-usage-${hash(bytes)}.json`,
              };
              writeFileSync(join(x.dir, source.path), bytes);
              const ledger = readJson(file);
              ledger.migration.source = source;
              journal.migration.source = source;
              ledger.days = {};
              ledger.reservations = [];
              atomicJson(file, ledger);
            }
            atomicJson(journalFile, journal);
            const before = readFileSync(file);
            const archives = readdirSync(x.dir)
              .filter((name) => name.startsWith("bootstrap-usage-"))
              .map((name) => [name, readFileSync(join(x.dir, name))]);
            const call = () =>
              operation === "status"
                ? budgetStatus(x.dir, clock + 5000)
                : operation === "reserve"
                  ? reserveBudget(x.dir, request(), clock + 5000)
                  : migrateBudget(x.dir, clock + 5000);
            for (let retry = 0; retry <= attempt; retry++) {
              let refused = false;
              try {
                call();
              } catch (error) {
                refused = true;
                assert.match(error.message, /migration/);
              }
              if (!refused) {
                accepted.push({ mutation, outcome, operation, retry });
                break;
              }
              assert.deepEqual(readFileSync(file), before);
              for (const [name, bytes] of archives)
                assert.deepEqual(readFileSync(join(x.dir, name)), bytes);
              assert.deepEqual(
                readFileSync(join(x.dir, result.migration.source.path)),
                x.bytes
              );
              assert.equal(
                readJson(journalFile).targetHash,
                journal.targetHash
              );
            }
          }
    assert.deepEqual(
      accepted,
      [],
      "corrupt completed transition must never restore budget"
    );
  });
  await test("active or dead unreconciled owners and unknown/corrupt bootstrap history block migration", () => {
    const active = legacyBudget("migration-active", true);
    assert.throws(
      () => migrateBudget(active.dir, clock + 2000),
      /unreconciled/
    );
    assert.deepEqual(
      readFileSync(join(active.dir, "usage.json")),
      active.bytes
    );
    assert.equal(
      readJson(join(active.dir, "budget-migration-status.json")).status,
      "repair_required"
    );
    for (const [name, mutate] of [
      [
        "profile",
        (x) => {
          x.profileHash = "0".repeat(64);
        },
      ],
      [
        "days",
        (x) => {
          x.days[jstDay(clock)].cpuMs = 0;
        },
      ],
      [
        "clock",
        (x) => {
          x.lastClock = clock + 5000;
        },
      ],
      ["missing", () => {}],
    ]) {
      const x = legacyBudget(`migration-bad-${name}`);
      mutate(x.ledger);
      atomicJson(join(x.dir, "usage.json"), x.ledger);
      if (name === "missing") unlinkSync(join(x.dir, "usage.json"));
      const before = existsSync(join(x.dir, "usage.json"))
        ? readFileSync(join(x.dir, "usage.json"))
        : null;
      assert.throws(() => migrateBudget(x.dir, clock + 2000));
      if (before)
        assert.deepEqual(readFileSync(join(x.dir, "usage.json")), before);
      assert.equal(
        readJson(join(x.dir, "budget-migration-status.json")).status,
        "repair_required"
      );
    }
  });
  await test("migration archive and historical prefix tampering cannot return unused budget", () => {
    for (const mutation of [
      "archive",
      "prefix",
      "missing",
      "journal",
      "binding",
      "removed-provenance",
      "removed-journal-and-provenance",
    ]) {
      const x = legacyBudget(`migration-tamper-${mutation}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const file = join(x.dir, "usage.json");
      if (mutation === "archive")
        writeFileSync(join(x.dir, result.migration.source.path), "{}");
      if (mutation === "missing")
        unlinkSync(join(x.dir, result.migration.source.path));
      if (mutation === "journal")
        atomicJson(join(x.dir, "budget-migration-status.json"), {
          status: "pending",
        });
      if (mutation === "binding") {
        const ledger = readJson(file);
        ledger.migration.source.path = "../usage.json";
        atomicJson(file, ledger);
      }
      if (
        mutation === "removed-provenance" ||
        mutation === "removed-journal-and-provenance"
      ) {
        const ledger = readJson(file);
        ledger.migration = null;
        ledger.reservations = [];
        ledger.days = {};
        atomicJson(file, ledger);
        if (mutation === "removed-journal-and-provenance")
          unlinkSync(join(x.dir, "budget-migration-status.json"));
      }
      if (mutation === "prefix") {
        const ledger = readJson(file);
        ledger.reservations[1].measured.cpuMs = 0;
        ledger.days[jstDay(clock)].cpuMs = 0;
        atomicJson(file, ledger);
      }
      assert.throws(() => budgetStatus(x.dir, clock + 3000));
      assert.throws(() => reserveBudget(x.dir, request(), clock + 3000));
      if (mutation === "removed-journal-and-provenance") {
        const before = readFileSync(file);
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.throws(() => migrateBudget(x.dir, clock + 3000 + attempt));
          assert.deepEqual(readFileSync(file), before);
          assert.deepEqual(
            readFileSync(join(x.dir, result.migration.source.path)),
            x.bytes
          );
          assert.throws(() => budgetStatus(x.dir, clock + 4000));
          assert.throws(() => reserveBudget(x.dir, request(), clock + 4000));
        }
      }
    }
  });
  await test("a malformed existing journal stays blocked across retries; absent-journal repair remains explicit", () => {
    const invalid = [
      {},
      { schemaVersion: 1 },
      { status: "pending" },
      null,
      false,
      0,
      "",
      [],
    ];
    for (const [index, journal] of invalid.entries()) {
      const x = legacyBudget(`migration-malformed-journal-${index}`);
      const journalFile = join(x.dir, "budget-migration-status.json");
      atomicJson(journalFile, journal);
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.throws(() => migrateBudget(x.dir, clock + 2000 + attempt));
        assert.deepEqual(readFileSync(join(x.dir, "usage.json")), x.bytes);
        const diagnostic = readJson(journalFile);
        assert.equal(diagnostic.status, "repair_required");
        assert.equal(diagnostic.blockedJournal, true);
        assert.equal(diagnostic.migration, undefined);
        assert.equal(diagnostic.targetHash, undefined);
        assert.equal(
          readdirSync(x.dir).some((name) =>
            name.startsWith("bootstrap-usage-")
          ),
          false
        );
        assert.throws(() => reserveBudget(x.dir, request(), clock + 3000));
      }
    }
    const x = legacyBudget("migration-first-failure-no-journal");
    const file = join(x.dir, "usage.json");
    atomicJson(file, { ...x.ledger, profileHash: "0".repeat(64) });
    assert.throws(() => migrateBudget(x.dir, clock + 2000));
    assert.equal(
      readJson(join(x.dir, "budget-migration-status.json")).blockedJournal,
      false
    );
    // A genuine first-failure diagnostic has no earlier transition binding.
    // Repairing the source explicitly can then migrate its original bytes.
    writeFileSync(file, x.bytes);
    const result = migrateBudget(x.dir, clock + 3000);
    assert.equal(result.status, "migrated");
    assert.deepEqual(
      readFileSync(join(x.dir, result.migration.source.path)),
      x.bytes
    );
    assert.deepEqual(
      budgetStatus(x.dir, clock + 3000).used,
      x.ledger.days[jstDay(clock)]
    );
  });
  await test("interrupted migration resumes exact target but refuses changed target and archive", () => {
    for (const stage of [
      "before-ledger",
      "after-ledger",
      "changed-target",
      "changed-archive",
    ]) {
      const x = legacyBudget(`migration-interrupt-${stage}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const statusFile = join(x.dir, "budget-migration-status.json");
      const status = readJson(statusFile);
      status.status = "pending";
      delete status.completedAt;
      atomicJson(statusFile, status);
      if (stage === "before-ledger")
        writeFileSync(join(x.dir, "usage.json"), x.bytes);
      if (stage === "changed-target") {
        const ledger = readJson(join(x.dir, "usage.json"));
        ledger.lastClock++;
        atomicJson(join(x.dir, "usage.json"), ledger);
      }
      if (stage === "changed-archive")
        writeFileSync(join(x.dir, result.migration.source.path), "{}");
      if (stage.startsWith("changed"))
        assert.throws(() => migrateBudget(x.dir, clock + 3000));
      else {
        assert.ok(
          ["migrated", "already_current"].includes(
            migrateBudget(x.dir, clock + 3000).status
          )
        );
        assert.deepEqual(
          budgetStatus(x.dir, clock + 3000).used,
          x.ledger.days[jstDay(clock)]
        );
      }
    }
  });
  await test("before-ledger retry is bound to the first source bytes, migration time and target", () => {
    for (const mutation of [
      "source-truncated",
      "source-replaced",
      "source-bytes",
      "migration-time",
      "target",
      "binding-missing",
      "journal",
      "missing-archive",
      "changed-archive",
    ]) {
      const x = legacyBudget(`migration-retry-${mutation}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const file = join(x.dir, "usage.json");
      const statusFile = join(x.dir, "budget-migration-status.json");
      const status = readJson(statusFile);
      status.status = "pending";
      delete status.completedAt;
      writeFileSync(file, x.bytes);
      if (mutation === "source-truncated") {
        const changed = { ...x.ledger, days: {}, reservations: [] };
        atomicJson(file, changed);
      }
      if (mutation === "source-replaced") {
        const changed = JSON.parse(JSON.stringify(x.ledger));
        changed.reservations[1].owner = "replacement-owner";
        atomicJson(file, changed);
      }
      if (mutation === "source-bytes") atomicJson(file, x.ledger);
      if (mutation === "migration-time") status.migration.migratedAt++;
      if (mutation === "target") status.targetHash = "0".repeat(64);
      if (mutation === "binding-missing") delete status.migration;
      if (mutation === "journal") status.status = "unknown";
      const archive = join(x.dir, result.migration.source.path);
      if (mutation === "missing-archive") unlinkSync(archive);
      if (mutation === "changed-archive") writeFileSync(archive, "{}");
      atomicJson(statusFile, status);
      const before = readFileSync(file);
      const archiveBefore = existsSync(archive) ? readFileSync(archive) : null;
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.throws(() => migrateBudget(x.dir, clock + 3000 + attempt));
        assert.deepEqual(readFileSync(file), before);
        if (archiveBefore)
          assert.deepEqual(readFileSync(archive), archiveBefore);
        else assert.equal(existsSync(archive), false);
        const failed = readJson(statusFile);
        assert.equal(failed.status, "repair_required");
        assert.deepEqual(failed.migration, status.migration);
        assert.equal(failed.targetHash, status.targetHash);
        assert.throws(() => reserveBudget(x.dir, request(), clock + 4000));
      }
      if (mutation === "source-truncated") {
        // An explicit repair restoring the original bytes can resume exactly
        // the first transition; it cannot pick a new source or migration time.
        writeFileSync(file, x.bytes);
        const resumed = migrateBudget(x.dir, clock + 5000);
        assert.deepEqual(resumed.migration, result.migration);
        assert.equal(readJson(statusFile).targetHash, status.targetHash);
        assert.equal(budgetStatus(x.dir, clock + 5000).used.wallMs, 500);
      }
    }
  });
  await test("schema2 snapshots cannot discard later usage with migration archive and journal unchanged", () => {
    const accepted = [];
    for (const mutation of ["ledger-only", "ledger-and-marker"])
      for (const outcome of ["active", "completed", "failed"])
        for (const operation of ["status", "reserve", "migrate"])
          for (const attempt of [0, 1, 2]) {
            const x = legacyBudget(
              `schema2-rollback-${mutation}-${outcome}-${operation}-${attempt}`
            );
            const result = migrateBudget(x.dir, clock + 2000);
            const file = join(x.dir, "usage.json");
            const initial = readFileSync(file);
            const markerFile = join(x.dir, "budget-initialized.json");
            const initialMarker = readFileSync(markerFile);
            const journalFile = join(x.dir, "budget-migration-status.json");
            const journal = readJson(journalFile);
            const extra = reserveBudget(x.dir, request(), clock + 3000);
            if (outcome !== "active")
              finish(
                x.dir,
                extra,
                { status: outcome, usage: usage(200) },
                clock + 4000
              );
            assert.equal(
              budgetStatus(x.dir, clock + 4000).used.wallMs,
              outcome === "completed" ? 700 : 1500
            );
            writeFileSync(file, initial);
            if (mutation === "ledger-and-marker")
              writeFileSync(markerFile, initialMarker);
            const call = () =>
              operation === "status"
                ? budgetStatus(x.dir, clock + 5000)
                : operation === "reserve"
                  ? reserveBudget(x.dir, request(), clock + 5000)
                  : migrateBudget(x.dir, clock + 5000);
            for (let retry = 0; retry <= attempt; retry++) {
              try {
                call();
                accepted.push({ mutation, outcome, operation, retry });
                break;
              } catch {
                assert.deepEqual(readFileSync(file), initial);
                assert.deepEqual(
                  readFileSync(join(x.dir, result.migration.source.path)),
                  x.bytes
                );
                assert.equal(
                  readJson(journalFile).targetHash,
                  journal.targetHash
                );
                assert.deepEqual(
                  readJson(journalFile).migration,
                  journal.migration
                );
              }
            }
          }
    assert.deepEqual(
      accepted,
      [],
      "restoring schema2 initial target must not erase later usage"
    );
  });
  await test("ledger checkpoints reject loss and corruption and only finish exact persisted pending writes", () => {
    for (const migrated of [false, true]) {
      for (const mutation of [
        "missing",
        "unknown-schema",
        "unknown-status",
        "hash",
        "clock",
        "pending-before-ledger",
      ]) {
        const x = migrated
          ? legacyBudget(`checkpoint-${mutation}`)
          : { dir: privateDir(`checkpoint-fresh-${mutation}`) };
        if (migrated) migrateBudget(x.dir, clock + 2000);
        else {
          const first = reserveBudget(x.dir, request(), clock + 2000);
          finish(x.dir, first, {}, clock + 3000);
        }
        const ledgerFile = join(x.dir, "usage.json");
        const previous = readFileSync(ledgerFile);
        const extra = reserveBudget(x.dir, request(), clock + 4000);
        const marker = join(x.dir, "budget-initialized.json");
        const checkpoint = readJson(marker);
        if (mutation === "missing") unlinkSync(marker);
        else {
          if (mutation === "unknown-schema") checkpoint.schemaVersion = 1;
          if (mutation === "unknown-status") checkpoint.status = "unknown";
          if (mutation === "hash") checkpoint.targetHash = "0".repeat(64);
          if (mutation === "clock") checkpoint.writtenAt++;
          if (mutation === "pending-before-ledger") {
            checkpoint.status = "pending";
            writeFileSync(ledgerFile, previous);
          }
          atomicJson(marker, checkpoint);
        }
        const before = readFileSync(ledgerFile);
        const anchor = existsSync(marker) ? readFileSync(marker) : null;
        for (let attempt = 0; attempt < 3; attempt++) {
          assert.throws(() => budgetStatus(x.dir, clock + 5000));
          assert.throws(() => reserveBudget(x.dir, request(), clock + 5000));
          assert.throws(() => finish(x.dir, extra, {}, clock + 5000));
          assert.throws(() => migrateBudget(x.dir, clock + 5000));
          assert.deepEqual(readFileSync(ledgerFile), before);
          if (anchor) assert.deepEqual(readFileSync(marker), anchor);
          else assert.equal(existsSync(marker), false);
        }
      }
      const x = migrated
        ? legacyBudget("checkpoint-pending-migration")
        : { dir: privateDir("checkpoint-pending-fresh") };
      if (migrated) migrateBudget(x.dir, clock + 2000);
      const extra = reserveBudget(x.dir, request(), clock + 3000);
      const marker = join(x.dir, "budget-initialized.json");
      const checkpoint = readJson(marker);
      checkpoint.status = "pending";
      atomicJson(marker, checkpoint);
      const before = readFileSync(join(x.dir, "usage.json"));
      assert.throws(() => budgetStatus(x.dir, clock + 4000), /pending/);
      assert.throws(
        () => reserveBudget(x.dir, request(), clock + 4000),
        /pending/
      );
      assert.throws(() => finish(x.dir, extra, {}, clock + 4000), /pending/);
      assert.equal(
        migrateBudget(x.dir, clock + 4000).status,
        "already_current"
      );
      assert.deepEqual(readFileSync(join(x.dir, "usage.json")), before);
      assert.equal(readJson(marker).status, "completed");
      assert.equal(budgetStatus(x.dir, clock + 4000).active[0].id, extra.id);
      finish(x.dir, extra, { status: "failed", usage: usage(0) }, clock + 4000);
      assert.equal(
        budgetStatus(x.dir, clock + 4000).used.wallMs,
        migrated ? 1500 : 1000
      );
    }
  });
  await test("retained checkpoint corruption and missing ledger plus marker cannot reset fresh accounting", () => {
    for (const mutation of [
      "bytes",
      "gap",
      "noncanonical-name",
      "missing-current",
    ]) {
      const dir = privateDir(`checkpoint-retention-${mutation}`);
      const first = reserveBudget(dir, request(), clock);
      finish(dir, first, { status: "failed", usage: usage(0) }, clock + 1000);
      const names = readdirSync(dir)
        .filter((name) => name.startsWith("budget-checkpoint-"))
        .sort();
      assert.equal(names.length, 2);
      if (mutation === "bytes") writeFileSync(join(dir, names[0]), "{}");
      if (mutation === "gap") unlinkSync(join(dir, names[0]));
      if (mutation === "noncanonical-name")
        renameSync(
          join(dir, names[1]),
          join(
            dir,
            names[1].replace("budget-checkpoint-", "budget-checkpoint-invalid-")
          )
        );
      if (mutation === "missing-current") {
        unlinkSync(join(dir, "usage.json"));
        unlinkSync(join(dir, "budget-initialized.json"));
      }
      for (let retry = 0; retry < 3; retry++) {
        assert.throws(() => budgetStatus(dir, clock + 2000));
        assert.throws(() => reserveBudget(dir, request(), clock + 2000));
        assert.throws(() => migrateBudget(dir, clock + 2000));
        if (mutation === "missing-current")
          assert.equal(existsSync(join(dir, "usage.json")), false);
      }
    }
  });
  await test("a forged next checkpoint cannot truncate or revise previously finished or active history", () => {
    for (const mutation of [
      "initial-snapshot",
      "revised-finished",
      "revised-active",
      "clock",
      "metadata",
    ]) {
      for (const operation of ["status", "reserve", "migrate"]) {
        const x = legacyBudget(`checkpoint-forged-${mutation}-${operation}`);
        migrateBudget(x.dir, clock + 2000);
        const file = join(x.dir, "usage.json"),
          markerFile = join(x.dir, "budget-initialized.json");
        const initial = readJson(file);
        const extra = reserveBudget(x.dir, request(), clock + 3000);
        if (mutation !== "revised-active")
          finish(
            x.dir,
            extra,
            { status: "failed", usage: usage(0) },
            clock + 4000
          );
        const next = mutation === "initial-snapshot" ? initial : readJson(file);
        // Keep time monotonic: refusal must protect the reservation prefix
        // even when a forged new snapshot supplies a plausible newer clock.
        if (mutation === "initial-snapshot") next.lastClock = clock + 4500;
        if (mutation === "revised-finished") {
          next.reservations.at(-1).outcome = "completed";
          next.days[jstDay(clock)].wallMs -= 1000;
          next.days[jstDay(clock)].cpuMs -= 1000;
        }
        if (mutation === "revised-active")
          next.reservations.at(-1).owner = "forged-owner";
        if (mutation === "clock") next.lastClock++;
        if (mutation === "metadata") next.metadata = "forged";
        const bytes = JSON.stringify(next, null, 2) + "\n";
        const checkpoint = readJson(markerFile);
        checkpoint.sequence++;
        checkpoint.targetHash = hash(bytes);
        checkpoint.path = `budget-checkpoint-${String(checkpoint.sequence).padStart(16, "0")}-${checkpoint.targetHash}.json`;
        checkpoint.writtenAt = next.lastClock;
        const oldRecords = readdirSync(x.dir)
          .filter((name) => name.startsWith("budget-checkpoint-"))
          .map((name) => [name, readFileSync(join(x.dir, name))]);
        writeFileSync(join(x.dir, checkpoint.path), bytes);
        writeFileSync(file, bytes);
        atomicJson(markerFile, checkpoint);
        const call = () =>
          operation === "status"
            ? budgetStatus(x.dir, clock + 5000)
            : operation === "reserve"
              ? reserveBudget(x.dir, request(), clock + 5000)
              : migrateBudget(x.dir, clock + 5000);
        for (let retry = 0; retry < 3; retry++) {
          assert.throws(call);
          assert.deepEqual(readFileSync(file), Buffer.from(bytes));
          for (const [name, oldBytes] of oldRecords)
            assert.deepEqual(readFileSync(join(x.dir, name)), oldBytes);
        }
      }
    }
  });
  await test("checkpoint appends obey the same inclusive monitor tick limit as normal reservations", () => {
    for (const migrated of [false, true]) {
      for (const wallMs of [
        profile.offline.monitorTickMs,
        profile.offline.monitorTickMs + 1,
      ]) {
        for (const operation of ["status", "reserve", "finish", "migrate"]) {
          const x = migrated
            ? legacyBudget(`monitor-checkpoint-${wallMs}-${operation}`)
            : {
                dir: privateDir(
                  `monitor-checkpoint-fresh-${wallMs}-${operation}`
                ),
              };
          if (migrated) migrateBudget(x.dir, clock + 2000);
          else {
            const first = reserveBudget(x.dir, request(), clock + 1000);
            finish(x.dir, first, {}, clock + 2000);
          }
          const file = join(x.dir, "usage.json"),
            markerFile = join(x.dir, "budget-initialized.json");
          const next = readJson(file);
          const added = {
            id: "checkpoint-monitor",
            owner: "checkpoint-monitor-owner",
            day: jstDay(clock),
            startedAt: clock + 3000,
            status: "active",
            reserved: { ...usage(wallMs), monitorMs: wallMs },
            threads: 1,
            monitor: true,
          };
          next.reservations.push(added);
          for (const key of Object.keys(added.reserved))
            next.days[added.day][key] += added.reserved[key];
          next.lastClock = added.startedAt;
          const bytes = JSON.stringify(next, null, 2) + "\n";
          const checkpoint = readJson(markerFile);
          checkpoint.sequence++;
          checkpoint.targetHash = hash(bytes);
          checkpoint.path = `budget-checkpoint-${String(checkpoint.sequence).padStart(16, "0")}-${checkpoint.targetHash}.json`;
          checkpoint.writtenAt = next.lastClock;
          const oldRecords = readdirSync(x.dir)
            .filter((name) => name.startsWith("budget-checkpoint-"))
            .map((name) => [name, readFileSync(join(x.dir, name))]);
          writeFileSync(join(x.dir, checkpoint.path), bytes);
          writeFileSync(file, bytes);
          atomicJson(markerFile, checkpoint);
          const call = () =>
            operation === "status"
              ? budgetStatus(x.dir, clock + 4000)
              : operation === "reserve"
                ? reserveBudget(x.dir, request(), clock + 4000)
                : operation === "finish"
                  ? finish(x.dir, added, { usage: usage(0) }, clock + 4000)
                  : migrateBudget(x.dir, clock + 4000);
          if (wallMs > profile.offline.monitorTickMs) {
            for (let retry = 0; retry < 3; retry++) {
              // Verify the original limit violation first; a retained repair
              // journal may preempt later migration attempts with its own
              // diagnostic, but every retry must still refuse this ledger.
              assert.throws(call, retry === 0 ? /monitor tick/ : undefined);
              assert.deepEqual(readFileSync(file), Buffer.from(bytes));
            }
          } else {
            const result = call();
            if (operation === "status")
              assert.equal(result.active[0].reserved.monitorMs, wallMs);
            else if (operation === "reserve")
              assert.equal(result.status, "deferred_load");
            else if (operation === "finish")
              assert.equal(result.status, "finished");
            else assert.equal(result.status, "already_current");
          }
          for (const [name, oldBytes] of oldRecords)
            assert.deepEqual(readFileSync(join(x.dir, name)), oldBytes);
          if (migrated) {
            const journal = readJson(
              join(x.dir, "budget-migration-status.json")
            );
            assert.deepEqual(
              readFileSync(join(x.dir, journal.migration.source.path)),
              x.bytes
            );
          }
        }
      }
    }
    const dir = privateDir("normal-monitor-tick-boundary");
    assert.throws(
      () =>
        reserveBudget(
          dir,
          request({ monitor: true, wallMs: profile.offline.monitorTickMs + 1 }),
          clock
        ),
      /monitor tick/
    );
    const reserved = reserveBudget(
      dir,
      request({ monitor: true, wallMs: profile.offline.monitorTickMs }),
      clock
    );
    assert.equal(reserved.status, "reserved");
    assert.equal(
      budgetStatus(dir, clock).used.monitorMs,
      profile.offline.monitorTickMs
    );
    assert.equal(migrateBudget(dir, clock).status, "already_current");
    finish(dir, reserved, { usage: usage(0) }, clock + 1000);
    assert.equal(budgetStatus(dir, clock + 1000).used.monitorMs, 0);
  });
  await test("completed migration cannot be rerun from its bootstrap archive to discard later usage", () => {
    for (const outcome of ["completed", "failed"]) {
      const x = legacyBudget(`migration-rollback-${outcome}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const extra = reserveBudget(x.dir, request(), clock + 3000);
      finish(x.dir, extra, { status: outcome }, clock + 4000);
      assert.equal(budgetStatus(x.dir, clock + 4000).used.wallMs, 1500);
      const file = join(x.dir, "usage.json");
      const journalFile = join(x.dir, "budget-migration-status.json");
      const completed = readJson(journalFile);
      writeFileSync(file, x.bytes);
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.throws(
          () => migrateBudget(x.dir, clock + 5000 + attempt),
          /completed.*rollback/
        );
        assert.deepEqual(readFileSync(file), x.bytes);
        assert.deepEqual(
          readFileSync(join(x.dir, result.migration.source.path)),
          x.bytes
        );
        const failed = readJson(journalFile);
        assert.equal(failed.status, "repair_required");
        assert.equal(failed.completedAt, completed.completedAt);
        assert.deepEqual(failed.migration, completed.migration);
        assert.equal(failed.targetHash, completed.targetHash);
        assert.throws(() => budgetStatus(x.dir, clock + 6000));
        assert.throws(() => reserveBudget(x.dir, request(), clock + 6000));
      }
    }
  });
  await test("a retained archive or invalid journal is not silently reinitialized after interruption", () => {
    for (const stage of [
      "before-ledger",
      "completed",
      "after-ledger-invalid",
    ]) {
      const x = legacyBudget(`migration-journal-loss-${stage}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const file = join(x.dir, "usage.json");
      const journalFile = join(x.dir, "budget-migration-status.json");
      if (stage === "completed") {
        const extra = reserveBudget(x.dir, request(), clock + 3000);
        finish(x.dir, extra, { status: "failed" }, clock + 4000);
        assert.equal(budgetStatus(x.dir, clock + 4000).used.wallMs, 1500);
      }
      if (stage === "after-ledger-invalid") {
        const journal = readJson(journalFile);
        journal.status = "unknown";
        atomicJson(journalFile, journal);
      } else {
        writeFileSync(file, x.bytes);
        unlinkSync(journalFile);
      }
      const before = readFileSync(file);
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.throws(() => migrateBudget(x.dir, clock + 5000 + attempt));
        assert.deepEqual(readFileSync(file), before);
        assert.deepEqual(
          readFileSync(join(x.dir, result.migration.source.path)),
          x.bytes
        );
        assert.equal(readJson(journalFile).status, "repair_required");
        assert.throws(() => reserveBudget(x.dir, request(), clock + 6000));
      }
    }
  });
  await test("missing ledger cannot become an empty budget when initialization marker is also lost", () => {
    for (const remaining of ["both", "journal-only", "archive-only"]) {
      const x = legacyBudget(`migration-missing-ledger-${remaining}`);
      const result = migrateBudget(x.dir, clock + 2000);
      const file = join(x.dir, "usage.json");
      const journalFile = join(x.dir, "budget-migration-status.json");
      const archive = join(x.dir, result.migration.source.path);
      unlinkSync(file);
      unlinkSync(join(x.dir, "budget-initialized.json"));
      if (remaining === "journal-only") unlinkSync(archive);
      if (remaining === "archive-only") unlinkSync(journalFile);
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.throws(() => budgetStatus(x.dir, clock + 3000), /missing/);
        assert.throws(
          () => reserveBudget(x.dir, request(), clock + 3000),
          /missing/
        );
        assert.throws(
          () => migrateBudget(x.dir, clock + 3000 + attempt),
          /missing/
        );
        assert.equal(existsSync(file), false);
        assert.equal(readJson(journalFile).status, "repair_required");
        if (remaining !== "journal-only")
          assert.deepEqual(readFileSync(archive), x.bytes);
      }
    }
    const fresh = privateDir("migration-really-uninitialized");
    assert.equal(migrateBudget(fresh, clock).status, "not_initialized");
    assert.deepEqual(budgetStatus(fresh, clock).used, emptyUsage);
    assert.equal(existsSync(join(fresh, "usage.json")), false);
    assert.equal(
      existsSync(join(fresh, "budget-migration-status.json")),
      false
    );
  });
  await test("final JST chunk is shortened and next day continues with old usage retained", () => {
    const dir = privateDir("continuous-boundary"),
      end = nextJstDay(clock);
    const last = reserveNextChunk(
      dir,
      request({ wallMs: profile.offline.chunkMs, threads: 2 }),
      end - 1234
    );
    assert.equal(last.reserved.wallMs, 1234);
    assert.equal(last.reserved.cpuMs, 2468);
    finish(dir, last, { usage: usage(1234, 2468) }, end);
    const next = reserveNextChunk(
      dir,
      request({ wallMs: profile.offline.chunkMs, threads: 2 }),
      end
    );
    assert.equal(next.status, "reserved");
    assert.equal(next.reserved.wallMs, profile.offline.chunkMs);
    const ledger = readJson(join(dir, "usage.json"));
    assert.equal(ledger.days[jstDay(end - 1)].wallMs, 1234);
    assert.equal(ledger.reservations.length, 2);
    assert.throws(
      () =>
        reserveNextChunk(
          dir,
          request({ wallMs: profile.offline.chunkMs + 1 }),
          end
        ),
      /duration/
    );
  });
  await test("interrupted transaction lock is not silently reclaimed or treated as an empty ledger", () => {
    const dir = privateDir("transaction");
    writeFileSync(join(dir, "transaction.lock"), "crashed owner");
    assert.throws(() => transaction(dir, () => {}), /EEXIST/);
    assert.equal(
      readFileSync(join(dir, "transaction.lock"), "utf8"),
      "crashed owner"
    );
  });
  await test("redirected storage ancestors are rejected before reads, locks, creation and atomic writes", () => {
    const dir = privateDir("storage-paths"),
      outside = privateDir("storage-paths-target"),
      link = join(dir, "redirect");
    writeFileSync(join(outside, "existing.json"), '{"sentinel":true}\n');
    symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir"
    );
    try {
      for (const run of [
        () => safePath(join(link, "new/deep/value.json")),
        () => contained(link, "existing.json"),
        () => readJson(join(link, "existing.json")),
        () => atomicJson(join(link, "new/deep/value.json"), {}),
        () =>
          transaction(join(link, "budget"), () =>
            assert.fail("ran transaction")
          ),
        () => budgetStatus(link, clock),
        () => reserveBudget(link, request(), clock),
      ])
        assert.throws(run, /symlink\/junction/);
      assert.deepEqual(readdirSync(outside), ["existing.json"]);
      assert.deepEqual(readJson(join(outside, "existing.json")), {
        sentinel: true,
      });
    } finally {
      unlinkSync(link);
    }
  });
  await test("redirected ledger and transaction leaves cannot be read or replaced", () => {
    const dir = privateDir("storage-leaves"),
      outside = privateDir("storage-leaves-target");
    for (const name of [
      "usage.json",
      "budget-initialized.json",
      "transaction.lock",
    ]) {
      const link = join(dir, name);
      symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir"
      );
      try {
        assert.throws(() => sharedFile(dir, name), /symlink\/junction/);
        assert.throws(() => readJson(link), /symlink\/junction/);
        assert.throws(() => atomicJson(link, {}), /symlink\/junction/);
        if (name === "transaction.lock")
          assert.throws(
            () => transaction(dir, () => assert.fail("ran transaction")),
            /symlink\/junction/
          );
        else assert.throws(() => budgetStatus(dir, clock), /symlink\/junction/);
        assert.deepEqual(readdirSync(outside), []);
      } finally {
        unlinkSync(link);
      }
    }
  });
  await test("a redirected receipts directory is neither enumerated nor written", () => {
    const fixture = receiptFixture("receipt-junction"),
      outside = privateDir("receipt-junction-target"),
      link = join(fixture.directory, "receipts");
    symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir"
    );
    try {
      assert.throws(fixture.record, /symlink\/junction/);
      assert.throws(
        () => evidenceStatus(fixture.path, fixture.directory),
        /symlink\/junction/
      );
      assert.deepEqual(readdirSync(outside), []);
      assert.equal(
        existsSync(join(fixture.directory, "transaction.lock")),
        false
      );
    } finally {
      unlinkSync(link);
    }
  });
  await test("receipt derives exact command/log hashes and remains partial before parent integration", () => {
    const fixture = receiptFixture("receipt-valid"),
      receipt = fixture.record();
    assert.equal(
      receipt.gate.argv[0],
      resolve(fixture.path, "scripts/test-ismcts-program.mjs")
    );
    assert.equal(receipt.gate.counts.completed, 4);
    const foreign = createReceiptRepository("receipt-same-bytes-foreign-root");
    copyFileSync(
      join(fixture.path, "scripts/ismcts-program.mjs"),
      join(foreign, "scripts/ismcts-program.mjs")
    );
    assert.notEqual(
      state.sourceFingerprint(foreign, {
        extraFiles: auditInputFiles(foreign),
      }),
      fixture.report.fingerprint
    );
    assert.equal(
      verifyReceipt(foreign, fixture.directory, receipt).state,
      "invalid"
    );
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    for (const independent of [
      "scripts/ismcts/runtime-telemetry.mjs",
      "scripts/ismcts/test-runtime-telemetry.mjs",
      "manual/ai-reference/30_plan/ismcts-full-run/i0-runtime-telemetry.md",
    ]) {
      const file = join(fixture.path, independent),
        before = readFileSync(file);
      writeFileSync(
        file,
        Buffer.concat([before, Buffer.from("\n// runtime-only change\n")])
      );
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, receipt).state,
        "unverified",
        independent
      );
      writeFileSync(file, before);
    }
    const status = evidenceStatus(fixture.path, fixture.directory);
    assert.equal(makePlan(status, {}).nextTask, "I0");
    assert.equal(makePlan(status, {}).skipWorker, false);
    assert.deepEqual(
      status.taskStates[0].acceptances.map((item) => item.acceptanceId),
      tasks.I0
    );
    assert.throws(
      () =>
        recordReceipt(
          fixture.path,
          fixture.directory,
          "I0",
          "calibration",
          fixture.run
        ),
      /not implemented/
    );
  });
  await test("source edits invalidate receipts while unrelated committed changes preserve their scope", () => {
    const fixture = receiptFixture("receipt-scope"),
      receipt = fixture.record();
    writeFileSync(join(fixture.path, "unrelated.md"), "unrelated\n");
    fixture.git(["add", "unrelated.md"]);
    fixture.git(["commit", "-m", "unrelated"]);
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    for (const dependency of [
      "scripts/artifact-storage.mjs",
      "scripts/artifact-storage-policy.json",
      "scripts/lib/stored-file-sizes.mjs",
      "scripts/lib/stored-file-sizes.ps1",
    ]) {
      const file = join(fixture.path, dependency),
        before = readFileSync(file);
      writeFileSync(
        file,
        Buffer.concat([before, Buffer.from("\nfixture-change\n")])
      );
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /stale receipt scope/,
        dependency
      );
      writeFileSync(file, before);
    }
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    writeFileSync(
      join(fixture.path, "scripts/ismcts/new-module.mjs"),
      "export const change = true;\n"
    );
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /stale/
    );
  });
  await test("thread environment changes between run and record cannot certify the new runtime", () => {
    for (const [keyIndex, key] of [
      "OMP_NUM_THREADS",
      "MKL_NUM_THREADS",
      "OPENBLAS_NUM_THREADS",
      "omp_num_threads",
      "mkl_num_threads",
      "openblas_num_threads",
    ].entries()) {
      const saved = process.env[key];
      try {
        process.env[key] = "1";
        const fixture = receiptFixture(`receipt-thread-${keyIndex}`);
        process.env[key] = "2";
        assert.throws(fixture.record, /harness source changed/);
        process.env[key] = "1";
        assert.equal(fixture.record().finalization, null);
      } finally {
        if (saved === undefined) delete process.env[key];
        else process.env[key] = saved;
      }
    }
  });
  await test("new engine paths require full frozen evidence and invalidate older acceptance on failure", () => {
    const fixture = receiptFixture("receipt-new-engine-path");
    const file = "packages/rules-core/src/effect/new-module.ts";
    mkdirSync(dirname(join(fixture.path, file)), { recursive: true });
    writeFileSync(join(fixture.path, file), "export const effect = true;\n");
    fixture.report.changed = [file, "scripts/ismcts-program.mjs"];
    fixture.report.sourceTree = buildVerificationTree(
      fixture.path,
      "HEAD"
    ).headTree;
    fixture.report.fingerprint = state.sourceFingerprint(fixture.path, {
      extraFiles: auditInputFiles(fixture.path),
    });
    const originalGate = fixture.report.gates.find(
      (gate) => gate.id === "ismcts-program"
    );
    fixture.report.gates = fullGates.map((id) =>
      id === originalGate.id
        ? originalGate
        : {
            id,
            status: "passed",
            reused: false,
            exitCode: 0,
            startedAt: fixture.report.startedAt,
            finishedAt: fixture.report.finishedAt,
          }
    );
    atomicJson(fixture.run, fixture.report);
    const receipt = fixture.record();
    assert.equal(
      receipt.finalization,
      null,
      "a complete full run remains acceptable for a new engine path"
    );
    fixture.git(["add", file, "scripts/ismcts-program.mjs"]);
    fixture.git(["commit", "-m", "verified fixture with new engine module"]);
    const next = "packages/rules-core/src/effect/another-new-module.ts";
    writeFileSync(join(fixture.path, next), "export const effect = false;\n");
    const startedAt = fixture.report.finishedAt + 1;
    atomicJson(join(fixture.path, `logs/harness/runs/${startedAt}-2.json`), {
      ...fixture.report,
      changed: [next],
      diffBases: [fixture.git(["rev-parse", "HEAD"])],
      sourceTree: buildVerificationTree(fixture.path, "HEAD").headTree,
      fingerprint: state.sourceFingerprint(fixture.path, {
        extraFiles: auditInputFiles(fixture.path),
      }),
      startedAt,
      finishedAt: startedAt + 1,
      status: "failed",
      gates: [{ id: "format", status: "failed", exitCode: 1 }],
    });
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /later/,
      "a failed full attempt for a new engine path cannot be hidden by a narrow known-module scope"
    );
  });
  await test("frozen historical tree preserves navigation and never hides a failed full attempt", () => {
    const fixture = receiptFixture("receipt-navigation");
    const file = "apps/playground-web/src/components/BattleScreen.tsx";
    mkdirSync(dirname(join(fixture.path, file)), { recursive: true });
    writeFileSync(join(fixture.path, file), "onExit?.();\nconst turn = 1;\n");
    fixture.git(["add", file]);
    fixture.git(["commit", "-m", "navigation baseline"]);
    fixture.report.diffBases = [fixture.git(["rev-parse", "HEAD"])];
    fixture.report.sourceTree = buildVerificationTree(
      fixture.path,
      "HEAD"
    ).headTree;
    fixture.report.fingerprint = state.sourceFingerprint(fixture.path, {
      extraFiles: auditInputFiles(fixture.path),
    });
    atomicJson(fixture.run, fixture.report);
    const receipt = fixture.record();
    fixture.git(["add", "scripts/ismcts-program.mjs"]);
    fixture.git(["commit", "-m", "commit verified fixture bytes"]);
    const diffBases = [fixture.git(["rev-parse", "HEAD"])];
    const navigation = "(onHome ?? onExit)?.();\nconst turn = 1;\n";
    writeFileSync(join(fixture.path, file), navigation);
    const selected = selectGates("finish", [file], (changed) =>
      state.changedLines(fixture.path, changed, fixture.report.diffBases[0])
    );
    assert.deepEqual(selected, ["changed-style", "battle-navigation"]);
    const startedAt = fixture.report.finishedAt + 1,
      finishedAt = startedAt + 1;
    const later = join(fixture.path, `logs/harness/runs/${startedAt}-2.json`);
    atomicJson(later, {
      ...fixture.report,
      changed: [file],
      diffBases,
      fingerprint: state.sourceFingerprint(fixture.path, {
        extraFiles: auditInputFiles(fixture.path),
      }),
      startedAt,
      finishedAt,
      sourceTree: buildVerificationTree(fixture.path, "HEAD").headTree,
      gates: selected.map((id) => ({
        id,
        status: "passed",
        reused: false,
        exitCode: 0,
        startedAt,
        finishedAt,
      })),
    });
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    // An unrelated current edit must not change the successful historical scope.
    writeFileSync(
      join(fixture.path, file),
      navigation.replace("turn = 1", "turn = 2")
    );
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    const failed = join(
      fixture.path,
      `logs/harness/runs/${startedAt + 2}-3.json`
    );
    atomicJson(failed, {
      ...fixture.report,
      changed: [file],
      diffBases,
      startedAt: startedAt + 2,
      finishedAt: finishedAt + 2,
      sourceTree: buildVerificationTree(fixture.path, "HEAD").headTree,
      status: "failed",
      gates: [{ id: "format", status: "failed", exitCode: 1 }],
    });
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /later/
    );
    // Reverting the current game change cannot erase the related failed attempt.
    writeFileSync(join(fixture.path, file), navigation);
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /later/
    );
  });
  await test("a new delivery/ticket preserves a receipt, but a real thread setting invalidates it", () => {
    const fixture = receiptFixture("receipt-runtime"),
      receipt = fixture.record();
    const keys = [
      "ORICA_INTEGRATION_REQUEST",
      "ORICA_WORKER_DELIVERY_FILE",
      "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
      "OMP_NUM_THREADS",
    ];
    const saved = keys.map((key) => [key, process.env[key]]);
    try {
      for (const key of keys.slice(0, 3))
        process.env[key] = `new-session-${key}`;
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, receipt).state,
        "unverified"
      );
      process.env.OMP_NUM_THREADS = `changed-${process.env.OMP_NUM_THREADS ?? "unset"}`;
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /runtime/
      );
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  await test("wrapper and worker launcher metadata share evidence without hiding computational changes", async () => {
    const keys = [
      "ORICA_INTEGRATION_REQUEST",
      "ORICA_WORKER_DELIVERY_FILE",
      "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
      "ORICA_CODEX_CLI",
      "ORICA_CODEX_FULL_RUN",
      "ORICA_CODEX_MODEL",
      "ORICA_CODEX_REASONING_EFFORT",
      "ORICA_CODEX_VERBOSITY",
      "ORICA_FULL_RUN_WORKER_REF",
      "ORICA_LANE_KIND",
      "ORICA_CLUSTER_REGISTRY",
      "ORICA_EFFECT_DEBUG_HUB_ROOT",
      "ORICA_SUPERVISOR_HUB_REPO",
    ];
    const saved = keys.map((key) => [key, process.env[key]]);
    try {
      // Model the actual ordering: Node receipt made inside a worker; next
      // wrapper plans before any of the worker-only variables are installed.
      for (const key of keys) process.env[key] = `worker-only-${key}`;
      const fixture = receiptFixture("receipt-wrapper-worker"),
        receipt = fixture.record();
      const receiptFile = join(
        fixture.directory,
        "receipts",
        `${receipt.recordedAt}-${receipt.id}.json`
      );
      const before = hash(readFileSync(receiptFile));
      for (const key of keys) delete process.env[key];
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, receipt).state,
        "unverified"
      );
      assert.equal(
        makePlan(evidenceStatus(fixture.path, fixture.directory), {})
          .evidenceState,
        "unverified"
      );
      const runChild = async (key, value) => {
        const code = `import fs from "node:fs";
          import {verifyReceipt} from ${JSON.stringify(pathToFileURL(join(root, "scripts/ismcts/evidence.mjs")).href)};
          const [worktree, shared, file, key, value] = process.argv.slice(1);
          if (key) process.env[key] = value;
          console.log(JSON.stringify(verifyReceipt(worktree, shared, JSON.parse(fs.readFileSync(file)))));`;
        const result = await child(code, [
          fixture.path,
          fixture.directory,
          receiptFile,
          key,
          value,
        ]);
        assert.equal(result.exitCode, 0, result.stderr);
        return JSON.parse(result.stdout);
      };
      assert.equal((await runChild("", "")).state, "unverified");
      // Exact-key and case-insensitive allowlisting, not an ORICA_/CODEX_
      // blanket exemption. Also cover unset -> set in a separate process.
      for (const key of keys) {
        assert.equal(
          (await runChild(key.toLowerCase(), "changed-launcher")).state,
          "unverified",
          key
        );
      }
      for (const key of [
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NODE_OPTIONS",
        "ORICA_COMPUTE_THREADS",
        "ORICA_CODEX_COMPUTE_THREADS",
        "ORICA_CODEX_MODEL_EXTRA",
      ]) {
        assert.match(
          (await runChild(key, `changed-${process.env[key] ?? "unset"}`))
            .reason,
          /runtime/,
          key
        );
      }
      assert.equal(
        hash(readFileSync(receiptFile)),
        before,
        "read-only verification preserves receipt bytes"
      );
      assert.equal(readdirSync(join(fixture.directory, "receipts")).length, 1);
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  await test("missing, tampered, future, other-root and malformed receipt evidence never turn green", () => {
    const fixture = receiptFixture("receipt-corrupt"),
      receipt = fixture.record();
    for (const changed of [
      { ...receipt, id: "../../outside" },
      { ...receipt, recordedAt: fixture.report.finishedAt - 1 },
      { ...receipt, recordedAt: Date.now() + 60000 },
      { ...receipt, root: root },
      { ...receipt, scopeFingerprint: "0".repeat(64) },
      { ...receipt, taskId: "I7" },
      { ...receipt, inputs: [] },
    ])
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, changed).state,
        "invalid"
      );
    const malformed = join(fixture.directory, "receipts/hidden-old.json");
    for (const changed of [
      { ...receipt, id: "../../outside", recordedAt: 0 },
      { ...receipt, recordedAt: null },
      { ...receipt, recordedAt: fixture.report.finishedAt - 1 },
    ]) {
      atomicJson(malformed, changed);
      assert.equal(
        evidenceStatus(fixture.path, fixture.directory).orphanInvalid,
        true
      );
    }
    rmSync(malformed);
    writeFileSync(fixture.output, "tampered\n");
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "invalid"
    );
    rmSync(fixture.output);
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "invalid"
    );
    writeFileSync(join(fixture.directory, "receipts/corrupt.json"), "{broken");
    const status = evidenceStatus(fixture.path, fixture.directory);
    assert.equal(status.orphanInvalid, true);
    assert.equal(makePlan(status, {}).evidenceState, "invalid");
  });
  await test("partial, nonzero-exit, reused, zero-tests and command-mismatched harness reports are rejected", () => {
    const fixture = receiptFixture("receipt-rejections");
    for (const overrides of [
      { status: "running" },
      { status: "failed" },
      { profile: "unit" },
      { root },
      { gates: [] },
      { gates: [fixture.report.gates[0]] },
      { changed: ["packages/rules-core/src/state.ts"] },
      { diffBases: [] },
      { sourceTree: undefined },
      { sourceTree: "0".repeat(40) },
      { sourceTree: fixture.git(["rev-parse", "HEAD"]) },
      { finishedAt: Date.now() + 60000 },
    ]) {
      atomicJson(fixture.run, { ...fixture.report, ...overrides });
      assert.throws(fixture.record);
    }
    for (const overrides of [
      { exitCode: 1 },
      { reused: true },
      { argv: ["fake.mjs"] },
      { finishedAt: Date.now() + 60000 },
    ]) {
      atomicJson(fixture.run, {
        ...fixture.report,
        gates: [
          { ...fixture.report.gates[0], ...overrides },
          ...fixture.report.gates.slice(1),
        ],
      });
      assert.throws(fixture.record);
    }
    atomicJson(fixture.run, fixture.report);
    for (const counts of [
      { attempted: 0, completed: 0, failed: 0, deferred: 0 },
      { attempted: 4, completed: 3, failed: 0, deferred: 1 },
      { attempted: 4, completed: 3, failed: 1, deferred: 0 },
    ]) {
      writeFileSync(
        fixture.output,
        `ISMCTS_TEST_RESULT ${JSON.stringify(counts)}\n`
      );
      assert.throws(fixture.record, /acceptance/);
    }
  });
  await test("history validates clock type and canonical filename before excluding old runs", () => {
    const fixture = receiptFixture("receipt-history-clock"),
      receipt = fixture.record(),
      startedAt = fixture.report.finishedAt + 1;
    const runPath = (time, suffix) =>
      join(
        fixture.path,
        "logs/harness/runs",
        String(time) + "-" + suffix + ".json"
      );
    const oldTime = fixture.report.startedAt - 1,
      old = runPath(oldTime, "2");
    atomicJson(old, {
      ...fixture.report,
      startedAt: oldTime,
      status: "failed",
      gates: [],
    });
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified",
      "an identifiable older failure cannot invalidate a newer complete run"
    );
    rmSync(old);
    // Unit/scenario admission failures do not run the ISMCTS acceptance gate. Keep
    // their history intact without poisoning an unrelated receipt, including
    // older history that is validated before the time cutoff is applied.
    for (const [profile, time] of ["unit", "scenario"].flatMap((profile) =>
      [oldTime, fixture.report.startedAt, startedAt].map((time) => [
        profile,
        time,
      ])
    )) {
      const file = runPath(time, `${profile}-blocked`);
      const blocked = {
        schemaVersion: 2,
        root: fixture.path,
        profile,
        startedAt: time,
        requestedAt: time,
        finishedAt: time + 1,
        status: "failed",
        failureCode: "VALIDATION_BUSY",
        gates: [],
        vitestArgs:
          profile === "unit"
            ? ["packages/rules-core/test/example.test.ts"]
            : [],
      };
      atomicJson(file, blocked);
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, receipt).state,
        "unverified"
      );
      assert.equal(fixture.record().finalization, null);
      for (const overrides of [
        { profile: "full" },
        { startedAt: time - 1 },
        { requestedAt: time - 1 },
        { requestedAt: undefined },
      ]) {
        atomicJson(file, { ...blocked, ...overrides });
        assert.match(
          verifyReceipt(fixture.path, fixture.directory, receipt).reason,
          /filename\/start timestamp/
        );
      }
      rmSync(file);
    }
    for (const suffix of ["2", "full-blocked"]) {
      const file = runPath(startedAt, suffix);
      const failed = {
        ...fixture.report,
        profile: "full",
        startedAt,
        requestedAt: startedAt,
        finishedAt: startedAt + 1,
        status: "failed",
        gates: [{ id: "ismcts-program", status: "failed", exitCode: 1 }],
      };
      for (const value of [
        null,
        false,
        "",
        "0",
        0,
        1,
        fixture.report.startedAt - 1,
        fixture.report.startedAt,
        startedAt - 0.5,
        Date.now() + 60000,
      ]) {
        atomicJson(file, { ...failed, startedAt: value });
        const checked = verifyReceipt(fixture.path, fixture.directory, receipt);
        assert.equal(checked.state, "invalid");
        assert.match(checked.reason, /timestamp/);
      }
      atomicJson(file, failed);
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /later/
      );
      if (suffix === "full-blocked") {
        for (const overrides of [
          { profile: "finish" },
          { requestedAt: startedAt - 1 },
          { requestedAt: null },
          { requestedAt: undefined },
        ]) {
          atomicJson(file, { ...failed, ...overrides });
          assert.match(
            verifyReceipt(fixture.path, fixture.directory, receipt).reason,
            /filename\/start timestamp/
          );
        }
      }
      rmSync(file);
    }
    for (const suffix of ["0", "01", "2-extra", "unknown-blocked"]) {
      const file = runPath(oldTime, suffix);
      atomicJson(file, { ...fixture.report, startedAt: oldTime });
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /filename\/start timestamp/
      );
      rmSync(file);
    }
    const misplaced = runPath(fixture.report.startedAt + 1, "2");
    atomicJson(misplaced, fixture.report);
    assert.throws(
      () =>
        recordReceipt(fixture.path, fixture.directory, "I0", "E1", misplaced),
      /filename\/start timestamp/
    );
    rmSync(misplaced);
    const nested = join(
      fixture.path,
      "logs/harness/runs/copy",
      String(fixture.report.startedAt) + "-1.json"
    );
    atomicJson(nested, fixture.report);
    assert.throws(
      () => recordReceipt(fixture.path, fixture.directory, "I0", "E1", nested),
      /canonical history directory/
    );
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
  });
  await test("changed paths cannot hide a later failed run with a frozen ISMCTS diff", () => {
    const fixture = receiptFixture("receipt-history-scope"),
      receipt = fixture.record(),
      startedAt = fixture.report.finishedAt + 1;
    const later = join(fixture.path, `logs/harness/runs/${startedAt}-2.json`);
    const failed = {
      ...fixture.report,
      startedAt,
      finishedAt: startedAt + 1,
      sourceTree: buildVerificationTree(fixture.path, "HEAD").headTree,
      status: "failed",
      gates: [{ id: "format", status: "failed", exitCode: 1 }],
    };
    for (const changed of [[], ["README.md"]]) {
      atomicJson(later, { ...failed, changed });
      const checked = verifyReceipt(fixture.path, fixture.directory, receipt);
      assert.equal(checked.state, "invalid");
      assert.match(checked.reason, /frozen harness scope/);
    }
    atomicJson(later, failed);
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /later/
    );
  });
  await test("a later request before acceptance starts cannot hide behind a gate clock", () => {
    const fixture = receiptFixture("receipt-before-acceptance");
    fixture.report.gates[0].startedAt = fixture.report.finishedAt - 1;
    atomicJson(fixture.run, fixture.report);
    const receipt = fixture.record();
    for (const startedAt of [
      fixture.report.startedAt,
      fixture.report.startedAt + 1,
    ]) {
      assert.ok(startedAt < receipt.gate.startedAt);
      for (const suffix of ["2", "full-blocked"]) {
        const file = join(
          fixture.path,
          "logs/harness/runs",
          String(startedAt) + "-" + suffix + ".json"
        );
        atomicJson(file, {
          ...fixture.report,
          profile: "full",
          startedAt,
          requestedAt: startedAt,
          finishedAt: startedAt + 1,
          status: "failed",
          gates: [],
        });
        assert.match(
          verifyReceipt(fixture.path, fixture.directory, receipt).reason,
          /later/
        );
        rmSync(file);
      }
    }
  });
  await test("later same-source failure invalidates an earlier success; partial restart resumes I0", () => {
    const fixture = receiptFixture("receipt-later"),
      receipt = fixture.record();
    const waitStart = fixture.report.finishedAt + 1;
    const blocked = join(
      fixture.path,
      `logs/harness/runs/${waitStart}-finish-blocked.json`
    );
    const wait = {
      schemaVersion: 2,
      root: fixture.path,
      profile: "finish",
      status: "failed",
      requestedAt: waitStart,
      startedAt: waitStart,
      finishedAt: waitStart + 2,
      leaseWaitMs: 2,
      durationMs: 0,
      gates: [],
      vitestArgs: [],
      failureCode: "VALIDATION_BUSY",
      error: "Verification lease wait timed out",
    };
    for (const failureCode of [
      "VALIDATION_BUSY",
      "VALIDATION_OWNER_EXITED",
      "VALIDATION_EXPIRED",
    ]) {
      atomicJson(blocked, { ...wait, failureCode });
      const result = verifyReceipt(fixture.path, fixture.directory, receipt);
      assert.equal(result.state, "unverified", JSON.stringify(result));
    }
    const filteredWait = join(
      fixture.path,
      `logs/harness/runs/${waitStart}-test-blocked.json`
    );
    atomicJson(filteredWait, {
      ...wait,
      profile: "test",
      vitestArgs: ["a.test.ts"],
    });
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    rmSync(filteredWait);
    for (const overrides of [
      { vitestArgs: [null] },
      { durationMs: 1 },
      { leaseWaitMs: 1 },
      { failureCode: "UNKNOWN" },
      { sourceTree: fixture.report.sourceTree },
      { fingerprint: fixture.report.fingerprint },
      { gates: [{ id: "ismcts-program", status: "failed" }] },
      { requestedAt: waitStart - 1 },
      { schemaVersion: 1 },
    ]) {
      atomicJson(blocked, { ...wait, ...overrides });
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, receipt).state,
        "invalid"
      );
    }
    rmSync(blocked);

    const later = join(
      fixture.path,
      `logs/harness/runs/${fixture.report.finishedAt + 1}-2.json`
    );
    for (const fingerprint of [
      fixture.report.fingerprint,
      hash("next delivery environment"),
    ]) {
      atomicJson(later, {
        ...fixture.report,
        fingerprint,
        startedAt: fixture.report.finishedAt + 1,
        finishedAt: fixture.report.finishedAt + 2,
        status: "failed",
        gates: [{ id: "ismcts-program", status: "failed" }],
      });
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /later/
      );
    }
    atomicJson(later, {
      ...fixture.report,
      fingerprint: hash("next delivery environment"),
      profile: "full",
      startedAt: fixture.report.finishedAt + 1,
      status: "running",
      gates: [],
      currentGate: "format",
    });
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /later/
    );
    // A running full run must remain invalid after failing before acceptance.
    for (const overrides of [
      {
        status: "failed",
        gates: [{ id: "format", status: "failed", exitCode: 1 }],
      },
      { status: "passed", gates: [] },
      {
        status: "passed",
        gates: [{ id: "format", status: "passed", exitCode: 0 }],
      },
      {
        status: "passed",
        gates: [{ ...fixture.report.gates[0], exitCode: 1 }],
      },
    ]) {
      atomicJson(later, {
        ...fixture.report,
        fingerprint: hash("next delivery environment"),
        profile: "full",
        startedAt: fixture.report.finishedAt + 1,
        finishedAt: fixture.report.finishedAt + 2,
        ...overrides,
      });
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /later/
      );
    }
    assert.equal(
      makePlan(evidenceStatus(fixture.path, fixture.directory), {}).nextTask,
      "I0"
    );
    const startedAt = fixture.report.finishedAt + 1,
      finishedAt = startedAt + 1;
    const executionFor = (id) => {
      const original = fixture.report.gates.find((gate) => gate.id === id);
      return original && harnessGates[id].reusable !== false
        ? {
            id,
            status: "passed",
            reused: true,
            sourceRun: fixture.report.startedAt,
          }
        : {
            id,
            status: "passed",
            reused: false,
            exitCode: 0,
            startedAt,
            finishedAt,
          };
    };
    const laterRun = {
      ...fixture.report,
      profile: "merge",
      startedAt,
      finishedAt,
      gates: selectGates("merge", fixture.report.changed).map(executionFor),
    };
    atomicJson(later, laterRun);
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    atomicJson(later, {
      ...laterRun,
      profile: "finish",
      // Finish includes changed-style, which merge does not select.
      gates: selectGates("finish", fixture.report.changed).map(executionFor),
    });
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified",
      "an exact resumed finish does not invalidate existing fresh acceptance"
    );
    atomicJson(later, {
      ...laterRun,
      gates: laterRun.gates.map((gate) =>
        gate.id === "ismcts-program"
          ? { ...gate, sourceRun: fixture.report.startedAt - 1 }
          : gate
      ),
    });
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /later/
    );
    const full = {
      ...fixture.report,
      profile: "full",
      startedAt,
      finishedAt,
      gates: selectGates("full", fixture.report.changed).map((id) => ({
        ...fixture.report.gates.find((gate) => gate.id === id),
        id,
        status: "passed",
        reused: false,
        exitCode: 0,
        startedAt,
        finishedAt,
      })),
    };
    atomicJson(later, full);
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    for (const overrides of [
      { gates: full.gates.slice(1) },
      {
        gates: full.gates.map((gate) =>
          gate.id === "ismcts-program" ? { ...gate, exitCode: 1 } : gate
        ),
      },
      {
        gates: full.gates.map((gate) =>
          gate.id === "ismcts-program" ? { ...gate, reused: true } : gate
        ),
      },
      {
        gates: full.gates.map((gate) =>
          gate.id === "ismcts-program"
            ? { ...gate, finishedAt: finishedAt + 1 }
            : gate
        ),
      },
    ]) {
      atomicJson(later, { ...full, ...overrides });
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /later/
      );
    }
  });
  await test("a worker cannot mark a pending receipt completed or bypass a missing parent integration", () => {
    const fixture = receiptFixture("receipt-finalization"),
      receipt = fixture.record();
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, {
        ...receipt,
        finalization: {
          commit: fixture.git(["rev-parse", "HEAD"]),
          integrationId: "bad",
        },
      }).state,
      "invalid"
    );
    const file = readdirSync(join(fixture.directory, "receipts"))[0];
    assert.throws(() =>
      finalizeReceipt(
        fixture.path,
        fixture.directory,
        join(fixture.directory, "receipts", file),
        fixture.git(["rev-parse", "HEAD"]),
        "00000000-0000-0000-0000-000000000000"
      )
    );
    assert.equal(
      readJson(join(fixture.directory, "receipts", file)).finalization,
      null
    );
  });
  await test("raw source, Git attributes, binary inputs and logs remain independently bound", () => {
    const fixture = receiptFixture("receipt-git-blobs"),
      receipt = fixture.record();
    const script = "scripts/ismcts/windows-job.ps1";
    const input = receipt.inputs.find((x) => x.path === script);
    const canonical = execFileSync(
      "git",
      ["show", `${receipt.validatedTree}:${script}`],
      { cwd: fixture.path }
    );
    assert.equal(input.sha256, hash(readFileSync(join(fixture.path, script))));
    assert.notEqual(input.sha256, hash(canonical));
    assert.equal(
      input.gitBlob,
      fixture.git(["rev-parse", `${receipt.validatedTree}:${script}`])
    );
    const lock = receipt.inputs.find((x) => x.path === "pnpm-lock.yaml");
    assert.equal(
      lock.gitBlob,
      fixture.git(["hash-object", "--no-filters", "pnpm-lock.yaml"])
    );
    const receiptFile = join(
      fixture.directory,
      "receipts",
      readdirSync(join(fixture.directory, "receipts"))[0]
    );
    const originalReceipt = readFileSync(receiptFile);
    for (const [file, transform] of [
      [
        script,
        (bytes) => Buffer.from(bytes.toString().replaceAll("\r\n", "\n")),
      ],
      [
        script,
        (bytes) => Buffer.concat([bytes, Buffer.from("# content changed\r\n")]),
      ],
      [
        ".gitattributes",
        (bytes) => Buffer.concat([bytes, Buffer.from("\n# policy changed\n")]),
      ],
      [
        "pnpm-lock.yaml",
        (bytes) => Buffer.concat([bytes, Buffer.from("\r\n")]),
      ],
    ]) {
      const path = join(fixture.path, file),
        before = readFileSync(path);
      writeFileSync(path, transform(before));
      if (file === script && !readFileSync(path).includes(Buffer.from("\r\n")))
        assert.equal(
          scopeFingerprint(fixture.path, "I0").inputs.find(
            (x) => x.path === script
          ).gitBlob,
          input.gitBlob
        );
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, receipt).reason,
        /stale receipt scope/
      );
      writeFileSync(path, before);
      assert.equal(
        verifyReceipt(fixture.path, fixture.directory, receipt).state,
        "unverified"
      );
    }
    const nested = join(fixture.path, "manual/ai-reference/.gitattributes");
    writeFileSync(nested, "*.md text eol=lf\n");
    assert.ok(
      scopeFingerprint(fixture.path, "I0").inputs.some(
        (x) => x.path === "manual/ai-reference/.gitattributes"
      )
    );
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, receipt).reason,
      /stale receipt scope/
    );
    unlinkSync(nested);
    const log = readFileSync(fixture.output);
    writeFileSync(fixture.output, log.toString().replaceAll("\n", "\r\n"));
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "invalid"
    );
    writeFileSync(fixture.output, log);
    for (const value of [undefined, "invalid", "0".repeat(40)]) {
      const altered = JSON.parse(JSON.stringify(receipt));
      altered.inputs.find((x) => x.path === script).gitBlob = value;
      assert.match(
        verifyReceipt(fixture.path, fixture.directory, altered).reason,
        /input manifest mismatch/
      );
    }
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, receipt).state,
      "unverified"
    );
    assert.deepEqual(readFileSync(receiptFile), originalReceipt);
  });
  const testIntegratedReceipt = (includeVouch) => {
    // Synthetic integration/verification inputs stay in a disposable Git repo.
    // This proves receipt validation mechanics, never an actual deployment.
    const fixture = receiptFixture(`receipt-integrated-${includeVouch}`),
      receipt = fixture.record();
    const vouch = {
      cardNo: "I0",
      lens: "5",
      refuted: false,
      claim: "fixture",
      evidence: "fixture:1",
      expected: "fixture",
    };
    const report = {
      summary: "Synthetic fixture, no production claim",
      coverage: {
        files: ["scripts/ismcts-program.mjs"],
        fullDiffRead: true,
        unverified: [],
        lenses: ["1", "2", "3", "4", "5", "6"].map((lens) => ({
          lens,
          status: "not_applicable",
          reason: "Synthetic validator fixture only",
        })),
      },
      items: includeVouch ? [vouch] : [],
    };
    const reportText = `${JSON.stringify(report, null, 2)}\n`,
      reportSha256 = hash(reportText),
      reportBase64 = Buffer.from(reportText).toString("base64");
    const body = join(fixture.directory, "commit-message.txt");
    writeFileSync(
      body,
      `test: fixture audit\n\nVerifier-Evidence-Schema: 3\nVerifier-Head-Tree: ${receipt.validatedTree}\nVerifier-Report-SHA256: ${reportSha256}\nVerifier-Report-Base64: ${reportBase64}\n`
    );
    fixture.git(["add", "scripts/ismcts-program.mjs"]);
    fixture.git(["commit", "--file", body]);
    const commit = fixture.git(["rev-parse", "HEAD"]);
    fixture.git(["update-ref", "refs/remotes/origin/main", commit]);
    const archiveRelativePath = "logs/verifier-history/fixture";
    const result = {
      schemaVersion: 3,
      base: "main",
      headTree: receipt.validatedTree,
      verifiedAt: new Date().toISOString(),
      summary: report.summary,
      report,
      reportSha256,
      reportBase64,
      archiveRelativePath,
      refuted: 0,
    };
    atomicJson(join(fixture.path, archiveRelativePath, "context.json"), {
      headTree: receipt.validatedTree,
      generatedAt: new Date().toISOString(),
    });
    atomicJson(join(fixture.path, archiveRelativePath, "report.json"), report);
    atomicJson(
      join(fixture.path, archiveRelativePath, "evidence.json"),
      result
    );
    atomicJson(join(fixture.path, ".verifier-result.json"), result);
    const integrationId = "11111111-1111-1111-1111-111111111111";
    const parentFile = join(
      fixture.directory,
      "../supervisor-integrations",
      `${integrationId}.json`
    );
    atomicJson(parentFile, {
      schemaVersion: 1,
      runId: integrationId,
      status: "requested",
      exitCode: 0,
      head: commit,
      remoteHead: commit,
      workdir: fixture.path,
      finishedAt: new Date().toISOString(),
    });
    const file = join(
      fixture.directory,
      "receipts",
      readdirSync(join(fixture.directory, "receipts"))[0]
    );
    const pendingBytes = readFileSync(file);
    // A real embedded audit, even with self-consistent hashes, must not turn
    // absent coverage or unresolved findings into a valid empty-items review.
    for (const invalidReport of [
      { ...report, coverage: null },
      { ...report, coverage: { ...report.coverage, fullDiffRead: false } },
      { ...report, coverage: { ...report.coverage, lenses: [] } },
      { ...report, coverage: { ...report.coverage, unverified: ["fixture"] } },
      {
        ...report,
        items: [{ ...vouch, refuted: true }],
      },
    ]) {
      const text = `${JSON.stringify(invalidReport, null, 2)}\n`;
      const badResult = {
        ...result,
        report: invalidReport,
        reportSha256: hash(text),
        reportBase64: Buffer.from(text).toString("base64"),
      };
      const badCommit = fixture.git([
        "commit-tree",
        receipt.validatedTree,
        "-p",
        commit,
        "-m",
        `test: invalid audit\n\nVerifier-Evidence-Schema: 3\nVerifier-Head-Tree: ${receipt.validatedTree}\nVerifier-Report-SHA256: ${badResult.reportSha256}\nVerifier-Report-Base64: ${badResult.reportBase64}\n`,
      ]);
      atomicJson(
        join(fixture.path, archiveRelativePath, "report.json"),
        invalidReport
      );
      atomicJson(
        join(fixture.path, archiveRelativePath, "evidence.json"),
        badResult
      );
      atomicJson(join(fixture.path, ".verifier-result.json"), badResult);
      assert.throws(
        () =>
          finalizeReceipt(
            fixture.path,
            fixture.directory,
            file,
            badCommit,
            integrationId
          ),
        /check-commit/
      );
      assert.deepEqual(readFileSync(file), pendingBytes);
      assert.equal(existsSync(join(fixture.directory, "verifier")), false);
    }
    atomicJson(join(fixture.path, archiveRelativePath, "report.json"), report);
    atomicJson(
      join(fixture.path, archiveRelativePath, "evidence.json"),
      result
    );
    atomicJson(join(fixture.path, ".verifier-result.json"), result);
    // Paired object changes must not shadow the immutable embedded report.
    const shadow = { ...report, summary: "Unbound replacement report" };
    atomicJson(join(fixture.path, archiveRelativePath, "report.json"), shadow);
    atomicJson(join(fixture.path, archiveRelativePath, "evidence.json"), {
      ...result,
      report: shadow,
    });
    atomicJson(join(fixture.path, ".verifier-result.json"), {
      ...result,
      report: shadow,
    });
    assert.throws(
      () =>
        finalizeReceipt(
          fixture.path,
          fixture.directory,
          file,
          commit,
          integrationId
        ),
      /evidence|archive|check-commit/
    );
    assert.equal(
      existsSync(join(fixture.directory, "verifier")),
      false,
      "authenticate the source archive before copying evidence"
    );
    atomicJson(join(fixture.path, archiveRelativePath, "report.json"), report);
    atomicJson(
      join(fixture.path, archiveRelativePath, "evidence.json"),
      result
    );
    atomicJson(join(fixture.path, ".verifier-result.json"), result);
    assert.throws(
      () =>
        finalizeReceipt(
          fixture.path,
          fixture.directory,
          file,
          commit,
          integrationId
        ),
      /not completed/
    );
    atomicJson(parentFile, { ...readJson(parentFile), status: "completed" });
    // A later audit may replace the latest cache. Use the original retained
    // archive without editing that cache or relaxing commit/ticket validation.
    atomicJson(join(fixture.path, ".verifier-result.json"), {
      unrelated: true,
    });
    assert.throws(
      () =>
        finalizeReceipt(
          fixture.path,
          fixture.directory,
          file,
          commit,
          integrationId
        ),
      /archive missing/
    );
    assert.throws(
      () =>
        finalizeReceipt(
          fixture.path,
          fixture.directory,
          file,
          commit,
          integrationId,
          Date.now(),
          fixture.output
        ),
      /outside/
    );
    const finalized = finalizeReceipt(
      fixture.path,
      fixture.directory,
      file,
      commit,
      integrationId,
      Date.now(),
      join(fixture.path, archiveRelativePath, "evidence.json")
    );
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, finalized).state,
      "valid"
    );
    assert.equal(
      makePlan(evidenceStatus(fixture.path, fixture.directory), {}).nextTask,
      "I0",
      "E1 alone cannot finish I0"
    );

    // Rebased publication has its own audited tree; later remote commits are OK
    // only when every acceptance input still matches the original source proof.
    const legacyTicket = readFileSync(parentFile);
    const candidateIndex = join(fixture.directory, "publication-index");
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
      ),
      GIT_INDEX_FILE: candidateIndex,
    };
    const objectGit = (args, input) =>
      execFileSync("git", args, {
        cwd: fixture.path,
        env,
        input,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    const publishedCommit = (
      path,
      content,
      parent = commit,
      audited = true,
      mode = "100644"
    ) => {
      objectGit(["read-tree", parent]);
      const blob = objectGit(["hash-object", "-w", "--stdin"], content);
      objectGit(["update-index", "--add", "--cacheinfo", mode, blob, path]);
      const tree = objectGit(["write-tree"]);
      const message = audited
        ? readFileSync(body, "utf8").replace(receipt.validatedTree, tree)
        : "fixture missing independent audit\n";
      return {
        head: objectGit(["commit-tree", tree, "-p", parent], message),
        tree,
      };
    };
    const publication = publishedCommit(
      "unrelated-cloud.txt",
      "cloud change\n"
    );
    const laterPublication = publishedCommit(
      "later-remote.txt",
      "later\n",
      publication.head
    );
    fixture.git(["update-ref", "refs/heads/main", publication.head]);
    fixture.git([
      "update-ref",
      "refs/remotes/origin/main",
      laterPublication.head,
    ]);
    const publishedTicket = {
      ...JSON.parse(legacyTicket),
      publishedHead: publication.head,
      remoteHead: laterPublication.head,
      validatedTree: publication.tree,
      publicationVerified: true,
    };
    const verifyPublication = (ticket) => {
      atomicJson(parentFile, ticket);
      const bound = JSON.parse(JSON.stringify(finalized));
      bound.finalization.integration = descriptor(
        dirname(parentFile),
        parentFile
      );
      return verifyReceipt(fixture.path, fixture.directory, bound);
    };
    assert.equal(verifyPublication(publishedTicket).state, "valid");
    for (const changes of [
      { publicationVerified: false },
      { validatedTree: receipt.validatedTree },
      { remoteHead: commit },
      { publishedHead: "0".repeat(40) },
    ])
      assert.equal(
        verifyPublication({ ...publishedTicket, ...changes }).state,
        "invalid"
      );
    const unaudited = publishedCommit(
      "unreviewed.txt",
      "unreviewed\n",
      commit,
      false
    );
    assert.equal(
      verifyPublication({
        ...publishedTicket,
        publishedHead: unaudited.head,
        validatedTree: unaudited.tree,
        remoteHead: unaudited.head,
      }).state,
      "invalid"
    );
    for (const path of [
      "scripts/ismcts/new-module.mjs",
      "scripts/harness/new-gate.mjs",
      "manual/new-scope/.gitattributes",
    ]) {
      const addedInput = publishedCommit(path, "// new scoped input\n");
      assert.match(
        verifyPublication({
          ...publishedTicket,
          publishedHead: addedInput.head,
          validatedTree: addedInput.tree,
          remoteHead: addedInput.head,
        }).reason,
        /receipt scope differs from published integration/
      );
    }
    const changedInput = publishedCommit(
      "scripts/ismcts-program.mjs",
      "// stale acceptance input\n"
    );
    assert.match(
      verifyPublication({
        ...publishedTicket,
        publishedHead: changedInput.head,
        validatedTree: changedInput.tree,
        remoteHead: changedInput.head,
      }).reason,
      /receipt source differs from published integration/
    );
    const modeInput = "scripts/ismcts-program.mjs";
    const sourceBlob = objectGit(["rev-parse", `${commit}:${modeInput}`]);
    const sourceContent = execFileSync(
      "git",
      ["cat-file", "blob", sourceBlob],
      {
        cwd: fixture.path,
        env,
        stdio: "pipe",
      }
    );
    for (const mode of ["100755", "120000"]) {
      const changedMode = publishedCommit(
        modeInput,
        sourceContent,
        commit,
        true,
        mode
      );
      assert.equal(
        objectGit(["rev-parse", `${changedMode.head}:${modeInput}`]),
        sourceBlob,
        "mode-only publication must keep identical input bytes"
      );
      assert.match(
        verifyPublication({
          ...publishedTicket,
          publishedHead: changedMode.head,
          validatedTree: changedMode.tree,
          remoteHead: changedMode.head,
        }).reason,
        /receipt source differs from published integration/
      );
    }
    // A valid audited commit still cannot claim publication from another source.
    const foreignTree = publication.tree;
    const foreignMessage = readFileSync(body, "utf8").replace(
      receipt.validatedTree,
      foreignTree
    );
    const foreign = objectGit(["commit-tree", foreignTree], foreignMessage);
    assert.equal(
      verifyPublication({
        ...publishedTicket,
        publishedHead: foreign,
        remoteHead: foreign,
      }).state,
      "invalid"
    );
    writeFileSync(parentFile, legacyTicket);
    const copiedReport = join(
      fixture.directory,
      finalized.finalization.verifier.report.path
    );
    const copiedResult = join(
      fixture.directory,
      finalized.finalization.verifier.result.path
    );
    const originalResult = readJson(copiedResult);
    atomicJson(copiedReport, shadow);
    atomicJson(copiedResult, { ...originalResult, report: shadow });
    const paired = JSON.parse(JSON.stringify(finalized));
    paired.finalization.verifier.report = descriptor(
      fixture.directory,
      copiedReport
    );
    paired.finalization.verifier.result = descriptor(
      fixture.directory,
      copiedResult
    );
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, paired).reason,
      /embedded report/
    );
    // Historical commit-only validation can read reports without coverage.
    // Current ISMCTS receipts still require it, even with matching copy hashes.
    const missingCoverage = { ...report, coverage: undefined };
    atomicJson(copiedReport, missingCoverage);
    atomicJson(copiedResult, { ...originalResult, report: missingCoverage });
    paired.finalization.verifier.report = descriptor(
      fixture.directory,
      copiedReport
    );
    paired.finalization.verifier.result = descriptor(
      fixture.directory,
      copiedResult
    );
    assert.match(
      verifyReceipt(fixture.path, fixture.directory, paired).reason,
      /invalid\/refuted verifier evidence/
    );
    atomicJson(copiedReport, report);
    atomicJson(copiedResult, originalResult);
    writeFileSync(copiedReport, "tampered");
    assert.equal(
      verifyReceipt(fixture.path, fixture.directory, finalized).state,
      "invalid"
    );
  };
  await test("zero-finding CRLF receipt finalizes only against the real commit-audit validator and matching completed parent ticket", () =>
    testIntegratedReceipt(false));
  await test("vouched CRLF receipt retains commit-audit and publication validation", () =>
    testIntegratedReceipt(true));
  await test("missing inputs, foreign paths and malformed CLI commands fail closed", () => {
    const fixture = receiptFixture("receipt-inputs");
    assert.throws(() => descriptor(fixture.path, root), /outside/);
    assert.throws(
      () => contained(fixture.path, "../receipt-inputs-shared"),
      /outside/
    );
    rmSync(join(fixture.path, "pnpm-lock.yaml"));
    assert.throws(() => scopeFingerprint(fixture.path, "I0"));
    for (const args of [
      [],
      ["unknown"],
      ["plan", "--run", "fake"],
      ["plan", "--evidence", "fake"],
      [
        "record",
        "--task",
        "I0",
        "--acceptance",
        "E1",
        "--run",
        "fake",
        "--evidence",
        "fake",
      ],
      ["plan", "--worktree"],
      ["plan", "--x", "y"],
    ])
      assert.throws(() => programCli(args));
  });
  await test("harness registers I0 regression and promotes mixed engine changes to full", () => {
    // A new controller import of telemetry must update the receipt boundary.
    const visited = new Set();
    function visit(file) {
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /^import\s+(?:[^;]*?\sfrom\s+)?["'](\.[^"']+)["'][^;]*;/gm
      )) {
        const target = resolve(dirname(file), match[1]);
        if (/\.(?:mjs|cjs)$/.test(target)) visit(target);
      }
    }
    visit(join(root, "scripts/ismcts-program.mjs"));
    assert.equal(
      visited.has(join(root, "scripts/ismcts/runtime-telemetry.mjs")),
      false
    );
    assert.ok(
      selectGates("finish", ["scripts/ismcts/evidence.mjs"]).includes(
        "ismcts-program"
      )
    );
    assert.deepEqual(
      selectGates("finish", [
        "scripts/ismcts/budget.mjs",
        "packages/rules-core/src/types.ts",
      ]),
      fullGates
    );
  });

  await test("copied fixture sources, Git metadata and evidence remain isolated", () => {
    const left = { path: createReceiptRepository("copy-isolation-left") };
    const right = { path: createReceiptRepository("copy-isolation-right") };
    left.git = fixtureGit(left.path);
    right.git = fixtureGit(right.path);
    const template = getReceiptTemplate();
    const templateGit = fixtureGit(template);
    const head = right.git(["rev-parse", "HEAD"]);
    assert.equal(templateGit(["rev-parse", "HEAD"]), head);
    for (const fixture of [left, right]) {
      assert.equal(lstatSync(join(fixture.path, ".git")).isDirectory(), true);
      assert.equal(
        fixture
          .git(["rev-parse", "--path-format=absolute", "--git-common-dir"])
          .replaceAll("\\", "/"),
        join(fixture.path, ".git").replaceAll("\\", "/")
      );
      assert.equal(
        existsSync(join(fixture.path, ".git/objects/info/alternates")),
        false
      );
    }
    const unchanged = [template, right.path].flatMap((directory) =>
      [
        "pnpm-lock.yaml",
        ".git/config",
        ".git/index",
        ".git/HEAD",
        ".git/objects/" + head.slice(0, 2) + "/" + head.slice(2),
      ].map((file) => {
        const path = join(directory, file);
        assert.equal(lstatSync(path).nlink, 1, path);
        return [path, readFileSync(path)];
      })
    );
    writeFileSync(
      join(left.path, "pnpm-lock.yaml"),
      "private fixture change\n"
    );
    left.git(["config", "fixture.isolation", "left-only"]);
    left.git(["add", "pnpm-lock.yaml"]);
    for (const [path, bytes] of unchanged)
      assert.deepEqual(readFileSync(path), bytes, path);
    left.git(["commit", "-m", "private fixture commit"]);
    assert.notEqual(left.git(["rev-parse", "HEAD"]), head);
    assert.equal(right.git(["rev-parse", "HEAD"]), head);
    assert.equal(templateGit(["rev-parse", "HEAD"]), head);
    for (const [path, bytes] of unchanged)
      assert.deepEqual(readFileSync(path), bytes, path);
    const next = createReceiptRepository("copy-isolation-next");
    assert.equal(fixtureGit(next)(["rev-parse", "HEAD"]), head);
    assert.deepEqual(
      readFileSync(join(next, "pnpm-lock.yaml")),
      readFileSync(join(template, "pnpm-lock.yaml"))
    );
  });
  await test("partial fixture copies are removed without evidence or damage to earlier cases", () => {
    const name = "copy-failure";
    const path = join(sandbox, name);
    const template = getReceiptTemplate();
    const before = readFileSync(join(template, ".git/index"));
    assert.throws(
      () =>
        createReceiptRepository(name, (_source, destination) => {
          mkdirSync(join(destination, ".git"));
          writeFileSync(join(destination, ".git/partial"), "incomplete");
          throw new Error("injected copy failure");
        }),
      /injected copy failure/
    );
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(join(sandbox, name + "-shared")), false);
    assert.deepEqual(readFileSync(join(template, ".git/index")), before);
    const retry = createReceiptRepository(name);
    const sentinel = join(retry, "kept.txt");
    writeFileSync(sentinel, "earlier case");
    assert.throws(() => createReceiptRepository(name), { code: "EEXIST" });
    assert.equal(readFileSync(sentinel, "utf8"), "earlier case");
    assert.equal(existsSync(join(retry, "logs")), false);
    assert.equal(existsSync(join(sandbox, name + "-shared")), false);
    assert.equal(
      fixtureGit(retry)(["rev-parse", "HEAD"]),
      fixtureGit(template)(["rev-parse", "HEAD"])
    );
  });
  console.log(`ISMCTS_FIXTURE_TIMING ${JSON.stringify(fixtureTimings)}`);
  console.log(
    `ISMCTS_TEST_RESULT ${JSON.stringify({ attempted: completed, completed, failed: 0, deferred: 0 })}`
  );
} finally {
  // Only this freshly-created fixture tree is disposable.
  assert.ok(relative(tmpdir(), sandbox).startsWith("orica-ismcts-test-"));
  if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true });
}
