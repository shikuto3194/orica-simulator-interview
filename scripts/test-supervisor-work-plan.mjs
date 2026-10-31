import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  enqueueFollowup,
  listPendingFollowups,
} from "./supervisor-followup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const powershell = process.platform === "win32" ? "pwsh.exe" : "pwsh";
const available = spawnSync(
  powershell,
  ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"],
  { encoding: "utf8" }
);
if (available.error?.code === "ENOENT" && process.platform !== "win32") {
  console.log(
    "[test-supervisor-work-plan] skipped: PowerShell unavailable on this host"
  );
} else {
  assert.equal(available.status, 0, available.stderr);
  const repo = mkdtempSync(join(tmpdir(), "orica-work-plan-"));
  mkdirSync(join(repo, "scripts"));
  // Saved reports deliberately disagree: the dispatcher must run fresh audits.
  writeFileSync(
    join(repo, "card-coverage.json"),
    JSON.stringify({ totals: { todo: 0 } })
  );
  writeFileSync(
    join(repo, "fidelity-audit.json"),
    JSON.stringify({ violations: [], clean: true })
  );
  for (const audit of ["cards-coverage", "cards-fidelity-audit"]) {
    writeFileSync(
      join(repo, "scripts", audit + ".mjs"),
      `
import fs from "node:fs";
const fixture = JSON.parse(fs.readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
const entry = fixture[${JSON.stringify(audit)}];
process.stdout.write(entry.raw ?? JSON.stringify(entry.report));
process.exit(entry.exitCode ?? 0);
`
    );
  }
  writeFileSync(
    join(repo, "scripts/effect-debug-loop.mjs"),
    `
import fs from "node:fs";
const fixture = JSON.parse(fs.readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
fs.appendFileSync(new URL("../harvest-calls.txt", import.meta.url), "called\\n");
process.stdout.write(JSON.stringify({ schemaVersion: 1, action: "coverage-incomplete", skipWorker: fixture.debugSkip }));
`
  );
  writeFileSync(
    join(repo, "scripts/artifact-storage.mjs"),
    `
import fs from "node:fs";
const fixture = JSON.parse(fs.readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
console.log(JSON.stringify(fixture.storage ?? { status: "ok" }));
process.exit(fixture.storageExit ?? 0);
`
  );
  const driver = join(repo, "dispatch.ps1");
  const wrapper = readFileSync(
    join(root, "scripts/run-supervisor-iteration.ps1"),
    "utf8"
  );
  writeFileSync(
    driver,
    `param($Lib, $Node, $Worktree, $Log, $Wrapper, $Primary)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Wrapper, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
. $Lib
if ($Primary) {
  Get-SupervisorAuditCompletion -Node $Node -Worktree $Worktree -Repo $Primary -Log $Log -StorageScript (Join-Path $Worktree "scripts/artifact-storage.mjs") | ConvertTo-Json -Depth 12 -Compress
  exit 0
}
Invoke-SupervisorPreWorker -Node $Node -Worktree $Worktree -Log $Log -StorageScript (Join-Path $Worktree "scripts/artifact-storage.mjs") | ConvertTo-Json -Depth 12 -Compress
`
  );
  const harvestCalls = 0;
  function dispatch({
    todoCards = [],
    violations = [],
    auditIssues = [],
    semanticReviews = [],
    coverageOverride,
    fidelityOverride,
    debugSkip = true,
    storage,
    storageExit,
  } = {}) {
    const fixture = {
      "cards-coverage": coverageOverride ?? {
        report: {
          totals: { todo: todoCards.length },
          todoCards,
          auditIssues,
          auditViolationCount: auditIssues.filter(
            (issue) => issue.severity === "violation"
          ).length,
          auditReviewCount: auditIssues.filter(
            (issue) => issue.severity === "review"
          ).length,
        },
      },
      "cards-fidelity-audit": fidelityOverride ?? {
        report: {
          violations,
          clean: violations.length === 0,
          semanticReviews,
          semanticReviewCount: semanticReviews.length,
          auditInputs: {
            mirror: { status: "present", sha256: "a".repeat(64) },
          },
        },
      },
      debugSkip,
      storage,
      storageExit,
    };
    writeFileSync(join(repo, "fixture.json"), JSON.stringify(fixture));
    const run = spawnSync(
      powershell,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        driver,
        "-Lib",
        join(root, "scripts/lib/supervisor-work-plan.ps1"),
        "-Node",
        process.execPath,
        "-Worktree",
        repo,
        "-Log",
        join(repo, "audit.log"),
        "-Wrapper",
        join(root, "scripts/run-supervisor-iteration.ps1"),
      ],
      { encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    result.loop = JSON.parse(
      Array.isArray(result.loopJson)
        ? result.loopJson.join("\n")
        : result.loopJson
    );
    return result;
  }
  function assertNoHarvest(result, action = "implementation-required") {
    assert.equal(result.plan.action, action);
    assert.equal(result.loop.skipWorker, false);
    assert.equal(result.loop.harvestRan, false);
    assert.equal(result.loopExitCode, 0);
    let calls = 0;
    try {
      calls = readFileSync(join(repo, "harvest-calls.txt"), "utf8")
        .trim()
        .split("\n").length;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    assert.equal(
      calls,
      harvestCalls,
      "blocked harvest must not run before implementation/repair"
    );
  }
  const back = "BSTH02.7-TR01(B)";
  const partial = {
    cardNo: "BSTH02.7-TX01(B)",
    kind: "uncovered_line",
    detail: "textLines[2]: attack",
  };
  const combined = dispatch({ todoCards: [back], violations: [partial] });
  assertNoHarvest(combined);
  assert.equal(combined.plan.coverageTodo, 1);
  assert.equal(combined.plan.fidelityViolations, 1);
  assert.ok(combined.plan.workerFocus.includes(back));
  assert.ok(combined.plan.workerFocus.includes(partial.cardNo));
  assert.ok(combined.plan.workerFocus.includes(partial.detail));
  assertNoHarvest(dispatch({ todoCards: [back] }));
  for (const kind of [
    "stub",
    "uncovered_line",
    "no_textref",
    "future_violation",
  ]) {
    assertNoHarvest(dispatch({ violations: [{ ...partial, kind }] }));
  }
  const structural = {
    cardNo: "TEST-TR01(B)",
    kind: "invalid_effect_steps",
    severity: "violation",
    effectPath: "quartzData.effects[0]",
    detail: "quartzData.effects[0].steps must be an array",
    evidence: "steps=null",
  };
  const semantic = {
    cardNo: "TEST-C01",
    kind: "usage_limit_scope",
    severity: "review",
    effectPath: "effects[1]",
    detail: "同名ターン1回と個体ゲーム1回の所属を確認",
    evidence: "〔ターンに1回:同名〕ゲーム中に1回",
  };
  const structuralOnly = dispatch({ auditIssues: [structural] });
  assertNoHarvest(structuralOnly);
  assert.equal(structuralOnly.plan.coverageTodo, 0);
  assert.equal(structuralOnly.plan.coverageViolations, 1);
  assert.ok(structuralOnly.plan.workerFocus.includes(structural.detail));
  assert.ok(structuralOnly.plan.workerFocus.includes(structural.evidence));
  for (const args of [
    { semanticReviews: [semantic] },
    { auditIssues: [{ ...structural, severity: "review" }] },
  ]) {
    const review = dispatch(args);
    assertNoHarvest(review, "audit-review-required");
    assert.equal(review.plan.auditReviews, 1);
    assert.equal(review.plan.fidelityViolations, 0);
    assert.match(review.plan.workerFocus, /review は未確定/);
    assert.match(review.plan.workerFocus, /正しい実装を誤検出/);
  }
  const combinedReview = dispatch({
    violations: [partial],
    semanticReviews: [semantic],
  });
  assertNoHarvest(combinedReview);
  assert.ok(combinedReview.plan.workerFocus.includes(semantic.evidence));
  const batched = dispatch({
    semanticReviews: Array.from({ length: 5 }, (_, i) => ({
      ...semantic,
      cardNo: `OLD-${i}`,
      reviewResolution: { reason: "context_changed" },
    })),
    auditIssues: Array.from({ length: 23 }, (_, i) => ({
      ...semantic,
      cardNo: `NEW-${String(i).padStart(2, "0")}`,
      reviewResolution: { reason: "unregistered" },
    })),
  });
  assert.equal(batched.plan.reviewBatch.length, 20);
  assert.ok(
    batched.plan.reviewBatch.every((entry) => entry.workType === "first-review")
  );
  assert.equal(
    batched.plan.auditReviews,
    28,
    "batch selection must not remove remaining reviews"
  );
  assert.match(batched.plan.workerFocus, /各1回/);
  for (const mirror of [
    null,
    { status: "missing", sha256: null },
    { status: "present", sha256: "bad" },
  ]) {
    assertNoHarvest(
      dispatch({
        fidelityOverride: {
          report: {
            violations: [],
            clean: true,
            semanticReviews: [],
            semanticReviewCount: 0,
            auditInputs: { mirror },
          },
        },
      }),
      "audit-repair-required"
    );
  }
  const constraint = dispatch({
    violations: [
      {
        ...partial,
        kind: "constraint_empty_range",
        evidence: { expected: "min <= max", actual: { min: 8, max: 5 } },
      },
    ],
  });
  assertNoHarvest(constraint);
  assert.match(constraint.plan.workerFocus, /min <= max/);
  assert.match(constraint.plan.workerFocus, /"min":8/);
  for (const auditIssues of [
    null,
    {},
    [{ ...structural, severity: "ignored" }],
    [{ ...structural, detail: "" }],
  ]) {
    assertNoHarvest(
      dispatch({
        coverageOverride: {
          report: { totals: { todo: 0 }, todoCards: [], auditIssues },
        },
      }),
      "audit-repair-required"
    );
  }
  for (const report of [
    { violations: [], clean: true, semanticReviews: {} },
    {
      violations: [],
      clean: true,
      semanticReviews: [semantic],
      semanticReviewCount: 0,
    },
    {
      violations: [],
      clean: true,
      semanticReviews: [{ ...semantic, severity: "violation" }],
    },
  ]) {
    assertNoHarvest(
      dispatch({ fidelityOverride: { report } }),
      "audit-repair-required"
    );
  }
  for (const coverageOverride of [
    { raw: "build failed", exitCode: 2 },
    { raw: "not JSON" },
    { report: { todoCards: [] } },
    { report: { totals: { todo: 1 }, todoCards: [] } },
  ]) {
    assertNoHarvest(dispatch({ coverageOverride }), "audit-repair-required");
  }
  assertNoHarvest(
    dispatch({ fidelityOverride: { report: { clean: true } } }),
    "audit-repair-required"
  );
  assertNoHarvest(
    dispatch({
      fidelityOverride: { report: { violations: [partial], clean: true } },
    }),
    "audit-repair-required"
  );
  for (const debugSkip of [true, false]) {
    const clean = dispatch({ debugSkip });
    assertNoHarvest(clean, "audits-clean");
  }
  for (const status of ["warning", "blocked"]) {
    assertNoHarvest(
      dispatch({
        storage: {
          status,
          totalGiB: 201,
          freeGiB: 90,
          workerFocus: "storage maintenance first",
        },
      }),
      "storage-cleanup-required"
    );
  }
  assertNoHarvest(
    dispatch({ storage: { status: "error" }, storageExit: 2 }),
    "storage-repair-required"
  );
  assertNoHarvest(dispatch({ storage: {} }), "storage-repair-required");
  // Missing review arrays/counters must fail closed, including old report schemas.
  const cleanFixture = () => {
    dispatch();
    return JSON.parse(readFileSync(join(repo, "fixture.json"), "utf8"));
  };
  for (const field of [
    "auditIssues",
    "auditViolationCount",
    "auditReviewCount",
  ]) {
    const fixture = cleanFixture();
    delete fixture["cards-coverage"].report[field];
    assertNoHarvest(
      dispatch({ coverageOverride: fixture["cards-coverage"] }),
      "audit-repair-required"
    );
  }
  for (const field of ["semanticReviews", "semanticReviewCount"]) {
    const fixture = cleanFixture();
    delete fixture["cards-fidelity-audit"].report[field];
    assertNoHarvest(
      dispatch({ fidelityOverride: fixture["cards-fidelity-audit"] }),
      "audit-repair-required"
    );
  }

  // Exercise the completion decision against real, isolated Git main/lane trees.
  const git = (args, cwd = repo) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  cleanFixture();
  writeFileSync(
    join(repo, ".gitignore"),
    "fixture.json\n*.log\nharvest-calls.txt\n"
  );
  git(["init", "-b", "main"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "user.name", "Supervisor fixture"]);
  git(["add", "."]);
  git(["commit", "-m", "fixture"]);
  const lane = repo + "-lane";
  git(["worktree", "add", "-b", "audit-lane", lane]);
  const setFixture = (tree, fixture) =>
    writeFileSync(join(tree, "fixture.json"), JSON.stringify(fixture));
  setFixture(lane, cleanFixture());
  const completion = () => {
    const run = spawnSync(
      powershell,
      [
        "-NoProfile",
        "-File",
        driver,
        "-Lib",
        join(root, "scripts/lib/supervisor-work-plan.ps1"),
        "-Node",
        process.execPath,
        "-Worktree",
        lane,
        "-Primary",
        repo,
        "-Log",
        join(repo, "audit.log"),
        "-Wrapper",
        join(root, "scripts/run-supervisor-iteration.ps1"),
      ],
      { encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    return JSON.parse(run.stdout.trim());
  };
  assert.equal(completion().action, "audits-complete");
  for (const args of [
    { todoCards: [back] },
    { violations: [partial] },
    { auditIssues: [structural] },
    { auditIssues: [{ ...structural, severity: "review" }] },
    { semanticReviews: [semantic] },
    { coverageOverride: { raw: "failed", exitCode: 2 } },
    { fidelityOverride: { report: { violations: [], clean: true } } },
  ]) {
    dispatch(args);
    const fixture = JSON.parse(
      readFileSync(join(repo, "fixture.json"), "utf8")
    );
    for (const tree of [lane, repo]) {
      setFixture(lane, cleanFixture());
      setFixture(tree, fixture);
      assert.notEqual(
        completion().action,
        "audits-complete",
        "any remaining/unknown metric on either tree must prevent stopping"
      );
    }
  }
  setFixture(lane, cleanFixture());
  writeFileSync(join(lane, "pending.txt"), "uncommitted fix\n");
  assert.equal(completion().action, "finalization-required");
  git(
    [
      "stash",
      "push",
      "-u",
      "-m",
      "sync-worktree auto-rescue (pre-merge dirty)",
    ],
    lane
  );
  assert.equal(git(["status", "--porcelain"], lane).trim(), "");
  assert.equal(
    completion().action,
    "finalization-required",
    "an auto-rescued fix must not disappear from the stop decision"
  );
  git(["stash", "pop"], lane);
  git(["add", "pending.txt"], lane);
  git(["commit", "-m", "pending fix"], lane);
  assert.equal(
    completion().action,
    "finalization-required",
    "clean but unmerged lane must continue"
  );
  git(["merge", "--ff-only", "audit-lane"]);
  assert.equal(completion().action, "audits-complete");
  writeFileSync(join(repo, "other-task.txt"), "uncommitted work\n");
  assert.equal(completion().action, "awaiting-primary");
  git(["add", "other-task.txt"]);
  git(["commit", "-m", "other task"]);
  git(["checkout", "-b", "other-task"]);
  assert.equal(completion().action, "awaiting-primary");

  // ISMCTS starts after clean audits even before its controller exists. Bad state
  // cannot silently skip the worker, and waiting never disables the scheduler.
  const ismctsDriver = join(repo, "ismcts-dispatch.ps1");
  writeFileSync(
    ismctsDriver,
    `param($Lib, $Node, $Worktree)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. $Lib
Get-SupervisorIsmctsWork -Node $Node -Worktree $Worktree -Repo $Worktree -Integration $Worktree | ConvertTo-Json -Depth 12 -Compress
`
  );
  const ismcts = () => {
    const run = spawnSync(
      powershell,
      [
        "-NoProfile",
        "-File",
        ismctsDriver,
        "-Lib",
        join(root, "scripts/lib/supervisor-work-plan.ps1"),
        "-Node",
        process.execPath,
        "-Worktree",
        repo,
      ],
      { encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    return JSON.parse(run.stdout.trim());
  };
  const bootstrap = ismcts();
  assert.equal(bootstrap.action, "ismcts-implementation-required");
  assert.equal(bootstrap.nextTask, "I0");
  assert.equal(bootstrap.skipWorker, false);
  assert.match(bootstrap.workerFocus, /resources\/evidence/);
  git(["checkout", "main"]);
  git(["add", "ismcts-dispatch.ps1"]);
  git(["commit", "-m", "ISMCTS driver fixture"]);
  const planFixture = (plan, exitCode = 0) =>
    writeFileSync(
      join(repo, "scripts/ismcts-program.mjs"),
      `console.log(${JSON.stringify(JSON.stringify(plan))}); process.exit(${exitCode});`
    );
  const validPlan = {
    schemaVersion: 1,
    action: "ismcts-implementation-required",
    skipWorker: false,
    nextTask: "I1",
    evidenceState: "valid",
    workerFocus: "Implement I1",
  };
  const commitPlan = () => {
    git(["add", "scripts/ismcts-program.mjs"]);
    git(["commit", "--allow-empty", "-m", "controller fixture"]);
  };
  planFixture(validPlan);
  assert.equal(ismcts().nextTask, "I1");
  for (const plan of [
    {
      ...validPlan,
      action: "ismcts-wait",
      skipWorker: true,
      waitReason: "deferred_budget",
    },
    {
      ...validPlan,
      action: "ismcts-monitor",
      skipWorker: true,
      nextTask: "maintenance",
    },
  ]) {
    planFixture(plan);
    commitPlan();
    assert.equal(ismcts().skipWorker, true);
  }
  for (const plan of [
    {},
    [validPlan],
    { ...validPlan, schemaVersion: "1" },
    { ...validPlan, schemaVersion: [] },
    { ...validPlan, action: [] },
    { ...validPlan, nextTask: [] },
    { ...validPlan, nextTask: ["I1"] },
    { ...validPlan, evidenceState: [] },
    { ...validPlan, skipWorker: "false" },
    { ...validPlan, skipWorker: true },
    { ...validPlan, action: "done" },
    { ...validPlan, nextTask: "I8" },
    { ...validPlan, workerFocus: " " },
    { ...validPlan, evidenceState: "missing" },
    { ...validPlan, action: "ismcts-wait", skipWorker: true },
    {
      ...validPlan,
      action: "ismcts-wait",
      skipWorker: true,
      nextTask: [],
      waitReason: "deferred_budget",
    },
    {
      ...validPlan,
      action: "ismcts-wait",
      skipWorker: true,
      waitReason: ["deferred_budget"],
    },
    { ...validPlan, action: "ismcts-wait", waitReason: "deferred_load" },
    {
      ...validPlan,
      action: "ismcts-monitor",
      nextTask: "maintenance",
      evidenceState: "invalid",
    },
    { ...validPlan, action: "ismcts-monitor" },
  ]) {
    planFixture(plan);
    const repair = ismcts();
    assert.equal(repair.skipWorker, false);
    assert.equal(repair.evidenceState, "invalid", JSON.stringify(plan));
    assert.equal(repair.nextTask, "I0");
  }
  planFixture(validPlan, 2);
  assert.equal(ismcts().evidenceState, "invalid");

  // A semantically valid skip cannot discard dirty, rescued or unmerged work.
  planFixture({
    ...validPlan,
    action: "ismcts-monitor",
    skipWorker: true,
    nextTask: "maintenance",
  });
  commitPlan();
  assert.equal(ismcts().skipWorker, true);
  writeFileSync(join(repo, "unfinished.txt"), "preserve this fix\n");
  assert.equal(ismcts().skipWorker, false);
  git(["stash", "push", "-u", "-m", "sync-worktree auto-rescue (test)"]);
  assert.equal(ismcts().skipWorker, false);
  git(["stash", "pop"]);
  git(["checkout", "-b", "ismcts-pending"]);
  git(["add", "unfinished.txt"]);
  git(["commit", "-m", "pending integration"]);
  assert.equal(ismcts().skipWorker, false);
  git(["checkout", "main"]);
  git(["merge", "--ff-only", "ismcts-pending"]);
  assert.equal(ismcts().skipWorker, true);
  writeFileSync(
    join(repo, "scripts/ismcts-program.mjs"),
    'console.log("not JSON");'
  );
  assert.equal(ismcts().evidenceState, "invalid");

  // The wrapper retains locks and audit priority, then dispatches ISMCTS.
  assert.match(
    wrapper,
    /recover-gate-lease\.mjs" --root \$Worktree[\s\S]*?if \(\$LASTEXITCODE -ne 0\) \{[\s\S]*?exit \$code/
  );
  assert.ok(
    wrapper.indexOf("recover-gate-lease.mjs") < wrapper.indexOf("$syncOut ="),
    "blocked validation recovery must stop before stashing and repeating worker edits"
  );
  assert.match(
    wrapper,
    /Invoke-SupervisorPreWorker -Node \$node -Worktree \$Worktree/
  );
  assert.match(
    wrapper,
    /Replace\('__WORKER_FOCUS__', \$implementationStatusBlock\)/
  );
  assert.match(wrapper, /worker dispatch: RUN/);
  assert.match(wrapper, /\$cardLockLane = "card-impl"/);
  assert.doesNotMatch(wrapper, /"supervisor-sync-recovery"/);
  assert.equal(
    (wrapper.match(/"--extra-lock-lane", \$cardLockLane/g) || []).length,
    1,
    "the normal worker must heartbeat the shared card lane lease; failed sync never dispatches a worker"
  );
  assert.match(
    wrapper,
    /if \(\$cardLockAcquired\) \{[\s\S]*?release --token \$cardLockToken --lane \$cardLockLane/
  );
  assert.match(
    wrapper,
    /if \(\$selectedWork.action -eq "audits-clean" -and -not \$workRecovery\) \{[\s\S]*?Get-SupervisorIsmctsWork -Node \$node/
  );
  const selectionDriver = join(repo, "select-followup.ps1");
  writeFileSync(
    selectionDriver,
    `param($Lib, $Action, $Selected, $Node, $Script, $Hub, $Worktree, $Log)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. $Lib
$audit = [pscustomobject]@{ action = $Action; workerFocus = "ordinary" }
$ids = if ($Selected -in @("yes", "due")) { @("followup-0123456789abcdef0123") } else { @() }
$queue = [pscustomobject]@{ schemaVersion = 1; selectedIds = @($ids); block = "requirements"; auditTurnDue = ($Selected -eq "due") }
if ($Hub) { $queue = Get-SupervisorFollowupPlan -Node $Node -Script $Script -Repo $Hub -Worktree $Worktree -Log $Log }
Select-SupervisorFollowupWork -AuditPlan $audit -FollowupPlan $queue | ConvertTo-Json -Compress
`
  );
  function selectWork(action, selected = "yes", liveHub = null) {
    return JSON.parse(
      execFileSync(
        powershell,
        [
          "-NoProfile",
          "-File",
          selectionDriver,
          "-Lib",
          join(root, "scripts/lib/supervisor-work-plan.ps1"),
          "-Action",
          action,
          "-Selected",
          selected,
          ...(liveHub
            ? [
                "-Node",
                process.execPath,
                "-Script",
                join(root, "scripts/supervisor-followup.mjs"),
                "-Hub",
                liveHub,
                "-Worktree",
                repo,
                "-Log",
                join(repo, "followup-dispatch.log"),
              ]
            : []),
        ],
        { encoding: "utf8", timeout: 60_000, windowsHide: true }
      )
    );
  }
  for (const action of [
    "audits-clean",
    "implementation-required",
    "audit-review-required",
  ]) {
    assert.equal(selectWork(action).action, "telegram-work-required");
    assert.equal(selectWork(action).selectedIds.length, 1);
    assert.equal(selectWork(action, "no").action, action);
  }
  for (const action of [
    "storage-cleanup-required",
    "storage-repair-required",
    "audit-repair-required",
  ]) {
    assert.equal(selectWork(action).action, action);
    assert.equal(selectWork(action).selectedIds.length, 0);
  }
  for (const action of ["implementation-required", "audit-review-required"]) {
    const due = selectWork(action, "due");
    assert.equal(due.action, action);
    assert.deepEqual(due.selectedIds, []);
    assert.deepEqual(due.auditForFollowupIds, [
      "followup-0123456789abcdef0123",
    ]);
    assert.match(due.workerFocus, /最大1バッチ/);
  }
  assert.equal(
    selectWork("audits-clean", "due").action,
    "telegram-work-required"
  );
  assert.equal(
    selectWork("storage-repair-required", "due").action,
    "storage-repair-required"
  );
  const liveHub = join(repo, "followup-hub");
  mkdirSync(liveHub);
  const emptySelection = selectWork("audits-clean", "no", liveHub);
  assert.equal(
    emptySelection.action,
    "audits-clean",
    "real acceptance CLI must allow an empty queue to reach ordinary selection"
  );
  assert.deepEqual(emptySelection.selectedIds, []);
  const pendingRequest = enqueueFollowup({
    repo: liveHub,
    kind: "instruction",
    text: "unverified request",
  });
  const reception = join(
    liveHub,
    "logs/codex-telegram-inbox/reception-results/1.json"
  );
  mkdirSync(dirname(reception), { recursive: true });
  writeFileSync(
    reception,
    JSON.stringify({
      status: "completed",
      handoffId: pendingRequest.id,
      result: { handoff: "unverified request" },
    })
  );
  const actualSelection = selectWork("audits-clean", "no", liveHub);
  assert.equal(actualSelection.action, "telegram-work-required");
  assert.deepEqual(actualSelection.selectedIds, [pendingRequest.id]);
  assert.deepEqual(
    listPendingFollowups({ repo: liveHub }).map((item) => item.id),
    [pendingRequest.id]
  );
  const dispatchLog = readFileSync(join(repo, "followup-dispatch.log"), "utf8");
  assert.match(
    dispatchLog,
    /follow-up acceptance: .*"checked":0.*"validationRuns":0/
  );
  assert.doesNotMatch(dispatchLog, /unsettled top-level await/);
  assert.ok(
    wrapper.indexOf("Get-SupervisorFollowupPlan -Node") <
      wrapper.indexOf("if ($ismctsPlan.skipWorker)")
  );
  assert.ok(
    wrapper.indexOf("Get-SupervisorFollowupPlan -Node") <
      wrapper.indexOf("Select-SupervisorFollowupWork -AuditPlan"),
    "actual acceptance and plan helper runs before worker selection"
  );
  assert.ok(
    wrapper.indexOf("$env:ORICA_SUPERVISOR_HUB_REPO = $Repo") <
      wrapper.indexOf("Get-SupervisorFollowupPlan -Node"),
    "acceptance keeps the same data roots as the worker"
  );
  assert.match(
    wrapper,
    /foreach \(\$id in \$selectedFollowupIds\) \{ \$workerArgs \+= @\("--followup-id", \$id\)/
  );
  assert.doesNotMatch(
    wrapper,
    /Disable-ScheduledTask|Get-SupervisorAuditCompletion/
  );
  assert.match(wrapper, /if \(\$ismctsPlan.skipWorker\) \{/);
  assert.doesNotMatch(
    wrapper,
    /effect-debug-loop\.mjs|effect-debug-harvest\.mjs|policy-bootstrap\.mjs|\$ClusterClaimScript claim/
  );
  assert.doesNotMatch(
    wrapper,
    /skipWorker=true.*tick では Codex worker は起動されない/
  );
  // Only remove the two directories this run created, after every assertion passed.
  // Failed fixtures remain available for investigation; historical TEMP data
  // and concurrent runs are never enumerated or removed.
  const fixtureDirectories = [lane, repo];
  for (const directory of fixtureDirectories)
    assert.equal(dirname(realpathSync(directory)), realpathSync(tmpdir()));
  for (const directory of fixtureDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    assert.equal(
      existsSync(directory),
      false,
      "successful fixture must not remain"
    );
  }
  console.log(
    "[test-supervisor-work-plan] ok (audit priority, ISMCTS bootstrap/repair/wait, legacy completion guards)"
  );
}
