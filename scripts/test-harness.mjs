import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout, clearTimeout } from "node:timers";
import {
  selectGates,
  requiresMergeFuzz,
  fullGates,
  testGates,
  gates,
} from "./harness/gate-manifest.mjs";
import state from "./harness/verification-state.cjs";
import { auditInputFiles } from "./audit-inputs.mjs";
import { acquireGateLease, gateLeasePath } from "./harness/gate-lease.mjs";
import { recoverGateLease } from "./harness/recover-gate-lease.mjs";
import {
  runGates,
  hasReusableBrowserProfileEvidence,
} from "./harness/run-gates.mjs";
import { buildVerificationTree } from "./verifier-tree.mjs";
import { classify } from "./check-docs.mjs";
import { testGateQueue } from "./harness/test-gate-queue.mjs";
import { testUnitEntry } from "./test-unit-entry.mjs";
import { testDocLinks } from "./test-doc-links.mjs";
const require = createRequire(import.meta.url);
const {
  editedPaths,
  proposedEdits,
  projectRoot,
  typecheckProjects,
} = require("./harness/hook-input.cjs");
const { checkWriteAdvisor } = require("./harness/pre-tool-guard-core.cjs");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedFullGates = [
  "format",
  "lint",
  "dev-contract",
  "types",
  "docs",
  "ssot",
  "wiring",
  "ledger",
  "auxiliary-model-policy",
  "notice-editor",
  "dot-connection",
  "audit-operations",
  "funnel-watchdog",
  "harness",
  "verifier",
  "supervisor-lock",
  "supervisor-runner-lock",
  "storage",
  "telegram",
  "effect-debug",
  "text-accountability",
  "put-semantics",
  "fidelity",
  "ismcts-program",
  "ismcts-runtime",
  "handoff",
  "auto-merge-integration",
  "vitest",
  "secrets",
];
const temp = mkdtempSync(join(tmpdir(), "orica-harness-test-"));
const git = (args) =>
  execFileSync("git", args, { cwd: temp, encoding: "utf8", stdio: "pipe" });

async function testLeaseRecovery() {
  const file = gateLeasePath(temp);
  const owner = {
    pid: 99999999,
    token: "crashed-validation-fixture",
    root: temp,
    started: Date.now() - 3600_000,
  };
  const idle = [{ pid: 100, parentPid: 1, name: "service", commandLine: "" }];
  const options = { inspectOwner: () => "dead", readProcesses: () => idle };
  const put = (data = owner) => writeFileSync(file, JSON.stringify(data));
  const blocked = (overrides = {}) => {
    const before = readFileSync(file, "utf8");
    const result = recoverGateLease(temp, { ...options, ...overrides });
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(existsSync(`${file}.recovery`), false);
  };
  try {
    const crashed = spawnSync(
      process.execPath,
      [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid, token:'crash', root:process.argv[2], started:Date.now()-120000})); process.exit(1)",
        file,
        temp,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    assert.equal(crashed.status, 1);
    assert.equal(
      recoverGateLease(temp, { readProcesses: () => idle }).status,
      "recovered"
    );
    assert.equal(existsSync(file), false);
    // Reproduce the incident through the actual acquisition entry point.
    const release = await acquireGateLease(temp, { timeoutMs: 20 });
    assert.equal(recoverGateLease(temp).status, "active");
    release();
    assert.equal(recoverGateLease(temp, options).status, "free");
    const oldServer = {
      pid: 208,
      parentPid: 199,
      name: "node.exe",
      processStartedAt: new Date(owner.started - 24 * 3600_000).toISOString(),
      commandLine:
        '"C:/Program Files/nodejs/node.exe" "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js" vite --config apps/playground-web/vite.config.ts --port 4203',
    };
    for (const commandLine of [
      oldServer.commandLine,
      '"C:/Windows/System32/cmd.exe" /d /s /c "vite --config apps/playground-web/vite.config.ts --port 4203"',
      'node "C:/separate task/node_modules/vite/bin/vite.js" --config apps/playground-web/vite.config.ts --port 4203',
      "npx vite serve --config=vite.config.ts --port=4203 --strictPort",
    ]) {
      put();
      assert.equal(
        recoverGateLease(temp, {
          ...options,
          readProcesses: () => [...idle, { ...oldServer, commandLine }],
        }).status,
        "recovered",
        commandLine
      );
      assert.equal(existsSync(file), false);
    }
    put();
    blocked({ inspectOwner: () => "unknown" });
    blocked({
      readProcesses: () => {
        throw new Error("census denied");
      },
    });
    blocked({ readProcesses: () => [] });
    for (const processRow of [
      { ...oldServer, parentPid: owner.pid },
      { ...oldServer, processStartedAt: undefined },
      { ...oldServer, processStartedAt: "not a timestamp" },
      { ...oldServer, processStartedAt: new Date(owner.started).toISOString() },
      {
        ...oldServer,
        processStartedAt: new Date(owner.started + 1000).toISOString(),
      },
      { ...oldServer, commandLine: "node node_modules/vite/bin/vite.js build" },
      {
        ...oldServer,
        commandLine:
          "npx vite build --config apps/playground-web/vite.config.ts",
      },
      { ...oldServer, commandLine: "npx vite --unknown-option value" },
      {
        ...oldServer,
        commandLine: "npx vite && node scripts/test-harness.mjs",
      },
      {
        ...oldServer,
        commandLine:
          "node custom-validator.mjs --config apps/playground-web/vite.config.ts",
      },
      {
        ...oldServer,
        commandLine:
          "node scripts/test-ui.mjs --config apps/playground-web/vite.config.ts",
      },
    ])
      blocked({ readProcesses: () => [...idle, processRow] });
    blocked({
      readProcesses: () => [
        ...idle,
        oldServer,
        {
          pid: 209,
          parentPid: 1,
          name: "node.exe",
          commandLine: "node node_modules/vitest/vitest.mjs",
        },
      ],
    });
    for (const processRow of [
      { pid: owner.pid, parentPid: 1, name: "node.exe", commandLine: "node" },
      {
        pid: 200,
        parentPid: owner.pid,
        name: "custom-gate",
        commandLine: "gate",
      },
      {
        pid: 201,
        parentPid: 199,
        name: "node.exe",
        commandLine: "node C:/other/node_modules/vitest/vitest.mjs",
      },
      {
        pid: 202,
        parentPid: 199,
        name: "cmd.exe",
        commandLine: "cmd /c pnpm test",
      },
      {
        pid: 204,
        parentPid: 199,
        name: "cmd.exe",
        commandLine: "cmd /c pnpm run build",
      },
      {
        pid: 205,
        parentPid: 199,
        name: "node.exe",
        commandLine: "node C:/other/node_modules/vite/bin/vite.js build",
      },
      { pid: 203, parentPid: 199, name: "node.exe", commandLine: null },
      {
        pid: 206,
        parentPid: 199,
        name: "node.exe",
        commandLine: 'node "C:/other/node_modules/typescript/bin/tsc" --noEmit',
      },
      {
        pid: 207,
        parentPid: 199,
        name: "node.exe",
        commandLine: "node scripts/test-harness.mjs",
      },
    ]) {
      blocked({ readProcesses: () => [...idle, processRow] });
    }
    put({ ...owner, started: Date.now() });
    blocked();
    put({ ...owner, root: join(temp, "missing-repository") });
    blocked();
    writeFileSync(file, "partial JSON");
    blocked();
    put();
    let ownerChecks = 0;
    blocked({ inspectOwner: () => (++ownerChecks === 1 ? "dead" : "alive") });
    const replacement = { ...owner, token: "replacement-owner" };
    const changed = recoverGateLease(temp, {
      ...options,
      readProcesses: () => {
        put(replacement);
        return idle;
      },
    });
    assert.equal(changed.status, "blocked");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), replacement);
    writeFileSync(`${file}.recovery`, "held by another recoverer");
    assert.equal(recoverGateLease(temp, options).status, "blocked");
    assert.equal(
      readFileSync(`${file}.recovery`, "utf8"),
      "held by another recoverer"
    );
  } finally {
    rmSync(file, { force: true });
    rmSync(`${file}.recovery`, { force: true });
  }
}

