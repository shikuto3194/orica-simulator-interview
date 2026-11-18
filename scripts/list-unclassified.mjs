#!/usr/bin/env node
/**
 * node scripts/list-unclassified.mjs [--json] [--out FILE] [--days N] [--check]
 *
 * Lists the Git-tracked paths no gate scope has decided (see classifyPath), so a
 * change that touches one silently runs every gate. Reads only.
 *
 * Per directory group: file count, commits touching it in the last N days
 * (default 90) and the expected full-gate seconds (sum of the median recorded
 * duration of every gate the full fallback runs). priority = commits * seconds,
 * the publication time an unclassified group costs per quarter.
 *
 * Reviewed-full entries (fullScopes in gate-manifest.json) are accepted but still
 * run every gate; they are listed as the narrowing backlog with the same
 * priority. --check exits 1 only when a path is unclassified (the mechanical
 * guard); reviewed-full is allowed.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fullGates } from "./harness/gate-manifest.mjs";
import { classifyPath, trackedPaths } from "./harness/path-classification.mjs";
import { gateSecondsFromTimings } from "./preflight-publish.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function groupOf(file) {
  const parts = file.split("/");
  if (parts.length === 1) return "(root)";
  const depth = /^(?:apps|packages)\//.test(file) ? 3 : 2;
  return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

export function summarize(files, commitsByFile, perGate) {
  const kinds = {};
  const groups = new Map();
  const backlog = new Map();
  const collect = (map, key, file) => {
    const group = map.get(key) ?? { group: key, files: [], commits: new Set() };
    group.files.push(file);
    for (const sha of commitsByFile.get(file) ?? []) group.commits.add(sha);
    map.set(key, group);
  };
  for (const file of files) {
    const c = classifyPath(file);
    kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    if (c.kind === "unclassified") collect(groups, groupOf(file), file);
    else if (c.kind === "reviewed-full") collect(backlog, c.id, file);
  }
  const known = fullGates.filter((id) => perGate.has(id));
  const fullSeconds = Math.round(
    known.reduce((sum, id) => sum + perGate.get(id), 0)
  );
  const unknownGates = fullGates.filter((id) => !perGate.has(id));
  const rowsOf = (map) =>
    [...map.values()]
      .map((group) => ({
        group: group.group,
        files: group.files.length,
        commits: group.commits.size,
        priority: group.commits.size * fullSeconds,
        sample: group.files.slice(0, 3),
      }))
      .sort((a, b) => b.priority - a.priority || b.files - a.files);
  const rows = rowsOf(groups);
  return {
    kinds,
    unclassified: rows.reduce((sum, row) => sum + row.files, 0),
    fullSeconds,
    fullSecondsExcludes: unknownGates,
    groups: rows,
    narrowingBacklog: rowsOf(backlog),
  };
}

function commitsTouching(days) {
  const out = execFileSync(
    "git",
    [
      "-C",
      root,
      "log",
      `--since=${days}.days`,
      "--name-only",
      "--format=%x01%H",
      "--no-renames",
    ],
    { encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true }
  );
  const byFile = new Map();
  for (const block of out.split("\x01").filter(Boolean)) {
    const [sha, ...names] = block.split(/\r?\n/);
    for (const name of names.filter(Boolean)) {
      const list = byFile.get(name) ?? new Set();
      list.add(sha.trim());
      byFile.set(name, list);
    }
  }
  return byFile;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const days = Number(args[args.indexOf("--days") + 1]) || 90;
  const primary = dirname(
    resolve(
      execFileSync(
        "git",
        ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8", windowsHide: true }
      ).trim()
    )
  );
  const perGate = gateSecondsFromTimings(
    join(primary, "logs/harness/timing"),
    join(root, "logs/harness/runs")
  );
  const files = trackedPaths(root);
  const summary = summarize(files, commitsTouching(days), perGate);
  const report = { days, tracked: files.length, ...summary };
  if (args.includes("--out"))
    writeFileSync(
      args[args.indexOf("--out") + 1],
      JSON.stringify(report, null, 2)
    );
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `tracked ${report.tracked}; ` +
        Object.entries(report.kinds)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")
    );
    console.log(
      `full fallback ~${report.fullSeconds}s of gate time` +
        (report.fullSecondsExcludes.length
          ? ` (no timing for: ${report.fullSecondsExcludes.join(", ")})`
          : "")
    );
    const print = (title, rows) => {
      console.log(title);
      for (const row of rows)
        console.log(
          `${String(row.files).padStart(5)} files  ${String(row.commits).padStart(4)} commits/${days}d  ${row.group}`
        );
    };
    print("unclassified:", report.groups);
    print(
      "reviewed-full (narrowing backlog, by commits x full seconds):",
      report.narrowingBacklog
    );
  }
  if (args.includes("--check") && report.unclassified > 0) {
    console.error(`${report.unclassified} unclassified path(s)`);
    process.exitCode = 1;
  }
}
