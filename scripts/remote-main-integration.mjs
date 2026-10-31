import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectGitOperation } from "./primary-main.mjs";
import { changedFilesBetweenTrees } from "./verifier-tree.mjs";

function environment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))
  );
}
export function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    env: environment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function ancestor(root, older, newer) {
  try {
    git(root, "merge-base", "--is-ancestor", older, newer);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
export function assertClean(root, head) {
  if (
    git(root, "rev-parse", "HEAD") !== head ||
    git(root, "status", "--porcelain") ||
    inspectGitOperation(root)
  )
    throw new Error(`Checkout changed or has an active Git operation: ${root}`);
}

// Never depend on FETCH_HEAD or a remote-tracking ref that another fetch can move.
// A fresh retained ref binds every validation attempt to one network observation.
export function fetchMain(root) {
  const ref = `refs/orica/remote-main/${randomUUID()}`;
  git(
    root,
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "origin",
    `refs/heads/main:${ref}`
  );
  return git(root, "rev-parse", `${ref}^{commit}`);
}

// Only this newly created candidate is rebased. The lane, main and published
// commits are never rewritten. Preserve their ancestry with a normal merge,
// accepting it only when it leaves the rebased content EXACTLY unchanged.
export function prepareCandidate({ root, source, main, remote, directory }) {
  if (!ancestor(root, main, source) && !ancestor(root, main, remote))
    throw new Error(
      "Local main is not preserved by source or fetched remote; stop without publication"
    );
  const base = git(root, "merge-base", remote, source);
  const branch = `integration/remote-main-${randomUUID()}`;
  git(root, "worktree", "add", "-b", branch, directory, source);
  try {
    git(
      directory,
      "-c",
      "rerere.enabled=false",
      "-c",
      "merge.oledger.driver=false",
      "rebase",
      "--rebase-merges",
      "--no-update-refs",
      "--onto",
      remote,
      base
    );
    const rebasedTree = git(directory, "rev-parse", "HEAD^{tree}");
    if (!ancestor(directory, source, "HEAD")) {
      git(
        directory,
        "-c",
        "rerere.enabled=false",
        "-c",
        "merge.oledger.driver=false",
        "merge",
        "--no-ff",
        "--no-commit",
        source
      );
      if (git(directory, "write-tree") !== rebasedTree)
        throw new Error("Ancestry preservation changed the rebased tree");
    }
    return { directory, branch, remote, source, main, tree: rebasedTree };
  } catch (error) {
    // Leave the owned candidate and any conflict for diagnosis. No resolution,
    // abort/reset/stash, checkout of 'ours/theirs', or live-lane write is allowed.
    let conflicts = "unknown";
    try {
      conflicts =
        git(directory, "diff", "--name-only", "--diff-filter=U") || "none";
    } catch {
      /* preserve error */
    }
    throw new Error(
      `Candidate stopped; preserved at ${directory}; conflicts: ${conflicts}; ${error.stderr || error.message}`,
      { cause: error }
    );
  }
}

// Save the prepared ancestry merge too: its index equals HEAD, but source is
// not an ancestor until the normal reviewed commit finishes that merge.
export function candidateCheckpoint(root, source, main, remote) {
  for (const head of [source, main, remote])
    if (!/^[a-f0-9]{40}$/.test(head || ""))
      throw new Error("Invalid candidate binding");
  const head = git(root, "rev-parse", "HEAD");
  const tree = git(root, "rev-parse", "HEAD^{tree}");
  const operation = inspectGitOperation(root);
  const mergeHead =
    operation === "MERGE_HEAD" ? git(root, "rev-parse", "MERGE_HEAD") : null;
  if (
    git(root, "status", "--porcelain") ||
    git(root, "write-tree") !== tree ||
    (operation &&
      (operation !== "MERGE_HEAD" || !ancestor(root, source, mergeHead))) ||
    (!mergeHead && !ancestor(root, source, head)) ||
    !ancestor(root, remote, head)
  )
    throw new Error("Candidate changed or has an unexpected Git operation");
  return {
    worktree: resolve(root),
    branch: git(root, "symbolic-ref", "--short", "HEAD"),
    common: git(
      root,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir"
    ),
    source,
    main,
    remote,
    head,
    tree,
    mergeHead,
  };
}

export function assertCandidateCheckpoint(root, saved, source, main, remote) {
  if (
    !saved ||
    saved.source !== source ||
    saved.remote !== remote ||
    ![saved.main, saved.head].includes(main) ||
    saved.common !==
      git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
  )
    throw new Error("Retained candidate base or repository changed");
  const current = candidateCheckpoint(
    saved.worktree,
    source,
    saved.main,
    remote
  );
  if (Object.keys(current).some((key) => current[key] !== saved[key])) {
    // Recover only the exact reviewed commit transition after a parent crash.
    const stable = Object.keys(current).filter(
      (key) => !["head", "mergeHead"].includes(key)
    );
    const parents = git(
      saved.worktree,
      "show",
      "-s",
      "--format=%P",
      current.head
    ).split(" ");
    if (
      current.mergeHead ||
      stable.some((key) => current[key] !== saved[key]) ||
      JSON.stringify(parents) !==
        JSON.stringify([
          saved.head,
          ...(saved.mergeHead ? [saved.mergeHead] : []),
        ])
    )
      throw new Error("Retained candidate changed; preserve it for inspection");
    assertVerifierEvidence(saved.worktree);
  }
  return current;
}

export function recordPushHookResult(file, exitCode) {
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255)
    throw new Error("Invalid hook result");
  const bound = assertPublicationGuard(file, { pushRoot: process.cwd() });
  writeFileSync(
    file + ".hook-result.json",
    JSON.stringify({
      attemptId: bound.attemptId,
      sourceHead: bound.source.head,
      head: bound.candidate.head,
      exitCode,
    }),
    { flag: "wx" }
  );
}

export function readPushHookResult(file) {
  const bound = assertPublicationGuard(file);
  const result = JSON.parse(readFileSync(file + ".hook-result.json", "utf8"));
  if (
    result.attemptId !== bound.attemptId ||
    result.sourceHead !== bound.source.head ||
    result.head !== bound.candidate.head ||
    !Number.isInteger(result.exitCode)
  )
    throw new Error("Hook result binding changed");
  return result.exitCode;
}

// Publication requires cooperating artifact writers in each actual checkout.
// Read-only audit inspection remains compatible with older checkers.
export function assertPublicationWriters(root) {
  const readCode = (name) =>
    readFileSync(join(root, "scripts", name), "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
      ""
    );
  try {
    const helper = readCode("verifier-write-lock.mjs");
    if (
      !/export\s+const\s+VERIFIER_WRITE_LOCK_PROTOCOL\s*=\s*1\s*;/.test(helper)
    )
      throw new Error("unknown writer protocol");
    for (const [name, action] of [
      ["spawn-verifier.mjs", "main"],
      ["verifier-evidence.mjs", "record"],
    ]) {
      const code = readCode(name);
      const imported =
        /(?:const\s*\{\s*runVerifierWriter\s*\}\s*=\s*await\s*import\(["']\.\/verifier-write-lock\.mjs["']\)|import\s*\{\s*runVerifierWriter\s*\}\s*from\s*["']\.\/verifier-write-lock\.mjs["'])/.test(
          code
        );
      if (
        !imported ||
        !code.includes(
          "await runVerifierWriter(import.meta.url, " + action + ")"
        )
      )
        throw new Error("writer does not use the merge protocol: " + name);
    }
  } catch (error) {
    throw new Error(
      "Verifier writers do not coordinate with publication; synchronize this checkout and rerun independent review: " +
        root,
      { cause: error }
    );
  }
}

export function assertVerifierEvidence(root) {
  const context = join(root, ".verifier-context.json");
  if (
    existsSync(context) &&
    JSON.parse(readFileSync(context, "utf8")).pending === true
  )
    throw new Error("new verifier attempt is incomplete");
  const result = join(root, ".verifier-result.json");
  if (!existsSync(result)) {
    if (
      [
        ".verifier-context.json",
        ".verifier-report.json",
        ".verifier-prompt.txt",
      ].some((name) => existsSync(join(root, name)))
    )
      throw new Error(
        "new verifier attempt has no passing evidence; commit audit fallback refused"
      );
    throw new Error(
      "fresh local verifier evidence required; run independent review"
    );
  }
  // The running helper enforces publication coverage even when the source
  // checkout has an older checker that still accepts historical reports.
  const evidence = JSON.parse(readFileSync(result, "utf8"));
  const coverage = evidence.report?.coverage;
  if (
    !coverage ||
    coverage.fullDiffRead !== true ||
    !Array.isArray(coverage.files) ||
    coverage.files.some((file) => typeof file !== "string" || !file.trim()) ||
    new Set(coverage.files).size !== coverage.files.length ||
    !Array.isArray(coverage.unverified) ||
    coverage.unverified.length !== 0 ||
    !Array.isArray(coverage.lenses) ||
    JSON.stringify(coverage.lenses.map((item) => item?.lens).sort()) !==
      JSON.stringify(["1", "2", "3", "4", "5", "6"]) ||
    !coverage.lenses.every((item) =>
      item.status === "checked"
        ? Array.isArray(item.evidence) &&
          item.evidence.length > 0 &&
          item.evidence.every(
            (value) => typeof value === "string" && /\S+:\d+/.test(value)
          )
        : item.status === "not_applicable" &&
          typeof item.reason === "string" &&
          !!item.reason.trim()
    )
  )
    throw new Error(
      "publication requires complete verifier coverage; run independent review"
    );
  // Main and commit parents can move after review. Only the archived review
  // context identifies the original comparison, including history-only merges.
  try {
    if (
      typeof evidence.archiveRelativePath !== "string" ||
      !evidence.archiveRelativePath.trim()
    )
      throw new Error("missing archived context path");
    const archived = JSON.parse(
      readFileSync(
        resolve(root, evidence.archiveRelativePath, "context.json"),
        "utf8"
      )
    );
    if (
      archived.schemaVersion !== 1 ||
      archived.base !== "main" ||
      evidence.base !== archived.base ||
      archived.pending === true ||
      archived.headTree !== evidence.headTree ||
      archived.headTree !== git(root, "rev-parse", "HEAD^{tree}")
    )
      throw new Error("archived context identity mismatch");
    for (const tree of [archived.baseTree, archived.headTree])
      if (
        typeof tree !== "string" ||
        !/^[a-f0-9]{40,64}$/.test(tree) ||
        git(root, "cat-file", "-t", tree) !== "tree"
      )
        throw new Error("archived context requires actual tree objects");
    const changedFiles = changedFilesBetweenTrees(
      root,
      archived.baseTree,
      archived.headTree,
      (directory, fromTree, toTree, args) =>
        git(
          directory,
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          ...args,
          fromTree,
          toTree
        )
    ).sort();
    if (
      JSON.stringify([...coverage.files].sort()) !==
      JSON.stringify(changedFiles)
    )
      throw new Error("coverage files do not match the archived tree diff");
  } catch (error) {
    throw new Error(
      "publication requires exact archived verifier coverage; run independent review: " +
        error.message,
      { cause: error }
    );
  }
  const args = [
    "check",
    "--base",
    "main",
    "--evidence",
    ".verifier-result.json",
  ];
  execFileSync(process.execPath, ["scripts/verifier-evidence.mjs", ...args], {
    cwd: root,
    env: environment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// The same immutable attempt binding is checked after the original pre-push,
// after the recorder's final fetch, and after the parent's remote observation.
export function assertPublicationGuard(file, expected = {}) {
  const bound = JSON.parse(readFileSync(file, "utf8"));
  const hash = (value) =>
    typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
  if (
    bound.schemaVersion !== 1 ||
    !/^[a-f0-9]{32}$/.test(bound.attemptId || "")
  )
    throw new Error("Invalid publication guard identity");
  for (const name of ["source", "candidate", "integration"]) {
    const item = bound[name];
    if (
      !item ||
      typeof item.root !== "string" ||
      !item.root ||
      !hash(item.head) ||
      typeof item.branch !== "string" ||
      !item.branch
    )
      throw new Error("Invalid publication guard checkout");
    assertClean(item.root, item.head);
    if (git(item.root, "symbolic-ref", "--short", "HEAD") !== item.branch)
      throw new Error("Publication guard branch changed: " + name);
  }
  if (
    bound.candidate.head !== bound.integration.head ||
    (expected.attemptId && bound.attemptId !== expected.attemptId) ||
    (expected.sourceHead && bound.source.head !== expected.sourceHead) ||
    (expected.publishedHead &&
      bound.candidate.head !== expected.publishedHead) ||
    (expected.workdir &&
      resolve(bound.source.root) !== resolve(expected.workdir)) ||
    (expected.pushRoot &&
      resolve(bound.candidate.root) !== resolve(expected.pushRoot))
  )
    throw new Error("Publication guard binding changed");
  if (
    !hash(bound.remoteHead) ||
    !ancestor(bound.candidate.root, bound.remoteHead, bound.candidate.head)
  )
    throw new Error("Invalid publication guard remote ancestry");
  assertPublicationWriters(bound.source.root);
  assertPublicationWriters(bound.candidate.root);
  assertVerifierEvidence(bound.source.root);
  if (resolve(bound.candidate.root) !== resolve(bound.source.root))
    assertVerifierEvidence(bound.candidate.root);
  if (expected.pushInput !== undefined) {
    const lines = expected.pushInput.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length > 1)
      throw new Error("Unexpected multiple push advertisements");
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      if (
        fields.length !== 4 ||
        fields[1] !== bound.candidate.head ||
        fields[2] !== "refs/heads/main" ||
        !hash(fields[3]) ||
        /^0+$/.test(fields[3])
      )
        throw new Error("Invalid or deleted remote main push advertisement");
      let forward = false;
      try {
        forward = ancestor(bound.candidate.root, bound.remoteHead, fields[3]);
      } catch {
        /* Unknown advertised objects require a fresh fetch before retry. */
      }
      writeFileSync(
        file + ".advertisement.json",
        JSON.stringify({
          attemptId: bound.attemptId,
          remoteHead: bound.remoteHead,
          advertisedHead: fields[3],
          retryRequired: !forward,
        }),
        { flag: "wx" }
      );
      if (!forward)
        throw new Error("REMOTE_MAIN_ADVERTISEMENT_CHANGED:" + fields[3]);
    }
  }
  return bound;
}

export function preparePublicationHook({
  root,
  source,
  sourceBranch,
  sourceHead,
  branch,
  head,
  integration,
  attemptId,
  remoteHead,
}) {
  const original = join(
    git(root, "rev-parse", "--path-format=absolute", "--git-path", "hooks"),
    "pre-push"
  );
  if (!existsSync(original) || process.env.HUSKY === "0")
    throw new Error("Normal pre-push hook is unavailable or disabled");
  const directory = join(root, "logs/publication-hooks", randomUUID());
  mkdirSync(directory, { recursive: true });
  const guardFile = join(directory, "binding.json");
  writeFileSync(
    guardFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        attemptId,
        remoteHead,
        source: { root: source, head: sourceHead, branch: sourceBranch },
        candidate: { root, head, branch },
        integration: { root: integration, head, branch: "main" },
        originalHook: original,
      },
      null,
      2
    ) + "\n"
  );
  assertPublicationGuard(guardFile, { pushRoot: root });
  const quote = (value) =>
    "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
  const inputFile = join(directory, "push-input");
  const helper =
    quote(process.execPath) + " " + quote(fileURLToPath(import.meta.url));
  // Preserve original arguments, stdin, cwd, and exit status. No shared config
  // changes: only this git push selects the wrapper with command-local -c.
  writeFileSync(
    join(directory, "pre-push"),
    [
      "#!/bin/sh",
      helper + " capture-push-input " + quote(inputFile) + " || exit $?",
      quote(original) + ' "$@" < ' + quote(inputFile),
      "hook_code=$?",
      'if [ "$hook_code" -ne 0 ]; then',
      helper + " hook-result " + quote(guardFile) + ' "$hook_code" || exit 1',
      'exit "$hook_code"',
      "fi",
      helper + " push-guard " + quote(guardFile) + " < " + quote(inputFile),
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return { directory, guardFile };
}

function run(command, args, cwd, input, timeout = 3_600_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment(),
      windowsHide: true,
      stdio: [input === undefined ? "ignore" : "pipe", "inherit", "inherit"],
      timeout,
    });
    child.on("error", reject);
    if (input !== undefined) {
      child.stdin.on("error", reject);
      child.stdin.end(input);
    }
    child.on("close", (code, signal) =>
      code === 0 && !signal
        ? resolveRun()
        : reject(new Error(`${command} exited ${code}, signal ${signal}`))
    );
  });
}

