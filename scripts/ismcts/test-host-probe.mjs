import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  probeHost,
  projectWindowsHostCounters,
  intervalHostSample,
  hostEligibility,
} from "./host-probe.mjs";
import { loadProcessMeter } from "./windows-process-handle.mjs";

export async function testHostProbe() {
  let completed = 0;
  const check = async (name, run) => {
    await run();
    console.log(`host-probe ok ${++completed} - ${name}`);
  };
  const counters = {
    idleTicks: "90071992547409930",
    kernelTicks: "180143985094819860",
    userTicks: "90071992547409930",
    freeRamBytes: 8 * 1024 ** 3,
    totalRamBytes: 32 * 1024 ** 3,
    logicalCpus: 28,
    processorGroups: 1,
  };
  const host = (raw) => {
    const { freeRamBytes, totalRamBytes, ...rest } = raw;
    return {
      ...rest,
      freeRamGiB: freeRamBytes / 1024 ** 3,
      totalRamGiB: totalRamBytes / 1024 ** 3,
      source: "windows-native",
    };
  };
  const next = {
    ...counters,
    idleTicks: (BigInt(counters.idleTicks) + 100n).toString(),
    kernelTicks: (BigInt(counters.kernelTicks) + 200n).toString(),
    userTicks: (BigInt(counters.userTicks) + 100n).toString(),
  };
  await check(
    "aggregate projection refuses incomplete, malformed and partial-group measurements",
    () => {
      assert.deepEqual(projectWindowsHostCounters(counters), counters);
      for (const key of Object.keys(counters)) {
        const missing = { ...counters };
        delete missing[key];
        assert.throws(() => projectWindowsHostCounters(missing));
        let called = false;
        Object.defineProperty(missing, key, {
          get() {
            called = true;
            return counters[key];
          },
        });
        assert.throws(() => projectWindowsHostCounters(missing));
        assert.equal(called, false);
      }
      for (const key of ["idleTicks", "kernelTicks", "userTicks"])
        for (const value of [
          0,
          "-1",
          "01",
          "1.5",
          "18446744073709551616",
          null,
        ])
          assert.throws(() =>
            projectWindowsHostCounters({ ...counters, [key]: value })
          );
      for (const bad of [
        { freeRamBytes: -1 },
        { totalRamBytes: 0 },
        { freeRamBytes: 33 * 1024 ** 3 },
        { totalRamBytes: Number.MAX_SAFE_INTEGER + 1 },
        { logicalCpus: 0 },
        { logicalCpus: 65 },
        { logicalCpus: "28" },
        { processorGroups: 2 },
        { idleTicks: (BigInt(counters.kernelTicks) + 1n).toString() },
      ])
        assert.throws(() =>
          projectWindowsHostCounters({ ...counters, ...bad })
        );
      const input = {
        ...counters,
        secret: "CANARY",
        toJSON() {
          throw Error("must not serialize");
        },
      };
      assert.equal(
        JSON.stringify(projectWindowsHostCounters(input)).includes("CANARY"),
        false
      );
    }
  );
  await check(
    "large cumulative counters use exact differences and subtract Windows idle once",
    () => {
      const before = host(counters),
        after = host(next);
      const result = intervalHostSample(after, before);
      assert.ok(Math.abs(result.cpuPercent - 200 / 3) < 1e-10);
      assert.deepEqual(after, host(next));
      assert.equal("kernelTicks" in result, false);
      assert.equal("idleTicks" in result, false);
      assert.equal("userTicks" in result, false);
      assert.equal("cpuPercent" in before, false);
      for (const [idle, kernel, user, expected] of [
        [100n, 100n, 0n, 0],
        [0n, 0n, 100n, 100],
        [40n, 100n, 0n, 60],
      ]) {
        const advanced = host({
          ...counters,
          idleTicks: (BigInt(counters.idleTicks) + idle).toString(),
          kernelTicks: (BigInt(counters.kernelTicks) + kernel).toString(),
          userTicks: (BigInt(counters.userTicks) + user).toString(),
        });
        assert.equal(intervalHostSample(advanced, before).cpuPercent, expected);
      }
    }
  );
  await check(
    "zero, reversed, missing, incompatible and impossible intervals fail closed",
    () => {
      for (const bad of [
        counters,
        { ...next, idleTicks: (BigInt(counters.idleTicks) - 1n).toString() },
        {
          ...next,
          kernelTicks: (BigInt(counters.kernelTicks) - 1n).toString(),
        },
        { ...next, userTicks: (BigInt(counters.userTicks) - 1n).toString() },
        { ...next, idleTicks: (BigInt(counters.idleTicks) + 201n).toString() },
        { ...next, userTicks: undefined },
        { ...next, logicalCpus: 27 },
        { ...next, totalRamBytes: 31 * 1024 ** 3 },
        { ...next, processorGroups: 2 },
      ])
        assert.throws(() => intervalHostSample(host(bad), host(counters)));
      assert.throws(() =>
        intervalHostSample({ ...host(next), source: "other" }, host(counters))
      );
    }
  );
  await check(
    "Linux interval keeps iowait in idle and rejects invalid counters",
    () => {
      const before = {
        cpuTicks: 1000,
        idleTicks: 100,
        logicalCpus: 2,
        totalRamGiB: 8,
        source: "linux-proc",
      };
      assert.equal(
        intervalHostSample(
          { ...before, cpuTicks: 1100, idleTicks: 125 },
          before
        ).cpuPercent,
        75
      );
      for (const sample of [
        before,
        { ...before, cpuTicks: 900 },
        { ...before, cpuTicks: undefined },
        { ...before, cpuTicks: NaN },
        { ...before, cpuTicks: Number.MAX_SAFE_INTEGER + 1 },
        { ...before, cpuTicks: 1100, idleTicks: 1101 },
        { ...before, cpuTicks: 1100, idleTicks: 99 },
        { ...before, cpuTicks: 1100, idleTicks: 201 },
      ])
        assert.throws(() => intervalHostSample(sample, before));
    }
  );
  await check(
    "missing percentage, slow measurements and delayed recovery never authorize smoke",
    () => {
      const samples = Array.from({ length: 16 }, (_, i) => ({
        cpuPercent: 1,
        freeRamGiB: 8,
        measuredAt: 100000 + 2000 * i,
        probeMs: 1,
      }));
      assert.equal(hostEligibility(samples, 100000, 130000), true);
      for (const change of [
        { cpuPercent: undefined },
        { probeMs: 3100 },
        { measuredAt: 119100 },
      ]) {
        const changed = samples.map((s, i) =>
          i === 8 ? { ...s, ...change } : s
        );
        assert.equal(hostEligibility(changed, 100000, 130000), false);
      }
    }
  );
  await check(
    "actual host reader exposes aggregate counters without an invented initial CPU percentage",
    async () => {
      if (process.platform === "win32") {
        const binding = loadProcessMeter();
        assert.throws(() => binding.host(1));
        projectWindowsHostCounters(binding.host());
      }
      const before = probeHost();
      assert.equal("cpuPercent" in before, false);
      await delay(40);
      const after = probeHost();
      const sample = intervalHostSample(after, before);
      assert.ok(Number.isFinite(sample.cpuPercent));
      assert.ok(sample.cpuPercent >= 0 && sample.cpuPercent <= 100);
      assert.ok(
        sample.freeRamGiB >= 0 && sample.freeRamGiB <= sample.totalRamGiB
      );
      assert.ok(after.measuredAt >= before.measuredAt);
      assert.ok(after.probeMs >= 0);
      assert.equal(
        sample.source,
        process.platform === "win32" ? "windows-native" : "linux-proc"
      );
    }
  );
  return {
    completed,
    provesRuntimeAcceptance: false,
    provesGameCalibration: false,
  };
}
