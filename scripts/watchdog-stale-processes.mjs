#!/usr/bin/env node
// Watchdog: periodically reap stale node-spawned processes that accumulate
// across sessions (vitest/tinypool runaways, abandoned MCP servers from past
// Claude Code sessions). Designed to run as a Windows Scheduled Task every
// ~30–60 min. See memory: project_automerge_vitest_rpc_timeout_zombie.md
//
// Categories:
//
//   [default] vitest/tinypool ─ test-time leftovers
//     - only confirmed orphans with stable identity and no active validation
//       coordinator; CPU time and age alone never permit cleanup
//
//   [--include-mcp] mcp-codex / mcp-playwright ─ Claude Code session MCP servers
//     Each Claude Code session spawns a triplet:
//       node (MCP) <- cmd.exe (launcher) <- claude.exe (session)
//                                          <- claude.exe (host, shared)
//     These do NOT get cleaned up on session exit — the per-session claude.exe
//     and the cmd.exe wrappers stay alive holding the node MCP open. So
//     orphan-by-PID detection does not work.
//     Instead: group MCP processes by their per-session claude.exe ancestor.
//     Kill node + cmd.exe in groups where (NOT youngest) AND (session age
//     >= WATCHDOG_MCP_SESSION_MIN_AGE_SEC, default 6h). The per-session
//     claude.exe itself is left intact so the host UI is not destabilized.
//     Ungrouped MCP processes are more conservative: if their parent is still
//     alive, they may belong to an active Codex worker/verifier, so the default
//     kill floor is 12h. Parent-dead ungrouped MCP keeps the older 4x MCP floor.
//     Additionally, a session/ungrouped-proc group is protected regardless of
//     age if it descends from a `--lock-token <token>` bearing worker process
//     (worker-claude-stream.mjs / worker-codex-stream.mjs) whose lane lock is
//     still actively heartbeating (checked via `supervisor-lock.mjs status`,
//     the same SSOT reapSupervisorLocks() uses, threshold WATCHDOG_LOCK_STALE_MIN).
//     This fixes the false positive where a supervisor-lock TTL=240min engine
//     lane session (still legitimately running, e.g. age=82min) gets killed by
//     the MCP_SESSION_MIN_AGE_SEC=1h default because it isn't the single
//     youngest group. See memory: project_watchdog_mcp_active_lane_false_positive.
//
//   [--include-cli-sessions] stale Claude Code CLI sessions (claude.exe) ─
//     The Claude desktop app embeds Claude Code and launches headless CLI
//     sessions/subagents as child `claude.exe` processes in stream-json mode
//     (cmdline matches `claude-code\<ver>\claude.exe ... --input-format stream-json`).
//     A healthy subagent exits in minutes, but stuck/abandoned ones accumulate
//     under the long-lived desktop app and are NEVER reaped — the MCP category
//     above only enumerates node.exe and DELIBERATELY preserves claude.exe, so
//     these are invisible to it (observed: 143 procs / 19.5 GB over ~4 days,
//     2026-06-14). This category enumerates those claude.exe directly and kills
//     trees that are (NOT in the youngest WATCHDOG_CLI_PROTECT_YOUNGEST sessions,
//     default 2) AND (age >= WATCHDOG_CLI_SESSION_MIN_AGE_SEC, default 12h) AND
//     (NOT in the watchdog's own ancestor chain). The desktop app root and
//     interactive sessions are protected by the cmd filter + youngest-guard +
//     self-ancestry walk. See memory: project_process_hygiene_infra.
//
// Safety:
//   - never kill self or own parent chain
//   - vitest orphan detection uses system-wide PID set
//   - MCP cleanup is opt-in (--include-mcp) and always preserves the youngest
//     session group
//   - dry-run mode: print what would be killed without acting
//
//   [--include-locks] stale supervisor-lock reaping ─
//     Free lane locks (orica-supervisor[.<lane>].lock.json in
//     ORICA_SUPERVISOR_LOCK_DIR, default C:\dev\orica-wt) whose heartbeat
//     (file mtime) has stopped for >= WATCHDOG_LOCK_STALE_MIN (default 20 min).
//     A live worker refreshes every 5 min, so 20 min silence = dead/hung. The
//     stale decision + atomic freeing is delegated to `supervisor-lock.mjs reap`
//     (the lock SSOT); the watchdog only maps filename->lane. Collapses the
//     orphan-lock cron dead window from ~240 min to <= one watchdog interval.
//     See memory: project_supervisor_orphan_lock_deadwindow.
//
// Usage:
//   node scripts/watchdog-stale-processes.mjs                       # vitest only
//   node scripts/watchdog-stale-processes.mjs --include-mcp         # + stale MCP
//   node scripts/watchdog-stale-processes.mjs --include-cli-sessions # + stale CLI claude.exe
//   node scripts/watchdog-stale-processes.mjs --include-locks       # + stale supervisor locks
//   node scripts/watchdog-stale-processes.mjs --dry-run --include-mcp --include-cli-sessions --include-locks
//   node scripts/watchdog-stale-processes.mjs --no-notify
//   node scripts/watchdog-stale-processes.mjs --verbose
//
// Exit code is 0 even when kills occurred; non-zero only on internal error.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { reapOrphanedVitest } from "./lib/vitest-process-policy.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const NO_NOTIFY = args.includes("--no-notify");
const INCLUDE_MCP = args.includes("--include-mcp");
const INCLUDE_CLI = args.includes("--include-cli-sessions");
const INCLUDE_LOCKS = args.includes("--include-locks");
const VERBOSE =
  args.includes("--verbose") || process.env.WATCHDOG_VERBOSE === "1";