async function testGateReuse() {
  const unitFile = "packages/example/test/unit.test.ts";
  mkdirSync(join(temp, "packages/example/test"), { recursive: true });
  writeFileSync(join(temp, unitFile), "// synthetic Vitest fixture\n");
  const originalGates = { ...gates };
  const originalCi = process.env.CI;
  delete process.env.CI;
  const calls = join(temp, "logs/gate-calls.txt");
  const latest = join(temp, "logs/harness/latest.json");
  const history = join(temp, "logs/harness/runs");
  const failure = join(temp, "logs/fail-gate");
  const executions = () =>
    readFileSync(calls, "utf8").trim().split("\n").filter(Boolean);
  const resetCalls = () => writeFileSync(calls, "");
  const clearReceipts = () => {
    rmSync(latest, { force: true });
    for (const name of readdirSync(history)) rmSync(join(history, name));
  };
  const run = (profile, options = {}) =>
    runGates({ root: temp, profile, ...options });
  writeFileSync(
    join(temp, "gate-fixture.mjs"),
    `
    import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import { resolve } from 'node:path';
    const id = process.argv[2];
    if (process.env.GIT_DIR || process.env.GIT_WORK_TREE || process.env.GIT_INDEX_FILE)
      throw new Error('Git hook repository selectors leaked into a gate');
    if (id === 'format') {
      const foreign = resolve('logs/foreign');
      mkdirSync(foreign, { recursive: true });
      const git = args => execFileSync('git', args, { cwd: foreign, stdio: 'pipe' });
      git(['init', '-b', 'main']);
      git(['config', 'user.name', 'Foreign fixture']);
      writeFileSync(resolve(foreign, 'proof.txt'), 'isolated fixture');
      git(['add', 'proof.txt']);
      if (!existsSync(resolve(foreign, '.git/index'))) throw new Error('Foreign index missing');
    }
    appendFileSync('logs/gate-calls.txt', id + '\\n');
    if (id === 'handoff') writeFileSync('logs/captured-running.json', readFileSync('logs/harness/latest.json'));
    console.log('fixture output: ' + id);
    console.error('fixture stderr: ' + id);
    if (id === 'card-tests') writeFileSync('logs/card-tests-base.txt', process.argv[process.argv.indexOf('--base') + 1]);
    if (id === 'changed-style' && existsSync('logs/commit-in-gate')) {
      execFileSync('git', ['add', 'scripts/fidelity-review-resolutions.json']);
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'same source while verifying']);
    }
    if (id === 'review-batch') {
      const base = process.argv[process.argv.indexOf('--base') + 1];
      const previous = execFileSync('git', ['show', base + ':scripts/fidelity-review-resolutions.json'], { encoding: 'utf8' });
      writeFileSync('logs/batch-diff.json', JSON.stringify({ base, changed: previous !== readFileSync('scripts/fidelity-review-resolutions.json', 'utf8') }));
    }
    if (id === 'vitest' && process.env.ORICA_UNIT_TEST_FILES) {
      const files = JSON.parse(process.env.ORICA_UNIT_TEST_FILES);
      const result = process.argv[process.argv.indexOf('--outputFile') + 1];
      writeFileSync(result, JSON.stringify({ success: true, numFailedTests: 0, numPassedTests: files.length, testResults: files.map(file => ({ name: resolve(file), assertionResults: [{ status: 'passed' }] })) }));
    }
    if (existsSync('logs/fail-gate') && readFileSync('logs/fail-gate', 'utf8') === id)
      process.exit(1);
  `
  );
  try {
    for (const [id, gate] of Object.entries(gates)) {
      gates[id] = {
        node: "gate-fixture.mjs",
        args: [id],
        // Test generic caching first; explicit opt-out is exercised below.
        reusable: gate.reusable === false ? undefined : gate.reusable,
        changedFiles: gate.changedFiles,
        diffBase: gate.diffBase,
      };
    }
    const selectors = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];
    const previous = selectors.map((name) => process.env[name]);
    const configBefore = git(["config", "--local", "--list"]);
    process.env.GIT_DIR = join(temp, ".git");
    process.env.GIT_WORK_TREE = temp;
    process.env.GIT_INDEX_FILE = join(temp, ".git/index");
    try {
      await run("full");
    } finally {
      selectors.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      });
    }
    assert.equal(
      git(["config", "--local", "--list"]),
      configBefore,
      "a hook-triggered gate must not reinitialize or reconfigure the invoking repository"
    );
    assert.deepEqual(executions(), fullGates);
    // Reject a cheap operational regression before starting long integration
    // suites, while retaining the complete full/merge/CI gate set.
    resetCalls();
    writeFileSync(failure, "telegram");
    await assert.rejects(run("full"), /telegram failed/);
    assert.ok(executions().includes("telegram"));
    for (const id of ["ismcts-program", "handoff", "vitest"])
      assert.ok(!executions().includes(id), id);
    rmSync(failure);
    resetCalls();
    await run("full");
    const executed = JSON.parse(readFileSync(latest, "utf8"));
    assert.equal(git(["cat-file", "-t", executed.sourceTree]).trim(), "tree");
    assert.equal(
      buildVerificationTree(temp, "HEAD").headTree,
      executed.sourceTree
    );
    const verifiedFingerprint = state.sourceFingerprint(temp);
    git(["add", "gate-fixture.mjs"]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture gates"]);
    assert.equal(state.sourceFingerprint(temp), verifiedFingerprint);

    // An overwritten/latest interrupted run must not erase successful history.
    writeFileSync(latest, '{"status":"running"}');
    resetCalls();
    const releaseHeld = await acquireGateLease(temp);
    let waited = false;
    const fallback = setTimeout(() => {
      waited = true;
      releaseHeld();
    }, 5000);
    try {
      await run("push", { reuse: true });
      assert.equal(
        waited,
        false,
        "fully cached push must not wait for the lease"
      );
    } finally {
      clearTimeout(fallback);
      releaseHeld();
    }
    assert.deepEqual(executions(), []);
    assert.ok(
      state
        .readJson(latest)
        .gates.every((gate) => gate.reused && gate.sourceRun)
    );
    const cachedReport = state.readJson(latest);
    // A resumed worker gets a new delivery file, but identical computation.
    const previousRequest = process.env.ORICA_INTEGRATION_REQUEST;
    try {
      process.env.ORICA_INTEGRATION_REQUEST =
        "resumed-integration-request.json";
      writeFileSync(join(temp, "resume.md"), "resume scope\n");
      await run("finish");
      resetCalls();
      process.env.ORICA_INTEGRATION_REQUEST = "another-delivery.json";
      await run("finish", { reuse: true });
      assert.deepEqual(
        executions(),
        [],
        "resume reuses successful exact scope"
      );
      rmSync(join(temp, "resume.md"));
    } finally {
      if (previousRequest === undefined)
        delete process.env.ORICA_INTEGRATION_REQUEST;
      else process.env.ORICA_INTEGRATION_REQUEST = previousRequest;
    }

    // Use the runner's actual persisted in-flight record, not a partial object
    // that lacks the input identity and could never invalidate a prior pass.
    const interrupt = async (overrides = {}) => {
      await new Promise((done) => setTimeout(done, 5));
      const inFlight = {
        ...state.readJson(join(temp, "logs/captured-running.json")),
        startedAt: Date.now(),
        ...overrides,
      };
      assert.equal(inFlight.status, "running");
      assert.equal(inFlight.finishedAt, undefined);
      state.atomicJson(
        join(history, `${inFlight.startedAt}-${process.pid}.json`),
        inFlight
      );
      await new Promise((done) => setTimeout(done, 5));
    };
    writeFileSync(join(temp, "resume.md"), "interrupted resume scope\n");
    await run("full");
    await interrupt();
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      ["handoff"],
      "later interrupted gate invalidates only its matching older success"
    );
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      [],
      "new fresh success repairs interruption"
    );
    await interrupt({ fingerprint: "different-input", gateInputs: {} });
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      [],
      "unrelated input interruption is ignored"
    );
    await interrupt({
      profile: "unit",
      currentGate: undefined,
      selectedGates: ["vitest"],
      gates: [],
      vitestArgs: [unitFile],
    });
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      ["vitest"],
      "interruption before currentGate uses the frozen partial selection"
    );
    await interrupt({
      currentGate: undefined,
      selectedGates: undefined,
      gates: [],
    });
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates,
      "legacy in-flight record without a known gate fails closed"
    );
    const waitAt = Date.now();
    state.atomicJson(join(history, `${waitAt}-finish-blocked.json`), {
      schemaVersion: 2,
      root: temp,
      profile: "finish",
      requestedAt: waitAt,
      startedAt: waitAt,
      finishedAt: waitAt,
      durationMs: 0,
      leaseWaitMs: 0,
      status: "failed",
      gates: [],
      vitestArgs: [],
      failureCode: "VALIDATION_BUSY",
      error: "fixture admission wait",
      queueReceipt: null,
    });
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(executions(), [], "pre-execution wait preserves success");
    rmSync(join(temp, "resume.md"));

    // Only game-independent fixture suites may survive game-content edits.
    // Fresh full/CI, failed attempts, operational files and unknown inputs stay strict.
    gates.handoff.inputScope = "operational-fixtures-v1";
    gates["ismcts-program"].inputScope = "operational-fixtures-v1";
    const gameDirectory = join(temp, "packages/rules-core/src");
    mkdirSync(gameDirectory, { recursive: true });
    const gameFile = join(gameDirectory, "fixture.ts");
    writeFileSync(gameFile, "export const value = 1;\n");
    writeFileSync(join(temp, "fidelity-baseline.json"), "{}\n");
    await run("full");
    await interrupt();
    writeFileSync(gameFile, "export const value = 2;\n");
    writeFileSync(join(temp, "fidelity-baseline.json"), '{"remaining":1}\n');
    resetCalls();
    await run("push", { reuse: true });
    assert.ok(
      executions().includes("handoff"),
      "matching fixture input interruption survives unrelated game edits"
    );
    assert.ok(!executions().includes("ismcts-program"));
    assert.ok(executions().includes("ismcts-runtime"));
    assert.ok(executions().includes("vitest"));
    writeFileSync(gameFile, "export const value = 3;\n");
    writeFileSync(failure, "handoff");
    await assert.rejects(run("full"), /handoff failed/);
    writeFileSync(gameFile, "export const value = 4;\n");
    resetCalls();
    await assert.rejects(run("push", { reuse: true }), /handoff failed/);
    assert.ok(
      executions().includes("handoff"),
      "newer scoped failure blocks old pass"
    );
    rmSync(failure);
    await run("full");
    writeFileSync(join(gameDirectory, "new.ts"), "export {};\n");
    resetCalls();
    await run("push", { reuse: true });
    assert.ok(
      !executions().includes("handoff"),
      "new game regressions cannot affect operational fixtures"
    );
    assert.ok(
      executions().includes("vitest"),
      "new game regressions still execute"
    );
    rmSync(join(gameDirectory, "new.ts"));
    writeFileSync(join(temp, "unknown-input.txt"), "new input\n");
    resetCalls();
    await run("push", { reuse: true });
    assert.ok(executions().includes("handoff"));
    assert.ok(executions().includes("ismcts-program"));
    rmSync(join(temp, "unknown-input.txt"));
    rmSync(gameFile);
    rmSync(join(temp, "fidelity-baseline.json"));
    delete gates.handoff.inputScope;
    delete gates["ismcts-program"].inputScope;

    clearReceipts();
    resetCalls();
    await run("scenario");
    assert.deepEqual(executions(), ["scenario"]);
    assert.equal(state.readJson(latest).completionGate, false);
    resetCalls();
    await run("scenario", { reuse: true });
    assert.deepEqual(executions(), ["scenario"]);
    assert.ok(state.readJson(latest).gates.every((gate) => !gate.reused));
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates,
      "scenario success cannot replace any full gate"
    );

    clearReceipts();
    resetCalls();
    const scenarioFile = "e2e/scenario-four-of-a-kind.spec.ts";
    const scenarioGate = "scenario-file-scenario-four-of-a-kind";
    await run("scenario", { extra: [scenarioFile] });
    assert.deepEqual(
      executions(),
      [scenarioGate],
      "selection survives both snapshot/lease phases"
    );
    assert.deepEqual(state.readJson(latest).playwrightFiles, [scenarioFile]);
    assert.deepEqual(state.readJson(latest).vitestArgs, []);
    await assert.rejects(
      run("scenario", { extra: ["--help"] }),
      /Unregistered/
    );

    mkdirSync(join(temp, "e2e"), { recursive: true });
    writeFileSync(join(temp, scenarioFile), "// scoped GUI fixture\n");
    clearReceipts();
    await run("scenario", { extra: [scenarioFile] });
    const selectedBrowser = state.readJson(latest);
    assert.equal(
      hasReusableBrowserProfileEvidence(selectedBrowser, scenarioGate),
      true
    );
    assert.equal(
      hasReusableBrowserProfileEvidence(
        { ...selectedBrowser, playwrightFiles: ["--help"] },
        scenarioGate
      ),
      false
    );
    assert.equal(
      hasReusableBrowserProfileEvidence(selectedBrowser, "scenario"),
      false
    );
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates,
      "a successful selected GUI is reused without becoming full evidence"
    );
    writeFileSync(failure, "scenario");
    await assert.rejects(run("scenario"), /scenario failed/);
    rmSync(failure);
    resetCalls();
    await run("finish", { reuse: true });
    assert.deepEqual(
      executions(),
      [scenarioGate],
      "aggregate failure invalidates the older matching per-file pass"
    );
    rmSync(join(temp, scenarioFile));

    for (const [profile, file, ids] of [
      ["local-game", "e2e/local-game-sync.spec.ts", ["local-game-ui"]],
      ["public-build", "e2e/public-build.spec.ts", ["build", "public-build"]],
    ]) {
      writeFileSync(join(temp, file), "// focused browser fixture\n");
      clearReceipts();
      await run(profile);
      const standalone = state.readJson(latest);
      for (const id of ids)
        assert.equal(hasReusableBrowserProfileEvidence(standalone, id), true);
      for (const invalid of [
        { ...standalone, status: "failed" },
        { ...standalone, profile: "unit" },
        { ...standalone, vitestArgs: ["one-file.test.ts"] },
        { ...standalone, selectedGates: [] },
        { ...standalone, gates: [] },
        {
          ...standalone,
          gates: standalone.gates.map((gate) => ({ ...gate, reused: true })),
        },
        {
          ...standalone,
          gates: standalone.gates.map((gate) => ({ ...gate, exitCode: 1 })),
        },
      ])
        assert.equal(hasReusableBrowserProfileEvidence(invalid, ids[0]), false);
      resetCalls();
      await run("finish", { reuse: true });
      assert.deepEqual(
        executions(),
        fullGates,
        `${profile} success is reused without skipping unrelated full gates`
      );
      for (const id of ids)
        assert.equal(
          state.readJson(latest).gates.find((gate) => gate.id === id).reused,
          true
        );
      writeFileSync(failure, ids.at(-1));
      await assert.rejects(run(profile), /failed/);
      rmSync(failure);
      resetCalls();
      await run("finish", { reuse: true });
      assert.deepEqual(
        executions(),
        [ids.at(-1)],
        "a later focused failure invalidates its earlier success"
      );
      rmSync(join(temp, file));
    }

    // Filtered Vitest results never substitute for the full suite, while the
    // other gates actually executed by that run remain reusable.
    clearReceipts();
    await run("test", { extra: ["one-file.test.ts"] });
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates.filter((id) => !testGates.includes(id) || id === "vitest")
    );

    clearReceipts();
    resetCalls();
    await run("unit", { extra: [unitFile] });
    assert.deepEqual(executions(), ["vitest"]);
    assert.equal(state.readJson(latest).completionGate, false);
    assert.deepEqual(state.readJson(latest).vitestArgs, [unitFile]);
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates,
      "unit success cannot replace any full gate"
    );
    writeFileSync(failure, "vitest");
    await assert.rejects(run("unit", { extra: [unitFile] }), /vitest failed/);
    resetCalls();
    await assert.rejects(run("push", { reuse: true }), /vitest failed/);
    assert.deepEqual(
      executions(),
      ["vitest"],
      "a later unit failure invalidates old full Vitest success"
    );
    rmSync(failure);
    await run("unit", { extra: [unitFile] });
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      ["vitest"],
      "partial success cannot hide the earlier full failure"
    );

    writeFileSync(failure, "lint");
    await assert.rejects(run("full"), /lint failed/);
    const failedReport = state.readJson(latest);
    assert.equal(failedReport.currentGate, null);
    const failedOutput = readFileSync(
      failedReport.gates.at(-1).outputLog,
      "utf8"
    );
    assert.match(failedOutput, /fixture output: lint/);
    assert.match(failedOutput, /fixture stderr: lint/);
    // A concurrent cached push may finish after a fresh full run fails. Its
    // older sourceRun must not replace that failure with a new success.
    state.atomicJson(latest, {
      ...cachedReport,
      startedAt: failedReport.startedAt - 1,
      finishedAt: failedReport.finishedAt + 1,
    });
    resetCalls();
    await assert.rejects(run("push", { reuse: true }), /lint failed/);
    assert.deepEqual(
      executions(),
      ["lint"],
      "new failure must override even a later receipt reusing old success"
    );
    rmSync(failure);
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(executions(), ["lint"]);

    const originalExecPath = process.execPath;
    try {
      process.execPath = join(temp, "missing-node-executable");
      await assert.rejects(run("full"), /ENOENT/);
    } finally {
      process.execPath = originalExecPath;
    }
    assert.equal(state.readJson(latest).gates[0].id, "format");
    assert.equal(state.readJson(latest).gates[0].status, "failed");
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      ["format"],
      "a failed spawn must invalidate the previous success for that gate"
    );

    writeFileSync(
      join(temp, "gate-fixture.mjs"),
      readFileSync(join(temp, "gate-fixture.mjs"), "utf8") + "\n// changed\n"
    );
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates,
      "source changes invalidate evidence"
    );

    resetCalls();
    await run("full", { reuse: true });
    assert.deepEqual(executions(), fullGates, "full verification stays fresh");
    resetCalls();
    const heldForEdit = await acquireGateLease(temp);
    const queuedSource = join(temp, "gate-fixture.mjs");
    const beforeQueueEdit = readFileSync(queuedSource, "utf8");
    const editWhileQueued = setTimeout(() => {
      writeFileSync(
        queuedSource,
        beforeQueueEdit + "\n// edited while waiting\n"
      );
      heldForEdit();
    }, 100);
    try {
      await assert.rejects(run("full"), /changed while queued/);
      assert.deepEqual(
        executions(),
        [],
        "new inputs cannot borrow an old queue admission"
      );
      assert.equal(state.readJson(latest).status, "failed");
      assert.ok(state.readJson(latest).queueReceipt.id);
    } finally {
      clearTimeout(editWhileQueued);
      heldForEdit();
      writeFileSync(queuedSource, beforeQueueEdit);
    }
    resetCalls();
    await run("merge", { reuse: true });
    assert.deepEqual(executions(), ["card-tests"]);

    const earlierMain = git(["rev-parse", "main"]).trim();
    assert.equal(
      readFileSync(join(temp, "logs/card-tests-base.txt"), "utf8"),
      earlierMain
    );
    git([
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      "main advances without source changes",
    ]);
    resetCalls();
    await run("merge", { reuse: true });
    assert.deepEqual(
      executions(),
      ["card-tests"],
      "main movement invalidates the card coverage scope"
    );
    assert.equal(
      readFileSync(join(temp, "logs/card-tests-base.txt"), "utf8"),
      git(["rev-parse", "main"]).trim()
    );
    assert.equal(originalGates.ledger.reusable, false);
    gates.ledger.reusable = false;
    resetCalls();
    await run("merge", { reuse: true });
    assert.deepEqual(
      executions(),
      ["ledger"],
      "implicit main-dependent ledger always executes fresh"
    );
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      ["ledger"],
      "push also honors the reuse opt-out"
    );
    delete gates.ledger.reusable;

    process.env.CI = "1";
    await run("full");
    resetCalls();
    await run("push", { reuse: true });
    assert.deepEqual(
      executions(),
      fullGates,
      "CI must not reuse matching evidence"
    );

    delete process.env.CI;
    clearReceipts();
    git(["add", "."]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "scope baseline"]);
    const base = git(["rev-parse", "HEAD"]).trim();
    const homeFile = "apps/playground-web/src/components/HomeLobby.tsx";
    mkdirSync(join(temp, "apps/playground-web/src/components"), {
      recursive: true,
    });
    writeFileSync(
      join(temp, homeFile),
      "export const HomeLobby = () => null;\n"
    );
    git(["add", homeFile]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "home change"]);
    const homeCommit = git(["rev-parse", "HEAD"]).trim();
    writeFileSync(join(temp, "README.md"), "# scoped docs\n");
    resetCalls();
    await run("finish");
    assert.deepEqual(executions(), ["changed-style", "docs"]);
    git(["add", "README.md"]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "docs change"]);
    const head = git(["rev-parse", "HEAD"]).trim();
    const refs = `refs/heads/main ${head} refs/heads/main ${base}\n`;
    assert.deepEqual(state.pushChangedPaths(temp, refs), [
      "README.md",
      homeFile,
    ]);
    assert.equal(
      state.pushChangedPaths(temp),
      null,
      "missing upstream requires full checks"
    );
    resetCalls();
    await run("push", { reuse: true, pushInput: refs });
    assert.deepEqual(
      executions(),
      ["changed-style", "home-layout"],
      "docs-only finish must not cover code in earlier outgoing commits or its style check"
    );
    resetCalls();
    await run("push", { reuse: true, pushInput: refs });
    assert.deepEqual(executions(), [], "identical scoped checks are reusable");
    assert.equal(
      state.pushChangedPaths(temp, refs.replace(base, "0".repeat(40))),
      null
    );
    assert.equal(
      state.pushChangedPaths(temp, refs.replace(base, "f".repeat(40))),
      null
    );
    assert.deepEqual(
      state.pushChangedPaths(temp, refs.replace(head, "0".repeat(40))),
      []
    );
    assert.throws(
      () => state.pushChangedPaths(temp, refs.replace(head, homeCommit)),
      /Check out/
    );
    assert.throws(() => state.pushChangedPaths(temp, "invalid"), /Invalid/);
    writeFileSync(join(temp, "README.md"), "# dirty\n");
    assert.throws(() => state.pushChangedPaths(temp, refs), /committed tree/);
    git(["checkout", "--", "README.md"]);
    git(["update-ref", "refs/remotes/origin/main", base]);
    git(["config", "branch.main.remote", "origin"]);
    git(["config", "branch.main.merge", "refs/heads/main"]);
    git([
      "config",
      "remote.origin.fetch",
      "+refs/heads/*:refs/remotes/origin/*",
    ]);
    assert.deepEqual(state.pushChangedPaths(temp), ["README.md", homeFile]);
    rmSync(join(temp, homeFile));
    assert.deepEqual(
      state.changedPaths(temp),
      [homeFile],
      "deletions keep their scope"
    );
    git(["checkout", "--", homeFile]);
    const effectLeaf = "packages/rules-core/src/effect/leaf-combat.ts";
    mkdirSync(join(temp, "packages/rules-core/src/effect"), {
      recursive: true,
    });
    writeFileSync(join(temp, effectLeaf), "export const combatRule = 1;\n");
    git(["add", effectLeaf]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "effect baseline"]);
    const effectBase = git(["rev-parse", "HEAD"]).trim();
    rmSync(join(temp, effectLeaf));
    assert.deepEqual(state.changedPaths(temp, effectBase), [effectLeaf]);
    assert.deepEqual(
      selectGates("finish", state.changedPaths(temp, effectBase), (file) =>
        state.changedLines(temp, file, effectBase)
      ),
      [
        "changed-style",
        "types",
        "vitest",
        "put-semantics",
        "fidelity",
        "ismcts-runtime",
      ],
      "deleting a known leaf retains the same affected-domain checks"
    );
    git(["checkout", "--", effectLeaf]);
    mkdirSync(join(temp, "packages/rules-core/src/plugins"), {
      recursive: true,
    });
    renameSync(
      join(temp, effectLeaf),
      join(temp, "packages/rules-core/src/plugins/leaf-combat.ts")
    );
    const movedEffectPaths = state.changedPaths(temp, effectBase);
    assert.deepEqual(movedEffectPaths, [
      effectLeaf,
      "packages/rules-core/src/plugins/leaf-combat.ts",
    ]);
    assert.deepEqual(
      selectGates("finish", movedEffectPaths, (file) =>
        state.changedLines(temp, file, effectBase)
      ),
      fullGates,
      "moving a leaf into an unregistered module area escalates to full"
    );
    rmSync(join(temp, "packages/rules-core/src/plugins"), { recursive: true });
    git(["checkout", "--", effectLeaf]);
    const battleFile = "apps/playground-web/src/components/BattleScreen.tsx";
    writeFileSync(join(temp, battleFile), "onExit?.();\nconst turn = 1;\n");
    git(["add", battleFile]);
    git([
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "navigation baseline",
    ]);
    const navigationBase = git(["rev-parse", "HEAD"]).trim();
    writeFileSync(join(temp, battleFile), "onExit?.();\nconst turn = 2;\n");
    git(["add", battleFile]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "game change"]);
    const gameBase = git(["rev-parse", "HEAD"]).trim();
    writeFileSync(
      join(temp, battleFile),
      "(onHome ?? onExit)?.();\nconst turn = 2;\n"
    );
    assert.deepEqual(state.changedLines(temp, battleFile), [
      "onExit?.();",
      "(onHome ?? onExit)?.();",
    ]);
    assert.deepEqual(
      selectGates("finish", [battleFile], (file) =>
        state.changedLines(temp, file)
      ),
      ["changed-style", "battle-navigation"]
    );
    const navigationTree = buildVerificationTree(temp, "HEAD").headTree;
    writeFileSync(
      join(temp, battleFile),
      "(onHome ?? onExit)?.();\nconst turn = 3;\n"
    );
    assert.deepEqual(
      selectGates("finish", [battleFile], (file) =>
        state.changedLines(temp, file, gameBase, navigationTree)
      ),
      ["changed-style", "battle-navigation"]
    );
    assert.deepEqual(
      selectGates("finish", [battleFile], (file) =>
        state.changedLines(temp, file, gameBase)
      ),
      [...fullGates, "local-game-ui"]
    );
    writeFileSync(
      join(temp, battleFile),
      "(onHome ?? onExit)?.();\nconst turn = 2;\n"
    );
    git(["add", battleFile]);
    git([
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "navigation change",
    ]);
    const outgoing = state.pushChanges(
      temp,
      `refs/heads/main ${git(["rev-parse", "HEAD"]).trim()} refs/heads/main ${navigationBase}\n`
    );
    assert.deepEqual(
      selectGates("push", outgoing.paths, (file) =>
        outgoing.bases.flatMap((base) => state.changedLines(temp, file, base))
      ),
      [...fullGates, "local-game-ui"],
      "earlier game changes must not be hidden by a later navigation-only edit"
    );
    // Finish may cover only the latest receipt, while push includes older ones.
    clearReceipts();
    const receiptFile = "scripts/fidelity-review-resolutions.json";
    mkdirSync(join(temp, "scripts"), { recursive: true });
    writeFileSync(join(temp, receiptFile), '{"records":[]}\n');
    git(["add", receiptFile]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "receipt baseline"]);
    const receiptBase = git(["rev-parse", "HEAD"]).trim();
    writeFileSync(join(temp, receiptFile), '{"records":[1]}\n');
    git(["add", receiptFile]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "first receipt"]);
    writeFileSync(join(temp, receiptFile), '{"records":[1,2]}\n');
    await run("finish");
    git(["add", receiptFile]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "second receipt"]);
    const receiptHead = git(["rev-parse", "HEAD"]).trim();
    const receiptRefs = `refs/heads/main ${receiptHead} refs/heads/main ${receiptBase}\n`;
    resetCalls();
    await run("push", { reuse: true, pushInput: receiptRefs });
    assert.deepEqual(
      executions(),
      ["review-batch"],
      "earlier receipts require a broader batch check"
    );
    resetCalls();
    await run("push", { reuse: true, pushInput: receiptRefs });
    assert.deepEqual(
      executions(),
      [],
      "same source and resolved bases may reuse the batch check"
    );
    writeFileSync(join(temp, receiptFile), '{"records":[1,2,3]}\n');
    writeFileSync(join(temp, "logs/commit-in-gate"), "1");
    await run("finish");
    rmSync(join(temp, "logs/commit-in-gate"));
    const batchDiff = state.readJson(join(temp, "logs/batch-diff.json"));
    assert.equal(
      batchDiff.base,
      receiptHead,
      "gate uses the SHA from before the in-gate commit"
    );
    assert.equal(
      batchDiff.changed,
      true,
      "same-content commit cannot erase the diff under verification"
    );

    // A review-only merge must not bypass fresh source verification after an
    // ignored shared mirror or cited proof changes. Keep ordinary tree/env checks.
    writeFileSync(join(temp, ".git/info/exclude"), "external-qa/\n");
    mkdirSync(join(temp, "external-qa"), { recursive: true });
    const mirrorPath = join(temp, "external-qa/cardData.js");
    const proofPath = join(temp, "logs/review-proof.txt");
    writeFileSync(mirrorPath, "reviewed mirror");
    writeFileSync(proofPath, "reviewed evidence");
    writeFileSync(
      join(temp, receiptFile),
      JSON.stringify({
        records: [{ evidenceRefs: [{ path: "logs/review-proof.txt" }] }],
      })
    );
    await run("merge");
    resetCalls();
    await run("merge", { reuse: true });
    assert.deepEqual(executions(), []);
    const codeFingerprint = state.sourceFingerprint(temp);
    for (const [path, content] of [
      [mirrorPath, "stale mirror"],
      [proofPath, "changed evidence"],
    ]) {
      writeFileSync(path, content);
      assert.equal(
        state.sourceFingerprint(temp),
        codeFingerprint,
        "fixture changes only ignored audit inputs"
      );
      resetCalls();
      await run("merge", { reuse: true });
      assert.deepEqual(
        executions(),
        ["changed-style", "docs", "fidelity", "review-batch"],
        "ignored audit input changes invalidate all selected gates"
      );
    }
  } finally {
    Object.assign(gates, originalGates);
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
  }
}

