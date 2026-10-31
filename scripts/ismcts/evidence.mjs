import { existsSync, readdirSync, realpathSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import state from "../harness/verification-state.cjs";
import { auditInputFiles } from "../audit-inputs.mjs";
import { gates, selectGates } from "../harness/gate-manifest.mjs";
import { leaseFailureExit, LEASE_WAIT_EXIT } from "../harness/gate-lease.mjs";
import { buildVerificationTree } from "../verifier-tree.mjs";
import {
  hash,
  fileHash,
  readJson,
  atomicJson,
  contained,
  descriptor,
  checkDescriptor,
  timestamp,
  git,
  sharedFile,
  transaction,
  safePath,
} from "./shared.mjs";

// A sub-acceptance is useful evidence, but never completes its parent. Runtime
// resource control and calibration deliberately have no runnable gate yet.
export const tasks = {
  I0: ["E1", "R1-budget", "R1-runtime", "calibration"],
  I1: ["H1", "H2", "H3"],
  I2: ["T1", "T3"],
  I3: ["T2", "smoke16"],
  I4: ["S1", "gui-natural-game", "solo-fallback"],
  I5: ["deployment", "release400"],
  I6: ["nn-resume", "nn-evaluation", "training-loop", "model-lifecycle"],
  I7: ["O1", "monitor-live", "autonomy-soak"],
};
const gateByAcceptance = {
  E1: "ismcts-program",
  "R1-budget": "ismcts-program",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requiredInputs = [
  "pnpm-lock.yaml",
  "scripts/ismcts-program.mjs",
  "scripts/test-ismcts-program.mjs",
  "scripts/ismcts/resource-profile.json",
  "scripts/harness/gate-manifest.json",
  "scripts/harness/run-gates.mjs",
  "scripts/harness/gate-lease.mjs",
  "scripts/harness/gate-queue.mjs",
  "scripts/harness/verification-state.cjs",
  "scripts/verifier-evidence.mjs",
  "scripts/verified-commit.mjs",
  "scripts/artifact-storage.mjs",
  "scripts/artifact-storage-policy.json",
  "scripts/lib/stored-file-sizes.mjs",
  "scripts/lib/stored-file-sizes.ps1",
  "manual/ai-reference/30_plan/ismcts-full-run/tasks.md",
  "manual/ai-reference/30_plan/ismcts-full-run/resources.md",
  "manual/ai-reference/30_plan/ismcts-full-run/evidence.md",
];

function runtimeHash(root) {
  // The wrapper plans before worker-codex-stream adds its delivery and LLM
  // launcher metadata. Those exact keys do not configure the Node acceptance
  // regressions; their presence/value must not force a repair on every tick.
  // Keep unknown ORICA_* and all computational settings in the fingerprint.
  const deliveryOnly = new Set([
    "ORICA_INTEGRATION_REQUEST",
    "ORICA_WORKER_DELIVERY_FILE",
    "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
    "ORICA_CODEX_CLI",
    "ORICA_CODEX_FULL_RUN",
    "ORICA_CODEX_MODEL",
    "ORICA_CODEX_REASONING_EFFORT",
    "ORICA_CODEX_VERBOSITY",
    "ORICA_FULL_RUN_WORKER_REF",
    "ORICA_LANE_KIND",
    "ORICA_CLUSTER_REGISTRY",
    "ORICA_EFFECT_DEBUG_HUB_ROOT",
    "ORICA_SUPERVISOR_HUB_REPO",
  ]);
  const env = Object.entries(process.env)
    .filter(
      ([key]) =>
        !deliveryOnly.has(key.toUpperCase()) &&
        state.isVerificationEnvironment(key)
    )
    .sort();
  const files = [
    ".env",
    ".env.local",
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
  ];
  return hash(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      env,
      files: files.map((file) => [
        file,
        existsSync(resolve(root, file)) ? fileHash(resolve(root, file)) : null,
      ]),
    })
  );
}