// MCP session must be at least this old (in seconds) before its leftovers are
// eligible for kill. Default 1 hour: empirically required because external cron
// (e.g. autonomous loop spawning Claude Code sessions every 30 min) accumulates
// MCP triplets fast enough that a 6h threshold left ~12 stragglers and slowed
// mcts test to RPC timeout (2026-06-12 incident, ~66 procs / 42 node). Steady
// state with hourly watchdog + 1h threshold: ≤2 inactive triplets at any time.
// The current active session is still protected by the youngest-per-session
// claude.exe guard. Override with WATCHDOG_MCP_SESSION_MIN_AGE_SEC.
const MCP_SESSION_MIN_AGE_SEC = Number(
  process.env.WATCHDOG_MCP_SESSION_MIN_AGE_SEC ?? 3600
);
const UNGROUPED_MCP_MIN_AGE_SEC = Number(
  process.env.WATCHDOG_UNGROUPED_MCP_MIN_AGE_SEC ?? 43200
);

// Stale CLI session (claude.exe stream-json) thresholds. A session must be at
// least this old AND not among the youngest N to be eligible for kill. 12h
// default: an interactive/active session is protected by the youngest-N guard;
// anything older than 12h that is NOT the youngest is a leaked subagent/headless
// run (observed accumulating to 75h+). Override via env.
const CLI_SESSION_MIN_AGE_SEC = Number(
  process.env.WATCHDOG_CLI_SESSION_MIN_AGE_SEC ?? 43200
);
const CLI_PROTECT_YOUNGEST = Number(
  process.env.WATCHDOG_CLI_PROTECT_YOUNGEST ?? 2
);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NOTIFY_SCRIPT = join(SCRIPT_DIR, "notify-telegram.mjs");
const LOCK_SCRIPT = join(SCRIPT_DIR, "supervisor-lock.mjs");

