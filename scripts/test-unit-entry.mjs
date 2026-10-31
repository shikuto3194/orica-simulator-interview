import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireGateLease } from "./harness/gate-lease.mjs";
import {
  unitTestFiles,
  assertUnitTestResults,
} from "./harness/unit-test-input.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function testUnitEntry() {
  const temp = mkdtempSync(join(tmpdir(), "orica-unit-entry-"));
  const modules = join(temp, "node_modules");
  const entry = join(root, "scripts/harness/test-unit.mjs");
  const put = (file, text) => {
    mkdirSync(dirname(join(temp, file)), { recursive: true });
    writeFileSync(join(temp, file), text);
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: temp, stdio: "pipe", windowsHide: true });
  const run = (args) => {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: temp,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stdout + result.stderr);
    return result;
  };
  const latest = () =>
    JSON.parse(readFileSync(join(temp, "logs/harness/latest.json"), "utf8"));
  const good = "packages/example/test/good.test.ts";
  const spaced = "packages/example/test/file with space.test.ts";
  const bad = "packages/example/test/bad.test.ts";
  const empty = "packages/example/test/empty.test.ts";
  const skipped = "packages/example/test/skipped.test.ts";
  const excluded = "packages/example/test/excluded.test.ts";
  let succeeded = false;
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Unit entry fixture");
    git("config", "user.email", "unit@example.invalid");
    put(
      ".gitignore",
      "logs/\nnode_modules/\npackages/example/test/ignored.test.ts\n"
    );
    put("package.json", '{"type":"module"}\n');
    put(
      "vitest.config.ts",
      `export default { test: {
      include: ['packages/**/test/**/*.test.ts'], exclude: ['**/excluded.test.ts'],
      pool: 'threads', poolOptions: { threads: { maxThreads: 8, minThreads: 1 } }
    }};\n`
    );
    for (const file of [
      "scripts/vitest-with-jest-aliases.mjs",
      "scripts/harness/vitest-unit.config.mjs",
      "scripts/harness/unit-test-input.mjs",
      "scripts/harness/vitest-acceptance-reporter.mjs",
    ]) {
      mkdirSync(dirname(join(temp, file)), { recursive: true });
      copyFileSync(join(root, file), join(temp, file));
    }
    symlinkSync(
      join(root, "node_modules"),
      modules,
      process.platform === "win32" ? "junction" : "dir"
    );
    const pass = `import {it,expect} from 'vitest'; import {isMainThread} from 'node:worker_threads'; it('executes in a fork',()=>expect(isMainThread).toBe(true));\n`;
    put(good, pass);
    put(spaced, pass);
    put(
      bad,
      `import {it,expect} from 'vitest'; it('must fail',()=>expect(1).toBe(2));\n`
    );
    put(empty, "export const noTests = true;\n");
    put(
      skipped,
      `import {it} from 'vitest'; it.skip('not executed',()=>{});\n`
    );
    put(excluded, pass);
    put("packages/example/test/ignored.test.ts", pass);
    put(
      "packages/example/test/good.test.ts-extra.test.ts",
      `import {writeFileSync} from 'node:fs'; writeFileSync('logs/unselected-ran','1'); throw Error('unselected file ran');\n`
    );
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "unit fixture");
    // Regression tests written during a repair must work before git add.
    const fresh = "packages/example/test/new.test.ts";
    put(fresh, pass);
    assert.deepEqual(unitTestFiles(temp, ["./" + fresh, good, good]), [
      good,
      fresh,
    ]);
    for (const args of [
      [],
      ["--maxWorkers=8"],
      ["packages/example/test/*.test.ts"],
      ["../outside.test.ts"],
      ["packages/example/test/ignored.test.ts"],
      ["packages/example/test/missing.test.ts"],
    ])
      assert.throws(() => unitTestFiles(temp, args));
    const linked = join(temp, "packages/example/test/linked");
    symlinkSync(
      join(temp, "packages/example/test"),
      linked,
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.throws(
      () => unitTestFiles(temp, ["packages/example/test/linked/good.test.ts"]),
      /Linked/
    );
    assert.ok(lstatSync(linked).isSymbolicLink());
    rmSync(linked, { recursive: true, force: true });

    for (const args of [
      [],
      ["--passWithNoTests"],
      ["--watch"],
      ["--config", "vitest.config.ts"],
      ["--pool=threads"],
      ["--maxWorkers=8"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(
        existsSync(join(temp, "logs/harness/latest.json")),
        false,
        "invalid args must not start a gate"
      );
    }
    let result = run(["--", good, spaced, fresh]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      existsSync(join(temp, "logs/unselected-ran")),
      false,
      "exact includes must not run substring matches"
    );
    const report = latest();
    assert.equal(report.completionGate, false);
    assert.equal(report.profile, "unit");
    assert.deepEqual(
      report.gates.map((gate) => gate.id),
      ["vitest"]
    );
    assert.deepEqual(report.vitestArgs, [spaced, good, fresh].sort());
    assertUnitTestResults(
      temp,
      report.vitestArgs,
      report.gates[0].testResults.path
    );
    assert.ok(report.leaseWaitMs >= 0);
    for (const files of [[bad], [empty], [skipped], [good, excluded]]) {
      result = run(files);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(latest().status, "failed");
      assert.equal(latest().gates[0].status, "failed");
    }

    // The shared shell-free transport must retain the legacy Jest alias too.
    const legacy = "packages/example/test/legacy file.test.ts";
    put(
      legacy,
      `import {it,expect} from 'vitest'; it('legacy transport',()=>expect(1).toBe(1));\n`
    );
    result = spawnSync(
      process.execPath,
      [
        join(root, "scripts/vitest-with-jest-aliases.mjs"),
        legacy,
        "--runInBand",
      ],
      {
        cwd: temp,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stdout + result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    // Exercise actual worker concurrency, even with an eight-thread base config.
    const events = join(temp, "logs/concurrency.jsonl");
    const concurrent = [1, 2, 3].map(
      (n) => `packages/example/test/concurrent-${n}.test.ts`
    );
    for (const [i, file] of concurrent.entries())
      put(
        file,
        `import {it,expect} from 'vitest'; import {appendFileSync} from 'node:fs'; import {isMainThread} from 'node:worker_threads'; it('bounded worker',async()=>{expect(isMainThread).toBe(true);appendFileSync(${JSON.stringify(events)},JSON.stringify({id:${i},delta:1})+'\\n');await new Promise(r=>setTimeout(r,600));appendFileSync(${JSON.stringify(events)},JSON.stringify({id:${i},delta:-1})+'\\n');});\n`
      );
    result = run(concurrent);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    let active = 0,
      maximum = 0;
    for (const row of readFileSync(events, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))) {
      active += row.delta;
      maximum = Math.max(maximum, active);
      assert.ok(active >= 0 && active <= 2, "at most two active workers");
    }
    assert.equal(active, 0);
    assert.ok(maximum > 0 && maximum <= 2);

    // Use the real unit CLI and a real held lease; only the synthetic repo's
    // lease is observed. No host/shared production lease file is read.
    for (const changeWhileQueued of [false, true]) {
      const release = await acquireGateLease(temp);
      let child, timer;
      const original = readFileSync(join(temp, good), "utf8");
      const runCount = () => readdirCount(join(temp, "logs/harness/runs"));
      const before = runCount();
      try {
        const outcome = await new Promise((done, reject) => {
          let output = "",
            released = false;
          child = spawn(process.execPath, [entry, good], {
            cwd: temp,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
          const accept = (bytes) => {
            output += bytes;
            if (!released && output.includes("waiting in FIFO queue")) {
              try {
                assert.equal(
                  runCount(),
                  before,
                  "the unit gate must not run before admission"
                );
                if (changeWhileQueued)
                  put(good, original + "\n// queued edit\n");
                released = true;
                globalThis.clearTimeout(timer);
                release();
              } catch (error) {
                reject(error);
              }
            }
          };
          child.stdout.on("data", accept);
          child.stderr.on("data", accept);
          child.once("error", reject);
          child.once("close", (code) => done({ code, output, released }));
          timer = globalThis.setTimeout(
            () =>
              reject(new Error("Unit queue fixture did not finish: " + output)),
            30000
          );
        });
        assert.equal(outcome.released, true, outcome.output);
        assert.equal(outcome.code, changeWhileQueued ? 1 : 0, outcome.output);
        if (changeWhileQueued) {
          assert.match(outcome.output, /changed while queued/);
          assert.deepEqual(latest().gates, []);
        }
      } finally {
        globalThis.clearTimeout(timer);
        if (child && child.exitCode === null) {
          const closed = new Promise((done) => child.once("close", done));
          child.kill();
          await closed;
        }
        release();
        put(good, original);
      }
    }
    console.log(
      "[test-unit-entry] exact files, new files, spaces, rejected arguments/links/ignored files, failures/zero/skipped/missing execution, two forks, shared lease and queued edits passed"
    );
    succeeded = true;
  } finally {
    if (succeeded) {
      if (existsSync(modules)) {
        assert.ok(lstatSync(modules).isSymbolicLink());
        rmSync(modules, { recursive: true, force: true });
      }
      assert.equal(dirname(temp), resolve(tmpdir()));
      // Retry transient Windows cwd locks only after all fixture children passed.
      rmSync(temp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } else {
      // Preserve the original failure and its reports; a timed-out CLI can still
      // have descendants using this cwd. Never mask it with cleanup EBUSY.
      console.error(`[test-unit-entry] failed fixture preserved: ${temp}`);
    }
  }
}

function readdirCount(directory) {
  // Keep the queue assertion focused on this fixture's reports, not lease data.
  return existsSync(directory) ? readdirSync(directory).length : 0;
}
