#!/usr/bin/env node
/**
 * headless Claude worker を stream-json で起動し、状態をローカルファイルへ保存する。
 *
 * Codex 版 (worker-codex-stream.mjs) の peer。CLI 引数とイベント parse のみ
 * Claude (`claude --print --output-format stream-json`) 用に差し替え、lock
 * heartbeat / state file / supervisor-report 連携は同じ枠を踏襲する。
 *
 * 通知は行わない。Codex App heartbeat / Telegram bot 等が state/outbox を読み
 * モバイルへ報告する。
 */

import { spawn, spawnSync } from "node:child_process";
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

const label = argValue("--label", "claude-worker");
const repo = resolve(argValue("--repo", process.cwd()));
// --workdir は claude の cwd（=worktree）。--repo は scripts/state/hub の解決基点（=primary）。
// 両者を分けないと、headless claude が相対パス編集で primary tree を汚し auto-merge を全ブロックする。
const workdir = resolve(argValue("--workdir", repo));
const claudeCli = argValue("--claude", "claude");
const model = argValue("--model", "sonnet");
const promptFile = argValue("--prompt-file", null);
const lockScript = argValue("--lock-script", null);
const lockToken = argValue("--lock-token", null);
const lockLane = argValue("--lock-lane", "engine-claude");
const lockHeartbeatSeconds = Number(
  argValue("--lock-heartbeat-seconds", "300")
);
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
  argValue("--state-file", join(repo, "logs", "claude-supervisor-state.json"))
);
const prompt = promptFile
  ? readFileSync(promptFile, "utf8")
  : readFileSync(0, "utf8");

if (!prompt.trim()) {
  console.error("[worker-claude-stream] prompt is empty");
  process.exit(1);
}
if ((lockScript && !lockToken) || (!lockScript && lockToken)) {
  console.error(
    "[worker-claude-stream] --lock-script and --lock-token must be specified together"
  );
  process.exit(1);
}
if (extraLocks.length > 0 && !lockScript) {
  console.error("[worker-claude-stream] extra locks require --lock-script");
  process.exit(1);
}

const startedAt = new Date().toISOString();
const state = {
  schemaVersion: 1,
  label,
  status: "running",
  sessionId: null,
  startedAt,
  updatedAt: startedAt,
  finishedAt: null,
  exitCode: null,
  finalText: "",
  usage: null,
  costUsd: null,
  recentEvents: [],
};