// Stale supervisor-lock reaping (--include-locks). A live engine/supervisor
// worker refreshes its lock's mtime every 300s (see worker-claude-stream.mjs
// --lock-heartbeat-seconds). The runner's acquire TTL is 240 min, so a worker
// that dies mid-run leaves the lock "held" for up to ~4h, during which every
// 15-min cron no-ops (orphan-lock dead window; see memory
// project_supervisor_orphan_lock_deadwindow). This janitor treats --ttl as a
// HEARTBEAT timeout (default 20 min = 4 missed 5-min beats) and hands each lane
// lock to `supervisor-lock.mjs reap`, which atomically quarantines + re-checks
// before freeing — a worker that refreshes during the check is left intact.
const LOCK_DIR = process.env.ORICA_SUPERVISOR_LOCK_DIR || "C:\\dev\\orica-wt";
const LOCK_STALE_MIN = Number(process.env.WATCHDOG_LOCK_STALE_MIN ?? 20);

const MCP_CATEGORIES = [
  {
    name: "mcp-codex",
    re: /@openai[\\/]codex[\\/]bin[\\/]codex\.js.*\bmcp-server\b/i,
  },
  {
    name: "mcp-playwright",
    re: /@playwright[\\/]mcp(?:[\\/]cli\.js)?|playwright[\\/]mcp[^\s]*--headless/i,
  },
];

function log(...a) {
  if (VERBOSE) console.log("[watchdog]", ...a);
}

function selfAncestors() {
  const set = new Set();
  set.add(process.pid);
  if (process.ppid) set.add(process.ppid);
  return set;
}

function listNodeProcessesWindows() {
  // CreationDate is a CIM DateTime; ConvertTo-Json renders it in a format
  // that Date.parse() in Node can't read. Project it through ToString('o') to
  // get ISO 8601 first.
  const ps = [
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
    "| Select-Object ProcessId, ParentProcessId, CommandLine, UserModeTime, KernelModeTime,",
    "  @{N='CreationDateIso';E={if($_.CreationDate){$_.CreationDate.ToString('o')}else{''}}}",
    "| ConvertTo-Json -Compress -Depth 3",
  ].join(" ");
  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (out.status !== 0) {
    log("powershell list failed:", out.stderr);
    return [];
  }
  const raw = out.stdout.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const now = Date.now();
  return arr.map((p) => {
    const cpuTicks =
      Number(p.UserModeTime ?? 0) + Number(p.KernelModeTime ?? 0);
    const createdMs = p.CreationDateIso ? Date.parse(p.CreationDateIso) : NaN;
    return {
      pid: Number(p.ProcessId),
      ppid: Number(p.ParentProcessId),
      cmd: String(p.CommandLine ?? ""),
      cpuSec: cpuTicks / 1e7,
      ageSec: Number.isFinite(createdMs) ? (now - createdMs) / 1000 : 0,
    };
  });
}

function listNodeProcessesPosix() {
  const out = spawnSync("ps", ["-eo", "pid,ppid,etimes,time,args"], {
    encoding: "utf8",
  });
  if (out.status !== 0) return [];
  return out.stdout
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) return null;
      const [, pid, ppid, etimes, time, cmd] = m;
      if (!/(^|\/)node($|\s)/.test(cmd)) return null;
      const parts = time.split(":").map(Number);
      const cpuSec =
        parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : parts[0] * 60 + (parts[1] ?? 0);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        cmd,
        cpuSec,
        ageSec: Number(etimes),
      };
    })
    .filter(Boolean);
}

function killWindows(pid) {
  const result = spawnSync("taskkill.exe", ["/F", "/T", "/PID", String(pid)], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return result.status === 0 && !result.error;
}

function killPosix(pid) {
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    /* already gone */
    return false;
  }
}

function killTree(pid) {
  if (platform() === "win32") return killWindows(pid);
  return killPosix(pid);
}

function listAllProcessesWindows() {
  // For MCP grouping we need ALL processes (not just node) so we can walk
  // chains through cmd.exe and claude.exe. ISO date projection (see above).
  const ps = [
    "Get-CimInstance Win32_Process",
    "| Select-Object ProcessId, ParentProcessId, Name,",
    "  @{N='CreationDateIso';E={if($_.CreationDate){$_.CreationDate.ToString('o')}else{''}}}",
    "| ConvertTo-Json -Compress -Depth 3",
  ].join(" ");
  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (out.status !== 0) return new Map();
  const arr = JSON.parse(out.stdout.trim());
  const list = Array.isArray(arr) ? arr : [arr];
  const map = new Map();
  for (const p of list) {
    const createdMs = p.CreationDateIso ? Date.parse(p.CreationDateIso) : NaN;
    map.set(Number(p.ProcessId), {
      pid: Number(p.ProcessId),
      ppid: Number(p.ParentProcessId),
      name: String(p.Name ?? "").toLowerCase(),
      createdMs: Number.isFinite(createdMs) ? createdMs : 0,
    });
  }
  return map;
}

