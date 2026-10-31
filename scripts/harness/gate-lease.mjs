import {
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import state from "./verification-state.cjs";
import {
  admitGateRequest,
  queueRequestKey,
  updateGateQueue,
} from "./gate-queue.mjs";
// A resource wait is resumable; a failed test, unreadable owner, or I/O error is
// not. Keep the distinction at the lease boundary instead of parsing log prose.
export const LEASE_WAIT_EXIT = 75;
export function leaseWaitError(message, code, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}
export function leaseFailureExit(error) {
  return [
    "VALIDATION_BUSY",
    "VALIDATION_OWNER_EXITED",
    "VALIDATION_EXPIRED",
  ].includes(error?.code)
    ? LEASE_WAIT_EXIT
    : 1;
}
export function gateLeasePath(root) {
  const common = state
    .git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    .trim();
  const key = createHash("sha256").update(common.toLowerCase()).digest("hex");
  return join(tmpdir(), "orica-validation-" + key + ".lock");
}

function inspectOwner(file) {
  let owner, ownerText;
  try {
    ownerText = readFileSync(file, "utf8");
    owner = JSON.parse(ownerText);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw leaseWaitError(
      "Cannot inspect verification lease: " + file,
      "VALIDATION_OWNER_UNKNOWN",
      error
    );
  }
  if (
    !Number.isInteger(owner?.pid) ||
    owner.pid <= 0 ||
    typeof owner.token !== "string" ||
    !owner.token
  )
    throw leaseWaitError(
      "Invalid verification lease owner: " + file,
      "VALIDATION_OWNER_UNKNOWN"
    );
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    // Normal release can unlink the snapshot and exit before kill(0). Only
    // diagnose a dead/unknown owner if the same lease bytes are still present.
    // A replacement is observed again; no reader removes or acquires its file.
    let currentText;
    try {
      currentText = readFileSync(file, "utf8");
    } catch (readError) {
      if (readError.code === "ENOENT") return null;
      throw leaseWaitError(
        "Cannot inspect verification lease after owner check: " + file,
        "VALIDATION_OWNER_UNKNOWN",
        readError
      );
    }
    if (currentText !== ownerText) return pendingOwnerRead;
    throw leaseWaitError(
      error.code === "ESRCH"
        ? "Verification owner exited; inspect and remove its stale lease before retrying: " +
            file
        : "Cannot inspect verification owner: " + file,
      error.code === "ESRCH"
        ? "VALIDATION_OWNER_EXITED"
        : "VALIDATION_OWNER_UNKNOWN",
      error
    );
  }
  return owner;
}

const pendingOwnerRead = Symbol("pending owner read");
function ownerObserver(file) {
  let failedAt;
  return () => {
    try {
      const owner = inspectOwner(file);
      failedAt = undefined;
      return owner;
    } catch (error) {
      // A legacy writer may still be filling its wx file, and Windows can
      // briefly deny opens during unlink. Never treat either as a free slot
      // or retry a PID-liveness failure for an unchanged lease snapshot.
      // Bound each continuous read failure.
      const transientRead =
        error.code === "VALIDATION_OWNER_UNKNOWN" &&
        (error.cause instanceof SyntaxError ||
          (process.platform === "win32" &&
            ["EPERM", "EACCES", "EBUSY"].includes(error.cause?.code) &&
            ["open", "read"].includes(error.cause?.syscall)));
      if (transientRead) {
        failedAt ??= Date.now();
        if (Date.now() - failedAt < 1000) return pendingOwnerRead;
      }
      throw error;
    }
  };
}

// Publication startup is an observation, not a second admission before its
// actual run-gates request. It must neither consume nor bypass a FIFO ticket.
export async function inspectGateLease(root) {
  const observe = ownerObserver(gateLeasePath(root));
  for (;;) {
    const owner = observe();
    if (owner !== pendingOwnerRead) return owner;
    await sleep(25);
  }
}

function requestKey(root, key) {
  const canonical = realpathSync(root);
  return queueRequestKey(
    process.platform === "win32" ? canonical.toLowerCase() : canonical,
    key
  );
}

export async function cancelGateRequest(root, { requestKey: key, receiptId }) {
  if (
    typeof key !== "string" ||
    !key ||
    typeof receiptId !== "string" ||
    !receiptId
  )
    throw new Error("Cancellation requires requestKey and receiptId");
  return updateGateQueue(gateLeasePath(root) + ".queue.json", (queue) => {
    const index = queue.entries.findIndex(
      (entry) => entry.key === requestKey(root, key) && entry.id === receiptId
    );
    if (index < 0) return false;
    queue.entries.splice(index, 1);
    return true;
  });
}

