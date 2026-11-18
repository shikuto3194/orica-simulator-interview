#!/usr/bin/env node
// Explicit cleanup shares the watchdog's conservative orphan policy. Long
// running tests and live validation/worker lease holders are always preserved.
import { spawnSync } from "node:child_process";
import { reapOrphanedVitest } from "./lib/vitest-process-policy.mjs";

const dryRun = process.argv.includes("--dry-run");
const verbose = process.env.REAP_VERBOSE === "1";
const killed = reapOrphanedVitest({
  dryRun,
  log: (...args) => {
    if (verbose) console.log("[reap]", ...args);
  },
  killProcess: (pid) => {
    const result = spawnSync(
      "taskkill.exe",
      ["/F", "/T", "/PID", String(pid)],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      }
    );
    return result.status === 0 && !result.error;
  },
});
for (const item of killed)
  console.log(
    `[reap] ${dryRun ? "would kill" : "killed"} PID=${item.pid} ppid=${item.ppid} (${item.reason})`
  );
if (!killed.length && verbose)
  console.log("[reap] no confirmed orphaned vitest/tinypool processes");
