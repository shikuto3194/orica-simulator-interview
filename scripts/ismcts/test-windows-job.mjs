// Small idle private fixture processes, not exploration, learning or host smoke.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { setTimeout, clearTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import {
  createWindowsJob,
  guardianFrames,
  ownedJobFailureReason,
  windowsArgument,
  validateOwnedSample,
  windowsResourceSample,
  validateTerminalSample,
  validateMeterReply,
} from "./windows-job.mjs";
import { resourceMachine } from "./resources.mjs";
import {
  windowsHostMeasurement,
  createWindowsResourceController,
} from "./windows-resource-controller.mjs";
import { reserveBudget, finishBudget, budgetStatus } from "./budget.mjs";
import { runWindowsResourceLoop } from "./windows-resource-loop.mjs";
import { buildProcessMeter } from "./build-process-handle.mjs";
import { testProcessHandle } from "./test-process-handle.mjs";
import { loadProcessMeter } from "./windows-process-handle.mjs";

export async function testWindowsJob() {
  if (process.platform !== "win32")
    return { executed: false, reason: "windows_host_required" };
  buildProcessMeter();
  assert.equal((await testProcessHandle()).completed, 5);
  const fixture = mkdtempSync(join(tmpdir(), "orica-owned-job-"));
  const module = join(fixture, "idle child.mjs"),
    marker = join(fixture, "members.json");
  writeFileSync(
    module,
    `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const [mode, marker, ...args] = process.argv.slice(2);
if(mode === 'tree') { const child = spawn(process.execPath, [${JSON.stringify(module)}, 'leaf'], {windowsHide:true, stdio:'ignore'}); writeFileSync(marker, JSON.stringify({root:process.pid, child:child.pid, args, omp:process.env.OMP_NUM_THREADS})); }
if(mode === 'args') writeFileSync(marker, JSON.stringify(args));
if(mode === 'natural') { writeFileSync(marker, JSON.stringify({root:process.pid})); process.exit(Number(args[0])); }
if(mode === 'io-tree') { const child = spawn(process.execPath, ['--v8-pool-size=1', '-e', "const fs=require('node:fs'),file=process.argv[1];for(let i=0;i<3;i++){const fd=fs.openSync(file,'w');fs.writeSync(fd,Buffer.alloc(4096));fs.fsyncSync(fd);fs.closeSync(fd)}fs.unlinkSync(file)", marker], {windowsHide:true, stdio:'ignore'}); child.once('exit', code => process.exit(code ?? 1)); }
if(mode === 'io-hold') { const child = spawn(process.execPath, ['--v8-pool-size=1', '-e', "const fs=require('node:fs'),file=process.argv[1];for(let i=0;i<3;i++){const fd=fs.openSync(file,'w');fs.writeSync(fd,Buffer.alloc(4096));fs.fsyncSync(fd);fs.closeSync(fd)}fs.unlinkSync(file)", marker], {windowsHide:true, stdio:'ignore'}); child.once('exit', () => writeFileSync(marker+'.tail', Buffer.alloc(8192))); }
if(mode === 'parent-exit') { const child = spawn(process.execPath, [${JSON.stringify(module)}, 'leaf'], {windowsHide:true, detached:true, stdio:'ignore'}); child.once('spawn', () => { writeFileSync(marker, JSON.stringify({root:process.pid,child:child.pid})); process.exit(0); }); }
setInterval(()=>{}, 1000);`
  );
  const handles = [];
  let tests = 0;
  let passed = false;
  async function check(name, fn) {
    await fn();
    tests++;
    console.log(`windows-job ok ${tests} - ${name}`);
  }
  async function launch(options = {}) {
    const job = await createWindowsJob({
      module,
      cwd: fixture,
      wallMs: 30000,
      ...options,
    });
    handles.push(job);
    return job;
  }
  async function waitFor(fn, message) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (await fn()) return;
      await delay(50);
    }
    assert.fail(message);
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
    const helperScripts = ["windows-job.ps1", "windows-process-meter.ps1"];
    const helperSource = (name) =>
      readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
    const bootstrapFixture = () => {
      const directory = mkdtempSync(join(fixture, "bootstrap-"));
      for (const name of [
        ...helperScripts,
        "windows-affinity.ps1",
        "windows-control-lease.cs",
        "windows-bootstrap-lease.cs",
        "windows-job.cs",
        "windows-process-meter.cs",
      ])
        writeFileSync(join(directory, name), helperSource(name));
      return directory;
    };
    const expectBootstrapExit = async (script, input) => {
      const helper = spawn(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", script, "-Threads", "1"],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
      );
      let terminal;
      let output = "";
      const end = new Promise((done, reject) => {
        helper.once("error", reject);
        helper.once("close", (code, signal) => {
          terminal = { code, signal };
          done(terminal);
        });
      });
      helper.stdout.on("data", (bytes) => {
        output += bytes.toString("utf8");
        if (Buffer.byteLength(output) > 65536) helper.kill();
      });
      helper.stderr.on("data", () => {});
      helper.stdin.on("error", () => {});
      const started = performance.now();
      try {
        if (input) helper.stdin.write(JSON.stringify(input) + "\n");
        // Keep stdin open and issue no commands: the timer, not EOF/caller,
        // must end initialization. The tolerance includes PowerShell startup.
        const deadline = started + 24000;
        while (!terminal && performance.now() < deadline) await delay(50);
        assert.ok(terminal, "initialization survived independent timeout");
        assert.deepEqual(terminal, { code: 127, signal: null });
        assert.equal(output, "", "initialization produced a success reply");
      } finally {
        if (!terminal) helper.kill();
        await end;
      }
    };
    await check(
      "both helper bootstrap leases expire while waiting for initial stdin",
      async () => {
        const results = await Promise.allSettled(
          helperScripts.map((name) =>
            expectBootstrapExit(fileURLToPath(new URL(name, import.meta.url)))
          )
        );
        for (const result of results) {
          assert.equal(result.status, "fulfilled", result.reason?.stack);
        }
      }
    );
    await check(
      "bootstrap timer ends stalled native compilation in guardian and meter",
      async () => {
        const directory = bootstrapFixture();
        for (const name of helperScripts) {
          const anchor =
            name === "windows-job.ps1"
              ? "    Add-Type -Path (Join-Path $PSScriptRoot 'windows-control-lease.cs'),(Join-Path $PSScriptRoot 'windows-job.cs')"
              : "    Add-Type -Path (Join-Path $PSScriptRoot 'windows-control-lease.cs'),(Join-Path $PSScriptRoot 'windows-process-meter.cs')";
          const source = helperSource(name);
          assert.equal(source.split(anchor).length, 2);
          writeFileSync(
            join(directory, name),
            source.replace(
              anchor,
              "    [Threading.Thread]::Sleep(20000)\n" + anchor
            )
          );
        }
        const marker = join(directory, "root-ran.json");
        const launch = {
          op: "create",
          threads: 1,
          wallMs: 30000,
          resourceWatchdog: true,
          writeTransferLimitBytes: -1,
          executable: process.execPath,
          cwd: fixture,
          commandLine: [process.execPath, module, "tree", marker]
            .map(windowsArgument)
            .join(" "),
        };
        const results = await Promise.allSettled([
          expectBootstrapExit(join(directory, helperScripts[0]), launch),
          expectBootstrapExit(join(directory, helperScripts[1]), {
            op: "attach",
            threads: 1,
            pid: process.pid,
          }),
        ]);
        for (const result of results)
          assert.equal(result.status, "fulfilled", result.reason?.stack);
        assert.equal(existsSync(marker), false);
      }
    );
    await check(
      "bootstrap expiry closes atomic job when native constructor stalls after creation",
      async () => {
        const directory = bootstrapFixture();
        const pidFile = join(directory, "root-pid.json");
        const marker = join(directory, "root-ran.json");
        const anchor =
          "root = child.Process; thread = child.Thread; pid = child.Pid;";
        const source = helperSource("windows-job.cs");
        assert.equal(source.split(anchor).length, 2);
        writeFileSync(
          join(directory, "windows-job.cs"),
          source.replace(
            anchor,
            anchor +
              `\n            System.IO.File.WriteAllText(${JSON.stringify(pidFile)}, pid.ToString());\n            Thread.Sleep(20000);`
          )
        );
        await expectBootstrapExit(join(directory, "windows-job.ps1"), {
          op: "create",
          threads: 1,
          wallMs: 30000,
          resourceWatchdog: true,
          writeTransferLimitBytes: -1,
          executable: process.execPath,
          cwd: fixture,
          commandLine: [process.execPath, module, "tree", marker]
            .map(windowsArgument)
            .join(" "),
        });
        assert.ok(
          existsSync(pidFile),
          "constructor never reached owned creation"
        );
        const pid = Number(readFileSync(pidFile, "utf8"));
        assert.ok(Number.isInteger(pid) && pid > 0);
        await waitFor(
          () => !alive(pid),
          "suspended owned root survived helper exit"
        );
        assert.equal(existsSync(marker), false);
      }
    );
    await check(
      "bootstrap has no renewal API and can only complete while fresh once",
      async () => {
        const script = join(fixture, "bootstrap-contract.ps1");
        const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
Add-Type -Path ${psLiteral(fileURLToPath(new URL("windows-bootstrap-lease.cs", import.meta.url)))}
$lease=[OricaBootstrapLease]::new()
try {
  $noRenewal=$null -eq $lease.GetType().GetMethod('Touch')
  $lease.Complete()
  $repeatRejected=$false
  try { $lease.Complete() } catch { $repeatRejected=$true }
  $late=[OricaBootstrapLease]::new()
  try {
    # Disable only this private fixture timer to model delayed callback dispatch.
    $late.GetType().GetField('timer',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($late).Dispose()
    [Threading.Thread]::Sleep(15050)
    $lateRejected=$false
    try { $late.Complete() } catch { $lateRejected=$true }
    @{noRenewal=$noRenewal;repeatRejected=$repeatRejected;lateRejected=$lateRejected}|ConvertTo-Json -Compress
  } finally { $late.Dispose() }
} finally { $lease.Dispose() }
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 24000, maxBuffer: 65536 }
        );
        assert.deepEqual(JSON.parse(stdout.trim()), {
          noRenewal: true,
          repeatRejected: true,
          lateRejected: true,
        });
      }
    );
    for (const mode of ["running", "suspended"]) {
      await check(
        `abandoned ${mode} control closes root, guardian and meter before JS resumes`,
        async () => {
          const script = join(fixture, `stalled-${mode}.mjs`),
            ready = join(fixture, `stalled-${mode}.json`),
            returned = `${ready}.returned`,
            tree = `${ready}.tree`;
          writeFileSync(
            script,
            `import {createWindowsJob} from ${JSON.stringify(new URL("./windows-job.mjs", import.meta.url).href)};
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const job=await createWindowsJob({module:${JSON.stringify(module)},cwd:${JSON.stringify(fixture)},args:['tree',${JSON.stringify(tree)}],wallMs:30000,resourceWatchdog:true});
if (${JSON.stringify(mode)}==='running') {
  await job.start();
  while(!existsSync(${JSON.stringify(tree)})) await delay(10);
}
writeFileSync(${JSON.stringify(ready)},JSON.stringify({root:job.initial.rootPid,guardian:job.initial.guardian.pid,helper:job.initial.meter.helper.pid,child:existsSync(${JSON.stringify(tree)})?JSON.parse(readFileSync(${JSON.stringify(tree)})).child:null}));
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,18000);
writeFileSync(${JSON.stringify(returned)},'resumed');
await job.close();`
          );
          const caller = spawn(process.execPath, [script], {
            windowsHide: true,
            stdio: "ignore",
          });
          const exit = new Promise((done) => caller.once("close", done));
          try {
            await waitFor(() => existsSync(ready), "stalled caller not ready");
            const ids = JSON.parse(readFileSync(ready, "utf8"));
            const deadline = Date.now() + 13000;
            while (
              Object.values(ids).some((pid) => pid !== null && alive(pid)) &&
              Date.now() < deadline
            )
              await delay(50);
            assert.equal(existsSync(returned), false, "caller already resumed");
            assert.equal(alive(caller.pid), true);
            for (const pid of Object.values(ids))
              if (pid !== null) assert.equal(alive(pid), false);
            if (mode === "suspended") assert.equal(existsSync(tree), false);
          } finally {
            // Only the ChildProcess created by this fixture is terminated.
            caller.kill();
            await exit;
          }
        }
      );
    }
    await check(
      "resource watchdog kills the exact tree while its JS caller is stalled",
      async () => {
        const file = join(fixture, "resource-watchdog.json");
        const job = await launch({
          resourceWatchdog: true,
          args: ["tree", file],
        });
        await job.start();
        await waitFor(() => existsSync(file), "watchdog tree did not start");
        const pids = JSON.parse(readFileSync(file, "utf8"));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3500);
        await waitFor(
          () => !alive(pids.root) && !alive(pids.child),
          "watchdog did not stop tree independently"
        );
        const measured = await job.sample();
        assert.equal(measured.resourceWatchdogEnabled, true);
        assert.equal(measured.resourceWatchdogExpired, true);
        assert.equal(measured.active, 0);
        assert.equal(measured.exitCode, 126);
        const terminal = await job.finish();
        assert.equal(terminal.sample.exitCode, 126);
        assert.equal(terminal.accountingComplete, false);
      }
    );
    await check(
      "only fresh complete samples keep watchdog execution alive beyond its initial lease",
      async () => {
        const job = await launch({ resourceWatchdog: true });
        await job.start();
        for (let n = 0; n < 5; n++) {
          await delay(1000);
          const measured = await job.sample();
          assert.equal(measured.resourceWatchdogExpired, false);
          assert.ok(measured.active >= 1);
          assert.ok(
            measured.members.some((member) => member.pid === measured.rootPid)
          );
        }
        await job.terminate();
        let drained;
        await waitFor(async () => {
          drained = await job.sample();
          return drained.active === 0;
        }, "explicitly terminated job did not drain");
        assert.equal(drained.exitCode, 125);
        assert.equal(drained.resourceWatchdogExpired, false);
        const terminal = await job.finish();
        assert.equal(terminal.sample.active, 0);
        assert.equal(terminal.sample.exitCode, 125);
        assert.equal(terminal.sample.resourceWatchdogExpired, false);
        assert.equal(terminal.accountingComplete, false);
      }
    );
    await check(
      "watchdog stops a remaining child without rewriting the exited root code",
      async () => {
        const file = join(fixture, "watchdog-parent-exit.json");
        const job = await launch({
          resourceWatchdog: true,
          args: ["parent-exit", file],
        });
        const controller = createWindowsResourceController(job, 1);
        await job.start();
        await waitFor(() => existsSync(file), "watchdog root marker missing");
        const ids = JSON.parse(readFileSync(file, "utf8"));
        let prior;
        await waitFor(async () => {
          prior = await job.sample();
          return (
            prior.exitCode === 0 &&
            !prior.members.some((member) => member.pid === ids.root) &&
            prior.members.some((member) => member.pid === ids.child)
          );
        }, "watchdog root did not leave its live descendant");
        assert.equal(prior.resourceWatchdogExpired, false);
        assert.equal(alive(ids.child), true);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3500);
        await waitFor(() => !alive(ids.child), "watchdog child remained alive");
        const result = await controller.poll();
        assert.equal(result.status, "stopped");
        assert.equal(result.decision.reason, "resource_watchdog_expired");
        assert.equal(result.sample.resourceWatchdogExpired, true);
        assert.equal(result.sample.exitCode, 0);
        assert.equal(result.sample.active, 0);
        const terminal = await controller.finish();
        assert.equal(terminal.sample.exitCode, 0);
        assert.equal(terminal.sample.resourceWatchdogExpired, true);
        assert.deepEqual(terminal.sample.members, []);
        assert.ok(terminal.sample.cpuMs >= prior.cpuMs);
        assert.equal(terminal.accountingComplete, false);
      }
    );
    await check(
      "resource watchdog rejects replay and expires without acquiring the held native mutex",
      async () => {
        const script = join(fixture, "resource heartbeat lock.ps1");
        const literal = (value) => `'${value.replaceAll("'", "''")}'`;
        const native = fileURLToPath(
          new URL("./windows-job.cs", import.meta.url)
        );
        const cmd = [process.execPath, "-e", "setInterval(()=>{},1000)"]
          .map(windowsArgument)
          .join(" ");
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
Add-Type -Path ${literal(native)}
$owned=[OricaOwnedJob]::new(${literal(process.execPath)},${literal(cmd)},${literal(fixture)},1,30000,$true)
$sync=$owned.GetType().GetField('sync',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($owned)
try {
  $token=$owned.Measure().host.startToken; $owned.Start($token)
  $replay=$false; try { $owned.Heartbeat($token) } catch { $replay=$true }
  $fresh=$owned.Measure().host.startToken; $owned.Heartbeat($fresh)
  $repeated=$false; try { $owned.Heartbeat($fresh) } catch { $repeated=$true }
  [Threading.Monitor]::Enter($sync)
  try { [Threading.Thread]::Sleep(3600); $sample=$owned.Measure() }
  finally { [Threading.Monitor]::Exit($sync) }
  $late=$false; try { $owned.Heartbeat($sample.host.startToken) } catch { $late=$true }
  $terminal=$owned.Finish()
  @{replay=$replay;repeated=$repeated;late=$late;active=$terminal.sample.active;exitCode=$terminal.sample.exitCode;expired=$terminal.sample.resourceWatchdogExpired}|ConvertTo-Json -Compress
} finally { $owned.Dispose() }
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        assert.deepEqual(JSON.parse(stdout.trim()), {
          replay: true,
          repeated: true,
          late: true,
          active: 0,
          exitCode: 126,
          expired: true,
        });
      }
    );
    await check(
      "two-second scheduler samples the suspended real job and cancellation drains ownership",
      async () => {
        const file = join(fixture, "scheduler-suspended.json");
        const job = await launch({
          resourceWatchdog: true,
          args: ["args", file],
        });
        const controller = createWindowsResourceController(job, 1);
        const cancel = new globalThis.AbortController();
        const timer = setTimeout(() => cancel.abort(), 4600);
        const observed = [];
        let result;
        try {
          result = await runWindowsResourceLoop(controller, {
            serviceBusy: true,
            signal: cancel.signal,
            onSample: (x) => {
              observed.push(x);
            },
          });
        } finally {
          clearTimeout(timer);
        }
        assert.equal(result.reason, "cancelled");
        assert.equal(result.samples, 2);
        assert.ok(
          observed.every(
            (x) =>
              x.status === "waiting" && x.decision.reason === "service_priority"
          )
        );
        assert.ok(observed[1].host.atMs - observed[0].host.atMs >= 1900);
        assert.equal(existsSync(file), false);
        assert.equal(result.terminal.sample.active, 0);
        assert.equal(result.terminal.sample.resourceWatchdogExpired, false);
        assert.equal(result.terminal.accountingComplete, false);
        assert.equal(alive(job.initial.guardian.pid), false);
      }
    );
    await check(
      "guardian measures host CPU/RAM directly without spawning a host probe",
      async () => {
        const job = await launch();
        await delay(100);
        const sample = await job.sample();
        const host = windowsHostMeasurement(sample, job.initial);
        assert.equal(host.source, "windows-guardian-native");
        assert.ok(host.cpuPercent >= 0 && host.cpuPercent <= 100);
        assert.ok(
          host.totalRamGiB > 0 &&
            host.freeRamGiB >= 0 &&
            host.freeRamGiB <= host.totalRamGiB
        );
        assert.equal(sample.host.pid, sample.guardian.pid);
        assert.equal(sample.members.length, 1);
        await job.finish();
      }
    );
    await check(
      "final pre-start veto leaves the native root suspended until owned cleanup",
      async () => {
        const file = join(fixture, "pre-start-veto.json");
        const job = await launch({ args: ["args", file] });
        let called = 0;
        assert.equal(
          await job.start((sample) => {
            called++;
            assert.ok(sample.host);
            return false;
          }),
          false
        );
        assert.equal(called, 1);
        await delay(100);
        assert.equal(existsSync(file), false);
        const final = await job.finish();
        assert.equal(final.forced, true);
        assert.equal(final.accountingComplete, false);
        assert.equal(final.sample.active, 0);
      }
    );
    await check(
      "native start rejects a final sample delayed after acquisition before resume",
      async () => {
        const file = join(fixture, "delayed-start.json");
        const job = await launch({ args: ["args", file] });
        let guarded = false;
        await assert.rejects(() =>
          job.start((sample) => {
            assert.match(sample.host.startToken, /^[0-9a-f]{32}$/);
            guarded = true;
            // Private zero-CPU wait after the final sample. This models meter or
            // channel delay; it does not claim an actual production helper stall.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3500);
            return true;
          })
        );
        assert.equal(guarded, true);
        await job.close();
        await waitFor(
          () => !alive(job.initial.rootPid) && !alive(job.initial.guardian.pid),
          "stale start survived owned cleanup"
        );
        assert.equal(existsSync(file), false);
        assert.equal(alive(job.initial.rootPid), false);
        assert.equal(alive(job.initial.guardian.pid), false);
      }
    );
    await check(
      "native start rejects a superseded sample token even while the new one is fresh",
      async () => {
        const script = join(fixture, "replaced host sample.ps1");
        const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
        const native = fileURLToPath(
          new URL("./windows-job.cs", import.meta.url)
        );
        const cmd = [process.execPath, "-e", "setInterval(()=>{},1000)"]
          .map(windowsArgument)
          .join(" ");
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
Add-Type -Path ${psLiteral(native)}
$owned=[OricaOwnedJob]::new(${psLiteral(process.execPath)},${psLiteral(cmd)},${psLiteral(fixture)},1,30000)
try {
  $old=$owned.Measure(); $fresh=$owned.Measure(); $rejected=$false
  try { $owned.Start($old.host.startToken) } catch { $rejected=$true }
  if(-not $rejected -or $old.host.startToken -eq $fresh.host.startToken) {throw 'Superseded sample accepted'}
  $owned.Start($fresh.host.startToken)
  $end=$owned.Finish()
  @{rejected=$rejected;active=$end.sample.active;forced=$end.forced}|ConvertTo-Json -Compress
} finally { $owned.Dispose() }
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        assert.deepEqual(JSON.parse(stdout.trim()), {
          rejected: true,
          active: 0,
          forced: true,
        });
      }
    );
    await check(
      "native resource dispatch refuses a start without thirty seconds of observations",
      async () => {
        const file = join(fixture, "unready-resource.json");
        const job = await launch({ args: ["args", file] });
        const controller = createWindowsResourceController(job, 1);
        await delay(100);
        const result = await controller.start();
        assert.equal(result.status, "waiting");
        assert.equal(existsSync(file), false);
        assert.equal((await controller.finish()).accountingComplete, false);
      }
    );
    await check(
      "terminal snapshots reject partial membership, identity and CPU rollback",
      async () => {
        const job = await launch();
        const terminal = await job.finish();
        const valid = {
          sample: terminal.sample,
          rootExited: true,
          jobCpuComplete: true,
          forced: true,
        };
        validateTerminalSample(valid, 1, job.initial);
        for (const mutate of [
          (x) => {
            x.rootExited = false;
          },
          (x) => {
            delete x.jobCpuComplete;
          },
          (x) => {
            x.forced = "false";
          },
          (x) => {
            x.sample.active = 1;
          },
          (x) => {
            x.sample.rootCreated += "1";
          },
          (x) => {
            x.sample.guardian.cpuMs = 0;
            x.sample.totalCpuMs = x.sample.cpuMs;
          },
        ]) {
          const broken = JSON.parse(JSON.stringify(valid));
          mutate(broken);
          assert.throws(() => validateTerminalSample(broken, 1, job.initial));
        }
      }
    );
    await check(
      "natural exits including code 259 retain final job CPU but refuse budget refund",
      async () => {
        for (const exitCode of [0, 259]) {
          const file = join(fixture, `natural-${exitCode}.json`);
          const job = await launch({
            args: ["natural", file, String(exitCode)],
          });
          await job.start();
          await waitFor(
            async () => (await job.sample()).active === 0,
            "natural root survived"
          );
          const prior = await job.sample();
          const terminal = await job.finish();
          assert.equal(terminal.forced, false);
          assert.equal(terminal.sample.exitCode, exitCode);
          assert.equal(terminal.jobExited, true);
          assert.equal(terminal.guardianExited, true);
          assert.equal(terminal.jobCpuComplete, true);
          assert.equal(terminal.guardianCpuComplete, true);
          assert.equal(terminal.guardianFinal.pid, prior.guardian.pid);
          assert.equal(terminal.guardianFinal.created, prior.guardian.created);
          assert.equal(terminal.guardianFinal.signaled, true);
          assert.equal(terminal.guardianFinal.exitCode, 0);
          assert.ok(
            terminal.guardianFinal.cpuMs >= terminal.sample.guardian.cpuMs
          );
          assert.equal(
            terminal.finalJobGuardianCpuMs,
            terminal.sample.cpuMs + terminal.guardianFinal.cpuMs
          );
          assert.equal(terminal.accountingComplete, false);
          assert.equal(terminal.meterExited, true);
          assert.equal(terminal.meterCpuComplete, true);
          assert.equal(terminal.meterFinal.pid, prior.meter.helper.pid);
          assert.equal(terminal.meterFinal.created, prior.meter.helper.created);
          assert.equal(terminal.meterFinal.signaled, true);
          assert.equal(terminal.meterFinal.exitCode, 0);
          assert.ok(
            terminal.meterFinal.cpuMs >= terminal.meterLastSample.cpuMs
          );
          assert.equal(
            terminal.finalOwnedCpuMs,
            terminal.finalJobGuardianCpuMs + terminal.meterFinal.cpuMs
          );
          assert.ok(terminal.sample.cpuMs >= prior.cpuMs);
          assert.ok(terminal.sample.totalCpuMs >= prior.totalCpuMs);
          assert.equal(alive(job.initial.guardian.pid), false);
          await assert.rejects(() => job.start());
          await assert.rejects(() => job.sample());
          await assert.rejects(() => job.finish());
          const directory = join(fixture, `budget-${exitCode}`);
          const reservation = reserveBudget(directory, {
            wallMs: 30000,
            threads: 1,
            monitor: false,
            outputBytes: 0,
            owner: "terminal-fixture",
          });
          assert.equal(reservation.status, "reserved");
          assert.throws(
            () =>
              finishBudget(directory, reservation.id, reservation.owner, {
                status: "completed",
                treeExited: true,
                accountingComplete: terminal.accountingComplete,
                usage: {
                  wallMs: 0,
                  cpuMs: 0,
                  gpuMs: 0,
                  monitorMs: 0,
                  outputBytes: 0,
                },
              }),
            /reservation retained/
          );
          assert.equal(budgetStatus(directory).active.length, 1);
          assert.equal(budgetStatus(directory).used.wallMs, 30000);
        }
      }
    );
    await check(
      "root exit alone does not finish a live descendant",
      async () => {
        const file = join(fixture, "parent-exit.json");
        const job = await launch({ args: ["parent-exit", file] });
        await job.start();
        await waitFor(() => existsSync(file), "root exit marker missing");
        const ids = JSON.parse(readFileSync(file, "utf8"));
        let prior;
        await waitFor(async () => {
          prior = await job.sample();
          writeFileSync(
            join(fixture, "parent-exit-prior.json"),
            JSON.stringify(prior)
          );
          // ExitProcess publishes its exit code before the process object
          // becomes signaled. Do not force the job while root is a member.
          return (
            prior.exitCode === 0 &&
            !prior.members.some((member) => member.pid === ids.root) &&
            prior.members.some((member) => member.pid === ids.child)
          );
        }, "root did not leave the job with its descendant alive");
        assert.ok(prior.active > 0);
        assert.equal(alive(ids.child), true);
        const terminal = await job.finish();
        writeFileSync(
          join(fixture, "parent-exit-terminal.json"),
          JSON.stringify(terminal)
        );
        assert.equal(terminal.forced, true);
        assert.equal(terminal.sample.exitCode, 0);
        assert.equal(terminal.sample.active, 0);
        assert.deepEqual(terminal.sample.members, []);
        assert.ok(terminal.sample.cpuMs >= prior.cpuMs);
        assert.equal(alive(ids.child), false);
      }
    );
    await check(
      "suspended jobs finish without executing their first instruction",
      async () => {
        const file = join(fixture, "never-started.json");
        const job = await launch({ args: ["tree", file] });
        const terminal = await job.finish();
        assert.equal(terminal.forced, true);
        assert.equal(terminal.sample.exitCode, 125);
        assert.equal(existsSync(file), false);
        assert.equal(alive(job.initial.rootPid), false);
      }
    );
    await check(
      "deadline exit is preserved by terminal accounting",
      async () => {
        const job = await launch({ wallMs: 350 });
        await job.start();
        await waitFor(
          async () => (await job.sample()).active === 0,
          "terminal deadline failed"
        );
        const terminal = await job.finish();
        assert.equal(terminal.forced, false);
        assert.equal(terminal.sample.exitCode, 124);
        assert.equal(terminal.accountingComplete, false);
      }
    );
    await check("guardian crash cannot supply a terminal receipt", async () => {
      const job = await launch();
      job.abortGuardian();
      await assert.rejects(() => job.finish());
      await waitFor(
        () => !alive(job.initial.rootPid),
        "failed terminal left suspended root"
      );
      await job.close();
    });
    await check(
      "meter crash kills the owned job and cannot supply terminal accounting",
      async () => {
        const file = join(fixture, "meter-crash.json");
        const job = await launch({ args: ["tree", file] });
        await job.start();
        await waitFor(() => existsSync(file), "meter crash tree missing");
        const ids = JSON.parse(readFileSync(file, "utf8"));
        const meterPid = job.initial.meter.helper.pid;
        job.abortMeter();
        await assert.rejects(() => job.finish());
        await waitFor(
          () => !alive(ids.root) && !alive(ids.child),
          "meter failure left owned tree"
        );
        await job.close();
        assert.equal(alive(meterPid), false);
      }
    );
    await check(
      "retained process snapshots reject identity, terminal state and CPU tampering",
      async () => {
        const job = await launch();
        const before = await job.sample();
        const terminal = await job.finish();
        const reply = {
          target: terminal.guardianFinal,
          helper: terminal.meterLastSample,
        };
        validateMeterReply(reply, before.guardian, before.meter, true);
        for (const mutate of [
          (s) => {
            s.target.pid++;
          },
          (s) => {
            s.target.created += "1";
          },
          (s) => {
            s.target.signaled = false;
            s.target.exited = "0";
          },
          (s) => {
            s.target.exitCode = 259;
          },
          (s) => {
            s.target.cpuMs = 0;
          },
          (s) => {
            s.target.cpuMs = NaN;
          },
          (s) => {
            s.target.exited = s.target.created.slice(0, -1);
          },
          (s) => {
            s.helper.pid = s.target.pid;
          },
          (s) => {
            s.helper.created += "1";
          },
          (s) => {
            s.helper.cpuMs = 0;
          },
          (s) => {
            s.helper.affinityMask = "18446744073709551616";
          },
          (s) => {
            s.helper.priority = 0x20;
          },
          (s) => {
            s.helper.rssBytes = -1;
          },
        ]) {
          const broken = JSON.parse(JSON.stringify(reply));
          mutate(broken);
          assert.throws(() =>
            validateMeterReply(broken, before.guardian, before.meter, true)
          );
        }
        for (const mutate of [
          (s) => {
            s.observedTotalCpuMs = s.totalCpuMs;
          },
          (s) => {
            s.observedTotalRssBytes = s.totalRssBytes;
          },
          (s) => {
            s.meter.helper.affinityMask = "3";
          },
          (s) => {
            s.meter.target.created += "1";
          },
          (s) => {
            delete s.meter;
          },
          (s) => {
            s.meter = null;
          },
          (s) => {
            s.meter.target.signaled = true;
            s.meter.target.exited = s.meter.target.created;
          },
          (s) => {
            s.meter.helper.pid = s.rootPid;
          },
          (s) => {
            s.meter.target.cpuMs = s.meter.helper.cpuMs = Number.MAX_VALUE;
            s.observedTotalCpuMs = Infinity;
          },
          (s) => {
            s.meter.helper.rssBytes = Number.MAX_SAFE_INTEGER;
            s.observedTotalRssBytes = s.totalRssBytes + s.meter.helper.rssBytes;
          },
        ]) {
          const broken = JSON.parse(JSON.stringify(before));
          mutate(broken);
          assert.throws(() =>
            windowsResourceSample({ cpuPercent: 20, freeRamGiB: 7 }, broken, 1)
          );
        }
      }
    );
    await check(
      "native meter retains the same process handle through a real code-259 exit",
      async () => {
        const code = join(fixture, "meter exit.mjs");
        writeFileSync(
          code,
          "process.stdin.once('data',()=>{const end=Date.now()+80;while(Date.now()<end){} process.exit(259);});"
        );
        const script = join(fixture, "retained meter.ps1");
        const psLiteral = (x) => `'${x.replaceAll("'", "''")}'`;
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
Add-Type -Path ${psLiteral(fileURLToPath(new URL("./windows-control-lease.cs", import.meta.url)))},${psLiteral(fileURLToPath(new URL("./windows-process-meter.cs", import.meta.url)))}
$start=[System.Diagnostics.ProcessStartInfo]::new(${psLiteral(process.execPath)})
$start.ArgumentList.Add(${psLiteral(code)}); $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardInput=$true
$child=[System.Diagnostics.Process]::Start($start); $meter=$null
try {
  $meter=[OricaProcessMeter]::new([uint32]$child.Id); $first=$meter.Measure($false)
  if($first.signaled) {throw 'Target exited before attachment'}
  $child.StandardInput.WriteLine('exit'); $child.WaitForExit(); $child.Dispose()
  $last=$meter.Measure($true); $again=$meter.Measure($true)
  if(-not $last.signaled -or $last.exitCode -ne 259 -or $last.created -ne $first.created -or $last.cpuMs -le $first.cpuMs -or $again.cpuMs -ne $last.cpuMs) {throw 'Retained final accounting mismatch'}
  @{initial=$first;terminal=$last;sameHandleRepeat=$again}|ConvertTo-Json -Depth 4 -Compress
} finally {if($null -ne $meter) {$meter.Dispose()}; try {if(-not $child.HasExited) {$child.Kill();$child.WaitForExit()}} catch {}; $child.Dispose()}
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        const result = JSON.parse(stdout.trim());
        assert.equal(result.terminal.exitCode, 259);
        assert.ok(result.terminal.cpuMs > result.initial.cpuMs);
      }
    );
    await check(
      "argument quoting and invalid limits fail before launch",
      async () => {
        assert.equal(windowsArgument('a"b\\'), '"a\\"b\\\\"');
        assert.throws(() => windowsArgument("x\ny"));
        for (const options of [
          { threads: 3 },
          { wallMs: 1200001 },
          { module: "relative.mjs" },
          { args: [1] },
        ])
          await assert.rejects(() => launch(options));
      }
    );
    await check(
      "sample and resource adapter enforce native PID, Int64 identity and UInt64 affinity bounds",
      async () => {
        // Simulated native-contract inputs, not measured OS identities/load.
        const sample = {
          rootPid: 0xffffffff,
          resourceWatchdogEnabled: false,
          resourceWatchdogExpired: false,
          rootCreated: "9223372036854775807",
          active: 2,
          exitCode: 0xffffffff,
          cpuMs: 1,
          rssBytes: 2,
          affinityMask: "1",
          priority: 0x4000,
          commitLimitBytes: 3 * 1024 ** 3,
          members: [
            { pid: 0xffffffff, created: "9223372036854775807", rssBytes: 1 },
            { pid: 0xfffffffd, created: "1", rssBytes: 1 },
          ],
          guardian: {
            pid: 0xfffffffe,
            created: "9223372036854775807",
            cpuMs: 1,
            rssBytes: 1,
            affinityMask: "1",
            priority: 0x4000,
          },
          totalCpuMs: 2,
          totalRssBytes: 3,
          meter: {
            target: {
              pid: 0xfffffffe,
              created: "9223372036854775807",
              exited: "0",
              cpuMs: 1,
              signaled: false,
              exitCode: 259,
            },
            helper: {
              pid: 1,
              created: "1",
              cpuMs: 1,
              rssBytes: 1,
              affinityMask: "1",
              priority: 0x4000,
            },
          },
          observedTotalCpuMs: 3,
          observedTotalRssBytes: 4,
        };
        const clone = () => JSON.parse(JSON.stringify(sample));
        const host = { cpuPercent: 20, freeRamGiB: 7 };
        for (const [mask, threads] of [
          ["1", 1],
          ["9223372036854775808", 1],
          ["9223372036854775809", 2],
          ["13835058055282163712", 2],
        ]) {
          const valid = clone();
          valid.affinityMask = valid.guardian.affinityMask = mask;
          valid.meter.helper.affinityMask = mask;
          assert.equal(validateOwnedSample(valid, threads), valid);
          assert.equal(
            windowsResourceSample(host, valid, threads).ownedCpuMs,
            3
          );
        }
        for (const [mutate, threads = 1] of [
          [
            (s) => {
              s.rootPid = s.members[0].pid = 0x100000000;
            },
          ],
          [
            (s) => {
              s.guardian.pid = 0x100000000;
            },
          ],
          [
            (s) => {
              s.members[1].pid = 0x100000000;
            },
          ],
          [
            (s) => {
              s.rootCreated = s.members[0].created = "9223372036854775808";
            },
          ],
          [
            (s) => {
              s.guardian.created = "9223372036854775808";
            },
          ],
          [
            (s) => {
              s.members[1].created = "18446744073709551616";
            },
          ],
          [
            (s) => {
              s.affinityMask = s.guardian.affinityMask = "18446744073709551616";
            },
          ],
          [
            (s) => {
              s.affinityMask = s.guardian.affinityMask = "18446744073709551617";
            },
            2,
          ],
          [
            (s) => {
              s.affinityMask = s.guardian.affinityMask = "0";
            },
          ],
          [
            (s) => {
              s.guardian.created = "0";
            },
          ],
          [
            (s) => {
              s.members[1].created = "01";
            },
          ],
          [
            (s) => {
              s.rootPid = s.members[0].pid = 0;
            },
          ],
        ]) {
          const broken = clone();
          mutate(broken);
          // No previous sample: failures must come from native bounds, not
          // the unrelated stable-identity/monotonic checks.
          assert.throws(() => validateOwnedSample(broken, threads));
          assert.throws(() => windowsResourceSample(host, broken, threads));
        }
      }
    );
    await check(
      "production affinity helper preserves all 64 IntPtr bits and rejects insufficient slots",
      async () => {
        const script = join(fixture, "affinity masks.ps1");
        const guardianScript = fileURLToPath(
          new URL("./windows-affinity.ps1", import.meta.url)
        );
        const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile(${psLiteral(guardianScript)},[ref]$tokens,[ref]$errors)
$helper=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-OricaSharedAffinity'},$true))
if($errors.Count -ne 0 -or $helper.Count -ne 1) {throw 'Missing/invalid production affinity helper'}
# Execute the exact production function without running the guardian's stdin loop.
. ([scriptblock]::Create($helper[0].Extent.Text))
$cases=@(
  @{mask=[long]-1;threads=1;expected=[long]1},
  @{mask=[long]-1;threads=2;expected=[long]3},
  @{mask=[long]::MinValue;threads=1;expected=[long]::MinValue},
  @{mask=([long]::MinValue+1);threads=2;expected=([long]::MinValue+1)},
  @{mask=[long]14;threads=2;expected=[long]6},
  @{mask=[long]::MaxValue;threads=2;expected=[long]3}
)
foreach($case in $cases) {
  $actual=Get-OricaSharedAffinity -Allowed ([IntPtr]::new($case.mask)) -Threads $case.threads
  if($actual.ToInt64() -ne $case.expected) {throw 'Affinity bit pattern changed'}
}
$invalid=@(@{mask=[long]::MinValue;threads=2},@{mask=[long]0;threads=1},@{mask=[long]1;threads=0},@{mask=[long]7;threads=3})
foreach($case in $invalid) {
  $rejected=$false
  try {$null=Get-OricaSharedAffinity -Allowed ([IntPtr]::new($case.mask)) -Threads $case.threads} catch {$rejected=$true}
  if(-not $rejected) {throw 'Invalid affinity slots accepted'}
}
@{completed=($cases.Count+$invalid.Count);usesProductionHelper=$true;simulatedMasks=$true}|ConvertTo-Json -Compress
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        const result = JSON.parse(stdout.trim());
        assert.equal(result.completed, 10);
        assert.equal(result.usesProductionHelper, true);
        assert.equal(result.simulatedMasks, true);
      }
    );
    await check(
      "control framing bounds each response before its newline",
      async () => {
        const received = [];
        let overflows = 0;
        const receive = guardianFrames(
          (line) => received.push(line),
          () => overflows++
        );
        const replies = Buffer.from("日本語\n".repeat(600));
        // Include split UTF-8 characters, split frames and multiple frames per
        // chunk without conflating the lifetime total with one frame's limit.
        for (let i = 0; i < replies.length; i += 7)
          receive(replies.subarray(i, i + 7));
        assert.deepEqual(received, Array(600).fill("日本語"));
        receive(Buffer.alloc(65536, 65));
        receive(Buffer.from("\n"));
        assert.equal(received.at(-1).length, 65536);
        assert.equal(overflows, 0);
        receive(Buffer.alloc(32768, 65));
        receive(Buffer.alloc(32769, 65));
        assert.equal(overflows, 1);
        const count = received.length;
        receive(Buffer.from("\n"));
        assert.equal(received.length, count);
      }
    );
    await check(
      "membership retries discard incomplete samples and preserve terminal failures",
      async () => {
        for (const reason of [
          "membership_incomplete",
          "membership_count_changed",
          "membership_set_changed",
          "membership_accounting_changed",
        ])
          assert.equal(ownedJobFailureReason({ reason }), reason);
        assert.equal(
          ownedJobFailureReason({ reason: "secret command or environment" }),
          "owned_job_operation_failed"
        );
        const native = fileURLToPath(
          new URL("./windows-job.cs", import.meta.url)
        );
        const script = join(fixture, "membership retries.ps1");
        const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
        // Compile test-only reflection with the production type. Exercise the
        // exact helper used inside Measure without exposing an injection API.
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
$native=Get-Content -LiteralPath ${psLiteral(native)} -Raw
$regression=@'
public static class MembershipRetryRegression {
  static System.Reflection.MethodInfo stable = typeof(OricaOwnedJob).GetMethod("MeasureStable", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
  static System.Type changed = typeof(OricaOwnedJob).GetNestedType("MembershipChangedException", System.Reflection.BindingFlags.NonPublic);
  static System.Exception Change(ulong rss) {
    return (System.Exception)System.Activator.CreateInstance(changed, new object[] { "membership_count_changed", rss });
  }
  static object Invoke(System.Func<OricaOwnedJob.Sample> attempt) { return stable.Invoke(null, new object[] { attempt }); }
  static System.Exception MemberSetError(uint[] before, uint[] after, uint? assigned=null) {
    var validate=typeof(OricaOwnedJob).GetMethod("ValidateMemberSnapshot", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
    try { validate.Invoke(null,new object[] { assigned ?? (uint)after.Length, after, before == null ? null : new System.Collections.Generic.HashSet<uint>(before), 1UL }); }
    catch (System.Reflection.TargetInvocationException error) { return error.InnerException; }
    throw new System.Exception("Invalid membership accepted");
  }
  static int Refuse(System.Exception error, int expected) {
    int calls=0;
    try { Invoke(() => { calls++; throw error; }); throw new System.Exception("Unexpected successful sample"); }
    catch (System.Reflection.TargetInvocationException result) {
      if (!object.ReferenceEquals(result.InnerException,error) || calls != expected) throw;
    }
    return calls;
  }
  public static object Run() {
    int calls=0, cleanups=0;
    var complete = new OricaOwnedJob.Sample { active=1, rssBytes=123, members=new[] { new OricaOwnedJob.Member { pid=42, rssBytes=123 } } };
    var actual=Invoke(() => {
      try { calls++; if(calls < 3) throw Change(1); return complete; }
      finally { cleanups++; }
    });
    if(!object.ReferenceEquals(actual,complete) || calls != 3 || cleanups != 3) throw new System.Exception("Partial or stale sample returned");
    return new {
      recoveredAttempts=calls, cleanups=cleanups,
      unstableAttempts=Refuse(Change(1),3),
      hardAttempts=Refuse(Change(3UL*1024*1024*1024),1),
      duplicateAttempts=Refuse(MemberSetError(new uint[] {1,2},new uint[] {1,1}),1),
      duplicateAfterNewPidAttempts=Refuse(MemberSetError(new uint[] {1,2,3},new uint[] {4,1,1}),1),
      duplicateChangedCountAttempts=Refuse(MemberSetError(new uint[] {1,2,3},new uint[] {1,1}),1),
      duplicateIncompleteInitialAttempts=Refuse(MemberSetError(null,new uint[] {1,1},3),1),
      invalidCountAttempts=Refuse(MemberSetError(null,new uint[] {1,2},1),1),
      overflowAttempts=Refuse(MemberSetError(null,new uint[] {1},1025),1),
      changedSetAttempts=Refuse(MemberSetError(new uint[] {1,2},new uint[] {1,3}),3),
      changedCountAttempts=Refuse(MemberSetError(new uint[] {1,2,3},new uint[] {1,2}),3),
      otherAttempts=Refuse(new System.InvalidOperationException("foreign identity or overflow"),1),
      nativeAttempts=Refuse(new System.ComponentModel.Win32Exception(5),1)
    };
  }
}
'@
Add-Type -TypeDefinition ($native + [Environment]::NewLine + $regression)
[MembershipRetryRegression]::Run() | ConvertTo-Json -Compress
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        assert.deepEqual(JSON.parse(stdout.trim()), {
          recoveredAttempts: 3,
          cleanups: 3,
          unstableAttempts: 3,
          hardAttempts: 1,
          duplicateAttempts: 1,
          duplicateAfterNewPidAttempts: 1,
          duplicateChangedCountAttempts: 1,
          duplicateIncompleteInitialAttempts: 1,
          invalidCountAttempts: 1,
          overflowAttempts: 1,
          changedSetAttempts: 3,
          changedCountAttempts: 3,
          otherAttempts: 1,
          nativeAttempts: 1,
        });
      }
    );
    await check(
      "600 normal native samples do not consume a lifetime output quota",
      async () => {
        const job = await launch({ wallMs: 1200000 });
        await job.start();
        const begin = Date.now();
        let bytes = 0;
        for (let i = 0; i < 600; i++) {
          const sample = await job.sample();
          assert.ok(sample.active >= 1);
          assert.equal(sample.exitCode, 259);
          bytes += Buffer.byteLength(JSON.stringify({ op: "sample", sample }));
        }
        assert.ok(bytes > 65536);
        assert.equal(alive(job.initial.rootPid), true);
        console.log(
          `WINDOWS_JOB_POLL_RESULT ${JSON.stringify({ samples: 600, responseBytes: bytes, elapsedMs: Date.now() - begin, acceptedWallMs: 1200000, provesTwentyMinuteElapsedRun: false })}`
        );
        await job.close();
      }
    );
    await check(
      "guardian and job share slots and retain aggregate accounting after child exit",
      async () => {
        const job = await launch({ threads: 2 });
        const initial = job.initial;
        assert.equal(initial.guardian.affinityMask, initial.affinityMask);
        assert.equal(initial.guardian.priority, 0x4000);
        assert.ok(initial.guardian.cpuMs > 0 && initial.guardian.rssBytes > 0);
        assert.equal(
          initial.totalRssBytes,
          initial.rssBytes + initial.guardian.rssBytes
        );
        assert.equal(
          initial.totalCpuMs,
          initial.cpuMs + initial.guardian.cpuMs
        );
        await job.start();
        const active = await job.sample();
        await job.terminate();
        await waitFor(
          async () => (await job.sample()).active === 0,
          "aggregate fixture survived"
        );
        const ended = await job.sample();
        assert.equal(ended.rssBytes, 0);
        assert.equal(ended.totalRssBytes, ended.guardian.rssBytes);
        assert.ok(ended.totalCpuMs >= active.totalCpuMs);
        // Actual native snapshot, altered only in memory to test the adapter.
        // These mutations do not represent measured host load or job usage.
        for (const mutate of [
          (s) => delete s.guardian,
          (s) => {
            s.guardian.cpuMs = NaN;
          },
          (s) => {
            s.guardian.rssBytes = -1;
          },
          (s) => {
            s.totalRssBytes = s.rssBytes;
          },
          (s) => {
            s.totalCpuMs = s.cpuMs;
          },
          (s) => {
            s.guardian.affinityMask = "255";
          },
          (s) => {
            s.guardian.priority = 0x20;
          },
          (s) => {
            s.guardian.created += "1";
          },
          (s) => {
            s.guardian.pid = s.rootPid;
          },
          (s) => {
            s.guardian.cpuMs = 0;
            s.totalCpuMs = s.cpuMs;
          },
        ]) {
          const broken = JSON.parse(JSON.stringify(active));
          mutate(broken);
          assert.throws(() => validateOwnedSample(broken, 2, initial));
        }
        const host = { cpuPercent: 20, freeRamGiB: 7 };
        for (const [gib, action] of [
          [2, "stop"],
          [3, "terminate"],
        ]) {
          const threshold = JSON.parse(JSON.stringify(active));
          threshold.guardian.rssBytes = gib * 1024 ** 3 - threshold.rssBytes;
          threshold.totalRssBytes = gib * 1024 ** 3;
          threshold.observedTotalRssBytes =
            threshold.totalRssBytes + threshold.meter.helper.rssBytes;
          const policy = resourceMachine({ running: true }).update(
            windowsResourceSample(host, threshold, 2),
            Date.now()
          );
          assert.equal(policy.action, action);
          assert.equal(policy.reason, gib === 2 ? "ram_soft" : "ram_hard");
        }
        await job.close();
      }
    );
    await check(
      "aggregate RSS threshold terminates the exact native job without allocating stress memory",
      async () => {
        const script = join(fixture, "aggregate hard RSS.ps1");
        const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
        const native = fileURLToPath(
          new URL("./windows-job.cs", import.meta.url)
        );
        const cmd = [process.execPath, "-e", "setInterval(()=>{},1000)"]
          .map(windowsArgument)
          .join(" ");
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
Add-Type -Path ${psLiteral(native)}
$owned=[OricaOwnedJob]::new(${psLiteral(process.execPath)},${psLiteral(cmd)},${psLiteral(fixture)},1,30000)
try {
  $owned.Start($owned.Measure().host.startToken)
  $guard=$owned.GetType().GetMethod('EnforceRss',[Reflection.BindingFlags]'Instance,NonPublic')
  $guard.Invoke($owned,@([uint64](3GB-1)))
  $before=$owned.Measure()
  $guard.Invoke($owned,@([uint64]3GB))
  for($i=0;$i -lt 100;$i++) { $after=$owned.Measure(); if($after.active -eq 0) {break}; [Threading.Thread]::Sleep(20) }
  @{beforeActive=$before.active;afterActive=$after.active;exitCode=$after.exitCode;simulatedThreshold=$true}|ConvertTo-Json -Compress
} finally { $owned.Dispose() }
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        const result = JSON.parse(stdout.trim());
        assert.ok(result.beforeActive >= 1);
        assert.equal(result.afterActive, 0);
        assert.equal(result.exitCode, 125);
        assert.equal(result.simulatedThreshold, true);
      }
    );
    await check(
      "atomic membership and priority/affinity before first execution",
      async () => {
        const job = await launch({ threads: 1, args: ["tree", marker] });
        assert.equal(job.initial.active, 1);
        assert.equal(job.initial.members[0].pid, job.initial.rootPid);
        assert.equal(job.initial.members[0].created, job.initial.rootCreated);
        assert.equal(job.initial.priority, 0x4000);
        assert.equal(job.initial.commitLimitBytes, 3 * 1024 ** 3);
        assert.equal(
          BigInt(job.initial.affinityMask).toString(2).replaceAll("0", "")
            .length,
          1
        );
        await delay(100);
        assert.equal(existsSync(marker), false);
        await job.start();
        await waitFor(() => existsSync(marker), "root did not start");
        const ids = JSON.parse(readFileSync(marker, "utf8"));
        assert.equal(ids.omp, "1");
        await waitFor(
          async () =>
            (await job.sample()).members.some((item) => item.pid === ids.child),
          "child not contained"
        );
        const sample = await job.sample();
        // Windows may add owned console-host processes. They also consume the
        // shared job affinity/RSS and must be measured, rather than excluded.
        assert.ok(sample.members.some((item) => item.pid === ids.root));
        assert.ok(sample.members.some((item) => item.pid === ids.child));
        assert.ok(sample.rssBytes > 0 && sample.cpuMs >= 0);
        assert.equal(
          sample.rssBytes,
          sample.members.reduce((sum, item) => sum + item.rssBytes, 0)
        );
        await assert.rejects(() => job.start());
        await job.terminate();
        await waitFor(
          async () => (await job.sample()).active === 0,
          "terminated tree still active"
        );
        assert.ok((await job.sample()).cpuMs >= sample.cpuMs);
        await job.close();
        await waitFor(
          () => !alive(ids.root) && !alive(ids.child),
          "owned tree survived termination"
        );
      }
    );
    await check(
      "EOF closes descendant job without touching independent process",
      async () => {
        const unrelated = spawn(process.execPath, [module, "leaf"], {
          windowsHide: true,
          stdio: "ignore",
        });
        try {
          const file = join(fixture, "eof.json");
          const job = await launch({ threads: 2, args: ["tree", file] });
          assert.ok(
            BigInt(job.initial.affinityMask).toString(2).replaceAll("0", "")
              .length <= 2
          );
          await job.start();
          await waitFor(() => existsSync(file), "EOF fixture missing");
          const ids = JSON.parse(readFileSync(file, "utf8"));
          await job.close();
          await waitFor(
            () => !alive(ids.root) && !alive(ids.child),
            "EOF orphaned descendant"
          );
          assert.equal(alive(unrelated.pid), true);
        } finally {
          unrelated.kill();
          await new Promise((done) => unrelated.once("close", done));
        }
      }
    );
    await check(
      "guardian crash leaves no root or orphan descendant",
      async () => {
        const file = join(fixture, "crash.json");
        const job = await launch({ args: ["tree", file] });
        await job.start();
        await waitFor(() => existsSync(file), "crash fixture missing");
        const ids = JSON.parse(readFileSync(file, "utf8"));
        job.abortGuardian();
        await waitFor(
          () => !alive(ids.root) && !alive(ids.child),
          "guardian crash orphaned process"
        );
        await job.close();
      }
    );
    await check(
      "guardian loss before execution clears the suspended root",
      async () => {
        const file = join(fixture, "suspended.json");
        const job = await launch({ args: ["tree", file] });
        const rootPid = job.initial.rootPid;
        job.abortGuardian();
        await waitFor(
          () => !alive(rootPid),
          "suspended process survived guardian loss"
        );
        assert.equal(existsSync(file), false);
        await job.close();
      }
    );
    await check("hard wall deadline is not reset by requests", async () => {
      const job = await launch({ wallMs: 350 });
      await job.start();
      await waitFor(
        async () => (await job.sample()).active === 0,
        "wall deadline failed"
      );
      assert.equal((await job.sample()).exitCode, 124);
      await job.close();
    });
    await check(
      "wall termination cannot wait on the sampling mutex",
      async () => {
        const script = join(fixture, "held sample lock.ps1");
        const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
        const native = fileURLToPath(
          new URL("./windows-job.cs", import.meta.url)
        );
        const cmd = [process.execPath, "-e", "setInterval(()=>{},1000)"]
          .map(windowsArgument)
          .join(" ");
        // Test-only reflection blocks the actual native sampling mutex; the
        // production interface never exposes a lock or a caller-supplied PID.
        writeFileSync(
          script,
          `$ErrorActionPreference='Stop'
Add-Type -Path ${psLiteral(native)}
$owned=[OricaOwnedJob]::new(${psLiteral(process.execPath)},${psLiteral(cmd)},${psLiteral(fixture)},1,350)
$sync=$owned.GetType().GetField('sync',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($owned)
try {
  [Threading.Monitor]::Enter($sync)
  $owned.Start($owned.Measure().host.startToken)
  [Threading.Thread]::Sleep(800)
  $sample=$owned.Measure()
  @{active=$sample.active;exitCode=$sample.exitCode}|ConvertTo-Json -Compress
} finally { [Threading.Monitor]::Exit($sync); $owned.Dispose() }
`
        );
        const { stdout } = await promisify(execFile)(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
        );
        assert.deepEqual(JSON.parse(stdout.trim()), {
          active: 0,
          exitCode: 124,
        });
      }
    );
    await check(
      "quoted argv reaches the child exactly without shell interpretation",
      async () => {
        const file = join(fixture, "args.json"),
          args = ["", 'a"b', "C:\\space tail\\", "$(secret)", "`x`", "日本語"];
        const job = await launch({ args: ["args", file, ...args] });
        await job.start();
        await waitFor(() => existsSync(file), "quoted argv fixture missing");
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), args);
        await job.close();
      }
    );
    await check(
      "job lifetime I/O includes an exited descendant's overwrites and deleted file",
      async () => {
        const file = join(fixture, "deleted-io.bin");
        const job = await launch({ args: ["io-tree", file] });
        assert.equal(job.initial.writeTransferBytes, "0");
        await job.start();
        await waitFor(
          async () => (await job.sample()).active === 0,
          "write I/O tree did not exit"
        );
        const terminal = await job.finish();
        assert.equal(terminal.sample.exitCode, 0);
        assert.deepEqual(terminal.sample.members, []);
        assert.equal(existsSync(file), false);
        assert.ok(BigInt(terminal.sample.writeTransferBytes) >= 3n * 4096n);
        assert.ok(
          BigInt(terminal.guardianFinal.writeTransferBytes) >=
            BigInt(terminal.sample.guardian.writeTransferBytes)
        );
        assert.ok(
          BigInt(terminal.meterFinal.writeTransferBytes) >=
            BigInt(terminal.meterLastSample.writeTransferBytes)
        );
        assert.equal(terminal.accountingComplete, false);
        console.log(
          `WINDOWS_JOB_WRITE_IO_RESULT ${JSON.stringify({ jobBytes: terminal.sample.writeTransferBytes, guardianBytes: terminal.guardianFinal.writeTransferBytes, helperBytes: terminal.meterFinal.writeTransferBytes, filePresent: false, payloadWrites: 3, payloadBytesPerWrite: 4096, accountingComplete: false })}`
        );
      }
    );
    await check(
      "write transfer limit validation rejects malformed limits before spawn",
      async () => {
        for (const limit of [-2, 0.5, NaN, Infinity, "8192", 2147483649, null])
          await assert.rejects(
            () => launch({ writeTransferLimitBytes: limit }),
            /invalid owned process request/
          );
      }
    );
    await check(
      "native write limit stops a live root after a deleted/exited child while JS is blocked",
      async () => {
        const file = join(fixture, "limit-deleted.bin");
        const job = await launch({
          args: ["io-hold", file],
          writeTransferLimitBytes: 16384,
        });
        assert.equal(job.initial.writeTransferLimitBytes, 16384);
        const handle = loadProcessMeter().open(job.initial.rootPid);
        try {
          assert.equal(handle.sample().created, job.initial.rootCreated);
          await job.start();
          // No JS sample/heartbeat can enforce the output limit in this interval.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
          const exited = handle.sample();
          assert.equal(exited.signaled, true);
          assert.equal(exited.exitCode, 127);
          const terminal = await job.finish();
          assert.equal(terminal.sample.writeTransferLimitExceeded, true);
          assert.ok(BigInt(terminal.sample.writeTransferBytes) >= 20480n);
          assert.deepEqual(terminal.sample.members, []);
          assert.equal(existsSync(file), false);
          assert.equal(terminal.accountingComplete, false);
          console.log(
            `WINDOWS_JOB_WRITE_LIMIT_RESULT ${JSON.stringify({ limitBytes: 16384, jobBytes: terminal.sample.writeTransferBytes, rootExit: exited.exitCode, active: terminal.sample.active, filePresent: false, accountingComplete: false })}`
          );
        } finally {
          handle.close();
        }
      }
    );
    await check(
      "zero write allowance permits idle work and bounded sample counters cannot be changed",
      async () => {
        const job = await launch({ writeTransferLimitBytes: 0 });
        await job.start();
        await delay(250);
        const prior = await job.sample();
        // Windows may also own a conhost after Node starts. Keep validating
        // every member rather than assuming only the suspended root exists.
        assert.ok(
          prior.members.some(
            (member) =>
              member.pid === prior.rootPid &&
              member.created === prior.rootCreated
          )
        );
        assert.equal(prior.writeTransferBytes, "0");
        assert.equal(prior.writeTransferLimitExceeded, false);
        for (const patch of [
          { writeTransferLimitBytes: -1 },
          { writeTransferLimitExceeded: true },
          { writeTransferBytes: "1" },
          { writeTransferBytes: "18446744073709551616" },
        ])
          assert.throws(
            () => validateOwnedSample({ ...prior, ...patch }, 1, prior),
            /write transfer/
          );
        const missing = { ...prior };
        delete missing.writeTransferLimitBytes;
        delete missing.writeTransferLimitExceeded;
        assert.throws(
          () => validateOwnedSample(missing, 1, prior),
          /write transfer/
        );
        const exceeded = {
          ...prior,
          writeTransferBytes: "1",
          writeTransferLimitExceeded: true,
        };
        validateOwnedSample(exceeded, 1, prior);
        assert.throws(
          () => validateOwnedSample(prior, 1, exceeded),
          /write transfer/
        );
        await job.finish();
      }
    );
    passed = true;
    return { executed: true, completed: tests, provesRuntimeAcceptance: false };
  } finally {
    for (const job of handles) await job.close();
    assert.ok(relative(tmpdir(), fixture).startsWith("orica-owned-job-"));
    if (passed) rmSync(resolve(fixture), { recursive: true, force: true });
    else console.error(`Windows job failure fixture preserved: ${fixture}`);
  }
}
