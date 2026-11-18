import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  createCallerMeter,
  projectCallerSample,
  callerCpuSince,
  addCallerResources,
  requireCallerMeter,
  callerCutoff,
} from "./caller-meter.mjs";

export function testCallerMeter() {
  let completed = 0;
  const check = (name, run) => {
    run();
    console.log(`caller-meter ok ${++completed} - ${name}`);
  };
  const base = {
    pid: 103,
    userMicros: 1000,
    systemMicros: 2000,
    rssBytes: 4096,
  };
  const envelope = {
    rootPid: 100,
    guardian: { pid: 101 },
    meter: { helper: { pid: 102 } },
    members: [{ pid: 104 }],
  };
  check(
    "current process counters include work and return independent snapshots",
    () => {
      const meter = createCallerMeter(),
        first = meter.sample();
      const until = performance.now() + 120;
      while (performance.now() < until) {
        /* bounded real CPU observation */
      }
      const last = meter.sample();
      assert.equal(last.pid, process.pid);
      assert.ok(last.rssBytes > 0);
      assert.ok(callerCpuSince(last, first) > 0);
      first.userMicros = Number.MAX_SAFE_INTEGER;
      assert.ok(meter.sample().userMicros >= last.userMicros);
      assert.ok(Object.isFrozen(meter.baseline));
      const cutoff = callerCutoff(meter);
      assert.deepEqual(cutoff.baseline, meter.baseline);
      assert.ok(cutoff.cpuMs >= callerCpuSince(last, meter.baseline));
      assert.equal(cutoff.accountingComplete, false);
      cutoff.baseline.userMicros++;
      cutoff.sample.userMicros = -1;
      assert.notEqual(cutoff.baseline.userMicros, meter.baseline.userMicros);
      assert.ok(meter.sample().userMicros >= last.userMicros);
      let calls = 0;
      const forged = {
        get sample() {
          calls++;
          return meter.sample;
        },
      };
      for (const candidate of [
        forged,
        { ...meter },
        Object.create(meter),
        null,
      ]) {
        assert.throws(() => requireCallerMeter(candidate), /invalid/);
        assert.throws(() => callerCutoff(candidate), /invalid/);
      }
      assert.equal(calls, 0);
    }
  );
  check(
    "mandatory accessors and absent, invalid, reversed counters are rejected",
    () => {
      for (const field of Object.keys(base)) {
        const missing = { ...base };
        delete missing[field];
        assert.throws(() => projectCallerSample(missing));
        let calls = 0;
        Object.defineProperty(missing, field, {
          get() {
            calls++;
            return base[field];
          },
        });
        assert.throws(() => projectCallerSample(missing));
        assert.equal(calls, 0);
      }
      for (const field of Object.keys(base))
        for (const value of [-1, NaN, Infinity, 0.5, "1"])
          assert.throws(() => projectCallerSample({ ...base, [field]: value }));
      assert.throws(() => projectCallerSample({ ...base, pid: 0 }));
      assert.throws(() =>
        projectCallerSample({ ...base, userMicros: Number.MAX_SAFE_INTEGER })
      );
      for (const bad of [
        { ...base, pid: 104 },
        { ...base, userMicros: 999 },
        { ...base, systemMicros: 1999 },
      ])
        assert.throws(() => callerCpuSince(bad, base));
    }
  );
  check(
    "fresh data projection excludes serialization hooks and source mutation",
    () => {
      for (const inherited of [false, true]) {
        let calls = 0;
        const hook = {
          toJSON() {
            calls++;
            return { canary: true };
          },
        };
        const input = inherited
          ? Object.assign(Object.create(hook), base)
          : { ...base, ...hook };
        input.secret = "CANARY";
        const saved = projectCallerSample(input);
        input.userMicros = 9000;
        assert.equal(JSON.stringify(saved).includes("CANARY"), false);
        assert.deepEqual(saved, base);
        assert.equal(calls, 0);
      }
    }
  );
  check(
    "caller RSS participates in combined soft/hard bounds without duplicating owned PIDs",
    () => {
      const rssBytes = 1024 ** 3;
      assert.equal(
        addCallerResources({ treeRssGiB: 2 }, { ...base, rssBytes }, envelope)
          .treeRssGiB,
        3
      );
      for (const pid of [100, 101, 102, 104])
        assert.throws(() =>
          addCallerResources({ treeRssGiB: 0 }, { ...base, pid }, envelope)
        );
      for (const treeRssGiB of [
        NaN,
        Infinity,
        -1,
        Number.MAX_SAFE_INTEGER,
        "0",
        null,
        false,
        -1 / 1024 ** 3,
      ])
        assert.throws(() => addCallerResources({ treeRssGiB }, base, envelope));
      let calls = 0;
      const accessor = {
        get treeRssGiB() {
          calls++;
          return 0;
        },
      };
      assert.throws(() => addCallerResources(accessor, base, envelope));
      assert.equal(calls, 0);
      assert.equal(
        callerCpuSince({ ...base, userMicros: 2000, systemMicros: 3500 }, base),
        2.5
      );
    }
  );
  return { completed, provesRuntimeAcceptance: false };
}
