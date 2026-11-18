import { spawnSync } from "node:child_process";
import { openSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gateLeasePath } from "./gate-lease.mjs";

function ownerState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code === "ESRCH" ? "dead" : "unknown";
  }
}

export function readWindowsProcesses() {
  // Run outside the worker sandbox, in the scheduled wrapper. Never log command
  // lines: they may contain secrets. Missing process information is not absence.
  if (process.platform !== "win32")
    throw new Error("automatic lease recovery requires Windows process census");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); @(Get-CimInstance Win32_Process | Select-Object @{n='pid';e={$_.ProcessId}},@{n='parentPid';e={$_.ParentProcessId}},@{n='name';e={$_.Name}},@{n='commandLine';e={$_.CommandLine}},@{n='processStartedAt';e={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null}}}) | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 8e6 }
  );
  if (result.error || result.status !== 0)
    throw new Error("could not inspect validation processes");
  let rows;
  try {
    rows = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  } catch {
    // JSON parse errors can quote the command line that failed to decode.
    throw new Error("could not decode validation process census");
  }
  if (
    !Array.isArray(rows) ||
    !rows.some((row) => row.pid === process.pid) ||
    rows.some(
      (row) =>
        !Number.isInteger(row.pid) ||
        !Number.isInteger(row.parentPid) ||
        typeof row.name !== "string"
    )
  )
    throw new Error("incomplete validation process census");
  return rows;
}

// A dev server created before this lease cannot be a child left behind by its
// validator. Recognize only a standalone Vite CLI, not arbitrary shell code or
// a build/test command that happens to mention a Vite configuration file.
function olderViteServer(owner, row) {
  const started = Date.parse(row.processStartedAt);
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(owner.started) ||
    started >= owner.started
  )
    return false;
  let command = row.commandLine;
  if (/[;&|`<>\r\n]/.test(command)) return false;
  const split = (text) => {
    if ((text.match(/"/g) || []).length % 2) return [];
    return Array.from(
      text.matchAll(/"([^"]*)"|([^\s"]+)/g),
      (match) => match[1] ?? match[2]
    );
  };
  const name = (value = "") =>
    value.replace(/\\/g, "/").split("/").at(-1).toLowerCase();
  let args = split(command);
  if (name(args[0]) === "cmd.exe" || name(args[0]) === "cmd") {
    const invoke = command.match(/\s\/(?:c|k)\s+([\s\S]+)$/i);
    if (!invoke) return false;
    command = invoke[1];
    if (command.startsWith('"') && command.endsWith('"'))
      command = command.slice(1, -1);
    args = split(command);
  }
  if (/^node(?:\.exe)?$/.test(name(args[0]))) {
    args.shift();
    if (name(args[0]) === "npx-cli.js") args.shift();
    else if (/[/\\]vite[/\\]bin[/\\]vite\.(?:m?js|cjs)$/i.test(args[0] || ""))
      args[0] = "vite";
    else return false;
  } else if (/^npx(?:\.cmd|\.exe)?$/.test(name(args[0]))) args.shift();
  if (!/^vite(?:\.cmd|\.exe)?$/.test(name(args.shift()))) return false;
  if (args[0] === "dev" || args[0] === "serve") args.shift();
  for (let i = 0; i < args.length; i++) {
    if (/^--(?:strictPort|clearScreen)$/.test(args[i])) continue;
    if (/^--(?:config|port|host|mode|base)=.+$/.test(args[i])) continue;
    if (
      /^(?:--(?:config|port|host|mode|base)|-c)$/.test(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith("-")
    ) {
      i++;
      continue;
    }
    return false;
  }
  return true;
}

export function recoveryBlocker(owner, processes) {
  if (!Array.isArray(processes) || processes.length === 0)
    return "process census is empty";
  for (const row of processes) {
    if (row.pid === owner.pid || row.parentPid === owner.pid)
      return `owner or child process ${row.pid} is still alive`;
    // An exited intermediate shell can hide grandchildren from a parent walk.
    // Conservatively defer while any validator is running, even in another repo.
    // A positively identified older standalone Vite server is not a validator.
    if (!/^(?:node|cmd|pwsh|powershell|pnpm|npm)(?:\.exe)?$/i.test(row.name))
      continue;
    if (typeof row.commandLine !== "string" || !row.commandLine.trim())
      return `cannot inspect command for process ${row.pid}`;
    if (
      /(?:run-gates\.mjs|vitest|tinypool|\bscripts[\\/](?:test-|check-|fuzz|harness[\\/](?:check-|codex-finish-check))|[\\/](?:tsc|eslint|prettier|playwright)(?:\.|[\\/]|["'\s]|$)|\b(?:pnpm|npm)(?:\.(?:cmd|c?js))?["']?\s+(?:run|test|exec|verify|check|fuzz|lint|format|build|codex:finish-check))/i.test(
        row.commandLine
      ) ||
      (/(?:[\\/]vite(?:\.|[\\/]|["'\s]|$)|(?:^|[\s"'])vite(?:\.cmd)?(?=[\s"']|$))/i.test(
        row.commandLine
      ) &&
        !olderViteServer(owner, row))
    )
      return `validation process ${row.pid} is still running`;
  }
  return null;
}

export function recoverGateLease(
  root,
  { inspectOwner = ownerState, readProcesses = readWindowsProcesses } = {}
) {
  const file = gateLeasePath(root);
  const read = () => {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  if (read() === null) return { status: "free", file };
  // Serialize recoverers. A crashed recoverer leaves a guard for manual review,
  // never permission to remove another process's lease.
  const guard = `${file}.recovery`;
  let fd;
  try {
    fd = openSync(guard, "wx");
  } catch (error) {
    if (error.code === "EEXIST")
      return {
        status: "blocked",
        file,
        reason: "recovery already in progress",
      };
    throw error;
  }
  try {
    const raw = read();
    if (raw === null) return { status: "free", file };
    const owner = JSON.parse(raw);
    if (
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.token !== "string" ||
      !owner.token ||
      typeof owner.root !== "string" ||
      gateLeasePath(owner.root) !== file ||
      !Number.isFinite(owner.started)
    )
      throw new Error("invalid lease ownership metadata");
    const before = inspectOwner(owner.pid);
    if (before === "alive") return { status: "active", file };
    if (before !== "dead") throw new Error("cannot confirm owner has exited");
    if (Date.now() - owner.started < 60_000)
      throw new Error("recently created lease; defer recovery");
    const blocker = recoveryBlocker(owner, readProcesses());
    if (blocker) throw new Error(blocker);
    // Check again after the census, including byte identity to preserve a new
    // owner, a refreshed lease, or a manually replaced file.
    if (inspectOwner(owner.pid) !== "dead" || read() !== raw)
      throw new Error("lease or owner changed during inspection");
    unlinkSync(file);
    return { status: "recovered", file, ownerPid: owner.pid };
  } catch (error) {
    return { status: "blocked", file, reason: error.message };
  } finally {
    closeSync(fd);
    unlinkSync(guard);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const index = process.argv.indexOf("--root");
    if (index < 0 || !process.argv[index + 1])
      throw new Error("--root required");
    const result = recoverGateLease(resolve(process.argv[index + 1]));
    console.log(`[verify-recovery] ${JSON.stringify(result)}`);
    if (result.status === "blocked") process.exitCode = 1;
  } catch (error) {
    console.error(`[verify-recovery] ${error.message}`);
    process.exitCode = 1;
  }
}
