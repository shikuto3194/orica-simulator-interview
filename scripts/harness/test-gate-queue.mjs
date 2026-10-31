import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs, {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  acquireGateLease,
  cancelGateRequest,
  discardGateRetry,
  gateLeasePath,
  inspectGateLease,
  leaseFailureExit,
} from "./gate-lease.mjs";
import { queueRequestKey, updateGateQueue } from "./gate-queue.mjs";
import state from "./verification-state.cjs";

const self = fileURLToPath(import.meta.url);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
);
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out: " + label);
    await sleep(10);
  }
}

async function fixture(root, mode, key, options) {
  if (mode === "alias-transaction") {
    process.send({ status: "attempting" });
    await updateGateQueue(options.file, (queue) => {
      const marker = join(root, "alias-executing");
      closeSync(openSync(marker, "wx"));
      process.send({ status: "acquired" });
      const deadline = Date.now() + 10000;
      while (options.holdFile && !existsSync(options.holdFile)) {
        assert.ok(Date.now() < deadline, "alias transaction release");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      queue.nextSequence++;
      unlinkSync(marker);
    });
    process.send({ status: "released" });
    process.disconnect();
    return;
  }
  const file = gateLeasePath(root);
  if (mode === "crash-mutex") {
    // Exit in the synchronous critical section: no finally can close the server.
    await updateGateQueue(file + ".queue.json", () => process.exit(23));
  }
  if (mode === "crash-waiter") {
    await updateGateQueue(file + ".queue.json", (queue, now) => {
      queue.entries.push({
        id: "crashed",
        key: "crashed",
        input: "fixture",
        sequence: queue.nextSequence++,
        enqueuedAt: now,
        expiresAt: now + 150,
        status: "waiting",
        attempt: "dead-process-incarnation",
      });
    });
    process.exit(24);
  }
  let release;
  try {
    if (mode === "legacy") {
      for (;;) {
        try {
          const fd = openSync(file, "wx");
          writeFileSync(
            fd,
            JSON.stringify({
              pid: process.pid,
              root,
              token: key,
              started: Date.now(),
            })
          );
          closeSync(fd);
          release = () => unlinkSync(file);
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          await sleep(5);
        }
      }
    } else
      release = await acquireGateLease(root, {
        pollMs: 10,
        timeoutMs: 12000,
        ...options,
        requestKey: key,
      });
    // A second exclusive marker independently detects lease overlap.
    const marker = join(root, "executing");
    closeSync(openSync(marker, "wx"));
    appendFileSync(join(root, "order"), key + "\n");
    process.send({ status: "acquired", receipt: release.receipt });
    await new Promise((ok) => process.once("message", ok));
    unlinkSync(marker);
    release();
    process.send({ status: "released" });
  } catch (error) {
    process.send({
      status: "error",
      code: error.code,
      message: error.message,
      cause: error.cause && {
        name: error.cause.name,
        code: error.cause.code,
        syscall: error.cause.syscall,
        message: error.cause.message,
      },
      receipt: error.receipt,
    });
    process.exitCode = leaseFailureExit(error);
  } finally {
    process.disconnect();
  }
}

export async function testGateQueue() {
  const root = mkdtempSync(join(tmpdir(), "orica-gate-queue-test-"));
  assert.equal(
    spawnSync("git", ["init", "-b", "main"], {
      cwd: root,
      env: cleanEnv,
      windowsHide: true,
    }).status,
    0
  );
  const file = gateLeasePath(root),
    queueFile = file + ".queue.json";
  const queue = () => JSON.parse(readFileSync(queueFile, "utf8"));
  const canonical = realpathSync(root);
  const hash = (key) =>
    queueRequestKey(
      process.platform === "win32" ? canonical.toLowerCase() : canonical,
      key
    );
  const children = [];
  function start(key, options = {}, mode = "wait") {
    const child = spawn(
      process.execPath,
      [self, "--fixture", root, mode, key, JSON.stringify(options)],
      {
        env: cleanEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    );
    const item = { child, messages: [], output: "", exit: undefined };
    children.push(item);
    child.on("message", (message) => item.messages.push(message));
    child.stdout.on("data", (bytes) => {
      item.output += bytes;
    });
    child.stderr.on("data", (bytes) => {
      item.output += bytes;
    });
    child.on("exit", (code) => {
      item.exit = code;
    });
    return item;
  }
  async function message(item, status) {
    await until(
      () =>
        item.messages.some((entry) => entry.status === status) ||
        item.exit !== undefined,
      status + ": " + item.output
    );
    const result = item.messages.find((entry) => entry.status === status);
    assert.ok(result, JSON.stringify(item.messages) + item.output);
    return result;
  }
  async function releaseChild(item) {
    item.child.send("release");
    await message(item, "released");
    await until(() => item.exit !== undefined, "child exit");
    assert.equal(item.exit, 0, item.output);
  }
  let release;
  try {
    // Different path spellings must serialize the same queue transaction.
    // A junction/symlink and Windows case variation exercise real aliases.
    const realDirectory = join(root, "queue-directory");
    const aliasDirectory = join(root, "queue-alias");
    mkdirSync(realDirectory);
    symlinkSync(
      realDirectory,
      aliasDirectory,
      process.platform === "win32" ? "junction" : "dir"
    );
    const realFile = join(realDirectory, "alias.queue.json");
    let aliasFile = join(aliasDirectory, "alias.queue.json");
    if (process.platform === "win32") aliasFile = aliasFile.toUpperCase();
    const holdFile = join(root, "release-alias-transaction");
    const aliasOwner = start(
      "alias-owner",
      { file: realFile, holdFile },
      "alias-transaction"
    );
    await message(aliasOwner, "acquired");
    const aliasWaiter = start(
      "alias-waiter",
      { file: aliasFile },
      "alias-transaction"
    );
    await message(aliasWaiter, "attempting");
    await sleep(100);
    assert.equal(aliasWaiter.exit, undefined, aliasWaiter.output);
    assert.equal(
      aliasWaiter.messages.some((entry) => entry.status === "acquired"),
      false,
      "path aliases must share one mutex"
    );
    writeFileSync(holdFile, "release");
    await message(aliasOwner, "released");
    await message(aliasWaiter, "released");
    await until(
      () => aliasOwner.exit !== undefined && aliasWaiter.exit !== undefined,
      "alias transactions exit"
    );
    assert.equal(aliasOwner.exit, 0, aliasOwner.output);
    assert.equal(aliasWaiter.exit, 0, aliasWaiter.output);
    assert.equal(JSON.parse(readFileSync(realFile, "utf8")).nextSequence, 3);
    rmSync(aliasDirectory);

    // Five independently scheduled processes must execute by admission number.
    release = await acquireGateLease(root);
    const racers = [];
    for (let i = 0; i < 5; i++) {
      racers.push(start("fifo-" + i, { pollMs: i === 0 ? 100 : 5 }));
      await until(
        () => queue().entries.some((entry) => entry.key === hash("fifo-" + i)),
        "FIFO registration"
      );
    }
    release();
    release = null;
    for (const racer of racers) {
      await message(racer, "acquired");
      await releaseChild(racer);
    }
    assert.deepEqual(
      readFileSync(join(root, "order"), "utf8").trim().split("\n"),
      Array.from({ length: 5 }, (_, i) => "fifo-" + i)
    );

    release = await acquireGateLease(root);
    const simultaneous = Array.from({ length: 5 }, (_, i) =>
      start("simultaneous-" + i)
    );
    await until(
      () => queue().entries.length === 5,
      "simultaneous registrations"
    );
    const admissionOrder = queue().entries.map((entry) => entry.key);
    release();
    release = null;
    for (const key of admissionOrder) {
      const index = simultaneous.findIndex(
        (_, i) => hash("simultaneous-" + i) === key
      );
      await message(simultaneous[index], "acquired");
      await releaseChild(simultaneous[index]);
    }
    const executionOrder = readFileSync(join(root, "order"), "utf8")
      .trim()
      .split("\n")
      .slice(-5)
      .map(hash);
    assert.deepEqual(
      executionOrder,
      admissionOrder,
      "simultaneous admissions have one total order"
    );

    // A process timeout and exit retain age across a new process, before B.
    release = await acquireGateLease(root);
    const first = start("retry", { timeoutMs: 20 });
    const timedOut = await message(first, "error");
    assert.equal(timedOut.code, "VALIDATION_BUSY");
    await until(() => first.exit !== undefined, "timed out process exit");
    assert.equal(first.exit, 75);
    const next = start("after-retry");
    await until(() => queue().entries.length === 2, "second registration");
    const retry = start("retry");
    await until(
      () => queue().entries[0]?.status === "waiting",
      "original receipt reactivated"
    );
    release();
    release = null;
    assert.deepEqual(
      (await message(retry, "acquired")).receipt,
      timedOut.receipt
    );
    assert.equal(next.messages.length, 0, "resumed older request goes first");
    await releaseChild(retry);
    await message(next, "acquired");
    await releaseChild(next);
    const fresh = await acquireGateLease(root, { requestKey: "retry" });
    assert.notEqual(
      fresh.receipt.id,
      timedOut.receipt.id,
      "completed receipt cannot be replayed"
    );
    fresh();
    const newer = await acquireGateLease(root, { requestKey: "newer" });
    fresh();
    assert.equal(
      existsSync(file),
      true,
      "stale release cannot remove a new owner's lease"
    );
    await assert.rejects(acquireGateLease(root, { requestKey: "newer" }), {
      code: "VALIDATION_DUPLICATE",
    });
    newer();

    // An inactive retry permits ready work, then rejoins ahead of remaining
    // younger waiters without preempting the owner that already acquired.
    release = await acquireGateLease(root);
    const dormant = start("dormant", { timeoutMs: 20 });
    const dormantError = await message(dormant, "error");
    assert.equal(dormantError.code, "VALIDATION_BUSY");
    await until(() => dormant.exit !== undefined, "dormant caller exit");
    const ready = start("ready-before-resume");
    await until(() => queue().entries.length === 2, "ready follower");
    release();
    release = null;
    await message(ready, "acquired");
    assert.equal(queue().entries[0].id, dormantError.receipt.id);
    assert.equal(queue().entries[0].status, "retry");
    const remaining = start("remaining-after-resume");
    await until(() => queue().entries.length === 2, "remaining follower");
    const resumed = start("dormant");
    await until(
      () => queue().entries[0]?.status === "waiting",
      "dormant reactivation behind current owner"
    );
    assert.equal(resumed.messages.length, 0, "cannot preempt current owner");
    await releaseChild(ready);
    assert.deepEqual(
      (await message(resumed, "acquired")).receipt,
      dormantError.receipt
    );
    assert.equal(
      remaining.messages.length,
      0,
      "original age precedes follower"
    );
    await releaseChild(resumed);
    await message(remaining, "acquired");
    await releaseChild(remaining);

    // Active duplicates, even in the same PID, cannot take over or refresh.
    release = await acquireGateLease(root);
    const controller = new globalThis.AbortController();
    const pending = acquireGateLease(root, {
      requestKey: "duplicate",
      pollMs: 5,
      signal: controller.signal,
    });
    const aborted = assert.rejects(pending, { name: "AbortError" });
    await until(() => queue().entries.length === 1, "duplicate registration");
    const before = queue().entries[0];
    await assert.rejects(
      acquireGateLease(root, { requestKey: "duplicate", pollMs: 5 }),
      { code: "VALIDATION_DUPLICATE" }
    );
    assert.equal(queue().entries[0].attempt, before.attempt);
    controller.abort();
    await aborted;
    assert.equal(
      queue().entries.length,
      0,
      "abort removes only its own attempt"
    );
    release();
    release = null;

    // Exact cancellation is fenced by receipt ID; expiration and changed input
    // create a new receipt at the tail, never revive an expired attempt.
    release = await acquireGateLease(root);
    let old;
    await assert.rejects(
      acquireGateLease(root, { requestKey: "cancel", timeoutMs: -1 }),
      (error) => {
        old = error.receipt;
        return error.code === "VALIDATION_BUSY";
      }
    );
    assert.equal(
      await cancelGateRequest(root, {
        requestKey: "cancel",
        receiptId: "wrong",
      }),
      false
    );
    assert.equal(
      await cancelGateRequest(root, {
        requestKey: "cancel",
        receiptId: old.id,
      }),
      true
    );
    const replacement = start("cancel", { requestInput: "new" });
    await until(() => queue().entries.length === 1, "replacement registration");
    assert.equal(
      await cancelGateRequest(root, {
        requestKey: "cancel",
        receiptId: old.id,
      }),
      false
    );
    release();
    release = null;
    assert.notEqual(
      (await message(replacement, "acquired")).receipt.id,
      old.id
    );
    await releaseChild(replacement);

    release = await acquireGateLease(root);
    await assert.rejects(
      acquireGateLease(root, {
        requestKey: "changed",
        requestInput: "old",
        timeoutMs: -1,
      }),
      (error) => {
        old = error.receipt;
        return true;
      }
    );
    const ahead = start("already-waiting");
    await until(() => queue().entries.length === 2, "changed input follower");
    const changed = start("changed", { requestInput: "new" });
    await until(
      () => queue().entries.at(-1)?.key === hash("changed"),
      "changed input readmission"
    );
    release();
    release = null;
    await message(ahead, "acquired");
    await releaseChild(ahead);
    assert.ok(
      (await message(changed, "acquired")).receipt.sequence > old.sequence
    );
    await releaseChild(changed);

    // Dormant retry expiry and dead waiting process cannot block successors.
    release = await acquireGateLease(root);
    await assert.rejects(
      acquireGateLease(root, {
        requestKey: "expired",
        timeoutMs: -1,
        retryGraceMs: 60,
      }),
      /timed out/
    );
    release();
    release = null;
    await sleep(70);
    const afterExpiry = await acquireGateLease(root, {
      timeoutMs: 1000,
      pollMs: 5,
    });
    afterExpiry();
    assert.equal(queue().entries.length, 0, "expired retry is removed");
    release = await acquireGateLease(root);
    await assert.rejects(
      acquireGateLease(root, {
        requestKey: "cached",
        requestInput: "same",
        timeoutMs: -1,
      }),
      /timed out/
    );
    await discardGateRetry(root, {
      requestKey: "cached",
      requestInput: "other",
    });
    assert.equal(queue().entries.length, 1);
    await discardGateRetry(root, {
      requestKey: "cached",
      requestInput: "same",
    });
    assert.equal(queue().entries.length, 0);
    release();
    release = null;
    const crashed = start("unused", {}, "crash-waiter");
    await until(() => crashed.exit !== undefined, "waiter crash");
    assert.equal(crashed.exit, 24);
    const afterCrash = await acquireGateLease(root, {
      timeoutMs: 1000,
      pollMs: 5,
    });
    afterCrash();
    const guardCrash = start("unused", {}, "crash-mutex");
    await until(() => guardCrash.exit !== undefined, "mutex crash");
    assert.equal(guardCrash.exit, 23);
    const afterGuardCrash = await acquireGateLease(root, { timeoutMs: 1000 });
    afterGuardCrash();

    // Simulate a suspended waiter / reused PID: expiration invalidates the old
    // token while the same live process is still trying to continue.
    release = await acquireGateLease(root);
    const suspended = acquireGateLease(root, {
      requestKey: "suspended",
      pollMs: 20,
    });
    const rejected = assert.rejects(suspended, { code: "VALIDATION_EXPIRED" });
    await until(() => queue().entries.length === 1, "suspended admission");
    await updateGateQueue(queueFile, (data) => {
      data.entries[0].expiresAt = 0;
    });
    await rejected;
    release();
    release = null;

    // Legacy owner / waiter coexistence preserves exclusion, without claiming
    // FIFO for callers that have never registered in the new queue.
    const legacy = start("legacy-owner", {}, "legacy");
    await message(legacy, "acquired");
    const modern = start("modern");
    await until(() => queue().entries.length === 1, "modern behind legacy");
    await releaseChild(legacy);
    await message(modern, "acquired");
    const legacyWaiter = start("legacy-waiter", {}, "legacy");
    await sleep(30);
    assert.equal(legacyWaiter.messages.length, 0);
    await releaseChild(modern);
    await message(legacyWaiter, "acquired");
    await releaseChild(legacyWaiter);

    // A releasing owner may exit after its file was read but before kill(0).
    // These are private fixture files, never recovery of a real shared lease.
    const raceOriginalKill = process.kill;
    const fixturePid = 2147483647;
    try {
      for (const mode of [
        "released",
        "replaced-live",
        "replaced-dead",
        "unchanged-dead",
        "unchanged-denied",
      ]) {
        const before = JSON.stringify({ pid: fixturePid, token: "old-owner" });
        const replacement = JSON.stringify({
          pid: mode === "replaced-live" ? process.pid : fixturePid,
          token: "new-owner",
        });
        writeFileSync(file, before);
        let injected = false;
        process.kill = (pid, signal) => {
          if (pid !== fixturePid) return raceOriginalKill(pid, signal);
          if (!injected) {
            injected = true;
            if (mode === "released") unlinkSync(file);
            if (mode.startsWith("replaced")) writeFileSync(file, replacement);
          }
          throw Object.assign(
            new Error("fixture owner exited after snapshot"),
            {
              code: mode === "unchanged-denied" ? "EPERM" : "ESRCH",
              syscall: "kill",
            }
          );
        };
        if (mode === "released") {
          assert.equal(await inspectGateLease(root), null);
          assert.equal(existsSync(file), false);
        } else if (mode === "replaced-live") {
          assert.equal((await inspectGateLease(root)).token, "new-owner");
          assert.equal(readFileSync(file, "utf8"), replacement);
        } else {
          await assert.rejects(inspectGateLease(root), {
            code:
              mode === "unchanged-denied"
                ? "VALIDATION_OWNER_UNKNOWN"
                : "VALIDATION_OWNER_EXITED",
          });
          assert.equal(
            readFileSync(file, "utf8"),
            mode === "replaced-dead" ? replacement : before
          );
        }
        process.kill = raceOriginalKill;
        if (existsSync(file)) unlinkSync(file);
      }
    } finally {
      process.kill = raceOriginalKill;
    }

    // Handover read errors can occur after a long wait and more than once.
    // Inject reads only for this isolated fixture's owner file.
    release = await acquireGateLease(root);
    const originalRead = fs.readFileSync;
    const readController = new globalThis.AbortController();
    let remainingReads = 0,
      injectedReads = 0,
      recoveredReads = 0,
      readFailure,
      readOutcome,
      pendingRead;
    try {
      fs.readFileSync = (...args) => {
        if (args[0] === file) {
          if (remainingReads > 0) {
            remainingReads--;
            injectedReads++;
            throw readFailure();
          }
          const result = originalRead(...args);
          recoveredReads++;
          return result;
        }
        return originalRead(...args);
      };
      syncBuiltinESMExports();
      pendingRead = acquireGateLease(root, {
        requestKey: "read-transition",
        pollMs: 5,
        timeoutMs: 10000,
        signal: readController.signal,
      }).then(
        (acquired) => (readOutcome = { acquired }),
        (error) => (readOutcome = { error })
      );
      await until(
        () => queue().entries.length === 1,
        "read transition admission"
      );
      await sleep(1050);
      const readFailures = [
        () => new SyntaxError("fixture partial owner JSON"),
      ];
      if (process.platform === "win32")
        readFailures.push(() =>
          Object.assign(new Error("fixture owner handover"), {
            code: "EPERM",
            syscall: "open",
          })
        );
      for (const failure of readFailures) {
        readFailure = failure;
        injectedReads = 0;
        remainingReads = 3;
        await until(
          () => injectedReads === 3 || readOutcome,
          "transient owner reads"
        );
        assert.equal(
          readOutcome,
          undefined,
          "must keep waiting for the live owner"
        );
        const recoveredBefore = recoveredReads;
        await until(
          () => recoveredReads > recoveredBefore || readOutcome,
          "owner read recovery"
        );
        assert.equal(readOutcome, undefined);
      }
      assert.equal(queue().entries.length, 1);
      release();
      release = null;
      await pendingRead;
      assert.equal(readOutcome.error, undefined);
      readOutcome.acquired();
      readOutcome = undefined;
    } finally {
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
      readController.abort();
      await pendingRead;
      readOutcome?.acquired?.();
    }

    // A persistent unreadable owner and a denied PID check remain fail-closed.
    release = await acquireGateLease(root);
    const preservedOwner = originalRead(file, "utf8");
    try {
      fs.readFileSync = (...args) => {
        if (args[0] === file)
          throw process.platform === "win32"
            ? Object.assign(new Error("fixture denied owner read"), {
                code: "EACCES",
                syscall: "open",
              })
            : new SyntaxError("fixture persistent malformed owner");
        return originalRead(...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(
        acquireGateLease(root, { pollMs: 5, timeoutMs: 5000 }),
        {
          code: "VALIDATION_OWNER_UNKNOWN",
        }
      );
      assert.equal(originalRead(file, "utf8"), preservedOwner);
      assert.equal(queue().entries.length, 0);
    } finally {
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
    }
    const originalKill = process.kill;
    let killChecks = 0;
    try {
      process.kill = (pid, signal) => {
        if (pid === process.pid && signal === 0) {
          killChecks++;
          throw Object.assign(new Error("fixture denied PID check"), {
            code: "EPERM",
            syscall: "kill",
          });
        }
        return originalKill(pid, signal);
      };
      await assert.rejects(
        acquireGateLease(root, { pollMs: 5, timeoutMs: 5000 }),
        {
          code: "VALIDATION_OWNER_UNKNOWN",
        }
      );
      assert.equal(
        killChecks,
        1,
        "PID check denial is never a transient file read"
      );
      assert.equal(originalRead(file, "utf8"), preservedOwner);
    } finally {
      process.kill = originalKill;
    }
    release();
    release = null;

    // Unknown / dead ownership and malformed queue are preserved, not stolen.
    const original = readFileSync(queueFile, "utf8");
    writeFileSync(queueFile, "{");
    await assert.rejects(acquireGateLease(root), SyntaxError);
    assert.equal(readFileSync(queueFile, "utf8"), "{");
    writeFileSync(queueFile, original);
    for (const [owner, code] of [
      [{ pid: null, token: "unknown" }, "VALIDATION_OWNER_UNKNOWN"],
      [{ pid: 99999999, token: "dead" }, "VALIDATION_OWNER_EXITED"],
    ]) {
      writeFileSync(file, JSON.stringify(owner));
      await assert.rejects(acquireGateLease(root, { timeoutMs: -1 }), { code });
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), owner);
      unlinkSync(file);
    }
    // Failure after wx acquisition but before persisting consumption must
    // release only this owner's lease and abandon its waiting attempt.
    const atomicJson = state.atomicJson;
    let writes = 0;
    if (process.platform === "win32") {
      try {
        state.atomicJson = (...args) => {
          if (args[0] === queueFile && ++writes === 2)
            throw Object.assign(new Error("fixture temporary reader"), {
              code: "EPERM",
            });
          return atomicJson(...args);
        };
        const nextSequence = queue().nextSequence;
        const afterTransient = await acquireGateLease(root);
        assert.equal(afterTransient.receipt.sequence, nextSequence);
        assert.equal(
          queue().nextSequence,
          nextSequence + 1,
          "commit retry never repeats the mutation"
        );
        afterTransient();
      } finally {
        state.atomicJson = atomicJson;
      }
    }
    writes = 0;
    try {
      state.atomicJson = (...args) => {
        if (args[0] === queueFile && ++writes === 2)
          throw new Error("fixture queue disk failure");
        return atomicJson(...args);
      };
      await assert.rejects(
        acquireGateLease(root),
        /fixture queue disk failure/
      );
    } finally {
      state.atomicJson = atomicJson;
    }
    assert.equal(existsSync(file), false);
    assert.equal(queue().entries.length, 0);
    console.log(
      "[test-gate-queue] FIFO(5 processes), retry, duplicate, cancel, expiry, crash, fencing, legacy exclusion and fail-closed passed"
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        children.map(({ messages, output, exit }) => ({
          messages,
          output,
          exit,
        })),
        null,
        2
      )
    );
    throw error;
  } finally {
    release?.();
    // These are exclusively this test's children, never repository validators.
    for (const item of children) if (item.exit === undefined) item.child.kill();
    await Promise.all(
      children
        .filter((item) => item.exit === undefined)
        .map((item) => new Promise((ok) => item.child.once("exit", ok)))
    );
    for (const path of [file, queueFile])
      if (existsSync(path)) unlinkSync(path);
    assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--fixture")
  await fixture(
    process.argv[3],
    process.argv[4],
    process.argv[5],
    JSON.parse(process.argv[6])
  );
else if (process.argv[1] && resolve(process.argv[1]) === self)
  await testGateQueue();
