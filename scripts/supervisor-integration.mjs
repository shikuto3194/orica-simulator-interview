import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { setTimeout, clearTimeout, setImmediate } from "node:timers";
import state from "./harness/verification-state.cjs";
import { observeBlocker } from "./supervisor-followup.mjs";
import {
  inspectGateLease,
  leaseWaitError,
  leaseFailureExit,
  LEASE_WAIT_EXIT,
} from "./harness/gate-lease.mjs";
import { terminateOwnedChild } from "./run-with-lock-heartbeat.mjs";
import {
  integrationCheckout,
  inspectIntegrationCheckout,
  assertFullRunWorker,
} from "./full-run-checkouts.mjs";

function gitEnvironment(input = process.env) {
  const env = { ...input };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return env;
}

function git(workdir, ...args) {
  return execFileSync("git", ["-C", workdir, ...args], {
    env: gitEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  }).trim();
}

// Network reads must not block the runner's heartbeat/progress event loop.
export function readRemoteMain(
  workdir,
  { env = process.env, timeoutMs = 60_000, execute = execFile } = {}
) {
  return new Promise((resolveHead, reject) => {
    execute(
      "git",
      ["-C", workdir, "ls-remote", "origin", "refs/heads/main"],
      {
        env: gitEnvironment(env),
        encoding: "utf8",
        windowsHide: true,
        timeout: timeoutMs,
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error("Remote main verification failed or timed out", {
              cause: error,
            })
          );
        else resolveHead(String(stdout).trim().split(/\s/)[0]);
      }
    );
  });
}

function checkout(ticket) {
  const common = dirname(
    git(
      ticket.workdir,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir"
    )
  );
  if (
    realpathSync(common) !== realpathSync(ticket.repo) ||
    realpathSync(ticket.workdir) === realpathSync(ticket.repo)
  )
    throw new Error("Integration requires a lane in the runner's repository");
  const branch = git(ticket.workdir, "symbolic-ref", "--short", "HEAD");
  if (branch === "main" || git(ticket.workdir, "status", "--porcelain"))
    throw new Error("Integration requires a clean committed lane branch");
  return { branch, head: git(ticket.workdir, "rev-parse", "HEAD") };
}

