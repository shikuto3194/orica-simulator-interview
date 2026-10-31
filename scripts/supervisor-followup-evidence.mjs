// Acceptance evidence belongs to the existing follow-up queue. It does not
// infer equivalent requirements from prose, execute tests, or change Git refs.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import state from "./harness/verification-state.cjs";
import { gates } from "./harness/gate-manifest.mjs";
import { auditInputFiles } from "./audit-inputs.mjs";
import {
  followupDigest,
  listPendingFollowups,
  resolveFollowup,
} from "./supervisor-followup.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const nonempty = (value) => typeof value === "string" && value.trim();
const commitId = /^[0-9a-f]{40}$/;
const acceptanceDir = (repo) =>
  join(repo, "logs/codex-supervisor-followups/acceptance");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: "pipe",
    timeout: 40_000,
  }).trim();
}

function within(root, file) {
  const full = realpathSync(resolve(root, file));
  const rel = relative(realpathSync(root), full);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Acceptance evidence leaves its checkout");
  return full;
}

function fingerprint(root) {
  return state.followupFingerprint(root, { extraFiles: auditInputFiles(root) });
}

function snapshot(root) {
  if (git(root, ["status", "--porcelain"]))
    throw new Error("Acceptance requires a clean, committed checkout");
  return {
    root: realpathSync(root),
    head: git(root, ["rev-parse", "HEAD"]),
    sourceTree: git(root, ["rev-parse", "HEAD^{tree}"]),
    fingerprint: fingerprint(root),
  };
}

function assertStable(root, before) {
  if (JSON.stringify(snapshot(root)) !== JSON.stringify(before))
    throw new Error("Checkout changed while checking acceptance evidence");
}

function requestIdentity(repo, item) {
  if (item.incidentKey)
    throw new Error("Live incidents require their own recovery probe");
  const directory = join(repo, "logs/codex-telegram-inbox/reception-results");
  const receipts = [];
  for (const name of existsSync(directory)
    ? readdirSync(directory).sort()
    : []) {
    if (!/^\d+(?:-(?:force|instruction))?\.json$/.test(name)) continue;
    const receipt = read(join(directory, name));
    if (receipt.handoffId !== item.id) continue;
    if (receipt.status !== "completed" || !nonempty(receipt.result?.handoff))
      throw new Error(`Incomplete reception for ${item.id}`);
    for (const attachment of receipt.item?.attachments || []) {
      if (
        !nonempty(attachment.path) ||
        !/^[a-f0-9]{64}$/.test(attachment.sha256 || "") ||
        sha(readFileSync(attachment.path)) !== attachment.sha256
      )
        throw new Error(
          `Attachment evidence missing or changed for ${item.id}`
        );
    }
    // Re-waking the supervisor changes no user requirement. Retain all other
    // receipt fields, including unknown fields, conservatively.
    const requirements = { ...receipt };
    delete requirements.supervisorRequest;
    receipts.push({ name, sha256: followupDigest(requirements) });
  }
  if (item.kind === "instruction" && !receipts.length)
    throw new Error(`No completed reception for instruction ${item.id}`);
  return followupDigest({ item, receipts });
}

function conditionsValid(conditions) {
  if (!Array.isArray(conditions) || !conditions.length)
    throw new Error("Acceptance requires explicit conditions and coverage");
  for (const condition of conditions) {
    if (
      !nonempty(condition.requirement) ||
      !Array.isArray(condition.coverage) ||
      !condition.coverage.length
    )
      throw new Error("Every acceptance condition needs test coverage");
    for (const coverage of condition.coverage) {
      const gate = gates[coverage.gate];
      // Diff-scoped checks and inherently fresh checks cannot certify a whole
      // requirement for a later run with a different comparison base.
      if (
        !gate ||
        gate.changedFiles ||
        gate.diffBase ||
        gate.reusable === false ||
        !nonempty(coverage.assertion) ||
        !nonempty(coverage.testFile)
      )
        throw new Error("Unsupported gate or missing coverage assertion");
    }
  }
}

function reports(root) {
  const directory = join(root, "logs/harness/runs");
  return (existsSync(directory) ? readdirSync(directory).sort() : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      path: `logs/harness/runs/${name}`,
      value: read(join(directory, name)),
    }));
}

function validateGate(report, gate, current) {
  const result = report.gates?.find((entry) => entry.id === gate);
  if (
    report.schemaVersion !== 2 ||
    report.status !== "passed" ||
    report.followupFingerprint !== current.fingerprint ||
    report.sourceTree !== current.sourceTree ||
    realpathSync(report.root) !== current.root ||
    !Array.isArray(report.vitestArgs) ||
    !Number.isFinite(report.startedAt) ||
    !Number.isFinite(report.finishedAt) ||
    report.finishedAt < report.startedAt ||
    report.finishedAt > Date.now() ||
    result?.status !== "passed" ||
    result.reused !== false ||
    result.exitCode !== 0 ||
    !nonempty(result.outputLog)
  )
    throw new Error(`Missing fresh successful evidence for gate ${gate}`);
  return result;
}

