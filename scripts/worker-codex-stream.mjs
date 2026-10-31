#!/usr/bin/env node
/**
 * headless Codex worker を JSONL で起動し、状態をローカルファイルへ保存する。
 * 15秒ごとの live progress は Telegram の同一メッセージを edit し、
 * 完了時は同じメッセージを編集し、outboxは配信receiptを共有して重複送信を防ぐ。
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { recordFollowupRun, observeBlocker } from "./supervisor-followup.mjs";
import { assertFullRunWorker } from "./full-run-checkouts.mjs";
import {
  inspectWorkerRecovery,
  preserveWorkerWork,
} from "./supervisor-work-recovery.mjs";
import {
  prepareIntegration,
  completeIntegration,
} from "./supervisor-integration.mjs";
import {
  deliveryPath,
  writeDelivery,
  formatCompletionText,
} from "./worker-telegram-delivery.mjs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline";
import { clearInterval, setInterval } from "node:timers";
import {
  beginRunMetrics,
  finishRunMetrics,
} from "./supervisor-run-metrics.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function argValues(name) {
  const values = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === name) values.push(args[i + 1]);
  }
  return values;
}

const label = argValue("--label", "worker");
const telegramMessageId = argValue("--telegram-message-id", null);
let followupIds = argValues("--followup-id");
let auditForFollowupIds = argValues("--audit-for-followup-id");
if (
  [...followupIds, ...auditForFollowupIds].some(
    (id) => !/^followup-[0-9a-f]{20}$/.test(id)
  )
)
  throw new Error("Invalid follow-up ID");
const repo = resolve(argValue("--repo", process.cwd()));
// --workdir は codex の cwd（=worktree）。--repo は scripts/state/hub の解決基点（=primary）。
// 両者を分けないと、headless codex が相対パス編集で primary tree を汚し auto-merge を全ブロックする
// (worker-claude-stream.mjs と同型の対策)。
const workdir = resolve(argValue("--workdir", repo));
let pinnedWorkerRef = argValue(
  "--worker-ref",
  process.env.ORICA_FULL_RUN_WORKER_REF || null
);
const codex = argValue("--codex", process.env.ORICA_CODEX_CLI || "codex");
// Full-run policy also follows child runners; unrelated workers retain their defaults.
const fullRunWorker =
  label === "supervisor" ||
  label === "supervisor-sync-recovery" ||
  process.env.ORICA_CODEX_FULL_RUN === "1";
const routineReception =
  !fullRunWorker && telegramMessageId && args.includes("--routine-reception");
if (fullRunWorker || pinnedWorkerRef) {
  for (const key of Object.keys(process.env))
    if (/^GIT_/i.test(key)) delete process.env[key];
  const targets = assertFullRunWorker(repo, workdir);
  if (pinnedWorkerRef && targets.workerRef !== pinnedWorkerRef)
    throw new Error("Child runner worker ref binding changed");
  pinnedWorkerRef = targets.workerRef;
  process.env.ORICA_FULL_RUN_WORKER_REF = pinnedWorkerRef;
}
const codexModel = fullRunWorker
  ? "gpt-6.1-sol"
  : process.env.ORICA_CODEX_MODEL || "gpt-5.6-terra";
const codexReasoningEffort = fullRunWorker
  ? "xhigh"
  : process.env.ORICA_CODEX_REASONING_EFFORT || "xhigh";
if (fullRunWorker) {
  // Process-local only: every child inherits the same model without changing user defaults.
  process.env.ORICA_CODEX_FULL_RUN = "1";
  process.env.ORICA_CODEX_CLI = codex;
  process.env.ORICA_CODEX_MODEL = codexModel;
  process.env.ORICA_CODEX_REASONING_EFFORT = codexReasoningEffort;
}
const codexVerbosity = process.env.ORICA_CODEX_VERBOSITY || "medium";
const promptFile = argValue("--prompt-file", null);
const sandbox = argValue("--sandbox", "danger-full-access");
const lockScript = argValue("--lock-script", null);
const lockToken = argValue("--lock-token", null);
const lockLane = argValue("--lock-lane", "supervisor");
const lockPath = argValue("--lock-path", null);
const lockHeartbeatSeconds = Number(
  argValue("--lock-heartbeat-seconds", "300")
);
const progressIntervalSeconds = Number(
  argValue(
    "--progress-interval-seconds",
    process.env.ORICA_TELEGRAM_PROGRESS_INTERVAL_SECONDS || "15"
  )
);
const liveProgressEnabled =
  process.env.ORICA_TELEGRAM_LIVE_PROGRESS !== "0" &&
  progressIntervalSeconds > 0;
const extraLocks = [];
const extraLockLanes = argValues("--extra-lock-lane");
const extraLockTokens = argValues("--extra-lock-token");
for (
  let i = 0;
  i < Math.min(extraLockLanes.length, extraLockTokens.length);
  i++
) {
  if (extraLockLanes[i] && extraLockTokens[i]) {
    extraLocks.push({ lane: extraLockLanes[i], token: extraLockTokens[i] });
  }
}
const stateFile = resolve(
  argValue("--state-file", join(repo, "logs", "codex-supervisor-state.json"))
);
let prompt = promptFile
  ? readFileSync(promptFile, "utf8")
  : readFileSync(0, "utf8");

if (!prompt.trim()) {
  console.error("[worker-codex-stream] prompt is empty");
  process.exit(1);
}
if ((lockScript && !lockToken) || (!lockScript && lockToken)) {
  console.error(
    "[worker-codex-stream] --lock-script and --lock-token must be specified together"
  );
  process.exit(1);
}
if (extraLocks.length > 0 && !lockScript) {
  console.error("[worker-codex-stream] extra locks require --lock-script");
  process.exit(1);
}

const startedAt = new Date().toISOString();
// Admit only clean work or an exact checkpoint from an exited owner. A new
// worker must never acquire authorship of unexplained dirty files by exiting.
if (fullRunWorker) await inspectWorkerRecovery(repo, workdir);
let runMetrics = null;
if (label === "supervisor") {
  try {
    runMetrics = beginRunMetrics({
      repo,
      workdir,
      startedAt,
      runId: randomUUID(),
    });
  } catch (error) {
    process.stderr.write(
      `[metrics] cannot start measurement: ${error.message}\n`
    );
  }
}
const workerDeliveryFile = deliveryPath(stateFile, randomUUID());
const integrationTicket =
  label === "supervisor" ||
  (label === "supervisor-sync-recovery" && pinnedWorkerRef)
    ? prepareIntegration(repo, workdir)
    : null;
const delivery = {
  pid: process.pid,
  status: "running",
  updatedAt: startedAt,
  messageId: null,
  finalDelivered: false,
};
if (workerDeliveryFile) {
  mkdirSync(dirname(workerDeliveryFile), { recursive: true });
  writeDelivery(workerDeliveryFile, delivery);
}
const state = {
  schemaVersion: 1,
  runId:
    runMetrics?.metrics?.runId ||
    (fullRunWorker || followupIds.length ? randomUUID() : null),
  followupIds,
  runnerPid: process.pid,
  workdir,
  runLog: process.env.ORICA_SUPERVISOR_RUN_LOG || null,
  integrationRequest: integrationTicket?.file || null,
  label,
  model: codexModel,
  reasoningEffort: codexReasoningEffort,
  status: "running",
  threadId: null,
  startedAt,
  updatedAt: startedAt,
  finishedAt: null,
  exitCode: null,
  finalText: "",
  usage: null,
  recentEvents: [],
};

// Windows では他プロセス (AV / file watcher / 別 worker / Get-Content) が state ファイルを
// 開いていると rename が EPERM で失敗する。2026-06-21 supervisor run で発生 → node worker crash →
// Codex Rust 親が壊れた stdout への panic → セッション abort の連鎖あり。失敗を log のみで
// 飲み込み、後続イベントで再書込みされるのに任せる方が連鎖切断には有効。
function writeState() {
  state.updatedAt = new Date().toISOString();
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
  } catch (err) {
    process.stderr.write(
      `[codex:${label}] writeState mkdir failed: ${err.message}\n`
    );
    return;
  }
  const temporary = `${stateFile}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (err) {
    process.stderr.write(
      `[codex:${label}] writeState tmp write failed: ${err.message}\n`
    );
    return;
  }
  // rename は短期競合が大半 (AV scan 等)。指数的に短くリトライ (合計 ~1.5s)。
  const delays = [10, 30, 80, 200, 500, 800];
  for (let i = 0; i <= delays.length; i++) {
    try {
      renameSync(temporary, stateFile);
      return;
    } catch (err) {
      if (
        i === delays.length ||
        (err.code !== "EPERM" && err.code !== "EBUSY")
      ) {
        process.stderr.write(
          `[codex:${label}] writeState rename failed after ${i} retry: ${err.message}\n`
        );
        // tmp は次回 writeFileSync で上書きされるので放置可。
        return;
      }
      const wait = delays[i];
      const end = Date.now() + wait;
      while (Date.now() < end) {
        // busy-wait は本来避けたいが、async に切替えると writeState 呼出側が
        // sync 前提のため波及が大きい。1.5s 上限なので許容。
      }
    }
  }
}

function addEvent(text) {
  state.recentEvents.push({ at: new Date().toISOString(), text });
  state.recentEvents = state.recentEvents.slice(-20);
  console.log(`[codex:${label}] ${text}`);
  writeState();
}

function itemSummary(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "agent_message") {
    if (typeof item.text === "string") state.finalText = item.text;
    return item.text ? `message: ${item.text.slice(0, 240)}` : "message";
  }
  if (item.type === "command_execution") {
    const command = item.command || item.cmd || "command";
    return `command: ${String(command).slice(0, 240)}`;
  }
  if (item.type === "mcp_tool_call") {
    return `tool: ${item.server || "mcp"}/${item.tool || item.name || "unknown"}`;
  }
  return `${item.type || "item"}: ${item.id || ""}`.trim();
}

function truncateText(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatDuration(startIso, endIso) {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "-";
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

function formatUsage(usage) {
  if (!usage || typeof usage !== "object") return "-";
  const entries = Object.entries(usage)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${key}=${value}`);
  return entries.length > 0 ? entries.join(", ") : JSON.stringify(usage);
}

function formatFinalText(text) {
  const trimmed = text.trim();
  if (!trimmed) return ["- （なし）"];
  const clipped = truncateText(trimmed, 2000);
  const lines = clipped.split(/\r?\n/);
  const visible = lines.slice(0, 20).map((line) => `> ${line}`);
  if (lines.length > visible.length) {
    visible.push(`> …（${lines.length - visible.length}行省略）`);
  }
  return visible;
}

function buildErrorReport(effectiveCode) {
  const lines = [];
  const headline = lockLost
    ? `${label} lost supervisor lock ownership; worker process tree was terminated`
    : `${label} exited with code ${effectiveCode}`;
  lines.push(headline);
  lines.push("");
  lines.push("実行状態:");
  lines.push(`- status: ${state.status}`);
  lines.push(`- exitCode: ${effectiveCode}`);
  lines.push(`- threadId: ${state.threadId || "-"}`);
  lines.push(`- startedAt: ${state.startedAt}`);
  lines.push(`- finishedAt: ${state.finishedAt || "-"}`);
  lines.push(
    `- duration: ${formatDuration(state.startedAt, state.finishedAt)}`
  );
  lines.push(`- usage: ${formatUsage(state.usage)}`);
  lines.push("");
  lines.push("最後のworker発言:");
  lines.push(...formatFinalText(state.finalText));
  lines.push("");
  lines.push("直近イベント:");
  const recent = state.recentEvents.slice(-12);
  if (recent.length === 0) {
    lines.push("- （なし）");
  } else {
    for (const event of recent) {
      lines.push(`- ${event.at}: ${truncateText(event.text, 500)}`);
    }
  }
  lines.push("");
  lines.push("次に見る場所:");
  lines.push("- logs/codex-supervisor-state.json");
  lines.push(`- ${state.runLog || "logs/supervisor-run.log"}`);
  return lines.join("\n");
}

writeState();

const codexArgs = [];
if (sandbox === "danger-full-access") {
  codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
} else {
  codexArgs.push("-a", "never", "-s", sandbox);
}
// ~/.codex/config.toml が [windows] sandbox = "elevated" を設定していると Codex は
// 子プロセスを CreateProcessAsUserW で起動しようとし、scheduled-task の token では
// 権限不足 (ACCESS_DENIED=5) で全 pwsh exec が失敗する (2026-06-19 以降 94 件観測)。
// --dangerously-bypass-approvals-and-sandbox は windows sandbox 経路をバイパスしない
// ため、-c で per-invocation に unelevated へ上書きする。ユーザー config は触らない。
if (process.platform === "win32") {
  codexArgs.push("-c", 'windows.sandbox="unelevated"');
}
function tomlString(value) {
  return JSON.stringify(String(value));
}
const useShell = /\.(cmd|bat)$/i.test(codex);
function buildChildEnv() {
  const env = {
    ...process.env,
    ORICA_SUPERVISOR_HUB_REPO: repo,
    ORICA_LANE_KIND: "codex",
    ...(integrationTicket
      ? { ORICA_INTEGRATION_REQUEST: integrationTicket.file }
      : {}),
    ...(workerDeliveryFile
      ? { ORICA_WORKER_DELIVERY_FILE: workerDeliveryFile }
      : {}),
  };
  // Child gates can preserve candidates before runner termination. Ownership
  // tokens stay in the process environment, never in checkpoint files.
  delete env.ORICA_WORK_RECOVERY_CONTEXT;
  if (
    fullRunWorker &&
    lockScript &&
    lockLane === "supervisor" &&
    extraLocks.some((lock) => lock.lane === "card-impl")
  ) {
    const lockDirectory =
      process.env.ORICA_SUPERVISOR_LOCK_DIR || "C:\\dev\\orica-wt";
    env.ORICA_WORK_RECOVERY_CONTEXT = JSON.stringify({
      repo,
      workdir,
      runId: state.runId,
      ownerPid: process.pid,
      stateFile,
      locks: [
        {
          lane: lockLane,
          token: lockToken,
          file:
            lockPath ||
            process.env.ORICA_SUPERVISOR_LOCK ||
            join(lockDirectory, "orica-supervisor.lock.json"),
        },
        ...extraLocks
          .filter((lock) => lock.lane === "card-impl")
          .map((lock) => ({
            ...lock,
            file:
              process.env.ORICA_SUPERVISOR_LOCK ||
              join(lockDirectory, "orica-supervisor.card-impl.lock.json"),
          })),
      ],
    });
  }
  if (fullRunWorker || pinnedWorkerRef)
    for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  if (process.platform === "win32") {
    const preferredDirs = [
      join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7"),
      join(
        process.env.WINDIR || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0"
      ),
    ].filter(
      (dir) =>
        existsSync(join(dir, "pwsh.exe")) ||
        existsSync(join(dir, "powershell.exe"))
    );
    const currentPath = (env.Path || env.PATH || "")
      .split(";")
      .filter((entry) => entry && !/\\Microsoft\\WindowsApps$/i.test(entry));
    env.Path = [...preferredDirs, ...currentPath].join(";");
    env.PATH = env.Path;
  }
  return env;
}
codexArgs.push(
  "-m",
  codexModel,
  "-c",
  `model_reasoning_effort=${tomlString(codexReasoningEffort)}`,
  "-c",
  `model_verbosity=${tomlString(codexVerbosity)}`
);
const autoCompactTokenLimit = process.env.ORICA_CODEX_AUTO_COMPACT_TOKEN_LIMIT;
if (autoCompactTokenLimit) {
  if (!/^\d+$/.test(autoCompactTokenLimit)) {
    console.error(
      `[worker-codex-stream] ORICA_CODEX_AUTO_COMPACT_TOKEN_LIMIT must be an integer, got ${autoCompactTokenLimit}`
    );
    process.exit(1);
  }
  codexArgs.push(
    "-c",
    `model_auto_compact_token_limit=${autoCompactTokenLimit}`
  );
}
codexArgs.push("-C", workdir, "exec", "--json", "--color", "never", "-");
// The wrapper's plan may be minutes old after pre-worker audits. Refresh both
// artifact ownership and intake at the actual dispatch boundary.
if (fullRunWorker) {
  const recovery = await inspectWorkerRecovery(repo, workdir);
  if (recovery.action === "recover") {
    followupIds = recovery.followupIds;
    auditForFollowupIds = [];
    state.followupIds = followupIds;
    state.recoveryInstructions = recovery.instructions;
    prompt +=
      "\n\n再開時の最新照合（前段の古い選択を更新する）:\n" +
      recovery.workerFocus;
    writeState();
  }
}
const child = spawn(codex, codexArgs, {
  cwd: workdir,
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
  shell: useShell,
  env: buildChildEnv(),
});
let activeChild = child;
state.childPid = child.pid || null;
writeState();

let lockLost = false;
let turnFailed = false;
let lockTimer = null;
let progressTimer = null;
let progressMessageId = null;
let lastProgressText = "";

function notifyTelegram(text, editMessageId = null) {
  const notifyScript = join(repo, "scripts", "notify-telegram.mjs");
  const args = [notifyScript, "--stdin", "--strict", "--json"];
  if (editMessageId) {
    args.push("--edit-message-id", String(editMessageId));
  }
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    timeout: 20000,
  });
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return { ok: false };
  }
}

function buildProgressText(final = false) {
  const now = new Date().toISOString();
  const elapsed = formatDuration(state.startedAt, state.finishedAt || now);
  const icon = final
    ? state.status === "completed"
      ? "✅ 完了"
      : state.status === "publication_pending"
        ? "⏳ 公開待ち"
        : state.status === "worker_completed"
          ? "📝 worker終了・公開要求なし"
          : "❌ 停止"
    : "⏳ 処理中";
  const lines = [`${icon} (${elapsed})`];
  if (state.threadId) lines.push(`thread: ${state.threadId}`);

  let visibleText = state.finalText.trim();
  if (telegramMessageId && visibleText.startsWith("{")) {
    try {
      visibleText = JSON.parse(visibleText).reply || "";
    } catch {
      visibleText = "";
    }
  }
  if (final) {
    return formatCompletionText(
      visibleText || "処理結果がありません。",
      lines.join("\n")
    );
  }
  const recent = state.recentEvents.slice(-8);
  if (recent.length > 0) {
    lines.push("");
    lines.push("直近イベント:");
    for (const event of recent) {
      lines.push(`- ${event.at}: ${truncateText(event.text, 220)}`);
    }
    if (state.recentEvents.length > recent.length) {
      lines.push(`- ... (他 ${state.recentEvents.length - recent.length} 件)`);
    }
  }

  if (visibleText) {
    lines.push("");
    lines.push("プレビュー:");
    lines.push(truncateText(visibleText, 1200));
  }

  const text = lines.join("\n");
  return text.length > 3900 ? `${text.slice(0, 3890)}\n…(truncated)` : text;
}

function sendProgressUpdate(final = false) {
  const text = buildProgressText(final);
  if (!liveProgressEnabled) {
    Object.assign(delivery, {
      status: state.status,
      updatedAt: new Date().toISOString(),
      ...(final ? { finalText: text } : {}),
    });
    writeDelivery(workerDeliveryFile, delivery);
    return false;
  }
  if (!final && text === lastProgressText) return false;
  let result = progressMessageId
    ? notifyTelegram(text, progressMessageId)
    : notifyTelegram(text);
  // A transient edit failure keeps the same message for retry. Only a deleted message needs a replacement.
  if (!result.ok && result.canSendNew && progressMessageId)
    result = notifyTelegram(text);
  if (result.ok) {
    progressMessageId = result.messageId || progressMessageId;
    lastProgressText = text;
  }
  Object.assign(delivery, {
    status: state.status,
    updatedAt: new Date().toISOString(),
    messageId: progressMessageId,
    finalDelivered: final && result.ok,
    ...(final ? { finalText: text } : {}),
  });
  writeDelivery(workerDeliveryFile, delivery);
  return Boolean(result.ok);
}

function terminateChildTree() {
  if (
    !activeChild?.pid ||
    activeChild.exitCode !== null ||
    activeChild.signalCode !== null
  )
    return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(activeChild.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    return;
  }
  activeChild.kill("SIGTERM");
}

function refreshLock(lane, token) {
  const result = spawnSync(
    process.execPath,
    [lockScript, "refresh", "--lane", lane, "--token", token],
    {
      ...(lockPath && lane === lockLane
        ? { env: { ...process.env, ORICA_SUPERVISOR_LOCK: lockPath } }
        : {}),
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    }
  );
  return result;
}

function refreshOwnedLock() {
  if (!lockScript || !lockToken || lockLost) return;
  const locks = [{ lane: lockLane, token: lockToken }, ...extraLocks];
  for (const current of locks) {
    const result = refreshLock(current.lane, current.token);
    if ((result.status ?? 2) === 0) {
      addEvent(`lock heartbeat refreshed: lane=${current.lane}`);
      continue;
    }
    lockLost = true;
    state.status = "lock_lost";
    addEvent(
      `lock heartbeat failed: lane=${current.lane}, exit=${result.status ?? 2}, ${(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()}`
    );
    terminateChildTree();
    return;
  }
}

if (lockScript && lockToken) {
  const intervalMs = Math.max(10, lockHeartbeatSeconds) * 1000;
  lockTimer = setInterval(refreshOwnedLock, intervalMs);
  lockTimer.unref();
}

if (liveProgressEnabled) {
  sendProgressUpdate();
  progressTimer = setInterval(
    () => sendProgressUpdate(),
    Math.max(1, progressIntervalSeconds) * 1000
  );
  progressTimer.unref();
}

child.on("error", (error) => {
  state.status = "failed";
  state.finishedAt = new Date().toISOString();
  state.exitCode = 1;
  addEvent(`spawn failed: ${error.message}`);
  if (progressTimer) clearInterval(progressTimer);
});

let stdinErrorRecorded = false;
function recordStdinError(error) {
  if (stdinErrorRecorded) return;
  stdinErrorRecorded = true;
  addEvent(`stdin write failed: ${error.code || error.message}`);
}
child.stdin.on("error", recordStdinError);
try {
  child.stdin.end(prompt, "utf8");
} catch (error) {
  recordStdinError(error);
}

const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "thread.started") {
    state.threadId = event.thread_id || null;
    try {
      recordFollowupRun({
        repo,
        ids: followupIds,
        runId: state.runId,
        threadId: state.threadId,
        phase: "started",
      });
      recordFollowupRun({
        repo,
        ids: auditForFollowupIds,
        runId: state.runId,
        threadId: state.threadId,
        phase: "audit-started",
      });
    } catch (error) {
      turnFailed = true;
      addEvent(`follow-up start receipt failed: ${error.message}`);
      terminateChildTree();
    }
    addEvent(`thread started: ${state.threadId || "unknown"}`);
    return;
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const summary = itemSummary(event.item);
    if (summary) addEvent(`${event.type}: ${summary}`);
    return;
  }
  if (event.type === "turn.completed") {
    state.usage = event.usage || null;
    addEvent("turn completed");
    return;
  }
  if (event.type === "turn.failed" || event.type === "error") {
    turnFailed = true;
    addEvent(
      `${event.type}: ${JSON.stringify(event.error || event.message || event)}`
    );
  }
});

child.on("close", async (code) => {
  activeChild = null;
  let effectiveCode = lockLost ? 3 : turnFailed ? 1 : (code ?? 1);
  state.workerExitCode = effectiveCode;
  state.publicationStatus = integrationTicket
    ? "not_requested"
    : "not_applicable";
  if (integrationTicket) {
    try {
      state.status = "integrating";
      writeState();
      const result = await completeIntegration(integrationTicket, {
        workerExitCode: effectiveCode,
        env: buildChildEnv(),
        onChild: (current) => {
          activeChild = current;
          if (lockLost) terminateChildTree();
        },
        onProgress: addEvent,
      });
      if (result) {
        state.integration = result;
        state.publicationStatus = result.status;
        effectiveCode = result.status === "completed" ? 0 : result.exitCode;
        state.finalText += `\n\n統合結果: ${result.status}; ${result.error || result.remoteHead}\n証跡: ${integrationTicket.file}`;
        if (result.status === "waiting")
          observeBlocker({
            repo,
            key: "publication:" + result.runId,
            text: `workerは終了しましたが公開待ちです。候補と証跡を保持し次回起動で再開します。\n${result.file}`,
          });
      }
    } catch (error) {
      effectiveCode = 1;
      state.finalText += `\n\n統合失敗: ${error.message}`;
      addEvent(`integration failed: ${error.message}`);
    }
  }
  if (
    fullRunWorker &&
    lockScript &&
    lockToken &&
    lockLane === "supervisor" &&
    extraLocks.some((lock) => lock.lane === "card-impl") &&
    !lockLost
  ) {
    refreshOwnedLock();
    if (!lockLost) {
      try {
        state.workRecovery = preserveWorkerWork({
          repo,
          workdir,
          runId: state.runId || randomUUID(),
          childPid: child.pid,
          threadId: state.threadId,
          exitCode: effectiveCode,
          followupIds,
        });
      } catch (error) {
        effectiveCode = 1;
        addEvent(`work recovery preservation failed: ${error.message}`);
      }
    }
  }
  if (lockLost) effectiveCode = 3;
  if (lockTimer) clearInterval(lockTimer);
  if (progressTimer) clearInterval(progressTimer);
  if (effectiveCode === 0 && telegramMessageId) {
    const completion = spawnSync(
      process.execPath,
      [
        join(repo, "scripts", "telegram-message-worker.mjs"),
        "complete",
        "--id",
        telegramMessageId,
        "--worker-delivery-file",
        workerDeliveryFile,
      ],
      {
        cwd: repo,
        env: { ...process.env, ORICA_TELEGRAM_REPO: repo },
        input: state.finalText,
        encoding: "utf8",
        windowsHide: true,
      }
    );
    try {
      if (completion.status === 0)
        state.receptionResult = JSON.parse(completion.stdout);
      else {
        // The controller may stop after its durable commit but before returning to this runner.
        const savedResult = join(
          repo,
          "logs",
          "codex-telegram-inbox",
          "reception-results",
          telegramMessageId + ".json"
        );
        const saved = existsSync(savedResult)
          ? JSON.parse(readFileSync(savedResult, "utf8"))
          : null;
        if (saved?.status !== "completed")
          throw new Error(
            completion.stderr || "受付結果を保存できませんでした"
          );
        state.receptionResult = saved;
      }
      state.finalText = state.receptionResult.reply;
    } catch (error) {
      effectiveCode = 1;
      state.finalText =
        "受付結果の保存に失敗しました。メッセージは未処理として保持しています。";
      addEvent("reception completion failed: " + error.message);
    }
  }
  if (effectiveCode !== 0 && telegramMessageId) {
    state.finalText =
      "受付に失敗しました。原文は未処理として保持しています。\n再試行: /retry " +
      telegramMessageId;
  }
  state.status = lockLost
    ? "lock_lost"
    : state.publicationStatus === "waiting"
      ? "publication_pending"
      : effectiveCode === 0
        ? integrationTicket && state.publicationStatus !== "completed"
          ? "worker_completed"
          : "completed"
        : "failed";
  state.finishedAt = new Date().toISOString();
  state.exitCode = effectiveCode;
  try {
    recordFollowupRun({
      repo,
      ids: followupIds,
      runId: state.runId,
      phase: "finished",
      exitCode: effectiveCode,
    });
  } catch (error) {
    effectiveCode = 1;
    state.exitCode = 1;
    state.status = "failed";
    addEvent(`follow-up finish receipt failed: ${error.message}`);
  }
  if (runMetrics) {
    try {
      finishRunMetrics(runMetrics, state);
    } catch (error) {
      process.stderr.write(`[metrics] ${error.message}\n`);
    }
  }
  addEvent(`process exited: ${state.exitCode}`);
  sendProgressUpdate(true);

  const reportScript = join(repo, "scripts", "supervisor-report.mjs");
  const reportKind = ["publication_pending", "worker_completed"].includes(
    state.status
  )
    ? "progress"
    : effectiveCode === 0
      ? "completed"
      : "error";
  const summary =
    reportKind !== "error"
      ? `worker: ${state.workerExitCode === 0 ? "終了" : "失敗"} / publication: ${state.publicationStatus}\n` +
        (state.finalText.trim() ||
          `${label} exited with code ${state.exitCode}`)
      : buildErrorReport(effectiveCode);
  spawnSync(
    process.execPath,
    [
      reportScript,
      "--repo",
      repo,
      "--kind",
      reportKind,
      "--lane",
      "codex",
      "--stdin",
      ...(telegramMessageId && (reportKind === "completed" || routineReception)
        ? ["--no-followup"]
        : []),
      ...(state.status === "publication_pending" ? ["--no-followup"] : []),
      ...(workerDeliveryFile
        ? ["--worker-delivery-file", workerDeliveryFile]
        : []),
    ],
    {
      cwd: repo,
      input: summary,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
    }
  );
  process.exit(effectiveCode);
});
