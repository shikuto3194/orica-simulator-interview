// Resource dispatch for a trusted, already-owned Windows job. This is a
// lower-level integration boundary, not a production/budget/calibration runner.
import { readWindowsServiceBusy } from "./windows-service-state.mjs";
import { profile, resourceMachine } from "./resources.mjs";
import {
  windowsResourceSample,
  validateOwnedSample,
  ownedJobStopReason,
} from "./windows-job.mjs";
import {
  createCallerMeter,
  addCallerResources,
  callerCpuSince,
  requireCallerMeter,
} from "./caller-meter.mjs";

export function windowsHostMeasurement(sample, previous = null) {
  const host = sample?.host;
  const ticks = (value) =>
    typeof value === "string" &&
    /^(0|[1-9]\d{0,19})$/.test(value) &&
    BigInt(value) <= 0xffffffffffffffffn;
  const bytes = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    !host ||
    host.pid !== sample.guardian?.pid ||
    host.processorGroups !== 1 ||
    typeof host.startToken !== "string" ||
    !/^[0-9a-f]{32}$/.test(host.startToken) ||
    !Number.isSafeInteger(host.atMs) ||
    host.atMs < 0 ||
    !ticks(host.idleTicks) ||
    !ticks(host.kernelTicks) ||
    !ticks(host.userTicks) ||
    BigInt(host.idleTicks) > BigInt(host.kernelTicks) ||
    !bytes(host.freeRamBytes) ||
    !bytes(host.totalRamBytes) ||
    host.totalRamBytes === 0 ||
    host.freeRamBytes > host.totalRamBytes
  )
    throw new Error("invalid native host counters");
  let cpuPercent = null;
  if (previous) {
    windowsHostMeasurement(previous);
    const old = previous.host;
    const gap = host.atMs - old.atMs;
    if (
      host.pid !== old.pid ||
      sample.guardian.created !== previous.guardian.created ||
      host.totalRamBytes !== old.totalRamBytes ||
      gap <= 0 ||
      gap > profile.compute.sampleMs * 1.5
    )
      throw new Error("host identity or sampling interval changed");
    const idle = BigInt(host.idleTicks) - BigInt(old.idleTicks);
    const kernel = BigInt(host.kernelTicks) - BigInt(old.kernelTicks);
    const user = BigInt(host.userTicks) - BigInt(old.userTicks);
    const total = kernel + user;
    if (idle < 0n || kernel < 0n || user < 0n || idle > kernel || total <= 0n)
      throw new Error("host CPU counters unavailable or reversed");
    // Convert differences only. Cumulative FILETIME values can exceed JS's
    // integer precision; kernel includes idle, so subtract it exactly once.
    cpuPercent = (100 * Number(total - idle)) / Number(total);
  }
  return {
    atMs: host.atMs,
    cpuPercent,
    freeRamGiB: host.freeRamBytes / 1024 ** 3,
    totalRamGiB: host.totalRamBytes / 1024 ** 3,
    source: "windows-guardian-native",
  };
}