function walkAncestors(pid, allProcMap) {
  // Returns array of ancestors from immediate parent upward.
  const chain = [];
  let cur = allProcMap.get(pid)?.ppid ?? 0;
  for (let i = 0; i < 16 && cur > 0; i++) {
    const entry = allProcMap.get(cur);
    if (!entry) break;
    chain.push(entry);
    cur = entry.ppid;
  }
  return chain;
}

function findSessionClaudeAncestor(pid, allProcMap) {
  // The per-session claude.exe is the FIRST claude.exe in the parent chain
  // (closer ancestors are cmd.exe / node wrappers; the per-session is the
  // closest claude.exe; the host claude.exe sits above it).
  const chain = walkAncestors(pid, allProcMap);
  return chain.find((p) => p.name === "claude.exe");
}

// Enumerate Claude Code CLI sessions: claude.exe whose cmdline is the bundled
// CLI binary running in stream-json (headless/subagent) transport. ISO date
// projection as in the node lister (CIM DateTime is not Date.parse-able).
function listClaudeCliSessionsWindows() {
  const ps = [
    "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\"",
    "| Select-Object ProcessId, ParentProcessId, CommandLine,",
    "  @{N='CreationDateIso';E={if($_.CreationDate){$_.CreationDate.ToString('o')}else{''}}}",
    "| ConvertTo-Json -Compress -Depth 3",
  ].join(" ");
  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (out.status !== 0 || !out.stdout.trim()) return [];
  const parsed = JSON.parse(out.stdout.trim());
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const now = Date.now();
  return arr
    .map((p) => {
      const cmd = String(p.CommandLine ?? "");
      const createdMs = p.CreationDateIso ? Date.parse(p.CreationDateIso) : NaN;
      return {
        pid: Number(p.ProcessId),
        ppid: Number(p.ParentProcessId),
        cmd,
        createdMs: Number.isFinite(createdMs) ? createdMs : now,
      };
    })
    .filter(
      (p) => /claude-code[\\/]/i.test(p.cmd) && /stream-json/i.test(p.cmd)
    );
}

// Full ancestor chain of the watchdog process itself (so we never kill the
// interactive claude.exe session that launched this run). 2-level selfAncestors
// is not enough for the CLI category — the session is several hops up.
function fullSelfAncestry(allProcMap) {
  const set = new Set([process.pid]);
  let cur = allProcMap.get(process.pid)?.ppid ?? process.ppid ?? 0;
  for (let i = 0; i < 32 && cur > 0; i++) {
    set.add(cur);
    cur = allProcMap.get(cur)?.ppid ?? 0;
  }
  return set;
}

function reapCliSessions(sessions, protect) {
  // Protect the youngest N sessions (active) regardless of age, then kill any
  // remaining session whose age >= threshold and is not self-ancestry.
  const now = Date.now();
  const byAgeDesc = [...sessions].sort((a, b) => b.createdMs - a.createdMs);
  const youngest = new Set(
    byAgeDesc.slice(0, CLI_PROTECT_YOUNGEST).map((s) => s.pid)
  );
  const killed = [];
  for (const s of sessions) {
    if (protect.has(s.pid) || youngest.has(s.pid)) continue;
    const ageSec = (now - s.createdMs) / 1000;
    if (ageSec < CLI_SESSION_MIN_AGE_SEC) continue;
    killed.push({
      pid: s.pid,
      category: "cli-session",
      reason: `stale-cli-session(age=${ageSec.toFixed(0)}s)`,
      ppid: s.ppid,
    });
    if (!DRY_RUN) killTree(s.pid);
  }
  return killed;
}

