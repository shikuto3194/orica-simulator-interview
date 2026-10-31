import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ancestor,
  fetchMain,
  git,
  prepareCandidate,
  candidateCheckpoint,
  assertCandidateCheckpoint,
  readPushHookResult,
  prepareReviewPrompt,
  bindReviewPrompt,
  assertReviewPromptUnchanged,
  ensureCandidateHooks,
  resolveCodex,
  preparePublicationHook,
  assertPublicationGuard,
  assertPublicationWriters,
  assertVerifierEvidence,
} from "./remote-main-integration.mjs";

import {
  prepareIntegration,
  requestIntegration,
  completeIntegration,
} from "./supervisor-integration.mjs";
import { recordAutoMerge } from "./auto-merge-status.mjs";
import { createHash, randomUUID } from "node:crypto";

const fixtureReport = {
  summary: "Synthetic publication fixture",
  items: [],
  coverage: {
    files: [],
    fullDiffRead: true,
    unverified: [],
    lenses: ["1", "2", "3", "4", "5", "6"].map((lens) => ({
      lens,
      status: "not_applicable",
      reason: "Synthetic fixture coverage",
    })),
  },
  quantifiedEffectReview: {
    applicability: "not_applicable",
    reason: "Synthetic fixture",
    mappings: [],
  },
};
const fixtureEvidence = (
  root,
  tree = git(root, "rev-parse", "HEAD^{tree}")
) => {
  const baseTree = git(
    root,
    "rev-parse",
    git(root, "merge-base", "main", "HEAD") + "^{tree}"
  );
  const archiveRelativePath = "logs/verifier-history/fixture";
  const files = git(
    root,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--name-only",
    baseTree,
    tree
  )
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  put(
    root,
    archiveRelativePath + "/context.json",
    JSON.stringify({
      schemaVersion: 1,
      base: "main",
      baseTree,
      headTree: tree,
      changedFiles: files,
    })
  );
  return JSON.stringify({
    tree,
    headTree: tree,
    base: "main",
    archiveRelativePath,
    report: {
      ...fixtureReport,
      coverage: { ...fixtureReport.coverage, files },
    },
  });
};
const scripts = dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "orica-remote-main-"));
const previousLock = process.env.ORICA_SUPERVISOR_LOCK;
process.env.ORICA_SUPERVISOR_LOCK = join(temp, "fixture-merge.lock.json");
const root = join(temp, "repo"),
  lane = join(temp, "lane"),
  main = join(temp, "main"),
  cloud = join(temp, "cloud"),
  remote = join(temp, "remote.git");
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

const fixtureWriterCode = (action) =>
  'import { runVerifierWriter } from "./verifier-write-lock.mjs";\n' +
  "function " +
  action +
  '() { throw new Error("unexpected synthetic review writer"); }\n';
const installFixtureWriters = (directory) => {
  for (const name of ["verifier-write-lock.mjs", "run-with-lock-heartbeat.mjs"])
    put(directory, "scripts/" + name, readFileSync(join(scripts, name)));
  if (!existsSync(join(directory, "scripts/supervisor-lock.mjs")))
    put(
      directory,
      "scripts/supervisor-lock.mjs",
      readFileSync(join(scripts, "supervisor-lock.mjs"))
    );
  put(
    directory,
    "scripts/spawn-verifier.mjs",
    fixtureWriterCode("main") +
      "process.exitCode = await runVerifierWriter(import.meta.url, main);\n"
  );
  const reader = readFileSync(
    join(directory, "scripts/verifier-evidence.mjs"),
    "utf8"
  );
  // Imports must stay at module scope; the synthetic reader below already has
  // imports, so gate the writer with an early process exit before reader code.
  put(
    directory,
    "scripts/verifier-evidence.mjs",
    fixtureWriterCode("record") +
      'if (process.argv[2] === "record") { process.exitCode = await runVerifierWriter(import.meta.url, record); process.exit(process.exitCode); }\n' +
      reader
  );
};