// Worktrees share Git config but Husky's generated shims are checkout-local.
// Copy compatible installed shims; never rewrite the shared hooksPath setting.
export function ensureCandidateHooks(root, source) {
  const hooks = git(
    root,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks"
  );
  if (resolve(hooks) === resolve(root, ".husky/_")) {
    if (process.env.HUSKY === "0") throw new Error("Normal hooks are disabled");
    const installed = join(root, "node_modules/husky/husky");
    const from = join(source, ".husky/_");
    if (
      !existsSync(installed) ||
      !existsSync(join(from, "h")) ||
      !readFileSync(installed).equals(readFileSync(join(from, "h")))
    )
      throw new Error(
        "Compatible installed Husky shims unavailable; preserve candidate"
      );
    mkdirSync(hooks, { recursive: true });
    for (const name of ["h", "pre-commit", "pre-push", ".gitignore"])
      copyFileSync(join(from, name), join(hooks, name));
    for (const name of ["pre-commit", "pre-push"])
      chmodSync(join(hooks, name), 0o755);
  }
  if (!existsSync(join(hooks, "pre-push")))
    throw new Error("Normal pre-push hook is unavailable; cannot publish");
}

// Match the running supervisor's installed-version selection. The root shim
// can be an obsolete CLI even when a current bundled version is installed.
export function resolveCodex(
  bundled = join(process.env.LOCALAPPDATA || "", "OpenAI/Codex/bin")
) {
  const versions = existsSync(bundled)
    ? readdirSync(bundled, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          path: join(bundled, entry.name, "codex.exe"),
          modified: statSync(join(bundled, entry.name)).mtimeMs,
        }))
        .filter((entry) => existsSync(entry.path))
        .sort((a, b) => b.modified - a.modified)
        .map((entry) => entry.path)
    : [];
  const codex = [...versions, join(bundled, "codex.exe")].find(existsSync);
  if (!codex) throw new Error("Independent Codex verifier is unavailable");
  return codex;
}

