// Shared admission for the lower Windows scheduler. Full program accounting,
// output enforcement and production/calibration acceptance remain unavailable.
import { randomUUID } from "node:crypto";
import { setTimeout, clearTimeout } from "node:timers";
import { performance } from "node:perf_hooks";
import { programPaths } from "./shared.mjs";
import { previewNextChunk, reserveNextChunk } from "./budget.mjs";
import { createWindowsJob, validateWindowsJobRequest } from "./windows-job.mjs";
import { createWindowsResourceController } from "./windows-resource-controller.mjs";
import {
  bindWindowsServiceReader,
  readWindowsServiceBusy,
} from "./windows-service-state.mjs";
import { runWindowsResourceLoop } from "./windows-resource-loop.mjs";
import { checkIsmctsStorageAdmission } from "./storage-admission.mjs";
import {
  createCallerMeter,
  requireCallerMeter,
  callerCutoff,
} from "./caller-meter.mjs";

function snapshotRecord(input, allowed) {
  if (!input || typeof input !== "object")
    throw new Error("invalid reserved Windows runtime request");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const snapshot = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !("value" in descriptor)
    )
      throw new Error("invalid reserved Windows runtime request");
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

// Trusted execution seam; public callers enter through shared admission below.
export async function executeOwnedWindowsJob(request, callbacks, reservation) {
  const job = await createWindowsJob({
    ...request,
    // The public intake cannot supply/raise this limit. OS transfer bytes are
    // a conservative additional stop signal, never payload accounting/refund.
    writeTransferLimitBytes: reservation?.outputBytes ?? -1,
  });
  let controller;
  try {
    controller = createWindowsResourceController(
      job,
      request.threads,
      reservation?.callerMeter
    );
    return await runWindowsResourceLoop(controller, callbacks);
  } finally {
    // Covers controller construction failure as well as normal scheduler exit.
    await job.close();
  }
}

export function runWindowsBudgetedJob(worktree, request, callbacks) {
  const callerMeter = createCallerMeter();
  if (process.platform !== "win32")
    throw new Error("Windows budget runtime unavailable");
  // No directory/owner/clock/runtime factory override enters this entry point.
  return runReservedWindowsJob(
    programPaths(worktree).shared,
    request,
    callbacks,
    executeOwnedWindowsJob,
    (outputBytes) => checkIsmctsStorageAdmission(worktree, outputBytes),
    callerMeter
  );
}

