// Aggregate host telemetry only. No process names, command lines, environment
// values, app contents or service tokens are included in calibration output.
import { readFileSync } from "node:fs";
import { freemem, totalmem, cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { profile, resourceMachine } from "./resources.mjs";
import { loadProcessMeter } from "./windows-process-handle.mjs";

export function projectWindowsHostCounters(input) {
  const result = {};
  for (const field of [
    "idleTicks",
    "kernelTicks",
    "userTicks",
    "freeRamBytes",
    "totalRamBytes",
    "logicalCpus",
    "processorGroups",
  ]) {
    const descriptor = input && Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new Error("missing aggregate Windows host counter");
    result[field] = descriptor.value;
  }
  if (
    ["idleTicks", "kernelTicks", "userTicks"].some(
      (field) =>
        typeof result[field] !== "string" ||
        !/^(0|[1-9]\d{0,19})$/.test(result[field]) ||
        BigInt(result[field]) > 0xffffffffffffffffn
    ) ||
    BigInt(result.idleTicks) > BigInt(result.kernelTicks) ||
    !Number.isSafeInteger(result.freeRamBytes) ||
    result.freeRamBytes < 0 ||
    !Number.isSafeInteger(result.totalRamBytes) ||
    result.totalRamBytes <= 0 ||
    result.freeRamBytes > result.totalRamBytes ||
    !Number.isSafeInteger(result.logicalCpus) ||
    result.logicalCpus < 1 ||
    result.logicalCpus > 64 ||
    result.processorGroups !== 1
  )
    throw new Error("invalid aggregate Windows host counters");
  return result;
}

export function probeHost() {
  const started = performance.now();
  if (process.platform === "win32") {
    // A prebuilt, source/hash-checked binding reads only aggregate counters.
    // CIM/PowerShell startup can exceed the entire two-second sample period.
    // Missing/stale native artifacts fail closed; never compile at admission.
    const { freeRamBytes, totalRamBytes, ...counters } =
      projectWindowsHostCounters(loadProcessMeter().host());
    return {
      ...counters,
      freeRamGiB: freeRamBytes / 1024 ** 3,
      totalRamGiB: totalRamBytes / 1024 ** 3,
      measuredAt: Date.now(),
      probeMs: performance.now() - started,
      source: "windows-native",
    };
  }
  if (process.platform === "linux") {
    const cpu = readFileSync("/proc/stat", "utf8")
      .split("\n")[0]
      .trim()
      .split(/\s+/)
      .slice(1, 9)
      .map(Number);
    if (
      cpu.length !== 8 ||
      cpu.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      !Number.isSafeInteger(cpu.reduce((sum, value) => sum + value, 0))
    )
      throw new Error("invalid Linux CPU counters");
    return {
      cpuTicks: cpu.reduce((sum, value) => sum + value, 0),
      idleTicks: cpu[3] + cpu[4],
      freeRamGiB: freemem() / 1024 ** 3,
      totalRamGiB: totalmem() / 1024 ** 3,
      logicalCpus: cpus().length,
      measuredAt: Date.now(),
      probeMs: performance.now() - started,
      source: "linux-proc",
    };
  }
  throw new Error("unsupported resource telemetry platform");
}

export function hostEligibility(samples, startedAt, finishedAt) {
  if (
    !Array.isArray(samples) ||
    samples.length < 16 ||
    !Number.isSafeInteger(startedAt) ||
    !Number.isSafeInteger(finishedAt) ||
    finishedAt < startedAt ||
    samples[0]?.measuredAt !== startedAt ||
    finishedAt - samples.at(-1)?.measuredAt > profile.compute.sampleMs * 1.5 ||
    samples.at(-1)?.measuredAt - startedAt < profile.cpu.resumeMs
  )
    return false;
  const machine = resourceMachine({ stopped: true });
  let decision,
    previous = null;
  for (const sample of samples) {
    if (
      !Number.isSafeInteger(sample?.measuredAt) ||
      sample.measuredAt > finishedAt ||
      !Number.isFinite(sample.probeMs) ||
      sample.probeMs < 0 ||
      sample.probeMs > profile.compute.sampleMs * 1.5 ||
      (previous !== null &&
        (sample.measuredAt <= previous ||
          sample.measuredAt - previous > profile.compute.sampleMs * 1.5))
    )
      return false;
    decision = machine.update({ ...sample, treeRssGiB: 0 }, sample.measuredAt);
    // An initial anchor plus fifteen intervals proves the entire normal-load
    // window. A high/missing point cannot be hidden by a later recovery.
    if (
      decision.action === "stop" ||
      decision.action === "terminate" ||
      !Number.isFinite(sample.cpuPercent) ||
      sample.cpuPercent >= profile.cpu.resumeBelowPercent ||
      !Number.isFinite(sample.freeRamGiB) ||
      sample.freeRamGiB < profile.ram.startFreeGiB
    )
      return false;
    previous = sample.measuredAt;
  }
  return ["resume", "run"].includes(decision.action);
}

export function intervalHostSample(current, previous) {
  if (
    !["windows-native", "linux-proc"].includes(current.source) ||
    current.source !== previous.source ||
    current.logicalCpus !== previous.logicalCpus ||
    current.totalRamGiB !== previous.totalRamGiB
  )
    throw new Error("host telemetry identity changed");
  if (current.source === "windows-native") {
    // Keep cumulative FILETIME strings exact above Number.MAX_SAFE_INTEGER.
    // Windows kernel time includes idle; subtract idle exactly once.
    const read = (sample) =>
      projectWindowsHostCounters({
        ...sample,
        freeRamBytes: sample.freeRamGiB * 1024 ** 3,
        totalRamBytes: sample.totalRamGiB * 1024 ** 3,
      });
    const now = read(current),
      old = read(previous);
    const idle = BigInt(now.idleTicks) - BigInt(old.idleTicks),
      kernel = BigInt(now.kernelTicks) - BigInt(old.kernelTicks),
      user = BigInt(now.userTicks) - BigInt(old.userTicks),
      total = kernel + user;
    if (idle < 0n || kernel < 0n || user < 0n || idle > kernel || total <= 0n)
      throw new Error("invalid Windows CPU sample interval");
    current = {
      ...current,
      cpuPercent: (100 * Number(total - idle)) / Number(total),
    };
  }
  if (current.source === "linux-proc") {
    if (
      [current, previous].some(
        (sample) =>
          ["cpuTicks", "idleTicks"].some(
            (field) => !Number.isSafeInteger(sample[field]) || sample[field] < 0
          ) || sample.idleTicks > sample.cpuTicks
      )
    )
      throw new Error("invalid Linux CPU counters");
    const ticks = current.cpuTicks - previous.cpuTicks,
      idle = current.idleTicks - previous.idleTicks;
    if (ticks <= 0 || idle < 0 || idle > ticks)
      throw new Error("invalid Linux CPU sample interval");
    current.cpuPercent = 100 * (1 - idle / ticks);
  }
  const {
    cpuTicks: _cpu,
    idleTicks: _idle,
    kernelTicks: _kernel,
    userTicks: _user,
    ...sample
  } = current;
  return sample;
}

export async function observeHost() {
  let previous = probeHost();
  // Both platforms need a counter interval before a real CPU percentage.
  // Never invent a zero-load anchor to shorten the recovery observation.
  if (previous.cpuTicks !== undefined || previous.kernelTicks !== undefined) {
    await delay(profile.compute.sampleMs);
    const current = probeHost();
    previous = { ...current, ...intervalHostSample(current, previous) };
  }
  const {
    cpuTicks: _cpu,
    idleTicks: _idle,
    kernelTicks: _kernel,
    userTicks: _user,
    ...anchor
  } = previous;
  const startedAt = anchor.measuredAt,
    mono = performance.now(),
    samples = [anchor];
  for (let i = 1; i <= 15; i++) {
    await delay(
      Math.max(0, i * profile.compute.sampleMs - (performance.now() - mono))
    );
    const current = probeHost();
    samples.push(intervalHostSample(current, previous));
    previous = current;
  }
  const finishedAt = Date.now();
  return {
    schemaVersion: 1,
    kind: "i0-host-baseline",
    startedAt,
    finishedAt,
    samples,
    eligibleForSmoke: hostEligibility(samples, startedAt, finishedAt),
    provesRuntimeControl: false,
    provesGameCalibration: false,
  };
}