// Explicitly review history-only candidates too; the default spawn command
// still treats an empty content diff as no verification request.
export async function prepareReviewPrompt(root) {
  await run(
    process.execPath,
    [
      "scripts/spawn-verifier.mjs",
      "--allow-empty",
      "--base",
      "main",
      "--max-diff-lines",
      "1000000",
      "--out",
      ".verifier-prompt.txt",
    ],
    root
  );
  return readFileSync(join(root, ".verifier-prompt.txt"), "utf8");
}

// Keep the complete prompt on disk: large cumulative reviews can exceed the
// CLI's single-message limit. Bind that file and the clean candidate to the run.
export function bindReviewPrompt(root, prompt) {
  const binding = {
    path: resolve(root, ".verifier-prompt.txt"),
    head: git(root, "rev-parse", "HEAD"),
    tree: git(root, "rev-parse", "HEAD^{tree}"),
    mergeHead: reviewMergeHead(root),
    sha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
  };
  assertReviewPromptUnchanged(root, binding);
  return {
    ...binding,
    input: `Read ${JSON.stringify(binding.path)} completely using bounded chunked reads, then follow all its review instructions. Verify its SHA-256 is ${binding.sha256} before and after reading. The target tree is ${binding.tree}, HEAD ${binding.head}. The full prompt is stored in this file to avoid the single-message input limit. Do not truncate or narrow its complete diff, changed files, or review scope. Treat missing, unreadable, or truncated content as unverified; never assume a successful read when tool output is truncated.\n\nThis is an independent review of an integration candidate. Read the entire diff and relevant sources, including remote changes. Do not edit files or run mutations. Inspect the existing final gate records in logs/harness and match their fingerprint/source tree to the candidate; do not rerun gates or write knowledge-base records during this read-only review. If the generated prompt identifies a required candidate fuzz receipt, read the exact logs/fuzz-runs file and verify its SHA-256, passed status, 200-game count, exit code, queue receipt, candidate HEAD/tree, and source fingerprint against the prompt and target tree. A fixture or an unrelated receipt is not evidence. Those prohibited writes are not source coverage requirements. Return only the prescribed JSON. Record any unread source or missing relevant verification evidence as unverified scope; do not vouch for it. If the Windows shell helper reports a setup failure, use the normal per-command approval request (sandbox_permissions=require_escalated) only for harmless read-only commands. Never bypass approval or change sandbox, approval, authentication, or model settings. If approval is denied or sources cannot be read, stop and report the unverified scope.`,
  };
}