function scopedInputPaths(paths) {
  // E1/R1-budget execute the controller suite. These reviewed leaves are only
  // exercised by the separate runtime suite; neither can complete R1-runtime.
  // Unknown/new paths retain the conservative scope until their dependencies
  // have been reviewed. Shared budget, resources, native control and harness
  // inputs deliberately remain bound.
  const runtimeOnly = new Set([
    "scripts/ismcts/runtime-telemetry.mjs",
    "scripts/ismcts/test-runtime-telemetry.mjs",
    "manual/ai-reference/30_plan/ismcts-full-run/i0-runtime-telemetry.md",
    "manual/ai-reference/30_plan/ismcts-full-run/i0-work-telemetry.md",
  ]);
  return [
    ...new Set([
      ...requiredInputs,
      ...paths.filter(
        (file) =>
          !runtimeOnly.has(file) &&
          /(?:^|\/)\.gitattributes$|^(?:scripts\/ismcts\/|scripts\/harness\/|scripts\/(?:verifier[^/]*|full-run-checkouts|primary-main|audit-inputs)\.mjs$|manual\/ai-reference\/30_plan\/ismcts-full-run\/)/.test(
            file
          )
      ),
    ]),
  ].sort();
}

export function scopeFingerprint(root, taskId) {
  if (!Object.hasOwn(tasks, taskId)) throw new Error("unknown ISMCTS task");
  // Unknown tasks/modules remain conservative, including untracked inputs.
  const files = scopedInputPaths(
    git(root, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ]).split("\0")
  );
  const inputs = files.map((file) => descriptor(root, file));
  // Preserve the executed checkout's raw SHA256. Git applies attributes/clean
  // filters when building the verifier tree (e.g. CRLF .ps1 -> LF blob), so bind
  // that representation separately, using the same safecrlf policy. Batch the
  // read-only hash operation; do not write objects or normalize source/log bytes.
  const blobs = git(root, [
    "-c",
    "core.safecrlf=false",
    "hash-object",
    "--",
    ...files,
  ]).split(/\r?\n/);
  if (
    blobs.length !== inputs.length ||
    blobs.some((id) => !/^[0-9a-f]{40}$/.test(id))
  )
    throw new Error("invalid Git source blob manifest");
  inputs.forEach((input, index) => {
    input.gitBlob = blobs[index];
  });
  return {
    fingerprint: hash(JSON.stringify(inputs)),
    inputs,
    runtime: runtimeHash(root),
  };
}

const harnessFingerprint = (root) =>
  state.sourceFingerprint(root, { extraFiles: auditInputFiles(root) });
function checkVerifiedCommit(root, commit, evidencePath) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
  );
  execFileSync(
    process.execPath,
    [
      resolve(root, "scripts/verifier-evidence.mjs"),
      "check-commit",
      "--commit",
      commit,
      ...(evidencePath ? ["--evidence", evidencePath] : []),
    ],
    {
      cwd: root,
      env,
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
      timeout: 10000,
    }
  );
}
function selectedRunGates(root, run) {
  const frozen = run.sourceTree !== undefined;
  if (
    frozen &&
    (!/^[0-9a-f]{40}$/.test(run.sourceTree) ||
      git(root, ["cat-file", "-t", run.sourceTree]) !== "tree")
  )
    throw new Error("invalid/missing frozen harness tree");
  if (!frozen) return selectGates(run.profile, null);
  if (
    !Array.isArray(run.diffBases) ||
    run.diffBases.some(
      (base) =>
        typeof base !== "string" ||
        !/^[0-9a-f]{40}$/.test(base) ||
        git(root, ["rev-parse", `${base}^{commit}`]) !== base
    )
  )
    throw new Error("invalid frozen harness scope bases");
  // A new remote ref can have an unknown comparison base. Its scope is full,
  // never a supplied narrow path list. Known bases must reproduce the paths
  // from the immutable execution tree, including deletions and rename sources.
  if (run.profile === "push" && run.changed === null)
    return selectGates(run.profile, null);
  if (!run.diffBases.length || !Array.isArray(run.changed))
    throw new Error("missing frozen harness scope");
  const changed = [
    ...new Set(
      run.diffBases.flatMap((base) =>
        git(root, [
          "diff",
          "--no-ext-diff",
          "--no-renames",
          "--name-only",
          "-z",
          base,
          run.sourceTree,
          "--",
        ])
          .split("\0")
          .filter(Boolean)
      )
    ),
  ].sort();
  if (JSON.stringify(run.changed) !== JSON.stringify(changed))
    throw new Error("frozen harness scope paths disagree with tree/base diff");
  return selectGates(
    run.profile,
    changed,
    (file) =>
      run.diffBases.flatMap((base) =>
        state.changedLines(root, file, base, run.sourceTree)
      ),
    (file) =>
      run.diffBases.some((base) => {
        try {
          git(root, ["cat-file", "-e", `${base}:${file}`]);
          return false;
        } catch {
          return true;
        }
      })
  );
}
function harnessRunStart(file, run, now) {
  if (!run || typeof run !== "object" || Array.isArray(run))
    throw new Error("invalid harness history");
  const startedAt = timestamp(run.startedAt, now);
  // Both canonical names are written by run-gates from the same clock value
  // as the report. Validate before discarding old history; a corrupted time
  // must not silently turn a later failed attempt into an older one.
  const match = /^(0|[1-9][0-9]*)-(?:([1-9][0-9]*)|(.+)-blocked)\.json$/.exec(
    basename(file)
  );
  // run-gates writes every supported profile, including scenario. Validate
  // blocked names against the harness SSOT instead of a parallel profile list.
  if (match?.[3]) {
    try {
      selectGates(match[3]);
    } catch {
      throw new Error("harness filename/start timestamp mismatch");
    }
  }
  if (
    !match ||
    Number(match[1]) !== startedAt ||
    (match[2] && !Number.isSafeInteger(Number(match[2]))) ||
    (match[3] && (match[3] !== run.profile || run.requestedAt !== startedAt))
  )
    throw new Error("harness filename/start timestamp mismatch");
  return startedAt;
}