// Trusted lower-level factory seam also used with private regression ledgers.
// The production entry above always resolves Git's common shared repository.
export async function runReservedWindowsJob(
  directory,
  request,
  callbacks,
  execute,
  storageAdmission,
  callerMeter = createCallerMeter()
) {
  requireCallerMeter(callerMeter);
  // Include validation, the initial service callback and both capacity scans.
  const admittedAt = performance.now();
  // Read data descriptors once, without invoking caller accessors. Later service
  // callbacks cannot change the request, quota or callback function identities.
  const intakeRequest = snapshotRecord(request, [
    "module",
    "args",
    "cwd",
    "threads",
    "wallMs",
    "outputBytes",
    "monitor",
  ]);
  const intakeCallbacks = snapshotRecord(callbacks, ["serviceBusy", "signal"]);
  if (
    typeof execute !== "function" ||
    typeof storageAdmission !== "function" ||
    intakeCallbacks.serviceBusy === undefined ||
    (intakeCallbacks.signal !== undefined &&
      !(intakeCallbacks.signal instanceof globalThis.AbortSignal))
  )
    throw new Error("invalid reserved Windows runtime request");
  // Public intake never invokes observer code. A synchronous-looking function
  // can return a rejected Promise and end a strict Node caller before cleanup.
  // The observed runtime installs its own telemetry observer after admission.
  // Validate synchronously before any reservation or process can be created.
  const owned = validateWindowsJobRequest({
    ...intakeRequest,
    resourceWatchdog: true,
  });
  const outputBytes =
    intakeRequest.outputBytes === undefined ? 0 : intakeRequest.outputBytes;
  const serviceIsBusy = bindWindowsServiceReader(
    directory,
    intakeCallbacks.serviceBusy
  );
  const serviceBusy = readWindowsServiceBusy(serviceIsBusy);
  if (intakeCallbacks.signal?.aborted)
    return { status: "deferred_load", reason: "cancelled_before_reservation" };
  if (serviceBusy)
    return { status: "deferred_load", reason: "service_priority" };
  const budgetRequest = Object.freeze({
    wallMs: owned.wallMs,
    threads: owned.threads,
    outputBytes,
    monitor:
      intakeRequest.monitor === undefined ? false : intakeRequest.monitor,
    owner: randomUUID(),
  });
  // Known refusals must not launch a capacity helper or write a transaction
  // marker outside any reservation. Availability is not authority to execute.
  const preview = previewNextChunk(directory, budgetRequest);
  if (preview.status !== "available") return preview;
  const checkStorage = (reservedOutput = outputBytes) => {
    if (storageAdmission(reservedOutput) !== undefined)
      throw new Error("storage admission must complete synchronously");
  };
  checkStorage();
  const reservation = reserveNextChunk(directory, budgetRequest);
  if (reservation.status !== "reserved") return reservation;
  // Neither a wall-clock rollback nor checkpoint latency may extend this
  // admission's lifetime. The JST reservation remains bound to wall time.
  const remainingTime = () =>
    Math.floor(
      Math.min(
        reservation.startedAt + reservation.reserved.wallMs - Date.now(),
        reservation.reserved.wallMs - (performance.now() - admittedAt)
      )
    );
  const deadline = new globalThis.AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    Math.max(0, remainingTime())
  );
  const signal = intakeCallbacks.signal
    ? globalThis.AbortSignal.any([intakeCallbacks.signal, deadline.signal])
    : deadline.signal;
  try {
    // Re-measure after the shared checkpoint has been persisted. A veto leaves
    // that reservation charged; no process has been generated at this point.
    checkStorage(reservation.reserved.outputBytes);
    const latestServiceBusy = readWindowsServiceBusy(serviceIsBusy);
    if (latestServiceBusy)
      return {
        status: "unreconciled",
        reason: "service_priority_before_creation",
        reservation,
      };
    // Prepare only canonical data before the final deadline/cancellation check.
    const executionRequest = {
      module: owned.module,
      args: owned.args,
      cwd: owned.cwd,
      threads: owned.threads,
      wallMs: 0,
      resourceWatchdog: true,
      signal,
    };
    const executionCallbacks = {
      ...intakeCallbacks,
      serviceBusy: serviceIsBusy,
      signal,
    };
    const remaining = remainingTime();
    if (remaining <= 0 || signal.aborted)
      return {
        status: "unreconciled",
        reason: "reservation_expired_before_creation",
        reservation,
      };
    executionRequest.wallMs = remaining;
    const execution = await execute(
      executionRequest,
      executionCallbacks,
      Object.freeze({
        id: reservation.id,
        owner: reservation.owner,
        outputBytes: reservation.reserved.outputBytes,
        callerMeter,
        // The writer's local clock cannot cover time already spent in this
        // admission. Keep the original monotonic/wall deadline through I/O.
        checkOutputDeadline() {
          if (remainingTime() <= 0)
            throw new Error(
              "output admission deadline elapsed; reservation retained"
            );
        },
      })
    );
    // A successful root is insufficient: caller/helper tail, output and service
    // accounting are not complete. Never call finishBudget or refund any part.
    return {
      status: "unreconciled",
      reason: "program_accounting_unavailable",
      reservation,
      execution,
      // This sample follows the observed factory's telemetry write/fsync. It
      // is a lower bound, not a claim that the still-live caller has exited.
      callerCutoff: callerCutoff(callerMeter),
    };
  } catch (cause) {
    const error = new Error(
      "reserved Windows runtime failed; reservation retained",
      { cause }
    );
    error.reservation = reservation;
    error.callerCutoff = callerCutoff(callerMeter);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
