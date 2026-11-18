#!/usr/bin/env node
/**
 * worker-codex-stream の自動 heartbeat と lock-loss fail-closed 回帰テスト。
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { enqueueFollowup } from "./supervisor-followup.mjs";
import { runInNewContext } from "node:vm";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const lockScript = join(scriptDir, "supervisor-lock.mjs");
const runnerScript = join(scriptDir, "worker-codex-stream.mjs");
// Evaluate the actual termination boundary without sending OS signals. A child
// may have emitted exit while its inherited streams still delay close.
const terminationSource = readFileSync(runnerScript, "utf8").match(
  /function terminateChildTree\(\) \{[\s\S]*?\n\}/
)[0];
for (const [exitCode, signalCode, expectedCalls] of [
  [0, null, 0],
  [1, null, 0],
  [null, "SIGTERM", 0],
  [null, null, 1],
]) {
  let stops = 0;
  const terminate = runInNewContext(`(${terminationSource})`, {
    activeChild: { pid: 123, exitCode, signalCode },
    process: { platform: "win32" },
    spawnSync: () => {
      stops++;
    },
  });
  terminate();
  if (stops !== expectedCalls)
    throw new Error("runner termination targeted an exited child");
}
const reportScript = join(scriptDir, "supervisor-report.mjs");
const sanitizeScript = join(scriptDir, "telegram-secret-sanitize.mjs");
const temp = mkdtempSync(join(tmpdir(), "orica-supervisor-runner-test-"));
const lockPath = join(temp, "lock.json");
const statePath = join(temp, "state.json");
const mainTree = join(temp, "main");
const workerTree = join(temp, "lane");
const fakeJs = join(temp, "fake-codex.mjs");
const fakeCommand =
  process.platform === "win32"
    ? join(temp, "fake-codex.cmd")
    : join(temp, "fake-codex.sh");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function lockCommand(args) {
  return spawnSync(process.execPath, [lockScript, ...args], {
    env: { ...process.env, ORICA_SUPERVISOR_LOCK: lockPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
}

const runnerCompletions = new WeakMap();

function startRunner(token, delayMs, options = {}) {
  const child = spawn(
    process.execPath,
    [
      runnerScript,
      "--label",
      options.label || "runner-lock-test",
      "--repo",
      temp,
      "--workdir",
      options.workdir || temp,
      "--codex",
      fakeCommand,
      "--sandbox",
      "read-only",
      "--state-file",
      statePath,
      "--lock-script",
      lockScript,
      "--lock-token",
      token,
      "--lock-lane",
      "supervisor",
      "--lock-heartbeat-seconds",
      "10",
      ...(options.followupId ? ["--followup-id", options.followupId] : []),
    ],
    {
      env: {
        ...process.env,
        ...options.env,
        ORICA_SUPERVISOR_LOCK: lockPath,
        ORICA_SUPERVISOR_RUN_LOG: join(
          temp,
          "logs/supervisor-runs/current.log"
        ),
        ORICA_SUPERVISOR_REPORT_NO_RELAY: "1",
        ORICA_CODEX_FULL_RUN: options.env?.ORICA_CODEX_FULL_RUN || "0",
        ORICA_FULL_RUN_WORKER_REF: options.env?.ORICA_FULL_RUN_WORKER_REF || "",
        FAKE_CODEX_DELAY_MS: String(delayMs),
        ...(options.argsPath ? { FAKE_CODEX_ARGS_PATH: options.argsPath } : {}),
        ...(options.envPath ? { FAKE_CODEX_ENV_PATH: options.envPath } : {}),
      },
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const completion = {
    label: options.label || token,
    closed: false,
    code: null,
    error: null,
    output: "",
  };
  runnerCompletions.set(child, completion);
  child.on("close", (code) => {
    completion.closed = true;
    completion.code = code;
  });
  child.on("error", (error) => {
    completion.error = error;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      completion.output = (completion.output + String(chunk)).slice(-4000);
    });
  child.stdin.end("runner lock test", "utf8");
  return child;
}

function waitForClose(child, timeoutMs) {
  // Capture close at spawn time: heartbeat checks intentionally observe the
  // runner later, possibly after the OS has already delivered its close event.
  const completion = runnerCompletions.get(child);
  if (completion.error) return Promise.reject(completion.error);
  if (completion.closed) return Promise.resolve(completion.code);
  return new Promise((resolve, reject) => {
    const finish = (error, code) => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error);
      else resolve(code);
    };
    const onError = (error) => finish(error);
    const onClose = (code) => finish(null, code);
    const timer = setTimeout(() => {
      finish(
        new Error(
          `${completion.label} did not close within ${timeoutMs}ms; exit=${child.exitCode}; signal=${child.signalCode}\n${completion.output}`
        )
      );
    }, timeoutMs);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmTempWithRetry(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
      sleepSync(250);
    }
  }
  console.warn(
    `[test-supervisor-runner-lock] cleanup skipped: ${lastError?.code || "error"} ${path}`
  );
}

function readOutboxPayloads() {
  const outbox = join(temp, "logs", "codex-hub-outbox");
  if (!existsSync(outbox)) return [];
  return readdirSync(outbox)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(outbox, name), "utf8")));
}

async function main() {
  try {
    mkdirSync(join(temp, "scripts"), { recursive: true });
    copyFileSync(reportScript, join(temp, "scripts", "supervisor-report.mjs"));
    copyFileSync(
      join(scriptDir, "supervisor-followup.mjs"),
      join(temp, "scripts", "supervisor-followup.mjs")
    );
    copyFileSync(
      sanitizeScript,
      join(temp, "scripts", "telegram-secret-sanitize.mjs")
    );

    writeFileSync(
      fakeJs,
      [
        'import { writeFileSync } from "node:fs";',
        'if (process.env.FAKE_CODEX_ARGS_PATH) writeFileSync(process.env.FAKE_CODEX_ARGS_PATH, JSON.stringify(process.argv.slice(2)), "utf8");',
        'if (process.env.FAKE_CODEX_ENV_PATH) writeFileSync(process.env.FAKE_CODEX_ENV_PATH, JSON.stringify({fullRun:process.env.ORICA_CODEX_FULL_RUN,model:process.env.ORICA_CODEX_MODEL,effort:process.env.ORICA_CODEX_REASONING_EFFORT,cli:process.env.ORICA_CODEX_CLI,workerRef:process.env.ORICA_FULL_RUN_WORKER_REF,gitOverrides:Object.keys(process.env).filter(k => /^GIT_/i.test(k))}), "utf8");',
        'const delay = Number(process.env.FAKE_CODEX_DELAY_MS || "0");',
        "await new Promise((resolve) => setTimeout(resolve, delay));",
        'console.log(JSON.stringify({type:"thread.started",thread_id:"fake-thread"}));',
        'console.log(JSON.stringify({type:"item.completed",item:{id:"item-1",type:"agent_message",text:"FAKE_OK"}}));',
        'console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}));',
      ].join("\n"),
      "utf8"
    );
    if (process.platform === "win32") {
      writeFileSync(
        fakeCommand,
        `@echo off\r\n"${process.execPath}" "${fakeJs}" %*\r\n`,
        "utf8"
      );
    } else {
      writeFileSync(
        fakeCommand,
        `#!/bin/sh\n"${process.execPath}" "${fakeJs}" "$@"\n`,
        { encoding: "utf8", mode: 0o755 }
      );
    }

    const defaultArgsToken = "runner-default-args-owner";
    const defaultArgsPath = join(temp, "default-args.json");
    assert(
      lockCommand([
        "acquire",
        "--token",
        defaultArgsToken,
        "--label",
        "default-args-test",
      ]).status === 0,
      "default-args acquire failed"
    );
    const followup = enqueueFollowup({
      repo: temp,
      kind: "instruction",
      text: "user repair",
    });
    const defaultArgsRunner = startRunner(defaultArgsToken, 0, {
      followupId: followup.id,
      argsPath: defaultArgsPath,
      env: {
        ORICA_CODEX_DISABLE_REMOTE_COMPACTION_V2: "1",
      },
    });
    assert(
      (await waitForClose(defaultArgsRunner, 10000)) === 0,
      "default-args runner did not complete successfully"
    );
    assert(
      (await waitForClose(defaultArgsRunner, 100)) === 0,
      "a runner that already closed must retain its completion result"
    );
    const defaultArgs = JSON.parse(readFileSync(defaultArgsPath, "utf8"));
    const activity = JSON.parse(
      readFileSync(
        join(
          temp,
          "logs/codex-supervisor-followups/activity",
          `${followup.id}.json`
        ),
        "utf8"
      )
    );
    assert(
      activity.threadId === "fake-thread" &&
        activity.startedAt &&
        activity.finishedAt,
      "actual runner records selected task start and exit"
    );
    assert(
      activity.status === "pending",
      "runner success alone must not resolve a user request"
    );
    assert(
      !defaultArgs.includes("remote_compaction_v2"),
      "deprecated remote_compaction_v2 env unexpectedly changed CLI defaults"
    );
    assert(
      lockCommand(["release", "--token", defaultArgsToken]).status === 0,
      "default-args owner release failed"
    );

    const git = (...gitArgs) =>
      execFileSync("git", ["-C", temp, ...gitArgs], { stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.name", "Runner fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(temp, ".gitignore"), "*\n");
    const configPath = join(temp, "scripts/full-run-checkouts.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        workerWorktree: "lane",
        workerRef: "refs/heads/runner-lane",
        integrationWorktree: "main",
        integrationRef: "refs/heads/main",
      })
    );
    git("add", "-f", ".gitignore", "scripts/full-run-checkouts.json");
    git("commit", "-m", "Pinned runner fixture");
    git("switch", "-c", "interactive");
    git("worktree", "add", mainTree, "main");
    git("worktree", "add", "-b", "runner-lane", workerTree);
    const mainConfig = join(mainTree, "scripts/full-run-checkouts.json");
    const configText = readFileSync(mainConfig, "utf8");
    rmSync(mainConfig);
    const refused = startRunner("unused-refused-owner", 0, {
      label: "supervisor",
      workdir: workerTree,
    });
    assert(
      (await waitForClose(refused, 10000)) !== 0,
      "missing full-run configuration must refuse launch"
    );
    writeFileSync(mainConfig, configText);
    const wrongLane = startRunner("unused-refused-owner", 0, {
      label: "supervisor",
    });
    assert(
      (await waitForClose(wrongLane, 10000)) !== 0,
      "interactive checkout must refuse full-run launch"
    );

    for (const [
      name,
      label,
      inheritedFullRun,
      expectedModel,
      expectedEffort,
    ] of [
      [
        "sync-recovery",
        "supervisor-sync-recovery",
        "0",
        "gpt-6.1-sol",
        "xhigh",
      ],
      ["supervisor", "supervisor", "0", "gpt-6.1-sol", "xhigh"],
      ["full-run-child", "runner-lock-test", "1", "gpt-6.1-sol", "xhigh"],
      ["unrelated-worker", "runner-lock-test", "0", "gpt-5.6-terra", "high"],
    ]) {
      const token = `model-policy-${name}`;
      const argsPath = join(temp, `${name}-args.json`);
      const envPath = join(temp, `${name}-env.json`);
      assert(
        lockCommand(["acquire", "--token", token, "--label", name]).status ===
          0,
        `${name} acquire failed`
      );
      const child = startRunner(token, 0, {
        label,
        workdir: name === "unrelated-worker" ? temp : workerTree,
        argsPath,
        envPath,
        env: {
          ORICA_CODEX_FULL_RUN: inheritedFullRun,
          ORICA_CODEX_MODEL: "gpt-5.6-terra",
          ORICA_CODEX_REASONING_EFFORT: "high",
          ...(name !== "unrelated-worker"
            ? { GIT_DIR: join(temp, ".git"), GIT_WORK_TREE: temp }
            : {}),
        },
      });
      assert(
        (await waitForClose(child, 10000)) === 0,
        `${name} runner did not complete successfully`
      );
      const cliArgs = JSON.parse(readFileSync(argsPath, "utf8"));
      const childEnv = JSON.parse(readFileSync(envPath, "utf8"));
      const modelState = JSON.parse(readFileSync(statePath, "utf8"));
      assert(
        modelState.runLog === join(temp, "logs/supervisor-runs/current.log"),
        name + " records the current wrapper log"
      );
      assert(
        cliArgs[cliArgs.indexOf("-m") + 1] === expectedModel,
        `${name} CLI model`
      );
      assert(
        cliArgs.some(
          (arg) =>
            arg === `model_reasoning_effort="${expectedEffort}"` ||
            arg === `model_reasoning_effort=${expectedEffort}`
        ),
        `${name} CLI reasoning effort`
      );
      assert(childEnv.model === expectedModel, `${name} inherited model`);
      assert(childEnv.effort === expectedEffort, `${name} inherited effort`);
      if (name !== "unrelated-worker") {
        assert(childEnv.cli === fakeCommand, `${name} inherited CLI`);
        assert(
          childEnv.workerRef === "refs/heads/runner-lane",
          `${name} inherited pinned lane`
        );
        assert(
          childEnv.gitOverrides.length === 0,
          `${name} Git overrides must not reach the child`
        );
      }
      assert(
        childEnv.fullRun === (name === "unrelated-worker" ? "0" : "1"),
        `${name} inherited full-run scope`
      );
      assert(modelState.model === expectedModel, `${name} recorded model`);
      if (label === "supervisor") {
        assert(
          typeof modelState.runId === "string" &&
            /^[a-f0-9-]{36}$/.test(modelState.runId),
          "supervisor records actual metrics run ID"
        );
        const metrics = JSON.parse(
          readFileSync(
            join(temp, "logs/supervisor-runs", modelState.runId + ".json"),
            "utf8"
          )
        );
        assert(
          metrics.runId === modelState.runId &&
            metrics.startedAt === modelState.startedAt,
          "supervisor state is bound to actual metrics"
        );
        assert(
          modelState.runnerPid === child.pid,
          "supervisor records actual runner PID"
        );
        assert(
          modelState.workdir === workerTree && metrics.workdir === workerTree,
          "supervisor records actual workdir"
        );
        const ticket = JSON.parse(
          readFileSync(modelState.integrationRequest, "utf8")
        );
        assert(
          ticket.file === modelState.integrationRequest &&
            ticket.workdir === modelState.workdir,
          "supervisor records its own integration ticket"
        );
      } else if (name !== "unrelated-worker") {
        assert(
          typeof modelState.runId === "string" &&
            /^[a-f0-9-]{36}$/.test(modelState.runId),
          "unmeasured full-run worker still has a recovery identity"
        );
        assert(
          !existsSync(
            join(temp, "logs/supervisor-runs", modelState.runId + ".json")
          ),
          "recovery identity does not fabricate metrics"
        );
      } else {
        assert(
          modelState.runId === null,
          "unmeasured worker does not fabricate a run ID"
        );
      }
      assert(
        modelState.reasoningEffort === expectedEffort,
        `${name} recorded effort`
      );
      assert(
        lockCommand(["release", "--token", token]).status === 0,
        `${name} owner release failed`
      );
    }

    const heartbeatToken = "runner-heartbeat-owner";
    const acquired = lockCommand([
      "acquire",
      "--token",
      heartbeatToken,
      "--label",
      "heartbeat-test",
    ]);
    assert(
      acquired.status === 0,
      `heartbeat acquire failed: ${acquired.stderr}`
    );
    const before = statSync(lockPath).mtimeMs;
    const heartbeatRunner = startRunner(heartbeatToken, 13000);
    // The first refresh includes runner startup and the lock subprocess. A
    // fixed 11s read races the 10s timer (observed refresh: startup + 11.04s).
    // Require the actual update while the runner lives, with a bounded wait.
    const heartbeatDeadline = Date.now() + 20000;
    while (
      statSync(lockPath).mtimeMs <= before &&
      Date.now() < heartbeatDeadline
    ) {
      const completion = runnerCompletions.get(heartbeatRunner);
      assert(
        !completion.closed && !completion.error,
        `heartbeat runner ended before refresh: ${completion.code}; ${completion.output}`
      );
      await sleep(100);
    }
    const after = statSync(lockPath).mtimeMs;
    assert(after > before, "runner did not refresh lock heartbeat");
    assert(
      (await waitForClose(heartbeatRunner, 10000)) === 0,
      "heartbeat runner did not complete successfully"
    );
    assert(
      lockCommand(["release", "--token", heartbeatToken]).status === 0,
      "heartbeat owner release failed"
    );

    const lostToken = "runner-lock-loss-owner";
    assert(
      lockCommand([
        "acquire",
        "--token",
        lostToken,
        "--label",
        "lock-loss-test",
      ]).status === 0,
      "lock-loss acquire failed"
    );
    const lostRunner = startRunner(lostToken, 30000);
    await sleep(1000);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.token = "replacement-owner-token";
    lock.label = "replacement-owner";
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const lostCode = await waitForClose(lostRunner, 35000);
    assert(lostCode === 3, `lock-loss runner exit was ${lostCode}, expected 3`);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert(state.status === "lock_lost", `state was ${state.status}`);
    assert(
      state.recentEvents.some((event) =>
        event.text.includes("lock heartbeat failed")
      ),
      "lock-loss event was not recorded"
    );
    const errorReport = readOutboxPayloads().find(
      (payload) => payload.kind === "error"
    );
    assert(errorReport, "lock-loss error report was not queued");
    assert(
      errorReport.text.includes(
        "runner-lock-test lost supervisor lock ownership"
      ),
      "error report did not include lock-loss headline"
    );
    assert(
      errorReport.text.includes("- status: lock_lost"),
      "error report did not include structured status"
    );
    assert(
      errorReport.text.includes("直近イベント:"),
      "error report did not include recent events"
    );
    assert(
      errorReport.text.includes("lock heartbeat failed"),
      "error report did not include the heartbeat failure detail"
    );
    assert(
      lockCommand(["release", "--token", "replacement-owner-token"]).status ===
        0,
      "replacement owner release failed"
    );

    console.log("[test-supervisor-runner-lock] passed");
  } finally {
    rmTempWithRetry(temp);
  }
}

main().catch((error) => {
  console.error(`[test-supervisor-runner-lock] failed: ${error.message}`);
  process.exit(1);
});