function gateProof(root, current, history, gate, expected, conditions = []) {
  const candidates = history
    .filter(
      ({ value }) =>
        value.followupFingerprint === current.fingerprint &&
        value.gates?.some((entry) => entry.id === gate)
    )
    .sort((a, b) => b.value.finishedAt - a.value.finishedAt);
  let coverageError;
  const selected = expected
    ? history.find((r) => r.path === expected.report)
    : candidates.find((candidate) => {
        try {
          validateGate(candidate.value, gate, current);
        } catch {
          return false;
        }
        try {
          const proof = makeGateProof(root, candidate, gate);
          assertCoverage(root, conditions, [proof]);
          return true;
        } catch (error) {
          coverageError = error;
          return false;
        }
      });
  if (!selected)
    throw coverageError || new Error(`No reusable evidence for gate ${gate}`);
  validateGate(selected.value, gate, current);
  for (const { value } of history) {
    if (
      value.followupFingerprint !== current.fingerprint ||
      value.startedAt < selected.value.startedAt
    )
      continue;
    const later = value.gates?.find((entry) => entry.id === gate);
    if (
      later?.status === "failed" ||
      (value.status !== "passed" && (later || value.currentGate === gate))
    )
      throw new Error(`Later failed or incomplete validation for gate ${gate}`);
  }
  const proof = makeGateProof(root, selected, gate);
  if (expected && JSON.stringify(proof) !== JSON.stringify(expected))
    throw new Error(`Validation evidence changed for gate ${gate}`);
  return proof;
}

function makeGateProof(root, selected, gate) {
  const result = selected.value.gates.find((entry) => entry.id === gate);
  return {
    gate,
    report: selected.path,
    reportSha256: sha(readFileSync(within(root, selected.path))),
    output: relative(root, within(root, result.outputLog)).split(sep).join("/"),
    outputSha256: sha(readFileSync(within(root, result.outputLog))),
    ...(result.testResults
      ? {
          tests: {
            kind: result.testResults.kind,
            path: relative(root, within(root, result.testResults.path))
              .split(sep)
              .join("/"),
            sha256: sha(readFileSync(within(root, result.testResults.path))),
          },
        }
      : {}),
  };
}

export function passedAcceptanceTest(root, report, coverage, kind) {
  if (
    !Array.isArray(coverage.titlePath) ||
    !coverage.titlePath.length ||
    coverage.titlePath.at(-1) !== coverage.assertion ||
    coverage.titlePath.some((title) => !nonempty(title))
  )
    return false;
  const target = resolve(root, coverage.testFile);
  const matches = [];
  if (kind === "vitest") {
    if (report.success !== true || !Array.isArray(report.testResults))
      return false;
    for (const file of report.testResults) {
      if (
        resolve(root, file.name || "") !== target ||
        !Array.isArray(file.assertionResults)
      )
        continue;
      for (const test of file.assertionResults) {
        if (!Array.isArray(test.ancestorTitles)) continue;
        if (
          JSON.stringify([...test.ancestorTitles, test.title]) ===
          JSON.stringify(coverage.titlePath)
        )
          matches.push(
            test.status === "passed" &&
              file.status === "passed" &&
              test.retryCount === 0
          );
      }
    }
  } else if (kind === "playwright") {
    if (
      !nonempty(coverage.project) ||
      !Array.isArray(report.suites) ||
      report.errors?.length
    )
      return false;
    if (!nonempty(report.config?.rootDir)) return false;
    const reportRoot = resolve(report.config.rootDir);
    const relRoot = relative(root, reportRoot);
    if (
      isAbsolute(relRoot) ||
      relRoot === ".." ||
      relRoot.startsWith(`..${sep}`)
    )
      return false;
    const visit = (suites, ancestors = [], fileLevel = false) => {
      for (const suite of suites) {
        const titles = fileLevel ? ancestors : [...ancestors, suite.title];
        for (const spec of suite.specs || []) {
          if (
            resolve(reportRoot, spec.file || "") !== target ||
            JSON.stringify([...titles, spec.title]) !==
              JSON.stringify(coverage.titlePath)
          )
            continue;
          for (const test of spec.tests || [])
            if (test.projectName === coverage.project)
              matches.push(
                spec.ok === true &&
                  test.expectedStatus === "passed" &&
                  test.status === "expected" &&
                  test.results?.length > 0 &&
                  test.results.every((result) => result.status === "passed")
              );
        }
        visit(suite.suites || [], titles);
      }
    };
    visit(report.suites, [], true);
  }
  return matches.length === 1 && matches[0] === true;
}

