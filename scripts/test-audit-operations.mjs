import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  auditContentHash,
  auditInputRoot,
  auditStateFingerprint,
  loadAuditMirror,
} from "./audit-inputs.mjs";
import {
  auditSnapshot,
  beginRunMetrics,
  finishRunMetrics,
  reviewProgress,
  summarizeRuns,
} from "./supervisor-run-metrics.mjs";
import {
  changedReviewRecords,
  reviewBatchTests,
} from "./verify-review-batch.mjs";
import { fullGates, selectGates } from "./harness/gate-manifest.mjs";

const temp = mkdtempSync(join(tmpdir(), "orica-audit-operations-"));
const primary = join(temp, "primary"),
  lane = join(temp, "lane");
const put = (file, content) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const json = (file, value) => put(file, JSON.stringify(value));
const git = (...args) =>
  execFileSync("git", ["-C", primary, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
try {
  mkdirSync(primary);
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Audit fixture");
  put(
    join(primary, ".gitignore"),
    "external-qa/\nlogs/\ncard-coverage.json\nfidelity-audit.json\n"
  );
  git("add", ".");
  git("commit", "-m", "fixture");
  git("worktree", "add", "-b", "lane", lane);
  const mirror = (cards) =>
    `const versionedCardData = ${JSON.stringify(cards)};\nexport default versionedCardData;\n`;
  put(
    join(primary, "external-qa/cardData.js"),
    mirror([{ cardNumber: "PRIMARY" }])
  );
  put(join(lane, "external-qa/cardData.js"), mirror([{ cardNumber: "STALE" }]));
  const approve = (cards) => {
    const value = {
      schemaVersion: 1,
      sha256: auditContentHash(Buffer.from(mirror(cards))),
      source: { revision: "fixture", path: "cardData.js" },
      reviewedAt: "2026-09-29",
      evidence: "fixture",
    };
    for (const root of [primary, lane])
      json(join(root, "scripts/audit-mirror-provenance.json"), value);
  };
  assert.throws(() => loadAuditMirror(lane), /unreviewed/);
  approve([{ cardNumber: "PRIMARY" }]);
  assert.equal(auditInputRoot(lane), auditInputRoot(primary));
  assert.deepEqual(loadAuditMirror(lane), loadAuditMirror(primary));
  assert.equal(loadAuditMirror(lane).cards[0].cardNumber, "PRIMARY");
  const before = loadAuditMirror(lane).input.sha256;
  put(
    join(primary, "external-qa/cardData.js"),
    mirror([{ cardNumber: "PRIMARY" }]).replaceAll("\n", "\r\n")
  );
  assert.equal(loadAuditMirror(lane).input.sha256, before);
  put(
    join(primary, "external-qa/cardData.js"),
    mirror([{ cardNumber: "OLDER" }])
  );
  assert.throws(() => loadAuditMirror(lane), /version mismatch/);
  put(
    join(primary, "external-qa/cardData.js"),
    mirror([{ cardNumber: "PRIMARY" }])
  );
  json(join(lane, "scripts/audit-mirror-provenance.json"), {});
  assert.throws(() => loadAuditMirror(lane), /version mismatch/);
  approve([{ cardNumber: "PRIMARY" }]);
  put(join(primary, "external-qa/cardData.js"), "invalid javascript!!");
  assert.throws(() => loadAuditMirror(lane));
  rmSync(join(primary, "external-qa/cardData.js"));
  assert.equal(
    loadAuditMirror(lane).input.status,
    "missing",
    "do not fall back to stale lane input"
  );
  assert.notEqual(
    auditContentHash(Buffer.from([0, 13, 10])),
    auditContentHash(Buffer.from([0, 10]))
  );
  git("add", "scripts/audit-mirror-provenance.json");
  git("commit", "-m", "review mirror fixture");

  const receipt = {
    schemaVersion: 3,
    cardNo: "TEST",
    kind: "usage",
    path: "effects[0]",
    evidenceRefs: [{ path: "logs/review-evidence.txt" }],
    testRefs: [{ path: "packages/rules-core/test/a.test.ts" }],
    testExecution: [{ path: "packages/rules-core/test/a.test.ts" }],
  };
  const registry = { schemaVersion: 1, records: [receipt] };
  assert.equal(changedReviewRecords(registry, [registry]).length, 0);
  assert.equal(
    changedReviewRecords(registry, [{ schemaVersion: 1, records: [] }]).length,
    1
  );
  assert.throws(() => changedReviewRecords(registry, [{}]));
  const valid = {
    confirmedSemanticReviews: [
      { reviewResolution: { status: "confirmed_correct", record: receipt } },
    ],
  };
  assert.deepEqual(reviewBatchTests([receipt, receipt], [valid]), [
    "packages/rules-core/test/a.test.ts",
  ]);
  assert.throws(
    () => reviewBatchTests([receipt], [{ confirmedSemanticReviews: [] }]),
    /not currently confirmed/
  );
  for (const schemaVersion of [1, 2]) {
    const legacy = { ...receipt, schemaVersion };
    assert.throws(
      () =>
        reviewBatchTests(
          [legacy],
          [
            {
              confirmedSemanticReviews: [
                {
                  reviewResolution: {
                    status: "confirmed_correct",
                    record: legacy,
                  },
                },
              ],
            },
          ]
        ),
      /not currently confirmed/,
      "legacy records remain rejected even when a supplied report calls them confirmed"
    );
  }
  assert.throws(
    () =>
      reviewBatchTests(
        [receipt],
        [
          {
            confirmedSemanticReviews: [
              {
                reviewResolution: {
                  status: "confirmed_correct",
                  record: { ...receipt, reason: "different proof" },
                },
              },
            ],
          },
        ]
      ),
    /not currently confirmed/,
    "schema v3 still requires exact equality with the current confirmed record"
  );
  const metadata = [
    "scripts/fidelity-review-resolutions.json",
    "fidelity-baseline.json",
    "manual/ai-reference/30_plan/02_detailed-todo.md",
  ];
  for (const profile of ["finish", "push", "merge"]) {
    const gates = selectGates(profile, metadata);
    assert.ok(gates.includes("review-batch"));
    assert.ok(!gates.includes("vitest"));
    for (const changed of [
      "packages/rules-core/src/model.ts",
      "packages/card-data/src/cards/TEST.ts",
      "unknown.txt",
      "scripts/audit-inputs.mjs",
      "manual/ai-reference/00_meta/full-run-efficiency.md",
    ]) {
      assert.ok(
        selectGates(profile, [...metadata, changed]).includes("vitest")
      );
    }
  }
  assert.deepEqual(selectGates("merge", []), [...fullGates, "card-tests"]);
  assert.ok(selectGates("ci", metadata).includes("vitest"));

  const old = {
    measured: true,
    pending: ["fidelity|NEW|usage|x", "fidelity|OLD|usage|x"],
    confirmed: ["coverage|REOPEN|x|y"],
    previouslyReviewed: ["OLD|usage|x"],
  };
  const next = {
    measured: true,
    pending: ["coverage|REOPEN|x|y"],
    confirmed: old.pending,
  };
  assert.deepEqual(reviewProgress(old, next), {
    firstReviews: 1,
    revalidations: 1,
    candidatesRemoved: 0,
    reopened: 1,
    pendingBefore: 2,
    pendingAfter: 1,
  });
  assert.equal(reviewProgress(old, { measured: false }), null);
  assert.equal(
    reviewProgress(
      {
        ...old,
        confirmed: ["fidelity|OLD|usage|x"],
        confirmedProofs: { "fidelity|OLD|usage|x": "old" },
      },
      {
        ...next,
        confirmed: ["fidelity|OLD|usage|x"],
        confirmedProofs: { "fidelity|OLD|usage|x": "renewed" },
      }
    ).revalidations,
    1,
    "renewing proof for an already confirmed identity is still revalidation"
  );
  const pending = {
    cardNo: "TEST",
    kind: "usage",
    effectPath: "effects[0]",
    severity: "review",
  };
  json(join(primary, "card-coverage.json"), {
    totals: { todo: 0 },
    auditIssues: [],
    auditReviewCount: 0,
    auditViolationCount: 0,
    confirmedAuditReviews: [],
  });
  json(join(primary, "fidelity-audit.json"), {
    violations: [],
    semanticReviews: [pending],
    semanticReviewCount: 1,
    confirmedSemanticReviews: [],
  });
  json(join(primary, "scripts/fidelity-review-resolutions.json"), {
    schemaVersion: 1,
    records: [],
  });
  const stampReports = () => {
    const fingerprint = auditStateFingerprint(primary);
    for (const name of ["card-coverage.json", "fidelity-audit.json"]) {
      const path = join(primary, name);
      json(path, {
        ...JSON.parse(readFileSync(path, "utf8")),
        auditStateFingerprint: fingerprint,
      });
    }
  };
  stampReports();
  assert.equal(auditSnapshot(primary).pending.length, 1);
  assert.equal(auditSnapshot(primary, Date.now() + 10000).measured, false);
  const startedAt = new Date(Date.now() - 2000).toISOString();
  const run = beginRunMetrics({
    repo: primary,
    workdir: primary,
    startedAt,
    runId: "test-run",
  });
  json(join(primary, "fidelity-audit.json"), {
    violations: [],
    semanticReviews: [],
    semanticReviewCount: 0,
    confirmedSemanticReviews: [
      { ...pending, reviewResolution: { record: receipt } },
    ],
  });
  json(join(primary, "scripts/fidelity-review-resolutions.json"), registry);
  put(join(primary, "logs/review-evidence.txt"), "original proof");
  stampReports();
  put(join(primary, "logs/review-evidence.txt"), "changed proof");
  assert.equal(
    auditSnapshot(primary).measured,
    false,
    "ignored evidence remains an audit input"
  );
  put(join(primary, "logs/review-evidence.txt"), "original proof");
  json(join(primary, "logs/harness/runs/test.json"), {
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    durationMs: 700,
    leaseWaitMs: 300,
  });
  const measured = finishRunMetrics(run, {
    finishedAt: new Date().toISOString(),
    status: "completed",
    exitCode: 0,
    threadId: "fixture",
    usage: { input_tokens: 100, output_tokens: 10 },
  });
  assert.equal(measured.progress.firstReviews, 1);
  assert.equal(measured.validation.waitMs, 300);
  assert.equal(
    readFileSync(run.file, "utf8").includes('"input_tokens": 100'),
    true
  );
  const summary = summarizeRuns(join(primary, "logs/supervisor-runs"));
  assert.equal(summary.finished, 1);
  assert.equal(
    summary.firstReviews,
    0,
    "uncommitted observations are not landed results"
  );
  assert.equal(summary.unlandedRuns, 1);
  git("add", "scripts/fidelity-review-resolutions.json");
  git("commit", "-m", "confirmed fixture");
  const endState = {
    finishedAt: new Date().toISOString(),
    status: "completed",
    exitCode: 0,
  };
  assert.equal(finishRunMetrics(run, endState).landedProgress.firstReviews, 1);
  const source = join(primary, "packages/rules-core/src/engine.ts");
  put(source, "export const changed = true;\n");
  assert.equal(
    auditSnapshot(primary).measured,
    false,
    "mid-run report cannot cover later source edits"
  );
  rmSync(source);
  put(
    join(primary, "external-qa/cardData.js"),
    mirror([{ cardNumber: "CHANGED" }])
  );
  assert.equal(
    auditSnapshot(primary).measured,
    false,
    "mirror changes invalidate saved reports"
  );
  rmSync(join(primary, "external-qa/cardData.js"));
  json(join(primary, "scripts/fidelity-review-resolutions.json"), {
    schemaVersion: 1,
    records: [],
  });
  git("add", "scripts/fidelity-review-resolutions.json");
  git("commit", "-m", "remove confirmation after audit");
  const stale = finishRunMetrics(run, {
    ...endState,
    finishedAt: new Date().toISOString(),
  });
  assert.equal(stale.integrated, true);
  assert.equal(
    stale.after.measured,
    false,
    "clean committed final tree still needs matching audits"
  );
  assert.equal(stale.landedProgress, null);
  git("switch", "-c", "unpublished-metrics");
  put(join(primary, "pending-change.txt"), "unpublished work\n");
  git("add", "pending-change.txt");
  git("commit", "-m", "not in main yet");
  const unlanded = finishRunMetrics(run, {
    ...endState,
    status: "publication_pending",
    exitCode: 75,
    publicationStatus: "waiting",
    workerExitCode: 0,
  });
  assert.equal(unlanded.integrated, false);
  assert(unlanded.changes.files.includes("pending-change.txt"));
  assert.equal(
    unlanded.changeMeasurementError,
    undefined,
    "normal unpublished ancestry is not a measurement failure"
  );
  assert.equal(unlanded.publicationStatus, "waiting");
  const waitingSummary = summarizeRuns(join(primary, "logs/supervisor-runs"));
  assert.equal(waitingSummary.failed, 0);
  assert.equal(waitingSummary.publicationWaitRuns, 1);
  const mixedDirectory = join(temp, "mixed-runs");
  const waiting = {
    startedAt: "2026-10-14T00:00:00.000Z",
    status: "publication_pending",
    exitCode: 75,
    workerExitCode: 0,
    publicationStatus: "waiting",
  };
  const cases = {
    completed: {
      ...waiting,
      status: "completed",
      exitCode: 0,
      publicationStatus: "completed",
    },
    resourceWait: waiting,
    workerFailed: {
      ...waiting,
      status: "failed",
      workerExitCode: 1,
      exitCode: 1,
    },
    publicationGateFailed: {
      ...waiting,
      status: "failed",
      publicationStatus: "failed",
      exitCode: 1,
    },
    lockLost: { ...waiting, status: "failed", exitCode: 1 },
    legacyNonzero: {
      startedAt: waiting.startedAt,
      status: "failed",
      exitCode: 75,
    },
    inconsistentStatus: { ...waiting, status: "completed" },
    inconsistentPublication: { ...waiting, publicationStatus: "failed" },
    unknownWorker: { ...waiting, workerExitCode: null },
    inconsistentExit: { ...waiting, exitCode: 1 },
    running: { ...waiting, status: "running" },
    beforeRange: { ...waiting, startedAt: "2026-10-13T00:00:00.000Z" },
  };
  for (const [name, report] of Object.entries(cases))
    json(join(mixedDirectory, `${name}.json`), report);
  const mixed = summarizeRuns(mixedDirectory, "2026-10-14");
  assert.equal(mixed.runs, 11);
  assert.equal(mixed.finished, 10);
  assert.equal(
    mixed.failed,
    8,
    "failures and inconsistent wait signals stay visible"
  );
  assert.equal(
    mixed.publicationWaitRuns,
    1,
    "only confirmed resource waits are separated"
  );
  console.log(
    "[test-audit-operations] passed: shared mirror, newline invariance, fail-closed batch validation, full escalation, run metrics"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
