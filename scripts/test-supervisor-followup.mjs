import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  enqueueFollowup,
  planFollowups,
  recordFollowupRun,
  resolveFollowup,
  listPendingFollowups,
  observeBlocker,
} from "./supervisor-followup.mjs";

const repo = mkdtempSync(join(tmpdir(), "orica-followup-plan-"));
const receptionDir = join(repo, "logs/codex-telegram-inbox/reception-results");
mkdirSync(receptionDir, { recursive: true });
function request(id, at) {
  const item = enqueueFollowup({
    repo,
    kind: "instruction",
    lane: "codex",
    text: `Telegram受付からの引継ぎ: inbox ${id}\n${"長い返答".repeat(4000)}\n必要な作業:\n修正要求${id}`,
    createdAt: at,
  });
  writeFileSync(
    join(receptionDir, `${id}.json`),
    JSON.stringify({
      status: "completed",
      handoffId: item.id,
      result: { handoff: `修正要求${id}` },
    })
  );
  return item;
}
const first = request("100", "2026-10-10T00:00:00Z");
const second = request("101", "2026-10-11T00:00:00Z");
enqueueFollowup({
  repo,
  kind: "instruction",
  text: "旧ユーザー方針: 全停止",
  createdAt: "2026-09-01T00:00:00Z",
});
for (let i = 0; i < 257; i++)
  enqueueFollowup({ repo, kind: "error", text: `${i}:${"a".repeat(5000)}` });
let plan = planFollowups({ repo });
assert.deepEqual(plan.selectedIds, [first.id]);
assert.equal(plan.taskCount, 2);
assert.match(plan.block, /修正要求100/);
assert.match(plan.block, /reception-results/);
assert.ok(
  plan.block.length < 12000,
  "queue growth must not grow the prompt unboundedly"
);
assert.equal(
  listPendingFollowups({ repo }).length,
  260,
  "planning must preserve every record"
);
const run = { repo, ids: [first.id], runId: "run-1", threadId: "thread-1" };
assert.equal(plan.auditTurnDue, false);

recordFollowupRun({ ...run, phase: "started", at: "2026-10-12T00:00:00Z" });
assert.deepEqual(
  planFollowups({ repo }).selectedIds,
  [second.id],
  "unclosed work must not starve unattempted requests"
);
const activityFile = join(
  repo,
  "logs/codex-supervisor-followups/activity",
  `${first.id}.json`
);
assert.equal(JSON.parse(readFileSync(activityFile)).status, "running");
recordFollowupRun({ ...run, phase: "finished", exitCode: 0 });
assert.equal(
  JSON.parse(readFileSync(activityFile)).status,
  "pending",
  "successful process is not proof of task completion"
);
recordFollowupRun({ ...run, runId: "run-2", phase: "started" });
recordFollowupRun({ ...run, phase: "finished", exitCode: 1 });
assert.equal(
  JSON.parse(readFileSync(activityFile)).runId,
  "run-2",
  "old runner must not overwrite a later attempt"
);
resolveFollowup({ repo, id: first.id, note: "implemented and verified" });
recordFollowupRun({ ...run, runId: "run-2", phase: "finished", exitCode: 0 });
assert.equal(JSON.parse(readFileSync(activityFile)).status, "resolved");
assert.equal(planFollowups({ repo }).taskCount, 1);
assert.equal(listPendingFollowups({ repo }).length, 259);
const reopened = enqueueFollowup({
  repo,
  kind: first.kind,
  lane: first.lane,
  text: first.text,
});
assert.equal(reopened.id, first.id);
const reopenedPaths = ["pending", "resolved"].map((status) =>
  join(repo, "logs/codex-supervisor-followups", status, `${first.id}.json`)
);
const reopenedBefore = reopenedPaths.map((file) => readFileSync(file, "utf8"));
assert.deepEqual(
  enqueueFollowup({
    repo,
    kind: first.kind,
    lane: first.lane,
    text: first.text,
    once: true,
  }),
  reopened,
  "idempotent reception returns the reopened request, not old completion"
);
assert.deepEqual(
  reopenedPaths.map((file) => readFileSync(file, "utf8")),
  reopenedBefore,
  "an idempotent retry changes neither occurrence count nor either record"
);
assert.equal(listPendingFollowups({ repo }).length, 260);
recordFollowupRun({ ...run, runId: "run-reopened", phase: "started" });
recordFollowupRun({
  ...run,
  runId: "run-reopened",
  phase: "finished",
  exitCode: 0,
});
assert.equal(
  JSON.parse(readFileSync(activityFile)).status,
  "pending",
  "an old terminal receipt cannot complete a new occurrence"
);
resolveFollowup({
  repo,
  id: first.id,
  note: "fixture re-opened occurrence checked",
});
assert.equal(
  enqueueFollowup({
    repo,
    kind: first.kind,
    lane: first.lane,
    text: first.text,
    once: true,
  }).status,
  "resolved"
);
assert.equal(
  listPendingFollowups({ repo }).length,
  259,
  "a terminal-only retry must not resurrect a completed request"
);
assert.throws(() =>
  recordFollowupRun({ ...run, ids: ["../invalid"], phase: "started" })
);
const pendingFile = join(
  repo,
  "logs/codex-supervisor-followups/pending",
  `${second.id}.json`
);
const pendingSource = readFileSync(pendingFile, "utf8");
const pendingRun = {
  repo,
  ids: [second.id],
  runId: "bounded-attempt",
  threadId: "bounded-thread",
};
recordFollowupRun({ ...pendingRun, phase: "started" });
recordFollowupRun({ ...pendingRun, phase: "finished", exitCode: 0 });
assert.equal(planFollowups({ repo }).auditTurnDue, true);
recordFollowupRun({
  ...pendingRun,
  phase: "audit-started",
  runId: "audit-turn",
  threadId: null,
});
assert.equal(
  planFollowups({ repo }).auditTurnDue,
  true,
  "failed startup cannot consume audit turn"
);
recordFollowupRun({
  ...pendingRun,
  phase: "audit-started",
  runId: "audit-turn",
});
assert.equal(planFollowups({ repo }).auditTurnDue, false);
assert.equal(
  readFileSync(pendingFile, "utf8"),
  pendingSource,
  "serving audit never resolves or rewrites request"
);
recordFollowupRun({ ...pendingRun, phase: "started", runId: "next-unit" });
recordFollowupRun({
  ...pendingRun,
  phase: "finished",
  runId: "next-unit",
  exitCode: 1,
});
assert.equal(
  planFollowups({ repo }).auditTurnDue,
  false,
  "failed work keeps repair priority"
);

