import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  integrationCheckout,
  assertFullRunWorker,
  inspectIntegrationCheckout,
} from "./full-run-checkouts.mjs";

const temp = mkdtempSync(join(tmpdir(), "orica-checkout-pins-"));
if (
  !resolve(temp).startsWith(
    resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")
  )
)
  throw new Error("Unexpected fixture root");
const repo = join(temp, "repo"),
  lane = join(temp, "lane"),
  main = join(temp, "main");
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
try {
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "checkout fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  mkdirSync(join(repo, "scripts"));
  const config = {
    schemaVersion: 1,
    workerWorktree: "../lane",
    workerRef: "refs/heads/lane",
    integrationWorktree: "../main",
    integrationRef: "refs/heads/main",
  };
  writeFileSync(
    join(repo, "scripts/full-run-checkouts.json"),
    JSON.stringify(config)
  );
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(repo, "switch", "-c", "interactive");
  git(repo, "worktree", "add", main, "main");
  git(repo, "worktree", "add", "-b", "lane", lane);
  writeFileSync(join(repo, "tracked.txt"), "user's unsaved changes\n");
  git(repo, "add", "tracked.txt");
  writeFileSync(join(repo, "untracked.txt"), "user's untracked work\n");
  const primaryBefore =
    git(repo, "status", "--porcelain") +
    git(repo, "diff", "--cached") +
    git(repo, "rev-parse", "HEAD");
  assert.equal(integrationCheckout(repo).integrationWorktree, main);
  assert.equal(inspectIntegrationCheckout(repo).ready, true);
  assert.equal(assertFullRunWorker(repo, lane).workerRef, "refs/heads/lane");
  assert.throws(() => assertFullRunWorker(repo, repo), /does not match/);
  assert.throws(() => assertFullRunWorker(repo, main), /does not match/);
  const syncScript = fileURLToPath(
    new URL("./sync-worktree-to-main.mjs", import.meta.url)
  );
  const poisonedSync = spawnSync(
    process.execPath,
    [
      syncScript,
      "--worktree",
      lane,
      "--branch",
      "refs/heads/lane",
      "--main",
      "refs/heads/main",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        git_dir: git(repo, "rev-parse", "--absolute-git-dir"),
        git_work_tree: repo,
      },
    }
  );
  assert.equal(poisonedSync.status, 0, poisonedSync.stderr);
  // Ref and operation guards must refuse before a dirty lane can be stashed.
  git(lane, "switch", "-c", "other-worker");
  writeFileSync(join(lane, "tracked.txt"), "preserved lane work\n");
  const sync = spawnSync(
    process.execPath,
    [
      syncScript,
      "--worktree",
      lane,
      "--branch",
      "refs/heads/lane",
      "--main",
      "refs/heads/main",
    ],
    { encoding: "utf8" }
  );
  assert.equal(sync.status, 1);
  assert.equal(git(lane, "stash", "list"), "");
  assert.equal(
    readFileSync(join(lane, "tracked.txt"), "utf8"),
    "preserved lane work\n"
  );
  assert.throws(() => assertFullRunWorker(repo, lane), /does not match/);
  git(lane, "switch", "lane");
  git(repo, "worktree", "lock", "--reason", "fixture reservation", lane);
  assert.throws(() => assertFullRunWorker(repo, lane), /locked/);
  git(repo, "worktree", "unlock", lane);
  writeFileSync(join(main, "tracked.txt"), "main busy\n");
  assert.equal(inspectIntegrationCheckout(repo).ready, false);
  assert.equal(inspectIntegrationCheckout(repo).reason, "primary-dirty");
  git(main, "restore", "tracked.txt");
  git(repo, "worktree", "lock", "--reason", "fixture reservation", main);
  assert.throws(() => integrationCheckout(repo), /locked/);
  git(repo, "worktree", "unlock", main);
  git(main, "switch", "-c", "other-main");
  assert.throws(() => integrationCheckout(repo), /exactly one/);
  git(repo, "switch", "main");
  assert.throws(() => integrationCheckout(repo), /does not own/);
  git(repo, "switch", "interactive");
  git(main, "switch", "main");
  assert.equal(
    git(repo, "status", "--porcelain") +
      git(repo, "diff", "--cached") +
      git(repo, "rev-parse", "HEAD"),
    primaryBefore
  );
  assert.equal(git(repo, "symbolic-ref", "--short", "HEAD"), "interactive");
  console.log(
    "[test-full-run-checkouts] passed: pinned refs, registered/locked/dirty guards, wrong-branch sync preserves dirty work and primary index"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
