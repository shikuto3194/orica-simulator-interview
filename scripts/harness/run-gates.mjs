import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  existsSync,
} from "node:fs";
import { dirname, relative, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gates,
  failedGateAliases,
  gateNeedsBrowser,
  mergeFuzzRequired,
  selectGatePlan,
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
import {
  semanticScope,
  assertCompleteFocusedResults,
} from "./semantic-scope.mjs";
import { focusedInputs } from "./focused-inputs.mjs";
import { classificationFindings } from "./path-classification.mjs";
import { enqueueFindings } from "./unclassified-queue.mjs";

// Temporary candidate worktrees are removed after publication, taking their
// run reports with them. Keep a compact per-gate timing record in the primary
// checkout (the parent of the shared git directory) so slow runs can be
// analysed afterwards. Best effort only: it must never change a verification
// result.
export function archiveRunTiming(root, report) {
  try {
    const common = state
      .git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
      .trim();
    const primary = dirname(resolve(common));
    const directory = resolve(primary, "logs/harness/timing");
    mkdirSync(directory, { recursive: true });
    state.atomicJson(
      resolve(directory, `${report.startedAt}-${process.pid}.json`),
      {
        schemaVersion: 1,
        profile: report.profile,
        status: report.status,
        root: report.root,
        sourceTree: report.sourceTree ?? null,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        durationMs: report.durationMs,
        leaseWaitMs: report.leaseWaitMs ?? null,
        selectedGates: report.selectedGates ?? null,
        gates: (report.gates ?? []).map((gate) => ({
          id: gate.id,
          status: gate.status,
          reused: gate.reused === true,
          durationMs: gate.durationMs ?? null,
        })),
      }
    );
  } catch {
    // Timing history is observability, not part of the verification contract.
  }
}

function verificationFingerprint(root) {
  return state.sourceFingerprint(root, { extraFiles: auditInputFiles(root) });
}

// These two suites run game-independent fixtures, never the checked-out game.
// The known game source/test namespace and audit outputs are not fixture inputs.
// Keep every other path/mode/content, scripts, configuration, dependencies,
// external inputs and environment bound; unknown inputs always invalidate.
// Runtime ISMCTS tests execute the actual game and MUST NOT use this scope.
export function gateInputFingerprints(root, scope) {
  const result = {};
  let operations;
  for (const [id, gate] of Object.entries(gates)) {
    if (gate.inputScope === "focused-imports-v1") {
      const inputs = focusedInputs(root, scope.tests);
      const auditFiles = auditInputFiles(root);
      const auditPaths = new Set(auditFiles.map((file) => resolve(root, file)));
      if (inputs)
        result[id] = state.sourceFingerprint(root, {
          extraFiles: auditFiles,
          excludeFile: (file) => {
            const ref = relative(root, resolve(root, file)).replaceAll(
              "\\",
              "/"
            );
            // Keep unknown/configuration/environment/audit inputs. Exclude only
            // unimported TS application modules; shared loaders/config remain.
            return (
              !auditPaths.has(resolve(root, file)) &&
              /^(?:packages|apps)\/.*\.(?:ts|tsx)$/.test(ref) &&
              !inputs.has(ref)
            );
          },
        });
      continue;
    }
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

// Git for Windows exposes `cmd\git.exe`, a launcher that starts `mingw64\bin\git.exe`
// on every call. Gates spawn git thousands of times, and a PowerShell-started
// run (as auto-merge does) resolves the launcher first, so test:harness took
// ~65 s longer than from Git Bash. Putting the real binary first changes only
// which executable of the same Git installation is started.
export function preferNativeGit(env, execPath, platform = process.platform) {
  if (platform !== "win32" || !execPath) return env;
  const native = resolve(execPath, "..", "..", "bin");
  if (!existsSync(join(native, "git.exe"))) return env;
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const entries = (key ? env[key] : "").split(";").filter(Boolean);
  if (entries[0]?.toLowerCase() === native.toLowerCase()) return env;
  return { ...env, [key ?? "PATH"]: [native, ...entries].join(";") };
}

function gateEnvironment(root) {
  // Git hooks export repository selectors. A gate may create a foreign test
  // repository, so inheriting them can mutate the real checkout's Git config.
  const localNames = new Set(
    state.git(root, ["rev-parse", "--local-env-vars"]).trim().split(/\r?\n/)
  );
  return preferNativeGit(
    Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !localNames.has(name.toUpperCase())
      )
    ),
    state.git(root, ["--exec-path"]).trim()
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

export function reusableGates(
  root,
  fingerprint,
  gateInputs,
  profile,
  reuse,
  changed,
  diffBases,
  currentScope = { tests: [] }
) {
  if (
    !reuse ||
    process.env.CI ||
    !["finish", "push", "merge"].includes(profile)
  )
    return new Map();
  return matchingGateEvidence(
    root,
    fingerprint,
    gateInputs,
    changed,
    diffBases,
    currentScope
  );
}

function ledgerMainBase(root) {
  try {
    return state.git(root, ["rev-parse", "--verify", "main^{commit}"]).trim();
  } catch {
    return null;
  }
}

function matchingGateEvidence(
  root,
  fingerprint,
  gateInputs,
  changed,
  diffBases,
  currentScope,
  ledgerBase = null
) {
  const result = new Map();
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
        ? failedGateAliases(gate.id).map((id) => ({
            ...gate,
            id,
            failureSource: gate.id,
          }))
        : [gate]
    )) {
      const failedFiles =
        gate?.failureSource === "focused-vitest"
          ? report.focusedTests
          : gates[gate?.failureSource]?.args?.filter((file) =>
              file.endsWith(".test.ts")
            );
      const overlappingFailure =
        gate?.status === "failed" &&
        gate.id === "focused-vitest" &&
        (gate.failureSource === "vitest" ||
          !failedFiles?.length ||
          failedFiles.some((file) => currentScope.tests.includes(file)));
      if (
        !gate ||
        !Object.hasOwn(gates, gate.id) ||
        observed.has(gate.id) ||
        (gates[gate.id].reusable === false &&
          !(
            gate.id === "ledger" &&
            ledgerBase &&
            (gate.status === "failed" || gate.ledgerBase === ledgerBase)
          )) ||
        (!overlappingFailure &&
          !state.gateInputsMatch(
            report,
            { fingerprint, gateInputs },
            gate.id,
            gates[gate.id].inputScope
          ))
      )
        continue;
      if (gate.status === "failed") {
        // A newer failure must never be hidden by an older success.
        observed.add(gate.id);
      } else if (
        (report.status === "passed" ||
          (report.status === "failed" &&
            report.inputsStable === true &&
            isReusableCompletionReport(report))) &&
        // Only complete, exact test/browser runs provide per-gate evidence.
        // Unit/dialogue still only invalidate old passes, never satisfy one.
        (isReusableCompletionReport(report) ||
          hasReusableTestGateEvidence(report, gate.id, root) ||
          hasReusableBrowserProfileEvidence(report, gate.id)) &&
        gate.status === "passed" &&
        gate.reused === false &&
        (gate.id !== "vitest" || report.vitestArgs.length === 0) &&
        (gate.id !== "focused-vitest" ||
          JSON.stringify(report.focusedTests) ===
            JSON.stringify(currentScope.tests)) &&
        (gate.id !== "static-reduction" ||
          JSON.stringify(report.staticCards) ===
            JSON.stringify(currentScope.cards)) &&
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
  scenarioFiles = [],
  forceFull = false
) {
  // Freeze symbolic refs before selecting the diff. Committing identical bytes
  // during a gate must not silently shrink the batch subsequently checked.
  const ciBase = profile === "ci" ? process.env.ORICA_VERIFY_BASE : null;
  let localBase;
  let baseProblem;
  if (profile !== "push") {
    try {
      if (profile === "ci" && !/^[0-9a-f]{40,64}$/.test(ciBase ?? ""))
        throw new Error(
          "CI requires the event base commit in ORICA_VERIFY_BASE"
        );
      localBase = state
        .git(root, [
          "rev-parse",
          `${ciBase || (profile === "merge" ? "main" : "HEAD")}^{commit}`,
        ])
        .trim();
    } catch (error) {
      baseProblem = error.message;
    }
  }
  const { paths: changed, bases } =
    profile === "push"
      ? state.pushChanges(root, pushInput)
      : localBase
        ? { paths: state.changedPaths(root, localBase), bases: [localBase] }
        : { paths: null, bases: [] };
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
  const scope = ["finish", "push", "merge", "ci"].includes(profile)
    ? semanticScope(root, changed, bases)
    : { overrides: {}, tests: [], cards: [] };
  const { ids, fullSelectionReason, decisions, unresolved } = selectGatePlan(
    profile,
    changed,
    getChangedLines,
    isNewPath,
    scenarioFiles,
    scope.overrides,
    scope.tests,
    scope.reasons,
    forceFull
  );
  if (baseProblem && unresolved.length) unresolved[0].reason = baseProblem;
  const fuzzRequired =
    profile === "merge"
      ? mergeFuzzRequired(changed, scope.overrides, getChangedLines, isNewPath)
      : undefined;
  const classification = ["finish", "push", "merge", "ci"].includes(profile)
    ? classificationFindings(changed, isNewPath, scope.overrides)
    : [];
  return {
    changed,
    ids,
    bases,
    sourceTree,
    fuzzRequired,
    scope,
    classification,
    fullSelectionReason,
    decisions,
    unresolved,
  };
}

/** Report inputs still awaiting a reviewed scope. */
export function reportClassification(root, findings) {
  if (findings.length === 0) return [];
  for (const finding of findings)
    console.error(
      `UNCLASSIFIED: ${finding.file} (${finding.reason}) -- identify affected consumers and register their checks`
    );
  try {
    enqueueFindings(root, findings);
  } catch (error) {
    // The queue is a notification; it must never fail or change a verification.
    console.error(`[classification] queue write failed: ${error.message}`);
  }
  return findings;
}
function verificationInputs(root, scope, bases) {
  // The same digest as verificationFingerprint(); components and environment key
  // names (never values) are recorded so a reuse miss can be attributed.
  const fingerprintDetails = state.sourceFingerprintDetails(root, {
    extraFiles: auditInputFiles(root),
  });
  const fingerprint = fingerprintDetails.fingerprint;
  const gateInputs = gateInputFingerprints(root, scope);
  const diffBases = [
    ...new Set(
      bases.map((base) =>
        state.git(root, ["rev-parse", `${base}^{commit}`]).trim()
      )
    ),
  ].sort();
  return {
    diffBases,
    fingerprint,
    fingerprintComponents: fingerprintDetails.components,
    fingerprintEnvironmentKeys: fingerprintDetails.environmentKeys,
    gateInputs,
  };
}

function verificationSnapshot(
  root,
  profile,
  reuse,
  pushInput,
  scenarioFiles = [],
  forceFull = false
) {
  const { changed, ids, bases, sourceTree, fuzzRequired, scope, unresolved } =
    verificationSelection(
      root,
      profile,
      pushInput,
      true,
      scenarioFiles,
      forceFull
    );
  assertResolved(unresolved);
  const inputs = verificationInputs(root, scope, bases);
  return {
    ids,
    changed,
    bases,
    ...inputs,
    followupFingerprint: state.followupFingerprint(root, {
      extraFiles: auditInputFiles(root),
    }),
    sourceTree,
    fuzzRequired,
    scope,
    cached: reusableGates(
      root,
      inputs.fingerprint,
      inputs.gateInputs,
      profile,
      reuse,
      changed,
      inputs.diffBases,
      scope
    ),
  };
}

function assertResolved(unresolved) {
  if (unresolved.length)
    throw new Error(
      unresolved
        .map(({ file, reason }) => `${file ?? "Diff base"}: ${reason}`)
        .join("\n")
    );
}

export async function runGates({
  root = process.cwd(),
  profile = "full",
  reuse = false,
  extra = [],
  plan = false,
  pushInput,
  forceFull = false,
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
  let {
    changed,
    ids,
    bases,
    fuzzRequired,
    scope,
    classification,
    fullSelectionReason,
    decisions,
    unresolved,
  } = verificationSelection(
    root,
    profile,
    pushInput,
    false,
    profile === "scenario" ? extra : [],
    forceFull
  );
  if (plan) {
    let evidence;
    if (
      !process.env.CI &&
      ["finish", "full", "push", "merge"].includes(profile)
    ) {
      let matches = new Map();
      if (ids.length) {
        const inputs = verificationInputs(root, scope, bases);
        matches = matchingGateEvidence(
          root,
          inputs.fingerprint,
          inputs.gateInputs,
          changed,
          inputs.diffBases,
          scope,
          ids.includes("ledger") ? ledgerMainBase(root) : null
        );
      }
      evidence = {
        passed: ids.filter((id) => matches.has(id)),
        missing: ids.filter((id) => !matches.has(id)),
      };
    }
    const result = {
      profile,
      changed,
      gates: ids,
      classification,
      fullSelectionReason,
      decisions,
      unresolved,
      bases,
      ...(changed?.length === 0 && {
        emptyDiff: bases.length
          ? "No changes against the resolved base"
          : "No pushed source refs",
      }),
      ...(evidence && { evidence }),
      focusedTests: scope.tests,
      staticCards: scope.cards,
      semanticOverrides: scope.overrides,
      needsBrowser: ids.some((id) => gateNeedsBrowser(gates[id])),
      ...(profile === "merge" ? { fuzzRequired } : {}),
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  reportClassification(root, classification);
  assertResolved(unresolved);
  const candidate = verificationSnapshot(
    root,
    profile,
    reuse,
    pushInput,
    profile === "scenario" ? extra : [],
    forceFull
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
          profile === "scenario" ? extra : [],
          forceFull
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
      fingerprintComponents: snapshot.fingerprintComponents,
      fingerprintEnvironmentKeys: snapshot.fingerprintEnvironmentKeys,
      gateInputs: snapshot.gateInputs,
      followupFingerprint: snapshot.followupFingerprint,
      sourceTree: snapshot.sourceTree,
      selectedGates: [...ids],
      ...(forceFull && { forceFull }),
      selectionVersion: 2,
      focusedTests: snapshot.scope.tests,
      staticCards: snapshot.scope.cards,
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
        // The ledger reads main independently of the runner's diff base.
        const ledgerBase = id === "ledger" ? ledgerMainBase(root) : null;
        const outputLog = resolve(
          root,
          `logs/harness/output/${startedAt}-${process.pid}-${id}.log`
        );
        const testKind =
          gate.node === "scripts/vitest-with-jest-aliases.mjs" ||
          id === "focused-vitest" ||
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
            ...(id === "vitest"
              ? extra
              : id === "focused-vitest"
                ? snapshot.scope.tests
                : []),
            ...((["unit", "dialogue"].includes(profile) && id === "vitest") ||
            id === "focused-vitest"
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
                ORICA_STATIC_CARDS: JSON.stringify(snapshot.scope.cards),
                ORICA_UNIT_TEST_FILES:
                  id === "focused-vitest"
                    ? JSON.stringify(snapshot.scope.tests)
                    : ["unit", "dialogue"].includes(profile)
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
              if (code === 0 && id === "focused-vitest")
                assertCompleteFocusedResults(
                  root,
                  snapshot.scope.tests,
                  state.readJson(testResults.path)
                );
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
          ...(ledgerBase && ledgerBase === ledgerMainBase(root)
            ? { ledgerBase }
            : {}),
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
      report.inputsStable = true;
    } catch (error) {
      report.status = "failed";
      report.error = error.message;
      // A failed later check does not invalidate an earlier check on identical
      // inputs. A crash or source mutation cannot produce this attestation.
      try {
        report.inputsStable =
          verificationFingerprint(root) === fingerprint &&
          buildVerificationTree(root, "HEAD").headTree === snapshot.sourceTree;
      } catch {
        report.inputsStable = false;
      }
      throw error;
    } finally {
      report.finishedAt = Date.now();
      report.durationMs = report.finishedAt - startedAt;
      report.currentGate = null;
      persist();
      archiveRunTiming(root, report);
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
    .filter(
      (arg) => !["--reuse", "--plan", "--hook", "--full", "--"].includes(arg)
    );
  runGates({
    profile,
    reuse: args.includes("--reuse"),
    plan: args.includes("--plan"),
    forceFull: args.includes("--full"),
    extra,
    pushInput: args.includes("--hook") ? readFileSync(0, "utf8") : undefined,
  }).catch((error) => {
    console.error("[verify] " + error.message);
    process.exitCode = leaseFailureExit(error);
  });
}