writeFileSync(pendingFile, "{");
assert.throws(
  () => planFollowups({ repo }),
  /follow-up JSON read failed/,
  "a completed receipt with corrupt pending JSON must fail even when four newer reports would hide its diagnostic"
);
assert.equal(
  listPendingFollowups({ repo }).find((item) => item.id === second.id).kind,
  "error",
  "the diagnostic summary must remain available for queue repair"
);
writeFileSync(pendingFile, pendingSource);
assert.deepEqual(planFollowups({ repo }).selectedIds, [second.id]);
writeFileSync(join(receptionDir, "102.json"), "broken JSON");
assert.throws(
  () => planFollowups({ repo }),
  "receipt lookup errors must not look like an empty task queue"
);
const notices = [];
const incident = {
  repo,
  key: "validation-recovery",
  notify: (text) => notices.push(text),
};
let observation;
for (let i = 0; i < 64; i++) {
  observation = observeBlocker({
    ...incident,
    text: `owner PID/log changes ${i}`,
    at: new Date(
      Date.parse("2026-10-13T07:00:00Z") + i * 15 * 60_000
    ).toISOString(),
  });
}
assert.equal(observation.occurrenceCount, 64);
assert.equal(
  notices.length,
  6,
  "64 identical blockers notify at first observation and escalating age, not each tick"
);
assert.equal(
  listPendingFollowups({ repo }).filter((x) => x.incidentKey).length,
  1
);
observeBlocker({
  ...incident,
  cleared: true,
  text: "owner safely recovered",
  at: "2026-10-13T23:00:00Z",
});
assert.equal(
  listPendingFollowups({ repo }).filter((x) => x.incidentKey).length,
  0
);
assert.equal(
  observeBlocker({
    ...incident,
    text: "new incident",
    at: "2026-10-14T00:00:00Z",
  }).occurrenceCount,
  1
);
assert.throws(
  () =>
    observeBlocker({
      ...incident,
      key: "outbox-failure",
      text: "blocked",
      notify: () => {
        throw new Error("outbox unavailable");
      },
    }),
  /outbox unavailable/
);
assert.equal(
  observeBlocker({ ...incident, key: "outbox-failure", text: "blocked" })
    .notificationLevel,
  0,
  "failed notification is retried, not acknowledged before durable delivery"
);
assert.equal(dirname(realpathSync(repo)), realpathSync(tmpdir()));
rmSync(repo, { recursive: true, force: true });
console.log(
  "[test-supervisor-followup] passed: legacy selection, bounded prompt, rotation, start receipts, resolution separation"
);