export function createWindowsResourceController(
  job,
  threads,
  callerMeter = createCallerMeter()
) {
  requireCallerMeter(callerMeter);
  // Only the owning caller supplies this handle. No caller PID, telemetry or
  // threshold override enters the execution methods.
  addCallerResources(
    windowsResourceSample(
      windowsHostMeasurement(job.initial),
      job.initial,
      threads
    ),
    callerMeter.baseline,
    job.initial
  );
  let previous = JSON.parse(JSON.stringify(job.initial));
  let machine = resourceMachine({ stopped: true });
  let started = false,
    ended = false,
    busy = false,
    finished = false;
  async function exclusive(action) {
    if (busy) throw new Error("resource operation overlap");
    if (ended) throw new Error("resource job ended");
    busy = true;
    try {
      return await action();
    } catch (error) {
      ended = true;
      try {
        await job.terminate();
      } catch {
        /* close retains kill-on-close */
      }
      await job.close();
      throw error;
    } finally {
      busy = false;
    }
  }
  function evaluate(sample, serviceBusy) {
    if (typeof serviceBusy !== "boolean")
      throw new Error("invalid service busy state");
    validateOwnedSample(sample, threads, previous);
    const nativeStopReason = ownedJobStopReason(sample);
    // A delayed caller may resume after the native timer has already killed
    // the job. Validate its envelope, preserve that terminal reason and never
    // reuse a safe window or acknowledge another heartbeat.
    const host = windowsHostMeasurement(
      sample,
      nativeStopReason ? null : previous
    );
    const caller = callerMeter.sample();
    const policySample = addCallerResources(
      windowsResourceSample(host, sample, threads),
      caller,
      sample
    );
    policySample.ownedCpuMs += callerCpuSince(caller, callerMeter.baseline);
    // Preserve native envelope totals. The caller is a separate current-process
    // measurement, never substituted for the retained job/helper identities.
    sample = { ...sample, caller, callerBaseline: callerMeter.baseline };
    previous = JSON.parse(JSON.stringify(sample));
    if (nativeStopReason)
      return {
        decision: { action: "stop", reason: nativeStopReason },
        sample,
        host,
      };
    let decision = machine.update(policySample, host.atMs);
    if (serviceBusy && decision.action !== "terminate") {
      machine = resourceMachine({ stopped: true });
      decision = { action: "stop", reason: "service_priority" };
    } else if (
      !started &&
      !["stop", "terminate"].includes(decision.action) &&
      (host.freeRamGiB < profile.ram.startFreeGiB ||
        host.cpuPercent >= profile.cpu.resumeBelowPercent)
    ) {
      // A prior 'resume' without launch cannot license a later degraded start.
      machine = resourceMachine({ stopped: true });
      decision = { action: "wait", reason: "deferred_load" };
    }
    return { decision, sample, host };
  }
  async function inspect(serviceBusy) {
    const { decision, sample, host } = evaluate(
      await job.sample(),
      serviceBusy
    );
    if (ownedJobStopReason(sample)) {
      ended = true;
      return { status: "stopped", decision, sample, host };
    }
    if (sample.active === 0) {
      ended = true;
      return { status: "exited", decision, sample, host };
    }
    if (
      decision.action === "terminate" ||
      (started && decision.action === "stop")
    ) {
      await job.terminate();
      ended = true;
      return { status: "stopped", decision, sample, host };
    }
    return { status: started ? "running" : "waiting", decision, sample, host };
  }
  return {
    resourceWatchdog:
      job.resourceWatchdog === true &&
      job.initial.resourceWatchdogEnabled === true,
    poll(serviceBusy = false) {
      return exclusive(() => inspect(serviceBusy));
    },
    start(serviceBusy = false, readServiceBusy = serviceBusy) {
      return exclusive(async () => {
        if (started) throw new Error("resource job already started");
        readWindowsServiceBusy(readServiceBusy);
        const result = await inspect(serviceBusy);
        if (
          result.status === "exited" ||
          !["run", "resume"].includes(result.decision.action)
        )
          return result;
        let final = result;
        const allowed = await job.start((sample) => {
          // Native requests can wait while a service is admitted. Re-read its
          // lifetime before resume instead of launching with an older boolean.
          final = evaluate(sample, readWindowsServiceBusy(readServiceBusy));
          return (
            sample.active !== 0 &&
            ["run", "resume"].includes(final.decision.action)
          );
        });
        started = allowed;
        if (!allowed && final.decision.action === "terminate") {
          await job.terminate();
          ended = true;
          return { ...final, status: "stopped" };
        }
        if (!allowed && final.sample.active === 0) {
          ended = true;
          return { ...final, status: "exited" };
        }
        return { ...final, status: allowed ? "running" : "waiting" };
      });
    },
    // Full-accounting acceptance deliberately stays with the existing job.
    async finish() {
      if (busy) throw new Error("resource operation overlap");
      if (finished) throw new Error("resource job already finished");
      finished = true;
      busy = true;
      ended = true;
      try {
        const terminal = await job.finish();
        await job.close();
        const callerFinal = callerMeter.sample();
        return {
          ...terminal,
          callerBaseline: callerMeter.baseline,
          callerFinal,
          callerCpuMs: callerCpuSince(callerFinal, callerMeter.baseline),
          accountingComplete: false,
        };
      } finally {
        await job.close();
        busy = false;
      }
    },
    close() {
      ended = true;
      return job.close();
    },
  };
}
