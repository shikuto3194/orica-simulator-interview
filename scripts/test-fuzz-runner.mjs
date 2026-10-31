import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import { acquireGateLease, gateLeasePath } from "./harness/gate-lease.mjs";
import { runFuzz } from "./fuzz-runner.mjs";
import state from "./harness/verification-state.cjs";
import { selectCandidateFuzzEvidence } from "./harness/fuzz-candidate-evidence.mjs";

const root = mkdtempSync(join(tmpdir(), "orica-fuzz-lease-test-"));
assert.equal(spawnSync("git", ["init", "-b", "main"], { cwd: root }).status, 0);
writeFileSync(join(root, ".gitignore"), "logs/\n");
const env = { FUZZ_GAMES: "200", FUZZ_SEED_BASE: "1558711590" };
let calls = 0;
let blockedReceipt;
const held = await acquireGateLease(root);
try {
  await assert.rejects(
    runFuzz({
      root,
      env,
      execute() {
        calls++;
      },
      log() {},
      leaseOptions: { timeoutMs: 5, pollMs: 2 },
    }),
    (error) => {
      blockedReceipt = error.receipt;
      return error.code === "VALIDATION_BUSY";
    }
  );
  assert.equal(calls, 0, "fuzz cannot start while another gate owns the lease");
  assert.equal(existsSync(join(root, "logs", "fuzz-seed-ledger.json")), false);
} finally {
  held();
}
// Publication restarts merge before retrying fuzz in the same candidate tree.
// Its prerequisite must be able to run while the old fuzz receipt is dormant.
const queueFile = gateLeasePath(root) + ".queue.json";
const merge = await acquireGateLease(root, {
  requestKey: JSON.stringify(["gates", "merge", []]),
  requestInput: "publication-merge",
  timeoutMs: 1000,
  pollMs: 2,
});
try {
  const entries = JSON.parse(readFileSync(queueFile, "utf8")).entries;
  assert.equal(entries.length, 1, "merge consumes only its own receipt");
  assert.equal(entries[0].id, blockedReceipt.id);
  assert.equal(entries[0].status, "retry");
} finally {
  merge();
}
for (const status of [0, 1, null]) {
  const result = await runFuzz({
    root,
    env,
    log() {},
    execute(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.equal(
        existsSync(gateLeasePath(root)),
        true,
        "fuzz must hold the shared lease"
      );
      assert.equal(options.shell, false);
      assert.equal(options.env.RUN_FUZZ, "1");
      assert.equal(options.env.FUZZ_GAMES, "200");
      assert.equal(options.env.FUZZ_SEED_BASE, "1558711590");
      assert.equal(args[1], "run");
      return { status };
    },
  });
  assert.equal(result, status ?? 1);
  assert.equal(
    existsSync(gateLeasePath(root)),
    false,
    "all child outcomes release the lease"
  );
}
await assert.rejects(
  runFuzz({
    root,
    env,
    log() {},
    execute() {
      throw new Error("spawn failed");
    },
  }),
  /spawn failed/
);
assert.equal(existsSync(gateLeasePath(root)), false);
await assert.rejects(
  runFuzz({
    root,
    env: {},
    log() {},
    execute() {
      return { status: 1 };
    },
  }),
  /Cannot determine HEAD/
);
assert.equal(existsSync(gateLeasePath(root)), false);
assert.equal(existsSync(join(root, "logs", "fuzz-seed-ledger.json")), false);
await assert.rejects(
  runFuzz({ root, env: { FUZZ_GAMES: "0" } }),
  /positive integer/
);
const records = readdirSync(join(root, "logs/fuzz-runs")).map((file) =>
  JSON.parse(readFileSync(join(root, "logs/fuzz-runs", file), "utf8"))
);
assert.ok(
  records.some(
    (record) => record.status === "blocked" && record.leaseWaitMs >= 5
  )
);
assert.equal(records.filter((record) => record.status === "passed").length, 1);
assert.deepEqual(
  records.find((record) => record.status === "passed").queueReceipt,
  blockedReceipt,
  "fuzz resumes after merge with its original receipt, sequence and age"
);
assert.equal(records.filter((record) => record.status === "failed").length, 4);

