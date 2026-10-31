import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import {
  preserveWorkerWork,
  inspectWorkerRecovery,
  recoveryInstructions,
  readRecoveryInstructions,
  checkpointWorkerBoundary,
  adoptInterruptedGate,
} from "./supervisor-work-recovery.mjs";
import { gateLeasePath } from "./harness/gate-lease.mjs";
import {
  enqueueFollowup,
  listPendingFollowups,
  resolveFollowup,
} from "./supervisor-followup.mjs";

const temp = mkdtempSync(join(tmpdir(), "orica-worker-recovery-"));
const repo = join(temp, "repo"),
  lane = join(temp, "lane"),
  main = join(temp, "main");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
);
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    env,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  }).trim();
try {
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Recovery test");
  git(repo, "config", "user.email", "fixture@example.invalid");
  mkdirSync(join(repo, "scripts"));
  writeFileSync(
    join(repo, "scripts/full-run-checkouts.json"),
    JSON.stringify({
      schemaVersion: 1,
      workerWorktree: "../lane",
      workerRef: "refs/heads/lane",
      integrationWorktree: "../main",
      integrationRef: "refs/heads/main",
    })
  );
  writeFileSync(join(repo, ".gitignore"), "logs/\nartifacts/\n.verifier*\n");
  writeFileSync(join(repo, "source.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(repo, "switch", "-c", "interactive");
  git(repo, "worktree", "add", main, "main");
  git(repo, "worktree", "add", "-b", "lane", lane);
  assert.equal((await inspectWorkerRecovery(repo, lane)).action, "clean");
  writeFileSync(join(lane, "source.txt"), "owned commit\n");
  git(lane, "add", ".");
  git(lane, "commit", "-m", "owned");
  writeFileSync(join(lane, "source.txt"), "staged work\n");
  git(lane, "add", "source.txt");
  writeFileSync(join(lane, "source.txt"), "unfinished work\n");
  writeFileSync(join(lane, "new test.bin"), Buffer.from([0, 1, 255]));
  await assert.rejects(inspectWorkerRecovery(repo, lane), /no matching owned/);
  const reception = join(repo, "logs/codex-telegram-inbox/reception-results");
  mkdirSync(reception, { recursive: true });
  function request(number, text) {
    const item = enqueueFollowup({
      repo,
      kind: "instruction",
      lane: "codex",
      text,
      createdAt: `2026-10-19T00:00:${number}Z`,
    });
    writeFileSync(
      join(reception, number + ".json"),
      JSON.stringify({
        status: "completed",
        handoffId: item.id,
        result: { handoff: text },
      })
    );
    return item;
  }
  const original = request("10", "支払い不足を修正する");
  const file = preserveWorkerWork({
    repo,
    workdir: lane,
    runId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    exitCode: 1,
    followupIds: [original.id],
  });
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(saved.files.some((item) => item.path === "commits.bundle"));
  assert.deepEqual(
    readFileSync(join(saved.archive, "untracked/new test.bin")),
    Buffer.from([0, 1, 255])
  );
  await assert.rejects(inspectWorkerRecovery(repo, lane), /alive or unknown/);
  const inspect = () =>
    inspectWorkerRecovery(repo, lane, {
      processAbsent: () => true,
      readProcesses: () => [{ pid: 999, parentPid: 0, name: "explorer.exe" }],
    });
  // Required attribution cannot disappear when optional process IDs are absent.
  // Both legacy and intermediate records must fail closed even if the injected
  // process census would otherwise report every supplied PID as absent.
  for (const schemaVersion of [1, 2]) {
    for (const ownerPid of [undefined, null, 0, -1, 1.5, "1234"]) {
      writeFileSync(
        file,
        JSON.stringify({ ...saved, schemaVersion, ownerPid, childPid: null })
      );
      await assert.rejects(inspect(), /alive or unknown/);
    }
  }
  writeFileSync(file, JSON.stringify(saved));
  await assert.rejects(
    inspectWorkerRecovery(repo, lane, {
      processAbsent: () => true,
      readProcesses: () => [
        { pid: 999, parentPid: saved.ownerPid, name: "node.exe" },
      ],
    }),
    /not quiescent/
  );
  assert.equal((await inspect()).action, "recover");
  assert.match((await inspect()).workerFocus, /一括commit・破棄/);
  const bug = request("11", "停止中に発見: 除外対象のコアは支払いに使えない");
  const unrelated = request("12", "無関係な画面配置の修正");
  let resume = await inspect();
  assert.deepEqual(resume.followupIds, [original.id]);
  assert.ok(resume.instructions.pending.some((item) => item.id === bug.id));
  const oldDigest = resume.instructions.digest;
  // A policy correction can update reception without changing the queue ID.
  writeFileSync(
    join(reception, "10.json"),
    JSON.stringify({
      status: "completed",
      handoffId: original.id,
      result: { handoff: "方針訂正: reserveだけでなくfieldも検証する" },
    })
  );
  resume = await inspect();
  assert.notEqual(resume.instructions.digest, oldDigest);
  assert.match(resume.workerFocus, /方針訂正/);
  assert.ok(
    listPendingFollowups({ repo }).some((item) => item.id === unrelated.id)
  );
  // Another worker's published fix is surfaced without merging into dirty work.
  writeFileSync(join(main, "source.txt"), "published fix\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "other worker fix");
  resume = await inspect();
  assert.deepEqual(resume.instructions.overlappingPaths, ["source.txt"]);
  assert.notEqual(resume.instructions.main, saved.main);
  resolveFollowup({
    repo,
    id: original.id,
    note: "accepted by published main",
  });
  assert.deepEqual(
    (await inspect()).followupIds,
    [],
    "never resurrect an accepted instruction"
  );
  let reads = 0,
    raced;
  const reconciled = recoveryInstructions(repo, lane, saved, {
    readInputs: () => {
      const value = readRecoveryInstructions(repo, lane);
      if (++reads === 1)
        raced = request("13", "取得とdispatchの間に届いた追加条件");
      return value;
    },
  });
  assert.ok(reads >= 4, "intake changed: rebuild the dispatch snapshot");
  assert.ok(reconciled.context.pending.some((item) => item.id === raced.id));
  assert.throws(
    () =>
      recoveryInstructions(repo, lane, saved, {
        readInputs: () => ({
          ...readRecoveryInstructions(repo, lane),
          revision: ++reads,
        }),
      }),
    /changed during dispatch/
  );
  writeFileSync(join(lane, "source.txt"), "foreign edit\n");
  await assert.rejects(inspect(), /no matching owned/);
  writeFileSync(join(lane, "source.txt"), "unfinished work\n");
  git(lane, "add", "source.txt");
  await assert.rejects(inspect(), /no matching owned/);
  git(lane, "read-tree", saved.snapshot.index);
  assert.equal((await inspect()).action, "recover");
  writeFileSync(join(lane, "new test.bin"), "changed untracked");
  await assert.rejects(inspect(), /no matching owned/);
  writeFileSync(join(lane, "new test.bin"), Buffer.from([0, 1, 255]));
  writeFileSync(join(saved.archive, "worktree.patch"), "corrupt backup");
  await assert.rejects(inspect(), /archive changed/);
  // A new candidate must supersede old six-file-style checkpoints without
  // modifying them. Only completed atomic records participate in admission.
  const recoveryDirectory = join(repo, "logs/supervisor-work-recovery");
  const stateFile = join(repo, "logs/codex-supervisor-state.json");
  const locks = ["supervisor", "card-impl"].map((laneName) => ({
    lane: laneName,
    file: join(temp, laneName + ".lock"),
    token: "test-owner-" + laneName,
  }));
  for (const lock of locks)
    writeFileSync(lock.file, JSON.stringify({ token: lock.token }));
  const runId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const running = {
    runId,
    runnerPid: process.pid,
    workdir: lane,
    status: "running",
    startedAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T01:00:00.000Z",
    finishedAt: null,
    exitCode: null,
    childPid: null,
    followupIds: [bug.id],
  };
  const context = {
    repo,
    workdir: lane,
    runId,
    ownerPid: process.pid,
    stateFile,
    locks,
  };
  const boundaryEnv = { ORICA_WORK_RECOVERY_CONTEXT: JSON.stringify(context) };
  writeFileSync(stateFile, JSON.stringify(running));
  assert.equal(
    checkpointWorkerBoundary(
      main,
      "gate-started",
      saved.snapshot.tree,
      boundaryEnv
    ),
    null
  );
  assert.throws(
    () =>
      checkpointWorkerBoundary(lane, "gate-started", "bad-tree", boundaryEnv),
    /tree changed/
  );
  writeFileSync(stateFile, JSON.stringify({ ...running, runId: saved.runId }));
  assert.throws(
    () =>
      checkpointWorkerBoundary(
        lane,
        "gate-started",
        saved.snapshot.tree,
        boundaryEnv
      ),
    /identity/
  );
  writeFileSync(stateFile, JSON.stringify(running));
  writeFileSync(locks[1].file, JSON.stringify({ token: "other-run" }));
  assert.throws(
    () =>
      checkpointWorkerBoundary(
        lane,
        "gate-started",
        saved.snapshot.tree,
        boundaryEnv
      ),
    /lock owner/
  );
  writeFileSync(locks[1].file, JSON.stringify({ token: locks[1].token }));
  const intermediate = checkpointWorkerBoundary(
    lane,
    "gate-started",
    saved.snapshot.tree,
    boundaryEnv
  );
  const captured = JSON.parse(readFileSync(intermediate));
  assert.equal(captured.exitCode, null);
  assert.equal(captured.finishedAt, null);
  assert.equal(captured.validationStatus, "unverified");
  assert.deepEqual(captured.snapshot.bytes, saved.snapshot.bytes);
  await assert.rejects(inspectWorkerRecovery(repo, lane), /alive or unknown/);
  const frozen = checkpointWorkerBoundary(
    lane,
    "candidate-frozen",
    saved.snapshot.tree,
    boundaryEnv
  );
  assert.notEqual(
    frozen,
    intermediate,
    "multiple captures must not overwrite earlier evidence"
  );
  assert.equal((await inspect()).previousExitCode, null);
  writeFileSync(frozen + ".tmp", "partial JSON");
  assert.equal((await inspect()).action, "recover");
  writeFileSync(
    gateLeasePath(lane),
    JSON.stringify({ pid: process.pid, token: "validator" })
  );
  await assert.rejects(inspect(), /Validation still owns/);
  rmSync(gateLeasePath(lane));
  await assert.rejects(
    inspectWorkerRecovery(repo, lane, {
      processAbsent: () => true,
      readProcesses: () => [
        {
          pid: 1234,
          parentPid: 0,
          name: "codex.exe",
          commandLine: `codex.exe -C "${lane}" exec --json`,
        },
      ],
    }),
    /Lane worker/
  );
  const count = readdirSync(recoveryDirectory).filter((name) =>
    name.endsWith(".json")
  ).length;
  let validationCount = 0;
  assert.throws(
    () =>
      preserveWorkerWork({
        repo,
        workdir: lane,
        runId,
        exitCode: null,
        phase: "gate-started",
        validate: () => {
          if (++validationCount === 2)
            throw new Error("owner lost before publish");
        },
      }),
    /owner lost/
  );
  assert.equal(
    readdirSync(recoveryDirectory).filter((name) => name.endsWith(".json"))
      .length,
    count
  );

  // Actual child termination bypasses all close/finally preservation: the
  // already written boundary remains sufficient after its owner disappears.
  const moduleUrl = new URL("./supervisor-work-recovery.mjs", import.meta.url)
    .href;
  const stopped = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import fs from 'node:fs';
    import { checkpointWorkerBoundary } from ${JSON.stringify(moduleUrl)};
    const context = ${JSON.stringify(context)};
    context.ownerPid = process.pid;
    fs.writeFileSync(context.stateFile, JSON.stringify({ ...${JSON.stringify(running)}, runnerPid: process.pid }));
    checkpointWorkerBoundary(context.workdir, 'gate-started', ${JSON.stringify(saved.snapshot.tree)},
      { ORICA_WORK_RECOVERY_CONTEXT: JSON.stringify(context) });
    process.exit(7);
  `,
    ],
    { env, encoding: "utf8", windowsHide: true }
  );
  assert.equal(stopped.status, 7, stopped.stderr);
  const stoppedRecovery = await inspectWorkerRecovery(repo, lane, {
    readProcesses: () => [{ pid: 999, parentPid: 0, name: "explorer.exe" }],
  });
  assert.equal(
    stoppedRecovery.previousExitCode,
    null,
    "an observed missing owner is not an exit code"
  );

  // Explicit legacy-gate adoption retains unknown outcome and rejects changed
  // source/run/worktree, live owners, leases and another startup lock owner.
  const gateStarted = Date.parse("2026-10-21T00:30:00.000Z");
  const gateFile = join(lane, "logs/harness/runs", `${gateStarted}-8888.json`);
  const runLog = join(repo, "logs/old-run.log");
  mkdirSync(join(lane, "logs/harness/runs"), { recursive: true });
  writeFileSync(runLog, `command: logs/harness/runs/${gateStarted}-8888.json`);
  const legacyState = { ...running, runnerPid: 7777, runLog };
  const gate = {
    schemaVersion: 2,
    root: lane,
    startedAt: gateStarted,
    status: "running",
    sourceTree: saved.snapshot.tree,
    diffBases: [saved.snapshot.head],
    changed: saved.snapshot.bytes.map(([path]) => path),
  };
  const saveLegacy = () => {
    writeFileSync(stateFile, JSON.stringify(legacyState));
    writeFileSync(gateFile, JSON.stringify(gate));
  };
  saveLegacy();
  const adoption = { repo, workdir: lane, runId, gateFile, stateFile, locks };
  const quiet = {
    processAbsent: () => true,
    readProcesses: () => [{ pid: 999, parentPid: 0, name: "explorer.exe" }],
  };
  await assert.rejects(adoptInterruptedGate(adoption, quiet), /does not match/);
  git(lane, "read-tree", "HEAD");
  await assert.rejects(
    adoptInterruptedGate({ ...adoption, runId: saved.runId }, quiet),
    /binding mismatch/
  );
  writeFileSync(gateFile, JSON.stringify({ ...gate, root: main }));
  await assert.rejects(
    adoptInterruptedGate(adoption, quiet),
    /binding mismatch/
  );
  saveLegacy();
  writeFileSync(join(lane, "source.txt"), "unknown bytes\n");
  await assert.rejects(adoptInterruptedGate(adoption, quiet), /does not match/);
  writeFileSync(join(lane, "source.txt"), "unfinished work\n");
  await assert.rejects(
    adoptInterruptedGate(adoption, { ...quiet, processAbsent: () => false }),
    /alive or unknown/
  );
  writeFileSync(
    gateLeasePath(lane),
    JSON.stringify({ pid: process.pid, token: "validator" })
  );
  await assert.rejects(
    adoptInterruptedGate(adoption, quiet),
    /Validation still owns/
  );
  rmSync(gateLeasePath(lane));
  writeFileSync(locks[0].file, JSON.stringify({ token: "second-startup" }));
  await assert.rejects(adoptInterruptedGate(adoption, quiet), /lock owner/);
  writeFileSync(locks[0].file, JSON.stringify({ token: locks[0].token }));
  const adoptedFile = await adoptInterruptedGate(adoption, quiet);
  const adopted = JSON.parse(readFileSync(adoptedFile));
  assert.equal(adopted.phase, "interrupted-handoff");
  assert.equal(adopted.exitCode, null);
  assert.equal(adopted.evidence.gateStatus, "running");
  assert.equal(JSON.parse(readFileSync(gateFile)).status, "running");
  assert.equal((await inspect()).action, "recover");
  // No stage, commit, stash, or reset is performed by admission or preservation.
  git(lane, "read-tree", saved.snapshot.index);
  assert.equal(git(lane, "rev-parse", "HEAD"), saved.snapshot.head);
  assert.equal(git(lane, "write-tree"), saved.snapshot.index);
  assert.equal(
    readFileSync(join(lane, "source.txt"), "utf8"),
    "unfinished work\n"
  );
  // Publication begins after the worker exits: its live runner changes to
  // integrating before launching merge/push gates with the same context.
  git(lane, "add", ".");
  git(lane, "commit", "-m", "finished candidate");
  const committedTree = git(lane, "rev-parse", "HEAD^{tree}");
  const ticketFile = join(repo, "logs/integration.json");
  const integrating = {
    ...running,
    status: "integrating",
    workerExitCode: 0,
    integrationRequest: ticketFile,
  };
  const ticket = {
    schemaVersion: 1,
    status: "running",
    ownerPid: process.pid,
    repo,
    workdir: lane,
    file: ticketFile,
    branch: "lane",
    head: git(lane, "rev-parse", "HEAD"),
  };
  const publicationBoundary = (phase = "gate-started", tree = committedTree) =>
    checkpointWorkerBoundary(lane, phase, tree, boundaryEnv);
  writeFileSync(stateFile, JSON.stringify(integrating));
  writeFileSync(ticketFile, JSON.stringify(ticket));
  assert.equal(
    publicationBoundary(),
    null,
    "clean publication needs no rescue"
  );
  const publisherGate = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { checkpointWorkerBoundary } from ${JSON.stringify(moduleUrl)};
       const result = checkpointWorkerBoundary(${JSON.stringify(lane)}, 'gate-started',
         ${JSON.stringify(committedTree)}, ${JSON.stringify(boundaryEnv)});
       if (result !== null) throw new Error('clean publication produced rescue evidence');`,
    ],
    { env, encoding: "utf8", windowsHide: true }
  );
  assert.equal(publisherGate.status, 0, publisherGate.stderr);
  for (const change of [
    { status: "completed" },
    { status: "failed" },
    { status: "publication_pending" },
    { runId: saved.runId },
    { runnerPid: process.pid + 1 },
    { workerExitCode: 1 },
    { workerExitCode: null },
    { finishedAt: "2026-10-21T02:00:00.000Z" },
    { exitCode: 0 },
  ]) {
    writeFileSync(stateFile, JSON.stringify({ ...integrating, ...change }));
    assert.throws(publicationBoundary, /identity|integration candidate/);
  }
  writeFileSync(stateFile, JSON.stringify(integrating));
  for (const change of [
    { schemaVersion: 2 },
    { status: "requested" },
    { status: "completed" },
    { ownerPid: process.pid + 1 },
    { repo: main },
    { workdir: main },
    { file: stateFile },
    { head: saved.snapshot.head },
    { branch: "main" },
  ]) {
    writeFileSync(ticketFile, JSON.stringify({ ...ticket, ...change }));
    assert.throws(publicationBoundary, /integration candidate/);
  }
  writeFileSync(ticketFile, JSON.stringify(ticket));
  assert.throws(
    () => publicationBoundary("candidate-frozen"),
    /integration candidate/
  );
  assert.throws(
    () => publicationBoundary("gate-started", "bad-tree"),
    /tree changed/
  );
  writeFileSync(
    locks[1].file,
    JSON.stringify({ token: "lost-during-publication" })
  );
  assert.throws(publicationBoundary, /lock owner/);
  writeFileSync(locks[1].file, JSON.stringify({ token: locks[1].token }));
  writeFileSync(join(lane, "source.txt"), "unowned publication edit\n");
  assert.throws(publicationBoundary, /integration candidate/);
  git(lane, "add", "source.txt");
  assert.throws(publicationBoundary, /integration candidate/);
  git(lane, "restore", "--source=HEAD", "--staged", "--worktree", "source.txt");
  writeFileSync(join(lane, "foreign.txt"), "untracked edit\n");
  assert.throws(publicationBoundary, /integration candidate/);
  rmSync(join(lane, "foreign.txt"));
  assert.equal(publicationBoundary(), null);
  console.log(
    "supervisor work recovery: owner/tree/index/untracked, backup integrity, fresh bug/correction/main/FIFO, intake race and owned clean publication passed"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
