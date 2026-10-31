import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gates,
  failedGateAliases,
  requiresMergeFuzz,
  selectGates,
  testGates,
} from "./gate-manifest.mjs";
import {
  acquireGateLease,
  discardGateRetry,
  leaseFailureExit,
} from "./gate-lease.mjs";
import state from "./verification-state.cjs";
import { unitTestFiles, assertUnitTestResults } from "./unit-test-input.mjs";
import { auditInputFiles } from "../audit-inputs.mjs";
import { buildVerificationTree } from "../verifier-tree.mjs";
import { checkpointWorkerBoundary } from "../supervisor-work-recovery.mjs";

function verificationFingerprint(root) {
  return state.sourceFingerprint(root, { extraFiles: auditInputFiles(root) });
}

// These two suites run game-independent fixtures, never the checked-out game.
// The known game source/test namespace and audit outputs are not fixture inputs.
// Keep every other path/mode/content, scripts, configuration, dependencies,
// external inputs and environment bound; unknown inputs always invalidate.
// Runtime ISMCTS tests execute the actual game and MUST NOT use this scope.
function gateInputFingerprints(root) {
  const result = {};
  let operations;
  for (const [id, gate] of Object.entries(gates)) {
    if (gate.inputScope !== "operational-fixtures-v1") continue;
    operations ??= state.sourceFingerprint(root, {
      extraFiles: auditInputFiles(root),
      excludeFile: (file) => {
        // Audit evidence can list the same file by absolute and relative paths.
        const ref = relative(root, resolve(root, file)).replaceAll("\\", "/");
        return (
          /^packages\/(?:rules-core|card-data)\/(?:src|test)\/.*\.ts$/.test(
            ref
          ) ||
          [
            "fidelity-baseline.json",
            "scripts/fidelity-review-resolutions.json",
            "manual/ai-reference/30_plan/02_detailed-todo.md",
          ].includes(ref)
        );
      },
    });
    result[id] = operations;
  }
  return result;
}

function gateEnvironment(root) {
  // Git hooks export repository selectors. A gate may create a foreign test
  // repository, so inheriting them can mutate the real checkout's Git config.
  const localNames = new Set(
    state.git(root, ["rev-parse", "--local-env-vars"]).trim().split(/\r?\n/)
  );
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !localNames.has(name.toUpperCase())
    )
  );
}

export function isReusableCompletionReport(report) {
  return report?.schemaVersion === 2 && report.completionGate === true;
}

export function isReusableGateSourceReport(report) {
  return (
    isReusableCompletionReport(report) ||
    (report?.schemaVersion === 2 &&
      report.completionGate === false &&
      [
        "test",
        "unit",
        "dialogue",
        "scenario",
        "local-game",
        "public-build",
      ].includes(report.profile))
  );
}

function isExactTestGateRun(report) {
  if (
    report?.schemaVersion !== 2 ||
    report.profile !== "test" ||
    report.completionGate !== false ||
    report.status !== "passed" ||
    !Number.isFinite(report.startedAt) ||
    !Number.isFinite(report.finishedAt) ||
    report.finishedAt < report.startedAt ||
    !Array.isArray(report.selectedGates) ||
    JSON.stringify(report.selectedGates) !== JSON.stringify(testGates) ||
    !Array.isArray(report.gates) ||
    report.gates.length !== testGates.length ||
    report.gates.some(
      (gate, index) =>
        !gate ||
        typeof gate !== "object" ||
        Array.isArray(gate) ||
        gate.id !== testGates[index] ||
        gate.status !== "passed" ||
        gate.reused !== false
    )
  )
    return false;
  return true;
}