const commit = (root, file, text) => {
  put(root, file, text);
  git(root, "add", file);
  git(root, "commit", "-m", "fixture " + file);
  return git(root, "rev-parse", "HEAD");
};
let suitePassed = false;
try {
  // Real prompt/evidence/verified-commit path for an empty content diff.
  const historyRoot = join(temp, "history-only");
  mkdirSync(historyRoot);
  git(historyRoot, "init", "-b", "main");
  git(historyRoot, "config", "user.name", "History fixture");
  git(historyRoot, "config", "user.email", "history@example.invalid");
  put(historyRoot, ".gitignore", ".verifier-*\nlogs/\n");
  put(
    historyRoot,
    ".gitattributes",
    readFileSync(join(scripts, "../.gitattributes"))
  );
  for (const file of [
    "spawn-verifier.mjs",
    "verifier-write-lock.mjs",
    "supervisor-lock.mjs",
    "run-with-lock-heartbeat.mjs",
    "verifier-tree.mjs",
    "verifier-evidence.mjs",
    "verifier-card-context.mjs",
    "quantified-effect-repeat.mjs",
    "harness/fuzz-candidate-evidence.mjs",
    "harness/verification-state.cjs",
    "verified-commit.mjs",
  ])
    put(historyRoot, "scripts/" + file, readFileSync(join(scripts, file)));
  const promptFile =
    "manual/ai-reference/30_plan/adversarial-verifier-prompt.md";
  put(historyRoot, promptFile, readFileSync(join(scripts, "..", promptFile)));
  git(historyRoot, "add", ".");
  git(historyRoot, "commit", "-m", "history fixture base");
  const historyBase = git(historyRoot, "rev-parse", "HEAD");
  const historyLane = join(temp, "history-lane"),
    historyRemote = join(temp, "history-remote");
  git(
    historyRoot,
    "worktree",
    "add",
    "-b",
    "history-lane",
    historyLane,
    historyBase
  );
  git(historyLane, "commit", "--allow-empty", "-m", "source audit");
  const historySource = git(historyLane, "rev-parse", "HEAD");
  git(
    historyRoot,
    "worktree",
    "add",
    "-b",
    "history-remote",
    historyRemote,
    historyBase
  );
  git(historyRemote, "commit", "--allow-empty", "-m", "remote audit");
  const historyRemoteHead = git(historyRemote, "rev-parse", "HEAD");
  const historyCandidate = prepareCandidate({
    root: historyRoot,
    source: historySource,
    main: historyBase,
    remote: historyRemoteHead,
    directory: join(temp, "history-candidate"),
  });
  const pendingCheckpoint = candidateCheckpoint(
    historyCandidate.directory,
    historySource,
    historyBase,
    historyRemoteHead
  );
  assert.equal(pendingCheckpoint.mergeHead, historySource);
  assert.deepEqual(
    assertCandidateCheckpoint(
      historyRoot,
      pendingCheckpoint,
      historySource,
      historyBase,
      historyRemoteHead
    ),
    pendingCheckpoint
  );
  for (const change of [
    { head: historyBase },
    { tree: "0".repeat(40) },
    { mergeHead: null },
    { source: historyBase },
    { remote: historyBase },
  ])
    assert.throws(() =>
      assertCandidateCheckpoint(
        historyRoot,
        { ...pendingCheckpoint, ...change },
        historySource,
        historyBase,
        historyRemoteHead
      )
    );
  const historyNode = (args) => {
    const result = spawnSync(process.execPath, args, {
      cwd: historyCandidate.directory,
      encoding: "utf8",
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
      ),
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  historyNode([
    "scripts/spawn-verifier.mjs",
    "--base",
    "main",
    "--out",
    ".verifier-prompt.txt",
  ]);
  assert.equal(
    existsSync(join(historyCandidate.directory, ".verifier-prompt.txt")),
    false,
    "default empty-diff behavior must remain unchanged"
  );
  assert.equal(
    JSON.parse(
      readFileSync(join(historyCandidate.directory, ".verifier-context.json"))
    ).pending,
    true
  );
  assert.equal(
    existsSync(join(historyCandidate.directory, ".verifier-result.json")),
    false
  );
  const historyPrompt = await prepareReviewPrompt(historyCandidate.directory);
  assert.match(
    historyPrompt,
    /no changes; review the history-only integration/
  );
  const historyContext = JSON.parse(
    readFileSync(join(historyCandidate.directory, ".verifier-context.json"))
  );
  assert.deepEqual(historyContext.changedFiles, []);
  assert.equal(historyContext.headTree, historyContext.baseTree);
  assert.notEqual(historyContext.pending, true);
  const historyBinding = bindReviewPrompt(
    historyCandidate.directory,
    historyPrompt
  );
  assert.equal(historyBinding.tree, historyContext.headTree);
  assertReviewPromptUnchanged(historyCandidate.directory, historyBinding);
  const generatedMergePath = git(
    historyCandidate.directory,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "MERGE_HEAD"
  );
  assert.ok(historyBinding.mergeHead);
  assert.notEqual(historyBinding.mergeHead.trim(), historyBinding.head);
  writeFileSync(generatedMergePath, historyBinding.head + "\n");
  assert.throws(
    () =>
      assertReviewPromptUnchanged(historyCandidate.directory, historyBinding),
    /review prompt or candidate tree changed/
  );
  writeFileSync(generatedMergePath, historyBinding.mergeHead);
  assertReviewPromptUnchanged(historyCandidate.directory, historyBinding);

  const largePrompt =
    "先頭の必読事項\n" + "x".repeat(1_048_577) + "\n末尾の必読事項";
  const generatedPromptFile = join(
    historyCandidate.directory,
    ".verifier-prompt.txt"
  );
  writeFileSync(generatedPromptFile, largePrompt, "utf8");
  const largeBinding = bindReviewPrompt(
    historyCandidate.directory,
    largePrompt
  );
  assert.ok(largePrompt.length > 1_048_576);
  assert.ok(largeBinding.input.length < 8192);
  assert.ok(
    largeBinding.input.includes(JSON.stringify(resolve(generatedPromptFile)))
  );
  assert.ok(largeBinding.input.includes(largeBinding.sha256));
  assert.ok(largeBinding.input.includes(largeBinding.tree));
  assert.equal(readFileSync(generatedPromptFile, "utf8"), largePrompt);
  assertReviewPromptUnchanged(historyCandidate.directory, largeBinding);
  writeFileSync(
    generatedPromptFile,
    largePrompt.replace("末尾", "変更"),
    "utf8"
  );
  assert.throws(
    () => assertReviewPromptUnchanged(historyCandidate.directory, largeBinding),
    /review prompt or candidate tree changed/
  );
  assert.throws(
    () => bindReviewPrompt(historyCandidate.directory, largePrompt),
    /review prompt or candidate tree changed/
  );
  rmSync(generatedPromptFile);
  assert.throws(
    () => assertReviewPromptUnchanged(historyCandidate.directory, largeBinding),
    /ENOENT/
  );
  writeFileSync(generatedPromptFile, historyPrompt, "utf8");
  assert.throws(
    () =>
      assertReviewPromptUnchanged(historyCandidate.directory, {
        ...historyBinding,
        tree: "0".repeat(40),
      }),
    /review prompt or candidate tree changed/
  );
  assertReviewPromptUnchanged(historyCandidate.directory, historyBinding);
  put(
    historyCandidate.directory,
    ".verifier-report.json",
    JSON.stringify({
      summary: "Synthetic fixture only: history-only evidence protocol",
      quantifiedEffectReview: {
        applicability: "not_applicable",
        reason: "Synthetic history-only fixture has no changed card content",
        mappings: [],
      },
      coverage: {
        files: [],
        fullDiffRead: true,
        unverified: [],
        lenses: ["1", "2", "3", "4", "5", "6"].map((lens) => ({
          lens,
          status: "not_applicable",
          reason: "Synthetic empty-diff validator fixture",
        })),
      },
      items: [
        {
          cardNo: "N/A: history fixture",
          lens: "5",
          refuted: false,
          claim: "Synthetic history-only candidate evidence",
          evidence: "fixture commit graph",
          expected: "Preserve source and remote ancestry on the identical tree",
        },
      ],
    })
  );
  historyNode(["scripts/verifier-evidence.mjs", "record"]);
  historyNode([
    "scripts/verified-commit.mjs",
    "--base",
    "main",
    "--allow-empty",
    "-m",
    "fixture verified history integration",
  ]);
  const historyPublished = git(historyCandidate.directory, "rev-parse", "HEAD");
  const committedCheckpoint = assertCandidateCheckpoint(
    historyRoot,
    pendingCheckpoint,
    historySource,
    historyBase,
    historyRemoteHead
  );
  assert.equal(
    committedCheckpoint.head,
    historyPublished,
    "recover crash after verified commit before checkpoint save"
  );
  assert.equal(committedCheckpoint.mergeHead, null);
  assert.throws(() =>
    assertCandidateCheckpoint(
      historyRoot,
      { ...pendingCheckpoint, head: historyBase },
      historySource,
      historyBase,
      historyRemoteHead
    )
  );
  historyNode([
    "scripts/verifier-evidence.mjs",
    "check-commit",
    "--commit",
    "HEAD",
  ]);
  assert(ancestor(historyRoot, historySource, historyPublished));
  assert(ancestor(historyRoot, historyRemoteHead, historyPublished));
  assert.equal(
    git(historyCandidate.directory, "rev-parse", "HEAD^{tree}"),
    historyContext.headTree
  );
  assertVerifierEvidence(historyCandidate.directory);
  assert.equal(git(historyLane, "rev-parse", "HEAD"), historySource);
  assert.equal(git(historyRoot, "rev-parse", "HEAD"), historyBase);

  // Real historical checker accepts a legacy audit, but publication requires
  // fresh local coverage. A source-side checker cannot waive this guard.
  const legacyRoot = join(temp, "legacy-publication");
  git(historyRoot, "clone", historyCandidate.directory, legacyRoot);
  git(legacyRoot, "config", "user.name", "Legacy fixture");
  git(legacyRoot, "config", "user.email", "legacy@example.invalid");
  git(
    legacyRoot,
    "update-ref",
    "refs/heads/main",
    git(legacyRoot, "rev-parse", "HEAD")
  );
  const auditFixture = (
    report,
    baseTree = git(legacyRoot, "rev-parse", "HEAD^{tree}")
  ) => {
    const text = JSON.stringify(report);
    const tree = git(legacyRoot, "rev-parse", "HEAD^{tree}");
    const reportSha256 = createHash("sha256").update(text).digest("hex");
    const reportBase64 = Buffer.from(text).toString("base64");
    const archiveRelativePath = "logs/verifier-history/synthetic";
    git(
      legacyRoot,
      "commit",
      "--allow-empty",
      "-m",
      [
        "Synthetic audit fixture",
        "",
        "Verifier-Evidence-Schema: 3",
        "Verifier-Head-Tree: " + tree,
        "Verifier-Report-SHA256: " + reportSha256,
        "Verifier-Report-Base64: " + reportBase64,
      ].join("\n")
    );
    put(legacyRoot, archiveRelativePath + "/report.json", text);
    put(
      legacyRoot,
      archiveRelativePath + "/context.json",
      JSON.stringify({
        schemaVersion: 1,
        base: "main",
        baseTree,
        headTree: tree,
      })
    );
    put(
      legacyRoot,
      ".verifier-result.json",
      JSON.stringify({
        schemaVersion: 3,
        base: "main",
        headTree: tree,
        verifiedAt: new Date().toISOString(),
        summary: report.summary,
        refuted: 0,
        reportSha256,
        reportBase64,
        report,
        archiveRelativePath,
      })
    );
  };
  const realLegacyCheck = (command) =>
    execFileSync(process.execPath, ["scripts/verifier-evidence.mjs", command], {
      cwd: legacyRoot,
      encoding: "utf8",
      stdio: "pipe",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
      ),
    });
  auditFixture({
    summary: "Synthetic historical report without coverage",
    items: [],
  });
  realLegacyCheck("check");
  assert.throws(
    () => assertVerifierEvidence(legacyRoot),
    /complete verifier coverage/
  );
  rmSync(join(legacyRoot, ".verifier-result.json"));
  realLegacyCheck("check-commit");
  assert.throws(
    () => assertVerifierEvidence(legacyRoot),
    /fresh local verifier evidence required/
  );
  auditFixture(fixtureReport);
  realLegacyCheck("check");
  assertVerifierEvidence(legacyRoot);
  for (const coverage of [
    undefined,
    { ...fixtureReport.coverage, files: ["same", "same"] },
    { ...fixtureReport.coverage, fullDiffRead: false },
    { ...fixtureReport.coverage, lenses: [] },
    { ...fixtureReport.coverage, unverified: ["source"] },
  ]) {
    const evidence = JSON.parse(
      readFileSync(join(legacyRoot, ".verifier-result.json"))
    );
    evidence.report.coverage = coverage;
    put(legacyRoot, ".verifier-result.json", JSON.stringify(evidence));
    assert.throws(
      () => assertVerifierEvidence(legacyRoot),
      /complete verifier coverage/
    );
  }

  // Internally valid historical reports can omit actual changed paths. The
  // runtime must independently compare the archived tree diff, not main today.
  const coverageBase = git(legacyRoot, "rev-parse", "HEAD^{tree}");
  commit(legacyRoot, "A.txt", "review A\n");
  commit(legacyRoot, "B.txt", "review B\n");
  for (const files of [[], ["A.txt"], ["A.txt", "wrong.txt"]]) {
    auditFixture(
      { ...fixtureReport, coverage: { ...fixtureReport.coverage, files } },
      coverageBase
    );
    realLegacyCheck("check");
    assert.throws(
      () => assertVerifierEvidence(legacyRoot),
      /exact archived verifier coverage/
    );
  }
  auditFixture(
    {
      ...fixtureReport,
      coverage: { ...fixtureReport.coverage, files: ["B.txt", "A.txt"] },
    },
    coverageBase
  );
  realLegacyCheck("check");
  assertVerifierEvidence(legacyRoot);
  const archivedContextPath = join(
    legacyRoot,
    "logs/verifier-history/synthetic/context.json"
  );
  const archivedContextBytes = readFileSync(archivedContextPath);
  const archivedContext = JSON.parse(archivedContextBytes);
  rmSync(archivedContextPath);
  assert.throws(
    () => assertVerifierEvidence(legacyRoot),
    /exact archived verifier coverage/
  );
  for (const change of [
    { baseTree: undefined },
    { baseTree: "0".repeat(40) },
    { baseTree: git(legacyRoot, "rev-parse", "HEAD:A.txt") },
    { headTree: coverageBase },
    { pending: true },
    { base: "other" },
    { schemaVersion: 0 },
  ]) {
    writeFileSync(
      archivedContextPath,
      JSON.stringify({ ...archivedContext, ...change })
    );
    assert.throws(
      () => assertVerifierEvidence(legacyRoot),
      /exact archived verifier coverage/
    );
  }
  writeFileSync(archivedContextPath, archivedContextBytes);
  const oldMain = git(legacyRoot, "rev-parse", "refs/heads/main");
  git(
    legacyRoot,
    "update-ref",
    "refs/heads/main",
    git(legacyRoot, "rev-parse", "HEAD"),
    oldMain
  );
  assertVerifierEvidence(legacyRoot);

  // D and T are reviewable changes too. Construct the type change in Git's
  // index so the regression needs no Windows symlink privileges.
  for (const type of ["deletion", "type-change"]) {
    const baseTree = git(legacyRoot, "rev-parse", "HEAD^{tree}");
    const file = type === "deletion" ? "A.txt" : "B.txt";
    if (type === "deletion") git(legacyRoot, "rm", file);
    else {
      git(legacyRoot, "config", "core.symlinks", "false");
      const blob = git(legacyRoot, "rev-parse", "HEAD:" + file);
      git(
        legacyRoot,
        "update-index",
        "--cacheinfo",
        "120000," + blob + "," + file
      );
    }
    git(legacyRoot, "commit", "-m", "fixture " + type);
    const headTree = git(legacyRoot, "rev-parse", "HEAD^{tree}");
    assert.match(
      git(legacyRoot, "diff", "--name-status", baseTree, headTree),
      type === "deletion" ? /^D\s+A\.txt$/ : /^T\s+B\.txt$/
    );
    auditFixture(fixtureReport, baseTree);
    realLegacyCheck("check");
    assert.throws(
      () => assertVerifierEvidence(legacyRoot),
      /exact archived verifier coverage/
    );
    auditFixture(
      {
        ...fixtureReport,
        coverage: { ...fixtureReport.coverage, files: [file] },
      },
      baseTree
    );
    assertVerifierEvidence(legacyRoot);
  }

  // Start with a real passing audit on an unchanged HEAD, then inject only
  // the selected child-process filesystem failures. Never change permissions.
  const historyArtifacts = new Map(
    [".verifier-context.json", ".verifier-result.json"].map((name) => [
      name,
      readFileSync(join(historyCandidate.directory, name)),
    ])
  );
  const guard = readFileSync(join(scripts, "auto-merge.ps1"), "utf8").match(
    /function Assert-VerifierEvidence \{[\s\S]*?(?=\r?\nfunction Invoke-Gate)/
  )?.[0];
  assert(guard, "Exercise the actual publication evidence guard");
  put(
    historyCandidate.directory,
    ".verifier-auto-guard.ps1",
    '$ErrorActionPreference = "Stop"\n$Worktree = $PSScriptRoot\n' +
      "$RemoteScript = '" +
      join(scripts, "remote-main-integration.mjs").replaceAll("'", "''") +
      "'\n" +
      guard +
      "\ntry { Assert-VerifierEvidence $PSScriptRoot } catch { Write-Output $_.Exception.Message; exit 1 }\n"
  );
  for (const mode of ["context", "result", "both"]) {
    for (const [name, bytes] of historyArtifacts)
      put(historyCandidate.directory, name, bytes);
    const faultPath = join(
      historyCandidate.directory,
      ".verifier-io-preload.mjs"
    );
    put(
      historyCandidate.directory,
      ".verifier-io-preload.mjs",
      `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
const mode = ${JSON.stringify(mode)};
const originalWrite = fs.writeFileSync;
const originalRemove = fs.rmSync;
const operations = [];
function observe(operation) {
  operations.push(operation);
  originalWrite(".verifier-io-events.json", JSON.stringify(operations));
  if (mode === operation || mode === "both")
    throw Object.assign(new Error("Injected EACCES: " + operation), { code: "EACCES" });
}
fs.writeFileSync = function(path, ...args) {
  if (resolve(String(path)) === resolve(".verifier-context.json")) observe("context");
  return originalWrite.call(this, path, ...args);
};
fs.rmSync = function(path, ...args) {
  if (resolve(String(path)) === resolve(".verifier-result.json")) observe("result");
  return originalRemove.call(this, path, ...args);
};
syncBuiltinESMExports();
`
    );
    const oldOptions = process.env.NODE_OPTIONS;
    let nextReviewStage = false;
    try {
      process.env.NODE_OPTIONS =
        (oldOptions ? oldOptions + " " : "") +
        "--import=" +
        pathToFileURL(faultPath).href;
      await assert.rejects(async () => {
        await prepareReviewPrompt(historyCandidate.directory);
        nextReviewStage = true;
      }, /exited 2/);
    } finally {
      if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = oldOptions;
    }
    assert.equal(
      nextReviewStage,
      false,
      "The real caller must stop after any I/O failure"
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(historyCandidate.directory, ".verifier-io-events.json")
        )
      ),
      ["context", "result"],
      "Both invalidations must be attempted independently"
    );
    if (mode !== "both") {
      const stopped = spawnSync(
        "pwsh",
        ["-NoProfile", "-File", ".verifier-auto-guard.ps1"],
        {
          cwd: historyCandidate.directory,
          encoding: "utf8",
          windowsHide: true,
        }
      );
      assert.notEqual(stopped.status, 0, stopped.stdout + stopped.stderr);
      assert.match(
        stopped.stdout + stopped.stderr,
        mode === "context"
          ? /commit audit fallback refused/
          : /new verifier attempt is incomplete/
      );
    } else {
      for (const [name, bytes] of historyArtifacts)
        assert(
          readFileSync(join(historyCandidate.directory, name)).equals(bytes)
        );
    }
    assert.equal(
      git(historyCandidate.directory, "rev-parse", "HEAD"),
      historyPublished
    );
  }
  for (const [name, bytes] of historyArtifacts)
    put(historyCandidate.directory, name, bytes);

  // Pause the real candidate evidence subprocess after source evidence passed.
  // Both real artifact writers must fail before mutation while publication owns
  // the same merge lock, then resume normally after the publisher finishes.
  await prepareReviewPrompt(historyLane);
  copyFileSync(
    join(historyCandidate.directory, ".verifier-report.json"),
    join(historyLane, ".verifier-report.json")
  );
  const sourceWriter = (args) =>
    spawnSync(process.execPath, args, {
      cwd: historyLane,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
    });
  const written = sourceWriter(["scripts/verifier-evidence.mjs", "record"]);
  assert.equal(written.status, 0, written.stderr);
  const sourceCommit = sourceWriter([
    "scripts/verified-commit.mjs",
    "--base",
    "main",
    "--allow-empty",
    "-m",
    "fixture source publication audit",
  ]);
  assert.equal(sourceCommit.status, 0, sourceCommit.stderr);
  const concurrentSource = git(historyLane, "rev-parse", "HEAD");
  assertVerifierEvidence(historyLane);

  assertPublicationWriters(historyLane);
  for (const [file, replacement] of [
    [
      "spawn-verifier.mjs",
      "// await runVerifierWriter(import.meta.url, main)\n",
    ],
    [
      "verifier-evidence.mjs",
      "// await runVerifierWriter(import.meta.url, record)\n",
    ],
    [
      "verifier-write-lock.mjs",
      "export const VERIFIER_WRITE_LOCK_PROTOCOL = 0;\n",
    ],
  ]) {
    const path = join(historyLane, "scripts", file),
      original = readFileSync(path);
    try {
      writeFileSync(path, replacement);
      assert.throws(
        () => assertPublicationWriters(historyLane),
        /synchronize this checkout and rerun independent review/
      );
    } finally {
      writeFileSync(path, original);
    }
  }

  const sourceArtifacts = new Map(
    [".verifier-context.json", ".verifier-result.json"].map((name) => [
      name,
      readFileSync(join(historyLane, name)),
    ])
  );
  const concurrentGuard = join(temp, "concurrent-publication.json");
  const candidateEntry = {
    root: historyCandidate.directory,
    head: historyPublished,
    branch: git(historyCandidate.directory, "symbolic-ref", "--short", "HEAD"),
  };
  writeFileSync(
    concurrentGuard,
    JSON.stringify({
      schemaVersion: 1,
      attemptId: randomUUID().replaceAll("-", ""),
      remoteHead: historyRemoteHead,
      source: {
        root: historyLane,
        head: concurrentSource,
        branch: "history-lane",
      },
      candidate: candidateEntry,
      integration: candidateEntry,
    })
  );
  const checking = join(temp, "candidate-checking"),
    continueCheck = join(temp, "continue-check"),
    publicationSaved = join(temp, "publication-saved");
  const preload = join(temp, "pause-candidate-check.mjs");
  writeFileSync(
    preload,
    'import cp from "node:child_process"; import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";\n' +
      "const original=cp.execFileSync; cp.execFileSync=function(command,args,options){\n" +
      'if(String(args?.[0]).endsWith("verifier-evidence.mjs") && options?.cwd===' +
      JSON.stringify(historyCandidate.directory) +
      "){\n" +
      "fs.writeFileSync(" +
      JSON.stringify(checking) +
      ',"ready");const deadline=Date.now()+20000;while(!fs.existsSync(' +
      JSON.stringify(continueCheck) +
      ')){if(Date.now()>deadline)throw new Error("fixture barrier timed out");Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}\n' +
      "return original.call(this,command,args,options);};syncBuiltinESMExports();\n"
  );
  const publishCode =
    "import {runMergeLockedCommand} from " +
    JSON.stringify(
      pathToFileURL(join(scripts, "verifier-write-lock.mjs")).href
    ) +
    '; import {writeFileSync} from "node:fs"; process.exitCode=await runMergeLockedCommand({label:"fixture publisher",command:process.execPath,args:' +
    JSON.stringify([
      join(scripts, "remote-main-integration.mjs"),
      "publication-guard",
      concurrentGuard,
      "{}",
    ]) +
    ",onSuccess:()=>writeFileSync(" +
    JSON.stringify(publicationSaved) +
    ',"saved")});';
  const startPublisher = () => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", publishCode],
      {
        windowsHide: true,
        env: {
          ...process.env,
          NODE_OPTIONS:
            (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + " " : "") +
            "--import=" +
            pathToFileURL(preload).href,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let output = "";
    child.stdout.on("data", (bytes) => {
      output += bytes;
    });
    child.stderr.on("data", (bytes) => {
      output += bytes;
    });
    const closed = new Promise((ok, fail) => {
      child.once("error", fail);
      child.once("close", (code) => ok({ code, output }));
    });
    return { child, closed };
  };
  const publisher = startPublisher();
  try {
    const deadline = Date.now() + 15000;
    while (!existsSync(checking)) {
      assert.equal(
        publisher.child.exitCode,
        null,
        "publisher exited before candidate checker"
      );
      if (Date.now() > deadline) assert.fail("candidate checker did not start");
      await delay(25);
    }
    assert.equal(existsSync(publicationSaved), false);
    for (const args of [
      ["scripts/spawn-verifier.mjs", "--allow-empty"],
      ["scripts/verifier-evidence.mjs", "record"],
    ]) {
      const denied = sourceWriter(args);
      assert.equal(denied.status, 2, denied.stdout + denied.stderr);
      assert.match(denied.stderr, /merge lock acquire failed/);
      for (const [name, bytes] of sourceArtifacts)
        assert(
          readFileSync(join(historyLane, name)).equals(bytes),
          "writer changed evidence while candidate checker was running"
        );
    }
  } finally {
    writeFileSync(continueCheck, "continue");
    const result = await publisher.closed;
    assert.equal(result.code, 0, result.output);
  }
  assert.equal(readFileSync(publicationSaved, "utf8"), "saved");
  assert.equal(existsSync(process.env.ORICA_SUPERVISOR_LOCK), false);
  // A forged/inherited child marker cannot borrow the publisher's authority.
  const forged = sourceWriter([
    "scripts/spawn-verifier.mjs",
    "--verifier-write-owner",
    randomUUID(),
    "--verifier-write-parent",
    "0",
  ]);
  assert.equal(forged.status, 2);
  for (const [name, bytes] of sourceArtifacts)
    assert(readFileSync(join(historyLane, name)).equals(bytes));
  // Writer wins first: empty-diff review marks pending and invalidates its old
  // result. A subsequent publisher must not save success from the older vouch.
  const pendingWriter = sourceWriter(["scripts/spawn-verifier.mjs"]);
  assert.equal(pendingWriter.status, 0, pendingWriter.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(historyLane, ".verifier-context.json")))
      .pending,
    true
  );
  rmSync(publicationSaved);
  const rejected = await startPublisher().closed;
  assert.notEqual(rejected.code, 0, rejected.output);
  assert.match(rejected.output, /new verifier attempt is incomplete/);
  assert.equal(existsSync(publicationSaved), false);
  assert.equal(existsSync(process.env.ORICA_SUPERVISOR_LOCK), false);
  // process.exit(2) in the record child still releases the parent's lock.
  const invalidRecord = sourceWriter([
    "scripts/verifier-evidence.mjs",
    "record",
  ]);
  assert.equal(invalidRecord.status, 2);
  assert.equal(existsSync(process.env.ORICA_SUPERVISOR_LOCK), false);
  for (const [name, bytes] of sourceArtifacts) put(historyLane, name, bytes);
  assertVerifierEvidence(historyLane);

  const bundled = join(temp, "codex-bin");
  put(bundled, "codex.exe", "obsolete root CLI");
  put(bundled, "older/codex.exe", "old installed CLI");
  put(bundled, "current/codex.exe", "current installed CLI");
  put(bundled, "newest-without-cli/other.exe", "unrelated executable");
  for (const [name, seconds] of [
    ["older", 100],
    ["current", 200],
    ["newest-without-cli", 300],
  ])
    utimesSync(join(bundled, name), seconds, seconds);
  assert.equal(resolveCodex(bundled), join(bundled, "current/codex.exe"));
  const fallback = join(temp, "codex-fallback");
  put(fallback, "codex.exe", "root fallback");
  assert.equal(resolveCodex(fallback), join(fallback, "codex.exe"));
  assert.throws(
    () => resolveCodex(join(temp, "missing-cli")),
    /Independent Codex verifier is unavailable/
  );

  const hookFixture = join(temp, "hook-fixture"),
    shimSource = join(temp, "shim-source");
  mkdirSync(hookFixture);
  git(hookFixture, "init", "-b", "main");
  git(hookFixture, "config", "user.name", "Hook fixture");
  git(hookFixture, "config", "user.email", "fixture@example.invalid");
  put(
    hookFixture,
    ".gitignore",
    "logs/\nnode_modules/\n.husky/_/\n.verifier*\n"
  );
  put(
    hookFixture,
    "package.json",
    JSON.stringify({
      packageManager: JSON.parse(readFileSync(join(scripts, "../package.json")))
        .packageManager,
      scripts: { "verify:push": "node scripts/fixture-push.cjs" },
    })
  );
  put(
    hookFixture,
    "scripts/fixture-push.cjs",
    "const fs=require('node:fs');fs.mkdirSync('logs',{recursive:true});fs.writeFileSync('logs/pre-push','ran');fs.writeFileSync('logs/push-input',fs.readFileSync(0));if(process.env.FIXTURE_HUSKY_GATE_FAIL)process.exit(7);if(process.env.FIXTURE_HUSKY_LEASE_WAIT)process.exit(75);if(process.env.FIXTURE_HUSKY_PENDING)fs.writeFileSync('.verifier-context.json',JSON.stringify({pending:true}));\n"
  );
  put(hookFixture, "scripts/verifier-evidence.mjs", "process.exit(0);\n");
  // The real pre-push entrypoint also runs the secret scanner.
  for (const file of [
    ".gitleaks.toml",
    "scripts/security/gitleaks.mjs",
    "scripts/security/secrets.mjs",
  ])
    put(hookFixture, file, readFileSync(join(scripts, "..", file)));

  put(
    hookFixture,
    ".husky/pre-push",
    readFileSync(join(scripts, "../.husky/pre-push"))
  );
  installFixtureWriters(hookFixture);
  git(hookFixture, "add", ".");
  git(hookFixture, "commit", "-m", "hook fixture");
  put(hookFixture, ".verifier-result.json", fixtureEvidence(hookFixture));
  const hookRemote = join(temp, "hook-remote.git");
  execFileSync("git", ["init", "--bare", hookRemote], { stdio: "pipe" });
  git(hookFixture, "remote", "add", "origin", hookRemote);
  git(hookFixture, "config", "core.hooksPath", ".husky/_");
  put(
    hookFixture,
    "node_modules/husky/husky",
    readFileSync(join(scripts, "../node_modules/husky/husky"))
  );
  for (const name of ["h", "pre-commit", "pre-push", ".gitignore"])
    put(
      shimSource,
      ".husky/_/" + name,
      readFileSync(join(scripts, "../.husky/_", name))
    );
  const hookConfig = readFileSync(join(hookFixture, ".git/config"), "utf8");
  ensureCandidateHooks(hookFixture, shimSource);
  assert.equal(
    readFileSync(join(hookFixture, ".git/config"), "utf8"),
    hookConfig,
    "hook setup must never change shared configuration"
  );
  git(hookFixture, "push", "origin", "main");
  assert.equal(
    readFileSync(join(hookFixture, "logs/pre-push"), "utf8").trim(),
    "ran"
  );

  const huskyHead = git(hookFixture, "rev-parse", "HEAD");
  const huskyGuard = preparePublicationHook({
    root: hookFixture,
    source: hookFixture,
    sourceBranch: "main",
    sourceHead: huskyHead,
    branch: "main",
    head: huskyHead,
    integration: hookFixture,
    remoteHead: huskyHead,
    attemptId: randomUUID().replaceAll("-", ""),
  });
  git(
    hookFixture,
    "-c",
    "core.hooksPath=" + huskyGuard.directory,
    "push",
    "origin",
    "main"
  );
  assert.equal(readFileSync(join(hookFixture, "logs/pre-push"), "utf8"), "ran");
  assert.equal(
    readFileSync(join(hookFixture, ".git/config"), "utf8"),
    hookConfig
  );
  assert.throws(() => assertPublicationGuard(join(temp, "missing-guard.json")));
  assert.throws(
    () =>
      assertPublicationGuard(huskyGuard.guardFile, {
        attemptId: "f".repeat(32),
      }),
    /binding changed/
  );
  const corruptGuard = join(hookFixture, "logs/corrupt-guard.json");
  put(hookFixture, "logs/corrupt-guard.json", "{");
  assert.throws(() => assertPublicationGuard(corruptGuard));
  git(
    hookFixture,
    "commit",
    "--allow-empty",
    "-m",
    "fixture pending publication"
  );
  const nextHuskyHead = git(hookFixture, "rev-parse", "HEAD");
  const newGuard = () =>
    preparePublicationHook({
      root: hookFixture,
      source: hookFixture,
      sourceBranch: "main",
      sourceHead: nextHuskyHead,
      branch: "main",
      head: nextHuskyHead,
      integration: hookFixture,
      remoteHead: huskyHead,
      attemptId: randomUUID().replaceAll("-", ""),
    });
  for (const extra of [
    { FIXTURE_HUSKY_GATE_FAIL: "1" },
    { FIXTURE_HUSKY_LEASE_WAIT: "1" },
    { FIXTURE_HUSKY_PENDING: "1" },
  ]) {
    const guarded = newGuard();
    const stopped = spawnSync(
      "git",
      [
        "-C",
        hookFixture,
        "-c",
        "core.hooksPath=" + guarded.directory,
        "push",
        "origin",
        "main",
      ],
      {
        env: { ...process.env, ...extra },
        encoding: "utf8",
        windowsHide: true,
      }
    );
    assert.notEqual(stopped.status, 0, stopped.stdout + stopped.stderr);
    if (extra.FIXTURE_HUSKY_LEASE_WAIT)
      assert.equal(
        readPushHookResult(guarded.guardFile),
        75,
        "pnpm and installed Husky preserve lease wait through real Git"
      );
    assert.deepEqual(
      readFileSync(join(hookFixture, "logs/push-input"), "utf8")
        .trim()
        .split(/\s+/),
      ["refs/heads/main", nextHuskyHead, "refs/heads/main", huskyHead]
    );
    assert.equal(git(hookRemote, "rev-parse", "refs/heads/main"), huskyHead);
  }
  assert.equal(
    readFileSync(join(hookFixture, ".git/config"), "utf8"),
    hookConfig
  );

  put(hookFixture, "node_modules/husky/husky", "incompatible version");
  assert.throws(
    () => ensureCandidateHooks(hookFixture, shimSource),
    /Compatible installed Husky/
  );

  mkdirSync(root);
  git(root, "init", "-b", "main");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.name", "Remote main fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  put(root, ".gitignore", "logs/\nnode_modules/\n.verifier*\n");
  put(
    root,
    "scripts/full-run-checkouts.json",
    JSON.stringify({
      schemaVersion: 1,
      workerWorktree: "../lane",
      workerRef: "refs/heads/lane",
      integrationWorktree: "../main",
      integrationRef: "refs/heads/main",
    })
  );
  for (const name of [
    "auto-merge.ps1",
    "auto-merge-status.mjs",
    "primary-main.mjs",
    "full-run-checkouts.mjs",
    "run-with-lock-heartbeat.mjs",
    "harness/verification-state.cjs",
  ]) {
    mkdirSync(dirname(join(root, "scripts", name)), { recursive: true });
    copyFileSync(join(scripts, name), join(root, "scripts", name));
  }
  // Real Git/rebase/PS/push, isolated expensive gates and independent model only.
  const moduleUrl = pathToFileURL(
    join(scripts, "remote-main-integration.mjs")
  ).href;
  put(
    root,
    "scripts/remote-main-integration.mjs",
    `
import {fetchMain as fetchObservedMain,ancestor,prepareCandidate,candidateCheckpoint,assertCandidateCheckpoint,readPushHookResult,git,ensureCandidateHooks,preparePublicationHook,assertPublicationGuard,assertVerifierEvidence,assertPublicationWriters} from ${JSON.stringify(moduleUrl)};
import {expireSourceReview} from './fixture-source-review.mjs';
export {ancestor,assertPublicationGuard};
export function fetchMain(root) {
 const observed = fetchObservedMain(root);
 if(process.argv[process.argv.indexOf('--status')+1]==='completed') expireSourceReview('completed-fetch');
 return observed;
}
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
const fixtureReport=${JSON.stringify(fixtureReport)};
const put=(root,file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text);};
const fixtureEvidence=${fixtureEvidence.toString()};
if (process.argv[1].endsWith('remote-main-integration.mjs')) {
 const [cmd,root,source,main,remote,directory]=process.argv.slice(2);
 if(cmd==='fetch') {
  const observed=fetchMain(root);
  const marker=process.env.FIXTURE_REMOTE_REWIND_MARKER;
  if(marker&&existsSync(process.env.FIXTURE_RACE_MARKER)&&!existsSync(marker)){
    writeFileSync(marker,'1');
    git(process.env.FIXTURE_REMOTE_REPO,'update-ref','refs/heads/main',process.env.FIXTURE_REMOTE_REWIND_TARGET,observed);
  }
  console.log(observed);
 }
 if(cmd==='writers') assertPublicationWriters(root);
 if(cmd==='evidence') assertVerifierEvidence(root);
 if(cmd==='hooks') ensureCandidateHooks(root,source);
 if(cmd==='prepare-push') {
  const [root,source,sourceBranch,sourceHead,branch,head,integration,attemptId,remoteHead]=process.argv.slice(3);
  const prepared=preparePublicationHook({root,source,sourceBranch,sourceHead,branch,head,integration,attemptId,remoteHead});
  const marker=process.env.FIXTURE_ADVERTISEMENT_MARKER;
  if(marker&&!existsSync(marker)) {
    writeFileSync(marker,'1');
    const repo=process.env.FIXTURE_ADVERTISEMENT_REMOTE;
    const target=process.env.FIXTURE_ADVERTISEMENT_TARGET;
    if(target==='delete') git(repo,'update-ref','-d','refs/heads/main',remoteHead);
    else git(repo,'update-ref','refs/heads/main',target,remoteHead);
  }
  console.log(JSON.stringify(prepared));
 }
 if(cmd==='prepare') console.log(JSON.stringify(prepareCandidate({root,source,main,remote,directory})));
 if(cmd==='checkpoint') console.log(JSON.stringify(candidateCheckpoint(root,...process.argv.slice(4))));
 if(cmd==='resume-candidate') console.log(JSON.stringify(assertCandidateCheckpoint(root,JSON.parse(process.argv[4]),...process.argv.slice(5))));
 if(cmd==='hook-exit') console.log(readPushHookResult(root));
 if(cmd==='review') {
  const tree=git(root,'write-tree');
  if(readFileSync(root+'/logs/gate-tree','utf8')!==tree) throw Error('tree changed after gate');
  if(process.env.FIXTURE_REVIEW_FAIL) throw Error('independent review refuted');
  writeFileSync(root+'/.verifier-result.json',fixtureEvidence(root,tree));
  git(root,'commit','--allow-empty','-m','fixture independent review');
 }
}
`
  );
  put(
    root,
    "scripts/fixture-source-review.mjs",
    `import {rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function expireSourceReview(phase) {
 if(process.env.FIXTURE_SOURCE_REVIEW_PHASE!==phase) return;
 if(phase==='post-merge'&&resolve(process.cwd())!==resolve(process.env.FIXTURE_SOURCE_REVIEW_TARGET)) return;
 const root=process.env.FIXTURE_SOURCE_LANE;
 rmSync(root+'/.verifier-result.json',{force:true});
 writeFileSync(root+'/.verifier-context.json',JSON.stringify({pending:process.env.FIXTURE_SOURCE_REVIEW_MODE==='pending'}));
 if(process.env.FIXTURE_SOURCE_REVIEW_MODE==='refuted') writeFileSync(root+'/.verifier-report.json',JSON.stringify({items:[{refuted:true}]}));
}
if(process.argv[2]) expireSourceReview(process.argv[2]);
`
  );
  put(
    root,
    "scripts/supervisor-lock.mjs",
    "import {expireSourceReview} from './fixture-source-review.mjs'; if(process.argv[2]==='acquire') expireSourceReview('lock');\n"
  );
  put(
    root,
    "scripts/verifier-evidence.mjs",
    `import {readFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process';
if(process.argv[2]==='check-commit') { if(!process.env.FIXTURE_PORTABLE_AUDIT) throw Error('missing portable audit'); }
else if(JSON.parse(readFileSync('.verifier-result.json')).tree!==execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()) throw Error('stale evidence');`
  );
  put(
    root,
    "scripts/harness/run-gates.mjs",
    'const plan={gates:["review-batch"],fuzzRequired:false}; if(process.env.FIXTURE_FUZZ_PLAN==="missing") delete plan.fuzzRequired; console.log(JSON.stringify(plan));\n'
  );
  put(
    root,
    "scripts/fixture-fuzz.mjs",
    `import {writeFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process'; const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(); if(process.env.FUZZ_CANDIDATE_HEAD!==head||process.env.FUZZ_CANDIDATE_TREE!==tree) throw new Error('fuzz candidate identity mismatch'); if(!process.env.FIXTURE_FUZZ_MARKER) throw new Error('missing fuzz marker'); writeFileSync(process.env.FIXTURE_FUZZ_MARKER,'ran');\n`
  );
  put(
    root,
    "scripts/fixture-gate.mjs",
    `import {mkdirSync,writeFileSync,existsSync,appendFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process';
import {expireSourceReview} from './fixture-source-review.mjs';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
expireSourceReview('gate');
mkdirSync('logs',{recursive:true}); writeFileSync('logs/gate-tree',git('write-tree'));
appendFileSync(process.env.FIXTURE_EVENTS,git('write-tree')+'\\n');
const marker=process.env.FIXTURE_GATE_MARKER;
if(process.env.FIXTURE_ADVANCE_ALWAYS||(marker&&!existsSync(marker))){if(marker)writeFileSync(marker,'1');execFileSync(process.execPath,[process.env.FIXTURE_ADVANCE]);}
if(process.env.FIXTURE_TREE_CHANGE) writeFileSync('source.txt','changed after gate');
if(process.env.FIXTURE_LEASE_WAIT) process.exit(75);
`
  );
  const packageManager = JSON.parse(
    readFileSync(join(scripts, "../package.json"))
  ).packageManager;
  put(
    root,
    "package.json",
    JSON.stringify({
      name: "remote-main-fixture",
      version: "1.0.0",
      packageManager,
      scripts: {
        "verify:merge": "node scripts/fixture-gate.mjs",
        fuzz: "node scripts/fixture-fuzz.mjs",
      },
    })
  );
  put(
    root,
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n"
  );
  const install = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      "pnpm install --offline --frozen-lockfile --ignore-scripts",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000 }
  );
  assert.equal(install.status, 0, install.stdout + install.stderr);
  installFixtureWriters(root);
  put(root, "source.txt", "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  git(remote, "config", "user.name", "Remote fixture");
  git(remote, "config", "user.email", "remote@example.invalid");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "origin", "main");
  execFileSync("git", ["clone", "-b", "main", remote, cloud], {
    stdio: "pipe",
  });
  git(cloud, "config", "user.name", "Cloud fixture");
  git(cloud, "config", "user.email", "cloud@example.invalid");
  git(root, "worktree", "add", "-b", "lane", lane);
  git(root, "switch", "-c", "interactive");
  git(root, "worktree", "add", main, "main");
  const protectedHistory = commit(lane, "source-history.txt", "lane history\n");
  git(lane, "branch", "protected-history", protectedHistory);
  const source = commit(lane, "source.txt", "lane\n");
  // Shared config must not rewrite any other branch, including an unchecked
  // branch pointing into the source commit range. Configure only this fixture.
  git(root, "config", "rebase.updateRefs", "true");
  put(lane, ".verifier-result.json", fixtureEvidence(lane));
  const localMain = git(main, "rev-parse", "HEAD");
  const firstRemote = commit(cloud, "cloud.txt", "cloud\n");
  git(cloud, "push", "origin", "main");
  assert.equal(fetchMain(lane), firstRemote);
  assert.equal(git(lane, "rev-parse", "HEAD"), source);
  const trial = prepareCandidate({
    root: lane,
    source,
    main: localMain,
    remote: firstRemote,
    directory: join(temp, "trial"),
  });
  assert.equal(git(trial.directory, "write-tree"), trial.tree);
  assert.equal(
    git(lane, "rev-parse", "refs/heads/protected-history"),
    protectedHistory
  );
  assert.equal(git(root, "config", "--get", "rebase.updateRefs"), "true");
  assert.equal(
    readFileSync(join(trial.directory, "source.txt"), "utf8"),
    "lane\n"
  );
  assert.equal(
    readFileSync(join(trial.directory, "cloud.txt"), "utf8"),
    "cloud\n"
  );
  assert.equal(git(main, "rev-parse", "HEAD"), localMain);
  assert.equal(git(lane, "rev-parse", "HEAD"), source);

  const advance = join(temp, "advance.cjs"),
    events = join(temp, "events"),
    hookMarker = join(temp, "hook-marker");
  writeFileSync(
    advance,
    `const fs=require('fs'),cp=require('child_process'); const root=${JSON.stringify(cloud)}; const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k))); const git=(...a)=>cp.execFileSync('git',['-C',root,...a],{stdio:'pipe',env}); const n=Date.now(); fs.writeFileSync(root+'/remote-'+n+'.txt','remote '+n); git('add','.'); git('commit','-m','remote advance'); git('push','origin','main');`
  );
  const hook = join(root, ".git/hooks/pre-push");
  const hookScript = join(temp, "hook.cjs");
  writeFileSync(
    hookScript,
    `const fs=require('fs'),cp=require('child_process'); fs.mkdirSync('logs',{recursive:true});fs.writeFileSync('logs/normal-hook-transport.json',JSON.stringify({args:process.argv.slice(2),stdin:fs.readFileSync(0,'utf8')})); const marker=process.env.FIXTURE_RACE_MARKER||${JSON.stringify(hookMarker)}; if(process.env.FIXTURE_HOOK_FAIL||!fs.existsSync(marker)){fs.writeFileSync(marker,'1');cp.execFileSync(process.execPath,[${JSON.stringify(advance)}]);} if(process.env.FIXTURE_HOOK_FAIL)process.exit(1);`
  );
  writeFileSync(
    hook,
    `#!/bin/sh\n"${process.execPath.replaceAll("\\", "/")}" "${hookScript.replaceAll("\\", "/")}" "$@"\n`,
    { mode: 0o755 }
  );
  const execute = (
    extra = {},
    workdir = lane,
    branch = "lane",
    head = source,
    extraArgs = []
  ) => {
    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        join(main, "scripts/auto-merge.ps1"),
        "-Branch",
        branch,
        "-Worktree",
        workdir,
        "-ExpectedHead",
        head,
        "-ResultFile",
        join(temp, "result.json"),
        ...extraArgs,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 180000,
        env: {
          ...process.env,
          FIXTURE_EVENTS: events,
          FIXTURE_ADVANCE: advance,
          ...extra,
        },
      }
    );
    // A timeout has no process exit status. Do not let negative-exit assertions
    // accept it or let fixture cleanup obscure the actual spawn failure.
    if (result.error)
      throw new Error(
        `remote-main fixture execution failed (${extra.FIXTURE_SOURCE_REVIEW_PHASE ?? "default"}/${extra.FIXTURE_SOURCE_REVIEW_MODE ?? "default"}): ${result.error.message}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
        { cause: result.error }
      );
    return result;
  };
  // A separate real Git repository starts with published main ahead of the
  // immutable source. Preserve it by rebasing a new candidate, without lane sync.
  const aheadScope = join(temp, "published-main-start");
  const aheadRoot = join(aheadScope, "repo"),
    aheadLane = join(aheadScope, "lane"),
    aheadMain = join(aheadScope, "main"),
    aheadRemote = join(aheadScope, "remote.git"),
    aheadEvents = join(aheadScope, "events");
  mkdirSync(aheadScope);
  git(root, "clone", "--no-local", "--branch", "main", root, aheadRoot);
  git(aheadRoot, "config", "core.autocrlf", "false");
  git(aheadRoot, "config", "user.name", "Published main fixture");
  git(aheadRoot, "config", "user.email", "published@example.invalid");
  git(aheadRoot, "switch", "-c", "interactive");
  git(aheadRoot, "fetch", "--no-tags", remote, "main");
  git(aheadRoot, "update-ref", "refs/heads/main", firstRemote, localMain);
  git(aheadRoot, "clone", "--bare", "--branch", "main", aheadRoot, aheadRemote);
  git(aheadRoot, "remote", "set-url", "origin", aheadRemote);
  git(aheadRoot, "worktree", "add", "-b", "lane", aheadLane, source);
  git(aheadRoot, "worktree", "add", aheadMain, "main");
  writeFileSync(join(aheadRoot, ".git/hooks/pre-push"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  put(aheadLane, ".verifier-result.json", fixtureEvidence(aheadLane));
  writeFileSync(aheadEvents, "");
  const noPushAhead = execute(
    { FIXTURE_EVENTS: aheadEvents },
    aheadLane,
    "lane",
    source,
    ["-NoPush"]
  );
  assert.notEqual(
    noPushAhead.status,
    0,
    noPushAhead.stdout + noPushAhead.stderr
  );
  assert.match(noPushAhead.stdout, /main is not an ancestor/);
  assert.equal(readFileSync(aheadEvents, "utf8"), "");
  const usageDeferred = execute(
    { FIXTURE_EVENTS: aheadEvents },
    aheadLane,
    "lane",
    source,
    ["-DeferReview"]
  );
  assert.equal(
    usageDeferred.status,
    75,
    usageDeferred.stdout + usageDeferred.stderr
  );
  assert.equal(
    readFileSync(aheadEvents, "utf8"),
    "",
    "no gates or new review while usage is blocked"
  );
  const waitBeforeReview = execute(
    { FIXTURE_EVENTS: aheadEvents, FIXTURE_LEASE_WAIT: "1" },
    aheadLane,
    "lane",
    source
  );
  assert.equal(
    waitBeforeReview.status,
    75,
    waitBeforeReview.stdout + waitBeforeReview.stderr
  );
  const aheadAttempts = () =>
    readdirSync(join(aheadRoot, "logs/auto-merge-runs")).map((file) =>
      JSON.parse(readFileSync(join(aheadRoot, "logs/auto-merge-runs", file)))
    );
  const firstWait = aheadAttempts().find(
    (record) => record.exitCode === 75 && record.phase === "verify:merge"
  );
  assert.equal(
    firstWait.candidate.mergeHead,
    source,
    "preserve pre-review ancestry merge"
  );
  git(aheadRemote, "update-ref", "refs/heads/main", localMain, firstRemote);
  const backwardsResume = execute(
    { FIXTURE_EVENTS: aheadEvents },
    aheadLane,
    "lane",
    source,
    ["-ResumeAttempt", firstWait.id]
  );
  assert.notEqual(backwardsResume.status, 0);
  assert.match(backwardsResume.stdout, /backwards or diverged/);
  git(aheadRemote, "update-ref", "refs/heads/main", firstRemote, localMain);
  const retainedUsageWait = execute(
    { FIXTURE_EVENTS: aheadEvents },
    aheadLane,
    "lane",
    source,
    ["-ResumeAttempt", firstWait.id, "-DeferReview"]
  );
  assert.equal(
    retainedUsageWait.status,
    75,
    retainedUsageWait.stdout + retainedUsageWait.stderr
  );
  writeFileSync(
    join(aheadRoot, ".git/hooks/pre-push"),
    "#!/bin/sh\nexit 75\n",
    { mode: 0o755 }
  );
  const waitAtPush = execute(
    { FIXTURE_EVENTS: aheadEvents },
    aheadLane,
    "lane",
    source,
    ["-ResumeAttempt", firstWait.id]
  );
  assert.equal(waitAtPush.status, 75, waitAtPush.stdout + waitAtPush.stderr);
  const secondWait = aheadAttempts().find(
    (record) => record.exitCode === 75 && record.phase === "pushing"
  );
  assert.equal(secondWait.candidate.worktree, firstWait.candidate.worktree);
  assert.equal(secondWait.candidate.mergeHead, null);
  assert.equal(git(aheadMain, "rev-parse", "HEAD"), secondWait.candidate.head);
  writeFileSync(join(aheadRoot, ".git/hooks/pre-push"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  const startedAhead = execute(
    {
      FIXTURE_EVENTS: aheadEvents,
      FIXTURE_FUZZ_PLAN: "missing",
      FIXTURE_FUZZ_MARKER: join(aheadScope, "fuzz-called"),
    },
    aheadLane,
    "lane",
    source,
    ["-ResumeAttempt", secondWait.id, "-DeferReview"]
  );
  assert.equal(
    startedAhead.status,
    0,
    startedAhead.stdout + startedAhead.stderr
  );
  assert.equal(
    readFileSync(join(aheadScope, "fuzz-called"), "utf8"),
    "ran",
    "missing fuzzRequired must execute the fail-closed fuzz gate"
  );
  assert.match(waitAtPush.stdout, /gate: independent_review/);
  assert.doesNotMatch(
    startedAhead.stdout,
    /gate: independent_review/,
    "valid exact candidate review survives the push wait"
  );
  const aheadPublished = git(aheadMain, "rev-parse", "HEAD");
  assert.equal(
    JSON.parse(readFileSync(join(temp, "result.json"))).head,
    aheadPublished
  );
  rmSync(join(temp, "result.json"));
  assert.equal(fetchMain(aheadLane), aheadPublished);
  assert(ancestor(aheadRoot, firstRemote, aheadPublished));
  assert(ancestor(aheadRoot, source, aheadPublished));
  assert.equal(git(aheadLane, "rev-parse", "HEAD"), source);
  assert.equal(readFileSync(join(aheadMain, "cloud.txt"), "utf8"), "cloud\n");
  assert.equal(readFileSync(join(aheadMain, "source.txt"), "utf8"), "lane\n");
  assert.equal(readFileSync(aheadEvents, "utf8").trim().split("\n").length, 3);
  const unpublishedMain = commit(
    aheadMain,
    "unpublished-local.txt",
    "preserve\n"
  );
  writeFileSync(aheadEvents, "");
  const unpublished = execute(
    { FIXTURE_EVENTS: aheadEvents },
    aheadLane,
    "lane",
    source
  );
  assert.notEqual(
    unpublished.status,
    0,
    unpublished.stdout + unpublished.stderr
  );
  assert.match(
    unpublished.stdout,
    /local main is not preserved by source or fetched remote/
  );
  assert.equal(readFileSync(aheadEvents, "utf8"), "");
  assert.equal(git(aheadMain, "rev-parse", "HEAD"), unpublishedMain);
  assert.equal(fetchMain(aheadLane), aheadPublished);
  assert.equal(git(aheadLane, "rev-parse", "HEAD"), source);

  // A newer failed/incomplete review must never fall back to an old commit vouch.
  const sourceEvidence = readFileSync(join(lane, ".verifier-result.json"));
  put(lane, ".verifier-context.json", JSON.stringify({ pending: true }));
  let blocked = execute({ FIXTURE_PORTABLE_AUDIT: "1" });
  assert.match(blocked.stdout, /new verifier attempt is incomplete/);
  rmSync(join(lane, ".verifier-context.json"));
  rmSync(join(lane, ".verifier-result.json"));
  for (const artifact of [
    ".verifier-context.json",
    ".verifier-report.json",
    ".verifier-prompt.txt",
  ]) {
    put(lane, artifact, "{}");
    blocked = execute({ FIXTURE_PORTABLE_AUDIT: "1" });
    assert.match(blocked.stdout, /commit audit fallback refused/);
    assert.equal(git(main, "rev-parse", "HEAD"), localMain);
    rmSync(join(lane, artifact));
  }
  const portable = execute({
    FIXTURE_PORTABLE_AUDIT: "1",
    FIXTURE_REVIEW_FAIL: "1",
  });
  assert.match(
    portable.stdout,
    /fresh local verifier evidence required/,
    "artifact-free commit audit must require fresh local independent review"
  );
  put(lane, ".verifier-result.json", sourceEvidence);
  // Ignored source review artifacts can expire while a distinct candidate is
  // validated or while its merge lock is acquired, without changing lane HEAD.
  for (const phase of ["gate", "lock"]) {
    for (const mode of ["pending", "refuted"]) {
      const beforeRemote = fetchMain(lane);
      const expired = execute({
        FIXTURE_SOURCE_REVIEW_PHASE: phase,
        FIXTURE_SOURCE_REVIEW_MODE: mode,
        FIXTURE_SOURCE_LANE: lane,
      });
      assert.notEqual(expired.status, 0, expired.stdout + expired.stderr);
      assert.match(
        expired.stdout,
        /new verifier attempt is incomplete|commit audit fallback refused/
      );
      assert.match(expired.stdout, /gate: independent_review/);
      assert.equal(git(main, "rev-parse", "HEAD"), localMain);
      assert.equal(fetchMain(lane), beforeRemote);
      assert.equal(git(lane, "rev-parse", "HEAD"), source);
      assert.equal(git(lane, "status", "--porcelain"), "");
      for (const artifact of [
        ".verifier-context.json",
        ".verifier-report.json",
      ])
        rmSync(join(lane, artifact), { force: true });
      put(lane, ".verifier-result.json", sourceEvidence);
    }
  }
  // Independent review failure and changed tree must stop before local/main writes.
  for (const extra of [
    { FIXTURE_REVIEW_FAIL: "1" },
    { FIXTURE_TREE_CHANGE: "1" },
    { FIXTURE_ADVANCE_ALWAYS: "1" },
  ]) {
    const failed = execute(extra);
    assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
    if (extra.FIXTURE_ADVANCE_ALWAYS)
      assert.match(failed.stdout, /retry limit reached/);
    assert.equal(git(main, "rev-parse", "HEAD"), localMain);
    assert.equal(git(lane, "rev-parse", "HEAD"), source);
  }
  writeFileSync(events, "");
  // Initial divergence, another remote update during gates, and one in pre-push.
  const ticket = prepareIntegration(root, lane);
  requestIntegration(ticket.file, lane);
  const beforeIntegrationConfig = readFileSync(
    join(root, ".git/config"),
    "utf8"
  );
  const success = await completeIntegration(ticket, {
    env: {
      ...process.env,
      FIXTURE_EVENTS: events,
      FIXTURE_ADVANCE: advance,
      FIXTURE_GATE_MARKER: join(temp, "gate-marker"),
    },
  });
  assert.equal(success.status, "completed", success.error);
  assert.equal(
    readFileSync(join(root, ".git/config"), "utf8"),
    beforeIntegrationConfig
  );
  const output = readFileSync(success.outputLog, "utf8");
  assert.match(output, /remote advanced after validation/);
  assert.match(output, /remote advanced during push/);
  const receipt = JSON.parse(readFileSync(success.outputLog + ".result.json"));
  const publicationBinding = JSON.parse(readFileSync(receipt.publicationGuard));
  const transport = JSON.parse(
    readFileSync(
      join(publicationBinding.candidate.root, "logs/normal-hook-transport.json")
    )
  );
  assert.equal(transport.args.length, 2);
  assert.equal(transport.args[0], "origin");
  assert.equal(resolve(transport.args[1]), resolve(remote));
  assert.equal(transport.stdin.trim().split(/\s+/)[1], receipt.head);
  assert.equal(transport.stdin.trim().split(/\s+/)[2], "refs/heads/main");
  assert.equal(success.head, source);
  assert.equal(success.publishedHead, receipt.head);
  assert.notEqual(success.publishedHead, source);
  assert.equal(success.validatedTree, receipt.tree);
  const published = fetchMain(lane);
  assert.equal(receipt.sourceHead, source);
  assert.equal(receipt.head, published);
  assert.equal(receipt.tree, git(lane, "rev-parse", published + "^{tree}"));
  assert(ancestor(lane, source, published));
  assert(ancestor(lane, firstRemote, published));
  assert.equal(git(main, "rev-parse", "HEAD"), published);
  assert.equal(
    git(lane, "rev-parse", "HEAD"),
    source,
    "live lane must never be rebased or changed"
  );
  assert.equal(
    readFileSync(events, "utf8").trim().split("\n").length,
    3,
    "every changed candidate must pass its own gate"
  );

  // Parent success must recheck source review after its own final remote read.
  for (const mode of ["pending", "refuted"]) {
    const next = prepareIntegration(root, lane);
    requestIntegration(next.file, lane);
    const failedParent = await completeIntegration(next, {
      execute: async (request) => {
        writeFileSync(
          request.outputLog + ".result.json",
          JSON.stringify(receipt)
        );
        return 0;
      },
      readRemote: async () => {
        rmSync(join(lane, ".verifier-result.json"));
        put(
          lane,
          ".verifier-context.json",
          JSON.stringify({ pending: mode === "pending" })
        );
        if (mode === "refuted")
          put(
            lane,
            ".verifier-report.json",
            JSON.stringify({ items: [{ refuted: true }] })
          );
        return published;
      },
    });
    assert.equal(failedParent.status, "failed");
    assert.match(
      failedParent.error,
      /new verifier attempt is incomplete|commit audit fallback refused/
    );
    assert.equal(fetchMain(lane), published);
    assert.equal(failedParent.publicationVerified, undefined);
    for (const name of [".verifier-context.json", ".verifier-report.json"])
      rmSync(join(lane, name), { force: true });
    put(lane, ".verifier-result.json", sourceEvidence);
  }

  // Legacy receipts or missing guards cannot manufacture a new success while
  // the source's latest independent review has become pending or refuted.
  for (const mode of ["pending", "refuted"]) {
    for (const variant of ["legacy", "receipt-missing", "attempt-missing"]) {
      const next = prepareIntegration(root, lane);
      requestIntegration(next.file, lane);
      const alteredReceipt = { ...receipt };
      const attemptPath = join(
        root,
        "logs/auto-merge-runs",
        receipt.attemptId + ".json"
      );
      const originalAttempt = readFileSync(attemptPath, "utf8");
      const alteredAttempt = JSON.parse(originalAttempt);
      if (variant === "legacy") alteredReceipt.schemaVersion = 1;
      if (variant !== "attempt-missing") delete alteredReceipt.publicationGuard;
      if (variant !== "receipt-missing") delete alteredAttempt.publicationGuard;
      const failedParent = await completeIntegration(next, {
        execute: async (request) => {
          writeFileSync(
            request.outputLog + ".result.json",
            JSON.stringify(alteredReceipt)
          );
          writeFileSync(attemptPath, JSON.stringify(alteredAttempt));
          rmSync(join(lane, ".verifier-result.json"));
          put(
            lane,
            ".verifier-context.json",
            JSON.stringify({ pending: mode === "pending" })
          );
          if (mode === "refuted")
            put(
              lane,
              ".verifier-report.json",
              JSON.stringify({ items: [{ refuted: true }] })
            );
          return 0;
        },
        readRemote: async () => published,
      });
      assert.equal(failedParent.status, "failed", mode + ":" + variant);
      assert.match(
        failedParent.error,
        /publication (receipt|guard) binding changed/
      );
      assert.equal(failedParent.publicationVerified, undefined);
      const unguardedId = randomUUID();
      assert.throws(
        () =>
          recordAutoMerge(root, {
            id: unguardedId,
            pid: process.pid,
            branch: "lane",
            workdir: lane,
            status: "completed",
            phase: "published",
            head: published,
            sourceHead: source,
          }),
        /requires a publication guard/
      );
      assert(
        !existsSync(join(root, "logs/auto-merge-runs", unguardedId + ".json"))
      );
      assert.equal(fetchMain(lane), published);
      writeFileSync(attemptPath, originalAttempt);
      for (const name of [".verifier-context.json", ".verifier-report.json"])
        rmSync(join(lane, name), { force: true });
      put(lane, ".verifier-result.json", sourceEvidence);
    }
  }

  // A later legitimate remote commit must not invalidate completed publication.
  git(cloud, "fetch", "origin", "main");
  git(cloud, "merge", "--ff-only", "origin/main");
  const later = commit(cloud, "after-publication.txt", "later\n");
  git(cloud, "push", "origin", "main");
  const observedId = randomUUID().replaceAll("-", "");
  const observedGuard = join(temp, "later-publication-binding.json");
  writeFileSync(
    observedGuard,
    JSON.stringify({ ...publicationBinding, attemptId: observedId })
  );
  const observed = recordAutoMerge(root, {
    id: observedId,
    publicationGuard: observedGuard,
    pid: process.pid,
    branch: "lane",
    workdir: lane,
    status: "completed",
    phase: "published",
    head: published,
    sourceHead: source,
  });
  assert.equal(observed.publishedHead, published);
  assert.equal(observed.remoteHead, later);
  assert.equal(observed.publicationVerified, true);

  // Fetch error is not 'already current'; do not mutate source or local main.
  git(lane, "remote", "set-url", "origin", join(temp, "missing.git"));
  assert.throws(() => fetchMain(lane));
  assert.equal(git(main, "rev-parse", "HEAD"), published);
  assert.equal(git(lane, "rev-parse", "HEAD"), source);
  git(lane, "remote", "set-url", "origin", remote);
  // An actual code conflict preserves the candidate for diagnosis, no ours/theirs.
  const conflictSource = join(temp, "conflict-source");
  git(
    lane,
    "worktree",
    "add",
    "-b",
    "conflict-source",
    conflictSource,
    localMain
  );
  const conflicted = commit(conflictSource, "source.txt", "competing change\n");
  assert.throws(
    () =>
      prepareCandidate({
        root: lane,
        source: conflicted,
        main: localMain,
        remote: published,
        directory: join(temp, "conflict"),
      }),
    /conflicts: source.txt/
  );
  assert.equal(git(lane, "rev-parse", "HEAD"), source);
  // A failing hook can coincide with a real remote advance. It must stop.
  const hookLane = join(temp, "hook-failure-lane");
  git(lane, "worktree", "add", "-b", "hook-failure-lane", hookLane, published);
  put(hookLane, ".verifier-result.json", fixtureEvidence(hookLane));
  writeFileSync(events, "");
  const hookFailure = execute(
    { FIXTURE_HOOK_FAIL: "1" },
    hookLane,
    "hook-failure-lane",
    published
  );
  assert.notEqual(hookFailure.status, 0);
  assert.match(
    hookFailure.stdout,
    /without explicit remote concurrency rejection/
  );
  assert.doesNotMatch(hookFailure.stdout, /remote advanced during push/);
  assert.equal(readFileSync(events, "utf8").trim().split("\n").length, 1);
  assert.notEqual(
    fetchMain(lane),
    later,
    "remote must really have advanced during the failing hook"
  );
  assert.equal(git(hookLane, "rev-parse", "HEAD"), published);
  assert.equal(git(lane, "rev-parse", "HEAD"), source);

  // Remote observations are monotonic even after a rejected push. Change only
  // this private bare fixture ref, with compare-and-swap, never force push.
  for (const mode of ["rollback", "divergence"]) {
    const recoverySource = git(main, "rev-parse", "HEAD");
    const recoveryBase = fetchMain(lane);
    const recoveryTarget =
      mode === "rollback"
        ? recoveryBase
        : git(
            remote,
            "commit-tree",
            git(lane, "rev-parse", recoveryBase + "^{tree}"),
            "-p",
            recoveryBase,
            "-m",
            "fixture divergent remote audit"
          );
    const recoveryLane = join(temp, "rewind-" + mode);
    git(
      lane,
      "worktree",
      "add",
      "-b",
      "rewind-" + mode,
      recoveryLane,
      recoverySource
    );
    put(recoveryLane, ".verifier-result.json", fixtureEvidence(recoveryLane));
    writeFileSync(events, "");
    const rejected = execute(
      {
        FIXTURE_RACE_MARKER: join(temp, "race-" + mode),
        FIXTURE_REMOTE_REWIND_MARKER: join(temp, "rewound-" + mode),
        FIXTURE_REMOTE_REWIND_TARGET: recoveryTarget,
        FIXTURE_REMOTE_REPO: remote,
      },
      recoveryLane,
      "rewind-" + mode,
      recoverySource
    );
    assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
    assert.match(
      rejected.stdout,
      /remote main history moved backwards or diverged/
    );
    assert.equal(
      readFileSync(events, "utf8").trim().split("\n").length,
      1,
      "never validate or publish after losing an observed remote ancestor"
    );
    assert.equal(fetchMain(lane), recoveryTarget);
    assert.equal(git(recoveryLane, "rev-parse", "HEAD"), recoverySource);
    assert.equal(git(lane, "rev-parse", "HEAD"), source);
  }
  // A real post-merge hook expires the original lane after local FF. The
  // candidate remains locally available, but normal push must never start.
  const boundaryHook = join(temp, "boundary-hook.mjs");
  writeFileSync(
    boundaryHook,
    "import {writeFileSync} from 'node:fs'; import {expireSourceReview} from " +
      JSON.stringify(
        pathToFileURL(join(root, "scripts/fixture-source-review.mjs")).href
      ) +
      "; import {execFileSync} from 'node:child_process'; if(process.env.FIXTURE_CAS_SIBLING) execFileSync('git',['-C',process.env.FIXTURE_ADVERTISEMENT_REMOTE,'update-ref','refs/heads/main',process.env.FIXTURE_CAS_SIBLING,process.env.FIXTURE_ADVERTISEMENT_TARGET],{env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)))}); if(process.env.FIXTURE_BOUNDARY_PUSH_MARKER) writeFileSync(process.env.FIXTURE_BOUNDARY_PUSH_MARKER,'called'); expireSourceReview('pre-push');\n"
  );
  writeFileSync(
    hook,
    '#!/bin/sh\n"' +
      process.execPath.replaceAll("\\", "/") +
      '" "' +
      boundaryHook.replaceAll("\\", "/") +
      '"\n',
    { mode: 0o755 }
  );
  for (const phase of [
    "post-merge",
    "pre-push",
    "post-receive",
    "completed-fetch",
    "remote-rollback",
    "remote-delete",
    "remote-forward",
    "remote-cas-sibling",
    "remote-known-rejection-sibling",
  ]) {
    for (const mode of phase.startsWith("remote-")
      ? ["remote"]
      : ["pending", "refuted"]) {
      const boundaryCase = phase + "-" + mode;
      console.log(`[remote-main] boundary case: ${boundaryCase}`);
      const boundaryBase = git(main, "rev-parse", "HEAD");
      const boundaryRemote = join(temp, "boundary-" + boundaryCase + ".git");
      execFileSync("git", ["init", "--bare", boundaryRemote], {
        stdio: "pipe",
      });
      git(root, "remote", "set-url", "origin", boundaryRemote);
      git(root, "push", "origin", "main");
      const boundaryCloud = join(temp, "boundary-cloud-" + boundaryCase);
      execFileSync(
        "git",
        ["clone", "-b", "main", boundaryRemote, boundaryCloud],
        { stdio: "pipe" }
      );
      git(boundaryCloud, "config", "user.name", "Boundary fixture");
      git(boundaryCloud, "config", "user.email", "boundary@example.invalid");
      const boundaryObserved = commit(
        boundaryCloud,
        "boundary-cloud-" + boundaryCase + ".txt",
        mode
      );
      git(boundaryCloud, "push", "origin", "main");
      let advertisedTarget =
        phase === "remote-delete" ? "delete" : boundaryBase;
      let siblingTarget;
      if (
        [
          "remote-forward",
          "remote-cas-sibling",
          "remote-known-rejection-sibling",
        ].includes(phase)
      ) {
        advertisedTarget = commit(
          boundaryCloud,
          "unknown-forward.txt",
          boundaryCase
        );
        // Transfer the object without changing main until prepare-push has completed.
        git(
          boundaryCloud,
          "push",
          "origin",
          advertisedTarget + ":refs/heads/fixture-forward"
        );
      }
      if (
        ["remote-cas-sibling", "remote-known-rejection-sibling"].includes(phase)
      ) {
        git(
          root,
          "fetch",
          "--no-write-fetch-head",
          boundaryCloud,
          advertisedTarget
        );
        siblingTarget = git(
          boundaryCloud,
          "commit-tree",
          git(boundaryCloud, "rev-parse", boundaryObserved + "^{tree}"),
          "-p",
          boundaryObserved,
          "-m",
          "fixture sibling after advertised forward"
        );
        git(
          boundaryCloud,
          "push",
          "origin",
          siblingTarget + ":refs/heads/fixture-sibling"
        );
      }
      const boundaryBranch = "boundary-lane-" + boundaryCase;
      const boundaryLane = join(temp, boundaryBranch);
      git(
        root,
        "worktree",
        "add",
        "-b",
        boundaryBranch,
        boundaryLane,
        phase === "remote-cas-sibling" ? advertisedTarget : boundaryBase
      );
      const boundarySource = commit(
        boundaryLane,
        "boundary-source-" + boundaryCase + ".txt",
        mode
      );
      put(boundaryLane, ".verifier-result.json", fixtureEvidence(boundaryLane));
      const postMerge = join(root, ".git/hooks/post-merge");
      writeFileSync(
        postMerge,
        '#!/bin/sh\n"' +
          process.execPath.replaceAll("\\", "/") +
          '" "' +
          join(root, "scripts/fixture-source-review.mjs").replaceAll(
            "\\",
            "/"
          ) +
          '" post-merge\n',
        { mode: 0o755 }
      );
      const postReceive = join(boundaryRemote, "hooks/post-receive");
      writeFileSync(
        postReceive,
        '#!/bin/sh\n"' +
          process.execPath.replaceAll("\\", "/") +
          '" "' +
          join(root, "scripts/fixture-source-review.mjs").replaceAll(
            "\\",
            "/"
          ) +
          '" post-receive\n',
        { mode: 0o755 }
      );
      const pushMarker = join(temp, "boundary-push-" + boundaryCase);
      rmSync(join(temp, "result.json"), { force: true });
      const rejected = execute(
        {
          FIXTURE_BOUNDARY_PUSH_MARKER: pushMarker,
          FIXTURE_SOURCE_REVIEW_PHASE: phase,
          FIXTURE_SOURCE_REVIEW_TARGET: main,
          FIXTURE_SOURCE_REVIEW_MODE: mode,
          FIXTURE_SOURCE_LANE: boundaryLane,
          ...(phase.startsWith("remote-")
            ? {
                FIXTURE_ADVERTISEMENT_MARKER: join(
                  temp,
                  "advertisement-" + boundaryCase
                ),
                FIXTURE_ADVERTISEMENT_REMOTE: boundaryRemote,
                FIXTURE_ADVERTISEMENT_TARGET: advertisedTarget,
                ...(siblingTarget
                  ? { FIXTURE_CAS_SIBLING: siblingTarget }
                  : {}),
              }
            : {}),
        },
        boundaryLane,
        boundaryBranch,
        boundarySource
      );
      if (phase === "remote-forward") {
        assert.equal(rejected.status, 0, rejected.stdout + rejected.stderr);
        assert.match(rejected.stdout, /REMOTE_MAIN_ADVERTISEMENT_CHANGED:/);
        assert.match(rejected.stdout, /remote advanced during push; retry/);
        const published = fetchMain(boundaryLane);
        assert(ancestor(boundaryLane, advertisedTarget, published));
        assert.equal(
          JSON.parse(readFileSync(join(temp, "result.json"))).head,
          published
        );
        assert.equal(git(boundaryLane, "rev-parse", "HEAD"), boundarySource);
        rmSync(postMerge);
        rmSync(postReceive);
        continue;
      }
      assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
      assert.match(
        rejected.stdout + rejected.stderr,
        phase === "remote-known-rejection-sibling"
          ? /remote main advertisement unavailable after push rejection/
          : ["remote-rollback", "remote-cas-sibling"].includes(phase)
            ? /remote main history changed at push advertisement/
            : phase === "remote-delete"
              ? /Invalid or deleted remote main push advertisement/
              : /new verifier attempt is incomplete|commit audit fallback refused/
      );
      const afterPush =
        phase === "remote-delete"
          ? git(
              boundaryRemote,
              "for-each-ref",
              "--format=%(objectname)",
              "refs/heads/main"
            )
          : fetchMain(boundaryLane);
      if (phase === "remote-delete") assert.equal(afterPush, "");
      else if (phase === "remote-rollback")
        assert.equal(afterPush, boundaryBase);
      else if (
        ["remote-cas-sibling", "remote-known-rejection-sibling"].includes(phase)
      )
        assert.equal(afterPush, siblingTarget);
      else if (["post-merge", "pre-push"].includes(phase))
        assert.equal(afterPush, boundaryObserved);
      else
        assert.equal(
          afterPush,
          git(main, "rev-parse", "HEAD"),
          "published commit must be preserved"
        );
      assert.equal(existsSync(pushMarker), phase !== "post-merge");
      assert.equal(
        existsSync(join(temp, "result.json")),
        false,
        "expired review must not produce a success receipt"
      );
      const records = readdirSync(join(root, "logs/auto-merge-runs"))
        .map((name) =>
          JSON.parse(readFileSync(join(root, "logs/auto-merge-runs", name)))
        )
        .filter((entry) => entry.workdir === resolve(boundaryLane));
      assert.equal(records.length, 1);
      assert.equal(records[0].status, "failed");
      assert.notEqual(records[0].publicationVerified, true);
      if (phase === "remote-known-rejection-sibling") {
        // Git omits a locally known non-fast-forward advertisement from stdin.
        // The original hook moves A to sibling B while that empty input is replayed.
        // Recovery must stop before it can treat S -> B as sufficient proof.
        assert.match(rejected.stdout, /\[rejected\] \(non-fast-forward\)/);
        assert.doesNotMatch(
          rejected.stdout,
          /push recovery:|remote advanced during push/
        );
        const candidate = join(temp, "remote-main-" + records[0].id + "-1");
        const publications = join(candidate, "logs/publication-hooks");
        const entries = readdirSync(publications);
        assert.equal(
          entries.length,
          1,
          "only one ordinary push may be attempted"
        );
        const publication = join(publications, entries[0]);
        const binding = JSON.parse(
          readFileSync(join(publication, "binding.json"), "utf8")
        );
        assert.equal(readFileSync(join(publication, "push-input"), "utf8"), "");
        assert.equal(
          existsSync(join(publication, "binding.json.advertisement.json")),
          false
        );
        assert.equal(binding.remoteHead, boundaryObserved);
        assert.equal(
          git(boundaryLane, "cat-file", "-t", advertisedTarget),
          "commit"
        );
        assert(
          !ancestor(boundaryLane, advertisedTarget, binding.candidate.head)
        );
        assert(!ancestor(boundaryLane, advertisedTarget, siblingTarget));
        assert.equal(git(main, "rev-parse", "HEAD"), binding.candidate.head);
        assert.equal(
          existsSync(join(temp, "remote-main-" + records[0].id + "-2")),
          false
        );
      }
      const retained = git(main, "rev-parse", "HEAD");
      assert.notEqual(retained, boundaryBase);
      assert(ancestor(boundaryLane, boundarySource, retained));
      assert(ancestor(boundaryLane, boundaryObserved, retained));
      assert.equal(git(boundaryLane, "rev-parse", "HEAD"), boundarySource);
      assert.equal(git(boundaryLane, "status", "--porcelain"), "");
      rmSync(postMerge);
      rmSync(postReceive);
    }
  }
  assert.equal(
    git(lane, "rev-parse", "refs/heads/protected-history"),
    protectedHistory
  );
  assert.equal(git(root, "config", "--get", "rebase.updateRefs"), "true");
  console.log(
    "[remote-main] real Git: rebase, history-only review, monotonic remote observations, gate/push races, hook failure, fresh tree evidence, concurrent source review invalidation, shared updateRefs isolation, source isolation, fetch error and conflict passed"
  );
  suitePassed = true;
} finally {
  if (previousLock === undefined) delete process.env.ORICA_SUPERVISOR_LOCK;
  else process.env.ORICA_SUPERVISOR_LOCK = previousLock;
  if (
    !resolve(temp).startsWith(
      resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")
    )
  )
    assert.fail("Unexpected fixture root");
  if (suitePassed) rmSync(temp, { recursive: true, force: true });
  else console.error(`[remote-main] failed fixture retained: ${temp}`);
}
