import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { setInterval, clearInterval, setTimeout } from "node:timers";
import {
  prepareIntegration,
  requestIntegration,
  completeIntegration,
  executeAutoMerge,
  readRemoteMain,
} from "./supervisor-integration.mjs";

const temp = mkdtempSync(join(tmpdir(), "orica-integration-"));
const previousLock = process.env.ORICA_SUPERVISOR_LOCK;
process.env.ORICA_SUPERVISOR_LOCK = join(temp, "fixture-merge.lock.json");
const repo = join(temp, "repo"),
  lane = join(temp, "lane"),
  integration = join(temp, "main"),
  remote = join(temp, "remote.git");
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
try {
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Integration fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  writeFileSync(
    join(repo, ".gitignore"),
    "logs/\nnode_modules/\npnpm-lock.yaml\n.verifier-*\n"
  );
  mkdirSync(join(repo, "scripts"));
  writeFileSync(
    join(repo, "scripts/full-run-checkouts.json"),
    JSON.stringify({
      schemaVersion: 1,
      workerWorktree: "../lane",
      workerRef: "refs/heads/lane",
      integrationWorktree: "../main",
      integrationRef: "refs/heads/main",
    })
  );
  copyFileSync(
    new URL("./auto-merge.ps1", import.meta.url),
    join(repo, "scripts/auto-merge.ps1")
  );
  // Keep the actual PS integration and Git hooks; isolate expensive gates only.
  for (const name of ["verifier-evidence.mjs", "supervisor-lock.mjs"])
    writeFileSync(
      join(repo, "scripts", name),
      'process.exit(process.argv[2] === "release" ? Number(process.env.FIXTURE_LOCK_RELEASE_EXIT || 0) : 0);\n'
    );
  writeFileSync(
    join(repo, "scripts/spawn-verifier.mjs"),
    'import { runVerifierWriter } from "./verifier-write-lock.mjs";\nfunction main() { throw new Error("unexpected synthetic writer"); }\nprocess.exitCode = await runVerifierWriter(import.meta.url, main);\n'
  );
  writeFileSync(
    join(repo, "scripts/verifier-evidence.mjs"),
    'import { runVerifierWriter } from "./verifier-write-lock.mjs";\nfunction record() { throw new Error("unexpected synthetic writer"); }\nif(process.argv[2] === "record") process.exitCode = await runVerifierWriter(import.meta.url, record);\n'
  );
  mkdirSync(join(repo, "scripts/harness"));
  for (const name of [
    "primary-main.mjs",
    "full-run-checkouts.mjs",
    "worker-codex-stream.mjs",
    "supervisor-work-recovery.mjs",
    "supervisor-followup.mjs",
    "supervisor-integration.mjs",
    "run-with-lock-heartbeat.mjs",
    "verifier-write-lock.mjs",
    "worker-telegram-delivery.mjs",
    "supervisor-run-metrics.mjs",
    "audit-inputs.mjs",
    "harness/verification-state.cjs",
    "harness/gate-lease.mjs",
    "harness/recover-gate-lease.mjs",
    "harness/gate-queue.mjs",
    "auto-merge-status.mjs",
    "remote-main-integration.mjs",
    "verifier-tree.mjs",
  ])
    copyFileSync(new URL(name, import.meta.url), join(repo, "scripts", name));
  writeFileSync(
    join(repo, "scripts/supervisor-report.mjs"),
    `import {readFileSync, writeFileSync} from 'node:fs';
writeFileSync('logs/fixture-report.json', JSON.stringify({args:process.argv.slice(2), text:readFileSync(0,'utf8')}));\n`
  );
  writeFileSync(
    join(repo, "scripts/harness/run-gates.mjs"),
    'console.log(JSON.stringify({gates: ["review-batch"], fuzzRequired: false}));\n'
  );
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      packageManager: JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url))
      ).packageManager,
      scripts: { "verify:merge": "node -e \"console.log('fixture gate')\"" },
    })
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");
  git(repo, "worktree", "add", "-b", "lane", lane);
  writeFileSync(join(lane, "change.txt"), "reviewed\n");
  git(lane, "add", ".");
  git(lane, "commit", "-m", "lane change");
  const fixtureHeadTree = git(lane, "rev-parse", "HEAD^{tree}");
  mkdirSync(join(lane, "logs/verifier-history/fixture"), { recursive: true });
  writeFileSync(
    join(lane, "logs/verifier-history/fixture/context.json"),
    JSON.stringify({
      schemaVersion: 1,
      base: "main",
      baseTree: git(lane, "rev-parse", "main^{tree}"),
      headTree: fixtureHeadTree,
    })
  );
  // Synthetic evidence for this isolated parent-process fixture; the checker is stubbed.
  writeFileSync(
    join(lane, ".verifier-result.json"),
    JSON.stringify({
      base: "main",
      headTree: fixtureHeadTree,
      archiveRelativePath: "logs/verifier-history/fixture",
      report: {
        summary: "Synthetic parent-process fixture",
        items: [],
        coverage: {
          files: ["change.txt"],
          fullDiffRead: true,
          unverified: [],
          lenses: ["1", "2", "3", "4", "5", "6"].map((lens) => ({
            lens,
            status: "not_applicable",
            reason: "Synthetic isolated fixture",
          })),
        },
      },
    })
  );

  git(repo, "switch", "-c", "interactive");
  git(repo, "worktree", "add", integration, "main");
  writeFileSync(join(repo, "user-work.txt"), "preserved interactive work\n");
  const primaryHead = git(repo, "rev-parse", "HEAD");
  const read = (ticket) => JSON.parse(readFileSync(ticket.file));
  const ticket = () => prepareIntegration(repo, lane);
  const request = () => {
    const t = ticket();
    requestIntegration(t.file, lane);
    return t;
  };
  assert.equal(await completeIntegration(ticket()), null);
  const configPath = join(integration, "scripts/full-run-checkouts.json");
  const configText = readFileSync(configPath, "utf8");
  rmSync(configPath);
  assert.throws(() => ticket(), /configuration is missing/);
  writeFileSync(configPath, configText);
  assert.throws(() => requestIntegration(null, lane), /No parent/);
  assert.throws(
    () => requestIntegration(ticket().file, lane, { skipFuzz: true }),
    /cannot skip fuzz/
  );
  const weakened = request();
  writeFileSync(
    weakened.file,
    JSON.stringify({ ...read(weakened), skipFuzz: true })
  );
  assert.match(
    (
      await completeIntegration(weakened, {
        execute: async () => {
          throw new Error("must not execute");
        },
      })
    ).error,
    /cannot skip fuzz/
  );
  assert.throws(
    () => requestIntegration(ticket().file, repo),
    /another checkout/
  );
  let calls = 0;
  const unexpected = async () => {
    calls++;
    return 0;
  };
  const failedWorker = await completeIntegration(request(), {
    workerExitCode: 1,
    execute: unexpected,
  });
  assert.match(failedWorker.error, /Worker failed/);
  const dirty = request();
  writeFileSync(join(lane, "dirty.txt"), "dirty");
  assert.match(
    (await completeIntegration(dirty, { execute: unexpected })).error,
    /clean committed/
  );
  rmSync(join(lane, "dirty.txt"));
  const moved = request();
  git(lane, "commit", "--allow-empty", "-m", "moved");
  assert.match(
    (await completeIntegration(moved, { execute: unexpected })).error,
    /changed after/
  );
  const tampered = request();
  writeFileSync(
    tampered.file,
    JSON.stringify({ ...read(tampered), repo: lane })
  );
  assert.match(
    (await completeIntegration(tampered, { execute: unexpected })).error,
    /binding/
  );
  assert.equal(calls, 0);
  const nonzero = request();
  assert.equal(
    (await completeIntegration(nonzero, { execute: async () => 17 })).exitCode,
    17
  );
  assert.equal(read(nonzero).status, "failed");
  const falseSuccess = await completeIntegration(request(), {
    execute: async () => 0,
  });
  assert.match(falseSuccess.error, /without matching/);
  const unavailableRemote = request();
  const remoteFailure = await completeIntegration(unavailableRemote, {
    execute: async () => 0,
    readRemote: async () => {
      throw new Error("remote unavailable");
    },
  });
  assert.equal(remoteFailure.status, "failed");
  assert.match(
    read(unavailableRemote).error,
    /without matching publication receipt/
  );

  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    assert.equal(
      await readRemoteMain(lane, {
        execute(_command, _args, options, callback) {
          assert.equal(options.timeout, 60_000);
          setTimeout(() => callback(null, "abc123\trefs/heads/main\n"), 40);
        },
      }),
      "abc123"
    );
    assert.ok(
      ticks > 0,
      "remote verification must leave the heartbeat event loop responsive"
    );
    await assert.rejects(
      readRemoteMain(lane, {
        timeoutMs: 100,
        execute(_command, _args, options, callback) {
          return execFile(
            process.execPath,
            ["-e", "setInterval(()=>{},1000)"],
            options,
            callback
          );
        },
      }),
      /failed or timed out/
    );
  } finally {
    clearInterval(timer);
  }

  const outputFailure = {
    outputLog: join(temp, "output-failure.log"),
    workdir: lane,
    integrationWorktree: integration,
    branch: "lane",
    head: git(lane, "rev-parse", "HEAD"),
  };
  let outputChild;
  await assert.rejects(
    executeAutoMerge(outputFailure, {
      env: process.env,
      spawnProcess(_command, _args, options) {
        outputChild = spawn(
          process.execPath,
          ["-e", "console.log('log');setInterval(()=>{},1000)"],
          options
        );
        return outputChild;
      },
      writeLog() {
        throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
      },
      output: new Writable({
        write(_bytes, _encoding, done) {
          done();
        },
      }),
    }),
    /output could not be preserved/
  );
  assert.ok(
    outputChild.exitCode !== null || outputChild.signalCode !== null,
    "log failure must wait for its own child to exit"
  );

  const partialLog = {
    ...outputFailure,
    outputLog: join(temp, "partial-write.log"),
  };
  assert.equal(
    await executeAutoMerge(partialLog, {
      env: process.env,
      spawnProcess(_command, _args, options) {
        return spawn(
          process.execPath,
          ["-e", "process.stdout.write('complete log')"],
          options
        );
      },
      writeLog(fd, bytes, offset, length) {
        return writeSync(fd, bytes, offset, Math.min(2, length));
      },
      output: new Writable({
        write(_bytes, _encoding, done) {
          done();
        },
      }),
    }),
    0
  );
  assert.equal(readFileSync(partialLog.outputLog, "utf8"), "complete log");

  const pipeFailure = request();
  let pipeChild;
  const brokenOutput = new Writable({
    write(_bytes, _encoding, done) {
      setTimeout(() => {
        const error = Object.assign(new Error("fixture async pipe closed"), {
          code: "EPIPE",
        });
        // Exercise both the event channel and the asynchronous write callback.
        this.emit("error", error);
        done(error);
      }, 10);
    },
  });
  const pipeResult = await completeIntegration(pipeFailure, {
    execute(job, options) {
      return executeAutoMerge(job, {
        ...options,
        output: brokenOutput,
        spawnProcess(_command, _args, childOptions) {
          pipeChild = spawn(
            process.execPath,
            [
              "-e",
              "console.log('preserved before EPIPE');setInterval(()=>{},1000)",
            ],
            childOptions
          );
          return pipeChild;
        },
      });
    },
  });
  assert.equal(pipeResult.status, "failed");
  assert.match(pipeResult.error, /async pipe closed/);
  assert.equal(read(pipeFailure).status, "failed");
  assert.match(
    readFileSync(pipeResult.outputLog, "utf8"),
    /preserved before EPIPE/
  );
  assert.ok(pipeChild.exitCode !== null || pipeChild.signalCode !== null);
  assert.equal(brokenOutput.listenerCount("error"), 0);

  let lateWrite;
  let lateChild;
  let registeredChild;
  const lateOutput = new Writable({
    write(_bytes, _encoding, done) {
      lateWrite = done;
    },
  });
  await assert.rejects(
    executeAutoMerge(
      { ...outputFailure, outputLog: join(temp, "late-pipe.log") },
      {
        env: process.env,
        output: lateOutput,
        spawnProcess(_command, _args, options) {
          lateChild = spawn(
            process.execPath,
            ["-e", "console.log('late write')"],
            options
          );
          return lateChild;
        },
        onChild(child) {
          registeredChild = child;
          if (child)
            child.once("close", () => {
              assert.equal(
                registeredChild,
                null,
                "clear the exited PID before waiting on output"
              );
              lateWrite(new Error("fixture callback failed after child close"));
            });
        },
      }
    ),
    /callback failed after child close/
  );
  assert.equal(lateChild.exitCode, 0);
  assert.equal(
    lateChild.signalCode,
    null,
    "late output failure must not stop an exited child"
  );
  assert.equal(lateOutput.listenerCount("error"), 0);

  // A real pre-push hook records its working directory, rejects once, then
  // permits the retry. The runner must preserve output and the true outcome.
  const hook = join(repo, ".git/hooks/pre-push");
  mkdirSync(join(lane, "logs"), { recursive: true });
  writeFileSync(
    hook,
    '#!/bin/sh\ngit rev-parse --show-toplevel | tr -d "\\n" > logs/hook-cwd.txt\necho "hook output persisted"\nexit 1\n',
    { mode: 0o755 }
  );
  const rejected = request();
  const env = {
    ...process.env,
    ORICA_SUPERVISOR_REPORT_NO_RELAY: "1",
    git_dir: git(lane, "rev-parse", "--absolute-git-dir"),
    git_work_tree: lane,
  };
  const failed = await completeIntegration(rejected, { env });
  assert.equal(failed.status, "failed");
  assert.match(readFileSync(failed.outputLog, "utf8"), /hook output persisted/);
  assert.equal(
    git(integration, "rev-parse", "HEAD"),
    git(lane, "rev-parse", "HEAD"),
    "inherited Git overrides must not redirect the real main merge to the lane"
  );
  assert.equal(
    readFileSync(join(lane, "logs/hook-cwd.txt"), "utf8")
      .replaceAll("\\", "/")
      .toLowerCase(),
    lane.replaceAll("\\", "/").toLowerCase()
  );
  assert.notEqual(
    git(repo, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
    git(lane, "rev-parse", "HEAD")
  );
  const accepted = request();
  writeFileSync(hook, "#!/bin/sh\nexit 75\n", { mode: 0o755 });
  const deferred = await completeIntegration(accepted, { env });
  assert.equal(deferred.status, "waiting", deferred.error);
  assert.equal(
    deferred.exitCode,
    75,
    "real git pre-push preserves the resumable lease classification"
  );
  const previousPublisher = spawnSync(process.execPath, ["-e", ""], {
    windowsHide: true,
  });
  writeFileSync(
    accepted.file,
    JSON.stringify({ ...read(accepted), ownerPid: previousPublisher.pid })
  );
  writeFileSync(hook, '#!/bin/sh\necho "hook final output"\n', { mode: 0o755 });
  const result = await completeIntegration(accepted, {
    env,
    resume: true,
    execute: async (job, options) => {
      assert.equal(read(accepted).status, "running");
      return executeAutoMerge(job, options);
    },
  });
  assert.equal(result.status, "completed", result.error);
  assert.match(readFileSync(result.outputLog, "utf8"), /hook final output/);
  assert.equal(read(accepted).remoteHead, git(lane, "rev-parse", "HEAD"));
  assert.throws(() => requestIntegration(accepted.file, lane), /already used/);
  assert.equal(
    (await completeIntegration(accepted, { execute: unexpected })).status,
    "completed"
  );
  assert.equal(calls, 0, "completed requests never execute twice");
  const cleanupTicket = request();
  const cleanupResult = await completeIntegration(cleanupTicket, {
    env: { ...env, FIXTURE_LOCK_RELEASE_EXIT: "2" },
  });
  assert.equal(cleanupResult.status, "failed");
  assert.match(
    readFileSync(cleanupResult.outputLog, "utf8"),
    /merge lock cleanup failed/
  );
  assert.doesNotMatch(
    readFileSync(cleanupResult.outputLog, "utf8"),
    /status recording failed|Auto-merge attempt already finished/,
    "a saved cleanup failure must not be overwritten or reported as a failed save"
  );
  assert.equal(
    git(repo, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
    git(lane, "rev-parse", "HEAD"),
    "cleanup failure preserves the published commit"
  );

  const cleanupLog = readFileSync(cleanupResult.outputLog, "utf8");
  const cleanupId = cleanupLog.match(/id=([a-f0-9]{32})/)[1];
  const cleanupAttempt = JSON.parse(
    readFileSync(join(repo, "logs/auto-merge-runs", cleanupId + ".json"))
  );
  assert.equal(cleanupAttempt.status, "failed");
  assert.equal(cleanupAttempt.phase, "merge_lock_cleanup");
  assert.equal(existsSync(cleanupResult.outputLog + ".result.json"), false);

  // Exercise the actual runner: a successful CLI exit is followed by parent
  // integration, while a failing CLI cannot trigger its already queued request.
  const fake = join(temp, "fake-codex.mjs");
  writeFileSync(
    fake,
    `import {readFileSync} from 'node:fs';
import {requestIntegration} from ${JSON.stringify(pathToFileURL(join(repo, "scripts/supervisor-integration.mjs")).href)};
readFileSync(0, 'utf8');
if (Object.keys(process.env).some(k => /^GIT_/i.test(k))) throw new Error('Git override leaked to full-run child');
requestIntegration(process.env.ORICA_INTEGRATION_REQUEST, process.cwd());
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'integration requested'}}));
process.exit(Number(process.env.FAKE_EXIT || 0));\n`
  );
  const command = join(
    temp,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  writeFileSync(
    command,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`
      : `#!/bin/sh\n"${process.execPath}" "${fake}" "$@"\n`,
    { mode: 0o755 }
  );
  const stateFile = join(repo, "logs/runner-state.json");
  const runnerArgs = [
    join(repo, "scripts/worker-codex-stream.mjs"),
    "--repo",
    repo,
    "--workdir",
    lane,
    "--worker-ref",
    "refs/heads/lane",
    "--label",
    "supervisor",
    "--codex",
    command,
    "--state-file",
    stateFile,
    "--progress-interval-seconds",
    "0",
  ];
  const runnerOptions = (exit) => ({
    input: "fixture",
    encoding: "utf8",
    timeout: 180000,
    env: { ...env, FAKE_EXIT: String(exit) },
    windowsHide: true,
    cwd: repo,
  });
  const run = (exit) =>
    execFileSync(process.execPath, runnerArgs, runnerOptions(exit));
  git(lane, "commit", "--allow-empty", "-m", "runner change");
  assert.throws(() => run(7));
  const failedRunner = JSON.parse(readFileSync(stateFile));
  assert.equal(failedRunner.status, "failed");
  assert.match(failedRunner.integration.error, /Worker failed/);

  // Reproduce the incident's timing: Codex has exited, but a real pre-push
  // hook is still running. No completion report may escape before its result.
  const barrier = join(temp, "release-hook");
  const marker = join(temp, "hook-waiting");
  const heldHook = join(temp, "held-hook.mjs");
  const reportFile = join(repo, "logs/fixture-report.json");
  writeFileSync(
    heldHook,
    `import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
writeFileSync(${JSON.stringify(marker + ".tmp")}, process.env.ORICA_INTEGRATION_REQUEST);
renameSync(${JSON.stringify(marker + ".tmp")}, ${JSON.stringify(marker)});
console.log('[verify] fixture pre-push waiting');
const deadline = Date.now() + 30000;
while (!existsSync(${JSON.stringify(barrier)})) {
  if (Date.now() > deadline) process.exit(99);
  await delay(25);
}
console.error('fixture pre-push final failure');
process.exit(Number(readFileSync(${JSON.stringify(barrier)}, 'utf8')));\n`
  );
  writeFileSync(
    hook,
    `#!/bin/sh\n"${process.execPath.replaceAll("\\", "/")}" "${heldHook.replaceAll("\\", "/")}"\n`,
    { mode: 0o755 }
  );
  rmSync(reportFile);
  const remoteBefore = git(repo, "ls-remote", "origin", "refs/heads/main");
  const runner = spawn(process.execPath, runnerArgs, runnerOptions(0));
  let runnerClosed = false;
  let runnerOutput = "";
  for (const stream of [runner.stdout, runner.stderr])
    stream.on("data", (bytes) => {
      runnerOutput += bytes;
    });
  const closed = new Promise((resolveClosed, reject) => {
    runner.once("error", reject);
    runner.once("close", (code) => {
      runnerClosed = true;
      resolveClosed(code);
    });
  });
  runner.stdin.end("fixture");
  try {
    // Allow the real bounded Git/evidence checks to finish before this test
    // observes the deliberately held hook; this is not a performance gate.
    const deadline = Date.now() + 120000;
    while (!existsSync(marker) && !runnerClosed && Date.now() < deadline)
      await delay(25);
    assert.ok(existsSync(marker), runnerOutput);
    assert.equal(
      runnerClosed,
      false,
      "parent survives the successful Codex exit"
    );
    const waiting = JSON.parse(readFileSync(stateFile));
    assert.equal(waiting.status, "integrating");
    assert.equal(waiting.finishedAt, null);
    assert.equal(
      existsSync(reportFile),
      false,
      "no premature completion notification"
    );
    const pending = JSON.parse(readFileSync(readFileSync(marker, "utf8")));
    assert.equal(pending.status, "running");
    assert.equal(
      git(repo, "ls-remote", "origin", "refs/heads/main"),
      remoteBefore
    );
  } finally {
    // Also release on assertion failure so fixture children cannot be orphaned.
    writeFileSync(barrier + ".tmp", "19");
    renameSync(barrier + ".tmp", barrier);
    await closed;
  }
  assert.equal(await closed, 1, runnerOutput);
  const hookFailure = JSON.parse(readFileSync(stateFile));
  assert.equal(hookFailure.status, "failed");
  assert.equal(hookFailure.integration.status, "failed");
  assert.match(hookFailure.finalText, /統合結果: failed/);
  assert.match(
    readFileSync(hookFailure.integration.outputLog, "utf8"),
    /fixture pre-push final failure/
  );
  const failureReport = JSON.parse(readFileSync(reportFile));
  assert.equal(
    failureReport.args[failureReport.args.indexOf("--kind") + 1],
    "error"
  );
  assert.equal(
    git(repo, "ls-remote", "origin", "refs/heads/main"),
    remoteBefore
  );
  writeFileSync(hook, '#!/bin/sh\necho "hook final output"\n', { mode: 0o755 });
  run(0);
  const completedRunner = JSON.parse(readFileSync(stateFile));
  assert.equal(completedRunner.status, "completed");
  assert.equal(
    completedRunner.integration.remoteHead,
    git(lane, "rev-parse", "HEAD")
  );
  assert.match(completedRunner.finalText, /統合結果: completed/);
  const successReport = JSON.parse(readFileSync(reportFile));
  assert.equal(
    successReport.args[successReport.args.indexOf("--kind") + 1],
    "completed"
  );
  assert.ok(
    successReport.text.includes(completedRunner.integration.remoteHead)
  );
  assert.equal(git(repo, "symbolic-ref", "--short", "HEAD"), "interactive");
  assert.equal(git(repo, "rev-parse", "HEAD"), primaryHead);
  assert.equal(
    readFileSync(join(repo, "user-work.txt"), "utf8"),
    "preserved interactive work\n"
  );
  assert.equal(
    git(integration, "rev-parse", "HEAD"),
    git(lane, "rev-parse", "HEAD")
  );
  // Even a clean registered main owner must not be accepted without the pin.
  git(integration, "rm", "scripts/full-run-checkouts.json");
  git(integration, "commit", "-m", "fixture removes pin");
  const unconfiguredHead = git(integration, "rev-parse", "HEAD");
  const missingPin = {
    integrationWorktree: integration,
    workdir: lane,
    branch: "lane",
    head: git(lane, "rev-parse", "HEAD"),
    skipFuzz: false,
    outputLog: join(temp, "missing-pin.log"),
  };
  assert.equal(
    await executeAutoMerge(missingPin, {
      env,
      onChild: () => {},
      onProgress: () => {},
    }),
    2
  );
  assert.match(
    readFileSync(missingPin.outputLog, "utf8"),
    /configuration is missing/
  );
  assert.equal(git(integration, "rev-parse", "HEAD"), unconfiguredHead);
  assert.equal(
    git(repo, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
    missingPin.head
  );
  console.log(
    "[test-supervisor-integration] passed: durable parent execution, exact head, real push hook cwd/failure/output/remote confirmation"
  );
} finally {
  if (previousLock === undefined) delete process.env.ORICA_SUPERVISOR_LOCK;
  else process.env.ORICA_SUPERVISOR_LOCK = previousLock;
  rmSync(temp, { recursive: true, force: true });
}
