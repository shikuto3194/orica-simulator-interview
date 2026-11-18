import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The classification backlog: paths whose change fell back to every gate
 * without a reviewed scope. One JSON line per event, shared by every worktree
 * through the primary checkout's ignored logs/ folder (a tracked file would
 * dirty the publishing tree). The classifier agent procedure is
 * manual/ai-reference/00_meta/gate-classification-queue.md.
 *
 *   {file, reason, status:"open", detectedAt, branch, commit}
 *   {file, reason, status:"resolved", resolvedAt, commit}   closes it
 */
const git = (root, args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();

export function queuePath(root) {
  const primary = dirname(
    resolve(
      git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    )
  );
  return join(primary, "logs/harness/unclassified-queue.jsonl");
}

export function readQueue(file) {
  if (!existsSync(file)) return [];
  const latest = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.file && event.reason)
      latest.set(`${event.reason}\0${event.file}`, event);
  }
  return [...latest.values()];
}

/** Append the findings that are not already open. Returns the new entries. */
export function enqueueFindings(root, findings, now = new Date()) {
  const file = queuePath(root);
  const open = new Set(
    readQueue(file)
      .filter((event) => event.status === "open")
      .map((event) => `${event.reason}\0${event.file}`)
  );
  const fresh = findings.filter(
    (finding) => !open.has(`${finding.reason}\0${finding.file}`)
  );
  if (fresh.length === 0) return [];
  const origin = {
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: git(root, ["rev-parse", "--short", "HEAD"]),
  };
  mkdirSync(dirname(file), { recursive: true });
  const entries = fresh.map((finding) => ({
    file: finding.file,
    reason: finding.reason,
    status: "open",
    detectedAt: now.toISOString(),
    ...origin,
  }));
  appendFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return entries;
}

export function resolveFindings(root, files, now = new Date()) {
  const file = queuePath(root);
  const open = readQueue(file).filter(
    (event) => event.status === "open" && files.includes(event.file)
  );
  if (open.length === 0) return [];
  const commit = git(root, ["rev-parse", "--short", "HEAD"]);
  const closed = open.map((event) => ({
    file: event.file,
    reason: event.reason,
    status: "resolved",
    resolvedAt: now.toISOString(),
    commit,
  }));
  appendFileSync(file, closed.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return closed;
}