function validRun(root, file, now) {
  const directory = resolve(root, "logs/harness/runs"),
    full = contained(directory, file);
  if (dirname(full) !== realpathSync(directory))
    throw new Error("harness run outside canonical history directory");
  const run = readJson(full);
  harnessRunStart(full, run, now);
  if (
    run.schemaVersion !== 2 ||
    realpathSync(run.root) !== realpathSync(root) ||
    !["finish", "full"].includes(run.profile) ||
    run.status !== "passed" ||
    run.completionGate !== true ||
    !Array.isArray(run.gates) ||
    !Array.isArray(run.changed) ||
    run.changed.some((file) => typeof file !== "string") ||
    !Array.isArray(run.diffBases) ||
    !/^[0-9a-f]{40}$/.test(run.sourceTree) ||
    run.diffBases.length === 0 ||
    run.diffBases.some((base) => !/^[0-9a-f]{40}$/.test(base)) ||
    !Array.isArray(run.vitestArgs) ||
    run.vitestArgs.length ||
    run.finishedAt < run.startedAt
  )
    throw new Error("incomplete/foreign harness run");
  timestamp(run.startedAt, now);
  timestamp(run.finishedAt, now);
  const required = selectedRunGates(root, run);
  if (
    run.gates.length === 0 ||
    run.gates.some(
      (gate) =>
        gate.status !== "passed" ||
        gate.reused !== false ||
        gate.exitCode !== 0 ||
        !Number.isSafeInteger(gate.startedAt) ||
        !Number.isSafeInteger(gate.finishedAt) ||
        gate.startedAt < run.startedAt ||
        gate.finishedAt > run.finishedAt ||
        gate.finishedAt < gate.startedAt
    ) ||
    new Set(run.gates.map((gate) => gate.id)).size !== run.gates.length ||
    JSON.stringify(run.gates.map((gate) => gate.id).sort()) !==
      JSON.stringify([...required].sort())
  )
    throw new Error("partial harness gate result");
  return { run, full };
}

