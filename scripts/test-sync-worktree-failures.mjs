#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "orica-sync-failures-"));
const script = fileURLToPath(
  new URL("./sync-worktree-to-main.mjs", import.meta.url)
);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
let fixtures = 0;
function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function fixture({ conflict = false } = {}) {
  const repo = join(temp, `repo-${++fixtures}`);
  const hooks = join(repo, ".git", "fixture-hooks");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "core.autocrlf", "false");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.hooksPath", hooks);
  mkdirSync(hooks);
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(repo, "branch", "fixture-lane");
  writeFileSync(join(repo, conflict ? "base.txt" : "main.txt"), "main\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "main work");
  const mainHead = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "fixture-lane");
  writeFileSync(join(repo, conflict ? "base.txt" : "lane.txt"), "lane\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "lane work");
  return { repo, hooks, mainHead, laneHead: git(repo, "rev-parse", "HEAD") };
}
function run(repo, main = "refs/heads/main", pinned = true, preserve = false) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--worktree",
      repo,
      ...(pinned ? ["--branch", "refs/heads/fixture-lane"] : []),
      "--main",
      main,
      ...(preserve ? ["--preserve-work"] : []),
    ],
    { encoding: "utf8", env, windowsHide: true, timeout: 30_000 }
  );
}
function hook(dir, name, body) {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

try {
  const rejected = fixture();
  hook(rejected.hooks, "pre-merge-commit", "exit 1");
  hook(rejected.hooks, "pre-commit", "exit 1");
  const rejectedResult = run(rejected.repo);
  assert.notEqual(
    rejectedResult.status,
    0,
    `merge/commit hook rejection must fail sync: ${rejectedResult.stderr}`
  );
  assert.equal(git(rejected.repo, "rev-parse", "HEAD"), rejected.laneHead);
  assert.equal(git(rejected.repo, "rev-parse", "main"), rejected.mainHead);
  assert.equal(
    existsSync(join(rejected.repo, ".git", "MERGE_HEAD")),
    true,
    "leave the rejected merge available for recovery"
  );

  const missing = fixture();
  const missingResult = run(missing.repo, "refs/heads/missing", false);
  assert.notEqual(
    missingResult.status,
    0,
    "an invalid merge ref must fail sync"
  );
  assert.equal(git(missing.repo, "rev-parse", "HEAD"), missing.laneHead);
  assert.equal(git(missing.repo, "status", "--porcelain"), "");

  const changed = fixture();
  hook(
    changed.hooks,
    "post-merge",
    "printf 'changed after merge\\n' > base.txt"
  );
  const changedResult = run(changed.repo);
  assert.notEqual(
    changedResult.status,
    0,
    "a successful merge with a dirty result must fail sync"
  );
  assert.equal(
    readFileSync(join(changed.repo, "base.txt"), "utf8"),
    "changed after merge\n",
    "preserve unexpected work for recovery"
  );

  const conflict = fixture({ conflict: true });
  assert.equal(
    run(conflict.repo).status,
    3,
    "code conflicts must select sync recovery"
  );
  assert.equal(git(conflict.repo, "rev-parse", "HEAD"), conflict.laneHead);
  assert.equal(git(conflict.repo, "status", "--porcelain"), "");

  const strictDirty = fixture();
  writeFileSync(join(strictDirty.repo, "base.txt"), "other work");
  assert.notEqual(
    run(strictDirty.repo, "refs/heads/main", true, true).status,
    0
  );
  assert.equal(
    readFileSync(join(strictDirty.repo, "base.txt"), "utf8"),
    "other work"
  );
  assert.equal(git(strictDirty.repo, "stash", "list"), "");
  assert.equal(
    git(strictDirty.repo, "rev-parse", "HEAD"),
    strictDirty.laneHead
  );
  const strictConflict = fixture({ conflict: true });
  assert.equal(
    run(strictConflict.repo, "refs/heads/main", true, true).status,
    3
  );
  assert.equal(
    git(strictConflict.repo, "diff", "--name-only", "--diff-filter=U"),
    "base.txt"
  );
  assert.equal(
    git(strictConflict.repo, "rev-parse", "HEAD"),
    strictConflict.laneHead
  );
  // Run the actual wrapper's preflight/sync-to-dispatch and finally blocks.
  // Fetch, notification, worker and lock endpoints are isolated fixtures.
  const wrapper = readFileSync(
    new URL("./run-supervisor-iteration.ps1", import.meta.url),
    "utf8"
  );
  const syncStart = wrapper.indexOf(
    "  # All startup failures use the same persisted intervention report."
  );
  const syncEnd = wrapper.indexOf("  # Read the durable user queue", syncStart);
  const finallyStart = wrapper.lastIndexOf("finally {");
  assert(syncStart >= 0 && syncEnd > syncStart && finallyStart > syncEnd);
  const workerDispatch = wrapper.match(
    / {2}& \$node "\$Control\\scripts\\worker-codex-stream\.mjs" @workerArgs[^\r\n]*/
  )?.[0];
  assert(workerDispatch, "exercise the actual worker dispatch statement");
  const control = join(temp, "control");
  mkdirSync(join(control, "scripts"), { recursive: true });
  for (const name of ["sync-worktree-to-main.mjs", "primary-main.mjs"])
    copyFileSync(
      new URL(name, import.meta.url),
      join(control, "scripts", name)
    );
  writeFileSync(
    join(control, "scripts/supervisor-followup.mjs"),
    "import fs from 'node:fs'; if (!process.argv.includes('--cleared')) fs.writeFileSync(process.env.FIXTURE_REPORT,process.argv[process.argv.indexOf('--text')+1]);\n"
  );
  writeFileSync(
    join(control, "scripts/worker-codex-stream.mjs"),
    "import fs from 'node:fs'; fs.writeFileSync(process.env.FIXTURE_WORKER,'started');\n"
  );
  writeFileSync(
    join(control, "scripts/supervisor-work-recovery.mjs"),
    'if(process.env.FIXTURE_MODE === "owned-recovery") console.log(JSON.stringify({action:"recover",checkpoint:"fixture-owned-checkpoint"})); else process.exitCode=1;\n'
  );
  writeFileSync(
    join(control, "scripts/supervisor-lock.mjs"),
    "import fs from 'node:fs'; fs.appendFileSync(process.env.FIXTURE_LOCK,process.argv.slice(2).join(' ')+'\\n');\n"
  );
  writeFileSync(
    join(control, "scripts/remote-main-integration.mjs"),
    "if(process.env.FIXTURE_MODE==='fetch-failure'){console.error('fixture fetch unavailable');process.exit(7)}console.log('a'.repeat(40));\n"
  );
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  for (const mode of [
    "dirty",
    "owned-recovery",
    "fetch-failure",
    "status-failure",
    "conflict",
    "hook-rejection",
    "success",
  ]) {
    const scope = fixture({ conflict: mode === "conflict" });
    if (mode === "hook-rejection")
      hook(scope.hooks, "pre-merge-commit", "exit 1");
    if (["dirty", "owned-recovery"].includes(mode))
      writeFileSync(join(scope.repo, "base.txt"), "preserve other work\n");
    const prefix = join(temp, "wrapper-" + mode);
    const block = [
      '$ErrorActionPreference="Stop"',
      "$node=" + quote(process.execPath),
      "$Control=" + quote(control),
      "$Repo=" + quote(control),
      "$Worktree=" + quote(scope.repo),
      "$Log=" + quote(prefix + ".log"),
      '$checkouts=@{workerRef="refs/heads/fixture-lane"}',
      "$workerArgs=@()",
      "function Write-SupervisorBootstrapLog { param([string]$Message) }",
      mode === "status-failure"
        ? "function git { $global:LASTEXITCODE=128 }"
        : "",
      "$lockAcquired=$true; $cardLockAcquired=$true; $code=0",
      '$lockLane="supervisor"; $cardLockLane="card-impl"; $lockToken="owned"; $cardLockToken="owned-card"',
      "$lockScript=" + quote(join(control, "scripts/supervisor-lock.mjs")),
      "try {",
      wrapper.slice(syncStart, syncEnd),
      workerDispatch,
      "}",
      wrapper.slice(finallyStart),
    ].join("\n");
    writeFileSync(prefix + ".ps1", block);
    const result = spawnSync("pwsh", ["-NoProfile", "-File", prefix + ".ps1"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      env: {
        ...env,
        FIXTURE_MODE: mode,
        FIXTURE_REPORT: prefix + ".report",
        FIXTURE_WORKER: prefix + ".worker",
        FIXTURE_LOCK: prefix + ".locks",
      },
    });
    assert.equal(
      result.status,
      {
        conflict: 3,
        "hook-rejection": 1,
        dirty: 1,
        "owned-recovery": 0,
        "fetch-failure": 7,
        "status-failure": 128,
        success: 0,
      }[mode],
      result.stdout + result.stderr
    );
    assert.equal(
      existsSync(prefix + ".worker"),
      ["success", "owned-recovery"].includes(mode)
    );
    assert.match(
      readFileSync(prefix + ".locks", "utf8"),
      /release --token owned-card --lane card-impl/
    );
    assert.match(
      readFileSync(prefix + ".locks", "utf8"),
      /release --token owned --lane supervisor/
    );
    if (mode === "owned-recovery") {
      assert.equal(
        readFileSync(join(scope.repo, "base.txt"), "utf8"),
        "preserve other work\n"
      );
      assert.equal(git(scope.repo, "rev-parse", "HEAD"), scope.laneHead);
      assert.equal(git(scope.repo, "rev-parse", "main"), scope.mainHead);
      assert.equal(git(scope.repo, "stash", "list"), "");
      assert.equal(existsSync(prefix + ".report"), false);
    } else if (mode !== "success") {
      assert.match(
        readFileSync(prefix + ".report", "utf8"),
        /intervention required; worker not started/
      );
      if (mode === "conflict")
        assert.match(readFileSync(prefix + ".report", "utf8"), /base\.txt/);
      assert.equal(
        existsSync(join(scope.repo, ".git", "MERGE_HEAD")),
        ["conflict", "hook-rejection"].includes(mode)
      );
      if (mode === "dirty") {
        assert.match(readFileSync(prefix + ".report", "utf8"), /lane is dirty/);
        assert.equal(
          readFileSync(join(scope.repo, "base.txt"), "utf8"),
          "preserve other work\n"
        );
      }
      if (mode === "fetch-failure")
        assert.match(
          readFileSync(prefix + ".report", "utf8"),
          /remote main fetch failed/
        );
      if (mode === "status-failure")
        assert.match(
          readFileSync(prefix + ".report", "utf8"),
          /lane status check failed/
        );
      assert.equal(git(scope.repo, "rev-parse", "HEAD"), scope.laneHead);
      assert.equal(git(scope.repo, "rev-parse", "main"), scope.mainHead);
      assert.equal(git(scope.repo, "stash", "list"), "");
    }
  }

  const success = fixture();
  const successResult = run(success.repo);
  assert.equal(successResult.status, 0, successResult.stderr);
  assert.equal(
    git(success.repo, "merge-base", "--is-ancestor", "main", "HEAD"),
    ""
  );
  assert.equal(git(success.repo, "status", "--porcelain"), "");
  assert.equal(existsSync(join(success.repo, ".git", "MERGE_HEAD")), false);
  assert.equal(readFileSync(join(success.repo, "lane.txt"), "utf8"), "lane\n");
  assert.equal(readFileSync(join(success.repo, "main.txt"), "utf8"), "main\n");
  console.log(
    "[test-sync-worktree-failures] passed: hook failure, missing ref, dirty result, conflict, successful merge"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
