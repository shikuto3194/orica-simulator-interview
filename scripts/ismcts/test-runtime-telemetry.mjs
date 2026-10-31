import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { budgetStatus } from "./budget.mjs";
import {
  createRuntimeTelemetry,
  runObservedReservedJob,
  telemetryPersistenceMs,
} from "./runtime-telemetry.mjs";
import { hash } from "./shared.mjs";
import { createWindowsJob } from "./windows-job.mjs";
import { createWindowsResourceController } from "./windows-resource-controller.mjs";
import { runWindowsResourceLoop } from "./windows-resource-loop.mjs";
import { executeOwnedWindowsJob } from "./windows-budget-admission.mjs";

function observation() {
  const sample = {
    rootPid: 100,
    rootCreated: "1000",
    active: 1,
    exitCode: 259,
    resourceWatchdogEnabled: true,
    resourceWatchdogExpired: false,
    cpuMs: 100,
    writeTransferBytes: "1000",
    rssBytes: 1024,
    commitLimitBytes: 3 * 1024 ** 3,
    affinityMask: "1",
    priority: 0x4000,
    members: [{ pid: 100, created: "1000", rssBytes: 1024 }],
    guardian: {
      pid: 101,
      created: "1001",
      cpuMs: 50,
      writeTransferBytes: "200",
      rssBytes: 1024,
      affinityMask: "1",
      priority: 0x4000,
    },
    totalCpuMs: 150,
    totalRssBytes: 2048,
    meter: {
      target: {
        pid: 101,
        created: "1001",
        exited: "0",
        cpuMs: 50,
        writeTransferBytes: "210",
        signaled: false,
        exitCode: 259,
      },
      helper: {
        pid: 102,
        created: "1002",
        cpuMs: 20,
        writeTransferBytes: "100",
        rssBytes: 1024,
        affinityMask: "1",
        priority: 0x4000,
      },
    },
    observedTotalCpuMs: 170,
    observedTotalRssBytes: 3072,
    callerBaseline: {
      pid: 103,
      userMicros: 10,
      systemMicros: 20,
      rssBytes: 4096,
    },
    caller: { pid: 103, userMicros: 1010, systemMicros: 1020, rssBytes: 4096 },
    secret: "CANARY-command-environment-game-state",
  };
  return {
    status: "waiting",
    decision: { action: "wait", reason: "deferred_load" },
    host: { cpuPercent: 20, freeRamGiB: 5, atMs: 2000, secret: sample.secret },
    sample,
  };
}

function execution() {
  const sample = observation().sample;
  const terminalSample = {
    ...sample,
    active: 0,
    exitCode: 125,
    members: [],
    rssBytes: 0,
    cpuMs: 110,
    guardian: { ...sample.guardian, cpuMs: 55 },
    totalCpuMs: 165,
    totalRssBytes: 1024,
  };
  return {
    status: "stopped",
    reason: "cancelled",
    samples: 1,
    terminal: {
      jobExited: true,
      guardianExited: true,
      jobCpuComplete: true,
      guardianCpuComplete: true,
      accountingComplete: false,
      forced: true,
      sample: terminalSample,
      finalJobGuardianCpuMs: 166,
      guardianFinal: {
        ...sample.meter.target,
        cpuMs: 56,
        exited: "2001",
        signaled: true,
        exitCode: 0,
      },
      meterLastSample: {
        ...sample.meter.helper,
        cpuMs: 21,
        writeTransferBytes: "110",
      },
      meterFinal: {
        pid: 102,
        created: "1002",
        cpuMs: 22,
        signaled: true,
        exited: "2002",
        exitCode: 0,
        writeTransferBytes: "120",
      },
      meterExited: true,
      meterCpuComplete: true,
      finalOwnedCpuMs: 188,
      callerBaseline: sample.callerBaseline,
      callerFinal: { ...sample.caller, userMicros: 2010 },
      callerCpuMs: 3,
    },
  };
}