function gateEvidence(root, gate, now) {
  const expected = gates[gate.id];
  if (
    !expected?.node ||
    expected.node !== "scripts/test-ismcts-program.mjs" ||
    gate.reused !== false ||
    gate.exitCode !== 0 ||
    gate.command !== process.execPath ||
    JSON.stringify(gate.argv) !==
      JSON.stringify([resolve(root, expected.node), ...(expected.args ?? [])])
  )
    throw new Error("unexecuted/mismatched acceptance command");
  timestamp(gate.startedAt, now);
  timestamp(gate.finishedAt, now);
  if (gate.finishedAt < gate.startedAt)
    throw new Error("invalid gate duration");
  const output = descriptor(
    resolve(root, "logs/harness/output"),
    gate.outputLog
  );
  const text = readFileSync(
    contained(resolve(root, "logs/harness/output"), output.path),
    "utf8"
  );
  const matches = [...text.matchAll(/^ISMCTS_TEST_RESULT (.+)$/gm)];
  if (matches.length !== 1)
    throw new Error("missing/ambiguous acceptance test counts");
  const counts = JSON.parse(matches[0][1]);
  for (const key of ["attempted", "completed", "failed", "deferred"])
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0)
      throw new Error("invalid acceptance counts");
  if (
    counts.attempted === 0 ||
    counts.completed !== counts.attempted ||
    counts.failed ||
    counts.deferred
  )
    throw new Error("zero/partial/failed acceptance tests");
  return {
    id: gate.id,
    command: gate.command,
    argv: gate.argv,
    startedAt: gate.startedAt,
    finishedAt: gate.finishedAt,
    exitCode: gate.exitCode,
    combinedOutput: output,
    counts,
  };
}

function receiptFiles(directory) {
  const path = safePath(resolve(directory, "receipts"));
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => resolve(path, file));
}

function checkLaterFailure(root, receipt, receiptRunStartedAt, now) {
  const directory = safePath(resolve(root, "logs/harness/runs")),
    history = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({
        file: resolve(directory, name),
        run: readJson(resolve(directory, name)),
      }));
  for (const { file, run } of history) {
    const startedAt = harnessRunStart(file, run, now);
    // Compare run clocks with run clocks. A blocked/cached-only request can
    // start after the receipt's run, before its acceptance gate is reached.
    // Only the exact source file is exempt at the same millisecond. Ordering
    // a separate attempt at an equal clock is unknown, never an older green.
    if (
      startedAt < receiptRunStartedAt ||
      basename(file) === receipt.harnessRun.path
    )
      continue;
    // The runner writes this separate envelope before it acquires the lease.
    // No gate executed, so a resource wait cannot refute prior acceptance.
    // Only the canonical unexecuted shape is exempt; malformed waits and any
    // actual running/failed execution retain the conservative failure path.
    if (
      basename(file) === `${startedAt}-${run.profile}-blocked.json` &&
      run.schemaVersion === 2 &&
      run.status === "failed" &&
      realpathSync(run.root) === realpathSync(root) &&
      leaseFailureExit({ code: run.failureCode }) === LEASE_WAIT_EXIT &&
      run.durationMs === 0 &&
      Number.isSafeInteger(run.leaseWaitMs) &&
      run.leaseWaitMs >= 0 &&
      run.finishedAt === startedAt + run.leaseWaitMs &&
      Array.isArray(run.gates) &&
      run.gates.length === 0 &&
      Array.isArray(run.vitestArgs) &&
      run.vitestArgs.every((arg) => typeof arg === "string") &&
      run.sourceTree === undefined &&
      run.fingerprint === undefined &&
      run.followupFingerprint === undefined &&
      run.gateInputs === undefined &&
      run.completionGate === undefined
    ) {
      timestamp(run.finishedAt, now);
      continue;
    }
    const newerGate = run.gates?.find((gate) => gate.id === receipt.gate.id);
    // A changed whole-tree hash cannot prove independent acceptance conditions.
    // Retain later related execution failures conservatively; never resurrect
    // an older green merely because another input changed.
    // Line-scoped finish/push runs use the same diff bases as receipt validation.
    // Missing bases remain conservative; a real navigation-only finish does
    // not become a fictitious full acceptance attempt.
    const selected = selectedRunGates(root, run);
    if (!newerGate && !selected.includes(receipt.gate.id)) continue;
    try {
      // A full run that failed at format is still an acceptance attempt. Its
      // transition from running to failed must never restore an older green.
      if (run.status !== "passed") throw new Error("incomplete/failed run");
      if (
        run.profile === "full" ||
        (run.profile === "finish" &&
          run.gates.every((gate) => gate.reused === false))
      ) {
        const checked = validRun(root, file, now).run;
        gateEvidence(
          root,
          checked.gates.find((gate) => gate.id === receipt.gate.id),
          now
        );
      } else {
        // Other harness profiles can legitimately reuse checks during merge
        // and push. They cannot supply a fresh completion receipt, but a failed
        // or partial attempt must still invalidate it. Reused acceptance is
        // bound to its original fresh run rather than fabricated exit metadata.
        if (
          run.schemaVersion !== 2 ||
          realpathSync(run.root) !== realpathSync(root) ||
          !Array.isArray(run.gates) ||
          !Array.isArray(run.vitestArgs) ||
          run.finishedAt < run.startedAt ||
          JSON.stringify(run.gates.map((gate) => gate.id).sort()) !==
            JSON.stringify([...selected].sort()) ||
          run.gates.some(
            (gate) =>
              gate.status !== "passed" ||
              (gate.reused !== false &&
                !(
                  gate.reused === true &&
                  ["finish", "merge", "push"].includes(run.profile)
                ))
          )
        )
          throw new Error("partial related run");
        timestamp(run.finishedAt, now);
        for (const gate of run.gates) {
          let execution = gate,
            source = run;
          if (gate.reused) {
            const candidates = history.filter(
              (item) => item.run?.startedAt === gate.sourceRun
            );
            if (candidates.length !== 1)
              throw new Error("ambiguous/missing cache source");
            source = candidates[0].run;
            execution = source.gates?.find((item) => item.id === gate.id);
            if (
              source.schemaVersion !== 2 ||
              source.status !== "passed" ||
              !state.gateInputsMatch(
                source,
                run,
                gate.id,
                gates[gate.id].inputScope
              ) ||
              realpathSync(source.root) !== realpathSync(root) ||
              source.finishedAt > run.startedAt ||
              execution?.status !== "passed" ||
              execution.reused !== false
            )
              throw new Error("invalid cache source");
          }
          timestamp(source.startedAt, now);
          timestamp(source.finishedAt, now);
          if (source.finishedAt < source.startedAt)
            throw new Error("invalid execution source duration");
          timestamp(execution.startedAt, now);
          timestamp(execution.finishedAt, now);
          if (
            execution.exitCode !== 0 ||
            execution.startedAt < source.startedAt ||
            execution.finishedAt > source.finishedAt ||
            execution.finishedAt < execution.startedAt
          )
            throw new Error("incomplete related execution");
          if (gate.id === receipt.gate.id) gateEvidence(root, execution, now);
        }
      }
    } catch (error) {
      throw new Error(
        `later incomplete/failed acceptance run: ${error.message}`,
        { cause: error }
      );
    }
  }
}