function reviewMergeHead(root) {
  const operation = inspectGitOperation(root);
  if (operation && operation !== "MERGE_HEAD")
    throw new Error("Unexpected Git operation during independent review");
  return operation === "MERGE_HEAD"
    ? readFileSync(
        git(
          root,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "MERGE_HEAD"
        ),
        "utf8"
      )
    : null;
}

export function assertReviewPromptUnchanged(root, binding) {
  if (binding.path !== resolve(root, ".verifier-prompt.txt"))
    throw new Error("Independent review prompt path changed");
  if (
    git(root, "rev-parse", "HEAD") !== binding.head ||
    git(root, "status", "--porcelain") ||
    git(root, "rev-parse", "HEAD^{tree}") !== binding.tree ||
    reviewMergeHead(root) !== binding.mergeHead ||
    createHash("sha256").update(readFileSync(binding.path)).digest("hex") !==
      binding.sha256
  )
    throw new Error("Independent review prompt or candidate tree changed");
}

// Independent Codex process, read-only sandbox, no model/credential/settings
// changes. Failure, incomplete JSON or refutation prevents publication.
export async function reviewCandidate(root) {
  const codex = resolveCodex();
  const prompt = await prepareReviewPrompt(root);
  const binding = bindReviewPrompt(root, prompt);
  await run(
    codex,
    [
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--output-last-message",
      ".verifier-report.json",
      "-",
    ],
    root,
    binding.input,
    3_600_000
  );
  assertReviewPromptUnchanged(root, binding);
  await run(
    process.execPath,
    ["scripts/verifier-evidence.mjs", "record"],
    root
  );
  await run(
    process.execPath,
    [
      "scripts/verified-commit.mjs",
      "--base",
      "main",
      "--allow-empty",
      "-m",
      "fix: remote main取込後の統合候補を再検証",
    ],
    root
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, root, ...args] = process.argv.slice(2);
    if (command === "fetch") console.log(fetchMain(root));
    else if (command === "checkpoint")
      console.log(JSON.stringify(candidateCheckpoint(root, ...args)));
    else if (command === "resume-candidate")
      console.log(
        JSON.stringify(
          assertCandidateCheckpoint(root, JSON.parse(args[0]), ...args.slice(1))
        )
      );
    else if (command === "hook-result")
      recordPushHookResult(root, Number(args[0]));
    else if (command === "hook-exit") console.log(readPushHookResult(root));
    else if (command === "writers") assertPublicationWriters(root);
    else if (command === "capture-push-input")
      writeFileSync(root, readFileSync(0), { flag: "w" });
    else if (command === "publication-guard")
      assertPublicationGuard(root, JSON.parse(args[0]));
    else if (command === "push-guard")
      assertPublicationGuard(root, {
        pushRoot: process.cwd(),
        pushInput: readFileSync(0, "utf8"),
      });
    else if (command === "prepare-push") {
      const [
        source,
        sourceBranch,
        sourceHead,
        branch,
        head,
        integration,
        attemptId,
        remoteHead,
      ] = args;
      console.log(
        JSON.stringify(
          preparePublicationHook({
            root,
            source,
            sourceBranch,
            sourceHead,
            branch,
            head,
            integration,
            attemptId,
            remoteHead,
          })
        )
      );
    } else if (command === "prepare") {
      const [source, main, remote, directory] = args;
      mkdirSync(dirname(directory), { recursive: true });
      console.log(
        JSON.stringify(
          prepareCandidate({ root, source, main, remote, directory })
        )
      );
    } else if (command === "evidence") assertVerifierEvidence(root);
    else if (command === "hooks") ensureCandidateHooks(root, args[0]);
    else if (command === "review") await reviewCandidate(root);
    else
      throw new Error(
        "Usage: remote-main-integration.mjs fetch|prepare|review|evidence|prepare-push|push-guard <root-or-binding> ..."
      );
  } catch (error) {
    console.error(`[remote-main] ${error.message}`);
    process.exitCode = 1;
  }
}