export async function testRuntimeTelemetry() {
  const root = mkdtempSync(join(tmpdir(), "orica-runtime-telemetry-"));
  let completed = 0,
    serial = 0;
  const check = async (name, fn) => {
    await fn();
    console.log(`runtime-telemetry ok ${++completed} - ${name}`);
  };
  const request = (extra = {}) => ({
    module: join(root, "idle.mjs"),
    cwd: root,
    threads: 1,
    args: [],
    wallMs: 60000,
    outputBytes: 16384,
    ...extra,
  });
  const dir = () => join(root, String(++serial));
  const calls = { serviceBusy: false };
  const allow = () => {};
  const fake = async (_, controls, reservation) => {
    assert.ok(Object.isFrozen(reservation));
    assert.equal(typeof reservation.id, "string");
    assert.equal(typeof reservation.owner, "string");
    assert.equal(reservation.outputBytes, 16384);
    controls.onSample(observation());
    return execution();
  };
  writeFileSync(request().module, "setInterval(()=>{},1000);\n");
  try {
    await check(
      "lifetime write I/O stays exact, monotonic and distinct from artifact claims",
      () => {
        const journal = createRuntimeTelemetry(1, 16384);
        journal.observe(observation());
        const rows = journal
          .seal(execution())
          .toString()
          .trim()
          .split("\n")
          .map(JSON.parse);
        assert.deepEqual(rows[1].writeIo, {
          jobBytes: "1000",
          guardianBytes: "210",
          helperBytes: "100",
          ownedBytes: "1310",
        });
        assert.equal(rows[2].writeIo.ownedBytes, "1330");
        assert.equal(rows[2].accountingComplete, false);
        const precise = createRuntimeTelemetry(1, 16384),
          item = observation();
        item.sample.writeTransferBytes = "18446744073709551615";
        item.sample.meter.target.writeTransferBytes = "9007199254740993";
        precise.observe(item);
        const measured = JSON.parse(
          precise.seal().toString().trim().split("\n")[1]
        );
        assert.equal(
          measured.writeIo.ownedBytes,
          (18446744073709551615n + 9007199254740993n + 100n).toString()
        );
        for (const bad of [
          undefined,
          null,
          0,
          -1,
          "",
          "01",
          "-1",
          "1.5",
          "18446744073709551616",
        ]) {
          const j = createRuntimeTelemetry(1, 16384),
            o = observation();
          o.sample.writeTransferBytes = bad;
          assert.throws(() => j.observe(o), /write I\/O/);
        }
        for (const select of [
          (x) => x.sample,
          (x) => x.sample.guardian,
          (x) => x.sample.meter.target,
          (x) => x.sample.meter.helper,
        ]) {
          const j = createRuntimeTelemetry(1, 16384),
            o = observation();
          let called = 0;
          Object.defineProperty(select(o), "writeTransferBytes", {
            get() {
              called++;
              return "0";
            },
          });
          assert.throws(() => j.observe(o), /write I\/O/);
          assert.equal(called, 0);
        }
        const reversedGuardian = observation(),
          monotonic = createRuntimeTelemetry(1, 16384);
        monotonic.observe(observation());
        reversedGuardian.sample.guardian.writeTransferBytes = "0";
        assert.throws(() => monotonic.observe(reversedGuardian), /write I\/O/);
        for (const mutate of [
          (x) => delete x.terminal.sample.writeTransferBytes,
          (x) => (x.terminal.sample.writeTransferBytes = "999"),
          (x) => (x.terminal.sample.guardian.writeTransferBytes = "0"),
          (x) => (x.terminal.guardianFinal.writeTransferBytes = "209"),
          (x) => (x.terminal.meterLastSample.writeTransferBytes = "99"),
          (x) => (x.terminal.meterFinal.writeTransferBytes = "109"),
        ]) {
          const j = createRuntimeTelemetry(1, 16384),
            e = execution();
          j.observe(observation());
          mutate(e);
          assert.throws(() => j.seal(e), /write I\/O/);
        }
      }
    );
    await check(
      "sampled child identities survive immutable allowlist projection without serialization hooks",
      () => {
        for (const inherited of [false, true]) {
          const journal = createRuntimeTelemetry(1, 16384),
            item = observation();
          let invoked = 0;
          const child = { pid: 104, created: "1004", rssBytes: 2048 };
          const hooks = {
            secret: "MEMBER-CANARY",
            toJSON() {
              invoked++;
              return { pid: 999, created: "9999", rssBytes: 0 };
            },
          };
          if (inherited) Object.setPrototypeOf(child, hooks);
          else Object.assign(child, hooks);
          item.sample.members.push(child);
          item.sample.active++;
          item.sample.rssBytes += child.rssBytes;
          item.sample.totalRssBytes += child.rssBytes;
          item.sample.observedTotalRssBytes += child.rssBytes;
          journal.observe(item);
          child.created = "9999";
          child.rssBytes = 0;
          item.sample.members.length = 0;
          const rows = journal
            .seal(execution())
            .toString()
            .trim()
            .split("\n")
            .map(JSON.parse);
          assert.equal(rows[0].schemaVersion, 3);
          assert.equal(rows[0].membershipCoverage, "sampled_job_members_only");
          assert.deepEqual(rows[1].owned.members, [
            { pid: 100, created: "1000", rssBytes: 1024 },
            { pid: 104, created: "1004", rssBytes: 2048 },
          ]);
          assert.deepEqual(rows[2].owned.members, []);
          assert.equal(invoked, 0);
          assert.equal(JSON.stringify(rows).includes("CANARY"), false);
          assert.equal(rows[2].accountingComplete, false);
        }
      }
    );
    await check(
      "member omissions, accessors, duplicate identities and inconsistent totals fail before persistence",
      () => {
        let invoked = 0;
        for (const mutate of [
          (s) => delete s.members,
          (s) => delete s.members[0],
          (s) => {
            s.members.length = 1025;
          },
          (s) => delete s.members[0].created,
          (s) => {
            s.members[0].rssBytes++;
          },
          (s) => {
            s.members[0].created = "2000";
          },
          (s) => {
            s.members.push({ ...s.members[0] });
            s.active++;
            s.rssBytes *= 2;
            s.totalRssBytes += 1024;
          },
          (s) =>
            Object.defineProperty(s, "members", {
              get() {
                invoked++;
                return [];
              },
            }),
          (s) =>
            Object.defineProperty(s.members, "0", {
              get() {
                invoked++;
                return {};
              },
            }),
          ...["pid", "created", "rssBytes"].map(
            (field) => (s) =>
              Object.defineProperty(s.members[0], field, {
                get() {
                  invoked++;
                  return 0;
                },
              })
          ),
        ]) {
          const journal = createRuntimeTelemetry(1, 16384),
            item = observation();
          mutate(item.sample);
          assert.throws(() => journal.observe(item));
        }
        // The same data-only requirement applies to a drained terminal sample;
        // an absent list must never be silently interpreted as zero members.
        for (const mutate of [
          (s) => delete s.members,
          (s) =>
            Object.defineProperty(s, "members", {
              get() {
                invoked++;
                return [];
              },
            }),
        ]) {
          const journal = createRuntimeTelemetry(1, 16384),
            result = execution();
          journal.observe(observation());
          mutate(result.terminal.sample);
          assert.throws(() => journal.seal(result));
        }
        assert.equal(invoked, 0);
      }
    );
    await check(
      "caller terminal projection is immutable and rejects missing, reversed or replaced baselines",
      () => {
        const journal = createRuntimeTelemetry(1, 16384),
          item = observation(),
          result = execution();
        journal.observe(item);
        let called = 0;
        result.terminal.callerFinal.secret = "CALLER-CANARY";
        result.terminal.callerFinal.toJSON = () => {
          called++;
          return { userMicros: 0 };
        };
        const bytes = journal.seal(result);
        result.terminal.callerFinal.userMicros = 999999;
        assert.equal(called, 0);
        assert.equal(bytes.includes("CALLER-CANARY"), false);
        const terminal = JSON.parse(bytes.toString().trim().split("\n").at(-1));
        assert.equal(terminal.callerFinal.userMicros, 2010);
        for (const mutate of [
          (x) => delete x.callerFinal,
          (x) => (x.callerFinal.userMicros = 9),
          (x) => (x.callerFinal.pid = 102),
          (x) => x.callerBaseline.userMicros++,
          (x) => x.callerCpuMs++,
          (x) =>
            Object.defineProperty(x.callerFinal, "userMicros", {
              get() {
                called++;
                return 2010;
              },
            }),
        ]) {
          const j = createRuntimeTelemetry(1, 16384),
            r = execution();
          j.observe(observation());
          mutate(r.terminal);
          assert.throws(() => j.seal(r));
        }
        assert.equal(called, 0);
      }
    );
    await check(
      "projected immutable samples exclude caller secrets and later mutation",
      () => {
        const journal = createRuntimeTelemetry(1, 16384),
          item = observation();
        journal.observe(item);
        item.sample.cpuMs = 999;
        item.host.cpuPercent = 99;
        const bytes = journal.seal(execution()),
          rows = bytes.toString().trim().split("\n").map(JSON.parse);
        assert.equal(rows[1].owned.jobCpuMs, 100);
        assert.equal(rows[1].host.cpuPercent, 20);
        assert.equal(bytes.includes("CANARY"), false);
        assert.equal(rows[2].accountingComplete, false);
        assert.equal(rows[2].finalJobGuardianCpuMs, 166);
        assert.equal(rows[2].finalOwnedCpuMs, 188);
        assert.equal(rows[2].meterCpuComplete, true);
        assert.equal(rows[1].callerCpuMs, 2);
        assert.equal(rows[1].observedCpuMs, 172);
        assert.equal(rows[1].observedRssGiB, 7168 / 1024 ** 3);
        assert.equal(rows[2].callerCpuMs, 3);
        assert.equal(rows[2].finalMeasuredCpuMs, 191);
        assert.throws(() => journal.observe(observation()), /lifecycle/);
        assert.throws(() => journal.seal(execution()), /sealed/);
      }
    );
    await check(
      "terminal helper projection excludes extra fields and serialization hooks and detaches saved bytes",
      () => {
        for (const inherited of [false, true]) {
          const journal = createRuntimeTelemetry(1, 16384),
            result = execution(),
            expected = { ...result.terminal.meterFinal };
          let called = 0;
          const hooks = {
            secret: "CANARY-terminal-helper",
            toJSON() {
              called++;
              return { ...expected, cpuMs: 999, secret: this.secret };
            },
          };
          if (inherited)
            Object.setPrototypeOf(result.terminal.meterFinal, hooks);
          else Object.assign(result.terminal.meterFinal, hooks);
          journal.observe(observation());
          const bytes = journal.seal(result),
            savedHash = hash(bytes);
          result.terminal.meterFinal.cpuMs = 777;
          result.terminal.meterFinal.created = "9999";
          const terminal = JSON.parse(
            bytes.toString().trim().split("\n").at(-1)
          );
          assert.equal(called, 0);
          assert.deepEqual(terminal.meterFinal, expected);
          assert.equal(bytes.includes("CANARY"), false);
          assert.equal(hash(bytes), savedHash);
          assert.equal(terminal.finalOwnedCpuMs, 188);
          assert.equal(terminal.accountingComplete, false);
        }
        for (const field of [
          "pid",
          "created",
          "exited",
          "cpuMs",
          "signaled",
          "exitCode",
          "writeTransferBytes",
        ]) {
          const journal = createRuntimeTelemetry(1, 16384),
            result = execution();
          let called = 0;
          Object.defineProperty(result.terminal.meterFinal, field, {
            get() {
              called++;
              throw new Error("CANARY-accessor");
            },
          });
          journal.observe(observation());
          assert.throws(() => journal.seal(result), /terminal helper data/);
          assert.equal(called, 0);
        }
      }
    );
    await check(
      "missing meter, forged terminal, CPU mismatch and promotion are rejected",
      () => {
        for (const mutate of [
          (x) => {
            delete x.terminal.guardianFinal;
          },
          (x) => {
            x.terminal.finalJobGuardianCpuMs++;
          },
          (x) => {
            x.terminal.accountingComplete = true;
          },
          (x) => {
            delete x.terminal.meterFinal;
          },
          (x) => {
            x.terminal.meterFinal.pid++;
          },
          (x) => {
            x.terminal.meterFinal.cpuMs = 20;
          },
          (x) => {
            x.terminal.meterFinal.signaled = false;
          },
          (x) => {
            x.terminal.meterFinal.exitCode = 1;
          },
          (x) => {
            x.terminal.meterCpuComplete = false;
          },
          (x) => {
            x.terminal.finalOwnedCpuMs++;
          },
          (x) => {
            x.terminal.sample.active = 1;
          },
          (x) => {
            x.samples = 0;
          },
        ]) {
          const journal = createRuntimeTelemetry(1, 16384),
            result = execution();
          journal.observe(observation());
          mutate(result);
          assert.throws(() => journal.seal(result));
        }
        const journal = createRuntimeTelemetry(1, 16384),
          item = observation();
        delete item.sample.meter;
        assert.throws(() => journal.observe(item), /retained guardian/);
      }
    );
    await check(
      "allowance limits accumulation and preserves space for a failure record",
      () => {
        assert.throws(() => createRuntimeTelemetry(1, 4096), /allowance/);
        const journal = createRuntimeTelemetry(1, 8192);
        assert.throws(() => {
          for (let i = 0; i < 20; i++) journal.observe(observation());
        }, /allowance/);
        const bytes = journal.seal(null);
        assert.ok(bytes.length <= 8192);
        assert.equal(
          JSON.parse(bytes.toString().trim().split("\n").at(-1)).kind,
          "failure"
        );
      }
    );
    await check(
      "runtime log is claimed and fsynced under the same active owner without refund",
      async () => {
        const directory = dir();
        const result = await runObservedReservedJob(
          directory,
          request(),
          calls,
          allow,
          fake
        );
        const bytes = readFileSync(result.execution.telemetry.path),
          active = budgetStatus(directory).active[0];
        assert.equal(result.status, "unreconciled");
        assert.equal(active.id, result.reservation.id);
        assert.equal(active.claimedOutputBytes, bytes.length);
        assert.equal(hash(bytes), result.execution.telemetry.sha256);
        assert.equal(budgetStatus(directory).used.outputBytes, 16384);
      }
    );
    await check(
      "caller observer is rejected before capacity, reservation or native generation",
      async () => {
        const directory = dir();
        let invoked = 0,
          generated = 0,
          scans = 0;
        await assert.rejects(
          () =>
            runObservedReservedJob(
              directory,
              request(),
              {
                ...calls,
                onSample: (x) => {
                  invoked++;
                  x.sample.secret = "NEW-CANARY";
                  x.sample.cpuMs = 999;
                },
              },
              () => {
                scans++;
              },
              async () => {
                generated++;
              }
            ),
          /invalid reserved/
        );
        assert.deepEqual(
          { invoked, generated, scans },
          { invoked: 0, generated: 0, scans: 0 }
        );
        assert.equal(existsSync(join(directory, "usage.json")), false);
      }
    );
    await check(
      "watchdog stop flows through controller and scheduler with explicitly unavailable CPU",
      async () => {
        const initial = observation().sample;
        initial.host = {
          pid: initial.guardian.pid,
          processorGroups: 1,
          startToken: "a".repeat(32),
          atMs: 1000,
          idleTicks: "100",
          kernelTicks: "200",
          userTicks: "100",
          freeRamBytes: 8 * 1024 ** 3,
          totalRamBytes: 16 * 1024 ** 3,
        };
        const terminal = execution().terminal;
        const expired = terminal.sample;
        expired.resourceWatchdogExpired = true;
        expired.host = { ...initial.host, atMs: 5000 };
        expired.meter = {
          target: { ...initial.meter.target, cpuMs: expired.guardian.cpuMs },
          helper: terminal.meterLastSample,
        };
        expired.observedTotalCpuMs =
          expired.totalCpuMs + expired.meter.helper.cpuMs;
        expired.observedTotalRssBytes =
          expired.totalRssBytes + expired.meter.helper.rssBytes;
        const directory = dir();
        const result = await runObservedReservedJob(
          directory,
          request(),
          calls,
          allow,
          async (_, controls) => {
            const controller = createWindowsResourceController(
              {
                initial,
                resourceWatchdog: true,
                sample: async () => expired,
                start: () => assert.fail("expired watchdog cannot start"),
                terminate: () => assert.fail("native watchdog already stopped"),
                finish: async () => terminal,
                close: () => {},
              },
              1
            );
            return runWindowsResourceLoop(controller, controls);
          }
        );
        const rows = readFileSync(result.execution.telemetry.path, "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse);
        assert.equal(rows[1].host.cpuPercent, null);
        assert.equal(rows[1].owned.watchdogExpired, true);
        assert.equal(rows[1].reason, "resource_watchdog_expired");
        assert.equal(rows[2].kind, "terminal");
        assert.equal(rows[2].reason, "resource_watchdog_expired");
        assert.equal(rows[2].accountingComplete, false);
        const invalid = observation();
        invalid.host.cpuPercent = null;
        assert.throws(
          () => createRuntimeTelemetry(1, 16384).observe(invalid),
          /observation/
        );
        invalid.sample.resourceWatchdogExpired = true;
        invalid.status = "stopped";
        invalid.decision = { action: "stop", reason: "service_priority" };
        assert.throws(
          () => createRuntimeTelemetry(1, 16384).observe(invalid),
          /observation/
        );
      }
    );
    await check(
      "write-limit stop is retained in sample/terminal telemetry and cannot be forged",
      () => {
        const sample = observation();
        sample.status = "stopped";
        sample.decision = { action: "stop", reason: "write_transfer_limit" };
        sample.host.cpuPercent = null;
        sample.sample.writeTransferLimitBytes = 999;
        sample.sample.writeTransferLimitExceeded = true;
        const journal = createRuntimeTelemetry(1, 16384);
        journal.observe(sample);
        const end = execution();
        end.reason = "write_transfer_limit";
        end.terminal.sample.writeTransferLimitBytes = 999;
        end.terminal.sample.writeTransferLimitExceeded = true;
        const rows = journal
          .seal(end)
          .toString()
          .trim()
          .split("\n")
          .map(JSON.parse);
        assert.equal(rows[1].reason, "write_transfer_limit");
        assert.equal(rows[1].owned.writeTransferLimitBytes, 999);
        assert.equal(rows[2].owned.writeTransferLimitExceeded, true);
        assert.equal(rows[2].accountingComplete, false);
        // The terminal envelope must not promote a native stop to success or
        // substitute a different reason, even if root exitCode itself is zero.
        for (const [status, reason] of [
          ["completed", "job_exit"],
          ["completed", "write_transfer_limit"],
          ["stopped", "cancelled"],
          ["stopped", "resource_watchdog_expired"],
        ]) {
          const negative = createRuntimeTelemetry(1, 16384);
          negative.observe(sample);
          const terminal = execution();
          Object.assign(terminal, { status, reason });
          Object.assign(terminal.terminal.sample, {
            exitCode: 0,
            writeTransferLimitBytes: 999,
            writeTransferLimitExceeded: true,
          });
          assert.throws(() => negative.seal(terminal), /native stop/);
        }
        const late = observation();
        Object.assign(late.sample, {
          writeTransferLimitBytes: 1000,
          writeTransferLimitExceeded: false,
        });
        for (const exceeded of [false, true]) {
          const terminalOnly = createRuntimeTelemetry(1, 16384);
          terminalOnly.observe(late);
          const terminal = execution();
          terminal.reason = "write_transfer_limit";
          Object.assign(terminal.terminal.sample, {
            writeTransferLimitBytes: 1000,
            writeTransferLimitExceeded: exceeded,
            writeTransferBytes: exceeded ? "1001" : "1000",
          });
          if (exceeded) {
            const saved = terminalOnly
              .seal(terminal)
              .toString()
              .trim()
              .split("\n")
              .map(JSON.parse);
            assert.equal(saved[2].reason, "write_transfer_limit");
          } else
            assert.throws(() => terminalOnly.seal(terminal), /native stop/);
        }
        sample.sample.writeTransferLimitExceeded = false;
        assert.throws(
          () => createRuntimeTelemetry(1, 16384).observe(sample),
          /observation/
        );
      }
    );
    await check(
      "internal telemetry preserves actual scheduler continuation and terminal reason",
      async () => {
        let inspected = 0,
          finished = 0;
        const result = await runObservedReservedJob(
          dir(),
          request(),
          calls,
          allow,
          async (_, controls) =>
            runWindowsResourceLoop(
              {
                resourceWatchdog: true,
                async start() {
                  const item = observation();
                  if (++inspected === 2) {
                    item.status = "stopped";
                    item.decision = { action: "stop", reason: "cpu_load" };
                  }
                  return item;
                },
                async finish() {
                  finished++;
                  return execution().terminal;
                },
                close: () => {},
              },
              controls
            )
        );
        const rows = readFileSync(result.execution.telemetry.path, "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse);
        assert.equal(inspected, 2);
        assert.equal(finished, 1);
        assert.equal(result.execution.samples, 2);
        assert.equal(rows[1].status, "waiting");
        assert.equal(rows[1].reason, "deferred_load");
        assert.equal(rows[1].owned.jobCpuMs, 100);
        assert.equal(rows[1].host.cpuPercent, 20);
        assert.equal(rows[3].reason, "cpu_load");
      }
    );
    await check(
      "admission monotonic deadline rejects persistence despite wall rollback before or during capacity scan",
      async () => {
        const originalNow = Date.now,
          descriptor = Object.getOwnPropertyDescriptor(performance, "now"),
          clock = originalNow();
        let mono = 0,
          wall = clock;
        try {
          Date.now = () => wall;
          Object.defineProperty(performance, "now", {
            configurable: true,
            value: () => mono,
          });
          for (const duringScan of [false, true]) {
            mono = 0;
            wall = clock;
            const directory = dir();
            let scans = 0;
            await assert.rejects(
              () =>
                runObservedReservedJob(
                  directory,
                  request(),
                  calls,
                  () => {
                    if (++scans === 3 && duringScan) {
                      mono = 61000;
                      wall = clock + 1000;
                    }
                  },
                  async () => {
                    if (!duringScan) {
                      mono = 61000;
                      wall = clock + 1000;
                    }
                    throw new Error("private expiry injection");
                  }
                ),
              /reservation retained/
            );
            const active = budgetStatus(directory).active[0];
            if (duringScan) assert.ok(active.claimedOutputBytes > 0);
            else assert.equal(active.claimedOutputBytes ?? 0, 0);
            assert.equal(scans, duringScan ? 3 : 2);
            assert.equal(existsSync(join(directory, "managed-output")), false);
          }
        } finally {
          Date.now = originalNow;
          if (descriptor) Object.defineProperty(performance, "now", descriptor);
          else delete performance.now;
        }
      }
    );
    await check(
      "failed runtime preserves partial evidence and fails with reservation retained",
      async () => {
        const directory = dir();
        let failure;
        try {
          await runObservedReservedJob(
            directory,
            request(),
            calls,
            allow,
            async (_, controls) => {
              controls.onSample(observation());
              throw new Error("CANARY-secret-runtime-error");
            }
          );
        } catch (error) {
          failure = error;
        }
        assert.match(failure.message, /reservation retained/);
        const log = readFileSync(failure.cause.telemetry.path, "utf8");
        assert.equal(log.includes("CANARY"), false);
        assert.equal(JSON.parse(log.trim().split("\n").at(-1)).kind, "failure");
        assert.equal(budgetStatus(directory).active.length, 1);
        for (const thrown of [null, false, "CANARY-thrown-string"]) {
          await assert.rejects(
            () =>
              runObservedReservedJob(
                dir(),
                request(),
                calls,
                allow,
                async () => {
                  throw thrown;
                }
              ),
            /reservation retained/
          );
        }
      }
    );
    await check(
      "write-time capacity refusal consumes claim and cannot yield a successful result",
      async () => {
        const directory = dir();
        let scans = 0;
        await assert.rejects(
          () =>
            runObservedReservedJob(
              directory,
              request(),
              calls,
              () => {
                if (++scans === 3) throw new Error("ARTIFACT_STORAGE_LIMIT");
              },
              fake
            ),
          /reservation retained/
        );
        assert.equal(scans, 3);
        assert.ok(budgetStatus(directory).active[0].claimedOutputBytes > 0);
        assert.equal(existsSync(join(directory, "managed-output")), false);
      }
    );
    await check(
      "insufficient time/output and missing runtime result never create acceptance",
      async () => {
        let created = 0;
        for (const extra of [
          { wallMs: telemetryPersistenceMs },
          { outputBytes: 4096 },
        ])
          await assert.rejects(() =>
            runObservedReservedJob(dir(), request(extra), calls, allow, () => {
              created++;
            })
          );
        assert.equal(created, 0);
        await assert.rejects(() =>
          runObservedReservedJob(
            dir(),
            request(),
            calls,
            allow,
            async () => undefined
          )
        );
      }
    );
    if (process.platform === "win32") {
      await check(
        "private actual OS cancellation saves partial evidence, fails and drains owned handles",
        async () => {
          const directory = dir(),
            cancel = new globalThis.AbortController();
          let failure;
          try {
            await runObservedReservedJob(
              directory,
              request({ wallMs: 90000, outputBytes: 65536 }),
              {
                ...calls,
                signal: cancel.signal,
              },
              allow,
              // Cancellation is a private native-factory injection. Public
              // admission accepts only service state and AbortSignal.
              (owned, controls, reservation) =>
                executeOwnedWindowsJob(
                  owned,
                  {
                    ...controls,
                    onSample(observation) {
                      controls.onSample(observation);
                      cancel.abort();
                    },
                  },
                  reservation
                )
            );
          } catch (error) {
            failure = error;
          }
          assert.match(failure.message, /reservation retained/);
          const rows = readFileSync(failure.cause.telemetry.path, "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
          assert.equal(rows.length, 3);
          assert.equal(rows[1].status, "waiting");
          assert.ok(
            rows[1].owned.members.some(
              (member) =>
                member.pid === rows[1].owned.rootPid &&
                member.created === rows[1].owned.rootCreated
            )
          );
          assert.equal(rows[2].kind, "failure");
          assert.equal(rows[2].accountingComplete, false);
          assert.equal(failure.callerCutoff.accountingComplete, false);
          assert.equal(failure.callerCutoff.sample.pid, process.pid);
          assert.ok(failure.callerCutoff.cpuMs >= rows[1].callerCpuMs);
          for (const pid of [
            rows[1].owned.rootPid,
            rows[1].owned.guardian.pid,
            rows[1].helper.pid,
          ])
            assert.throws(() => process.kill(pid, 0), /ESRCH/);
          assert.equal(budgetStatus(directory).active.length, 1);
        }
      );
      await check(
        "private native explicit stop records validated terminal totals under the same claim",
        async () => {
          const directory = dir();
          const storageCpuMs = [];
          let admissionBaseline, beforeNative;
          const measuredStorage = () => {
            const cpu = process.cpuUsage();
            const until = performance.now() + 80;
            while (performance.now() < until) {
              /* bounded work in both admission scans and persistence */
            }
            const used = process.cpuUsage(cpu);
            storageCpuMs.push((used.user + used.system) / 1000);
          };
          const result = await runObservedReservedJob(
            directory,
            request({ wallMs: 90000, outputBytes: 65536 }),
            calls,
            measuredStorage,
            async (owned, controls, reservation) => {
              admissionBaseline = { ...reservation.callerMeter.baseline };
              beforeNative = reservation.callerMeter.sample();
              const job = await createWindowsJob(owned);
              try {
                const controller = createWindowsResourceController(
                  job,
                  1,
                  reservation.callerMeter
                );
                const last = await controller.start(false);
                assert.equal(last.status, "waiting");
                controls.onSample(last);
                return {
                  status: "stopped",
                  reason: "cancelled",
                  samples: 1,
                  last,
                  terminal: await controller.finish(),
                };
              } finally {
                await job.close();
              }
            }
          );
          const rows = readFileSync(result.execution.telemetry.path, "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
          assert.equal(rows[2].kind, "terminal");
          assert.equal(rows[2].owned.active, 0);
          assert.deepEqual(rows[2].owned.members, []);
          assert.equal(rows[2].accountingComplete, false);
          assert.deepEqual(rows[2].callerBaseline, admissionBaseline);
          assert.equal(storageCpuMs.length, 3);
          assert.ok(storageCpuMs.every((cpuMs) => cpuMs > 0));
          assert.ok(rows[2].callerFinal.userMicros >= beforeNative.userMicros);
          assert.ok(
            rows[2].callerFinal.systemMicros >= beforeNative.systemMicros
          );
          assert.ok(rows[2].callerCpuMs >= storageCpuMs[0] + storageCpuMs[1]);
          const cutoff = result.callerCutoff;
          assert.deepEqual(cutoff.baseline, admissionBaseline);
          assert.equal(cutoff.accountingComplete, false);
          assert.ok(
            cutoff.cpuMs + 1e-9 >= rows[2].callerCpuMs + storageCpuMs[2]
          );
          assert.equal(
            rows[2].finalJobGuardianCpuMs,
            result.execution.terminal.finalJobGuardianCpuMs
          );
          assert.equal(
            budgetStatus(directory).active[0].claimedOutputBytes,
            result.execution.telemetry.byteLength
          );
          console.log(
            `I0_CALLER_ADMISSION_PERSISTENCE_FIXTURE ${JSON.stringify({
              storageCpuMs,
              terminalCallerCpuMs: rows[2].callerCpuMs,
              postPersistenceCallerCpuMs: cutoff.cpuMs,
              accountingComplete: false,
              activeReservations: budgetStatus(directory).active.length,
              provesRuntimeAcceptance: false,
              provesGameCalibration: false,
            })}`
          );
        }
      );
    }
    return {
      completed,
      provesRuntimeAcceptance: false,
      provesGameCalibration: false,
    };
  } finally {
    assert.ok(relative(tmpdir(), root).startsWith("orica-runtime-telemetry-"));
    rmSync(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await testRuntimeTelemetry();
  assert.equal(result.completed, process.platform === "win32" ? 19 : 17);
  console.log(`ISMCTS_TELEMETRY_TEST_RESULT ${JSON.stringify(result)}`);
}
