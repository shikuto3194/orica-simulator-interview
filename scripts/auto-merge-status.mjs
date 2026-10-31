import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import state from "./harness/verification-state.cjs";
import {
  fetchMain,
  ancestor,
  assertPublicationGuard,
} from "./remote-main-integration.mjs";

const terminal = new Set(["completed", "failed", "local_only"]);
const hash = (s) => /^[a-f0-9]{40}$/.test(s || "");
export function recordAutoMerge(
  repo,
  input,
  { now = new Date().toISOString() } = {}
) {
  repo = resolve(repo);
  if (
    !/^[a-f0-9-]{32,36}$/.test(input.id || "") ||
    !Number.isInteger(input.pid) ||
    input.pid <= 0
  )
    throw new Error("Invalid auto-merge identity");
  if (!["running", ...terminal].includes(input.status) || !input.phase)
    throw new Error("Invalid auto-merge status");
  if (input.observedRemote && !hash(input.observedRemote))
    throw new Error("Invalid observed remote");
  const file = join(repo, "logs/auto-merge-runs", input.id + ".json");
  const before = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : null;
  const binding = {
    id: input.id,
    repo,
    workdir: resolve(input.workdir),
    pid: input.pid,
    branch: input.branch,
  };
  if (
    before &&
    Object.keys(binding).some((key) => before[key] !== binding[key])
  )
    throw new Error("Auto-merge owner binding changed");
  const cleanupFailure =
    before &&
    ["completed", "local_only"].includes(before.status) &&
    input.status === "failed" &&
    input.phase === "merge_lock_cleanup" &&
    input.exitCode !== 0 &&
    input.head === before.head &&
    input.sourceHead === before.sourceHead;
  if (before && terminal.has(before.status) && !cleanupFailure)
    throw new Error("Auto-merge attempt already finished");
  const entry = {
    schemaVersion: 1,
    ...binding,
    startedAt: before?.startedAt || now,
    status: input.status,
    phase: input.phase,
    head: input.head || null,
    sourceHead: input.sourceHead || null,
    observedRemote: input.observedRemote || null,
    candidate: input.candidate || null,
    exitCode: input.exitCode ?? null,
    error: input.error || null,
    updatedAt: now,
    phaseStartedAt: before?.phase === input.phase ? before.phaseStartedAt : now,
  };
  if (terminal.has(input.status)) entry.finishedAt = now;
  if (input.status === "completed") {
    if (!hash(input.head) || !hash(input.sourceHead))
      throw new Error(
        "Completed merge requires exact source and published heads"
      );
    if (typeof input.publicationGuard !== "string" || !input.publicationGuard)
      throw new Error("Completed merge requires a publication guard");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    );
    const git = (...args) =>
      execFileSync("git", ["-C", repo, ...args], {
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
      }).trim();
    const local = git("rev-parse", "refs/heads/main");
    const remote = fetchMain(repo);
    if (local !== input.head || !ancestor(repo, input.head, remote))
      throw new Error("Publication does not match local and remote main");
    entry.remoteHead = remote;
    entry.publishedHead = input.head;
    assertPublicationGuard(input.publicationGuard, {
      attemptId: input.id,
      workdir: input.workdir,
      sourceHead: input.sourceHead,
      publishedHead: input.head,
    });
    entry.publicationGuard = input.publicationGuard;
    entry.publicationVerified = true;
  }
  state.atomicJson(file, entry);
  return entry;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0 || !args[i + 1]) throw new Error(`Missing ${flag}`);
    return args[i + 1];
  };
  try {
    if (args[0] !== "record")
      throw new Error(
        "Usage: auto-merge-status.mjs record --repo ... --id ... --pid ... --status ... --phase ..."
      );
    const entry = recordAutoMerge(value("--repo"), {
      id: value("--id"),
      pid: Number(value("--pid")),
      workdir: value("--workdir"),
      branch: value("--branch"),
      status: value("--status"),
      phase: value("--phase"),
      head: args.includes("--head") ? value("--head") : null,
      sourceHead: args.includes("--source-head")
        ? value("--source-head")
        : null,
      observedRemote: args.includes("--observed-remote")
        ? value("--observed-remote")
        : null,
      candidate: args.includes("--candidate")
        ? JSON.parse(value("--candidate"))
        : null,
      publicationGuard: args.includes("--publication-guard")
        ? value("--publication-guard")
        : null,
      exitCode: args.includes("--exit-code")
        ? Number(value("--exit-code"))
        : null,
      error: args.includes("--error") ? value("--error").slice(0, 1000) : null,
    });
    console.log(
      `[auto-merge-status] ${entry.status}: ${entry.phase}; id=${entry.id}`
    );
  } catch (error) {
    console.error(`[auto-merge-status] ${error.message}`);
    process.exitCode = 1;
  }
}
