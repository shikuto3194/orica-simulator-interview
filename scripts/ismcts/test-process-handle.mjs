import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  loadProcessMeter,
  processMeterArtifact,
  validateProcessMeterArtifact,
} from "./windows-process-handle.mjs";

export async function testProcessHandle() {
  const binding = loadProcessMeter();
  let completed = 0;
  const check = async (name, fn) => {
    await fn();
    console.log(`process-handle ok ${++completed} - ${name}`);
  };
  async function child(script, examine, exitCode) {
    const process = spawn(
      globalThis.process.execPath,
      ["--v8-pool-size=1", "-e", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    const exited = new Promise((resolve, reject) => {
      process.once("close", (code, signal) => resolve({ code, signal }));
      process.once("error", reject);
    });
    let meter;
    try {
      meter = binding.open(process.pid);
      await examine(process, meter, exited);
      const exit = await exited;
      assert.equal(exit.code, exitCode);
      assert.equal(exit.signal, null);
    } finally {
      process.kill();
      await exited;
      meter?.close();
    }
  }
  await check(
    "retained handle observes code 259 as signaled and repeats final CPU",
    async () => {
      await child(
        "process.stdin.once('data',()=>{const end=Date.now()+100;while(Date.now()<end){}process.exit(259)});",
        async (p, m, done) => {
          const initial = m.sample();
          assert.equal(initial.signaled, false);
          p.stdin.end("exit");
          await done;
          const final = m.sample();
          assert.equal(final.pid, initial.pid);
          assert.equal(final.created, initial.created);
          assert.equal(final.signaled, true);
          assert.equal(final.exitCode, 259);
          assert.ok(final.cpuMs > initial.cpuMs);
          assert.deepEqual(m.sample(), final);
          m.close();
          m.close();
          assert.throws(() => m.sample(), /closed/);
        },
        259
      );
    }
  );
  await check("invalid PID inputs fail without a handle", async () => {
    for (const pid of [0, -1, 0.5, NaN, Infinity, 0x100000000, "1", {}, null])
      assert.throws(() => binding.open(pid));
    assert.throws(() => binding.open());
  });
  await check(
    "borrowed methods reject untagged receivers and preserve the owned handle",
    async () => {
      await child(
        "process.stdin.once('data',()=>process.exit(0));",
        async (p, m, done) => {
          for (const receiver of [{}, null, 1]) {
            assert.throws(() => m.sample.call(receiver));
            assert.throws(() => m.close.call(receiver));
          }
          assert.equal(m.sample().signaled, false);
          p.stdin.end("exit");
          await done;
          assert.equal(m.sample().signaled, true);
        },
        0
      );
    }
  );
  await check(
    "source/runtime/binary manifest changes are rejected before image loading",
    async () => {
      const a = processMeterArtifact(),
        manifest = JSON.parse(readFileSync(a.manifest, "utf8")),
        binary = readFileSync(a.binary);
      validateProcessMeterArtifact(manifest, a.input, binary);
      for (const mutate of [
        (x) => (x.input.node = "wrong"),
        (x) => (x.input.source[0][1] = "0".repeat(64)),
        (x) => (x.input.arch = "arm64"),
        (x) => (x.binarySha256 = "0".repeat(64)),
      ]) {
        const x = globalThis.structuredClone(manifest);
        mutate(x);
        assert.throws(() => validateProcessMeterArtifact(x, a.input, binary));
      }
      assert.throws(() =>
        validateProcessMeterArtifact(
          manifest,
          a.input,
          Buffer.concat([binary, Buffer.from([0])])
        )
      );
    }
  );
  await check(
    "CPU and overwritten/deleted file I/O after the final response survive process termination",
    async () => {
      await child(
        "process.stdin.once('data',()=>{const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orica-handle-io-')),file=path.join(dir,'io.bin');console.log(JSON.stringify(process.cpuUsage()));for(let i=0;i<3;i++){const fd=fs.openSync(file,'w');fs.writeSync(fd,Buffer.alloc(4096));fs.fsyncSync(fd);fs.closeSync(fd)}fs.unlinkSync(file);fs.rmdirSync(dir);const end=Date.now()+160;while(Date.now()<end){}process.exit(0)});",
        async (p, m, done) => {
          let output = "";
          p.stdout.setEncoding("utf8");
          p.stdout.on("data", (x) => (output += x));
          p.stdin.end("exit");
          await done;
          const last = JSON.parse(output),
            final = m.sample();
          assert.equal(final.signaled, true);
          assert.ok(final.cpuMs > (last.user + last.system) / 1000 + 50);
          assert.ok(BigInt(final.writeTransferBytes) >= 3n * 4096n);
          assert.deepEqual(m.sample(), final);
        },
        0
      );
    }
  );
  return { completed, provesRuntimeAcceptance: false };
}
