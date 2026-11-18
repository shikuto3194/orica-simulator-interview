// Retain an exited worker's exact unfinished tree; never commit or reset it.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertFullRunWorker } from "./full-run-checkouts.mjs";
import { buildVerificationTree } from "./verifier-tree.mjs";
import { inspectGateLease, gateLeasePath } from "./harness/gate-lease.mjs";
import {
  readWindowsProcesses,
  recoveryBlocker,
} from "./harness/recover-gate-lease.mjs";
import { listPendingFollowups, planFollowups } from "./supervisor-followup.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
    ),
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}
function snapshot(workdir) {
  const paths = [
    ...new Set(
      [
        ...git(workdir, ["diff", "--name-only", "-z", "HEAD", "--"])
          .toString()
          .split("\0"),
        ...git(workdir, ["ls-files", "--others", "--exclude-standard", "-z"])
          .toString()
          .split("\0"),
      ].filter(Boolean)
    ),
  ].sort();
  return {
    head: git(workdir, ["rev-parse", "HEAD"]).toString().trim(),
    index: git(workdir, ["write-tree"]).toString().trim(),
    status: git(workdir, [
      "status",
      "--porcelain=v1",
      "-z",
      "-uall",
    ]).toString(),
    tree: buildVerificationTree(workdir, "HEAD").headTree,
    bytes: paths.map((path) => {
      const file = join(workdir, path);
      if (!existsSync(file)) return [path, null];
      if (!lstatSync(file).isFile())
        throw new Error("Unsupported recovery input: " + path);
      return [path, hash(readFileSync(file))];
    }),
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function absent(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
const directory = (repo) =>
  join(resolve(repo), "logs/supervisor-work-recovery");

function assertNoLaneWorker(workdir, processes) {
  const target = resolve(workdir).replaceAll("\\", "/").toLowerCase();
  for (const row of processes) {
    if (row.pid === process.pid) continue;
    const command = row.commandLine?.replaceAll("\\", "/").toLowerCase();
    if (
      command?.includes(target) &&
      /worker-codex-stream\.mjs|codex(?:\.exe)?["']?\s.*\bexec\b/.test(command)
    )
      throw new Error("Lane worker is still running: " + row.pid);
  }
}

// Instruction identity is separate from artifact identity. Read the existing
// queue and reception records, never copy them into a competing work queue.
export function readRecoveryInstructions(repo, workdir) {
  const pending = listPendingFollowups({ repo, throwOnReadError: true })
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      digest: hash(JSON.stringify(item)),
      file: join(
        resolve(repo),
        "logs/codex-supervisor-followups/pending",
        item.id + ".json"
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reception = join(
    resolve(repo),
    "logs/codex-telegram-inbox/reception-results"
  );
  const receipts = (existsSync(reception) ? readdirSync(reception) : [])
    .filter((name) => /^\d+(?:-(?:force|instruction))?\.json$/.test(name))
    .sort()
    .map((name) => {
      const file = join(reception, name),
        bytes = readFileSync(file);
      JSON.parse(bytes.toString());
      return { file, digest: hash(bytes) };
    });
  const main = git(workdir, ["rev-parse", "refs/heads/main"]).toString().trim();
  const remote = git(workdir, [
    "for-each-ref",
    "--format=%(objectname)",
    "refs/remotes/origin/main",
  ])
    .toString()
    .trim();
  return { pending, receipts, main, remote };
}

export function recoveryInstructions(
  repo,
  workdir,
  record,
  { readInputs = () => readRecoveryInstructions(repo, workdir) } = {}
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = readInputs();
    const plan = planFollowups({ repo });
    const after = readInputs();
    if (!same(before, after)) continue;
    const changedPaths = git(workdir, [
      "diff",
      "--name-only",
      "-z",
      record.main,
      after.remote || after.main,
    ])
      .toString()
      .split("\0")
      .filter(Boolean);
    const owned = new Set(record.snapshot.bytes.map(([path]) => path));
    const followupIds = record.followupIds.filter((id) =>
      after.pending.some((item) => item.id === id)
    );
    const context = {
      ...after,
      followupIds,
      nextFifoIds: plan.selectedIds,
      changedPaths,
      overlappingPaths: changedPaths.filter((path) => owned.has(path)),
      digest: hash(JSON.stringify(after)),
      observedAt: new Date().toISOString(),
    };
    const previous = record.instructionsAtStop;
    const changedInstructions = after.pending.filter(
      (item) =>
        item.kind === "instruction" &&
        !previous?.pending.some(
          (old) => old.id === item.id && old.digest === item.digest
        )
    );
    const changedReceipts = after.receipts.filter(
      (item) =>
        !previous?.receipts.some(
          (old) => old.file === item.file && old.digest === item.digest
        )
    );
    return {
      context,
      block: [
        `再開直前の指示照合: ${JSON.stringify({
          main: context.main,
          remote: context.remote,
          digest: context.digest,
          observedAt: context.observedAt,
          followupIds,
          nextFifoIds: context.nextFifoIds,
          changedPaths,
          overlappingPaths: context.overlappingPaths,
        })}`,
        `停止後の追加/訂正候補: 依頼${changedInstructions.length}件、受付${changedReceipts.length}件。先頭20件ずつ: ${JSON.stringify({ instructions: changedInstructions.slice(0, 20), receipts: changedReceipts.slice(0, 20) })}。省略分を含め全件は既存queue/受付原本で確認する。`,
        "この照合は成果の同一性とは別。checkpointの旧依頼と現在の受付原文/添付/訂正を全文照合し、関連する新指示は親目標と受入条件へ反映してから編集する。無関係な依頼は既存FIFOへ残す。緊急性または依存関係で優先を変更するなら根拠を記録する。main/origin/mainの追加修正で既に満たされた条件は重複実装しない。影響する条件の証跡だけ再評価し、影響不明は必要検証へ戻す。解消済みの旧IDを再登録しない。",
        plan.block,
        `取得後も受付は継続する。編集前と受入登録前に node ${join(repo, "scripts/supervisor-followup.mjs")} plan --repo ${repo} と原本・main更新を再確認する。途中の追加/訂正は既存expectedDigest付き受入照合に従い、旧条件のまま閉じない。`,
      ].join("\n\n"),
    };
  }
  throw new Error(
    "Recovery instructions changed during dispatch; retry from current intake"
  );
}

export function preserveWorkerWork({
  repo,
  workdir,
  runId,
  ownerPid = process.pid,
  childPid = null,
  threadId,
  exitCode,
  followupIds = [],
  phase = "worker-exited",
  expectedTree,
  evidence = null,
  validate = () => {},
}) {
  const targets = assertFullRunWorker(repo, workdir);
  if (
    !/^[a-f0-9-]{36}$/.test(runId) ||
    !Number.isInteger(ownerPid) ||
    ownerPid <= 0 ||
    !(
      Number.isInteger(exitCode) ||
      (exitCode === null && phase !== "worker-exited")
    ) ||
    ![
      "worker-exited",
      "gate-started",
      "candidate-frozen",
      "interrupted-handoff",
    ].includes(phase)
  )
    throw new Error("Invalid worker recovery identity");
  validate();
  const before = snapshot(workdir);
  if (expectedTree && expectedTree !== before.tree)
    throw new Error("Checkpoint candidate tree changed");
  if (!before.status) return null;
  const captureId = randomUUID();
  const archive = join(
    resolve(repo),
    "artifacts/worker-recovery",
    runId,
    captureId
  );
  mkdirSync(archive, { recursive: true });
  const files = [];
  const save = (name, bytes) => {
    const file = join(archive, name);
    mkdirSync(dirname(file), { recursive: true });
    // Each boundary is immutable, including multiple boundaries in one run.
    writeFileSync(file, bytes, { flag: "wx" });
    files.push({ path: name, sha256: hash(bytes) });
  };
  save("worktree.patch", git(workdir, ["diff", "--binary", "HEAD", "--"]));
  save("index.patch", git(workdir, ["diff", "--cached", "--binary", "--"]));
  const untracked = git(workdir, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const file of untracked) {
    if (
      file.split(/[\\/]/).includes("..") ||
      !lstatSync(join(workdir, file)).isFile()
    )
      throw new Error("Unsupported recovery input: " + file);
    save("untracked/" + file, readFileSync(join(workdir, file)));
  }
  const main = git(workdir, ["rev-parse", "refs/heads/main"]).toString().trim();
  if (git(workdir, ["rev-list", "HEAD", "--not", main]).length) {
    git(workdir, [
      "bundle",
      "create",
      join(archive, "commits.bundle"),
      "HEAD",
      "--not",
      main,
    ]);
    git(workdir, ["bundle", "verify", join(archive, "commits.bundle")]);
    files.push({
      path: "commits.bundle",
      sha256: hash(readFileSync(join(archive, "commits.bundle"))),
    });
  }
  for (const name of [
    ".verifier-context.json",
    ".verifier-report.json",
    ".verifier-result.json",
    "logs/harness/latest.json",
  ])
    if (existsSync(join(workdir, name)))
      save("evidence/" + name, readFileSync(join(workdir, name)));
  if (!same(before, snapshot(workdir)))
    throw new Error("Worker tree changed during preservation");
  validate();
  const record = {
    schemaVersion: 2,
    captureId,
    phase,
    validationStatus: "unverified",
    evidence,
    runId,
    repo: resolve(repo),
    workdir: resolve(workdir),
    workerRef: targets.workerRef,
    ownerPid,
    childPid,
    threadId,
    exitCode,
    followupIds,
    instructionsAtStop: readRecoveryInstructions(repo, workdir),
    capturedAt: new Date().toISOString(),
    finishedAt: phase === "worker-exited" ? new Date().toISOString() : null,
    main,
    snapshot: before,
    archive,
    files,
  };
  const file = join(directory(repo), `${runId}.${captureId}.json`);
  validate();
  if (!same(before, snapshot(workdir)))
    throw new Error("Worker tree changed before checkpoint publication");
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
  });
  // Incomplete archives and temporary records are never admission evidence.
  renameSync(temporary, file);
  return file;
}

function assertCheckpointLocks(locks) {
  if (
    !Array.isArray(locks) ||
    locks.length !== 2 ||
    new Set(locks.map((lock) => lock.lane)).size !== 2 ||
    !["supervisor", "card-impl"].every((lane) =>
      locks.some((lock) => lock.lane === lane)
    )
  )
    throw new Error("Checkpoint requires both lane locks");
  for (const lock of locks) {
    if (
      !lock.token ||
      JSON.parse(readFileSync(lock.file, "utf8")).token !== lock.token
    )
      throw new Error("Checkpoint lock owner changed");
  }
}

// The runner supplies this context to its child, not to unrelated interactive
// gates. Re-read runner identity and both lock owners at each capture boundary.
export function checkpointWorkerBoundary(
  workdir,
  phase,
  expectedTree,
  env = process.env
) {
  if (!env.ORICA_WORK_RECOVERY_CONTEXT) return null;
  const context = JSON.parse(env.ORICA_WORK_RECOVERY_CONTEXT);
  if (resolve(workdir) !== context.workdir) return null;
  const validate = () => {
    const state = JSON.parse(readFileSync(context.stateFile, "utf8"));
    if (
      state.runId !== context.runId ||
      state.runnerPid !== context.ownerPid ||
      state.workdir !== context.workdir ||
      !["running", "integrating"].includes(state.status) ||
      !Number.isInteger(context.ownerPid) ||
      context.ownerPid <= 0
    )
      throw new Error("Checkpoint runner identity changed or exited");
    process.kill(context.ownerPid, 0);
    assertCheckpointLocks(context.locks);
    if (state.status === "integrating") {
      const ticket = JSON.parse(readFileSync(state.integrationRequest, "utf8"));
      if (
        phase !== "gate-started" ||
        state.workerExitCode !== 0 ||
        state.finishedAt !== null ||
        state.exitCode !== null ||
        ticket.schemaVersion !== 1 ||
        ticket.status !== "running" ||
        ticket.ownerPid !== context.ownerPid ||
        ticket.repo !== context.repo ||
        ticket.workdir !== context.workdir ||
        ticket.file !== resolve(state.integrationRequest) ||
        ticket.head !== git(workdir, ["rev-parse", "HEAD"]).toString().trim() ||
        ticket.branch !==
          git(workdir, ["symbolic-ref", "--short", "HEAD"]).toString().trim() ||
        git(workdir, ["status", "--porcelain=v1", "-uall"]).length
      )
        throw new Error(
          "Checkpoint integration candidate changed or is not owned"
        );
    }
    return state;
  };
  const state = validate();
  return preserveWorkerWork({
    repo: context.repo,
    workdir,
    runId: context.runId,
    ownerPid: context.ownerPid,
    childPid: state.childPid,
    threadId: state.threadId,
    followupIds: state.followupIds,
    exitCode: null,
    phase,
    expectedTree,
    validate,
    evidence: { boundaryPid: process.pid },
  });
}

// Explicit operator repair only. Never use a gate automatically as authorship
// evidence, and never turn its unfinished results into successful validation.
export async function adoptInterruptedGate(
  { repo, workdir, runId, gateFile, stateFile, locks },
  { processAbsent = absent, readProcesses = readWindowsProcesses } = {}
) {
  assertFullRunWorker(repo, workdir);
  const stateRaw = readFileSync(stateFile, "utf8"),
    state = JSON.parse(stateRaw);
  const gateRaw = readFileSync(gateFile, "utf8"),
    gate = JSON.parse(gateRaw);
  const gateName = gateFile.replaceAll("\\", "/").split("/").at(-1);
  const match = /^(\d+)-(\d+)\.json$/.exec(gateName);
  if (
    state.runId !== runId ||
    !Number.isInteger(state.runnerPid) ||
    state.runnerPid <= 0 ||
    state.workdir !== resolve(workdir) ||
    state.status !== "running" ||
    state.finishedAt !== null ||
    state.exitCode !== null ||
    !match ||
    resolve(gateFile) !==
      join(resolve(workdir), "logs/harness/runs", gateName) ||
    gate.schemaVersion !== 2 ||
    gate.root !== resolve(workdir) ||
    gate.status !== "running" ||
    gate.finishedAt != null ||
    gate.startedAt !== Number(match[1]) ||
    !(
      Date.parse(state.startedAt) <= gate.startedAt &&
      gate.startedAt <= Date.parse(state.updatedAt)
    ) ||
    !readFileSync(state.runLog, "utf8").includes(gateName)
  )
    throw new Error("Interrupted gate/run binding mismatch");
  const before = snapshot(workdir);
  if (
    gate.sourceTree !== before.tree ||
    before.index !==
      git(workdir, ["rev-parse", "HEAD^{tree}"]).toString().trim() ||
    !same(gate.diffBases, [before.head]) ||
    !same(
      [...gate.changed].sort(),
      before.bytes.map(([path]) => path)
    )
  )
    throw new Error("Interrupted gate does not match current tree");
  for (const [path, digest] of before.bytes) {
    if (
      digest !== null &&
      hash(git(workdir, ["show", `${gate.sourceTree}:${path}`])) !== digest
    )
      throw new Error("Interrupted gate byte hash mismatch: " + path);
  }
  const pids = [state.runnerPid, state.childPid, Number(match[2])].filter(
    (pid) => pid != null
  );
  const validate = () => {
    assertCheckpointLocks(locks);
    if (existsSync(gateLeasePath(workdir)))
      throw new Error("Validation still owns the unfinished tree");
    const processes = readProcesses();
    assertNoLaneWorker(workdir, processes);
    for (const pid of pids) {
      if (!processAbsent(pid))
        throw new Error("Interrupted owner is alive or unknown");
      const blocker = recoveryBlocker(
        { pid, started: Date.parse(state.startedAt) },
        processes
      );
      if (blocker)
        throw new Error("Interrupted owner is not quiescent: " + blocker);
    }
    if (
      readFileSync(stateFile, "utf8") !== stateRaw ||
      readFileSync(gateFile, "utf8") !== gateRaw ||
      !same(before, snapshot(workdir))
    )
      throw new Error("Interrupted evidence changed during handoff");
  };
  validate();
  const file = preserveWorkerWork({
    repo,
    workdir,
    runId,
    ownerPid: state.runnerPid,
    childPid: state.childPid,
    threadId: state.threadId,
    followupIds: state.followupIds,
    exitCode: null,
    phase: "interrupted-handoff",
    expectedTree: gate.sourceTree,
    evidence: {
      gateFile: resolve(gateFile),
      gateSha256: hash(gateRaw),
      stateSha256: hash(stateRaw),
      sourceTree: gate.sourceTree,
      gateStatus: gate.status,
      gateExitCode: null,
    },
    validate,
  });
  return file;
}

export async function inspectWorkerRecovery(
  repo,
  workdir,
  { processAbsent = absent, readProcesses = readWindowsProcesses } = {}
) {
  const targets = assertFullRunWorker(repo, workdir);
  const current = snapshot(workdir);
  if (!current.status) return { action: "clean" };
  if (await inspectGateLease(workdir))
    throw new Error("Validation still owns the unfinished tree");
  const records = (
    existsSync(directory(repo)) ? readdirSync(directory(repo)) : []
  )
    .filter((name) => /^[a-f0-9-]{36}(?:\.[a-f0-9-]{36})?\.json$/.test(name))
    .map((name) => ({
      file: join(directory(repo), name),
      record: JSON.parse(readFileSync(join(directory(repo), name), "utf8")),
    }))
    .filter(({ record }) => record.workdir === resolve(workdir))
    .sort((a, b) =>
      String(b.record.capturedAt || b.record.finishedAt).localeCompare(
        String(a.record.capturedAt || a.record.finishedAt)
      )
    );
  const latest = records[0],
    record = latest?.record;
  if (
    !record ||
    ![1, 2].includes(record.schemaVersion) ||
    !/^[a-f0-9-]{36}$/.test(record.runId) ||
    (record.schemaVersion === 2 && !/^[a-f0-9-]{36}$/.test(record.captureId)) ||
    record.repo !== resolve(repo) ||
    record.workerRef !== targets.workerRef ||
    !same(current, record.snapshot)
  )
    throw new Error(
      "Dirty lane has no matching owned recovery checkpoint; preserve and inspect attribution"
    );
  if (!Number.isInteger(record.ownerPid) || record.ownerPid <= 0)
    throw new Error("Previous worker owner is alive or unknown");
  const ownerPids = [
    record.ownerPid,
    record.childPid,
    record.evidence?.boundaryPid,
  ].filter((pid) => pid != null);
  if (ownerPids.some((pid) => !processAbsent(pid)))
    throw new Error("Previous worker owner is alive or unknown");
  const processes = readProcesses();
  assertNoLaneWorker(workdir, processes);
  for (const pid of ownerPids) {
    const blocker = recoveryBlocker(
      { pid, started: Date.parse(record.capturedAt || record.finishedAt) },
      processes
    );
    if (blocker)
      throw new Error("Previous worker is not quiescent: " + blocker);
  }
  if (
    record.archive !==
    join(
      resolve(repo),
      "artifacts/worker-recovery",
      record.runId,
      ...(record.schemaVersion === 2 ? [record.captureId] : [])
    )
  )
    throw new Error("Invalid recovery archive binding");
  for (const item of record.files) {
    if (
      item.path.split(/[\\/]/).includes("..") ||
      resolve(record.archive, item.path) !== join(record.archive, item.path) ||
      hash(readFileSync(join(record.archive, item.path))) !== item.sha256
    )
      throw new Error("Recovery archive changed");
  }
  const instructions = recoveryInstructions(repo, workdir, record);
  if ((await inspectGateLease(workdir)) || !same(current, snapshot(workdir)))
    throw new Error(
      "Recovery tree or validation owner changed during inspection"
    );
  return {
    action: "recover",
    checkpoint: latest.file,
    followupIds: instructions.context.followupIds,
    instructions: instructions.context,
    validationStatus: "unverified",
    previousExitCode: record.exitCode,
    workerFocus: `前run ${record.runId} の未完了成果を引き継ぐ。checkpoint=${latest.file}、退避=${record.archive}、HEAD=${current.head}、tree=${current.tree}。元依頼・差分・未追跡manifest・gate/査読の実在と全条件を確認し、残る反証を修正して同じ受入単位を最終化する。main同期・stash・一括commit・破棄で回避しない。証跡は内容/環境/範囲が一致する場合だけ再利用し、新しい独立査読と通常統合を完遂する。モデル容量不足は実装完了ではない。\n\n${instructions.block}`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [repo, workdir] = process.argv.slice(2);
  try {
    if (!repo || !workdir) throw new Error("Expected repo and workdir");
    console.log(JSON.stringify(await inspectWorkerRecovery(repo, workdir)));
  } catch (error) {
    console.error("[worker-recovery] " + error.message);
    process.exitCode = 1;
  }
}