function assertCoverage(root, conditions, evidence) {
  const packageJson = read(join(root, "package.json"));
  for (const condition of conditions)
    for (const coverage of condition.coverage) {
      const file = within(root, coverage.testFile);
      const path = relative(root, file).split(sep).join("/");
      git(root, ["ls-files", "--error-unmatch", "--", path]);
      const gate = gates[coverage.gate];
      const namedReport =
        gate.node === "scripts/vitest-with-jest-aliases.mjs" ||
        gate.bin === "playwright" ||
        gate.node?.includes("playwright");
      if (
        !/(?:^scripts\/test-[^/]+\.mjs$|\.(?:test|spec)\.[cm]?[jt]sx?$)/.test(
          path
        ) ||
        (!namedReport &&
          !readFileSync(file, "utf8").includes(coverage.assertion))
      )
        throw new Error(`Assertion is absent from a tracked test: ${path}`);
      const output = stripVTControlCharacters(
        readFileSync(
          within(root, evidence.find((p) => p.gate === coverage.gate).output),
          "utf8"
        )
      );
      // Framework reporters contain evaluated it.each/template titles. Their
      // exact file/titlePath/project, first-attempt success and source-bound
      // gate fingerprint witness the test; a literal-source substring cannot.
      // Operational suites retain the literal source/output/import checks.
      if (namedReport) {
        const tests = evidence.find((p) => p.gate === coverage.gate).tests;
        const kind =
          gate.node === "scripts/vitest-with-jest-aliases.mjs"
            ? "vitest"
            : "playwright";
        const passed =
          tests?.kind === kind &&
          passedAcceptanceTest(
            root,
            read(within(root, tests.path)),
            coverage,
            kind
          );
        if (!passed || (kind === "playwright" && !gate.args?.includes(path)))
          throw new Error(
            `No named passing execution for ${path}: ${coverage.assertion}`
          );
      } else {
        // Operational suites use explicit [test-*] passed summaries. Follow only
        // literal local script references from the registered gate entrypoint.
        const command = gate.script
          ? packageJson.scripts?.[gate.script] || ""
          : "";
        const queue = gate.node
          ? [gate.node]
          : [...command.matchAll(/\bnode\s+(scripts\/[\w./-]+\.mjs)\b/g)].map(
              (m) => m[1]
            );
        const visited = new Set();
        const tracked = new Set(
          git(root, ["ls-files", "-z"]).split("\0").filter(Boolean)
        );
        for (let i = 0; i < queue.length; i++) {
          const candidate = resolve(root, queue[i]);
          if (
            !tracked.has(relative(root, candidate).split(sep).join("/")) ||
            !existsSync(candidate)
          )
            continue;
          const entry = within(root, queue[i]);
          if (visited.has(entry)) continue;
          visited.add(entry);
          const text = readFileSync(entry, "utf8");
          for (const match of text.matchAll(/["'](\.\.?\/[\w./-]+\.mjs)["']/g))
            queue.push(resolve(dirname(entry), match[1]));
        }
        if (
          !visited.has(file) ||
          !/^\[test-[^\]]+\] passed:/.test(coverage.assertion) ||
          !output
            .split(/\r?\n/)
            .some((line) => line.trim() === coverage.assertion)
        )
          throw new Error(`No registered passing suite execution for ${path}`);
      }
    }
}

// The worker explicitly reviews each complete request and maps every condition
// to actual assertions. Identical evidence may support several IDs; their
// requirement identities remain separate and are never inferred from wording.
export function recordAcceptance({ repo, root, input }) {
  if (
    input?.schemaVersion !== 1 ||
    !Array.isArray(input.requests) ||
    !input.requests.length
  )
    throw new Error("Invalid acceptance request batch");
  const current = snapshot(root);
  const pending = new Map(
    listPendingFollowups({ repo, throwOnReadError: true }).map((item) => [
      item.id,
      item,
    ])
  );
  const history = reports(root);
  const seen = new Set();
  const records = input.requests.map((request) => {
    const item = pending.get(request.id);
    if (
      !item ||
      !/^followup-[a-f0-9]{20}$/.test(request.id) ||
      item.status !== "pending" ||
      seen.has(request.id) ||
      !nonempty(request.coverageReview) ||
      !commitId.test(request.fixCommit || "")
    )
      throw new Error(
        "Missing request, duplicate ID, fix commit or complete-request review"
      );
    seen.add(request.id);
    git(root, ["merge-base", "--is-ancestor", request.fixCommit, current.head]);
    conditionsValid(request.conditions);
    const ids = [
      ...new Set(
        request.conditions.flatMap((condition) =>
          condition.coverage.map((c) => c.gate)
        )
      ),
    ].sort();
    const evidence = ids.map((gate) =>
      gateProof(
        root,
        current,
        history,
        gate,
        undefined,
        request.conditions.map((condition) => ({
          ...condition,
          coverage: condition.coverage.filter((entry) => entry.gate === gate),
        }))
      )
    );
    assertCoverage(root, request.conditions, evidence);
    return {
      schemaVersion: 1,
      id: item.id,
      requestDigest: requestIdentity(repo, item),
      pendingDigest: followupDigest(item),
      fixCommit: request.fixCommit,
      coverageReview: request.coverageReview,
      conditions: request.conditions,
      validation: current,
      evidence,
      recordedAt: new Date().toISOString(),
    };
  });
  assertStable(root, current);
  for (const record of records)
    state.atomicJson(join(acceptanceDir(repo), `${record.id}.json`), {
      ...record,
      recordDigest: followupDigest(record),
    });
  return {
    schemaVersion: 1,
    recordedIds: records.map((record) => record.id),
    resolvedIds: [],
  };
}

export function reconcileAcceptance({ repo, root }) {
  const pending = listPendingFollowups({ repo, throwOnReadError: true });
  const candidates = pending.filter(
    (item) =>
      /^followup-[a-f0-9]{20}$/.test(item.id) &&
      existsSync(join(acceptanceDir(repo), `${item.id}.json`))
  );
  const result = {
    schemaVersion: 1,
    checked: candidates.length,
    resolvedIds: [],
    pending: [],
    validationRuns: 0,
  };
  if (!candidates.length) return result;
  let current, main, remote;
  try {
    current = snapshot(root);
    main = git(root, ["rev-parse", "refs/heads/main"]);
    remote = git(root, [
      "ls-remote",
      "--exit-code",
      "origin",
      "refs/heads/main",
    ]).split(/\s+/)[0];
    if (!commitId.test(remote) || main !== remote || current.head !== main)
      throw new Error(
        "Current checkout, local main and live remote main must agree"
      );
  } catch (error) {
    result.pending = candidates.map((item) => ({
      id: item.id,
      reason: error.message,
    }));
    return result;
  }
  for (const item of candidates) {
    try {
      const file = join(acceptanceDir(repo), `${item.id}.json`);
      const proofBytes = readFileSync(file);
      const proof = JSON.parse(proofBytes);
      const { recordDigest, ...record } = proof;
      if (
        proof.schemaVersion !== 1 ||
        proof.id !== item.id ||
        recordDigest !== followupDigest(record) ||
        proof.pendingDigest !== followupDigest(item) ||
        proof.requestDigest !== requestIdentity(repo, item) ||
        !commitId.test(proof.fixCommit || "") ||
        !nonempty(proof.coverageReview) ||
        proof.validation?.root !== current.root ||
        proof.validation.sourceTree !== current.sourceTree ||
        proof.validation.fingerprint !== current.fingerprint
      )
        throw new Error(
          "Request, code, dependencies or environment changed; validate again"
        );
      git(root, ["merge-base", "--is-ancestor", proof.fixCommit, main]);
      conditionsValid(proof.conditions);
      const ids = [
        ...new Set(
          proof.conditions.flatMap((condition) =>
            condition.coverage.map((c) => c.gate)
          )
        ),
      ].sort();
      if (
        !Array.isArray(proof.evidence) ||
        JSON.stringify(proof.evidence.map((e) => e.gate).sort()) !==
          JSON.stringify(ids)
      )
        throw new Error("Condition coverage does not match recorded gates");
      for (const evidence of proof.evidence)
        gateProof(root, current, reports(root), evidence.gate, evidence);
      assertCoverage(root, proof.conditions, proof.evidence);
      assertStable(root, current);
      if (
        sha(readFileSync(file)) !== sha(proofBytes) ||
        proof.requestDigest !== requestIdentity(repo, item) ||
        git(root, ["rev-parse", "refs/heads/main"]) !== main
      )
        throw new Error("Acceptance inputs changed before resolution");
      const acceptance = {
        ...proof,
        publication: { main, remote, checkedAt: new Date().toISOString() },
      };
      resolveFollowup({
        repo,
        id: item.id,
        expectedDigest: proof.pendingDigest,
        acceptance,
        note: `受入条件 ${proof.conditions.length} 件を検証証跡と照合。修正 ${proof.fixCommit} は公開main ${remote} に採用済み。同じ内容の成功検査を再利用。`,
      });
      result.resolvedIds.push(item.id);
    } catch (error) {
      result.pending.push({ id: item.id, reason: error.message });
    }
  }
  return result;
}