// A successful 200-game run carries a verifiable identity for the exact
// committed candidate tree and source inputs used by independent review.
const evidenceRoot = mkdtempSync(join(tmpdir(), "orica-fuzz-candidate-test-"));
try {
  assert.equal(
    spawnSync("git", ["init", "-b", "main"], { cwd: evidenceRoot }).status,
    0
  );
  for (const [key, value] of [
    ["user.name", "Fuzz Evidence Test"],
    ["user.email", "fuzz-evidence@example.invalid"],
  ])
    assert.equal(
      spawnSync("git", ["config", key, value], { cwd: evidenceRoot }).status,
      0
    );
  writeFileSync(join(evidenceRoot, ".gitignore"), "logs/\n");
  writeFileSync(join(evidenceRoot, "source.txt"), "candidate tree\n");
  assert.equal(
    spawnSync("git", ["add", ".gitignore", "source.txt"], {
      cwd: evidenceRoot,
    }).status,
    0
  );
  assert.equal(
    spawnSync("git", ["commit", "-m", "candidate"], {
      cwd: evidenceRoot,
      env: process.env,
      encoding: "utf8",
    }).status,
    0
  );
  const candidateHead = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: evidenceRoot,
    encoding: "utf8",
  }).stdout.trim();
  const candidateTree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: evidenceRoot,
    encoding: "utf8",
  }).stdout.trim();
  const expectedSourceFingerprint = state.sourceFingerprintDetails(
    evidenceRoot,
    { includeEnvironment: false }
  ).fingerprint;
  await runFuzz({
    root: evidenceRoot,
    env: {
      FUZZ_GAMES: "200",
      FUZZ_SEED_BASE: "160748956",
      FUZZ_CANDIDATE_HEAD: candidateHead,
      FUZZ_CANDIDATE_TREE: candidateTree,
    },
    log() {},
    execute(command, args, options) {
      assert.equal(command, process.execPath);
      assert.equal(options.env.FUZZ_CANDIDATE_HEAD, candidateHead);
      assert.equal(options.env.FUZZ_CANDIDATE_TREE, candidateTree);
      assert.equal(
        args.at(-1),
        "apps/playground-web/test/selfplay-fuzz.test.ts"
      );
      return { status: 0 };
    },
  });
  const evidenceFile = readdirSync(join(evidenceRoot, "logs/fuzz-runs"))[0];
  const evidenceReport = JSON.parse(
    readFileSync(join(evidenceRoot, "logs/fuzz-runs", evidenceFile), "utf8")
  );
  assert.equal(evidenceReport.sourceHead, candidateHead);
  assert.equal(evidenceReport.sourceTree, candidateTree);
  assert.equal(evidenceReport.candidateHead, candidateHead);
  assert.equal(evidenceReport.candidateTree, candidateTree);
  assert.equal(evidenceReport.sourceFingerprint, expectedSourceFingerprint);
  assert.ok(
    selectCandidateFuzzEvidence({
      root: evidenceRoot,
      head: candidateHead,
      tree: candidateTree,
      sourceFingerprint: expectedSourceFingerprint,
    }),
    "matching passed receipt is selectable for independent review"
  );
  writeFileSync(
    join(evidenceRoot, "logs/fuzz-runs/stale-candidate.json"),
    JSON.stringify({
      ...evidenceReport,
      candidateTree: "0".repeat(candidateTree.length),
      requestedAt: evidenceReport.requestedAt - 1,
    })
  );
  assert.equal(
    selectCandidateFuzzEvidence({
      root: evidenceRoot,
      head: candidateHead,
      tree: candidateTree,
      sourceFingerprint: expectedSourceFingerprint,
    }).report.requestedAt,
    evidenceReport.requestedAt,
    "a later receipt for a different candidate cannot shadow the valid proof"
  );
  assert.equal(
    selectCandidateFuzzEvidence({
      root: evidenceRoot,
      head: candidateHead,
      tree: candidateTree,
      sourceFingerprint: "0".repeat(64),
    }),
    null,
    "a changed source fingerprint cannot reuse an older fuzz receipt"
  );
} finally {
  rmSync(evidenceRoot, { recursive: true, force: true });
}