function classifyMcp(proc) {
  for (const cat of MCP_CATEGORIES) {
    if (cat.re.test(proc.cmd)) return cat;
  }
  return null;
}

function notifyTelegram(text) {
  if (NO_NOTIFY) return;
  const out = spawnSync(process.execPath, [NOTIFY_SCRIPT, "--stdin"], {
    input: text,
    encoding: "utf8",
  });
  if (VERBOSE) log("notify:", out.stdout?.trim() || out.stderr?.trim());
}

function reapMcp(procs, allProcMap, protect) {
  // Group MCP processes by their per-session claude.exe ancestor PID.
  // Keep the YOUNGEST group (most recent session claude.exe). Kill all other
  // groups whose session claude.exe is >= MCP_SESSION_MIN_AGE_SEC old.
  const now = Date.now();
  const grouped = new Map(); // sessionPid -> { sessionProc, members: [{proc, category}] }
  const ungrouped = [];
  const freshLockTokens = getFreshLockTokens();
  const nodeCmdByPid = new Map(procs.map((p) => [p.pid, p.cmd]));

  for (const p of procs) {
    if (protect.has(p.pid)) continue;
    const cat = classifyMcp(p);
    if (!cat) continue;
    const session = findSessionClaudeAncestor(p.pid, allProcMap);
    if (!session) {
      // No per-session claude.exe found → treat as ungrouped; only kill if
      // age >= floor to be safe.
      ungrouped.push({ proc: p, category: cat });
      continue;
    }
    if (!grouped.has(session.pid)) {
      grouped.set(session.pid, { sessionProc: session, members: [] });
    }
    grouped.get(session.pid).members.push({ proc: p, category: cat });
  }

  if (grouped.size === 0 && ungrouped.length === 0) return [];

  // Identify youngest session (most recent createdMs).
  let youngestSessionPid = -1;
  let youngestCreated = -Infinity;
  for (const [sessionPid, g] of grouped) {
    if (g.sessionProc.createdMs > youngestCreated) {
      youngestCreated = g.sessionProc.createdMs;
      youngestSessionPid = sessionPid;
    }
  }

  const killed = [];
  for (const [sessionPid, g] of grouped) {
    if (sessionPid === youngestSessionPid) continue; // protect current session
    const lockToken = findAncestorLockToken(
      sessionPid,
      allProcMap,
      nodeCmdByPid
    );
    if (lockToken && freshLockTokens.has(lockToken)) {
      log(
        `session claude.exe PID=${sessionPid} protected: active lock token=${lockToken}`
      );
      continue;
    }
    const sessionAgeSec = (now - g.sessionProc.createdMs) / 1000;
    if (sessionAgeSec < MCP_SESSION_MIN_AGE_SEC) continue; // too fresh
    for (const m of g.members) {
      killed.push({
        pid: m.proc.pid,
        category: m.category.name,
        reason: `stale-session(claude.exe PID=${sessionPid}, age=${sessionAgeSec.toFixed(0)}s)`,
        ppid: m.proc.ppid,
      });
      if (!DRY_RUN) killTree(m.proc.pid);
    }
    // Also kill the cmd.exe wrappers so they don't keep restarting the MCP.
    // Do NOT kill the per-session claude.exe — Claude Code host may still
    // depend on it for IPC and we don't want to destabilize the UI; once its
    // children are gone it holds nothing meaningful and Claude Code can
    // reclaim it on its own schedule.
    for (const m of g.members) {
      const wrapper = allProcMap.get(m.proc.ppid);
      if (wrapper && wrapper.name === "cmd.exe") {
        killed.push({
          pid: wrapper.pid,
          category: "mcp-wrapper",
          reason: `stale-session(claude.exe PID=${sessionPid})`,
          ppid: wrapper.ppid,
        });
        if (!DRY_RUN) killTree(wrapper.pid);
      }
    }
  }

  // Ungrouped MCP (no claude.exe ancestor) may be active Codex worker/verifier
  // infrastructure rather than an abandoned Claude Code triplet. If its parent
  // is alive, use a much higher age floor. If the parent is gone, keep the old
  // 4x MCP threshold so real orphans are still cleaned up.
  for (const u of ungrouped) {
    const lockToken = findAncestorLockToken(
      u.proc.pid,
      allProcMap,
      nodeCmdByPid
    );
    if (lockToken && freshLockTokens.has(lockToken)) {
      log(
        `ungrouped PID=${u.proc.pid} protected: active lock token=${lockToken}`
      );
      continue;
    }
    const parentAlive = allProcMap.has(u.proc.ppid);
    const minAgeSec = parentAlive
      ? UNGROUPED_MCP_MIN_AGE_SEC
      : MCP_SESSION_MIN_AGE_SEC * 4;
    if (u.proc.ageSec < minAgeSec) continue;
    killed.push({
      pid: u.proc.pid,
      category: u.category.name,
      reason: `ungrouped-aged(${u.proc.ageSec.toFixed(0)}s,min=${minAgeSec}s,parent=${
        parentAlive ? "alive" : "dead"
      })`,
      ppid: u.proc.ppid,
    });
    if (!DRY_RUN) killTree(u.proc.pid);
  }

  return killed;
}