export function isCompleteTestGateReport(report, root) {
  if (
    !isExactTestGateRun(report) ||
    !Array.isArray(report.vitestArgs) ||
    report.vitestArgs.length !== 0
  )
    return false;

  const vitest = report.gates.find((gate) => gate.id === "vitest");
  if (vitest?.testResults?.kind !== "vitest" || !vitest.testResults.path)
    return false;
  try {
    const candidates = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8", windowsHide: true }
    )
      .split("\0")
      .filter((file) => /^(packages|apps)\/.+\/test\/.+\.test\.ts$/.test(file))
      .sort();
    const vitestResult = state.readJson(vitest.testResults.path);
    if (
      vitestResult.numPendingTests !== 0 ||
      vitestResult.numTodoTests !== 0 ||
      !Array.isArray(vitestResult.testResults) ||
      vitestResult.testResults.some(
        (suite) =>
          !Array.isArray(suite.assertionResults) ||
          suite.assertionResults.some((test) => test.status !== "passed")
      )
    )
      return false;
    assertUnitTestResults(root, candidates, vitest.testResults.path);
    return true;
  } catch {
    return false;
  }
}

export function hasReusableTestGateEvidence(report, gateId, root) {
  if (!isExactTestGateRun(report)) return false;
  if (gateId === "vitest") return isCompleteTestGateReport(report, root);
  return true;
}

// A focused browser run can certify only its exact registered gates. It never
// becomes a completion report or substitutes for a broader scenario collection.
export function hasReusableBrowserProfileEvidence(report, gateId) {
  if (
    report?.schemaVersion !== 2 ||
    report.completionGate !== false ||
    report.status !== "passed" ||
    !["scenario", "local-game", "public-build"].includes(report.profile) ||
    !Number.isFinite(report.startedAt) ||
    !Number.isFinite(report.finishedAt) ||
    report.finishedAt < report.startedAt ||
    !Array.isArray(report.vitestArgs) ||
    report.vitestArgs.length !== 0 ||
    !Array.isArray(report.selectedGates) ||
    !Array.isArray(report.gates)
  )
    return false;
  if (report.profile === "scenario" && !Array.isArray(report.playwrightFiles))
    return false;
  try {
    const expected = selectGates(
      report.profile,
      [],
      undefined,
      undefined,
      report.playwrightFiles ?? []
    );
    return (
      expected.includes(gateId) &&
      JSON.stringify(report.selectedGates) === JSON.stringify(expected) &&
      report.gates.length === expected.length &&
      report.gates.every(
        (gate, index) =>
          gate?.id === expected[index] &&
          gate.status === "passed" &&
          gate.exitCode === 0 &&
          gate.reused === false
      )
    );
  } catch {
    return false;
  }
}

