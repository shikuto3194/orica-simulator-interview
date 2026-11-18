#!/usr/bin/env node
// Recover only an unchanged checkout of a known main tip. Never reset/stash or
// merge divergent histories here; those require reviewed integration.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

function git(repo, args, allowed = [0]) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  const result = spawnSync("git", ["-C", repo, ...args], {
    env,
    encoding: "utf8",
  });
  if (!allowed.includes(result.status)) {
    throw new Error(
      `git ${args.join(" ")}: ${result.stderr || result.error || result.status}`
    );
  }
  return { code: result.status, text: result.stdout.trim() };
}

export function inspectGitOperation(repo) {
  const markers = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "BISECT_START",
    "index.lock",
  ];
  // Resolve every per-worktree marker in one Git process. Do not infer .git
  // paths or cache them across calls: a later merge/rebase must still stop us.
  const paths = git(repo, [
    "rev-parse",
    "--path-format=absolute",
    ...markers.flatMap((marker) => ["--git-path", marker]),
  ]).text.split(/\r?\n/);
  if (paths.length !== markers.length || paths.some((path) => !path))
    throw new Error("Incomplete Git operation paths");
  for (let index = 0; index < markers.length; index++) {
    if (existsSync(resolve(repo, paths[index]))) return markers[index];
  }
  return null;
}

export function inspectPrimaryMain(repo) {
  const branch = git(
    repo,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    [0, 1]
  ).text;
  const head = git(repo, ["rev-parse", "HEAD"]).text;
  const main = git(repo, ["rev-parse", "refs/heads/main"]).text;
  const state = { ready: false, recoverable: false, branch, head, main };
  const operation = inspectGitOperation(repo);
  if (operation)
    return { ...state, reason: `operation-in-progress: ${operation}` };
  if (git(repo, ["status", "--porcelain", "--untracked-files=all"]).text) {
    return { ...state, reason: "primary-dirty" };
  }
  if (branch === "main") return { ...state, ready: true, reason: "ready" };
  if (branch) return { ...state, reason: `interactive-branch: ${branch}` };
  if (head === main)
    return { ...state, recoverable: true, reason: "detached-main" };
  const remote = git(
    repo,
    ["rev-parse", "--verify", "refs/remotes/origin/main"],
    [0, 128]
  ).text;
  if (!remote || head !== remote)
    return { ...state, reason: "detached-unrecognized" };
  if (
    git(repo, ["merge-base", "--is-ancestor", main, head], [0, 1]).code !== 0
  ) {
    return {
      ...state,
      reason:
        "main-diverged: preserve and merge local main and origin/main before retrying",
    };
  }
  return { ...state, recoverable: true, reason: "detached-origin-main" };
}

export function restorePrimaryMain(repo) {
  const initial = inspectPrimaryMain(repo);
  if (!initial.recoverable) return initial;
  const token = randomUUID();
  const lockScript = fileURLToPath(
    new URL("./supervisor-lock.mjs", import.meta.url)
  );
  function lock(command) {
    return spawnSync(
      process.execPath,
      [
        lockScript,
        command,
        "--lane",
        "merge",
        "--token",
        token,
        "--label",
        "primary-main recovery",
        "--ttl",
        "20",
      ],
      { encoding: "utf8" }
    );
  }
  const acquired = lock("acquire");
  if (acquired.status !== 0) {
    return {
      ...initial,
      recoverable: false,
      reason: `merge-lock-unavailable: ${acquired.stderr.trim()}`,
    };
  }
  function restoreLocked() {
    const current = inspectPrimaryMain(repo);
    if (JSON.stringify(current) !== JSON.stringify(initial)) {
      return {
        ...current,
        ready: false,
        reason: "primary-changed-during-recovery",
      };
    }
    // Another worktree may own main even while this checkout is detached.
    const worktrees = git(repo, ["worktree", "list", "--porcelain"]).text;
    if (worktrees.split(/\r?\n/).includes("branch refs/heads/main")) {
      return {
        ...current,
        recoverable: false,
        reason: "main-checked-out-elsewhere",
      };
    }
    if (lock("refresh").status !== 0)
      throw new Error("merge lock ownership lost");
    if (current.main !== current.head) {
      git(repo, [
        "update-ref",
        "-m",
        "primary-main: recover detached origin/main",
        "refs/heads/main",
        current.head,
        current.main,
      ]);
    }
    git(repo, ["switch", "main"]);
    const restored = inspectPrimaryMain(repo);
    if (!restored.ready || restored.head !== initial.head)
      throw new Error("primary changed during branch attachment");
    return { ...restored, restored: true };
  }
  let result, released;
  try {
    result = restoreLocked();
  } finally {
    released = lock("release");
  }
  if (released.status !== 0)
    throw new Error(`merge lock release failed: ${released.stderr}`);
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    const repoIndex = args.indexOf("--repo");
    const repo = repoIndex < 0 ? process.cwd() : args[repoIndex + 1];
    if (!repo) throw new Error("--repo requires a path");
    const state = args.includes("--restore")
      ? restorePrimaryMain(repo)
      : inspectPrimaryMain(repo);
    console.log(JSON.stringify(state));
    if (!state.ready) process.exitCode = 2;
  } catch (error) {
    console.error(`[primary-main] ${error.message}`);
    process.exitCode = 2;
  }
}