function checkFinalization(root, directory, receipt, now) {
  if (!receipt.finalization) return "unverified";
  const final = receipt.finalization;
  if (
    !/^[0-9a-f]{40}$/.test(final.commit) ||
    typeof final.integrationId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(final.integrationId)
  )
    throw new Error("invalid finalization binding");
  for (const key of ["context", "report", "result"])
    checkDescriptor(directory, final.verifier[key]);
  const context = readJson(contained(directory, final.verifier.context.path));
  const report = readJson(contained(directory, final.verifier.report.path));
  const result = readJson(contained(directory, final.verifier.result.path));
  if (
    report.coverage?.fullDiffRead !== true ||
    report.coverage?.unverified?.length !== 0 ||
    !Array.isArray(report.items) ||
    report.items.some((item) => item.refuted !== false) ||
    !result.report ||
    hash(JSON.stringify(result.report)) !== hash(JSON.stringify(report))
  )
    throw new Error("invalid/refuted verifier evidence");
  // Zero findings are valid when the full coverage review is complete. The
  // existing verifier validator remains the authority for both empty items and
  // vouches; shape checks alone never authenticate copied JSON as evidence.
  git(root, ["cat-file", "-e", `${final.commit}^{commit}`]);
  checkVerifiedCommit(root, final.commit);
  const message = git(root, ["show", "-s", "--format=%B", final.commit]);
  if (
    !message.includes(`Verifier-Report-SHA256: ${result.reportSha256}\n`) ||
    !message.includes(`Verifier-Report-Base64: ${result.reportBase64}`)
  )
    throw new Error("verifier archive differs from commit audit");
  if (
    JSON.stringify(
      JSON.parse(Buffer.from(result.reportBase64, "base64").toString("utf8"))
    ) !== JSON.stringify(report)
  )
    throw new Error(
      "copied verifier report differs from commit embedded report"
    );
  if (git(root, ["rev-parse", `${final.commit}^{tree}`]) !== result.headTree)
    throw new Error("verifier result and verified commit tree differ");
  if (
    result.headTree !== receipt.validatedTree ||
    context.headTree !== result.headTree ||
    !Number.isFinite(Date.parse(context.generatedAt)) ||
    !Number.isFinite(Date.parse(result.verifiedAt))
  )
    throw new Error("receipt and verifier validated trees differ");
  timestamp(Date.parse(context.generatedAt), now);
  timestamp(Date.parse(result.verifiedAt), now);
  for (const input of receipt.inputs) {
    if (
      !/^[0-9a-f]{40}$/.test(input.gitBlob) ||
      git(root, ["rev-parse", "--verify", `${final.commit}:${input.path}`]) !==
        input.gitBlob
    )
      throw new Error("receipt source differs from verified commit");
  }
  if (
    context.worktreeRoot &&
    realpathSync(context.worktreeRoot) !== realpathSync(root)
  )
    throw new Error("foreign verifier context");
  const parent = resolve(directory, "../supervisor-integrations");
  const ticket = readJson(contained(parent, `${final.integrationId}.json`));
  timestamp(Date.parse(ticket.finishedAt), now);
  if (
    ticket.schemaVersion !== 1 ||
    ticket.runId !== final.integrationId ||
    ticket.status !== "completed" ||
    ticket.exitCode !== 0 ||
    ticket.head !== final.commit ||
    realpathSync(ticket.workdir) !== realpathSync(root)
  )
    throw new Error("integration not completed");
  checkDescriptor(parent, final.integration);
  let published = final.commit;
  if (Object.hasOwn(ticket, "publishedHead")) {
    published = ticket.publishedHead;
    if (
      ticket.publicationVerified !== true ||
      !/^[0-9a-f]{40}$/.test(published) ||
      !/^[0-9a-f]{40}$/.test(ticket.remoteHead) ||
      git(root, ["rev-parse", `${published}^{tree}`]) !== ticket.validatedTree
    )
      throw new Error("invalid published integration binding");
    checkVerifiedCommit(root, published);
    git(root, ["merge-base", "--is-ancestor", final.commit, published]);
    git(root, ["merge-base", "--is-ancestor", published, ticket.remoteHead]);
    const treeEntries = (head) =>
      new Map(
        git(root, ["ls-tree", "-r", "-z", head])
          .split("\0")
          .filter(Boolean)
          .map((entry) => {
            const separator = entry.indexOf("\t");
            return [entry.slice(separator + 1), entry.slice(0, separator)];
          })
      );
    const sourceEntries = treeEntries(final.commit);
    const publishedEntries = treeEntries(published);
    const publishedInputs = scopedInputPaths([...publishedEntries.keys()]);
    if (
      JSON.stringify(publishedInputs) !==
      JSON.stringify(receipt.inputs.map((input) => input.path))
    )
      throw new Error("receipt scope differs from published integration");
    for (const input of receipt.inputs) {
      // Preserve mode and object type as well as bytes (including symlinks).
      const sourceEntry = sourceEntries.get(input.path);
      if (!sourceEntry || publishedEntries.get(input.path) !== sourceEntry)
        throw new Error("receipt source differs from published integration");
    }
  } else if (
    ticket.remoteHead !== final.commit ||
    Object.hasOwn(ticket, "publicationVerified") ||
    Object.hasOwn(ticket, "validatedTree")
  )
    throw new Error("invalid legacy integration binding");
  // The receipt remains tied to its source audit, while publication must also
  // preserve every scoped input and have its own valid commit audit.
  git(root, ["merge-base", "--is-ancestor", published, "refs/heads/main"]);
  git(root, [
    "merge-base",
    "--is-ancestor",
    published,
    "refs/remotes/origin/main",
  ]);
  return "valid";
}

