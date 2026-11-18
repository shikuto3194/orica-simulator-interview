import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import state from "./verification-state.cjs";

// Only the short synchronous queue transaction holds this kernel mutex. There
// is no daemon, lock-file takeover, PID identity, or stale mutex to recover.
// Linux abstract sockets and Windows named pipes disappear on process death.
// Other systems use an exclusive loopback port; a collision fails closed.
function address(file) {
  // The file need not exist yet. Resolve its parent so junctions, short paths,
  // and Windows case aliases of one queue cannot create separate mutexes.
  const canonical = join(realpathSync(dirname(file)), basename(file));
  const key = createHash("sha256")
    .update(process.platform === "win32" ? canonical.toLowerCase() : canonical)
    .digest("hex");
  if (process.platform === "win32")
    return { path: `\\\\.\\pipe\\orica-gate-queue-${key}` };
  if (process.platform === "linux")
    return { path: `\0orica-gate-queue-${key}` };
  return {
    host: "127.0.0.1",
    port: 49152 + (Number.parseInt(key.slice(0, 8), 16) % 16384),
    exclusive: true,
  };
}

async function transaction(file, action) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const server = createServer((socket) => socket.destroy());
    const acquired = await new Promise((ok, fail) => {
      server.once("error", (error) =>
        error.code === "EADDRINUSE" ? ok(false) : fail(error)
      );
      server.listen(address(file), () => ok(true));
    });
    if (acquired) {
      try {
        return action();
      } finally {
        await new Promise((ok, fail) =>
          server.close((error) => (error ? fail(error) : ok()))
        );
      }
    }
    if (Date.now() >= deadline)
      throw new Error("Verification queue transaction busy: " + file);
    await sleep(20);
  }
}

function readQueue(file) {
  let queue;
  try {
    queue = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      return { schemaVersion: 1, nextSequence: 1, entries: [] };
    throw error;
  }
  if (
    queue?.schemaVersion !== 1 ||
    !Number.isSafeInteger(queue.nextSequence) ||
    queue.nextSequence < 1 ||
    !Array.isArray(queue.entries) ||
    queue.entries.some(
      (entry, index) =>
        typeof entry.id !== "string" ||
        typeof entry.key !== "string" ||
        typeof entry.input !== "string" ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 1 ||
        entry.sequence >= queue.nextSequence ||
        (index > 0 && entry.sequence <= queue.entries[index - 1].sequence) ||
        !Number.isFinite(entry.enqueuedAt) ||
        !Number.isFinite(entry.expiresAt) ||
        !["waiting", "retry"].includes(entry.status) ||
        (entry.status === "waiting" && typeof entry.attempt !== "string")
    ) ||
    new Set(queue.entries.map((entry) => entry.key)).size !==
      queue.entries.length ||
    new Set(queue.entries.map((entry) => entry.id)).size !==
      queue.entries.length
  )
    throw new Error("Invalid verification queue: " + file);
  return queue;
}

export function queueReceipt(entry) {
  return {
    id: entry.id,
    sequence: entry.sequence,
    enqueuedAt: entry.enqueuedAt,
  };
}

// requestKey identifies one operation, not a process. Only an explicit retry
// state can be adopted; concurrent callers cannot renew or steal an attempt.
export function queueRequestKey(root, requestKey) {
  return createHash("sha256")
    .update(JSON.stringify([root, requestKey]))
    .digest("hex");
}

export async function updateGateQueue(file, action) {
  return transaction(file, () => {
    const queue = readQueue(file);
    const now = Date.now();
    queue.entries = queue.entries.filter((entry) => entry.expiresAt > now);
    const result = action(queue, now);
    // Windows can briefly reject replacement while a status reader/AV holds
    // the destination. Retry only the commit, under the same mutex; replaying
    // action could issue a second admission or acquire another lease.
    const deadline = Date.now() + 1000;
    for (;;) {
      try {
        state.atomicJson(file, queue);
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
          Date.now() >= deadline
        )
          throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    return result;
  });
}

export function admitGateRequest(
  queue,
  { key, input, attempt, activeTtlMs },
  now
) {
  let entry = queue.entries.find((item) => item.key === key);
  if (entry?.status === "waiting")
    throw Object.assign(new Error("Verification request already waiting"), {
      code: "VALIDATION_DUPLICATE",
      receipt: queueReceipt(entry),
    });
  // A changed job retires its abandoned retry, but cannot cancel a live waiter.
  if (entry && entry.input !== input) {
    queue.entries.splice(queue.entries.indexOf(entry), 1);
    entry = undefined;
  }
  if (!entry) {
    if (!Number.isSafeInteger(queue.nextSequence + 1))
      throw new Error("Verification queue sequence exhausted");
    entry = {
      key,
      input,
      id: randomUUID(),
      sequence: queue.nextSequence++,
      enqueuedAt: now,
    };
    queue.entries.push(entry);
  }
  Object.assign(entry, {
    attempt,
    status: "waiting",
    expiresAt: now + activeTtlMs,
  });
  return queueReceipt(entry);
}
