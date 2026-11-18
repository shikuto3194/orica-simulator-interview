import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditContentHash, auditStateFingerprint } from "./audit-inputs.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const key = (audit, finding) =>
  [
    audit,
    finding.cardNo,
    finding.kind,
    finding.path ?? finding.effectPath,
  ].join("|");
function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}
export function auditSnapshot(root, since = 0) {
  try {
    const coverageFile = join(root, "card-coverage.json");
    const fidelityFile = join(root, "fidelity-audit.json");
    if (
      [coverageFile, fidelityFile].some(
        (file) => statSync(file).mtimeMs < since
      )
    )
      throw new Error("Post-run audits were not refreshed");
    const coverage = read(coverageFile),
      fidelity = read(fidelityFile);
    const sourceFingerprint = auditStateFingerprint(root);
    if (
      [coverage, fidelity].some(
        (report) => report.auditStateFingerprint !== sourceFingerprint
      )
    )
      throw new Error(
        "Saved audits do not match current source, registry and inputs"
      );
    const pending = [],
      confirmed = [];
    const confirmedProofs = {};
    for (const [audit, report, pendingField, confirmedField, countField] of [
      [
        "coverage",
        coverage,
        "auditIssues",
        "confirmedAuditReviews",
        "auditReviewCount",
      ],
      [
        "fidelity",
        fidelity,
        "semanticReviews",
        "confirmedSemanticReviews",
        "semanticReviewCount",
      ],
    ]) {
      if (
        !Array.isArray(report[pendingField]) ||
        !Array.isArray(report[confirmedField])
      )
        throw new Error("Incomplete audit arrays");
      const reviews = report[pendingField].filter(
        (finding) => finding.severity === "review"
      );
      if (reviews.length !== report[countField])
        throw new Error("Inconsistent audit count");
      pending.push(...reviews.map((finding) => key(audit, finding)));
      confirmed.push(
        ...report[confirmedField].map((finding) => key(audit, finding))
      );
      for (const finding of report[confirmedField]) {
        const record = finding.reviewResolution?.record;
        if (!record) throw new Error("Confirmed audit is missing its proof");
        confirmedProofs[key(audit, finding)] = auditContentHash(
          Buffer.from(
            JSON.stringify({
              fingerprint: record.fingerprint,
              contextFingerprint: record.contextFingerprint,
              evidenceRefs: record.evidenceRefs,
              testRefs: record.testRefs,
              testSupport: record.testSupport,
            })
          )
        );
      }
    }
    if (
      !Number.isInteger(coverage.totals?.todo) ||
      !Array.isArray(fidelity.violations) ||
      !Number.isInteger(coverage.auditViolationCount)
    )
      throw new Error("Incomplete audit totals");
    const registry = read(
      join(root, "scripts/fidelity-review-resolutions.json")
    );
    if (!Array.isArray(registry.records))
      throw new Error("Incomplete review registry");
    if (auditStateFingerprint(root) !== sourceFingerprint)
      throw new Error("Audit inputs changed during snapshot");
    return {
      measured: true,
      sourceFingerprint,
      pending,
      confirmed,
      confirmedProofs,
      previouslyReviewed: registry.records.map((record) =>
        [record.cardNo, record.kind, record.path].join("|")
      ),
      todo: coverage.totals.todo,
      violations: coverage.auditViolationCount + fidelity.violations.length,
    };
  } catch (error) {
    return { measured: false, error: error.message };
  }
}

export function reviewProgress(before, after) {
  if (!before?.measured || !after?.measured) return null;
  const newlyConfirmed = after.confirmed.filter(
    (id) =>
      !before.confirmed.includes(id) ||
      before.confirmedProofs?.[id] !== after.confirmedProofs?.[id]
  );
  const revalidated = newlyConfirmed.filter(
    (id) =>
      before.confirmed.includes(id) ||
      before.previouslyReviewed.includes(id.slice(id.indexOf("|") + 1))
  );
  return {
    firstReviews: newlyConfirmed.length - revalidated.length,
    revalidations: revalidated.length,
    candidatesRemoved: before.pending.filter(
      (id) => !after.pending.includes(id) && !after.confirmed.includes(id)
    ).length,
    reopened: before.confirmed.filter((id) => after.pending.includes(id))
      .length,
    pendingBefore: before.pending.length,
    pendingAfter: after.pending.length,
  };
}