export function verifyReceipt(root, directory, receipt, now = Date.now()) {
  try {
    if (
      receipt?.schemaVersion !== 1 ||
      !uuid.test(receipt.id) ||
      !Object.hasOwn(tasks, receipt.taskId) ||
      !tasks[receipt.taskId].includes(receipt.acceptanceId) ||
      !gateByAcceptance[receipt.acceptanceId] ||
      receipt.gate?.id !== gateByAcceptance[receipt.acceptanceId] ||
      realpathSync(receipt.root) !== realpathSync(root) ||
      !/^[0-9a-f]{40}$/.test(receipt.baseCommit) ||
      !/^[0-9a-f]{40}$/.test(receipt.validatedTree)
    )
      throw new Error("invalid/foreign receipt schema");
    timestamp(receipt.recordedAt, now);
    const current = scopeFingerprint(root, receipt.taskId);
    if (current.fingerprint !== receipt.scopeFingerprint)
      throw new Error("stale receipt scope");
    if (current.runtime !== receipt.runtimeHash)
      throw new Error("stale receipt runtime");
    if (JSON.stringify(current.inputs) !== JSON.stringify(receipt.inputs))
      throw new Error("receipt input manifest mismatch");
    const { run } = validRun(root, receipt.harnessRun.path, now);
    if (receipt.validatedTree !== run.sourceTree)
      throw new Error("receipt and executed harness tree differ");
    if (receipt.recordedAt < run.finishedAt)
      throw new Error("receipt predates complete gate run");
    checkDescriptor(resolve(root, "logs/harness/runs"), receipt.harnessRun);
    if (run.fingerprint !== receipt.harnessFingerprint)
      throw new Error("harness fingerprint mismatch");
    const gate = run.gates.find((value) => value.id === receipt.gate.id);
    if (
      JSON.stringify(gateEvidence(root, gate, now)) !==
      JSON.stringify(receipt.gate)
    )
      throw new Error("receipt gate mismatch");
    git(root, ["cat-file", "-e", `${receipt.baseCommit}^{commit}`]);
    checkLaterFailure(root, receipt, run.startedAt, now);
    return {
      state: checkFinalization(root, directory, receipt, now),
      reason: receipt.finalization
        ? "verified_and_integrated"
        : "pending_verified_commit_and_integration",
    };
  } catch (error) {
    return { state: "invalid", reason: error.message };
  }
}

