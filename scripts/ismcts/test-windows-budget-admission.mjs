import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  runReservedWindowsJob as runWithStorage,
  runWindowsBudgetedJob,
  executeOwnedWindowsJob,
} from "./windows-budget-admission.mjs";
import { budgetStatus, reserveBudget, finishBudget } from "./budget.mjs";
import { nextJstDay } from "./resources.mjs";
import { createWindowsJob } from "./windows-job.mjs";
import { createWindowsResourceController } from "./windows-resource-controller.mjs";
import { runWindowsResourceLoop } from "./windows-resource-loop.mjs";
import { programPaths } from "./shared.mjs";
import childProcess, { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import { assertStorageHeadroom } from "./storage-admission.mjs";
import { loadProcessMeter } from "./windows-process-handle.mjs";
import { buildProcessMeter } from "./build-process-handle.mjs";
import {
  createWindowsServiceReader,
  setWindowsServiceBusy,
} from "./windows-service-state.mjs";

export async function testWindowsBudgetAdmission() {
  const root = mkdtempSync(join(tmpdir(), "orica-budget-admission-"));
  const module = join(root, "idle.mjs"),
    marker = join(root, "started.json");
  writeFileSync(
    module,
    `import fs from 'node:fs';fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`
  );
  let completed = 0,
    sequence = 0;
  const directory = () => join(root, `ledger-${++sequence}`);
  const request = (overrides = {}) => ({
    module,
    cwd: root,
    args: [marker],
    threads: 1,
    wallMs: 10000,
    outputBytes: 32,
    ...overrides,
  });
  const callbacks = { serviceBusy: false };
  // These budget-only private fixtures model healthy storage explicitly. The
  // production entry cannot override its real Git/storage measurement.
  const runReservedWindowsJob = (...args) => runWithStorage(...args, () => {});
  async function check(name, fn) {
    await fn();
    console.log(`windows-budget ok ${++completed} - ${name}`);
  }
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    await check(
      "strict caller rejects observer code without invocation, allocation or reservation",
      () => {
        const child = join(root, "reject-observer.mjs");
        writeFileSync(
          child,
          `
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { runReservedWindowsJob, runWindowsBudgetedJob } from ${JSON.stringify(new URL("windows-budget-admission.mjs", import.meta.url).href)};
import { runWindowsObservedJob } from ${JSON.stringify(new URL("runtime-telemetry.mjs", import.meta.url).href)};
const [worktree, directory, module] = process.argv.slice(2);
let invoked = 0, generated = 0, scans = 0, getterReads = 0, rejected = 0;
const request = { module, cwd: directory, args: [], threads: 1, wallMs: 60000, outputBytes: 16384 };
const hooks = [
  undefined,
  () => { invoked++; return Promise.reject(new Error('private observer rejection')); },
  async () => { invoked++; throw new Error('private async observer rejection'); },
  () => {
    invoked++;
    const promise = Promise.reject(new Error('private observer species'));
    Object.defineProperty(promise, 'constructor', { get() { throw new Error('private constructor'); } });
    return promise;
  },
  () => { invoked++; throw new Error('private synchronous observer'); },
];
const entries = [
  controls => runReservedWindowsJob(join(directory, 'ledger'), request, controls,
    async () => { generated++; }, () => { scans++; }),
];
if (process.platform === 'win32') entries.push(
  controls => runWindowsBudgetedJob(worktree, request, controls),
  controls => runWindowsObservedJob(worktree, request, controls),
);
for (const entry of entries) {
  for (const hook of hooks) {
    await assert.rejects(() => entry({ serviceBusy: false, onSample: hook }), /invalid reserved/);
    rejected++;
  }
  const controls = { serviceBusy: false };
  Object.defineProperty(controls, 'onSample', { get() { getterReads++; return hooks[1]; } });
  await assert.rejects(() => entry(controls), /invalid reserved/);
  rejected++;
}
await setImmediate();
assert.deepEqual({ invoked, generated, scans, getterReads }, { invoked: 0, generated: 0, scans: 0, getterReads: 0 });
assert.equal(existsSync(join(directory, 'ledger', 'usage.json')), false);
console.log(JSON.stringify({ rejected, invoked, generated, scans, getterReads, callerContinued: true }));
`
        );
        const stdout = execFileSync(
          process.execPath,
          ["--unhandled-rejections=strict", child, process.cwd(), root, module],
          { encoding: "utf8", timeout: 30000, windowsHide: true }
        );
        const result = JSON.parse(stdout);
        assert.equal(result.rejected, process.platform === "win32" ? 18 : 6);
        assert.equal(result.callerContinued, true);
        assert.deepEqual(
          [result.invoked, result.generated, result.scans, result.getterReads],
          [0, 0, 0, 0]
        );
      }
    );
    await check(
      "invalid request and service state cannot reserve or generate a process",
      async () => {
        const dir = directory();
        let calls = 0;
        const execute = async () => {
          calls++;
        };
        for (const value of [
          request({ threads: 3 }),
          request({ args: [1] }),
          request({ owner: "override" }),
          request({ writeTransferLimitBytes: 2147483648 }),
          request({ outputBytes: -1 }),
          request({ outputBytes: null }),
          request({ monitor: null }),
          request({ storageAdmission: () => {} }),
        ])
          await assert.rejects(() =>
            runReservedWindowsJob(dir, value, callbacks, execute)
          );
        for (const serviceBusy of [
          async () => false,
          async () => {
            throw new Error("async admission service rejection");
          },
          () =>
            Promise.reject(new Error("returned admission service rejection")),
        ])
          await assert.rejects(
            () =>
              runReservedWindowsJob(dir, request(), { serviceBusy }, execute),
            /synchronous/
          );
        await nextTurn();
        assert.equal(calls, 0);
        assert.equal(existsSync(join(dir, "usage.json")), false);
      }
    );
    await check(
      "service priority and pre-cancellation defer before any reservation",
      async () => {
        const dir = directory(),
          cancel = new globalThis.AbortController();
        cancel.abort();
        const execute = () => assert.fail("factory must not run");
        assert.equal(
          (
            await runReservedWindowsJob(
              dir,
              request(),
              { serviceBusy: true },
              execute
            )
          ).reason,
          "service_priority"
        );
        assert.equal(
          (
            await runReservedWindowsJob(
              dir,
              request(),
              { ...callbacks, signal: cancel.signal },
              execute
            )
          ).reason,
          "cancelled_before_reservation"
        );
        assert.equal(existsSync(join(dir, "usage.json")), false);
      }
    );
    await check(
      "concurrent and restarted callers cannot create a second job behind an active reservation",
      async () => {
        const dir = directory();
        let enter,
          release,
          calls = 0;
        const entered = new Promise((r) => {
            enter = r;
          }),
          blocked = new Promise((r) => {
            release = r;
          });
        const first = runReservedWindowsJob(
          dir,
          request(),
          callbacks,
          async () => {
            calls++;
            enter();
            await blocked;
            return {
              status: "completed",
              terminal: { accountingComplete: false },
            };
          }
        );
        await entered;
        assert.equal(budgetStatus(dir).active.length, 1);
        assert.equal(
          (
            await runReservedWindowsJob(dir, request(), callbacks, () =>
              assert.fail("second factory")
            )
          ).status,
          "deferred_load"
        );
        release();
        const result = await first;
        assert.equal(result.status, "unreconciled");
        assert.equal(result.execution.status, "completed");
        assert.equal(calls, 1);
        assert.equal(
          (
            await runReservedWindowsJob(dir, request(), callbacks, () =>
              assert.fail("restart factory")
            )
          ).status,
          "deferred_load"
        );
      }
    );
    await check(
      "known budget refusals write zero OS bytes and skip capacity helpers before reservation",
      async () => {
        const activeDir = directory(),
          dailyDir = directory();
        reserveBudget(activeDir, { wallMs: 1000, owner: "unreconciled" });
        const prior = reserveBudget(
          dailyDir,
          {
            wallMs: 1,
            outputBytes: 2147483648,
            owner: "exhausted",
          },
          Date.now() - 1
        );
        finishBudget(dailyDir, prior.id, prior.owner, {
          status: "failed",
          treeExited: true,
          accountingComplete: true,
          usage: {
            wallMs: 0,
            cpuMs: 0,
            gpuMs: 0,
            monitorMs: 0,
            outputBytes: 0,
          },
        });
        const saved = [activeDir, dailyDir].map((dir) =>
          readFileSync(join(dir, "usage.json"))
        );
        if (process.platform === "win32") buildProcessMeter();
        const meter =
          process.platform === "win32"
            ? loadProcessMeter().open(process.pid)
            : null;
        let scans = 0,
          created = 0,
          writeBytes;
        try {
          const before = meter?.sample();
          for (const [dir, reason] of [
            [activeDir, "owned_job_or_unreconciled_orphan"],
            [dailyDir, "daily_limit"],
          ]) {
            const result = await runWithStorage(
              dir,
              request(),
              callbacks,
              () => {
                created++;
              },
              () => {
                scans++;
              }
            );
            assert.equal(result.reason, reason);
            assert.equal(
              reserveBudget(dir, {
                wallMs: 1000,
                outputBytes: 32,
                owner: "restart",
              }).reason,
              reason
            );
          }
          const after = meter?.sample();
          if (meter)
            writeBytes = String(
              BigInt(after.writeTransferBytes) -
                BigInt(before.writeTransferBytes)
            );
        } finally {
          meter?.close();
        }
        assert.deepEqual({ scans, created }, { scans: 0, created: 0 });
        if (process.platform === "win32") assert.equal(writeBytes, "0");
        for (const [index, dir] of [activeDir, dailyDir].entries())
          assert.deepEqual(readFileSync(join(dir, "usage.json")), saved[index]);
        assert.equal(budgetStatus(activeDir).active[0].owner, "unreconciled");
        assert.equal(budgetStatus(dailyDir).used.outputBytes, 2147483648);
        console.log(
          `I0_READONLY_REFUSAL_RESULT ${JSON.stringify({ scans, created, writeBytes: writeBytes ?? null, accountingComplete: false })}`
        );
      }
    );
    await check(
      "availability before capacity work cannot bypass a competing reservation or corrupt history",
      async () => {
        const dir = directory();
        let scans = 0;
        const result = await runWithStorage(
          dir,
          request(),
          callbacks,
          () => assert.fail("a preview cannot authorize process creation"),
          () => {
            scans++;
            assert.equal(
              reserveBudget(dir, { wallMs: 1000, owner: "competitor" }).status,
              "reserved"
            );
          }
        );
        assert.equal(result.reason, "owned_job_or_unreconciled_orphan");
        assert.equal(scans, 1);
        assert.equal(budgetStatus(dir).active.length, 1);
        assert.equal(budgetStatus(dir).active[0].owner, "competitor");
        const file = join(dir, "usage.json"),
          saved = readFileSync(file);
        writeFileSync(file, "{}");
        await assert.rejects(
          () =>
            runWithStorage(
              dir,
              request(),
              callbacks,
              () => assert.fail("corrupt history must not create work"),
              () => assert.fail("corrupt history must not launch capacity work")
            ),
          /invalid budget ledger/
        );
        assert.equal(readFileSync(file, "utf8"), "{}");
        writeFileSync(file, saved);
        writeFileSync(join(dir, "transaction.lock"), "retained unknown owner");
        await assert.rejects(
          () =>
            runWithStorage(
              dir,
              request(),
              callbacks,
              () => assert.fail("locked history must not create work"),
              () => assert.fail("locked history must not launch capacity work")
            ),
          /EEXIST/
        );
        assert.equal(
          readFileSync(join(dir, "transaction.lock"), "utf8"),
          "retained unknown owner"
        );
      }
    );
    await check(
      "failure after admission retains the full immutable reservation and ownership",
      async () => {
        const dir = directory();
        let bytes;
        await assert.rejects(
          () =>
            runReservedWindowsJob(dir, request(), callbacks, async () => {
              bytes = readFileSync(join(dir, "usage.json"));
              throw new Error("startup failed");
            }),
          (error) =>
            error.reservation.status === "reserved" &&
            error.cause.message === "startup failed"
        );
        assert.deepEqual(readFileSync(join(dir, "usage.json")), bytes);
        assert.equal(budgetStatus(dir).used.wallMs, 10000);
        assert.equal(budgetStatus(dir).used.cpuMs, 10000);
      }
    );
    await check(
      "scheduler success or an injected completeness flag never refunds program accounting",
      async () => {
        const dir = directory();
        let bytes;
        const result = await runReservedWindowsJob(
          dir,
          request({ threads: 2 }),
          callbacks,
          async (owned) => {
            assert.equal(owned.resourceWatchdog, true);
            assert.equal(owned.threads, 2);
            assert.ok(owned.wallMs > 0 && owned.wallMs <= 10000);
            bytes = readFileSync(join(dir, "usage.json"));
            return {
              status: "completed",
              terminal: {
                accountingComplete: true,
                sample: { active: 0, exitCode: 0 },
              },
            };
          }
        );
        assert.equal(result.reason, "program_accounting_unavailable");
        assert.deepEqual(readFileSync(join(dir, "usage.json")), bytes);
        assert.equal(budgetStatus(dir).used.cpuMs, 20000);
      }
    );
    await check(
      "reservation deadline cancels factory work during initialization",
      async () => {
        const dir = directory();
        const result = await runReservedWindowsJob(
          dir,
          request({ wallMs: 75 }),
          callbacks,
          async (owned) => {
            await new Promise((resolve) =>
              owned.signal.addEventListener("abort", resolve, { once: true })
            );
            assert.equal(owned.signal.aborted, true);
            return { status: "stopped", reason: "creation_cancelled" };
          }
        );
        assert.equal(result.status, "unreconciled");
        assert.equal(budgetStatus(dir).used.wallMs, 75);
      }
    );
    await check(
      "daily exhaustion refuses the factory with no worktree-specific allowance",
      async () => {
        const dir = directory();
        const reservation = reserveBudget(
          dir,
          {
            wallMs: 1,
            threads: 1,
            owner: "prior",
            outputBytes: 2147483648,
          },
          Date.now() - 1
        );
        finishBudget(dir, reservation.id, "prior", {
          status: "failed",
          treeExited: true,
          accountingComplete: true,
          usage: {
            wallMs: 0,
            cpuMs: 0,
            gpuMs: 0,
            monitorMs: 0,
            outputBytes: 0,
          },
        });
        // A fully reconciled failure still charges the pessimistic daily output.
        const bytes = readFileSync(join(dir, "usage.json"));
        assert.equal(
          (
            await runReservedWindowsJob(dir, request(), callbacks, () =>
              assert.fail("daily factory")
            )
          ).status,
          "deferred_budget"
        );
        assert.equal(budgetStatus(dir).active.length, 0);
        assert.equal(budgetStatus(dir).used.outputBytes, 2147483648);
        assert.equal(
          budgetStatus(dir, nextJstDay(Date.now())).remaining.outputBytes,
          2147483648
        );
        assert.deepEqual(readFileSync(join(dir, "usage.json")), bytes);
      }
    );
    await check(
      "production admission resolves the registered Git common root and shares its active ledger",
      async () => {
        const repo = join(root, "repo");
        execFileSync("git", ["init", "-b", "main", repo], {
          stdio: "ignore",
          windowsHide: true,
        });
        mkdirSync(join(repo, "autorun-queue"));
        writeFileSync(
          join(repo, "autorun-queue/cluster-registry.json"),
          JSON.stringify({ clusters: [] })
        );
        const shared = programPaths(repo).shared;
        reserveBudget(shared, { wallMs: 1000, threads: 1, owner: "prior" });
        if (process.platform === "win32") {
          const saved = readFileSync(join(shared, "usage.json"));
          let reads = 0;
          const changingRequest = request();
          Object.defineProperty(changingRequest, "outputBytes", {
            enumerable: true,
            get() {
              reads++;
              return reads % 2 ? 0 : 2147483648;
            },
          });
          await assert.rejects(
            () => runWindowsBudgetedJob(repo, changingRequest, callbacks),
            /invalid reserved/
          );
          const changingCallbacks = { ...callbacks };
          Object.defineProperty(changingCallbacks, "onSample", {
            enumerable: true,
            get() {
              reads++;
              const until = performance.now() + 150;
              while (performance.now() < until) {
                /* former post-deadline accessor */
              }
              return () => {};
            },
          });
          await assert.rejects(
            () => runWindowsBudgetedJob(repo, request(), changingCallbacks),
            /invalid reserved/
          );
          assert.equal(reads, 0);
          assert.deepEqual(readFileSync(join(shared, "usage.json")), saved);
          assert.equal(
            (await runWindowsBudgetedJob(repo, request(), callbacks)).status,
            "deferred_load"
          );
          assert.equal(existsSync(marker), false);
        } else
          assert.throws(
            () => runWindowsBudgetedJob(repo, request(), callbacks),
            /unavailable/
          );
      }
    );
    await check(
      "one data snapshot binds quota and callbacks despite caller mutation",
      async () => {
        const dir = directory(),
          quota = 2147483648,
          values = request({ outputBytes: quota });
        const seen = [];
        await assert.rejects(
          () =>
            runWithStorage(
              dir,
              values,
              { serviceBusy: false },
              () => assert.fail("factory must not run"),
              (output) => {
                values.outputBytes = 0;
                seen.push(output);
                assertStorageHeadroom(
                  {
                    status: "ok",
                    bytes: 149 * 1024 ** 3,
                    freeBytes: 300 * 1024 ** 3,
                  },
                  0,
                  output
                );
              }
            ),
          /ARTIFACT_STORAGE_LIMIT/
        );
        assert.deepEqual(seen, [quota]);
        assert.equal(existsSync(join(dir, "usage.json")), false);
        const stableDir = directory(),
          stableRequest = request({ outputBytes: 32 }),
          cancellation = new globalThis.AbortController();
        const stableCallbacks = {
          serviceBusy: false,
          signal: cancellation.signal,
        };
        const outputs = [];
        const result = await runWithStorage(
          stableDir,
          stableRequest,
          stableCallbacks,
          async (owned, acceptedCallbacks) => {
            assert.equal(acceptedCallbacks.signal.aborted, false);
            cancellation.abort();
            assert.equal(acceptedCallbacks.signal.aborted, true);
            assert.equal(Object.hasOwn(acceptedCallbacks, "onSample"), false);
            assert.deepEqual(owned.args, [marker]);
            return { status: "completed" };
          },
          (output) => {
            stableRequest.outputBytes = 2147483648;
            stableRequest.args.push("mutated");
            stableCallbacks.signal = new globalThis.AbortController().signal;
            outputs.push(output);
          }
        );
        assert.deepEqual(outputs, [32, 32]);
        assert.equal(result.reservation.reserved.outputBytes, 32);
        assert.equal(budgetStatus(stableDir).used.outputBytes, 32);
        assert.equal(result.reason, "program_accounting_unavailable");
        for (const property of ["serviceBusy", "onSample", "signal"]) {
          const accessorDir = directory(),
            supplied = { ...callbacks };
          let reads = 0;
          Object.defineProperty(supplied, property, {
            get() {
              reads++;
              return () => {};
            },
          });
          await assert.rejects(
            () =>
              runWithStorage(
                accessorDir,
                request(),
                supplied,
                () => assert.fail("factory must not run"),
                () => {}
              ),
            /invalid reserved/
          );
          assert.equal(reads, 0);
          assert.equal(existsSync(join(accessorDir, "usage.json")), false);
        }
      }
    );
    await check(
      "storage veto before reservation does not create processes or a ledger",
      async () => {
        const dir = directory();
        await assert.rejects(
          () =>
            runWithStorage(
              dir,
              request(),
              callbacks,
              () => assert.fail("factory must not run"),
              () => {
                throw new Error("capacity unavailable");
              }
            ),
          /capacity unavailable/
        );
        assert.equal(existsSync(join(dir, "usage.json")), false);
        await assert.rejects(
          () =>
            runWithStorage(
              dir,
              request(),
              callbacks,
              () => assert.fail("factory must not run"),
              async () => {}
            ),
          /synchronously/
        );
        await assert.rejects(
          () =>
            runWithStorage(dir, request(), callbacks, () =>
              assert.fail("factory must not run")
            ),
          /invalid/
        );
        assert.equal(existsSync(join(dir, "usage.json")), false);
      }
    );
    await check(
      "post-reservation capacity failure keeps the full reservation and refuses the factory",
      async () => {
        const dir = directory();
        let checks = 0;
        await assert.rejects(
          () =>
            runWithStorage(
              dir,
              request(),
              callbacks,
              () => assert.fail("factory must not run"),
              () => {
                if (++checks === 2) throw new Error("capacity changed");
              }
            ),
          (error) =>
            error.cause?.message === "capacity changed" && !!error.reservation
        );
        const status = budgetStatus(dir);
        assert.equal(checks, 2);
        assert.equal(status.active.length, 1);
        assert.equal(status.used.wallMs, 10000);
        assert.equal(status.used.outputBytes, 32);
        const saved = readFileSync(join(dir, "usage.json"));
        assert.equal(
          (
            await runReservedWindowsJob(dir, request(), callbacks, () =>
              assert.fail("factory must not run")
            )
          ).status,
          "deferred_load"
        );
        assert.deepEqual(readFileSync(join(dir, "usage.json")), saved);
      }
    );
    await check(
      "initial and repeated admission latency cannot extend or start a reservation",
      async () => {
        for (const delayedEntry of ["initial", "repeated"]) {
          const initialDir = directory();
          let initialStorageCalls = 0;
          const block = () => {
            const until = performance.now() + 100;
            while (performance.now() < until) {
              /* bounded private latency */
            }
          };
          const initialExpired = await runWithStorage(
            initialDir,
            request({ wallMs: 75 }),
            { serviceBusy: false },
            () => assert.fail("factory must not run"),
            () => {
              if (
                ++initialStorageCalls === (delayedEntry === "initial" ? 1 : 2)
              )
                block();
            }
          );
          assert.equal(
            initialExpired.reason,
            "reservation_expired_before_creation"
          );
          assert.equal(budgetStatus(initialDir).used.wallMs, 75);
          assert.equal(budgetStatus(initialDir).active.length, 1);
          assert.equal(initialStorageCalls, 2);
        }
        const dir = directory();
        let checks = 0;
        const expired = await runWithStorage(
          dir,
          request({ wallMs: 75 }),
          callbacks,
          () => assert.fail("factory must not run"),
          () => {
            if (++checks === 2) {
              const until = performance.now() + 100;
              while (performance.now() < until) {
                /* bounded private latency */
              }
            }
          }
        );
        assert.equal(expired.reason, "reservation_expired_before_creation");
        assert.equal(budgetStatus(dir).used.wallMs, 75);
        const local = createWindowsServiceReader();
        let serviceChecks = 0;
        const deferred = await runWithStorage(
          directory(),
          request(),
          { serviceBusy: local },
          () => assert.fail("factory must not run"),
          () => {
            if (++serviceChecks === 2) setWindowsServiceBusy(local, true);
          }
        );
        assert.equal(deferred.reason, "service_priority_before_creation");
        assert.equal(serviceChecks, 2);
      }
    );
    if (process.platform === "win32") {
      await check(
        "actual execution inherits its reserved write allowance and keeps incomplete budget charged",
        async () => {
          const dir = directory();
          const stop = new globalThis.AbortController();
          const result = await runWithStorage(
            dir,
            request({ wallMs: 60000 }),
            callbacks,
            // Private loop stop after the first observation, before the
            // thirty-second recovery window permits any workload to start.
            (owned, controls, reservation) =>
              executeOwnedWindowsJob(
                owned,
                {
                  ...controls,
                  signal: stop.signal,
                  onSample() {
                    stop.abort();
                  },
                },
                reservation
              ),
            () => {}
          );
          assert.equal(result.status, "unreconciled");
          assert.equal(
            result.execution.terminal.sample.writeTransferLimitBytes,
            32
          );
          assert.equal(result.execution.terminal.accountingComplete, false);
          assert.equal(budgetStatus(dir).active.length, 1);
          assert.equal(budgetStatus(dir).used.outputBytes, 32);
          assert.equal(existsSync(marker), false);
        }
      );
      await check(
        "actual helper is cancelled before attach returns and the reservation remains active",
        async () => {
          const dir = directory(),
            cancel = new globalThis.AbortController(),
            spawned = [],
            originalSpawn = childProcess.spawn;
          let attachWaiting = false,
            killedByCancellation = false;
          childProcess.spawn = (...args) => {
            const child = originalSpawn(...args);
            if (
              args[0] === "pwsh" &&
              args[1].some((arg) => String(arg).endsWith("windows-job.ps1"))
            )
              spawned.push(child);
            if (
              args[0] === "pwsh" &&
              args[1].some((arg) =>
                String(arg).endsWith("windows-process-meter.ps1")
              )
            ) {
              spawned.push(child);
              // Runs after the synchronous attach request, before any helper
              // response can resolve it. Only our immutable spawn is observed.
              globalThis.queueMicrotask(() => {
                attachWaiting = true;
                cancel.abort();
                killedByCancellation = spawned.every((owned) => owned.killed);
              });
            }
            return child;
          };
          syncBuiltinESMExports();
          const startedAt = Date.now();
          try {
            await assert.rejects(
              () =>
                runReservedWindowsJob(
                  dir,
                  request(),
                  { ...callbacks, signal: cancel.signal },
                  (owned) => createWindowsJob(owned)
                ),
              /reservation retained/
            );
            assert.equal(attachWaiting, true);
            assert.equal(killedByCancellation, true);
            assert.equal(spawned.length, 2);
            assert.ok(
              Date.now() - startedAt < 7000,
              "cancellation must settle before the 15-second attach timeout"
            );
            assert.equal(existsSync(marker), false);
            for (const child of spawned) {
              assert.equal(child.killed, true);
              assert.ok(child.exitCode !== null || child.signalCode !== null);
              assert.equal(alive(child.pid), false);
            }
            assert.equal(budgetStatus(dir).active.length, 1);
            assert.equal(budgetStatus(dir).used.wallMs, 10000);
          } finally {
            childProcess.spawn = originalSpawn;
            syncBuiltinESMExports();
          }
        }
      );
      await check(
        "actual suspended Windows job is cancelled by admission deadline and leaves its budget blocked",
        async () => {
          const dir = directory();
          let job;
          await assert.rejects(
            () =>
              runReservedWindowsJob(
                dir,
                request({ wallMs: 8000 }),
                callbacks,
                async (owned, controls) => {
                  job = await createWindowsJob(owned);
                  try {
                    return await runWindowsResourceLoop(
                      createWindowsResourceController(job, owned.threads),
                      controls
                    );
                  } catch (error) {
                    assert.equal(
                      owned.signal.aborted,
                      true,
                      "only the actual admission deadline is the expected failure"
                    );
                    throw error;
                  } finally {
                    await job.close();
                  }
                }
              ),
            /reservation retained/
          );
          assert.ok(
            job,
            "actual native job must have been initialized before cancellation"
          );
          assert.equal(existsSync(marker), false);
          await delay(50);
          for (const pid of [
            job.initial.rootPid,
            job.initial.guardian.pid,
            job.initial.meter.helper.pid,
          ])
            assert.equal(alive(pid), false);
          assert.equal(budgetStatus(dir).active.length, 1);
          assert.equal(budgetStatus(dir).used.wallMs, 8000);
        }
      );
    }
    return { completed, provesRuntimeAcceptance: false };
  } finally {
    assert.ok(relative(tmpdir(), root).startsWith("orica-budget-admission-"));
    rmSync(root, { recursive: true, force: true });
  }
}
