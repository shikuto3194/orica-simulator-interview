#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { inspectPrimaryMain, restorePrimaryMain } from "./primary-main.mjs";

const temp = mkdtempSync(join(tmpdir(), "orica-primary-main-"));
const lockDir = join(temp, "locks");
mkdirSync(lockDir);
const oldLockDir = process.env.ORICA_SUPERVISOR_LOCK_DIR;
const oldLock = process.env.ORICA_SUPERVISOR_LOCK;
process.env.ORICA_SUPERVISOR_LOCK_DIR = lockDir;
delete process.env.ORICA_SUPERVISOR_LOCK;
const lockScript = fileURLToPath(
  new URL("./supervisor-lock.mjs", import.meta.url)
);
let count = 0;
function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function fixture() {
  const repo = join(temp, `repo-${++count}`);
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "core.hooksPath", join(temp, "no-hooks"));
  writeFileSync(join(repo, "file.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  return repo;
}
function snapshot(repo) {
  return [
    git(repo, "rev-parse", "HEAD", "main"),
    git(repo, "status", "--porcelain"),
    readFileSync(join(repo, "file.txt"), "utf8"),
  ];
}
function blocked(repo, reason) {
  const before = snapshot(repo);
  assert.match(restorePrimaryMain(repo).reason, reason);
  assert.deepEqual(
    snapshot(repo),
    before,
    "blocked recovery must preserve refs, index and files"
  );
}

try {
  const repo = fixture();
  assert.equal(inspectPrimaryMain(repo).ready, true);
  git(repo, "switch", "--detach");
  const head = git(repo, "rev-parse", "HEAD");
  assert.equal(inspectPrimaryMain(repo).recoverable, true);
  assert.equal(
    git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
    "HEAD",
    "inspection is read-only"
  );
  assert.equal(restorePrimaryMain(repo).restored, true);
  assert.equal(git(repo, "branch", "--show-current"), "main");
  assert.equal(git(repo, "rev-parse", "HEAD"), head);

  git(repo, "switch", "--detach");
  writeFileSync(join(repo, "file.txt"), "remote update\n");
  git(repo, "commit", "-am", "remote tip");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  const remoteTip = git(repo, "rev-parse", "HEAD");
  assert.equal(restorePrimaryMain(repo).restored, true);
  assert.equal(git(repo, "rev-parse", "main"), remoteTip);
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "remote update\n");

  git(repo, "switch", "--detach");
  writeFileSync(join(repo, "file.txt"), "unfinished\n");
  blocked(repo, /primary-dirty/);
  git(repo, "add", "file.txt");
  blocked(repo, /primary-dirty/);
  git(repo, "commit", "-m", "unique detached work");
  blocked(repo, /detached-unrecognized/);

  const untracked = fixture();
  git(untracked, "switch", "--detach");
  writeFileSync(join(untracked, "new.txt"), "keep me");
  blocked(untracked, /primary-dirty/);
  assert.equal(readFileSync(join(untracked, "new.txt"), "utf8"), "keep me");

  const interactive = fixture();
  git(interactive, "switch", "-c", "feature");
  blocked(interactive, /interactive-branch/);

  const diverged = fixture();
  const base = git(diverged, "rev-parse", "HEAD");
  writeFileSync(join(diverged, "file.txt"), "unpublished main\n");
  git(diverged, "commit", "-am", "local main work");
  git(diverged, "switch", "--detach", base);
  writeFileSync(join(diverged, "file.txt"), "published PR\n");
  git(diverged, "commit", "-am", "remote PR");
  git(diverged, "update-ref", "refs/remotes/origin/main", "HEAD");
  blocked(diverged, /main-diverged/);

  const active = fixture();
  git(active, "switch", "--detach");
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_START",
    "index.lock",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ]) {
    const path = join(active, ".git", marker);
    writeFileSync(path, git(active, "rev-parse", "HEAD"));
    assert.match(restorePrimaryMain(active).reason, /operation-in-progress/);
    assert.equal(git(active, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
    unlinkSync(path);
  }

  const elsewhere = fixture();
  git(elsewhere, "switch", "--detach");
  git(elsewhere, "worktree", "add", join(temp, "other-main"), "main");
  blocked(elsewhere, /main-checked-out-elsewhere/);

  const busy = fixture();
  git(busy, "switch", "--detach");
  const lockArgs = ["--lane", "merge", "--token", "fixture-merge-owner"];
  execFileSync(process.execPath, [lockScript, "acquire", ...lockArgs], {
    stdio: "pipe",
  });
  try {
    blocked(busy, /merge-lock-unavailable/);
  } finally {
    execFileSync(process.execPath, [lockScript, "release", ...lockArgs], {
      stdio: "pipe",
    });
  }
  assert.equal(restorePrimaryMain(busy).restored, true);
  assert.throws(() => restorePrimaryMain(temp), /git/);

  const wrapper = readFileSync(
    new URL("./run-supervisor-iteration.ps1", import.meta.url),
    "utf8"
  );
  assert.match(wrapper, /full-run-checkouts\.mjs/);
  assert.doesNotMatch(
    wrapper,
    /primary-main\.mjs|--restore/,
    "full-run routing must preserve the primary interactive checkout"
  );
  const merge = readFileSync(
    new URL("./auto-merge.ps1", import.meta.url),
    "utf8"
  );
  assert.match(merge, /full-run-checkouts\.mjs/);
  assert.doesNotMatch(
    merge,
    /primary-main\.mjs|--restore/,
    "auto-merge must preserve the primary interactive checkout"
  );
  console.log(
    "[test-primary-main] ok (real Git: attach, fast-forward, divergence, dirty/staged/untracked, operation, worktree, lock, read failure)"
  );
} finally {
  if (oldLockDir === undefined) delete process.env.ORICA_SUPERVISOR_LOCK_DIR;
  else process.env.ORICA_SUPERVISOR_LOCK_DIR = oldLockDir;
  if (oldLock === undefined) delete process.env.ORICA_SUPERVISOR_LOCK;
  else process.env.ORICA_SUPERVISOR_LOCK = oldLock;
}