// A now fully cached verification is complete without using the resource. Close
// only its abandoned retry; never cancel a live concurrent attempt or owner.
export async function discardGateRetry(
  root,
  { requestKey: key, requestInput = "" }
) {
  const input = createHash("sha256").update(requestInput).digest("hex");
  return updateGateQueue(gateLeasePath(root) + ".queue.json", (queue) => {
    const index = queue.entries.findIndex(
      (entry) =>
        entry.key === requestKey(root, key) &&
        entry.input === input &&
        entry.status === "retry"
    );
    if (index >= 0) queue.entries.splice(index, 1);
  });
}

export async function acquireGateLease(root, options = {}) {
  const file = gateLeasePath(root),
    queueFile = file + ".queue.json";
  const token = randomUUID(),
    started = Date.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollMs = options.pollMs ?? 1000;
  const activeTtlMs = options.activeTtlMs ?? 120_000;
  const retryGraceMs = options.retryGraceMs ?? 60 * 60_000;
  if (
    ![timeoutMs, pollMs, activeTtlMs, retryGraceMs].every(Number.isFinite) ||
    pollMs <= 0 ||
    activeTtlMs <= pollMs ||
    retryGraceMs < 0 ||
    (options.requestKey !== undefined &&
      (typeof options.requestKey !== "string" || !options.requestKey)) ||
    (options.requestInput !== undefined &&
      typeof options.requestInput !== "string")
  )
    throw new Error("Invalid verification queue options");
  const key = requestKey(root, options.requestKey ?? token);
  const input = createHash("sha256")
    .update(options.requestInput ?? "")
    .digest("hex");
  const observeOwner = ownerObserver(file);
  let receipt,
    held = false,
    announced = false;
  const controller = new globalThis.AbortController();
  const signal = options.signal ?? controller.signal;
  const interrupt = () => controller.abort();
  if (!options.signal) {
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
  }
  const release = () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).token === token)
        unlinkSync(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    held = false;
  };
  try {
    signal.throwIfAborted();
    receipt = await updateGateQueue(queueFile, (queue, now) =>
      admitGateRequest(queue, { key, input, attempt: token, activeTtlMs }, now)
    );
    for (;;) {
      signal.throwIfAborted();
      const acquired = await updateGateQueue(queueFile, (queue, now) => {
        signal.throwIfAborted();
        const entry = queue.entries.find((item) => item.id === receipt.id);
        if (!entry || entry.attempt !== token || entry.status !== "waiting")
          throw leaseWaitError(
            "Verification queue admission expired or cancelled",
            "VALIDATION_EXPIRED"
          );
        entry.expiresAt = now + activeTtlMs;
        const owner = observeOwner();
        if (owner === pendingOwnerRead) return false;
        if (owner?.requestKey === key)
          throw leaseWaitError(
            "Verification request already running",
            "VALIDATION_DUPLICATE"
          );
        // A dormant retry keeps its age, but cannot block the prerequisite
        // stages that must run before its caller can resume it (merge -> fuzz).
        // Reactivation rejoins waiting requests at the original sequence.
        const firstWaiting = queue.entries.find(
          (item) => item.status === "waiting"
        );
        if (owner || firstWaiting !== entry) return false;
        let fd;
        try {
          fd = openSync(file, "wx");
        } catch (error) {
          if (error.code === "EEXIST") return false; // A legacy waiter won.
          throw error;
        }
        try {
          writeFileSync(
            fd,
            JSON.stringify({
              pid: process.pid,
              token,
              root,
              started: Date.now(),
              requestKey: key,
              receipt,
            })
          );
          held = true;
        } finally {
          closeSync(fd);
        }
        queue.entries.splice(queue.entries.indexOf(entry), 1);
        return true;
      });
      if (acquired) {
        signal.throwIfAborted();
        release.receipt = receipt;
        return release;
      }
      if (Date.now() - started > timeoutMs)
        throw leaseWaitError(
          "Verification lease wait timed out: " + file,
          "VALIDATION_BUSY"
        );
      if (!announced) {
        console.log(
          `[verify] waiting in FIFO queue #${receipt.sequence} (${receipt.id}); enqueued ${new Date(receipt.enqueuedAt).toISOString()}`
        );
        announced = true;
      }
      await sleep(pollMs, undefined, { signal });
    }
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error("Verification wait cancelled", { cause });
    if (held) release();
    if (receipt) {
      error.receipt = receipt;
      await updateGateQueue(queueFile, (queue, now) => {
        const index = queue.entries.findIndex(
          (entry) => entry.id === receipt.id && entry.attempt === token
        );
        if (index < 0) return;
        if (
          options.requestKey &&
          retryGraceMs > 0 &&
          ["VALIDATION_BUSY", "VALIDATION_OWNER_EXITED"].includes(error.code)
        ) {
          Object.assign(queue.entries[index], {
            status: "retry",
            attempt: null,
            expiresAt: now + retryGraceMs,
          });
        } else queue.entries.splice(index, 1);
      });
    }
    throw error;
  } finally {
    if (!options.signal) {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
}
