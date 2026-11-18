import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  windowsHostMeasurement,
  createWindowsResourceController,
} from "./windows-resource-controller.mjs";
import {
  createWindowsServiceReader,
  setWindowsServiceBusy,
} from "./windows-service-state.mjs";

export async function testWindowsResourceController() {
  let completed = 0;
  async function check(name, fn) {
    await fn();
    console.log(`windows-resource ok ${++completed} - ${name}`);
  }
  function sample(atMs, { cpu = 10, ram = 8, rss = 0.25 } = {}) {
    // Raw counters deliberately exceed Number.MAX_SAFE_INTEGER.
    const base = 90071992547409930n,
      total = BigInt(atMs) * 10000n;
    return {
      rootPid: 100,
      rootCreated: "1000",
      active: 1,
      exitCode: 259,
      resourceWatchdogEnabled: false,
      resourceWatchdogExpired: false,
      cpuMs: atMs / 10,
      rssBytes: 1024,
      commitLimitBytes: 3 * 1024 ** 3,
      affinityMask: "1",
      priority: 0x4000,
      members: [{ pid: 100, created: "1000", rssBytes: 1024 }],
      guardian: {
        pid: 101,
        created: "1001",
        cpuMs: atMs / 20,
        rssBytes: 1024,
        affinityMask: "1",
        priority: 0x4000,
      },
      totalCpuMs: atMs / 10 + atMs / 20,
      totalRssBytes: 2048,
      meter: {
        target: {
          pid: 101,
          created: "1001",
          exited: "0",
          cpuMs: atMs / 20,
          signaled: false,
          exitCode: 259,
        },
        helper: {
          pid: 102,
          created: "1002",
          cpuMs: atMs / 30,
          rssBytes: rss * 1024 ** 3 - 2048,
          affinityMask: "1",
          priority: 0x4000,
        },
      },
      observedTotalCpuMs: atMs / 10 + atMs / 20 + atMs / 30,
      observedTotalRssBytes: rss * 1024 ** 3,
      host: {
        pid: 101,
        processorGroups: 1,
        atMs,
        startToken: atMs.toString(16).padStart(32, "0"),
        idleTicks: (base + (total * BigInt(100 - cpu)) / 100n).toString(),
        kernelTicks: (base + total).toString(),
        userTicks: "0",
        freeRamBytes: ram * 1024 ** 3,
        totalRamBytes: 32 * 1024 ** 3,
      },
    };
  }
  function fixture(watchdog = false, writeLimit = false) {
    let now = 0,
      read = () => ({
        ...sample((now += 2000)),
        resourceWatchdogEnabled: watchdog,
      });
    const calls = { start: 0, terminate: 0, close: 0 };
    const job = {
      initial: {
        ...sample(0),
        resourceWatchdogEnabled: watchdog,
        ...(writeLimit
          ? {
              writeTransferLimitBytes: 0,
              writeTransferLimitExceeded: false,
              writeTransferBytes: "0",
            }
          : {}),
      },
      resourceWatchdog: watchdog,
      sample: () => read(),
      start: async (guard) => {
        const allowed = guard(await read());
        if (allowed) calls.start++;
        return allowed;
      },
      terminate: async () => {
        calls.terminate++;
      },
      close: async () => {
        calls.close++;
      },
      finish: async () => ({ accountingComplete: false }),
    };
    return {
      job,
      calls,
      controller: createWindowsResourceController(job, 1),
      setRead(fn) {
        read = fn;
      },
      get now() {
        return now;
      },
    };
  }
  async function ready(f) {
    for (let n = 0; n < 15; n++)
      assert.equal((await f.controller.poll()).status, "waiting");
  }
  await check(
    "native cumulative CPU is differenced exactly; first point cannot start",
    () => {
      const a = sample(0),
        b = sample(2000);
      assert.equal(windowsHostMeasurement(a).cpuPercent, null);
      assert.equal(windowsHostMeasurement(b, a).cpuPercent, 10);
      assert.equal(windowsHostMeasurement(b, a).freeRamGiB, 8);
    }
  );
  await check(
    "identity, missing/invalid counters, reversal, stale intervals and RAM are rejected",
    () => {
      const a = sample(0),
        b = sample(2000);
      for (const mutate of [
        (x) => delete x.host,
        (x) => x.host.pid++,
        (x) => (x.guardian.created = "9999"),
        (x) => (x.host.processorGroups = 2),
        (x) => delete x.host.startToken,
        (x) => (x.host.startToken = "invalid"),
        (x) => (x.host.atMs = 0),
        (x) => (x.host.atMs = 3001),
        (x) => (x.host.idleTicks = "18446744073709551616"),
        (x) => (x.host.userTicks = "-1"),
        (x) =>
          (x.host.kernelTicks = (BigInt(a.host.kernelTicks) - 1n).toString()),
        (x) =>
          (x.host.idleTicks = (BigInt(x.host.kernelTicks) + 1n).toString()),
        (x) => (x.host.freeRamBytes = 33 * 1024 ** 3),
        (x) => (x.host.totalRamBytes = 0),
        (x) => x.host.totalRamBytes++,
        (x) => (x.host.freeRamBytes = NaN),
      ]) {
        const bad = JSON.parse(JSON.stringify(b));
        mutate(bad);
        assert.throws(() => windowsHostMeasurement(bad, a));
      }
    }
  );
  await check(
    "30 seconds and final pre-resume measurement are required before starting",
    async () => {
      const f = fixture();
      await ready(f);
      assert.equal(f.calls.start, 0);
      assert.equal((await f.controller.start()).status, "running");
      assert.equal(f.calls.start, 1);
      assert.equal((await f.controller.finish()).accountingComplete, false);
    }
  );
  await check(
    "RAM degraded between policy observation and ResumeThread denies start",
    async () => {
      const f = fixture();
      await ready(f);
      let n = f.now;
      f.setRead(() => sample((n += 2000), { ram: n === 32000 ? 8 : 5 }));
      assert.equal((await f.controller.start()).status, "waiting");
      assert.equal(f.calls.start, 0);
    }
  );
  await check(
    "service acquired during the final sample vetoes resume and resets the safe window",
    async () => {
      const f = fixture();
      await ready(f);
      let n = f.now,
        busy = createWindowsServiceReader(),
        reads = 0;
      f.setRead(() => {
        const value = sample((n += 2000));
        if (++reads === 2) setWindowsServiceBusy(busy, true);
        return value;
      });
      const result = await f.controller.start(false, busy);
      assert.equal(result.status, "waiting");
      assert.equal(result.decision.reason, "service_priority");
      assert.equal(f.calls.start, 0);
      setWindowsServiceBusy(busy, false);
      assert.equal((await f.controller.start(false, busy)).status, "waiting");
      assert.equal(f.calls.start, 0);
    }
  );
  await check(
    "unowned final service callbacks are rejected without invoking them or creating promises",
    async () => {
      let invoked = 0;
      for (const reader of [
        null,
        () => undefined,
        async () => false,
        async () => {
          throw new Error("async service reader rejection");
        },
        () => {
          invoked++;
          return Promise.reject(new Error("returned service reader rejection"));
        },
        () => {
          const value = Promise.reject(new Error("overridden promise method"));
          value.then = () => assert.fail("must not invoke overridden then");
          return value;
        },
        () => {
          throw new Error("service checkpoint unavailable");
        },
      ]) {
        const f = fixture();
        await ready(f);
        await assert.rejects(() => f.controller.start(false, reader));
        assert.equal(f.calls.start, 0);
        assert.equal(f.calls.terminate, 1);
        assert.equal(f.calls.close, 1);
      }
      assert.equal(invoked, 0);
      // No caller promise is created; Node's strict next turn survives.
      await nextTurn();
    }
  );
  await check(
    "sustained CPU overload stops the running owned job at ten seconds",
    async () => {
      const f = fixture();
      await ready(f);
      await f.controller.start();
      let n = f.now,
        old = sample(n),
        kernel = BigInt(old.host.kernelTicks),
        idle = BigInt(old.host.idleTicks);
      f.setRead(() => {
        const x = sample((n += 2000));
        kernel += 20000000n;
        idle += 6000000n;
        x.host.kernelTicks = kernel.toString();
        x.host.idleTicks = idle.toString();
        return x;
      });
      for (let i = 0; i < 5; i++)
        assert.equal((await f.controller.poll()).status, "running");
      const result = await f.controller.poll();
      assert.equal(result.status, "stopped");
      assert.equal(result.decision.reason, "cpu_load");
      assert.equal(f.calls.terminate, 1);
      assert.equal(f.calls.start, 1);
    }
  );
  await check(
    "low host RAM, soft owned RSS and service priority terminate only the owned handle",
    async () => {
      for (const [options, serviceBusy, reason] of [
        [{ ram: 3 }, false, "ram_free"],
        [{ rss: 2 }, false, "ram_soft"],
        [{}, true, "service_priority"],
      ]) {
        const f = fixture();
        await ready(f);
        await f.controller.start();
        let n = f.now;
        f.setRead(() => sample((n += 2000), options));
        assert.equal(
          (await f.controller.poll(serviceBusy)).decision.reason,
          reason
        );
        assert.equal(f.calls.terminate, 1);
        assert.equal(f.calls.start, 1);
        await assert.rejects(() => f.controller.poll());
      }
    }
  );
  await check(
    "sampling loss closes the owned job and cannot restart using the old safe window",
    async () => {
      const f = fixture();
      await ready(f);
      await f.controller.start();
      let n = f.now;
      f.setRead(() => sample((n += 4000)));
      await assert.rejects(() => f.controller.poll(), /interval/);
      assert.equal(f.calls.terminate, 1);
      assert.equal(f.calls.close, 1);
      await assert.rejects(() => f.controller.start());
    }
  );
  await check(
    "overlapping control operations cannot double-start or race terminal accounting",
    async () => {
      const f = fixture();
      let release;
      f.setRead(
        () =>
          new Promise((done) => {
            release = () => done(sample(2000));
          })
      );
      const pending = f.controller.poll();
      await assert.rejects(() => f.controller.start(), /overlap/);
      await assert.rejects(() => f.controller.finish(), /overlap/);
      release();
      await pending;
      assert.equal(f.calls.start, 0);
    }
  );
  await check(
    "native watchdog expiry preserves the stop reason after caller sampling loss",
    async () => {
      const f = fixture(true);
      await ready(f);
      await f.controller.start();
      f.setRead(() => ({
        ...sample(f.now + 4000),
        resourceWatchdogEnabled: true,
        resourceWatchdogExpired: true,
        active: 0,
        members: [],
        rssBytes: 0,
        totalRssBytes: 1024,
        observedTotalRssBytes: 0.25 * 1024 ** 3 - 1024,
        exitCode: 126,
      }));
      const stopped = await f.controller.poll();
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.decision.reason, "resource_watchdog_expired");
      assert.equal(f.calls.terminate, 0);
      await assert.rejects(() => f.controller.start(), /ended/);
      assert.equal((await f.controller.finish()).accountingComplete, false);
    }
  );
  await check(
    "write limit survives delayed polling and a zero root exit without becoming completed",
    async () => {
      const f = fixture(false, true);
      f.setRead(() => ({
        ...sample(4000),
        active: 0,
        members: [],
        rssBytes: 0,
        totalRssBytes: 1024,
        observedTotalRssBytes: 0.25 * 1024 ** 3 - 1024,
        exitCode: 0,
        writeTransferLimitBytes: 0,
        writeTransferLimitExceeded: true,
        writeTransferBytes: "4096",
      }));
      const stopped = await f.controller.poll();
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.decision.reason, "write_transfer_limit");
      assert.equal(stopped.sample.exitCode, 0);
      assert.equal(f.calls.start, 0);
      assert.equal((await f.controller.finish()).accountingComplete, false);
    }
  );
  await check(
    "known hard RSS terminates even before launch and when a service is waiting",
    async () => {
      for (const serviceBusy of [false, true]) {
        const f = fixture();
        let n = 0;
        f.setRead(() => sample((n += 2000), { rss: 3, ram: 3 }));
        const result = await f.controller.start(serviceBusy);
        assert.equal(result.status, "stopped");
        assert.equal(result.decision.reason, "ram_hard");
        assert.equal(f.calls.terminate, 1);
        assert.equal(f.calls.start, 0);
      }
      const f = fixture();
      await ready(f);
      let n = f.now;
      f.setRead(() => sample((n += 2000), { rss: n === 32000 ? 0.25 : 3 }));
      assert.equal((await f.controller.start()).status, "stopped");
      assert.equal(f.calls.terminate, 1);
      assert.equal(f.calls.start, 0);
    }
  );
  await check(
    "real caller RSS joins the policy envelope and terminal CPU stays partial",
    async () => {
      const f = fixture();
      const observed = await f.controller.poll();
      assert.equal(observed.sample.caller.pid, process.pid);
      assert.ok(observed.sample.caller.rssBytes > 0);
      assert.ok(
        observed.sample.caller.userMicros >=
          observed.sample.callerBaseline.userMicros
      );
      let n = f.now;
      // Child/helper alone is below hard. Current caller's measured RSS takes
      // the aggregate above it without allocating any artificial stress memory.
      f.setRead(() =>
        sample((n += 2000), {
          rss: 3 - observed.sample.caller.rssBytes / 1024 ** 3 / 2,
        })
      );
      const stopped = await f.controller.poll();
      assert.equal(stopped.decision.reason, "ram_hard");
      assert.equal(f.calls.terminate, 1);
      const terminal = await f.controller.finish();
      assert.equal(terminal.callerFinal.pid, process.pid);
      assert.ok(terminal.callerCpuMs >= 0);
      assert.equal(terminal.accountingComplete, false);
    }
  );
  return { completed, provesRuntimeAcceptance: false };
}
