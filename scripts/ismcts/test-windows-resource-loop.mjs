import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { runWindowsResourceLoop } from "./windows-resource-loop.mjs";
import {
  createWindowsServiceReader,
  setWindowsServiceBusy,
  readWindowsServiceBusy,
} from "./windows-service-state.mjs";

export async function testWindowsResourceLoop() {
  let completed = 0;
  async function check(name, action) {
    await action();
    console.log(`windows-loop ok ${++completed} - ${name}`);
  }
  function fixture() {
    const calls = { start: 0, poll: 0, finish: 0, close: 0 };
    const controller = {
      resourceWatchdog: true,
      start: async () => {
        calls.start++;
        return { status: "running", decision: { action: "run" } };
      },
      poll: async () => {
        calls.poll++;
        return { status: "exited", decision: { action: "run" } };
      },
      finish: async () => {
        calls.finish++;
        return {
          accountingComplete: false,
          sample: { active: 0, exitCode: 0 },
        };
      },
      close: async () => {
        calls.close++;
      },
    };
    return { calls, controller };
  }
  await check(
    "unguarded or invalid service admission never enters the scheduler",
    async () => {
      const f = fixture();
      f.controller.resourceWatchdog = false;
      await assert.rejects(
        () => runWindowsResourceLoop(f.controller, { serviceBusy: false }),
        /watchdog/
      );
      assert.deepEqual(f.calls, { start: 0, poll: 0, finish: 0, close: 0 });
      f.controller.resourceWatchdog = true;
      await assert.rejects(
        () => runWindowsResourceLoop(f.controller),
        /service/
      );
    }
  );
  await check(
    "pre-cancelled ownership is drained without starting or completing accounting",
    async () => {
      const f = fixture(),
        cancel = new globalThis.AbortController();
      cancel.abort();
      const result = await runWindowsResourceLoop(f.controller, {
        serviceBusy: false,
        signal: cancel.signal,
      });
      assert.equal(result.reason, "cancelled");
      assert.equal(result.samples, 0);
      assert.equal(result.terminal.accountingComplete, false);
      assert.deepEqual(f.calls, { start: 0, poll: 0, finish: 1, close: 0 });
    }
  );
  await check(
    "one scheduler owns start and polling through terminal drain; a second cannot overlap",
    async () => {
      const f = fixture(),
        times = [];
      const pending = runWindowsResourceLoop(f.controller, {
        serviceBusy: false,
        onSample: () => {
          times.push(performance.now());
        },
      });
      await assert.rejects(
        () => runWindowsResourceLoop(f.controller, { serviceBusy: false }),
        /exclusive/
      );
      const result = await pending;
      assert.equal(result.status, "completed");
      assert.equal(result.samples, 2);
      assert.ok(times[1] - times[0] >= 1900);
      assert.equal(result.terminal.accountingComplete, false);
      assert.deepEqual(f.calls, { start: 1, poll: 1, finish: 1, close: 0 });
    }
  );
  await check(
    "scheduler passes its live reader through the asynchronous start boundary",
    async () => {
      const f = fixture();
      const reader = createWindowsServiceReader();
      f.controller.start = async (initial, finalReader) => {
        assert.equal(initial, false);
        assert.equal(finalReader, reader);
        await Promise.resolve();
        setWindowsServiceBusy(reader, true);
        assert.equal(readWindowsServiceBusy(finalReader), true);
        return {
          status: "stopped",
          decision: { action: "stop", reason: "service_priority" },
        };
      };
      const result = await runWindowsResourceLoop(f.controller, {
        serviceBusy: reader,
      });
      assert.equal(result.reason, "service_priority");
      assert.equal(result.status, "stopped");
      assert.equal(f.calls.poll, 0);
      assert.equal(f.calls.finish, 1);
    }
  );
  await check(
    "asynchronous service state rejects and closes ownership without starting",
    async () => {
      for (const serviceBusy of [
        async () => false,
        async () => {
          throw new Error("async service state rejection");
        },
        () => Promise.reject(new Error("returned service state rejection")),
      ]) {
        const f = fixture();
        await assert.rejects(
          () => runWindowsResourceLoop(f.controller, { serviceBusy }),
          /synchronous/
        );
        assert.deepEqual(f.calls, { start: 0, poll: 0, finish: 0, close: 1 });
      }
      await nextTurn();
    }
  );
  await check(
    "terminal native stops dominate cancellation or a zero root exit",
    async () => {
      for (const [flags, reason] of [
        [{ writeTransferLimitExceeded: true }, "write_transfer_limit"],
        [{ resourceWatchdogExpired: true }, "resource_watchdog_expired"],
        [
          { writeTransferLimitExceeded: true, resourceWatchdogExpired: true },
          "write_transfer_limit",
        ],
      ]) {
        for (const cancelled of [false, true]) {
          const f = fixture(),
            cancel = new globalThis.AbortController();
          if (cancelled) cancel.abort();
          f.controller.start = async () => ({
            status: "exited",
            decision: { action: "run" },
          });
          f.controller.finish = async () => ({
            accountingComplete: false,
            sample: { exitCode: 0, ...flags },
          });
          const result = await runWindowsResourceLoop(f.controller, {
            serviceBusy: false,
            signal: cancel.signal,
          });
          assert.equal(result.status, "stopped");
          assert.equal(result.reason, reason);
          assert.equal(result.terminal.accountingComplete, false);
        }
      }
    }
  );
  return { completed, provesRuntimeAcceptance: false };
}