export function recordReceipt(
  root,
  directory,
  taskId,
  acceptanceId,
  runFile,
  now = Date.now()
) {
  if (!tasks[taskId]?.includes(acceptanceId) || !gateByAcceptance[acceptanceId])
    throw new Error(
      "acceptance gate not implemented; parent task remains incomplete"
    );
  const { run, full } = validRun(root, runFile, now);
  if (run.fingerprint !== harnessFingerprint(root))
    throw new Error("harness source changed since execution");
  const validatedTree = buildVerificationTree(root, "HEAD").headTree;
  if (validatedTree !== run.sourceTree)
    throw new Error("harness target tree changed since execution");
  const scope = scopeFingerprint(root, taskId);
  const gate = gateEvidence(
    root,
    run.gates.find((value) => value.id === gateByAcceptance[acceptanceId]),
    now
  );
  const receipt = {
    schemaVersion: 1,
    id: randomUUID(),
    taskId,
    acceptanceId,
    root: realpathSync(root),
    baseCommit: git(root, ["rev-parse", "HEAD"]),
    validatedTree,
    recordedAt: now,
    scopeFingerprint: scope.fingerprint,
    runtimeHash: scope.runtime,
    inputs: scope.inputs,
    harnessFingerprint: run.fingerprint,
    harnessRun: descriptor(resolve(root, "logs/harness/runs"), full),
    gate,
    finalization: null,
  };
  const checked = verifyReceipt(root, directory, receipt, now);
  if (checked.state === "invalid") throw new Error(checked.reason);
  transaction(directory, () =>
    atomicJson(
      resolve(directory, "receipts", `${now}-${receipt.id}.json`),
      receipt
    )
  );
  return receipt;
}

