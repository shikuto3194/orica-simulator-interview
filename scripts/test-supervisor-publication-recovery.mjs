import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  prepareIntegration,
  requestIntegration,
  completeIntegration,
  resumeIntegrations,
} from "./supervisor-integration.mjs";
import {
  acquireGateLease,
  gateLeasePath,
  leaseFailureExit,
  leaseWaitError,
} from "./harness/gate-lease.mjs";

// Real shared Git + bare remote. No real repository, network service, gate,
// worker, notification, or process termination is used by this regression.
const temp = mkdtempSync(join(tmpdir(), "orica-publication-recovery-"));
const repo = join(temp, "repo"),
  lane = join(temp, "lane"),
  main = join(temp, "main"),
  remote = join(temp, "remote.git");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
);
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    env,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  }).trim();
const read = (ticket) => JSON.parse(readFileSync(ticket.file, "utf8"));
const save = (ticket) => writeFileSync(ticket.file, JSON.stringify(ticket));
const incidents = [];
const observe = (item) => incidents.push(item);
let executions = 0;
const defer = async () => {
  executions++;
  return 75;
};
const complete = (ticket, options) =>
  completeIntegration(ticket, { ...options, execute: defer });
// An OS PID can be reassigned after the child exits. Model the prior publisher's
// liveness explicitly; keep real live-process checks on process.pid below.
const exited = { pid: 2_000_000_001 };
const publisherChild = { pid: 2_000_000_002 };
let exitedState = "dead";
let childState = "dead";
const originalProcessKill = process.kill;
const resume = (options) => {
  // The parent fixture stays alive; emulate the prior runner's confirmed exit.
  for (const file of readdirSync(join(repo, "logs/supervisor-integrations"))) {
    if (!file.endsWith(".json")) continue;
    const item = JSON.parse(
      readFileSync(join(repo, "logs/supervisor-integrations", file))
    );
    if (item.status === "waiting") save({ ...item, ownerPid: exited.pid });
  }
  return resumeIntegrations(repo, lane, { env, observe, complete, ...options });
};
const request = () => {
  const ticket = prepareIntegration(repo, lane);
  requestIntegration(ticket.file, lane);
  return ticket;
};
try {
  process.kill = (pid, signal) => {
    const liveness =
      pid === exited.pid
        ? exitedState
        : pid === publisherChild.pid
          ? childState
          : null;
    if (liveness === null) return originalProcessKill(pid, signal);
    assert.equal(signal, 0, "synthetic publisher only permits liveness probes");
    if (liveness === "alive") return true;
    throw Object.assign(new Error("fixture publisher liveness"), {
      code: liveness === "dead" ? "ESRCH" : "EPERM",
    });
  };
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Publication recovery fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  mkdirSync(join(repo, "scripts"));
  writeFileSync(join(repo, ".gitignore"), "logs/\n.verifier-*\n");
  writeFileSync(
    join(repo, "scripts/full-run-checkouts.json"),
    JSON.stringify({
      schemaVersion: 1,
      workerWorktree: "../lane",
      workerRef: "refs/heads/lane",
      integrationWorktree: "../main",
      integrationRef: "refs/heads/main",
    })
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  execFileSync("git", ["init", "--bare", remote], {
    env,
    stdio: "pipe",
    windowsHide: true,
  });
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");
  git(repo, "worktree", "add", "-b", "lane", lane);
  git(repo, "switch", "-c", "interactive");
  git(repo, "worktree", "add", main, "main");
  writeFileSync(join(repo, "user-work.txt"), "preserve other work\n");
  writeFileSync(join(lane, "change.txt"), "reviewed candidate\n");
  git(lane, "add", ".");
  git(lane, "commit", "-m", "candidate");
  const originalHead = git(lane, "rev-parse", "HEAD");
  writeFileSync(
    join(lane, ".verifier-result.json"),
    "archived evidence unchanged\n"
  );
  const waiting = request();
  assert.equal(
    (await completeIntegration(waiting, { execute: defer })).status,
    "waiting"
  );
  const first = read(waiting);
  assert.equal(first.workerExitCode, 0);
  assert.equal(first.attempts.length, 1);
  assert.equal(first.attempts[0].exitCode, 75);
  const release = await acquireGateLease(lane);
  const queueBeforeProbe = readFileSync(
    gateLeasePath(lane) + ".queue.json",
    "utf8"
  );
  try {
    assert.equal((await resume()).action, "wait");
    assert.equal(
      readFileSync(gateLeasePath(lane) + ".queue.json", "utf8"),
      queueBeforeProbe,
      "publication readiness must not admit or consume a validation ticket"
    );
    assert.equal(
      executions,
      1,
      "busy validation must not start another 30-minute waiter or worker"
    );
    // Exercise the real resume probe during a legacy wx/write handover. It
    // must reobserve briefly without creating or consuming any queue entry.
    const leaseFile = gateLeasePath(lane);
    const originalRead = fs.readFileSync;
    const ownerBeforeProbe = originalRead(leaseFile, "utf8");
    const failures = [() => new SyntaxError("fixture partial lease")];
    if (process.platform === "win32")
      failures.push(() =>
        Object.assign(new Error("fixture temporary owner open denial"), {
          code: "EPERM",
          syscall: "open",
        })
      );
    for (const failure of failures) {
      for (const persistent of [false, true]) {
        let reads = 0;
        try {
          fs.readFileSync = (...args) => {
            if (args[0] === leaseFile && (persistent || reads++ < 3))
              throw failure();
            return originalRead(...args);
          };
          syncBuiltinESMExports();
          if (persistent)
            await assert.rejects(resume(), {
              code: "VALIDATION_OWNER_UNKNOWN",
            });
          else {
            assert.equal((await resume()).reason, "validation-lease");
            assert.equal(reads, 4);
          }
          assert.equal(executions, 1);
          assert.equal(originalRead(leaseFile, "utf8"), ownerBeforeProbe);
          assert.equal(
            originalRead(leaseFile + ".queue.json", "utf8"),
            queueBeforeProbe
          );
        } finally {
          fs.readFileSync = originalRead;
          syncBuiltinESMExports();
        }
      }
    }
    const originalKill = process.kill;
    let pidChecks = 0;
    try {
      process.kill = (pid, signal) => {
        if (pid === process.pid && signal === 0) {
          pidChecks++;
          throw Object.assign(new Error("fixture PID check denied"), {
            code: "EPERM",
            syscall: "kill",
          });
        }
        return originalKill(pid, signal);
      };
      await assert.rejects(resume(), { code: "VALIDATION_OWNER_UNKNOWN" });
      assert.equal(pidChecks, 1, "PID denial must fail without retry");
      assert.equal(originalRead(leaseFile, "utf8"), ownerBeforeProbe);
      assert.equal(
        originalRead(leaseFile + ".queue.json", "utf8"),
        queueBeforeProbe
      );
    } finally {
      process.kill = originalKill;
    }
  } finally {
    release();
  }
  const leaseFile = gateLeasePath(lane);
  writeFileSync(leaseFile, JSON.stringify({ pid: null, token: "unknown" }));
  await assert.rejects(resume(), { code: "VALIDATION_OWNER_UNKNOWN" });
  assert.equal(executions, 1);
  rmSync(leaseFile);
  assert.equal((await resume()).action, "wait");
  assert.equal(executions, 2);
  assert.equal(read(waiting).attempts.length, 2);
  assert.notEqual(
    read(waiting).outputLog,
    first.outputLog,
    "attempt logs must not overwrite previous evidence"
  );
  assert.equal(git(lane, "rev-parse", "HEAD"), originalHead);
  assert.equal(
    readFileSync(join(lane, ".verifier-result.json"), "utf8"),
    "archived evidence unchanged\n"
  );

  // A previous process can die after recording running. Alive, unknown, or a
  // reused PID is conservative wait; a confirmed exited publisher can resume.
  save({
    ...read(waiting),
    status: "running",
    ownerPid: process.pid,
    childPid: null,
  });
  const live = readFileSync(waiting.file, "utf8");
  assert.equal((await resume()).reason, "publication-owner");
  assert.equal(readFileSync(waiting.file, "utf8"), live);
  await assert.rejects(
    completeIntegration(waiting, { resume: true, execute: defer }),
    /still alive/
  );
  assert.equal(readFileSync(waiting.file, "utf8"), live);
  save({ ...read(waiting), status: "requested", workerExitCode: 0 });
  assert.equal(
    (await resume()).reason,
    "publication-owner",
    "worker success does not prove publisher exit"
  );
  save({ ...read(waiting), status: "waiting", ownerPid: exited.pid });
  assert.equal((await resume()).action, "wait");
  assert.equal(executions, 3);

  // Changed candidates cannot inherit a green receipt. Return actual repair to
  // the worker, rather than automatically publishing or resetting dirty work.
  writeFileSync(join(lane, "pending.txt"), "uncommitted repair\n");
  assert.equal((await resume()).action, "continue");
  assert.equal(read(waiting).status, "failed");
  assert.match(read(waiting).error, /clean committed/);
  assert.equal(executions, 3);
  assert.equal(
    readFileSync(join(lane, "pending.txt"), "utf8"),
    "uncommitted repair\n"
  );
  rmSync(join(lane, "pending.txt"));
  const changed = request();
  await completeIntegration(changed, { execute: defer });
  git(lane, "commit", "--allow-empty", "-m", "changed after request");
  assert.equal((await resume()).action, "continue");
  assert.match(read(changed).error, /changed after/);
  assert.equal(executions, 4);

  // Simulate a later normal publication or a crash after push but before its
  // local receipt. Reconcile by remote ancestry; do not execute another push.
  git(main, "merge", "--ff-only", "lane");
  git(main, "push", "origin", "main");
  const reconciled = await resume();
  assert.equal(reconciled.resolved, 2);
  assert.equal(executions, 4);
  assert.equal(read(waiting).resolution.kind, "included_in_remote");
  assert.equal(read(waiting).resolution.previousStatus, "failed");
  assert.match(read(waiting).resolution.previousError, /clean committed/);
  assert.equal(
    (await resume()).resolved,
    0,
    "resolved tickets must not replay"
  );
  assert.equal(
    readFileSync(join(repo, "user-work.txt"), "utf8"),
    "preserve other work\n"
  );
  const crashAfterPush = request();
  save({ ...read(crashAfterPush), ownerPid: exited.pid, workerExitCode: 0 });
  const alreadyPublished = await completeIntegration(crashAfterPush, {
    resume: true,
    execute: defer,
  });
  assert.equal(alreadyPublished.status, "completed");
  assert.equal(
    alreadyPublished.finishedAt,
    alreadyPublished.resolution.observedAt
  );
  assert.equal(
    read(crashAfterPush).finishedAt,
    read(crashAfterPush).resolution.observedAt
  );
  assert.equal(executions, 4);

  git(lane, "commit", "--allow-empty", "-m", "not yet published");
  const unknown = request();
  assert.equal(
    (await resume()).reason,
    "publication-owner",
    "a requesting worker must still be protected"
  );
  save({ ...read(unknown), ownerPid: exited.pid });
  assert.equal((await resume()).reason, "worker-outcome-unknown");
  assert.equal(executions, 4, "worker success cannot be guessed after restart");
  save({ ...read(unknown), status: "failed", error: "worker outcome unknown" });
  assert.equal(
    (await resume()).resolved,
    0,
    "unpublished descendants are not resolved by old remote main"
  );
  assert.equal(leaseFailureExit(leaseWaitError("wait", "VALIDATION_BUSY")), 75);
  assert.equal(
    leaseFailureExit(leaseWaitError("dead owner", "VALIDATION_OWNER_EXITED")),
    75
  );
  assert.equal(leaseFailureExit(new Error("test failure")), 1);
  const beforeSpawnCrash = request();
  const savedAttempt = "1".repeat(32),
    unstartedAttempt = "2".repeat(32);
  mkdirSync(join(repo, "logs/auto-merge-runs"), { recursive: true });
  const attemptRecord = {
    schemaVersion: 1,
    id: savedAttempt,
    repo,
    workdir: lane,
    branch: "lane",
    sourceHead: git(lane, "rev-parse", "HEAD"),
    pid: exited.pid,
    status: "failed",
  };
  writeFileSync(
    join(repo, "logs/auto-merge-runs", savedAttempt + ".json"),
    JSON.stringify(attemptRecord)
  );
  save({
    ...read(beforeSpawnCrash),
    status: "running",
    workerExitCode: 0,
    ownerPid: exited.pid,
    attemptId: unstartedAttempt,
    previousAttemptId: savedAttempt,
    attempts: [{ id: savedAttempt }, { id: unstartedAttempt }],
  });
  const crashTicket = readFileSync(beforeSpawnCrash.file, "utf8");
  const assertPublisherWait = async () => {
    assert.equal(
      (
        await resume({
          readRemote: () => {
            assert.fail(
              "unknown/live publisher must block before remote reads"
            );
          },
        })
      ).reason,
      "publication-owner"
    );
    await assert.rejects(
      completeIntegration(beforeSpawnCrash, { resume: true, execute: defer }),
      /still alive or its outcome is unknown/
    );
    assert.equal(readFileSync(beforeSpawnCrash.file, "utf8"), crashTicket);
    assert.equal(executions, 4, "do not duplicate a possibly live publisher");
  };
  // The parent can die after spawn but before persisting childPid, including
  // before the child has written its own record. Neither gap proves exit.
  await assertPublisherWait();
  const currentAttemptFile = join(
    repo,
    "logs/auto-merge-runs",
    unstartedAttempt + ".json"
  );
  const currentAttempt = {
    ...attemptRecord,
    id: unstartedAttempt,
    status: "running",
    pid: process.pid,
  };
  writeFileSync(currentAttemptFile, JSON.stringify(currentAttempt));
  await assertPublisherWait();
  // Even an exited PID is insufficient if its attempt/lane/source binding is
  // missing or changed. Malformed and unreadable records fail closed as well.
  for (const invalid of [
    { schemaVersion: 0 },
    { id: savedAttempt },
    { repo: main },
    { workdir: main },
    { branch: "main" },
    { sourceHead: "0".repeat(40) },
    { pid: null },
    { pid: -1 },
    { status: "unknown" },
  ]) {
    writeFileSync(
      currentAttemptFile,
      JSON.stringify({ ...currentAttempt, pid: exited.pid, ...invalid })
    );
    await assertPublisherWait();
  }
  for (const malformed of ["{", "null", "[]", "1", "{}"]) {
    writeFileSync(currentAttemptFile, malformed);
    await assertPublisherWait();
  }
  writeFileSync(
    currentAttemptFile,
    JSON.stringify({ ...currentAttempt, pid: exited.pid })
  );
  for (const liveness of ["alive", "unknown"]) {
    // A reused PID or an unreadable process must still stop publication even
    // when the attempt's other binding fields are valid.
    exitedState = liveness;
    await assertPublisherWait();
  }
  exitedState = "dead";
  writeFileSync(
    currentAttemptFile,
    JSON.stringify({ ...currentAttempt, pid: publisherChild.pid })
  );
  for (const liveness of ["alive", "unknown"]) {
    // Keep the owner dead so the attempt's distinct child is actually probed.
    childState = liveness;
    await assertPublisherWait();
  }
  childState = "dead";
  const retried = await completeIntegration(beforeSpawnCrash, {
    resume: true,
    deferReview: true,
    execute: async (item, options) => {
      assert.equal(item.previousAttemptId, unstartedAttempt);
      assert.equal(options.deferReview, true);
      return 75;
    },
  });
  assert.equal(retried.status, "waiting");
  console.log(
    "[test-supervisor-publication-recovery] passed: durable wait, live/dead owner and child attempt, interrupted spawn, immutable candidate, evidence retention, remote reconciliation, no replay, unknown worker outcome"
  );
} finally {
  process.kill = originalProcessKill;
  assert.equal(dirname(realpathSync(temp)), realpathSync(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