function reusableGates(
  root,
  fingerprint,
  gateInputs,
  profile,
  reuse,
  changed,
  diffBases
) {
  const result = new Map();
  if (
    !reuse ||
    process.env.CI ||
    !["finish", "push", "merge"].includes(profile)
  )
    return result;
  const directory = resolve(root, "logs/harness/runs");
  let history = [];
  try {
    history = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => state.readJson(resolve(directory, name)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const reports = [
    state.readJson(resolve(root, "logs/harness/latest.json")),
    ...history,
  ]
    .filter(
      (report) =>
        isReusableGateSourceReport(report) &&
        ["passed", "failed", "running"].includes(report.status) &&
        Number.isFinite(report.startedAt) &&
        (report.status === "running" ||
          (Number.isFinite(report.finishedAt) &&
            report.finishedAt >= report.startedAt)) &&
        Array.isArray(report.gates) &&
        Array.isArray(report.vitestArgs)
    )
    .sort(
      (a, b) =>
        (b.status === "running" ? b.startedAt : b.finishedAt) -
          (a.status === "running" ? a.startedAt : a.finishedAt) ||
        Number(b.status === "running") - Number(a.status === "running")
    );
  const observed = new Set();
  for (const report of reports) {
    // A killed runner has no terminal gate result. Its persisted current gate
    // must invalidate older successes just like a failure. Before a current gate
    // is saved, use the frozen selection; legacy/unknown scope fails closed.
    const interrupted =
      report.status !== "running"
        ? []
        : Object.hasOwn(gates, report.currentGate)
          ? [report.currentGate]
          : report.currentGate == null &&
              Array.isArray(report.selectedGates) &&
              report.selectedGates.every((id) => Object.hasOwn(gates, id))
            ? report.selectedGates
            : Object.keys(gates);
    for (const gate of [
      ...interrupted.map((id) => ({ id, status: "failed" })),
      ...report.gates,
    ].flatMap((gate) =>
      gate?.status === "failed"
        ? failedGateAliases(gate.id).map((id) => ({ ...gate, id }))
        : [gate]
    )) {
      if (
        !gate ||
        !Object.hasOwn(gates, gate.id) ||
        observed.has(gate.id) ||
        gates[gate.id].reusable === false ||
        !state.gateInputsMatch(
          report,
          { fingerprint, gateInputs },
          gate.id,
          gates[gate.id].inputScope
        )
      )
        continue;
      if (gate.status === "failed") {
        // A newer failure must never be hidden by an older success.
        observed.add(gate.id);
      } else if (
        report.status === "passed" &&
        // Only complete, exact test/browser runs provide per-gate evidence.
        // Unit/dialogue still only invalidate old passes, never satisfy one.
        (isReusableCompletionReport(report) ||
          hasReusableTestGateEvidence(report, gate.id, root) ||
          hasReusableBrowserProfileEvidence(report, gate.id)) &&
        gate.status === "passed" &&
        gate.reused === false &&
        (gate.id !== "vitest" || report.vitestArgs.length === 0) &&
        (!gates[gate.id].diffBase ||
          JSON.stringify(report.diffBases) === JSON.stringify(diffBases)) &&
        (!gates[gate.id].changedFiles ||
          JSON.stringify(report.changed) === JSON.stringify(changed))
      ) {
        observed.add(gate.id);
        result.set(gate.id, report.startedAt);
      }
    }
  }
  return result;
}

function verificationSelection(
  root,
  profile,
  pushInput,
  freezeTree = false,
  scenarioFiles = []
) {
  // Freeze symbolic refs before selecting the diff. Committing identical bytes
  // during a gate must not silently shrink the batch subsequently checked.
  const localBase =
    profile === "push"
      ? null
      : state
          .git(root, [
            "rev-parse",
            `${profile === "merge" ? "main" : "HEAD"}^{commit}`,
          ])
          .trim();
  const { paths: changed, bases } =
    profile === "push"
      ? state.pushChanges(root, pushInput)
      : { paths: state.changedPaths(root, localBase), bases: [localBase] };
  const sourceTree = freezeTree
    ? buildVerificationTree(root, "HEAD").headTree
    : undefined;
  const getChangedLines = (file) =>
    bases.flatMap((base) => state.changedLines(root, file, base, sourceTree));
  const isNewPath = (file) =>
    bases.length === 0 ||
    bases.some((base) => {
      try {
        state.git(root, ["cat-file", "-e", `${base}:${file}`]);
        return false;
      } catch {
        return true;
      }
    });
  const ids = selectGates(
    profile,
    changed,
    getChangedLines,
    isNewPath,
    scenarioFiles
  );
  const fuzzRequired =
    profile === "merge"
      ? requiresMergeFuzz(changed, getChangedLines, isNewPath)
      : undefined;
  return { changed, ids, bases, sourceTree, fuzzRequired };
}
function verificationSnapshot(
  root,
  profile,
  reuse,
  pushInput,
  scenarioFiles = []
) {
  const { changed, ids, bases, sourceTree, fuzzRequired } =
    verificationSelection(root, profile, pushInput, true, scenarioFiles);
  const fingerprint = verificationFingerprint(root);
  const gateInputs = gateInputFingerprints(root);
  const diffBases = [
    ...new Set(
      bases.map((base) =>
        state.git(root, ["rev-parse", `${base}^{commit}`]).trim()
      )
    ),
  ].sort();
  return {
    ids,
    changed,
    bases,
    diffBases,
    fingerprint,
    gateInputs,
    followupFingerprint: state.followupFingerprint(root, {
      extraFiles: auditInputFiles(root),
    }),
    sourceTree,
    fuzzRequired,
    cached: reusableGates(
      root,
      fingerprint,
      gateInputs,
      profile,
      reuse,
      changed,
      diffBases
    ),
  };
}

export async function runGates({
  root = process.cwd(),
  profile = "full",
  reuse = false,
  extra = [],
  plan = false,
  pushInput,
} = {}) {
  if (["unit", "dialogue"].includes(profile))
    extra = unitTestFiles(root, extra);
  if (
    !["test", "unit", "dialogue", "scenario"].includes(profile) &&
    extra.length > 0
  ) {
    throw new Error(
      "Only the test profile accepts arbitrary Vitest arguments; test:unit and verify:dialogue accept explicit files; completion gates select their own scope"
    );
  }
  if (pushInput !== undefined && profile !== "push")
    throw new Error("Pre-push refs are only valid for the push profile");
  let { changed, ids, fuzzRequired } = verificationSelection(
    root,
    profile,
    pushInput,
    false,
    profile === "scenario" ? extra : []
  );
  if (plan) {
    console.log(
      JSON.stringify(
        {
          profile,
          changed,
          gates: ids,
          ...(profile === "merge" ? { fuzzRequired } : {}),
        },
        null,
        2
      )
    );
    return;
  }
  const candidate = verificationSnapshot(
    root,
    profile,
    reuse,
    pushInput,
    profile === "scenario" ? extra : []
  );
  const cachedOnly = candidate.ids.every((id) => candidate.cached.has(id));
  const requestKey = JSON.stringify(["gates", profile, extra]);
  const requestInput = JSON.stringify([
    // Delivery/launcher metadata changes when a frozen publication resumes.
    // Only admission uses this stable identity; evidence and the post-wait
    // comparison retain the strict verification fingerprint below.
    candidate.followupFingerprint,
    candidate.diffBases,
    candidate.changed,
  ]);
  // Reading matching evidence does not contend with CPU-heavy verification.
  // The final fingerprint check still rejects edits made during this path.
  const requestedAt = Date.now();
  let release;
  try {
    if (cachedOnly) await discardGateRetry(root, { requestKey, requestInput });
    release = cachedOnly
      ? () => {}
      : await acquireGateLease(root, { requestKey, requestInput });
  } catch (error) {
    const finishedAt = Date.now();
    const blocked = {
      schemaVersion: 2,
      profile,
      root,
      requestedAt,
      startedAt: requestedAt,
      finishedAt,
      leaseWaitMs: finishedAt - requestedAt,
      durationMs: 0,
      status: "failed",
      gates: [],
      vitestArgs: profile === "scenario" ? [] : [...extra],
      ...(profile === "scenario" ? { playwrightFiles: [...extra] } : {}),
      error: error.message,
      failureCode: error.code || null,
      queueReceipt: error.receipt || null,
    };
    state.atomicJson(
      resolve(root, `logs/harness/runs/${requestedAt}-${profile}-blocked.json`),
      blocked
    );
    throw error;
  }
  const leaseWaitMs = cachedOnly ? 0 : Date.now() - requestedAt;
  try {
    if (["unit", "dialogue"].includes(profile)) unitTestFiles(root, extra);
    const snapshot = cachedOnly
      ? candidate
      : verificationSnapshot(
          root,
          profile,
          reuse,
          pushInput,
          profile === "scenario" ? extra : []
        );
    const { fingerprint, cached: cachedGates } = snapshot;
    ids = snapshot.ids;
    const startedAt = Date.now();
    const file = resolve(root, "logs/harness/latest.json");
    const runFile = resolve(
      root,
      `logs/harness/runs/${startedAt}-${process.pid}.json`
    );
    const persist = () => {
      state.atomicJson(file, report);
      state.atomicJson(runFile, report);
    };
    const report = {
      schemaVersion: 2,
      profile,
      root,
      startedAt,
      requestedAt,
      leaseWaitMs,
      queueReceipt: release.receipt || null,
      fingerprint,
      gateInputs: snapshot.gateInputs,
      followupFingerprint: snapshot.followupFingerprint,
      sourceTree: snapshot.sourceTree,
      selectedGates: [...ids],
      changed: snapshot.changed,
      diffBases: snapshot.diffBases,
      vitestArgs: profile === "scenario" ? [] : [...extra],
      ...(profile === "scenario" ? { playwrightFiles: [...extra] } : {}),
      completionGate: ![
        "test",
        "unit",
        "dialogue",
        "scenario",
        "local-game",
        "public-build",
      ].includes(profile),
      ...(profile === "merge" ? { fuzzRequired: snapshot.fuzzRequired } : {}),
      status: "running",
      gates: [],
    };
    persist();
    try {
      if (
        snapshot.fingerprint !== candidate.fingerprint ||
        JSON.stringify(snapshot.diffBases) !==
          JSON.stringify(candidate.diffBases) ||
        JSON.stringify(snapshot.changed) !== JSON.stringify(candidate.changed)
      )
        throw new Error(
          "Source or verification scope changed while queued; submit a new request"
        );
      report.workRecovery = checkpointWorkerBoundary(
        root,
        "gate-started",
        snapshot.sourceTree
      );
      persist();
      for (const id of ids) {
        const gate = gates[id],
          start = Date.now();
        let execution;
        const cached = cachedGates.has(id);
        const outputLog = resolve(
          root,
          `logs/harness/output/${startedAt}-${process.pid}-${id}.log`
        );
        const testKind =
          gate.node === "scripts/vitest-with-jest-aliases.mjs" ||
          (["unit", "dialogue"].includes(profile) && id === "vitest")
            ? "vitest"
            : gate.bin === "playwright" ||
                gate.node?.includes("@playwright/test/cli.js")
              ? "playwright"
              : null;
        const testResults = testKind
          ? {
              kind: testKind,
              path: resolve(
                root,
                `logs/harness/output/${startedAt}-${process.pid}-${id}-tests.json`
              ),
            }
          : null;
        report.currentGate = id;
        report.outputLog = cached ? null : outputLog;
        persist();
        if (cached) {
          console.log("[verify] " + id + ": reusing matching gate input check");
        } else {
          console.log("\n[verify] " + id);
          const args = [
            ...(gate.args || []),
            ...(gate.changedFiles ? snapshot.changed : []),
            ...(gate.diffBase
              ? snapshot.diffBases.flatMap((base) => ["--base", base])
              : []),
            ...(id === "vitest" ? extra : []),
            ...(["unit", "dialogue"].includes(profile) && id === "vitest"
              ? [
                  "--config",
                  resolve(root, "scripts/harness/vitest-unit.config.mjs"),
                ]
              : []),
            ...(testKind === "vitest"
              ? [
                  "--reporter=default",
                  "--reporter=./scripts/harness/vitest-acceptance-reporter.mjs",
                  ...(process.env.VITEST_HANGING_PROCESS_REPORTER === "1"
                    ? ["--reporter=hanging-process"]
                    : []),
                  "--outputFile",
                  testResults.path,
                ]
              : []),
            ...(testKind === "playwright" ? ["--reporter=list,json"] : []),
          ];
          const command = gate.node
            ? process.execPath
            : process.platform === "win32"
              ? "cmd.exe"
              : "pnpm";
          const commandArgs = gate.node
            ? [resolve(root, gate.node), ...args]
            : [
                ...(process.platform === "win32"
                  ? ["/d", "/s", "/c", "pnpm"]
                  : []),
                ...(gate.bin ? ["exec", gate.bin] : ["run", gate.script]),
                ...args,
              ];
          execution = { command, argv: commandArgs, startedAt: start };
          const exitCode = await new Promise((resolveExit, reject) => {
            mkdirSync(resolve(root, "logs/harness/output"), {
              recursive: true,
            });
            const fd = openSync(outputLog, "w");
            const child = spawn(command, commandArgs, {
              cwd: root,
              env: {
                ...gateEnvironment(root),
                ORICA_UNIT_TEST_FILES: ["unit", "dialogue"].includes(profile)
                  ? JSON.stringify(extra)
                  : undefined,
                ...(testKind === "playwright"
                  ? { PLAYWRIGHT_JSON_OUTPUT_FILE: testResults.path }
                  : {}),
              },
              stdio: ["inherit", "pipe", "pipe"],
              windowsHide: true,
              shell: false,
            });
            let spawnError;
            for (const [stream, target] of [
              [child.stdout, process.stdout],
              [child.stderr, process.stderr],
            ])
              stream.on("data", (bytes) => {
                writeSync(fd, bytes);
                target.write(bytes);
              });
            child.on("error", (error) => {
              spawnError = error;
            });
            child.on("close", (code, signal) => {
              closeSync(fd);
              if (spawnError) reject(spawnError);
              else resolveExit(signal ? 1 : (code ?? 1));
            });
          })
            .then((code) => {
              if (
                code === 0 &&
                ["unit", "dialogue"].includes(profile) &&
                id === "vitest"
              )
                assertUnitTestResults(root, extra, testResults.path);
              return code;
            })
            .catch((error) => {
              report.gates.push({
                id,
                ...execution,
                finishedAt: Date.now(),
                status: "failed",
                error: error.message,
                outputLog,
                durationMs: Date.now() - start,
              });
              throw error;
            });
          if (exitCode !== 0) {
            report.gates.push({
              id,
              ...execution,
              finishedAt: Date.now(),
              status: "failed",
              exitCode,
              outputLog,
              durationMs: Date.now() - start,
            });
            throw new Error(id + " failed (exit " + exitCode + ")");
          }
        }
        report.gates.push({
          id,
          ...(!cached
            ? { ...execution, finishedAt: Date.now(), exitCode: 0 }
            : {}),
          status: "passed",
          reused: !!cached,
          ...(!cached ? { outputLog } : {}),
          ...(!cached && testResults ? { testResults } : {}),
          ...(cached ? { sourceRun: cachedGates.get(id) } : {}),
          durationMs: Date.now() - start,
        });
        persist();
      }
      if (
        verificationFingerprint(root) !== fingerprint ||
        buildVerificationTree(root, "HEAD").headTree !== snapshot.sourceTree
      )
        throw new Error(
          "Source changed during verification; rerun the required gates"
        );
      report.status = "passed";
    } catch (error) {
      report.status = "failed";
      report.error = error.message;
      throw error;
    } finally {
      report.finishedAt = Date.now();
      report.durationMs = report.finishedAt - startedAt;
      report.currentGate = null;
      persist();
      console.log(
        "[verify] " +
          report.status +
          " in " +
          (report.durationMs / 1000).toFixed(1) +
          "s; " +
          file
      );
    }
  } finally {
    release();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--profile");
  const profile = index < 0 ? "full" : args[index + 1];
  const extra = args
    .slice(index < 0 ? 0 : index + 2)
    .filter((arg) => !["--reuse", "--plan", "--hook", "--"].includes(arg));
  runGates({
    profile,
    reuse: args.includes("--reuse"),
    plan: args.includes("--plan"),
    extra,
    pushInput: args.includes("--hook") ? readFileSync(0, "utf8") : undefined,
  }).catch((error) => {
    console.error("[verify] " + error.message);
    process.exitCode = leaseFailureExit(error);
  });
}