// Windows の rename EPERM/EBUSY 競合対策。worker-codex-stream の同型修正を参照。
// 失敗を throw せず log のみで飲み、後続イベントの writeState に任せる。
function writeState() {
  state.updatedAt = new Date().toISOString();
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
  } catch (err) {
    process.stderr.write(
      `[claude:${label}] writeState mkdir failed: ${err.message}\n`
    );
    return;
  }
  const temporary = `${stateFile}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (err) {
    process.stderr.write(
      `[claude:${label}] writeState tmp write failed: ${err.message}\n`
    );
    return;
  }
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
          `[claude:${label}] writeState rename failed after ${i} retry: ${err.message}\n`
        );
        return;
      }
      const wait = delays[i];
      const end = Date.now() + wait;
      while (Date.now() < end) {
        // busy-wait (~1.5s 上限、sync API 維持のため許容)
      }
    }
  }
}

function addEvent(text) {
  state.recentEvents.push({ at: new Date().toISOString(), text });
  state.recentEvents = state.recentEvents.slice(-20);
  console.log(`[claude:${label}] ${text}`);
  writeState();
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
    ? `${label} lost engine-claude lock ownership; worker process tree was terminated`
    : `${label} exited with code ${effectiveCode}`;
  lines.push(headline);
  lines.push("");
  lines.push("実行状態:");
  lines.push(`- status: ${state.status}`);
  lines.push(`- exitCode: ${effectiveCode}`);
  lines.push(`- sessionId: ${state.sessionId || "-"}`);
  lines.push(`- startedAt: ${state.startedAt}`);
  lines.push(`- finishedAt: ${state.finishedAt || "-"}`);
  lines.push(
    `- duration: ${formatDuration(state.startedAt, state.finishedAt)}`
  );
  lines.push(`- usage: ${formatUsage(state.usage)}`);
  if (state.costUsd != null) {
    lines.push(`- cost_usd: ${state.costUsd}`);
  }
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
  lines.push("- logs/claude-supervisor-state.json");
  lines.push("- logs/claude-run.log");
  return lines.join("\n");
}

writeState();

// Claude CLI 引数:
//   --print                       : headless one-shot (Telegram bot と同じ呼び方)
//   --output-format stream-json   : event JSONL を stdout に出力
//   --input-format text           : stdin から prompt を流す (改行/UTF-8 安全)
//   --verbose                     : stream-json 出力に必要 (Claude SDK 仕様)
//   --model <id>                  : モデル固定 (既定 sonnet)
//   --dangerously-skip-permissions: 無人実行 (Telegram bot と同じ)
const claudeArgs = [
  "--print",
  "--output-format",
  "stream-json",
  "--input-format",
  "text",
  "--verbose",
  "--model",
  model,
  "--dangerously-skip-permissions",
];

const useShell = /\.(cmd|bat)$/i.test(claudeCli);
function buildChildEnv() {
  const env = {
    ...process.env,
    ORICA_SUPERVISOR_HUB_REPO: repo,
    ORICA_LANE_KIND: "claude",
  };
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
// cwd は worktree（workdir）。headless claude の Edit/Write/Bash は cwd 基準なので、
// ここを worktree にしないと primary tree を汚染する（致命）。
const child = spawn(claudeCli, claudeArgs, {
  cwd: workdir,
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
  shell: useShell,
  env: buildChildEnv(),
});

let lockLost = false;
let lockTimer = null;

function terminateChildTree() {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    return;
  }
  child.kill("SIGTERM");
}

function refreshLock(lane, token) {
  const result = spawnSync(
    process.execPath,
    [lockScript, "refresh", "--lane", lane, "--token", token],
    {
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

child.on("error", (error) => {
  state.status = "failed";
  state.finishedAt = new Date().toISOString();
  state.exitCode = 1;
  addEvent(`spawn failed: ${error.message}`);
});

child.stdin.end(prompt, "utf8");

// Claude stream-json events:
//   {type:"system", subtype:"init", session_id, model, tools, ...}
//   {type:"assistant", message:{content:[{type:"text"|"tool_use", ...}]}}
//   {type:"user", message:{content:[{type:"tool_result", tool_use_id, content}]}}
//   {type:"result", subtype:"success"|"error_*", duration_ms, result, usage, total_cost_usd}
const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "system" && event.subtype === "init") {
    state.sessionId = event.session_id || null;
    addEvent(
      `session started: ${state.sessionId || "unknown"} (model=${event.model || "?"})`
    );
    return;
  }
  if (event.type === "assistant" && event.message?.content) {
    for (const part of event.message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        state.finalText = part.text;
        addEvent(`message: ${truncateText(part.text, 240)}`);
      } else if (part.type === "tool_use") {
        const tool = part.name || "tool";
        const summary = part.input
          ? truncateText(JSON.stringify(part.input), 200)
          : "";
        addEvent(`tool: ${tool}${summary ? ` ${summary}` : ""}`);
      }
    }
    return;
  }
  if (event.type === "user" && event.message?.content) {
    for (const part of event.message.content) {
      if (part.type === "tool_result") {
        const content =
          typeof part.content === "string"
            ? part.content
            : Array.isArray(part.content)
              ? part.content
                  .map((c) =>
                    typeof c?.text === "string" ? c.text : JSON.stringify(c)
                  )
                  .join(" ")
              : JSON.stringify(part.content);
        addEvent(`tool_result: ${truncateText(content, 160)}`);
      }
    }
    return;
  }
  if (event.type === "result") {
    state.usage = event.usage || null;
    state.costUsd =
      typeof event.total_cost_usd === "number" ? event.total_cost_usd : null;
    if (typeof event.result === "string" && event.result.trim()) {
      state.finalText = event.result;
    }
    addEvent(
      `result: ${event.subtype || "?"} (duration_ms=${event.duration_ms ?? "?"}, cost=$${state.costUsd ?? "?"})`
    );
    return;
  }
  if (event.type === "error") {
    addEvent(`error: ${JSON.stringify(event.error || event.message || event)}`);
  }
});

child.on("close", (code) => {
  if (lockTimer) clearInterval(lockTimer);
  const effectiveCode = lockLost ? 3 : (code ?? 1);
  state.status = lockLost
    ? "lock_lost"
    : effectiveCode === 0
      ? "completed"
      : "failed";
  state.finishedAt = new Date().toISOString();
  state.exitCode = effectiveCode;
  addEvent(`process exited: ${state.exitCode}`);

  const reportScript = join(repo, "scripts", "supervisor-report.mjs");
  const reportKind = effectiveCode === 0 ? "completed" : "error";
  const summary =
    reportKind === "completed"
      ? state.finalText.trim() || `${label} exited with code ${state.exitCode}`
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
      "claude",
      "--stdin",
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
