// Private OS regression of the fixed-smoke continuation used in production.
// It never recovers shared old reservations or starts an engine game.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL, URL } from "node:url";
import { createWindowsJob } from "./windows-job.mjs";
import { loadProcessMeter } from "./windows-process-handle.mjs";
import { buildProcessMeter } from "./build-process-handle.mjs";
import { budgetStatus, reserveBudget } from "./budget.mjs";
import { runFixedSmokeAdmission, smokeLimits } from "./fixed-smoke.mjs";

export async function testContainedAdmission() {
  if (process.platform !== "win32")
    return { executed: false, reason: "windows_host_required" };
  buildProcessMeter();
  const directory = mkdtempSync(join(tmpdir(), "orica-contained-admission-"));
  const caller = join(directory, "caller.mjs");
  const url = (file) => new URL(file, import.meta.url).href;
  writeFileSync(
    caller,
    `import {execFileSync,spawn} from 'node:child_process';
import {writeFileSync,unlinkSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {runFixedSmokeAdmission} from ${JSON.stringify(url("fixed-smoke.mjs"))};
import {createWindowsJob} from ${JSON.stringify(url("windows-job.mjs"))};
import {createWindowsResourceController} from ${JSON.stringify(url("windows-resource-controller.mjs"))};
const [directory,mode,id,owner]=process.argv.slice(2);
const resultFile=join(directory,'result.json'), idle=join(directory,'idle.mjs');
writeFileSync(idle,'setInterval(()=>{},1000)');
const ledger=join(directory,'ledger');
let scans=0;
const scanPids=[];
const storage=()=>{
  scans++;
  // A separate writer in each admission/persistence scan; files are overwritten
  // and deleted, so retained file sizes cannot stand in for lifetime I/O.
  const pid=execFileSync(process.execPath,['--v8-pool-size=1','-e',
    "const fs=require('node:fs'),f=process.argv[1];for(let i=0;i<3;i++){const fd=fs.openSync(f,'w');fs.writeSync(fd,Buffer.alloc(4096));fs.fsyncSync(fd);fs.closeSync(fd)}fs.unlinkSync(f);process.stdout.write(String(process.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400)",
    join(directory,'scan-'+scans+'.bin')],{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','ignore']});
  scanPids.push(Number(pid));
};
const result=await runFixedSmokeAdmission(ledger,0,id,owner,storage,async(owned,controls,reservation)=>{
    if(owned.args.join('|')!==['0',id,owner].join('|'))throw Error('fixed input changed');
    const job=await createWindowsJob({...owned,module:idle,cwd:directory,args:[]});
    try {
      const controller=createWindowsResourceController(job,1,reservation.callerMeter);
      const last=await controller.start(false);
      controls.onSample(last);
      return {status:'stopped',reason:'cancelled',samples:1,last,terminal:await controller.finish()};
    } finally {await job.close()}
  });
const beforeTail=process.cpuUsage(),end=performance.now()+200;
while(performance.now()<end){}
const tail=process.cpuUsage(beforeTail);
const fd=openSync(join(directory,'tail.bin'),'w');
writeSync(fd,Buffer.alloc(8192));fsyncSync(fd);closeSync(fd);unlinkSync(join(directory,'tail.bin'));
// Both modes leave an owned child beyond caller exit. The normal child exits
// naturally only after the observer releases it; the orphan requires Finish.
const child=spawn(process.execPath,['--v8-pool-size=1','-e',mode==='orphan'
  ? 'setInterval(()=>{},1000)'
  : "const fs=require('node:fs');const timer=setInterval(()=>{if(fs.existsSync(process.argv[1]))clearInterval(timer)},25)",
  join(directory,'release-child')],{windowsHide:true,detached:true,stdio:'ignore'});
await new Promise((done,reject)=>{child.once('spawn',done);child.once('error',reject)});
const descendantPid=child.pid,orphanPid=mode==='orphan'?child.pid:null;child.unref();
writeFileSync(resultFile,JSON.stringify({status:result.status,cutoff:result.callerCutoff,
  innerCpuMs:result.terminal.finalOwnedCpuMs,
  tailCpuMs:(tail.user+tail.system)/1000,scans,scanPids,orphanPid,descendantPid}));
`
  );
  let completed = 0,
    passed = false;
  try {
    for (const [name, wallMs, outputBytes, reason] of [
      ["short", 60000, smokeLimits.outputBytes, /headroom/],
      ["quota", 120000, 65536, /reservation mismatch/],
    ]) {
      const ledger = join(directory, name);
      const reservation = reserveBudget(ledger, {
        wallMs,
        outputBytes,
        threads: 1,
        owner: "33333333-3333-4333-8333-333333333333",
      });
      assert.equal(reservation.status, "reserved");
      let called = 0;
      await assert.rejects(
        runFixedSmokeAdmission(
          ledger,
          0,
          reservation.id,
          reservation.owner,
          () => {
            called++;
          },
          () => {
            called++;
          }
        ),
        reason
      );
      assert.equal(called, 0, "reject before storage or process creation");
      assert.equal(budgetStatus(ledger).active.length, 1);
      assert.equal(existsSync(join(ledger, "managed-output")), false);
    }
    for (const mode of ["normal", "orphan"]) {
      const run = join(directory, mode);
      // The caller creates its own ledger beneath an already private directory.
      mkdirSync(run);
      const ledger = join(run, "ledger");
      const reservation = reserveBudget(ledger, {
        wallMs: 120000,
        threads: 1,
        outputBytes: smokeLimits.outputBytes,
        owner: "22222222-2222-4222-8222-222222222222",
      });
      assert.equal(reservation.status, "reserved");
      let scans = 0;
      await assert.rejects(
        runFixedSmokeAdmission(ledger, 0, reservation.id, "wrong-owner", () => {
          scans++;
        }),
        /reservation mismatch/
      );
      assert.equal(scans, 0, "invalid owner must not scan or execute");
      const job = await createWindowsJob({
        module: caller,
        cwd: directory,
        args: [run, mode, reservation.id, reservation.owner],
        threads: 1,
        wallMs: 60000,
      });
      let rootMeter;
      const members = new Map();
      try {
        rootMeter = loadProcessMeter().open(job.initial.rootPid);
        assert.equal(await job.start(), true);
        const until = Date.now() + 45000;
        let rootFinal;
        while (Date.now() < until) {
          // Keep the outer guardian live and validate the whole nested envelope.
          const sample = await job.sample();
          for (const member of sample.members) {
            const key = `${member.pid}:${member.created}`;
            if (!members.has(key)) {
              // These handles are opened only for identities sampled in our
              // immutable owned Job, never for an arbitrary supplied PID.
              try {
                const handle = loadProcessMeter().open(member.pid);
                if (handle.sample().created === member.created)
                  members.set(key, handle);
                else handle.close();
              } catch {
                /* Short lived members may exit between the two calls. */
              }
            }
          }
          rootFinal = rootMeter.sample();
          if (rootFinal.signaled) break;
          await delay(100);
        }
        assert.equal(rootFinal.signaled, true, "admission caller did not exit");
        assert.equal(rootFinal.exitCode, 0);
        const record = JSON.parse(
          readFileSync(join(run, "result.json"), "utf8")
        );
        assert.equal(record.status, "stopped");
        assert.equal(record.scans, 3);
        assert.equal(record.scanPids.length, 3);
        const writers = record.scanPids.map((pid) => {
          const handle = [...members.values()].find(
            (value) => value.sample().pid === pid
          );
          assert.ok(
            handle,
            "each scan writer must be observed in the outer Job"
          );
          const terminal = handle.sample();
          assert.equal(terminal.signaled, true);
          assert.equal(terminal.exitCode, 0);
          assert.ok(BigInt(terminal.writeTransferBytes) >= 3n * 4096n);
          return terminal;
        });
        assert.ok(record.tailCpuMs > 0);
        assert.equal(record.cutoff.sample.pid, rootFinal.pid);
        const cutoffCpuMs =
          (record.cutoff.sample.userMicros +
            record.cutoff.sample.systemMicros) /
          1000;
        assert.ok(rootFinal.cpuMs + 0.001 >= cutoffCpuMs + record.tailCpuMs);
        // A signaled caller handle does not prove that Windows has finished
        // removing that process (or its nested helpers) from the outer Job.
        // Observe the complete membership before asking Finish to terminate
        // anything. A normal run must drain; the orphan must remain live.
        const observationStarted = performance.now();
        let beforeRelease = await job.sample();
        const childOnly = () =>
          beforeRelease.active === 1 &&
          beforeRelease.members[0].pid === record.descendantPid;
        while (!childOnly() && performance.now() - observationStarted < 5000) {
          await delay(100);
          beforeRelease = await job.sample();
        }
        writeFileSync(
          join(run, "before-release.json"),
          JSON.stringify(beforeRelease)
        );
        assert.ok(childOnly(), "outer Job did not retain its expected child");
        const member = beforeRelease.members[0];
        const childKey = `${member.pid}:${member.created}`;
        let childHandle = members.get(childKey);
        if (!childHandle) {
          childHandle = loadProcessMeter().open(member.pid);
          members.set(childKey, childHandle);
        }
        const retained = childHandle.sample();
        assert.equal(retained.created, member.created);
        assert.equal(retained.signaled, false);
        const drainStarted = performance.now();
        let beforeFinish = beforeRelease;
        if (mode === "normal") {
          writeFileSync(join(run, "release-child"), "release");
          do {
            await delay(100);
            beforeFinish = await job.sample();
          } while (
            beforeFinish.active > 0 &&
            performance.now() - drainStarted < 5000
          );
          assert.equal(beforeFinish.active, 0, "normal child did not drain");
        }
        const drainWaitMs = performance.now() - drainStarted;
        writeFileSync(
          join(run, "before-finish.json"),
          JSON.stringify(beforeFinish)
        );
        const terminal = await job.finish();
        writeFileSync(join(run, "terminal.json"), JSON.stringify(terminal));
        assert.equal(terminal.forced, mode === "orphan");
        assert.equal(terminal.sample.active, 0);
        assert.deepEqual(terminal.sample.members, []);
        const childFinal = childHandle.sample();
        assert.equal(childFinal.created, member.created);
        assert.equal(childFinal.signaled, true);
        assert.equal(childFinal.exitCode, mode === "orphan" ? 125 : 0);
        // Nested job CPU already belongs to the outer job. Add neither the
        // inner finalOwnedCpuMs nor the caller cutoff to the outer aggregate.
        assert.ok(
          terminal.sample.cpuMs + 0.001 >=
            rootFinal.cpuMs +
              record.innerCpuMs +
              writers.reduce((sum, writer) => sum + writer.cpuMs, 0)
        );
        assert.ok(
          BigInt(terminal.sample.writeTransferBytes) >= 3n * 3n * 4096n + 8192n
        );
        const budget = budgetStatus(ledger);
        assert.equal(budget.active.length, 1, "no child reservation permitted");
        assert.equal(budget.active[0].id, reservation.id);
        assert.deepEqual(budget.active[0].reserved, reservation.reserved);
        assert.equal(budget.used.wallMs, 120000);
        assert.equal(budget.used.cpuMs, 120000);
        assert.equal(budget.used.outputBytes, smokeLimits.outputBytes);
        const output = join(run, "ledger", "managed-output", reservation.id);
        assert.equal(
          existsSync(join(output, "artifact-fixed-smoke-attempt.bin")),
          true
        );
        assert.equal(
          existsSync(join(output, "artifact-fixed-smoke-inner-runtime.bin")),
          true
        );
        assert.equal(
          existsSync(join(output, "artifact-runtime-telemetry.bin")),
          false
        );
        assert.equal(terminal.accountingComplete, false);
        for (const name of [
          "tail.bin",
          "scan-1.bin",
          "scan-2.bin",
          "scan-3.bin",
        ])
          assert.equal(existsSync(join(run, name)), false);
        if (record.orphanPid !== null)
          assert.throws(() => process.kill(record.orphanPid, 0), /ESRCH/);
        console.log(
          `I0_CONTAINED_ADMISSION_RESULT ${JSON.stringify({
            mode,
            callerCpuMs: rootFinal.cpuMs,
            cutoffCpuMs,
            tailCpuMs: record.tailCpuMs,
            innerCpuMs: record.innerCpuMs,
            outerJobCpuMs: terminal.sample.cpuMs,
            outerJobWriteBytes: terminal.sample.writeTransferBytes,
            scanWriters: writers.map(
              ({ pid, created, cpuMs, writeTransferBytes }) => ({
                pid,
                created,
                cpuMs,
                writeTransferBytes,
              })
            ),
            forced: terminal.forced,
            afterCallerExitActive: beforeRelease.active,
            beforeFinishActive: beforeFinish.active,
            childExitCode: childFinal.exitCode,
            drainWaitMs,
            activeReservations: 1,
            accountingComplete: false,
            provesRuntimeAcceptance: false,
            provesGameCalibration: false,
          })}`
        );
        console.log(
          `contained-admission ok ${++completed} - ${mode} fixed-smoke admission lifetime and single reservation`
        );
      } finally {
        rootMeter?.close();
        for (const handle of members.values()) handle.close();
        await job.close();
      }
    }
    passed = true;
    return {
      executed: true,
      completed,
      provesRuntimeAcceptance: false,
      provesGameCalibration: false,
    };
  } finally {
    assert.ok(
      relative(tmpdir(), directory).startsWith("orica-contained-admission-")
    );
    if (passed) rmSync(directory, { recursive: true, force: true });
    else
      console.error(
        `Contained admission failure fixture preserved: ${directory}`
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await testContainedAdmission();
  assert.equal(result.completed, 2);
  console.log(
    `ISMCTS_CONTAINED_ADMISSION_TEST_RESULT ${JSON.stringify(result)}`
  );
}