export function beginRunMetrics({ repo, workdir, startedAt, runId }) {
  const metrics = {
    schemaVersion: 2,
    runId,
    startedAt,
    status: "running",
    workdir,
    before: auditSnapshot(workdir),
  };
  try {
    metrics.startHead = git(workdir, ["rev-parse", "HEAD"]);
  } catch {
    metrics.startHead = null;
  }
  const file = join(repo, "logs/supervisor-runs", runId + ".json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(metrics, null, 2) + "\n", { flag: "wx" });
  return { file, metrics };
}

export function finishRunMetrics(run, state) {
  const { metrics, file } = run;
  const start = Date.parse(metrics.startedAt),
    end = Date.parse(state.finishedAt);
  metrics.finishedAt = state.finishedAt;
  metrics.status = state.status;
  metrics.threadId = state.threadId;
  metrics.exitCode = state.exitCode;
  metrics.workerExitCode = state.workerExitCode ?? state.exitCode;
  metrics.publicationStatus = state.publicationStatus || "unknown";
  metrics.integrationRequest = state.integrationRequest || null;
  metrics.usage = state.usage; // Reported parent usage, not an estimate of sub-agent billing.
  metrics.durationMs = end - start;
  metrics.after = auditSnapshot(metrics.workdir, start);
  metrics.progress = reviewProgress(metrics.before, metrics.after);
  metrics.changes = null;
  delete metrics.changeMeasurementError;
  try {
    const endHead = git(metrics.workdir, ["rev-parse", "HEAD"]);
    const files = git(metrics.workdir, [
      "diff",
      "--name-only",
      metrics.startHead,
      endHead,
    ])
      .split(/\r?\n/)
      .filter(Boolean);
    metrics.endHead = endHead;
    metrics.changes = {
      productFiles: files.filter((file) =>
        /^(?:packages|apps)\/[^/]+\/src\//.test(file)
      ),
      detectorFiles: files.filter((file) =>
        /^scripts\/.*(?:detector|cards-fidelity-audit|cards-coverage)\.mjs$/.test(
          file
        )
      ),
      // These are changed files, never claimed as a count of fixed bugs.
      files,
    };
    metrics.integrated = !git(metrics.workdir, ["status", "--porcelain"]);
    if (metrics.integrated) {
      try {
        git(metrics.workdir, ["merge-base", "--is-ancestor", endHead, "main"]);
      } catch (error) {
        if (error.status !== 1) throw error;
        metrics.integrated = false;
      }
    }
  } catch (error) {
    metrics.integrated = false;
    metrics.changeMeasurementError = error.message;
  }
  metrics.landedProgress =
    metrics.integrated && state.exitCode === 0 ? metrics.progress : null;
  metrics.validation = {
    measured: true,
    runCount: 0,
    durationMs: 0,
    waitMs: 0,
    unknownWaitRuns: 0,
  };
  try {
    for (const name of readdirSync(
      join(metrics.workdir, "logs/harness/runs")
    )) {
      if (!name.endsWith(".json")) continue;
      const report = read(join(metrics.workdir, "logs/harness/runs", name));
      if (
        report.startedAt < start ||
        report.startedAt > end ||
        !Number.isFinite(report.finishedAt)
      )
        continue;
      metrics.validation.runCount++;
      metrics.validation.durationMs += report.durationMs;
      if (Number.isFinite(report.leaseWaitMs))
        metrics.validation.waitMs += report.leaseWaitMs;
      else metrics.validation.unknownWaitRuns++;
    }
  } catch (error) {
    if (error.code !== "ENOENT")
      metrics.validation = { measured: false, error: error.message };
  }
  writeFileSync(file, JSON.stringify(metrics, null, 2) + "\n");
  return metrics;
}

export function summarizeRuns(directory, since = "1970-01-01") {
  const reports = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => read(join(directory, name)))
    .filter((report) => report.startedAt >= since);
  const done = reports.filter((report) => report.status !== "running");
  const publicationWaits = new Set(
    done.filter(
      (report) =>
        report.workerExitCode === 0 &&
        report.publicationStatus === "waiting" &&
        report.status === "publication_pending" &&
        report.exitCode === 75
    )
  );
  const sum = (get) => done.reduce((n, report) => n + (get(report) ?? 0), 0);
  const progressSum = (field) =>
    sum((r) => (r.schemaVersion === 2 ? r.landedProgress?.[field] : 0));
  return {
    runs: reports.length,
    finished: done.length,
    failed: done.filter(
      (report) => report.exitCode !== 0 && !publicationWaits.has(report)
    ).length,
    publicationWaitRuns: publicationWaits.size,
    incompleteMeasurements: done.filter(
      (report) => report.schemaVersion !== 2 || !report.progress
    ).length,
    durationHours: sum((r) => r.durationMs) / 3600000,
    validationHours: sum((r) => r.validation?.durationMs) / 3600000,
    validationWaitHours: sum((r) => r.validation?.waitMs) / 3600000,
    unknownWaitRuns: sum((r) => r.validation?.unknownWaitRuns),
    unlandedRuns: done.filter((r) => !r.integrated).length,
    firstReviews: progressSum("firstReviews"),
    revalidations: progressSum("revalidations"),
    candidatesRemoved: progressSum("candidatesRemoved"),
    reopened: sum((r) => r.progress?.reopened),
    productChangeRuns: done.filter((r) => r.changes?.productFiles.length)
      .length,
    detectorChangeRuns: done.filter((r) => r.changes?.detectorFiles.length)
      .length,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.some(
        (arg, index) => index % 2 === 0 && !["--repo", "--since"].includes(arg)
      ) ||
      args.length % 2
    )
      throw new Error(
        "Usage: supervisor-run-metrics.mjs [--repo PATH] [--since ISO_DATE]"
      );
    const opts = Object.fromEntries(
      Array.from({ length: args.length / 2 }, (_, i) => [
        args[i * 2],
        args[i * 2 + 1],
      ])
    );
    console.log(
      JSON.stringify(
        summarizeRuns(
          join(resolve(opts["--repo"] ?? "."), "logs/supervisor-runs"),
          opts["--since"]
        ),
        null,
        2
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
