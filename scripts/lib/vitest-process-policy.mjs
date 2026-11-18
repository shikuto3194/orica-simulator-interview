import { readWindowsProcesses } from "../harness/recover-gate-lease.mjs";

// CPU time and age are not evidence of abandonment: fuzz and full verification
// legitimately exceed both old limits. Keep a process unless its parent is
// confirmed dead and two complete censuses identify the same orphan.
const VITEST_PATH =
  /node_modules[\\/][^\s"']*(?:vitest[\\/](?:vitest\.mjs|dist[\\/])|tinypool[\\/]+dist[\\/]+entry[\\/]+process\.js)|[\\/]\.bin[\\/]vitest(?:\.(?:cmd|ps1|mjs|js))?(?:\s|"|$)/i;
const COORDINATOR =
  /(?:run-gates|run-fuzz|codex-finish-check|worker-(?:codex|claude)-stream|spawn-verifier|supervisor-integration)\.mjs|(?:auto-merge|run-supervisor-iteration)\.ps1/i;

function parentState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code === "ESRCH" ? "dead" : "unknown";
  }
}

function censusUsable(rows) {
  return (
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every(
      (row) =>
        Number.isInteger(row.pid) &&
        Number.isInteger(row.parentPid) &&
        typeof row.name === "string"
    )
  );
}

function validationMayBeActive(rows) {
  return rows.some((row) => {
    if (!/^(?:node|cmd|pwsh|powershell|pnpm|npm)(?:\.exe)?$/i.test(row.name))
      return false;
    // A missing command may be an inaccessible lease holder. Preserve it and
    // its possible descendants; never interpret partial process data as idle.
    return (
      typeof row.commandLine !== "string" ||
      !row.commandLine.trim() ||
      COORDINATOR.test(row.commandLine)
    );
  });
}

export function reapOrphanedVitest({
  readProcesses = readWindowsProcesses,
  inspectParent = parentState,
  killProcess,
  protectedPids = new Set([process.pid, process.ppid]),
  now = Date.now(),
  dryRun = false,
  log = () => {},
} = {}) {
  const killed = [];
  try {
    const before = readProcesses();
    if (!censusUsable(before) || validationMayBeActive(before)) return killed;
    for (const candidate of before) {
      const born = Date.parse(candidate.processStartedAt);
      if (
        protectedPids.has(candidate.pid) ||
        !/^node(?:\.exe)?$/i.test(candidate.name) ||
        !VITEST_PATH.test(candidate.commandLine || "") ||
        candidate.parentPid <= 0 ||
        before.some((row) => row.pid === candidate.parentPid) ||
        !Number.isFinite(born) ||
        now - born < 60_000 ||
        inspectParent(candidate.parentPid) !== "dead"
      )
        continue;
      const after = readProcesses();
      if (!censusUsable(after) || validationMayBeActive(after)) return killed;
      const current = after.find((row) => row.pid === candidate.pid);
      if (
        !current ||
        current.processStartedAt !== candidate.processStartedAt ||
        current.parentPid !== candidate.parentPid ||
        current.name !== candidate.name ||
        current.commandLine !== candidate.commandLine ||
        after.some((row) => row.pid === candidate.parentPid) ||
        inspectParent(candidate.parentPid) !== "dead"
      )
        continue;
      if (!dryRun && killProcess(candidate.pid) === false) continue;
      killed.push({
        pid: candidate.pid,
        ppid: candidate.parentPid,
        category: "vitest/tinypool",
        reason: "confirmed-orphan (stable process identity; parent absent)",
      });
    }
  } catch (error) {
    // Windows census is the supported automatic cleanup path. On other OSes,
    // access denial, or malformed data, retain processes for manual inspection.
    log("vitest cleanup deferred:", error.message);
  }
  return killed;
}