// orica-supervisor.lock.json -> "supervisor"; orica-supervisor.<lane>.lock.json -> "<lane>".
function laneFromLockFile(name) {
  const m = name.match(/^orica-supervisor(?:\.(.+))?\.lock\.json$/);
  if (!m) return null;
  return m[1] || "supervisor";
}

// Tokens of currently-live (actively heartbeating) lane locks. Delegates the
// stale-or-not decision to `supervisor-lock.mjs status` (the lock SSOT, same
// one reapSupervisorLocks() uses) so this file never redefines "stale" itself.
// Used to protect MCP session/process groups that belong to a still-running
// engine/supervisor worker even when they are not the single youngest group.
function getFreshLockTokens() {
  const tokens = new Set();
  let entries;
  try {
    entries = readdirSync(LOCK_DIR);
  } catch (error) {
    log("lock dir unreadable (lock-token protect):", LOCK_DIR, error?.message);
    return tokens;
  }
  for (const name of entries) {
    const lane = laneFromLockFile(name);
    if (!lane) continue;
    const out = spawnSync(
      process.execPath,
      [LOCK_SCRIPT, "status", "--lane", lane, "--ttl", String(LOCK_STALE_MIN)],
      {
        encoding: "utf8",
        env: { ...process.env, ORICA_SUPERVISOR_LOCK_DIR: LOCK_DIR },
      }
    );
    const text = `${out.stdout ?? ""}${out.stderr ?? ""}`.trim();
    // supervisor-lock.mjs status: exit 0 == free or STALE (nothing to protect);
    // exit 1 + "held" == actively heartbeating within --ttl (see case "status"
    // in supervisor-lock.mjs, process.exitCode = stale ? 0 : 1).
    if (out.status !== 1 || !/\bheld\b/.test(text)) continue;
    try {
      const raw = readFileSync(join(LOCK_DIR, name), "utf8");
      const data = JSON.parse(raw);
      if (data?.token) tokens.add(String(data.token));
    } catch (error) {
      log("lock token read failed:", name, error?.message);
    }
  }
  return tokens;
}

// Walk ancestors of `pid` (via allProcMap, which covers every process type —
// cmd.exe/claude.exe/codex.exe hops included, not just node.exe) looking for
// a node.exe process (present in nodeCmdByPid, built from the vitest/MCP
// lister's `procs`) whose command line carries `--lock-token <token>`. That
// identifies the worker-claude-stream.mjs / worker-codex-stream.mjs driver
// that owns this MCP session, if any.
function findAncestorLockToken(pid, allProcMap, nodeCmdByPid) {
  let cur = pid;
  for (let i = 0; i < 24 && cur > 0; i++) {
    const cmd = nodeCmdByPid.get(cur);
    if (cmd) {
      const m = cmd.match(/--lock-token\s+(\S+)/);
      if (m) return m[1];
    }
    cur = allProcMap.get(cur)?.ppid ?? 0;
  }
  return null;
}