try {
  for (const profile of ["full", "finish", "push", "merge", "ci"]) {
    await assert.rejects(
      runGates({ root: temp, profile, extra: ["--help"] }),
      /Only the test profile/
    );
  }
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Harness Test"]);
  git(["config", "user.email", "harness@example.invalid"]);
  writeFileSync(join(temp, "old.ts"), "const a = 1;\nconst b = 2;\n");
  writeFileSync(join(temp, ".gitignore"), "logs/\n.env*\nnode_modules/\n");
  git(["add", "."]);
  git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"]);
  const initial = state.sourceFingerprint(temp);
  const diagnosticOutput = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(root, "scripts/harness/fingerprint-diagnostics.mjs"),
        "--root",
        temp,
      ],
      { encoding: "utf8" }
    )
  );
  assert.deepEqual(
    diagnosticOutput,
    {
      schemaVersion: 1,
      ...state.sourceFingerprintDetails(temp, {
        extraFiles: auditInputFiles(temp),
      }),
    },
    "the read-only diagnostic command uses the same inputs as gate verification"
  );
  const release = await acquireGateLease(temp);
  try {
    await assert.rejects(
      acquireGateLease(temp, { timeoutMs: 15, pollMs: 10 }),
      /timed out/
    );
  } finally {
    release();
  }
  const releaseAgain = await acquireGateLease(temp, { timeoutMs: 20 });
  releaseAgain();
  await testLeaseRecovery();
  assert.deepEqual(
    typecheckProjects(
      ["apps/playground-web/src/main.tsx", "apps/playground-web/src/other.ts"],
      root
    ),
    ["packages/rules-core", "apps/playground-web"]
  );
  assert.equal(
    classify("manual/ai-reference/30_plan/full-run-control.md"),
    "reference"
  );
  assert.equal(classify("packages/ai/README.md"), "entry");
  writeFileSync(join(temp, ".env"), "HARNESS_TEST_MODE=fixture");
  assert.notEqual(state.sourceFingerprint(temp), initial);
  rmSync(join(temp, ".env"));
  for (const key of [
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "omp_num_threads",
    "mkl_num_threads",
    "openblas_num_threads",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_UNRECOGNIZED_VERIFICATION_SETTING",
    "RUN_FUZZ",
    "PW_BASE_URL",
    "ORIKA_TEST_URL",
    "ORICA_UNRECOGNIZED_VERIFICATION_SETTING",
  ]) {
    const saved = process.env[key];
    try {
      process.env[key] = "harness-private-value-one";
      const one = state.sourceFingerprintDetails(temp);
      process.env[key] = "harness-private-value-two";
      const two = state.sourceFingerprintDetails(temp);
      assert.notEqual(two.fingerprint, one.fingerprint, key);
      assert.notEqual(two.components.environment, one.components.environment);
      assert.equal(two.components.files, one.components.files);
      assert.equal(two.components.runtime, one.components.runtime);
      assert.ok(
        two.environmentKeys.some(
          (name) => name.toUpperCase() === key.toUpperCase()
        )
      );
      assert.doesNotMatch(JSON.stringify(two), /harness-private-value/);
    } finally {
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
    }
  }
  for (const key of [
    "NODE_REPL_NODE_MODULE_DIRS",
    "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
    "NODE_REPL_TRUSTED_CODE_PATHS",
    "NODE_REPL_TRUSTED_SERVICES",
    "node_repl_trusted_services",
    "ORICA_SUPERVISOR_RUN_LOG",
    "ORICA_WORK_RECOVERY_CONTEXT",
    "ORICA_INTEGRATION_REQUEST",
    "ORICA_WORKER_DELIVERY_FILE",
    "ORICA_CODEX_CLI",
    "ORICA_CODEX_FULL_RUN",
    "ORICA_CODEX_MODEL",
    "ORICA_CODEX_REASONING_EFFORT",
    "ORICA_CODEX_VERBOSITY",
    "ORICA_FULL_RUN_WORKER_REF",
    "ORICA_LANE_KIND",
  ]) {
    const saved = process.env[key];
    try {
      delete process.env[key];
      const parentInputs = state.sourceFingerprintDetails(temp);
      process.env[key] = "codex-shell-browser-repl-only";
      assert.deepEqual(
        state.sourceFingerprintDetails(temp),
        parentInputs,
        `${key} must not discard the parent runner's identical verification`
      );
    } finally {
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
    }
  }
  const envBefore = process.env.RUN_FUZZ;
  try {
    process.env.RUN_FUZZ = "harness-fingerprint-test";
    assert.notEqual(state.sourceFingerprint(temp), initial);
  } finally {
    if (envBefore === undefined) delete process.env.RUN_FUZZ;
    else process.env.RUN_FUZZ = envBefore;
  }
  mkdirSync(join(temp, "apps/playground-web"), { recursive: true });
  writeFileSync(
    join(temp, "apps/playground-web/.env.test.local"),
    "PRIVATE=test"
  );
  assert.notEqual(state.sourceFingerprint(temp), initial);
  rmSync(join(temp, "apps/playground-web/.env.test.local"));
  const patch =
    "*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@\n-const a = 1;\n+const a = 3;\n const b = 2;\n*** Add File: second.ts\n+export const c = 1;\n*** End Patch";
  assert.deepEqual(editedPaths("functions.apply_patch", { command: patch }), [
    "old.ts",
    "new.ts",
    "second.ts",
  ]);
  const edits = proposedEdits("apply_patch", { command: patch }, temp);
  assert.equal(
    edits.find((e) => e.file.endsWith("new.ts")).content,
    "const a = 3;\nconst b = 2;\n"
  );
  assert.equal(edits.find((e) => e.file.endsWith("old.ts")).content, undefined);
  assert.equal(
    readFileSync(join(temp, "old.ts"), "utf8"),
    "const a = 1;\nconst b = 2;\n"
  );
  assert.equal(existsSync(join(temp, "new.ts")), false);
  writeFileSync(join(temp, "repeat.ts"), "first\nvalue\nsecond\nvalue\n");
  const anchored = proposedEdits(
    "apply_patch",
    {
      command:
        "*** Begin Patch\n*** Update File: repeat.ts\n@@ second\n-value\n+changed\n*** End Patch",
    },
    temp
  );
  assert.equal(anchored[0].content, "first\nvalue\nsecond\nchanged\n");
  assert.throws(
    () =>
      proposedEdits(
        "apply_patch",
        {
          command:
            "*** Begin Patch\n*** Update File: repeat.ts\n@@\n-alue\n+bad\n*** End Patch",
        },
        temp
      ),
    /context/
  );
  rmSync(join(temp, "repeat.ts"));
  assert.throws(
    () =>
      proposedEdits(
        "apply_patch",
        { command: patch.replace("const a = 1", "no context") },
        temp
      ),
    /context/
  );
  const multi = proposedEdits(
    "MultiEdit",
    {
      file_path: "old.ts",
      edits: [
        { old_string: "a = 1", new_string: "a = 2" },
        { old_string: "a = 2", new_string: "a = 3" },
      ],
    },
    temp
  );
  assert.match(multi[0].content, /a = 3/);
  for (const file of [
    "packages/rules-core/src/model.ts",
    "packages/rules-core/src/dsl-types.ts",
  ]) {
    assert.ok(checkWriteAdvisor(file, 'kind: "new_kind"', "", {}));
    assert.equal(
      checkWriteAdvisor(file, 'kind: "existing"', 'kind: "existing"', {}),
      null
    );
  }
  mkdirSync(join(temp, "nested"));
  const continuationFile =
    "packages/rules-core/src/legal/pending-action-handlers.ts";
  for (const body of [
    "executeEffect({ chainId: pending.chainId });",
    "finalizeEffectResolution({ chainId: pending.pendingId });",
    'import { finalizeEffectResolution as finish } from "../effect/effect-resolution"; finish({});',
  ])
    assert.match(
      checkWriteAdvisor(continuationFile, body, "", {}) ?? "",
      /createEffectResolutionScope/
    );
  assert.equal(
    checkWriteAdvisor(
      continuationFile,
      "resolution.execute({}); resolution.finalize({}); // executeEffect({})",
      "",
      {}
    ),
    null
  );
  assert.equal(
    checkWriteAdvisor(
      "packages/rules-core/src/legal/legal-actions-apply.ts",
      "executeEffect({ chainId: initialCause });",
      "",
      {}
    ),
    null
  );
  assert.equal(projectRoot({ cwd: join(temp, "nested") }), temp);
  const design = "manual/ai-reference/20_design/test.md";
  const inputPatch =
    "*** Begin Patch\n*** Add File: " + design + "\n+# short\n*** End Patch";
  for (const input of [
    {
      tool_name: "Write",
      tool_input: { file_path: design, content: "# short" },
    },
    { tool_name: "apply_patch", tool_input: { command: inputPatch } },
    {
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "old.ts",
        edits: [{ old_string: "absent", new_string: "x" }],
      },
    },
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(root, ".codex/hooks/pre-tool-guard.js")],
      {
        input: JSON.stringify({ ...input, cwd: temp }),
        encoding: "utf8",
        cwd: temp,
      }
    );
    assert.equal(result.status, 2, result.stderr);
  }
  assert.equal(existsSync(join(temp, design)), false);
  const beforeRename = state.sourceFingerprint(temp);
  rmSync(join(temp, "old.ts"));
  writeFileSync(join(temp, "renamed.ts"), "const a = 1;\n");
  assert.deepEqual(state.changedPaths(temp), ["old.ts", "renamed.ts"]);
  assert.notEqual(state.sourceFingerprint(temp), initial);
  const renamed = state.sourceFingerprint(temp);
  assert.notEqual(renamed, beforeRename);
  git(["add", "-A", "--", "old.ts", "renamed.ts"]);
  assert.equal(state.sourceFingerprint(temp), renamed);
  git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "rename source"]);
  assert.equal(state.sourceFingerprint(temp), renamed);
  rmSync(join(temp, "renamed.ts"));
  const deleted = state.sourceFingerprint(temp);
  assert.notEqual(deleted, renamed);
  git(["add", "-u", "--", "renamed.ts"]);
  assert.equal(state.sourceFingerprint(temp), deleted);
  git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "delete source"]);
  assert.equal(state.sourceFingerprint(temp), deleted);
  const missingProof = join(temp, "logs/required-proof.txt");
  const proofOptions = { extraFiles: [missingProof] };
  const requiredMissing = state.sourceFingerprint(temp, proofOptions);
  assert.notEqual(
    requiredMissing,
    deleted,
    "required missing inputs stay bound"
  );
  mkdirSync(join(temp, "logs"), { recursive: true });
  writeFileSync(missingProof, "reviewed proof");
  assert.notEqual(state.sourceFingerprint(temp, proofOptions), requiredMissing);
  rmSync(missingProof);
  assert.equal(state.sourceFingerprint(temp, proofOptions), requiredMissing);
  for (const file of [
    ".env",
    ".env.local",
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
  ]) {
    const absent = state.sourceFingerprint(temp);
    mkdirSync(join(temp, file, ".."), { recursive: true });
    writeFileSync(join(temp, file), "required input fixture");
    assert.notEqual(state.sourceFingerprint(temp), absent, file);
    rmSync(join(temp, file));
    assert.equal(state.sourceFingerprint(temp), absent, file);
  }
  assert.throws(() => state.changedPaths(tmpdir()), /git|Command failed/);
  assert.deepEqual(selectGates("finish", ["README.md"]), [
    "changed-style",
    "docs",
  ]);
  for (const profile of ["finish", "push"]) {
    assert.deepEqual(
      fullGates,
      expectedFullGates,
      "manifest full profile still contains the independently pinned gate set"
    );
    assert.deepEqual(
      selectGates(profile, ["scripts/test-verifier-gate.mjs"]),
      fullGates
    );
    for (const other of [
      "packages/rules-core/src/model.ts",
      "packages/rules-core/src/dsl-types.ts",
      "scripts/verifier-tree.mjs",
      "scripts/unknown-verifier.mjs",
      "packages/card-data/raw/by-pack/BSDB01.js",
      "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json",
      "package.json",
      "pnpm-lock.yaml",
    ])
      assert.deepEqual(
        selectGates(profile, ["scripts/test-verifier-gate.mjs", other]),
        fullGates,
        `unknown or shared production changes still require full: ${other}`
      );
    const effectLeaf = "packages/rules-core/src/effect/structured-combat.ts";
    const testHelper = "packages/rules-core/test/helpers/koishi-target-lock.ts";
    const rulesDoc =
      "manual/ai-reference/10_rules/04b2_effect-prevention-priority.md";
    const engineScope = [
      "changed-style",
      "types",
      "vitest",
      "put-semantics",
      "fidelity",
      "ismcts-runtime",
    ];
    const cardDataScope = [...engineScope, "ledger", "card-tests"];
    assert.deepEqual(selectGates(profile, ["fidelity-baseline.json"]), [
      "changed-style",
      "fidelity",
      "review-batch",
    ]);
    assert.deepEqual(selectGates(profile, [testHelper]), [
      "changed-style",
      "vitest",
      "fidelity",
    ]);
    assert.deepEqual(selectGates(profile, [rulesDoc]), [
      "changed-style",
      "docs",
      "fidelity",
    ]);
    assert.deepEqual(
      selectGates(profile, [effectLeaf, testHelper, rulesDoc]),
      [
        "changed-style",
        "types",
        "vitest",
        "put-semantics",
        "fidelity",
        "ismcts-runtime",
        "docs",
      ],
      "leaf game fix with its test helper and rule evidence keeps all relevant gates"
    );
    assert.deepEqual(
      selectGates(profile, [
        rulesDoc,
        "packages/rules-core/src/battle/battle-availability.ts",
        "packages/rules-core/src/effect/structured-combat.ts",
        "packages/rules-core/src/effect/structured-continuous-effects.ts",
        testHelper,
        "packages/rules-core/test/koishi-target-lock-battle.test.ts",
      ]),
      [
        "changed-style",
        "docs",
        "fidelity",
        "types",
        "vitest",
        "put-semantics",
        "ismcts-runtime",
      ],
      "the complete attack-availability fix keeps engine, source, and rule evidence gates"
    );
    assert.deepEqual(
      selectGates(profile, [
        "manual/ai-reference/10_rules/04_state-based-rules.md",
      ]),
      ["changed-style", "docs", "fidelity", "ssot"],
      "the state-rule document retains its explicit SSOT check"
    );
    for (const shared of [
      "packages/rules-core/src/effect/native-action-registry.ts",
      "packages/rules-core/src/effect/effect-resolution.ts",
      "packages/rules-core/src/effect/continuous-effect-read.ts",
      "packages/rules-core/src/effect/target-affect-gate.ts",
      "packages/rules-core/src/battle/battle-shared.ts",
      "packages/rules-core/src/battle/battle-end-entry-blockers.ts",
      "packages/rules-core/src/stack/stack-window-shared.ts",
      "packages/rules-core/src/play/play-card-system.ts",
      "packages/rules-core/src/effect/structured-effect-interpreter.ts",
      "packages/rules-core/src/effect/structured-continuous-effects.ts",
      "packages/rules-core/src/effect/trigger-system.ts",
      "packages/rules-core/src/battle/battle-availability.ts",
      "packages/rules-core/src/stack/stack-resolution-core.ts",
      "packages/rules-core/src/play/play-card-resolution.ts",
    ])
      assert.deepEqual(
        selectGates(profile, [shared]),
        engineScope,
        `shared rules modules retain all game-engine regression gates: ${shared}`
      );
    assert.equal(
      requiresMergeFuzz(
        ["packages/rules-core/src/effect/effect-resolution.ts"],
        () => ["export const changed = true;"],
        () => false
      ),
      true,
      "shared engine changes retain the 200-seed merge fuzz run"
    );
    for (const sharedIndex of [
      "packages/card-data/src/generated-index.ts",
      "packages/card-data/src/index.ts",
    ])
      assert.deepEqual(
        selectGates(profile, [sharedIndex]),
        cardDataScope,
        `shared card indexes retain engine, ledger, and card-coverage gates: ${sharedIndex}`
      );
    assert.deepEqual(
      selectGates(profile, [
        testHelper,
        "packages/card-data/src/generated-index.ts",
      ]),
      [
        "changed-style",
        "vitest",
        "fidelity",
        "types",
        "put-semantics",
        "ismcts-runtime",
        "ledger",
        "card-tests",
      ],
      "test helper changes do not narrow a change to shared generated card input"
    );
    assert.deepEqual(
      selectGates(profile, ["packages/card-data/src/cards/BSTH05.5.ts"]),
      cardDataScope,
      "card data keeps card ledger and card regressions in addition to engine checks"
    );
    for (const line of [
      "const loadEffect = (name: string) => import(name);",
      'const loadEffect = () => import("./effect");',
      'const loadEffect = () => import /* loader */ ("./effect");',
      'const loadEffect = () => import /*\n loader\n */ ("./effect");',
      "const loadEffect = (name: string) => require(name);",
      "const loadEffect = (name: string) => require /* loader */ (name);",
      "const evaluate = (code: string) => new Function(code)();",
    ])
      assert.deepEqual(
        selectGates(profile, [effectLeaf], () => [line]),
        fullGates,
        `dynamic loading or evaluation in a scoped source falls back to full: ${line}`
      );
    assert.deepEqual(
      selectGates(
        profile,
        [effectLeaf],
        () => ["export const local = true;"],
        () => true
      ),
      expectedFullGates,
      "a newly introduced module inside a known source directory remains full"
    );
    assert.equal(
      requiresMergeFuzz(
        [effectLeaf],
        () => ["export const local = true;"],
        () => true
      ),
      true,
      "new scoped game modules retain merge fuzz coverage"
    );
    assert.deepEqual(
      selectGates(profile, [
        effectLeaf,
        "packages/rules-core/src/plugins/new-effect-loader.ts",
      ]),
      fullGates,
      "a move to an unregistered source area does not inherit the leaf scope"
    );
    assert.deepEqual(
      selectGates(profile, [effectLeaf]),
      [
        "changed-style",
        "types",
        "vitest",
        "put-semantics",
        "fidelity",
        "ismcts-runtime",
      ],
      "a deleted or changed leaf module retains its domain regressions"
    );
    assert.deepEqual(
      selectGates("merge", [effectLeaf, testHelper, rulesDoc]),
      [
        "changed-style",
        "types",
        "vitest",
        "put-semantics",
        "fidelity",
        "ismcts-runtime",
        "docs",
      ],
      "merge uses the same scoped acceptance gates for a reviewed leaf change"
    );
    assert.deepEqual(
      selectGates("merge", [
        "packages/rules-core/src/effect/native-action-registry.ts",
      ]),
      engineScope,
      "shared registry changes retain game regressions while avoiding unrelated operations gates"
    );
    assert.deepEqual(
      selectGates(profile, ["e2e/scenario-four-of-a-kind.spec.ts"]),
      ["changed-style", "scenario-file-scenario-four-of-a-kind"],
      "a changed maintained game scenario runs only its registered spec"
    );
    assert.deepEqual(
      selectGates(profile, ["e2e/unregistered-game-scenario.spec.ts"]),
      fullGates,
      "an E2E file outside the maintained scenario suite stays fail-closed"
    );
    assert.deepEqual(
      selectGates(profile, ["packages/rules-core/src/runtime.ts"]),
      fullGates,
      "the central runtime boundary remains full verification"
    );
    assert.deepEqual(
      selectGates(profile, [
        "e2e/scenario-four-of-a-kind.spec.ts",
        "manual/ai-reference/30_plan/03_completed-milestones-phase-7-8-2026-09.md",
        "packages/rules-core/src/effect/structured-condition-eval.ts",
        "packages/rules-core/test/four-of-a-kind-activation.test.ts",
      ]),
      [
        "changed-style",
        "scenario-file-scenario-four-of-a-kind",
        "docs",
        "types",
        "vitest",
        "put-semantics",
        "fidelity",
        "ismcts-runtime",
      ],
      "the entire historical Four of a Kind fix selects every affected gate"
    );
    for (const path of [
      "scripts/ismcts/windows-job.cs",
      "scripts/ismcts/windows-job.ps1",
      "scripts/ismcts/windows-job.mjs",
    ])
      assert.deepEqual(
        selectGates(profile, [path]),
        selectGates(profile, ["scripts/ismcts-program.mjs"])
      );
    assert.deepEqual(
      selectGates(profile, ["scripts/ismcts/runtime-telemetry.mjs"]),
      ["changed-style", "ismcts-telemetry"]
    );
    assert.deepEqual(
      selectGates(profile, ["scripts/test-ismcts-runtime.mjs"]),
      ["changed-style", "ismcts-runtime"]
    );
    assert.deepEqual(selectGates(profile, ["scripts/ismcts-program.mjs"]), [
      "changed-style",
      "ismcts-program",
      "ismcts-runtime",
      "harness",
      "verifier",
      "ismcts-dispatch",
      "storage",
    ]);
    assert.deepEqual(
      selectGates(profile, [
        "scripts/ismcts/budget.mjs",
        "packages/rules-core/src/types.ts",
      ]),
      fullGates
    );
  }
  const homeFile = "apps/playground-web/src/components/HomeLobby.tsx";
  for (const profile of ["finish", "push"]) {
    for (const file of [
      "deploy/local-pc/funnel-probe.mjs",
      "deploy/local-pc/funnel-policy.mjs",
      "deploy/local-pc/funnel-watchdog.mjs",
      "deploy/local-pc/register-funnel-watchdog.ps1",
      "scripts/test-funnel-watchdog.mjs",
      ".github/workflows/public-api-monitor.yml",
    ]) {
      assert.deepEqual(selectGates(profile, [file]), [
        "changed-style",
        "funnel-watchdog",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          file,
          "apps/playground-web/server/http-server.ts",
        ]),
        fullGates
      );
    }
    assert.deepEqual(
      selectGates(profile, ["deploy/local-pc/run-api.mjs"]),
      fullGates
    );
    assert.deepEqual(
      selectGates(profile, [".github/workflows/ci.yml"]),
      fullGates
    );
    const savedDeckFile =
      "apps/playground-web/src/components/SavedDeckBrowser.tsx";
    for (const file of [
      savedDeckFile,
      "apps/playground-web/src/utils/saved-deck-filters.ts",
      "apps/playground-web/src/saved-deck-browser.css",
      "e2e/saved-deck-filters.spec.ts",
    ]) {
      assert.deepEqual(selectGates(profile, [file]), [
        "changed-style",
        "saved-deck-types",
        "saved-deck-unit",
        "saved-deck-ui",
      ]);
      assert.deepEqual(
        selectGates(profile, [file, "apps/playground-web/server/game-api.ts"]),
        [...fullGates, "local-game-ui"]
      );
      assert.deepEqual(
        selectGates(profile, [file, "packages/rules-core/src/model.ts"]),
        fullGates
      );
    }
    assert.deepEqual(
      selectGates(profile, [
        savedDeckFile,
        "apps/playground-web/src/components/DeckBuilder.tsx",
      ]),
      fullGates
    );
    for (const file of [
      "e2e/room-invitations-live.spec.ts",
      "e2e/room-invitations-cleanup.ts",
      "apps/playground-web/test/room-invitations-cleanup.test.ts",
    ]) {
      assert.deepEqual(selectGates(profile, [file]), [
        "changed-style",
        "invitation-test-cleanup",
        "app-appearance",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          file,
          "apps/playground-web/server/room-invitations.ts",
        ]),
        fullGates
      );
    }
    for (const titleFile of [
      "apps/playground-web/src/components/TitleScreen.tsx",
      "apps/playground-web/src/components/title-screen.css",
      "e2e/title-image-download.spec.ts",
      "e2e/title-asset-storage.spec.ts",
      "e2e/title-direct-link.spec.ts",
    ]) {
      assert.deepEqual(selectGates(profile, [titleFile]), [
        "changed-style",
        "title-preparation",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          titleFile,
          "apps/playground-web/src/assets/AssetPreparation.tsx",
        ]),
        fullGates
      );
    }
    assert.deepEqual(
      selectGates(profile, ["apps/playground-web/src/bgm/BgmControls.tsx"]),
      ["changed-style", "title-preparation", "home-layout"]
    );
    assert.deepEqual(
      selectGates(profile, [
        "apps/playground-web/src/bgm/BgmControls.tsx",
        "apps/playground-web/src/bgm/BgmContext.tsx",
      ]),
      fullGates
    );
    for (const writerFile of [
      "verifier-write-lock",
      "run-with-lock-heartbeat",
      "spawn-verifier",
      "verifier-evidence",
    ]) {
      assert.deepEqual(
        selectGates(profile, ["scripts/" + writerFile + ".mjs"]),
        [
          "changed-style",
          "verifier",
          "handoff",
          "supervisor-lock",
          "supervisor-runner-lock",
        ]
      );
    }
    for (const supervisorFile of [
      "scripts/full-run-checkouts.mjs",
      "scripts/full-run-checkouts.json",
      "scripts/test-full-run-checkouts.mjs",
      "scripts/register-supervisor-task.ps1",
      "scripts/configure-codex-autostart.ps1",
      "scripts/sync-worktree-to-main.mjs",
      "scripts/test-sync-worktree-failures.mjs",
      "scripts/remote-main-integration.mjs",
      "scripts/test-remote-main-integration.mjs",
      "scripts/run-supervisor-iteration.ps1",
      "scripts/supervisor-followup.mjs",
      "scripts/test-supervisor-followup.mjs",
      "scripts/supervisor-followup-evidence.mjs",
      "scripts/test-supervisor-followup-evidence.mjs",
      "scripts/supervisor-health.mjs",
      "scripts/test-supervisor-health.mjs",
      "scripts/test-supervisor-handoff.mjs",
      "scripts/test-supervisor-runner-lock.mjs",
      "scripts/auto-merge-status.mjs",
      "scripts/watch-supervisor-events.mjs",
      "scripts/primary-main.mjs",
      "scripts/test-primary-main.mjs",
      "scripts/lib/supervisor-work-plan.ps1",
      "scripts/test-supervisor-work-plan.mjs",
      "scripts/test-supervisor-environment.mjs",
    ]) {
      assert.deepEqual(selectGates(profile, [supervisorFile]), [
        "changed-style",
        "handoff",
        "supervisor-lock",
        "supervisor-runner-lock",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          supervisorFile,
          "packages/rules-core/src/model.ts",
        ]),
        fullGates
      );
    }
    for (const autoMergeFile of [
      "scripts/auto-merge.ps1",
      "scripts/supervisor-integration.mjs",
      "scripts/test-supervisor-integration.mjs",
    ]) {
      assert.deepEqual(selectGates(profile, [autoMergeFile]), [
        "changed-style",
        "auto-merge-integration",
        "supervisor-lock",
        "supervisor-runner-lock",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          autoMergeFile,
          "packages/rules-core/src/runtime.ts",
        ]),
        fullGates
      );
    }
    assert.deepEqual(
      selectGates(profile, ["package.json"], () => [
        '"verify:dialogue": "node scripts/harness/run-gates.mjs --profile dialogue",',
      ]),
      ["changed-style", "harness"]
    );
    assert.deepEqual(
      selectGates(profile, ["package.json"], () => [
        '"verify:dialogue": "node scripts/harness/run-gates.mjs --profile dialogue",',
        '"dependencies": {',
      ]),
      fullGates,
      "additional package changes must not inherit the command-only scope"
    );
    assert.deepEqual(
      selectGates(profile, ["scripts/harness/vitest-acceptance-reporter.mjs"]),
      [
        "changed-style",
        "handoff",
        "supervisor-lock",
        "supervisor-runner-lock",
        "harness",
        "verifier",
        "dev-contract",
      ]
    );
    assert.deepEqual(
      selectGates(profile, ["scripts/telegram-message-worker.mjs"]),
      [
        "changed-style",
        "auxiliary-model-policy",
        "notice-editor",
        "telegram",
        "supervisor-runner-lock",
      ]
    );
    assert.deepEqual(
      selectGates(profile, [
        "scripts/telegram-message-worker.mjs",
        "packages/rules-core/src/model.ts",
      ]),
      fullGates
    );
    assert.deepEqual(
      selectGates(profile, ["scripts/test-telegram-reception.mjs"]),
      [
        "changed-style",
        "audit-operations",
        "supervisor-runner-lock",
        "telegram",
        "handoff",
      ]
    );
    for (const telegramFile of [
      "scripts/telegram-inbox.mjs",
      "scripts/telegram-document.mjs",
      "scripts/telegram-message-worker.mjs",
      "scripts/test-telegram-documents.mjs",
    ]) {
      assert.deepEqual(
        selectGates(profile, [telegramFile]),
        [
          "scripts/telegram-message-worker.mjs",
          "scripts/telegram-inbox.mjs",
        ].includes(telegramFile)
          ? [
              "changed-style",
              "auxiliary-model-policy",
              "notice-editor",
              "telegram",
              "supervisor-runner-lock",
            ]
          : ["changed-style", "telegram"]
      );
      assert.deepEqual(
        selectGates(profile, [
          telegramFile,
          "packages/rules-core/src/model.ts",
        ]),
        fullGates
      );
    }
    for (const auxiliaryFile of [
      "scripts/auxiliary-model-policy.mjs",
      "scripts/telegram-reception-policy.mjs",
      "scripts/test-auxiliary-model-policy.mjs",
      "scripts/telegram-message-worker.mjs",
      "scripts/telegram-inbox.mjs",
    ]) {
      assert.deepEqual(selectGates(profile, [auxiliaryFile]), [
        "changed-style",
        "auxiliary-model-policy",
        "notice-editor",
        "telegram",
        "supervisor-runner-lock",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          auxiliaryFile,
          "packages/rules-core/src/model.ts",
        ]),
        fullGates
      );
    }
    for (const noticeFile of [
      "scripts/notices/codex-summary.mjs",
      "apps/playground-web/test/operation-notice-digest.test.ts",
    ]) {
      assert.deepEqual(selectGates(profile, [noticeFile]), [
        "changed-style",
        "auxiliary-model-policy",
        "notice-editor",
      ]);
      assert.deepEqual(
        selectGates(profile, [noticeFile, "packages/rules-core/src/model.ts"]),
        fullGates
      );
    }
    assert.deepEqual(
      selectGates(profile, ["scripts/worker-codex-stream.mjs"]),
      [
        "changed-style",
        "audit-operations",
        "supervisor-runner-lock",
        "telegram",
        "handoff",
      ]
    );
    assert.deepEqual(
      selectGates(profile, [
        "scripts/worker-codex-stream.mjs",
        "packages/rules-core/src/model.ts",
      ]),
      fullGates
    );
    const battleFile = "apps/playground-web/src/components/BattleScreen.tsx";
    assert.deepEqual(selectGates(profile, [battleFile]), [
      ...fullGates,
      "local-game-ui",
    ]);
    assert.deepEqual(
      selectGates(profile, [battleFile], () => []),
      [...fullGates, "local-game-ui"]
    );
    assert.deepEqual(
      selectGates(profile, [battleFile], () => ["  タイトルへ", "  ホームへ"]),
      ["changed-style", "battle-navigation"]
    );
    assert.deepEqual(
      selectGates(profile, [battleFile], () => [
        "  ホームへ",
        "  handleReset();",
      ]),
      [...fullGates, "local-game-ui"]
    );
    assert.deepEqual(
      selectGates(profile, [homeFile, "e2e/home-lobby.spec.ts"]),
      ["changed-style", "home-layout"]
    );
    for (const appearanceFile of [
      "apps/playground-web/src/app-theme.css",
      "e2e/app-theme.spec.ts",
      "e2e/room-invitations.spec.ts",
      "e2e/room-push.spec.ts",
    ]) {
      assert.deepEqual(selectGates(profile, [appearanceFile]), [
        "changed-style",
        "app-appearance",
      ]);
      assert.deepEqual(selectGates(profile, [appearanceFile, homeFile]), [
        "changed-style",
        "app-appearance",
        "home-layout",
      ]);
      assert.deepEqual(
        selectGates(profile, [
          appearanceFile,
          "apps/playground-web/server/room-invitations.ts",
        ]),
        fullGates
      );
    }
    assert.deepEqual(
      selectGates(profile, [
        homeFile,
        "CLAUDE.md",
        "scripts/harness/run-gates.mjs",
      ]),
      [
        "changed-style",
        "home-layout",
        "docs",
        "harness",
        "verifier",
        "dev-contract",
      ]
    );
    for (const path of [
      "packages/rules-core/src/model.ts",
      "apps/playground-web/server/game-api.ts",
      "package.json",
      "pnpm-lock.yaml",
      "playwright.config.ts",
      "unknown.ts",
    ])
      assert.deepEqual(
        selectGates(profile, [homeFile, path]),
        path === "apps/playground-web/server/game-api.ts"
          ? [...fullGates, "local-game-ui"]
          : fullGates
      );
    assert.deepEqual(selectGates(profile, null), fullGates);
    assert.deepEqual(selectGates(profile, []), []);
  }
  assert.deepEqual(selectGates("finish", ["deleted.ts"]), [
    ...new Set(fullGates),
  ]);
  assert.ok(selectGates("ci").includes("ledger"));
  assert.ok(selectGates("ci").includes("scenario"));
  // Record existing GUI gates without promoting this bounded run to full.
  assert.deepEqual(selectGates("scenario"), ["scenario"]);
  assert.deepEqual(
    selectGates("scenario", ["packages/rules-core/src/model.ts"]),
    ["scenario"]
  );
  for (const profile of ["merge", "full", "ci"])
    for (const file of [
      "scripts/test-verifier-gate.mjs",
      "scripts/test-supervisor-environment.mjs",
    ])
      assert.ok(
        fullGates.every((gate) => selectGates(profile, [file]).includes(gate)),
        `${profile} must retain every full gate for ${file}`
      );
  for (const profile of ["finish", "push"]) {
    assert.deepEqual(selectGates(profile, ["scripts/fuzz-runner.mjs"]), [
      "changed-style",
      "harness",
      "handoff",
    ]);
    assert.deepEqual(selectGates(profile, ["scripts/harness/gate-queue.mjs"]), [
      "changed-style",
      "harness",
      "verifier",
      "dev-contract",
    ]);
  }
  // secret gate wiring: tool/config changes stay bounded; engine changes retain full gates.
  for (const profile of ["finish", "push", "merge"]) {
    for (const file of [
      "scripts/security/secrets.mjs",
      ".gitleaks.toml",
      ".github/workflows/secrets.yml",
    ])
      assert.deepEqual(selectGates(profile, [file]), [
        "changed-style",
        "secrets",
      ]);
    assert.ok(selectGates(profile, [".husky/pre-push"]).includes("secrets"));
    assert.ok(
      selectGates(profile, [
        "scripts/security/secrets.mjs",
        "packages/rules-core/src/model.ts",
      ]).includes("vitest")
    );
  }
  assert.ok(selectGates("ci").includes("secrets"));
  assert.deepEqual(selectGates("unit"), ["vitest"]);
  assert.throws(() => selectGates("misspelled"), /Unknown/);
  const empty = spawnSync(
    process.execPath,
    [
      join(root, "scripts/vitest-with-jest-aliases.mjs"),
      "harness-deliberately-no-such-file.test.ts",
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(empty.status, 1, empty.stdout + empty.stderr);
  const stop = spawnSync(
    process.execPath,
    [join(root, ".codex/hooks/test-stop-guard.js")],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  await testGateReuse();
  for (const file of [
    "scripts/check-docs.mjs",
    "scripts/doc-links.mjs",
    "scripts/test-doc-links.mjs",
  ]) {
    const selected = selectGates("finish", [file]);
    assert.ok(selected.includes("docs"), file);
    assert.ok(selected.includes("harness"), file);
    assert.ok(!selected.includes("vitest"), file);
  }
  assert.deepEqual(
    selectGates("finish", ["README.md", "scripts/doc-links.mjs"]),
    ["changed-style", "docs", "harness"]
  );
  assert.deepEqual(
    selectGates("push", [
      "scripts/doc-links.mjs",
      "packages/rules-core/src/model.ts",
    ]),
    fullGates
  );
  await testDocLinks();
  await testUnitEntry();
  await testGateQueue();
  console.log(
    "[test-harness] passed: canonical patch, rename/delete, advisory parity, failed discovery, gate profiles and Stop regression"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