export function finalizeReceipt(
  root,
  directory,
  file,
  commit,
  integrationId,
  now = Date.now(),
  evidenceFile
) {
  const full = contained(resolve(directory, "receipts"), file);
  const receipt = readJson(full);
  const checked = verifyReceipt(root, directory, receipt, now);
  if (checked.state !== "unverified" || receipt.finalization)
    throw new Error("receipt is not pending finalization");
  const evidencePath =
    evidenceFile === undefined
      ? contained(root, ".verifier-result.json")
      : contained(resolve(root, "logs/verifier-history"), evidenceFile);
  const evidence = readJson(evidencePath);
  const evidenceHash = fileHash(evidencePath);
  if (typeof evidence.archiveRelativePath !== "string")
    throw new Error("verifier archive missing");
  const archive = contained(
    resolve(root, "logs/verifier-history"),
    resolve(root, evidence.archiveRelativePath)
  );
  const source = Object.entries({
    context: "context.json",
    report: "report.json",
    result: "evidence.json",
  }).map(([key, name]) => {
    const path = contained(archive, name);
    const bytes = readFileSync(path);
    return {
      key,
      name,
      path,
      sha256: hash(bytes),
      data: JSON.parse(bytes.toString("utf8")),
    };
  });
  if (
    JSON.stringify(source.find((item) => item.key === "result").data) !==
    JSON.stringify(evidence)
  )
    throw new Error("selected verifier evidence differs from archive result");
  // Authenticate the retained source using the existing validator before any
  // shared-root write. Freezing parsed data prevents paired archive replacements
  // from shadowing the commit's immutable embedded report.
  checkVerifiedCommit(root, commit, evidencePath);
  if (
    fileHash(evidencePath) !== evidenceHash ||
    source.some((item) => fileHash(item.path) !== item.sha256)
  )
    throw new Error("verifier archive changed during validation");
  const verifierRoot = resolve(directory, "verifier");
  if (existsSync(verifierRoot)) contained(directory, verifierRoot);
  const copyRoot = resolve(verifierRoot, receipt.id);
  if (existsSync(copyRoot)) contained(directory, copyRoot);
  const copied = {};
  for (const { key, name, data } of source) {
    // Preserve the existing verifier archive in the same shared evidence root;
    // copy only small JSON, never replays or a second gate ledger.
    const target = resolve(copyRoot, name);
    if (existsSync(target)) contained(directory, target);
    atomicJson(target, data);
    copied[key] = descriptor(directory, target);
  }
  const integrationFile = contained(
    resolve(directory, "../supervisor-integrations"),
    `${integrationId}.json`
  );
  receipt.finalization = {
    commit,
    integrationId,
    verifier: copied,
    integration: descriptor(
      resolve(directory, "../supervisor-integrations"),
      integrationFile
    ),
  };
  const result = verifyReceipt(root, directory, receipt, now);
  if (result.state !== "valid") throw new Error(result.reason);
  transaction(directory, () => atomicJson(full, receipt));
  return receipt;
}

export function evidenceStatus(root, directory, now = Date.now()) {
  const entries = receiptFiles(directory).map((file) => {
    try {
      const receipt = readJson(file);
      return { file, receipt, ...verifyReceipt(root, directory, receipt, now) };
    } catch (error) {
      return { file, state: "invalid", reason: error.message };
    }
  });
  // Preserve all attempts, choose the latest per acceptance, and expose every
  // invalid file. A corrupt orphan file cannot disappear behind an older green.
  entries.sort(
    (a, b) => (a.receipt?.recordedAt ?? 0) - (b.receipt?.recordedAt ?? 0)
  );
  const taskStates = Object.entries(tasks).map(([id, required]) => {
    const acceptances = required.map((acceptanceId) => {
      const latest = entries
        .filter(
          (entry) =>
            entry.receipt?.taskId === id &&
            entry.receipt?.acceptanceId === acceptanceId
        )
        .at(-1);
      return {
        acceptanceId,
        state: latest?.state ?? "unverified",
        reason: latest?.reason ?? "no_receipt",
      };
    });
    return {
      taskId: id,
      state: acceptances.every((item) => item.state === "valid")
        ? "valid"
        : acceptances.some((item) => item.state === "invalid")
          ? "invalid"
          : "unverified",
      acceptances,
    };
  });
  const orphan = entries.some(
    (entry) =>
      !entry.receipt ||
      !tasks[entry.receipt.taskId]?.includes(entry.receipt.acceptanceId) ||
      /invalid\/foreign receipt schema|invalid\/future evidence timestamp|receipt predates complete gate run/.test(
        entry.reason
      )
  );
  return {
    schemaVersion: 1,
    taskStates,
    entries: entries.map(({ file, state: receiptState, reason }) => ({
      file,
      state: receiptState,
      reason,
    })),
    orphanInvalid: orphan,
  };
}

export function persistEvidenceIndex(root, directory, now = Date.now()) {
  const index = evidenceStatus(root, directory, now);
  transaction(directory, () =>
    atomicJson(sharedFile(directory, "index.json"), index)
  );
  return index;
}
