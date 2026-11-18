// Resource evidence for the owned lower runtime. This records no game state,
// command arguments, environment, service token or caller exception text.
import { performance } from "node:perf_hooks";
import { profile } from "./resources.mjs";
import { programPaths } from "./shared.mjs";
import {
  validateOwnedSample,
  validateTerminalSample,
  validateMeterReply,
  validateRetainedProcessSample,
  windowsResourceSample,
  ownedJobStopReason,
} from "./windows-job.mjs";
import {
  runReservedWindowsJob,
  executeOwnedWindowsJob,
} from "./windows-budget-admission.mjs";
import {
  writeReservedArtifact,
  maximumManagedPayloadBytes,
} from "./managed-output.mjs";
import { checkIsmctsStorageAdmission } from "./storage-admission.mjs";
import {
  projectCallerSample,
  callerCpuSince,
  addCallerResources,
  createCallerMeter,
} from "./caller-meter.mjs";

// Keep persistence inside the same reservation. This is headroom, not a claim
// that capacity scans/fsync can always finish within thirty seconds.
export const telemetryPersistenceMs = 30000;
const terminalHeadroom = 4096;
const reasons = new Set([
  "ram_hard",
  "measurement_missing",
  "gpu_not_accepted",
  "gpu_measurement_missing",
  "ram_free",
  "ram_soft",
  "cpu_load",
  "load_recovered",
  "deferred_load",
  "within_profile",
  "service_priority",
  "resource_watchdog_expired",
  "write_transfer_limit",
]);
const number = (x) => Number.isFinite(x) && x >= 0;

// Native UInt64 strings remain exact even above Number.MAX_SAFE_INTEGER.
// These are OS write transfers, not retained artifact sizes or budget claims.
function writeCounter(input, previous = null) {
  const descriptor =
    input && Object.getOwnPropertyDescriptor(input, "writeTransferBytes");
  if (!descriptor || !Object.hasOwn(descriptor, "value"))
    throw new Error("missing native write I/O data");
  const value = descriptor.value;
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,19})$/.test(value) ||
    BigInt(value) > 0xffffffffffffffffn ||
    (previous !== null && BigInt(value) < writeCounter(previous))
  )
    throw new Error("invalid or reversed native write I/O");
  return BigInt(value);
}

function writeIoProjection(sample, previous, terminal = null) {
  const job = writeCounter(sample, previous);
  const guardian = writeCounter(
    terminal?.guardianFinal ?? sample.meter.target,
    previous?.meter.target ?? null
  );
  if (guardian < writeCounter(sample.guardian, previous?.guardian ?? null))
    throw new Error("guardian write I/O precedes owned sample");
  if (terminal)
    writeCounter(terminal.meterLastSample, previous?.meter.helper ?? null);
  const helper = writeCounter(
    terminal?.meterFinal ?? sample.meter.helper,
    terminal?.meterLastSample ?? previous?.meter.helper ?? null
  );
  return {
    jobBytes: job.toString(),
    guardianBytes: guardian.toString(),
    helperBytes: helper.toString(),
    ownedBytes: (job + guardian + helper).toString(),
  };
}

function withProjectedMembers(sample) {
  // Reject this new mandatory field's accessor before the object copy below.
  writeCounter(sample);
  const descriptor =
    sample && Object.getOwnPropertyDescriptor(sample, "members");
  if (!descriptor || !Object.hasOwn(descriptor, "value"))
    throw new Error("missing owned member data");
  const input = descriptor.value;
  if (!Array.isArray(input) || input.length > 1024)
    throw new Error("invalid owned member data");
  const members = [];
  for (let index = 0; index < input.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(input, String(index));
    if (!entry || !Object.hasOwn(entry, "value"))
      throw new Error("missing owned member data");
    const member = {};
    for (const field of ["pid", "created", "rssBytes"]) {
      const data =
        entry.value && Object.getOwnPropertyDescriptor(entry.value, field);
      if (!data || !Object.hasOwn(data, "value"))
        throw new Error("missing owned member data");
      member[field] = data.value;
    }
    members.push(member);
  }
  // Only detached scalar membership enters validation, serialization and the
  // next-sample baseline. Ignore extra fields, prototypes and toJSON hooks.
  return { ...sample, members };
}