function processAbsent(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

function publisherExited(request, absent = processAbsent) {
  if (
    !absent(request.ownerPid) ||
    (request.childPid && !absent(request.childPid))
  )
    return false;
  const id = request.attemptId;
  if (!id)
    return (
      request.status === "requested" &&
      !request.childPid &&
      !request.previousAttemptId &&
      !request.attempts?.length
    );
  if (!/^[a-f0-9]{32}$/.test(id)) return false;
  let attempt;
  try {
    attempt = JSON.parse(
      readFileSync(
        join(request.repo, "logs/auto-merge-runs", id + ".json"),
        "utf8"
      )
    );
  } catch (error) {
    if (error.code !== "ENOENT") return false;
    // A missing child record does not prove that spawn never happened. Only a
    // durable parent observation of this attempt's completion closes that gap.
    const completed = request.attempts?.at(-1);
    return (
      request.status === "waiting" &&
      !request.childPid &&
      completed?.id === id &&
      completed.status === "waiting" &&
      completed.exitCode === LEASE_WAIT_EXIT &&
      Number.isFinite(Date.parse(completed.finishedAt))
    );
  }
  return (
    attempt?.schemaVersion === 1 &&
    attempt.id === id &&
    attempt.repo === request.repo &&
    attempt.workdir === request.workdir &&
    attempt.branch === request.branch &&
    attempt.sourceHead === request.head &&
    Number.isInteger(attempt.pid) &&
    attempt.pid > 0 &&
    (!request.childPid || request.childPid === attempt.pid) &&
    ["running", "completed", "failed", "local_only"].includes(attempt.status) &&
    absent(attempt.pid)
  );
}

function assertTicketBinding(request, ticket) {
  for (const key of [
    "schemaVersion",
    "runId",
    "repo",
    "workdir",
    "file",
    "integrationWorktree",
  ])
    if (request[key] !== ticket[key])
      throw new Error("Integration ticket binding changed");
  if (
    !/^[a-f0-9-]{36}$/.test(request.runId) ||
    resolve(request.file) !==
      join(
        resolve(request.repo),
        "logs/supervisor-integrations",
        request.runId + ".json"
      )
  )
    throw new Error("Invalid integration ticket path");
}

async function fetchedRemote(workdir, env, readRemote) {
  const remote = await readRemote(workdir, { env });
  if (!/^[a-f0-9]{40}$/.test(remote || ""))
    throw new Error("Invalid remote main identity");
  await new Promise((ok, fail) =>
    execFile(
      "git",
      [
        "-C",
        workdir,
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "origin",
        remote,
      ],
      { env: gitEnvironment(env), windowsHide: true, timeout: 60000 },
      (error) => (error ? fail(error) : ok())
    )
  );
  return remote;
}

function containsCommit(repo, older, newer) {
  try {
    git(repo, "merge-base", "--is-ancestor", older, newer);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

// This resolves an old ticket from observed remote inclusion, not from worker
// exit zero or a stale local main. It never asserts that the old attempt passed.
export function reconcilePublishedIntegration(request, remote) {
  if (
    !/^[a-f0-9]{40}$/.test(request.head || "") ||
    !containsCommit(request.repo, request.head, remote)
  )
    return false;
  request.resolution = {
    kind: "included_in_remote",
    head: request.head,
    remoteHead: remote,
    previousStatus: request.status,
    previousError: request.error || null,
    observedAt: new Date().toISOString(),
  };
  request.status = "completed";
  request.remoteHead = remote;
  request.exitCode = 0;
  request.finishedAt = request.resolution.observedAt;
  state.atomicJson(request.file, request);
  return true;
}

// Startup calls this under the existing supervisor AND card-impl ownership,
// before lane synchronization or another worker can change the candidate.
export async function resumeIntegrations(
  repo,
  workdir,
  {
    env = process.env,
    readRemote = readRemoteMain,
    complete = completeIntegration,
    observe = observeBlocker,
    absent = processAbsent,
    deferReview = false,
  } = {}
) {
  const targets = assertFullRunWorker(repo, workdir);
  const directory = join(resolve(repo), "logs/supervisor-integrations");
  const pending = (existsSync(directory) ? readdirSync(directory) : [])
    .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")))
    .filter(
      (item) =>
        item.workdir === resolve(workdir) &&
        ["requested", "running", "waiting", "failed"].includes(item.status)
    );
  if (!pending.length) {
    observe({
      repo,
      key: "publication-owner",
      cleared: true,
      text: "No pending publisher.",
    });
    return { action: "continue", resolved: 0 };
  }
  for (const item of pending)
    assertTicketBinding(item, {
      ...item,
      schemaVersion: 1,
      repo: resolve(repo),
      workdir: resolve(workdir),
      integrationWorktree:
        item.status === "failed"
          ? item.integrationWorktree
          : targets.integrationWorktree,
    });
  // A still-live or unidentifiable publisher must not race reconciliation or a
  // new worker, even when the wrapper has recovered its own older lane lock.
  if (
    pending.some(
      (item) =>
        ["requested", "running", "waiting"].includes(item.status) &&
        !publisherExited(item, absent)
    )
  ) {
    observe({
      repo,
      key: "publication-owner",
      text: "公開処理の終了を確認できません。候補を保持して待機します。",
    });
    return { action: "wait", reason: "publication-owner" };
  }
  observe({
    repo,
    key: "publication-owner",
    cleared: true,
    text: "Previous publisher exited.",
  });
  const remote = await fetchedRemote(workdir, env, readRemote);
  let resolved = 0;
  for (const item of pending) {
    if (reconcilePublishedIntegration(item, remote)) {
      resolved++;
      observe({
        repo,
        key: "publication:" + item.runId,
        cleared: true,
        text: `remote ${remote} が候補 ${item.head} を包含。旧失敗の証跡を保持して解決。`,
      });
    }
  }
  const active = pending.filter((item) =>
    ["requested", "running", "waiting"].includes(item.status)
  );
  if (!active.length) return { action: "continue", resolved };
  if (active.length !== 1)
    throw new Error(
      "Multiple pending publications require reconciliation; preserve every candidate"
    );
  const item = active[0];
  if (item.workerExitCode !== 0) {
    item.status = "failed";
    item.exitCode = 1;
    item.error =
      "Worker exited without a durable success receipt; preserve candidate for fresh worker review";
    item.finishedAt = new Date().toISOString();
    state.atomicJson(item.file, item);
    observe({
      repo,
      key: "publication:" + item.runId,
      text: "旧workerの終了は確認できましたが正常終了証跡がありません。候補を保持してworkerによる再確認へ戻します。",
    });
    return { action: "continue", reason: "worker-outcome-unknown", resolved };
  }
  try {
    // This readiness observation must not consume or compete with the actual
    // publication gate's persistent admission. run-gates still queues normally.
    if (await inspectGateLease(workdir))
      throw leaseWaitError("Verification lease is occupied", "VALIDATION_BUSY");
  } catch (error) {
    if (leaseFailureExit(error) !== LEASE_WAIT_EXIT) throw error;
    observe({
      repo,
      key: "publication:" + item.runId,
      text: `候補 ${item.head} の公開は検証lease待ちです。査読証跡と候補を保持し、次回再開します。`,
    });
    return { action: "wait", reason: "validation-lease", resolved };
  }
  const result = await complete(item, {
    resume: true,
    env,
    readRemote,
    deferReview,
  });
  if (result.status === "completed") {
    observe({
      repo,
      key: "publication:" + item.runId,
      cleared: true,
      text: `公開確認: ${result.remoteHead}`,
    });
    return { action: "continue", resolved: resolved + 1 };
  }
  observe({
    repo,
    key: "publication:" + item.runId,
    text: `公開 ${result.status}: ${result.error}\n候補: ${item.head}\n証跡: ${item.file}`,
  });
  // Real gate/review failures return to the existing implementation worker;
  // only resource waits retain the immutable publication candidate.
  return {
    action: result.status === "waiting" ? "wait" : "continue",
    resolved,
  };
}

export function prepareIntegration(repo, workdir) {
  const targets = assertFullRunWorker(repo, workdir);
  const ticket = {
    schemaVersion: 1,
    runId: randomUUID(),
    repo: resolve(repo),
    workdir: resolve(workdir),
    integrationWorktree: targets.integrationWorktree,
    status: "idle",
    ownerPid: process.pid,
  };
  ticket.file = join(
    ticket.repo,
    "logs/supervisor-integrations",
    ticket.runId + ".json"
  );
  state.atomicJson(ticket.file, ticket);
  return ticket;
}

export function requestIntegration(file, workdir, { skipFuzz = false } = {}) {
  if (skipFuzz)
    throw new Error(
      "Full-run integration cannot skip fuzz; review-only scope is selected by the gate manifest"
    );
  if (!file)
    throw new Error(
      "No parent runner integration ticket; use foreground auto-merge and collect its final exit code"
    );
  const ticket = JSON.parse(readFileSync(file, "utf8"));
  if (
    ticket.schemaVersion !== 1 ||
    ticket.status !== "idle" ||
    ticket.file !== resolve(file) ||
    realpathSync(workdir) !== realpathSync(ticket.workdir)
  )
    throw new Error(
      "Integration ticket is already used or belongs to another checkout"
    );
  Object.assign(ticket, checkout(ticket), {
    status: "requested",
    skipFuzz,
    requestedAt: new Date().toISOString(),
  });
  state.atomicJson(file, ticket);
  return ticket;
}

// The runner, not the terminating Codex CLI session, owns this process. Wait for
// close (including flushed output), keep heartbeats alive, and persist failures.
export async function completeIntegration(
  ticket,
  {
    workerExitCode = 0,
    env = process.env,
    onChild = () => {},
    onProgress = () => {},
    execute = executeAutoMerge,
    readRemote = readRemoteMain,
    resume = false,
    deferReview = false,
  } = {}
) {
  const request = JSON.parse(readFileSync(ticket.file, "utf8"));
  if (request.status === "idle") return null;
  if (request.status === "completed") {
    assertTicketBinding(request, ticket);
    return request;
  }
  if (
    resume &&
    ["requested", "running", "waiting"].includes(request.status) &&
    !publisherExited(request)
  )
    throw new Error(
      "Interrupted publisher is still alive or its outcome is unknown"
    );
  let terminalSaved = false;
  let attempted = false;
  request.exitCode = null;
  try {
    assertTicketBinding(request, ticket);
    if (
      !(resume ? ["requested", "waiting", "running"] : ["requested"]).includes(
        request.status
      )
    )
      throw new Error(
        "Integration ticket is not pending; do not replay an interrupted integration blindly"
      );
    if (resume ? request.workerExitCode !== 0 : workerExitCode !== 0)
      throw new Error(
        `Worker failed (exit ${workerExitCode}); integration not started`
      );
    if (request.skipFuzz)
      throw new Error("Full-run integration cannot skip fuzz");
    request.workerExitCode = workerExitCode;
    state.atomicJson(ticket.file, request);
    assertFullRunWorker(ticket.repo, ticket.workdir);
    if (resume) {
      const remote = await fetchedRemote(ticket.workdir, env, readRemote);
      if (reconcilePublishedIntegration(request, remote)) {
        terminalSaved = true;
        return request;
      }
    }
    const current = checkout(ticket);
    if (current.branch !== request.branch || current.head !== request.head)
      throw new Error("Lane changed after integration request");
    const target = inspectIntegrationCheckout(ticket.repo);
    if (
      !target.ready ||
      target.integrationWorktree !== ticket.integrationWorktree
    )
      throw new Error("Main integration checkout changed or is unavailable");
    request.status = "running";
    request.workerExitCode = workerExitCode;
    request.ownerPid = process.pid;
    request.childPid = null;
    // The exit check above must succeed before selecting an earlier checkpoint.
    // A missing current attempt alone never proves that spawn did not happen.
    request.previousAttemptId =
      [
        request.attemptId,
        ...(request.attempts || []).map((item) => item.id).reverse(),
        request.previousAttemptId,
      ].find(
        (id) =>
          /^[a-f0-9]{32}$/.test(id || "") &&
          existsSync(join(ticket.repo, "logs/auto-merge-runs", id + ".json"))
      ) || null;
    request.attemptId = randomUUID().replaceAll("-", "");
    request.startedAt ||= new Date().toISOString();
    delete request.error;
    delete request.finishedAt;
    request.outputLog = join(
      ticket.repo,
      "logs/supervisor-integrations",
      ticket.runId + "." + request.attemptId + ".log"
    );
    request.attempts ||= [];
    request.attempts.push({
      id: request.attemptId,
      startedAt: new Date().toISOString(),
      outputLog: request.outputLog,
    });
    attempted = true;
    state.atomicJson(ticket.file, request);
    onProgress(
      `integration running: ${request.head}; log=${request.outputLog}`
    );
    request.exitCode = await execute(request, {
      env,
      deferReview,
      onProgress,
      onChild: (child) => {
        request.childPid = child?.pid || null;
        state.atomicJson(ticket.file, request);
        onChild(child);
      },
    });
    if (request.exitCode !== 0)
      throw new Error(
        `auto-merge failed (exit ${request.exitCode}); see ${request.outputLog}`
      );
    const receiptPath = request.outputLog + ".result.json";
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    } catch {
      throw new Error(
        "Integration returned success without matching publication receipt"
      );
    }
    if (
      receipt.schemaVersion !== 2 ||
      typeof receipt.publicationGuard !== "string" ||
      !receipt.publicationGuard ||
      receipt.sourceHead !== request.head ||
      receipt.workdir !== request.workdir ||
      !/^[a-f0-9]{40}$/.test(receipt.head) ||
      git(ticket.repo, "rev-parse", receipt.head + "^{tree}") !== receipt.tree
    )
      throw new Error("Integration publication receipt binding changed");
    const attempt = JSON.parse(
      readFileSync(
        join(ticket.repo, "logs/auto-merge-runs", receipt.attemptId + ".json"),
        "utf8"
      )
    );
    if (
      attempt.status !== "completed" ||
      attempt.head !== receipt.head ||
      attempt.sourceHead !== request.head ||
      attempt.workdir !== request.workdir
    )
      throw new Error("Integration publication attempt binding changed");
    git(ticket.repo, "merge-base", "--is-ancestor", request.head, receipt.head);
    const remote = await readRemote(ticket.workdir, { env });
    if (remote !== receipt.head) {
      await new Promise((ok, fail) =>
        execFile(
          "git",
          [
            "-C",
            ticket.workdir,
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            "origin",
            remote,
          ],
          { env: gitEnvironment(env), windowsHide: true, timeout: 60000 },
          (error) => (error ? fail(error) : ok())
        )
      );
      git(ticket.repo, "merge-base", "--is-ancestor", receipt.head, remote);
    }
    if (
      git(ticket.repo, "rev-parse", "refs/heads/main") !== receipt.head ||
      !inspectIntegrationCheckout(ticket.repo).ready ||
      integrationCheckout(ticket.repo).integrationWorktree !==
        ticket.integrationWorktree
    )
      throw new Error(
        "Integration returned success without matching local and remote main"
      );
    if (receipt.publicationGuard !== attempt.publicationGuard)
      throw new Error("Integration publication guard binding changed");
    const { runMergeLockedCommand } = await import("./verifier-write-lock.mjs");
    let guardError = "";
    const guardCode = await runMergeLockedCommand({
      label: "integration-receipt " + ticket.runId,
      command: process.execPath,
      args: [
        fileURLToPath(
          new URL("./remote-main-integration.mjs", import.meta.url)
        ),
        "publication-guard",
        receipt.publicationGuard,
        JSON.stringify({
          attemptId: receipt.attemptId,
          workdir: request.workdir,
          sourceHead: request.head,
          publishedHead: receipt.head,
        }),
      ],
      env,
      onChild,
      onStderr: (text) => {
        guardError = (guardError + text).slice(-2000);
      },
      onSuccess: () => {
        request.publishedHead = receipt.head;
        request.publicationVerified = true;
        request.validatedTree = receipt.tree;
        request.remoteHead = remote;
        request.status = "completed";
        request.finishedAt = new Date().toISOString();
        Object.assign(request.attempts.at(-1), {
          finishedAt: request.finishedAt,
          status: request.status,
          exitCode: 0,
        });
        state.atomicJson(ticket.file, request);
        terminalSaved = true;
      },
    });
    if (guardCode !== 0)
      throw new Error(
        "Final integration publication guard failed (exit " +
          guardCode +
          "): " +
          guardError.trim()
      );
  } catch (error) {
    terminalSaved = false;
    request.status =
      request.exitCode === LEASE_WAIT_EXIT ? "waiting" : "failed";
    request.exitCode = request.exitCode || 1;
    request.error = error.message;
  } finally {
    onChild(null);
    if (!terminalSaved) {
      request.finishedAt = new Date().toISOString();
      const attempt = request.attempts?.at(-1);
      if (attempted && attempt?.id === request.attemptId)
        Object.assign(attempt, {
          finishedAt: request.finishedAt,
          status: request.status,
          exitCode: request.exitCode,
          error: request.error || null,
        });
      state.atomicJson(ticket.file, request);
    }
  }
  onProgress(
    `integration ${request.status}: ${request.error || request.remoteHead}`
  );
  return request;
}

export function executeAutoMerge(
  request,
  {
    env,
    deferReview = false,
    onChild = () => {},
    onProgress = () => {},
    spawnProcess = spawn,
    writeLog = writeSync,
    closeLog = closeSync,
    output = process.stdout,
  }
) {
  return new Promise((resolveExit, reject) => {
    const fd = openSync(request.outputLog, "w");
    let child;
    try {
      child = spawnProcess(
        "pwsh",
        [
          "-NoProfile",
          "-File",
          join(request.integrationWorktree, "scripts/auto-merge.ps1"),
          "-Branch",
          request.branch,
          "-Worktree",
          request.workdir,
          "-ExpectedHead",
          request.head,
          "-ResultFile",
          request.outputLog + ".result.json",
          ...(request.attemptId ? ["-AttemptId", request.attemptId] : []),
          ...(request.previousAttemptId
            ? ["-ResumeAttempt", request.previousAttemptId]
            : []),
          ...(request.skipFuzz ? ["-SkipFuzz"] : []),
          ...(deferReview ? ["-DeferReview"] : []),
        ],
        {
          cwd: request.workdir,
          env,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (value) {
      closeLog(fd);
      reject(value);
      return;
    }
    let error;
    let forceStop;
    let childClosed = false;
    let childResult;
    let pendingWrites = 0;
    let finishing = false;
    const finish = () => {
      if (!childClosed || pendingWrites || finishing) return;
      finishing = true;
      // Writable emits an error after delivering its failed write callbacks.
      // Keep the listener through that turn, including errors after child close.
      setImmediate(() => {
        output.off("error", failOutput);
        if (error) reject(error);
        else resolveExit(childResult);
      });
    };
    const failOutput = (value) => {
      if (error) return;
      error = new Error(
        `Integration output could not be preserved: ${value.message}`,
        { cause: value }
      );
      // A delayed stream error must not target an exited/reused process ID.
      if (childClosed || child.exitCode !== null || child.signalCode !== null)
        return;
      if (process.platform !== "win32" && child.pid) {
        // Give nested heartbeat helpers time to stop their own process groups.
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (signalError) {
          if (signalError.code !== "ESRCH")
            error.message += `; child signal failed: ${signalError.message}`;
        }
        forceStop = setTimeout(
          () => terminateOwnedChild(child, { processGroup: true }),
          5000
        );
      } else {
        const stopped = terminateOwnedChild(child);
        if (!stopped.stopped)
          error.message += `; child cleanup failed: ${stopped.error || "unknown"}`;
      }
    };
    output.on("error", failOutput);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (bytes) => {
        if (error) return;
        try {
          let offset = 0;
          while (offset < bytes.length) {
            const written = writeLog(fd, bytes, offset, bytes.length - offset);
            if (!Number.isInteger(written) || written <= 0)
              throw new Error("Integration log write made no progress");
            offset += written;
          }
          pendingWrites++;
          let delivered = false;
          const written = (value) => {
            if (delivered) return;
            delivered = true;
            pendingWrites--;
            if (value) failOutput(value);
            finish();
          };
          try {
            output.write(bytes, written);
          } catch (value) {
            written(value);
          }
          for (const line of bytes.toString().split(/\r?\n/))
            if (/^\[(?:auto-merge|verify)\]/.test(line))
              onProgress(line.slice(0, 500));
        } catch (value) {
          failOutput(value);
        }
      });
    child.on("error", (value) => {
      error ||= value;
    });
    child.on("close", (code, signal) => {
      clearTimeout(forceStop);
      childClosed = true;
      childResult = signal ? 1 : (code ?? 1);
      // The later asynchronous remote check must not leave a reaped child PID
      // registered as the runner's active integration process.
      try {
        onChild(null);
      } catch (value) {
        error ||= value;
      }
      try {
        closeLog(fd);
      } catch (value) {
        error ||= value;
      }
      finish();
    });
    try {
      onChild(child);
    } catch (value) {
      failOutput(value);
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === "resume") {
      const args = process.argv.slice(3);
      const value = (key) => {
        const i = args.indexOf(key);
        if (i < 0 || !args[i + 1]) throw new Error("Missing " + key);
        return args[i + 1];
      };
      for (const [lane, flag] of [
        ["supervisor", "--supervisor-token"],
        ["card-impl", "--card-token"],
      ])
        execFileSync(
          process.execPath,
          [
            fileURLToPath(new URL("./supervisor-lock.mjs", import.meta.url)),
            "refresh",
            "--lane",
            lane,
            "--token",
            value(flag),
          ],
          { env: process.env, windowsHide: true, stdio: "pipe" }
        );
      const result = await resumeIntegrations(
        value("--repo"),
        value("--workdir"),
        { deferReview: args.includes("--defer-review") }
      );
      console.log(JSON.stringify(result));
      process.exitCode = result.action === "wait" ? LEASE_WAIT_EXIT : 0;
    } else {
      if (
        process.argv[2] !== "request" ||
        process.argv.slice(3).some((arg) => arg !== "--skip-fuzz")
      )
        throw new Error(
          "Usage: supervisor-integration.mjs request [--skip-fuzz]"
        );
      console.log(
        JSON.stringify(
          requestIntegration(
            process.env.ORICA_INTEGRATION_REQUEST,
            process.cwd(),
            { skipFuzz: process.argv.includes("--skip-fuzz") }
          ),
          null,
          2
        )
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
