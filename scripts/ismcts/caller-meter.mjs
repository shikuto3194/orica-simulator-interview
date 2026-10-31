// Current Node process only. No external PID, callback or clock override.
import { cpuUsage, memoryUsage, pid } from "node:process";

const readCpu = cpuUsage.bind(process);
const readRss = memoryUsage.rss.bind(memoryUsage);
const fields = ["pid", "userMicros", "systemMicros", "rssBytes"];
const meters = new WeakSet();

// Only meters created here can cross the trusted admission/controller seam.
// Public request/callback objects cannot substitute counters or executable code.
export function requireCallerMeter(meter) {
  if (!meters.has(meter))
    throw new Error("invalid current-process caller meter");
  return meter;
}

export function callerCutoff(meter) {
  requireCallerMeter(meter);
  const sample = meter.sample();
  return {
    baseline: { ...meter.baseline },
    sample,
    cpuMs: callerCpuSince(sample, meter.baseline),
    accountingComplete: false,
    reasonUnaccounted:
      "pre_entry_return_cleanup_caller_tail_and_service_unaccounted",
  };
}

export function projectCallerSample(input, previous = null) {
  const result = {};
  for (const field of fields) {
    const descriptor = input && Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new Error("missing caller data measurement");
    result[field] = descriptor.value;
  }
  if (
    !Number.isSafeInteger(result.pid) ||
    result.pid < 1 ||
    result.pid > 0xffffffff ||
    fields
      .slice(1)
      .some(
        (field) => !Number.isSafeInteger(result[field]) || result[field] < 0
      ) ||
    !Number.isSafeInteger(result.userMicros + result.systemMicros) ||
    (previous &&
      (result.pid !== previous.pid ||
        result.userMicros < previous.userMicros ||
        result.systemMicros < previous.systemMicros))
  )
    throw new Error("invalid caller identity or CPU measurement");
  return result;
}

export function callerCpuSince(sample, baseline) {
  const base = projectCallerSample(baseline);
  const current = projectCallerSample(sample, base);
  return (
    (current.userMicros -
      base.userMicros +
      current.systemMicros -
      base.systemMicros) /
    1000
  );
}

export function addCallerResources(resource, input, owned) {
  const caller = projectCallerSample(input);
  const descriptor =
    resource && Object.getOwnPropertyDescriptor(resource, "treeRssGiB");
  if (
    !descriptor ||
    !Object.hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "number" ||
    !Number.isFinite(descriptor.value) ||
    descriptor.value < 0
  )
    throw new Error("invalid owned RSS operand");
  const ownedBytes = descriptor.value * 1024 ** 3;
  if (!Number.isSafeInteger(ownedBytes))
    throw new Error("invalid owned RSS operand");
  if (
    caller.pid === owned.rootPid ||
    caller.pid === owned.guardian?.pid ||
    caller.pid === owned.meter?.helper?.pid ||
    owned.members?.some((m) => m.pid === caller.pid)
  )
    throw new Error("caller overlaps owned process envelope");
  const totalBytes = ownedBytes + caller.rssBytes;
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0)
    throw new Error("invalid combined caller RSS");
  return { ...resource, treeRssGiB: totalBytes / 1024 ** 3 };
}

export function createCallerMeter() {
  function read() {
    const cpu = readCpu();
    return projectCallerSample({
      pid,
      userMicros: cpu.user,
      systemMicros: cpu.system,
      rssBytes: readRss(),
    });
  }
  const baseline = Object.freeze(read());
  let previous = baseline;
  const meter = Object.freeze({
    baseline,
    sample() {
      const current = projectCallerSample(read(), previous);
      previous = Object.freeze(current);
      return { ...current };
    },
  });
  meters.add(meter);
  return meter;
}