function ownedProjection(sample, threads, previous) {
  validateOwnedSample(sample, threads, previous);
  return {
    rootPid: sample.rootPid,
    rootCreated: sample.rootCreated,
    active: sample.active,
    exitCode: sample.exitCode,
    jobCpuMs: sample.cpuMs,
    jobRssBytes: sample.rssBytes,
    members: sample.members,
    guardian: {
      pid: sample.guardian.pid,
      created: sample.guardian.created,
      cpuMs: sample.guardian.cpuMs,
      rssBytes: sample.guardian.rssBytes,
    },
    affinityMask: sample.affinityMask,
    priority: sample.priority,
    watchdogExpired: sample.resourceWatchdogExpired,
    writeTransferLimitBytes: sample.writeTransferLimitBytes ?? -1,
    writeTransferLimitExceeded: sample.writeTransferLimitExceeded ?? false,
  };
}

function terminalHelperProjection(sample, previous) {
  // Snapshot only native scalar data before validation. Never serialize the
  // source object or invoke its accessors / own or inherited toJSON hook.
  const projected = {};
  for (const field of [
    "pid",
    "created",
    "exited",
    "cpuMs",
    "signaled",
    "exitCode",
    "writeTransferBytes",
  ]) {
    const descriptor = sample && Object.getOwnPropertyDescriptor(sample, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new Error("invalid terminal helper data");
    projected[field] = descriptor.value;
  }
  validateRetainedProcessSample(projected, previous, true);
  writeCounter(projected, previous);
  return projected;
}

// Trusted controller observations are projected without calling caller code.
// Store encoded copies, never references that later code could mutate.
export function createRuntimeTelemetry(threads, allowance) {
  if (
    ![1, 2].includes(threads) ||
    !Number.isSafeInteger(allowance) ||
    allowance <= terminalHeadroom ||
    allowance > maximumManagedPayloadBytes
  )
    throw new Error("invalid runtime telemetry allowance");
  const started = performance.now();
  const lines = [];
  let bytes = 0,
    samples = 0,
    previous = null,
    sealed = false;
  function append(value, tail = false) {
    const line = Buffer.from(`${JSON.stringify(value)}\n`);
    if (bytes + line.length > allowance - (tail ? 0 : terminalHeadroom))
      throw new Error("runtime telemetry allowance exceeded");
    lines.push(line);
    bytes += line.length;
  }
  append({
    schemaVersion: 3,
    kind: "ismcts-owned-runtime-telemetry",
    membershipCoverage: "sampled_job_members_only",
    writeIoCoverage: "job_lifetime_and_retained_guardian_helper_only",
    writeIoUnit: "os_write_transfer_bytes_not_artifact_storage_bytes",
    threads,
    accountingComplete: false,
    provesGameCalibration: false,
  });
  return {
    observe(observation) {
      const nativeStopReason = ownedJobStopReason(observation?.sample);
      if (
        sealed ||
        samples + 1 >
          Math.ceil(profile.offline.chunkMs / profile.compute.sampleMs) + 1
      )
        throw new Error("runtime telemetry lifecycle/observation limit");
      if (
        !observation ||
        !["waiting", "running", "stopped", "exited"].includes(
          observation.status
        ) ||
        !["wait", "run", "resume", "stop", "terminate"].includes(
          observation.decision?.action
        ) ||
        !reasons.has(observation.decision.reason) ||
        (nativeStopReason
          ? observation.status !== "stopped" ||
            observation.decision.action !== "stop" ||
            observation.decision.reason !== nativeStopReason ||
            observation.host?.cpuPercent !== null
          : ["resource_watchdog_expired", "write_transfer_limit"].includes(
              observation.decision.reason
            ) ||
            !number(observation.host?.cpuPercent) ||
            observation.host.cpuPercent > 100) ||
        !number(observation.host.freeRamGiB) ||
        !Number.isSafeInteger(observation.host.atMs) ||
        observation.host.atMs < 0
      )
        throw new Error("invalid runtime telemetry observation");
      const sample = withProjectedMembers(observation.sample);
      const owned = ownedProjection(sample, threads, previous);
      const callerBaseline = projectCallerSample(sample.callerBaseline);
      const caller = projectCallerSample(
        sample.caller,
        previous?.caller ?? callerBaseline
      );
      if (
        previous &&
        JSON.stringify(callerBaseline) !==
          JSON.stringify(previous.callerBaseline)
      )
        throw new Error("caller baseline changed");
      const resource = addCallerResources(
        windowsResourceSample(observation.host, sample, threads),
        caller,
        sample
      );
      const writeIo = writeIoProjection(sample, previous);
      append({
        kind: "sample",
        sequence: samples + 1,
        elapsedMs: performance.now() - started,
        status: observation.status,
        action: observation.decision.action,
        reason: observation.decision.reason,
        host: {
          cpuPercent: observation.host.cpuPercent,
          freeRamGiB: observation.host.freeRamGiB,
          atMs: observation.host.atMs,
        },
        owned,
        helper: {
          pid: sample.meter.helper.pid,
          created: sample.meter.helper.created,
          cpuMs: sample.meter.helper.cpuMs,
          rssBytes: sample.meter.helper.rssBytes,
        },
        observedCpuMs:
          resource.ownedCpuMs + callerCpuSince(caller, callerBaseline),
        observedRssGiB: resource.treeRssGiB,
        caller,
        callerCpuMs: callerCpuSince(caller, callerBaseline),
        writeIo,
      });
      // Retain a detached, validated baseline for the next comparison.
      previous = globalThis.structuredClone({
        ...sample,
        caller,
        callerBaseline,
      });
      samples++;
    },
    seal(execution) {
      if (sealed) throw new Error("runtime telemetry already sealed");
      if (execution) {
        if (
          !["completed", "stopped"].includes(execution.status) ||
          !["job_exit", "cancelled", ...reasons].includes(execution.reason) ||
          execution.samples !== samples ||
          execution.terminal?.accountingComplete !== false
        )
          throw new Error("invalid runtime telemetry completion");
        const terminal = execution.terminal;
        const terminalSample = withProjectedMembers(terminal.sample);
        validateTerminalSample(
          {
            ...terminal,
            sample: terminalSample,
            rootExited: terminal.jobExited,
          },
          threads,
          previous
        );
        const nativeStopReason = ownedJobStopReason(terminalSample);
        if (
          nativeStopReason
            ? execution.status !== "stopped" ||
              execution.reason !== nativeStopReason
            : ["write_transfer_limit", "resource_watchdog_expired"].includes(
                execution.reason
              )
        )
          throw new Error("invalid runtime telemetry native stop completion");
        if (
          terminal.jobExited !== true ||
          terminal.guardianExited !== true ||
          terminal.jobCpuComplete !== true ||
          terminal.guardianCpuComplete !== true ||
          !number(terminal.finalJobGuardianCpuMs) ||
          terminal.finalJobGuardianCpuMs !==
            terminal.sample.cpuMs + terminal.guardianFinal?.cpuMs
        )
          throw new Error("incomplete runtime telemetry terminal accounting");
        validateMeterReply(
          { target: terminal.guardianFinal, helper: terminal.meterLastSample },
          terminal.sample.guardian,
          previous?.meter,
          true
        );
        const meterFinal = terminalHelperProjection(
          terminal.meterFinal,
          terminal.meterLastSample
        );
        const writeIo = writeIoProjection(terminalSample, previous, {
          ...terminal,
          meterFinal,
        });
        const callerBaseline = projectCallerSample(terminal.callerBaseline);
        const callerFinal = projectCallerSample(
          terminal.callerFinal,
          previous?.caller ?? callerBaseline
        );
        const callerCpuMs = callerCpuSince(callerFinal, callerBaseline);
        if (
          (previous &&
            JSON.stringify(callerBaseline) !==
              JSON.stringify(previous.callerBaseline)) ||
          terminal.callerCpuMs !== callerCpuMs
        )
          throw new Error("caller terminal accounting mismatch");
        addCallerResources({ treeRssGiB: 0 }, callerFinal, {
          ...terminal.sample,
          meter: { helper: terminal.meterLastSample },
        });
        if (
          terminal.meterExited !== true ||
          terminal.meterCpuComplete !== true ||
          !number(terminal.finalOwnedCpuMs) ||
          terminal.finalOwnedCpuMs !==
            terminal.finalJobGuardianCpuMs + meterFinal.cpuMs
        )
          throw new Error("incomplete helper terminal accounting");
        append(
          {
            kind: "terminal",
            status: execution.status,
            reason: execution.reason,
            samples,
            elapsedMs: performance.now() - started,
            owned: ownedProjection(terminalSample, threads, previous),
            finalJobGuardianCpuMs: terminal.finalJobGuardianCpuMs,
            finalOwnedCpuMs: terminal.finalOwnedCpuMs,
            meterFinal,
            meterCpuComplete: true,
            callerBaseline,
            callerFinal,
            callerCpuMs,
            finalMeasuredCpuMs: terminal.finalOwnedCpuMs + callerCpuMs,
            writeIo,
            accountingComplete: false,
            reasonUnaccounted:
              "pre_entry_persistence_caller_tail_and_service_unaccounted",
          },
          true
        );
      } else {
        append(
          {
            kind: "failure",
            reason: "owned_runtime_failed",
            samples,
            elapsedMs: performance.now() - started,
            accountingComplete: false,
          },
          true
        );
      }
      sealed = true;
      return Buffer.concat(lines, bytes);
    },
  };
}

export function runWindowsObservedJob(worktree, request, callbacks) {
  const callerMeter = createCallerMeter();
  if (process.platform !== "win32")
    throw new Error("Windows observed runtime unavailable");
  return runObservedReservedJob(
    programPaths(worktree).shared,
    request,
    callbacks,
    (bytes) => checkIsmctsStorageAdmission(worktree, bytes),
    executeOwnedWindowsJob,
    callerMeter
  );
}

// Private regression seam; public entry supplies the real shared storage check
// and native factory. No writer/path/owner/clock override enters the public API.
export function runObservedReservedJob(
  directory,
  request,
  callbacks,
  admit,
  execute = executeOwnedWindowsJob,
  callerMeter = createCallerMeter()
) {
  return runReservedWindowsJob(
    directory,
    request,
    callbacks,
    (owned, controls, reservation) =>
      observeReservedWindowsJob(
        directory,
        owned,
        controls,
        reservation,
        admit,
        execute
      ),
    admit,
    callerMeter
  );
}

// Trusted continuation inside an already reserved envelope. It never reserves,
// finishes or refunds budget. The public admission above still fixes all inputs.
export async function observeReservedWindowsJob(
  directory,
  owned,
  controls,
  reservation,
  admit,
  execute = executeOwnedWindowsJob,
  artifactName = "runtime-telemetry"
) {
  const journal = createRuntimeTelemetry(
    owned.threads,
    reservation.outputBytes
  );
  if (owned.wallMs <= telemetryPersistenceMs)
    throw new Error("runtime telemetry persistence headroom unavailable");
  let result, failure;
  try {
    result = await execute(
      { ...owned, wallMs: owned.wallMs - telemetryPersistenceMs },
      {
        ...controls,
        onSample(observation) {
          journal.observe(observation);
        },
      },
      reservation
    );
    if (!result) throw new Error("missing owned runtime result");
  } catch (error) {
    failure = new Error("owned runtime execution failed", { cause: error });
  }
  const telemetry = writeReservedArtifact(
    directory,
    reservation.id,
    reservation.owner,
    artifactName,
    journal.seal(failure ? null : result),
    admit,
    Date.now(),
    reservation.checkOutputDeadline
  );
  if (failure) {
    failure.telemetry = telemetry;
    throw failure;
  }
  return { ...result, telemetry };
}