// Enumerate lane lock files and delegate the stale-or-not decision + freeing to
// supervisor-lock.mjs (the lock SSOT). The watchdog never inspects mtime itself,
// so there is only one place that defines "stale". In dry-run we call `status`
// (exit 0 == stale) instead of `reap` so nothing is freed.
function reapSupervisorLocks() {
  let entries;
  try {
    entries = readdirSync(LOCK_DIR);
  } catch (error) {
    log("lock dir unreadable:", LOCK_DIR, error?.message);
    return [];
  }
  const reaped = [];
  for (const name of entries) {
    const lane = laneFromLockFile(name);
    if (!lane) continue;
    const cmd = DRY_RUN ? "status" : "reap";
    const out = spawnSync(
      process.execPath,
      [LOCK_SCRIPT, cmd, "--lane", lane, "--ttl", String(LOCK_STALE_MIN)],
      {
        encoding: "utf8",
        env: { ...process.env, ORICA_SUPERVISOR_LOCK_DIR: LOCK_DIR },
      }
    );
    const text = `${out.stdout ?? ""}${out.stderr ?? ""}`
      .trim()
      .replace(/\s+/g, " ");
    log(`${cmd} lane=${lane} exit=${out.status} -> ${text}`);
    // reap: exit 0 + "reaped (janitor)" == a stale lock was freed.
    // status (dry-run): exit 0 + "STALE" == would be reaped.
    const didReap =
      !DRY_RUN && out.status === 0 && /reaped \(janitor\)/.test(text);
    const wouldReap = DRY_RUN && out.status === 0 && /\bSTALE\b/.test(text);
    if (didReap || wouldReap) {
      reaped.push({
        pid: 0,
        category: "supervisor-lock",
        reason: `lane=${lane} staleMin=${LOCK_STALE_MIN} ${text}`,
        ppid: 0,
      });
    }
  }
  return reaped;
}

function main() {
  const protect = selfAncestors();
  const isWin = platform() === "win32";
  const procs = isWin ? listNodeProcessesWindows() : listNodeProcessesPosix();
  const allProcMap =
    (INCLUDE_MCP || INCLUDE_CLI) && isWin
      ? listAllProcessesWindows()
      : new Map();

  const killed = [];
  killed.push(
    ...reapOrphanedVitest({
      protectedPids: protect,
      killProcess: killTree,
      dryRun: DRY_RUN,
      log,
    })
  );
  if (INCLUDE_MCP) {
    if (!isWin) {
      log("--include-mcp is currently Windows-only; skipping");
    } else {
      killed.push(...reapMcp(procs, allProcMap, protect));
    }
  }
  if (INCLUDE_CLI) {
    if (!isWin) {
      log("--include-cli-sessions is currently Windows-only; skipping");
    } else {
      const protectFull = new Set([
        ...protect,
        ...fullSelfAncestry(allProcMap),
      ]);
      killed.push(
        ...reapCliSessions(listClaudeCliSessionsWindows(), protectFull)
      );
    }
  }
  if (INCLUDE_LOCKS) {
    killed.push(...reapSupervisorLocks());
  }

  if (killed.length === 0) {
    log("clean: no stale processes");
    return;
  }

  const verb = DRY_RUN ? "would kill" : "killed";
  const summary = [
    `[watchdog] ${verb} ${killed.length} stale process(es) on ${new Date().toISOString()}`,
    ...killed.map(
      (k) => `  ${k.category} PID=${k.pid} ppid=${k.ppid} (${k.reason})`
    ),
  ].join("\n");
  console.log(summary);
  if (!DRY_RUN) notifyTelegram(summary);
}

main();