// A real worker -> wrapper restart changes launcher/delivery metadata. Run
// both attempts in separate processes, while keeping actual execution inputs.
const retryRoot = mkdtempSync(join(tmpdir(), "orica-fuzz-resume-test-"));
let retryOwner;
try {
  assert.equal(
    spawnSync("git", ["init", "-b", "main"], { cwd: retryRoot }).status,
    0
  );
  writeFileSync(join(retryRoot, ".gitignore"), "logs/\n");
  writeFileSync(join(retryRoot, "source.txt"), "candidate\n");
  const wrapperEnv = {
    ...process.env,
    ...env,
    ORICA_CLUSTER_REGISTRY: join(
      retryRoot,
      "autorun-queue",
      "cluster-registry.json"
    ),
    ORICA_EFFECT_DEBUG_HUB_ROOT: retryRoot,
    ORICA_SUPERVISOR_HUB_REPO: retryRoot,
  };
  for (const key of [
    "ORICA_INTEGRATION_REQUEST",
    "ORICA_WORKER_DELIVERY_FILE",
    "ORICA_LANE_KIND",
  ])
    delete wrapperEnv[key];
  const childCode = `
    import {runFuzz} from ${JSON.stringify(new URL("./fuzz-runner.mjs", import.meta.url).href)};
    import state from ${JSON.stringify(new URL("./harness/verification-state.cjs", import.meta.url).href)};
    import {readdirSync,readFileSync} from 'node:fs';
    import {join} from 'node:path';
    const root=process.argv[1];
    let failure;
    try {
      await runFuzz({root,log(){},leaseOptions:{timeoutMs:20,pollMs:5},execute(){return {status:0}}});
    } catch(error) {failure=error.code; if(failure!=='VALIDATION_BUSY') throw error;}
    const records=readdirSync(join(root,'logs/fuzz-runs')).map(file=>JSON.parse(readFileSync(join(root,'logs/fuzz-runs',file),'utf8'))).sort((a,b)=>b.requestedAt-a.requestedAt);
    console.log('RESULT_JSON='+JSON.stringify({failure,receipt:records[0].queueReceipt,strict:state.sourceFingerprint(root)}));
  `;
  const attempt = (childEnv) => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", childCode, retryRoot],
      {
        env: childEnv,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const line = result.stdout
      .split(/\r?\n/)
      .find((item) => item.startsWith("RESULT_JSON="));
    assert.ok(line, result.stdout);
    return JSON.parse(line.slice("RESULT_JSON=".length));
  };
  retryOwner = await acquireGateLease(retryRoot);
  const initial = attempt({
    ...wrapperEnv,
    ORICA_LANE_KIND: "codex",
    ORICA_INTEGRATION_REQUEST: join(retryRoot, "logs", "ticket.json"),
    ORICA_WORKER_DELIVERY_FILE: join(retryRoot, "logs", "delivery.json"),
  });
  assert.equal(initial.failure, "VALIDATION_BUSY");
  retryOwner();
  retryOwner = await acquireGateLease(retryRoot, {
    requestKey: JSON.stringify(["gates", "merge", []]),
    requestInput: "prerequisite merge",
    timeoutMs: 1000,
    pollMs: 5,
  });
  retryOwner();
  retryOwner = await acquireGateLease(retryRoot);
  const resumed = attempt(wrapperEnv);
  assert.equal(resumed.failure, "VALIDATION_BUSY");
  assert.deepEqual(
    resumed.receipt,
    initial.receipt,
    "worker -> wrapper keeps exact receipt"
  );
  assert.equal(
    resumed.strict,
    initial.strict,
    "verification identity ignores delivery metadata across worker and wrapper"
  );
  retryOwner();
  retryOwner = null;
  assert.deepEqual(
    attempt(wrapperEnv).receipt,
    initial.receipt,
    "resumed fuzz consumes original receipt"
  );

  retryOwner = await acquireGateLease(retryRoot);
  for (const [index, changedEnv] of [
    { ...wrapperEnv, FUZZ_GAMES: "201" },
    {
      ...wrapperEnv,
      ORICA_CLUSTER_REGISTRY: join(retryRoot, "different-data.json"),
    },
    { ...wrapperEnv, ORICA_UNKNOWN_QUEUE_INPUT: "changed" },
    wrapperEnv,
  ].entries()) {
    const previous = attempt(wrapperEnv);
    let younger;
    await assert.rejects(
      acquireGateLease(retryRoot, {
        requestKey: "younger-" + index,
        timeoutMs: 5,
        pollMs: 2,
      }),
      (error) => {
        younger = error.receipt;
        return error.code === "VALIDATION_BUSY";
      }
    );
    if (index === 3)
      writeFileSync(join(retryRoot, "source.txt"), "changed candidate\n");
    const changed = attempt(changedEnv);
    assert.equal(changed.failure, "VALIDATION_BUSY");
    assert.notEqual(changed.receipt.id, previous.receipt.id);
    assert.notEqual(
      changed.strict,
      previous.strict,
      "changed execution inputs still invalidate verification"
    );
    assert.ok(
      changed.receipt.sequence > younger.sequence,
      "changed computation/data/source joins the tail"
    );
  }
} finally {
  retryOwner?.();
  assert.equal(dirname(realpathSync(retryRoot)), realpathSync(tmpdir()));
  rmSync(retryRoot, { recursive: true, force: true });
}
console.log(
  "[test-fuzz-runner] shared lease, worker/wrapper receipt reuse, changed-input tail, exact settings, and failure cleanup passed"
);
assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()));
rmSync(root, { recursive: true, force: true });
