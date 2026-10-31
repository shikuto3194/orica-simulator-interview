import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { runGates } from "./harness/run-gates.mjs";
import {
  enqueueFollowup,
  followupDigest,
  listPendingFollowups,
  planFollowups,
  resolveFollowup,
} from "./supervisor-followup.mjs";
import {
  recordAcceptance,
  passedAcceptanceTest,
} from "./supervisor-followup-evidence.mjs";
import state from "./harness/verification-state.cjs";

const directory = mkdtempSync(join(tmpdir(), "orica-followup-evidence-"));
const execFileAsync = promisify(execFile);
const root = join(directory, "checkout");
const hub = join(directory, "hub");
const remote = join(directory, "remote.git");
const scripts = dirname(fileURLToPath(import.meta.url));
const cli = (command, extra = [], repo = hub) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(scripts, "supervisor-followup.mjs"),
        command,
        "--repo",
        repo,
        "--worktree",
        root,
        ...extra,
      ],
      { encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 60_000 }
    )
  );
const git = (...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  }).trim();
const json = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const receipt = (id) =>
  join(hub, `logs/codex-telegram-inbox/reception-results/${id}.json`);
const proof = (item) =>
  join(hub, `logs/codex-supervisor-followups/acceptance/${item.id}.json`);
const pendingFile = (item) =>
  join(hub, `logs/codex-supervisor-followups/pending/${item.id}.json`);
const metadata = [
  "ORICA_INTEGRATION_REQUEST",
  "ORICA_WORKER_DELIVERY_FILE",
  "ORICA_CODEX_CLI",
  "ORICA_CODEX_FULL_RUN",
  "ORICA_CODEX_MODEL",
  "ORICA_CODEX_REASONING_EFFORT",
  "ORICA_CODEX_VERBOSITY",
  "ORICA_FULL_RUN_WORKER_REF",
  "ORICA_LANE_KIND",
];
const savedEnvironment = Object.fromEntries(
  [...metadata, "ORICA_ACCEPTANCE_UNKNOWN"].map((name) => [
    name,
    process.env[name],
  ])
);
const suiteMessage = "[test-supervisor-handoff] passed: acceptance fixture";
try {
  mkdirSync(root);
  assert.deepEqual(
    cli("reconcile-acceptance"),
    {
      schemaVersion: 1,
      checked: 0,
      resolvedIds: [],
      pending: [],
      validationRuns: 0,
    },
    "the real CLI must finish with an empty queue before any Git or gate setup"
  );
  git("init", "-b", "main");
  git("config", "user.name", "Followup evidence fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  writeFileSync(join(root, ".gitignore"), "logs/\nnode_modules/\n");
  mkdirSync(join(root, "scripts/harness"), { recursive: true });
  writeFileSync(
    join(root, "scripts/harness/check-changed-style.mjs"),
    'console.log("fixture style checked");\n'
  );
  json(join(root, "package.json"), {
    type: "module",
    packageManager: "pnpm@10.15.1",
    scripts: {
      "test:supervisor-handoff": "node scripts/test-supervisor-handoff.mjs",
      "test:supervisor-lock": "node scripts/test-supervisor-lock.mjs",
      "test:supervisor-runner-lock":
        "node scripts/test-supervisor-runner-lock.mjs",
    },
  });
  writeFileSync(
    join(root, "scripts/test-supervisor-handoff.mjs"),
    `import fs from "node:fs"; fs.appendFileSync("logs/check-count.txt", "check\\n"); if(fs.readFileSync("scripts/supervisor-followup.mjs", "utf8").includes("fail")) process.exit(1); console.log(${JSON.stringify(suiteMessage)});\n// A fixture source string is not an actual import: "./fixture-source-review.mjs"\n`
  );
  for (const suite of ["supervisor-lock", "supervisor-runner-lock"])
    writeFileSync(
      join(root, `scripts/test-${suite}.mjs`),
      'console.log("fixture lock regression");\n'
    );
  const inputFile = join(root, "scripts/supervisor-followup.mjs");
  writeFileSync(inputFile, "// initial\n");
  git("add", ".");
  git("commit", "-m", "initial fixture");
  writeFileSync(inputFile, "// accepted\n");
  for (const name of metadata) process.env[name] = `worker-one-${name}`;
  await runGates({ root, profile: "finish" });
  git("add", ".");
  git("commit", "-m", "verified fixture fix");
  const fix = git("rev-parse", "HEAD");
  const successful = readdirSync(join(root, "logs/harness/runs")).map((name) =>
    join(root, "logs/harness/runs", name)
  )[0];
  const originalReport = readFileSync(successful);
  function request(id, text = "acceptance fixture passed") {
    const item = enqueueFollowup({
      repo: hub,
      kind: "instruction",
      text: `${id}: ${text}`,
    });
    json(receipt(id), {
      status: "completed",
      handoffId: item.id,
      result: { handoff: text },
    });
    return item;
  }
  const first = request(1),
    second = request(2),
    uncovered = request(3, "additional behavior");
  const entry = (item) => ({
    id: item.id,
    fixCommit: fix,
    coverageReview:
      "Full original request checked; docs fixture covers its only condition.",
    conditions: [
      {
        requirement: "acceptance fixture passed",
        coverage: [
          {
            gate: "handoff",
            testFile: "scripts/test-supervisor-handoff.mjs",
            assertion: suiteMessage,
          },
        ],
      },
    ],
  });
  const input = join(directory, "acceptance-input.json");
  const record = (...items) => {
    json(input, { schemaVersion: 1, requests: items.map(entry) });
    return cli("record-acceptance", ["--input", input]);
  };
  const reconcile = () => cli("reconcile-acceptance");
  record(first, second);
  const fullFingerprint = state.sourceFingerprint(root);
  const acceptanceFingerprint = state.followupFingerprint(root);
  for (const name of metadata) delete process.env[name];
  assert.equal(
    state.sourceFingerprint(root),
    fullFingerprint,
    "normal verification and acceptance share delivery-independent identity"
  );
  assert.equal(
    state.followupFingerprint(root),
    acceptanceFingerprint,
    "worker and cron share acceptance identity"
  );
  assert.equal(
    reconcile().resolvedIds.length,
    0,
    "unpublished fixes remain pending"
  );
  git("push", "origin", "main");
  const beforeChecks = readFileSync(join(root, "logs/check-count.txt"), "utf8");
  const accepted = reconcile();
  assert.deepEqual(accepted.resolvedIds.sort(), [first.id, second.id].sort());
  assert.equal(accepted.validationRuns, 0);
  assert.deepEqual(
    listPendingFollowups({ repo: hub }).map((item) => item.id),
    [uncovered.id]
  );
  assert.equal(
    readFileSync(join(root, "logs/check-count.txt"), "utf8"),
    beforeChecks,
    "unchanged acceptance must not launch heavy gates"
  );
  assert.equal(
    reconcile().resolvedIds.length,
    0,
    "repeated cron cannot process a resolved request twice"
  );
  const terminal = load(
    join(hub, `logs/codex-supervisor-followups/resolved/${first.id}.json`)
  );
  assert.equal(terminal.acceptance.publication.remote, fix);
  assert.equal(terminal.acceptance.evidence[0].reportSha256.length, 64);

  // Similar words and the same successful gate never supply missing per-ID review.
  const similar = request(4);
  assert.ok(planFollowups({ repo: hub }).taskCount === 2);
  assert.equal(reconcile().resolvedIds.length, 0);
  record(similar);
  const wakeReceipt = load(receipt(4));
  wakeReceipt.supervisorRequest = {
    requestedAt: "new dispatch time",
    exitCode: 0,
  };
  json(receipt(4), wakeReceipt);
  const originalReceipt = readFileSync(receipt(4));
  json(receipt(4), {
    ...load(receipt(4)),
    result: { handoff: "acceptance fixture passed AND new condition" },
  });
  assert.match(reconcile().pending[0].reason, /changed/);
  writeFileSync(receipt(4), originalReceipt);
  const savedProof = readFileSync(proof(similar));
  const modifiedProof = load(proof(similar));
  modifiedProof.conditions[0].requirement += " changed";
  json(proof(similar), modifiedProof);
  assert.match(reconcile().pending[0].reason, /changed/);
  writeFileSync(proof(similar), savedProof);

  // Exercise the real photo producer, pending storage and reception finalizer.
  // Only the remote Telegram API is simulated; no real credentials or task wake.
  const photoHub = join(directory, "photo-hub");
  json(join(photoHub, "logs/codex-telegram-inbox/state.json"), {
    initialized: true,
    offset: 1,
    webhookDeletedAt: new Date().toISOString(),
  });
  const photoDriver = join(directory, "receive-photo.mjs");
  writeFileSync(
    photoDriver,
    `
import { runTelegramInboxCli } from ${JSON.stringify(new URL("./telegram-inbox.mjs", import.meta.url).href)};
import { completeReception } from ${JSON.stringify(new URL("./telegram-message-worker.mjs", import.meta.url).href)};
globalThis.fetch = async (input) => {
  const url = String(input);
  const response = (body) => ({ok:true,json:async()=>body,text:async()=>JSON.stringify(body)});
  if (url.includes("/file/bot")) {
    const bytes = Uint8Array.from(Buffer.from("original user data"));
    return { ok: true, arrayBuffer: async () => bytes.buffer };
  }
  if (url.includes("/getFile")) return response({ok:true,result:{file_path:"photos/fixture.jpg"}});
  if (url.includes("/deleteWebhook")) return response({ok:true,result:true});
  if (url.includes("/getUpdates")) return response({ok:true,result:[{update_id:80,message:{message_id:80,chat:{id:123},from:{id:123,is_bot:false},caption:"写真の受付を確認",photo:[{file_id:"fixture-photo"}]}}]});
  throw new Error("Unexpected Telegram fixture request");
};
const polled = await runTelegramInboxCli(["poll", "--strict"], {quiet:true});
if (polled.received !== 1) throw new Error("Real photo poll did not store the message");
const receipt = await completeReception(process.env.ORICA_TELEGRAM_REPO, "80", JSON.stringify({reply:"写真受付を確認",handoff:"acceptance fixture passed"}));
console.log(JSON.stringify(receipt));
`
  );
  const photo = JSON.parse(
    execFileSync(process.execPath, [photoDriver], {
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
      timeout: 60_000,
      env: {
        ...process.env,
        ORICA_TELEGRAM_REPO: photoHub,
        ORICA_TELEGRAM_AUTORUN: "0",
        TELEGRAM_BOT_TOKEN: "fixture-token",
        TELEGRAM_CHAT_ID: "123",
        USERPROFILE: photoHub,
        HOME: photoHub,
      },
    })
  );
  assert.equal(photo.status, "completed");
  const attachment = photo.item.attachments[0].path;
  assert.equal(
    photo.item.attachments[0].sha256,
    createHash("sha256").update("original user data").digest("hex")
  );
  const photoReceipt = join(
    photoHub,
    "logs/codex-telegram-inbox/reception-results/80.json"
  );
  assert.equal(
    load(photoReceipt).item.attachments[0].sha256,
    photo.item.attachments[0].sha256
  );
  const photoItem = listPendingFollowups({ repo: photoHub })[0];
  assert.equal(photoItem.id, photo.handoffId);
  json(input, { schemaVersion: 1, requests: [entry(photoItem)] });
  cli("record-acceptance", ["--input", input], photoHub);
  const originalPhotoReceipt = readFileSync(photoReceipt);
  const legacyPhoto = load(photoReceipt);
  delete legacyPhoto.item.attachments[0].sha256;
  json(photoReceipt, legacyPhoto);
  assert.throws(
    () => cli("record-acceptance", ["--input", input], photoHub),
    /Attachment evidence missing or changed/,
    "legacy hashless receipts remain unverified"
  );
  writeFileSync(photoReceipt, originalPhotoReceipt);
  writeFileSync(attachment, "changed user data");
  assert.match(
    cli("reconcile-acceptance", [], photoHub).pending[0].reason,
    /Attachment evidence missing or changed/
  );
  rmSync(attachment);
  assert.match(
    cli("reconcile-acceptance", [], photoHub).pending[0].reason,
    /ENOENT/
  );
  writeFileSync(attachment, "original user data");
  const acceptedPhoto = cli("reconcile-acceptance", [], photoHub);
  assert.deepEqual(acceptedPhoto.resolvedIds, [photo.handoffId]);
  assert.equal(acceptedPhoto.validationRuns, 0);
  assert.equal(
    readFileSync(join(root, "logs/check-count.txt"), "utf8"),
    beforeChecks
  );

  const report = load(successful);
  json(successful, { ...report, status: "failed" });
  assert.match(reconcile().pending[0].reason, /successful evidence/);
  writeFileSync(successful, originalReport);
  const narrowedFile = join(root, "logs/harness/runs/later-narrowed.json");
  const narrowedOutput = join(root, "logs/unrelated-passing-suite.log");
  writeFileSync(narrowedOutput, "[test-other] passed: unrelated condition\n");
  json(narrowedFile, {
    ...report,
    startedAt: report.startedAt + 1,
    finishedAt: report.finishedAt + 1,
    gates: report.gates.map((gate) => ({
      ...gate,
      outputLog: gate.id === "handoff" ? narrowedOutput : gate.outputLog,
    })),
  });
  record(similar);
  assert.equal(
    load(proof(similar)).evidence[0].report,
    JSON.parse(savedProof).evidence[0].report,
    "a later successful subset must not hide earlier matching coverage"
  );
  rmSync(narrowedFile);
  const failedFile = join(root, "logs/harness/runs/later-failed.json");
  json(failedFile, {
    ...report,
    fingerprint: "different worker environment",
    startedAt: report.startedAt + 1,
    finishedAt: report.finishedAt + 1,
    status: "failed",
    gates: [{ id: "handoff", status: "failed" }],
  });
  assert.match(reconcile().pending[0].reason, /Later failed/);
  rmSync(failedFile);
  json(failedFile, {
    ...report,
    startedAt: report.startedAt + 1,
    finishedAt: null,
    status: "running",
    gates: [],
    currentGate: "handoff",
  });
  assert.match(reconcile().pending[0].reason, /incomplete validation/);
  rmSync(failedFile);
  const output = report.gates.find((gate) => gate.id === "handoff").outputLog;
  const originalOutput = readFileSync(output);
  writeFileSync(output, "changed log");
  assert.match(reconcile().pending[0].reason, /evidence changed/);
  writeFileSync(output, originalOutput);
  json(
    join(hub, `logs/codex-telegram-inbox/reception-results/4-force.json`),
    load(receipt(4))
  );
  assert.equal(
    planFollowups({ repo: hub }).taskCount,
    2,
    "several reception receipts for one ID dispatch it once"
  );
  assert.match(reconcile().pending[0].reason, /changed/);
  rmSync(join(hub, `logs/codex-telegram-inbox/reception-results/4-force.json`));

  // Unknown, new, missing and limited evidence cannot silently count as success.
  const bad = entry(uncovered);
  bad.conditions[0].coverage[0].gate = "ledger";
  assert.throws(
    () =>
      recordAcceptance({
        repo: hub,
        root,
        input: { schemaVersion: 1, requests: [bad] },
      }),
    /Unsupported gate/
  );
  json(successful, {
    ...report,
    gates: report.gates.map((gate) => ({ ...gate, reused: true })),
  });
  assert.throws(() => record(uncovered), /No reusable evidence/);
  writeFileSync(successful, originalReport);
  const absentAssertion = entry(uncovered);
  absentAssertion.conditions[0].coverage[0].assertion =
    "[test-supervisor-handoff] passed: invented coverage";
  assert.throws(
    () =>
      recordAcceptance({
        repo: hub,
        root,
        input: { schemaVersion: 1, requests: [absentAssertion] },
      }),
    /Assertion is absent/
  );
  process.env.ORICA_ACCEPTANCE_UNKNOWN = "changed computation";
  assert.match(reconcile().pending[0].reason, /changed/);
  delete process.env.ORICA_ACCEPTANCE_UNKNOWN;
  for (const key of [
    "ORICA_CLUSTER_REGISTRY",
    "ORICA_EFFECT_DEBUG_HUB_ROOT",
    "ORICA_SUPERVISOR_HUB_REPO",
    "NODE_OPTIONS",
    "VITEST_POOL_ID",
  ]) {
    const previous = process.env[key];
    process.env[key] = "changed validation input";
    assert.notEqual(
      state.followupFingerprint(root),
      acceptanceFingerprint,
      `${key} remains a real acceptance input`
    );
    assert.notEqual(
      state.sourceFingerprint(root),
      fullFingerprint,
      `${key} remains a real verification input`
    );
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(
    join(root, "node_modules/.modules.yaml"),
    "dependency state changed"
  );
  assert.match(reconcile().pending[0].reason, /changed/);
  rmSync(join(root, "node_modules/.modules.yaml"));
  const pending = load(pendingFile(similar));
  json(pendingFile(similar), {
    ...pending,
    occurrenceCount: pending.occurrenceCount + 1,
  });
  assert.throws(
    () =>
      resolveFollowup({
        repo: hub,
        id: similar.id,
        note: "old snapshot",
        expectedDigest: followupDigest(pending),
      }),
    /changed before resolution/
  );
  assert.equal(
    load(pendingFile(similar)).occurrenceCount,
    pending.occurrenceCount + 1
  );
  json(pendingFile(similar), pending);

  const guard = join(
    hub,
    `logs/codex-supervisor-followups/writes/${similar.id}.lock`
  );
  json(guard, {
    pid: process.pid,
    id: similar.id,
    token: "crash-fixture",
    startedAt: new Date().toISOString(),
  });
  assert.match(reconcile().pending[0].reason, /Follow-up write busy/);
  assert.equal(
    load(pendingFile(similar)).id,
    similar.id,
    "interrupted write retains the request"
  );
  assert.equal(
    load(guard).token,
    "crash-fixture",
    "unknown owners are never silently removed"
  );
  rmSync(guard); // Only the marker created by this test, with no writer, is recovered.
  for (const name of metadata) process.env[name] = `worker-two-${name}`;
  assert.equal(
    state.followupFingerprint(root),
    acceptanceFingerprint,
    "next ticket and LLM launcher metadata preserve acceptance identity"
  );
  writeFileSync(inputFile, "// changed implementation\n");
  assert.match(reconcile().pending[0].reason, /clean/);
  git("add", ".");
  git("commit", "-m", "new behavior");
  git("push", "origin", "main");
  assert.match(reconcile().pending[0].reason, /changed/);
  assert.throws(() => record(uncovered), /No reusable evidence/);
  writeFileSync(inputFile, "// accepted new behavior\n");
  await runGates({ root, profile: "finish" });
  git("add", ".");
  git("commit", "-m", "validate new behavior");
  git("push", "origin", "main");
  record(similar);
  assert.deepEqual(reconcile().resolvedIds, [similar.id]);
  assert.equal(
    readFileSync(join(root, "logs/check-count.txt"), "utf8").split("check")
      .length - 1,
    2,
    "new code requires a fresh gate before reuse"
  );
  assert.deepEqual(
    listPendingFollowups({ repo: hub }).map((item) => item.id),
    [uncovered.id]
  );
  // Actual installed reporters distinguish skipped and passing prefix-sharing
  // names. No browser or product server is needed to test report identity.
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(root, "vitest.config.mjs"),
    'export default {test:{globals:true,include:["tests/*.test.js"],fileParallelism:false,maxWorkers:1}};\n'
  );
  writeFileSync(
    join(root, "tests/acceptance.test.js"),
    'describe("acceptance",()=>{test.skip("rejects invalid input",()=>{});test("rejects invalid input when strict",()=>expect(1).toBe(1));test.each(["first","second"])("generated case %s",value=>expect(["first","second"]).toContain(value));let attempts=0;test("passes only after retry",{retry:1},()=>expect(++attempts).toBe(2));});\n'
  );
  const vitestJson = join(root, "logs/actual-vitest.json");
  writeFileSync(
    join(root, "logs/actual-vitest-bootstrap.json"),
    JSON.stringify({
      pid: process.pid,
      at: Date.now(),
      nodeVersion: process.version,
      configLoader: "native",
      environment: Object.fromEntries(
        [
          "NODE_OPTIONS",
          "NODE_ENV",
          "CI",
          "VITEST_POOL_ID",
          "VITEST_WORKER_ID",
          "ESBUILD_BINARY_PATH",
          "UV_THREADPOOL_SIZE",
          "NO_COLOR",
          "FORCE_COLOR",
        ]
          .filter((key) => process.env[key] !== undefined)
          .map((key) => [
            key,
            createHash("sha256").update(process.env[key]).digest("hex"),
          ])
      ),
    })
  );
  // Leave launcher callbacks live while waiting. This fixture is plain ESM,
  // so load its config natively without an unnecessary temporary bundle.
  // Preserve the real runner's timeout and retry behavior.
  await execFileAsync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url)
      ),
      "run",
      "--config",
      "vitest.config.mjs",
      "--configLoader",
      "native",
      "--reporter=default",
      `--reporter=${fileURLToPath(new URL("./harness/vitest-acceptance-reporter.mjs", import.meta.url))}`,
      "--outputFile",
      vitestJson,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
      timeout: 60_000,
    }
  );
  const named = {
    testFile: "tests/acceptance.test.js",
    assertion: "rejects invalid input when strict",
    titlePath: ["acceptance", "rejects invalid input when strict"],
  };
  const short = {
    ...named,
    assertion: "rejects invalid input",
    titlePath: ["acceptance", "rejects invalid input"],
  };
  const vitestReport = load(vitestJson);
  assert.equal(vitestReport.success, true, "normal retries remain enabled");
  const retried = vitestReport.testResults[0].assertionResults.find(
    (test) => test.title === "passes only after retry"
  );
  assert.equal(retried.status, "passed");
  assert.equal(retried.retryCount, 1, "actual runner retry count is retained");
  assert.equal(
    passedAcceptanceTest(
      root,
      vitestReport,
      {
        ...named,
        assertion: "passes only after retry",
        titlePath: ["acceptance", "passes only after retry"],
      },
      "vitest"
    ),
    false,
    "passing only after retry does not establish acceptance"
  );
  assert.equal(passedAcceptanceTest(root, vitestReport, named, "vitest"), true);
  const generatedTitle = "generated case first";
  assert.equal(
    readFileSync(join(root, "tests/acceptance.test.js"), "utf8").includes(
      generatedTitle
    ),
    false,
    "it.each evaluates its title rather than storing it literally"
  );
  assert.equal(
    passedAcceptanceTest(
      root,
      vitestReport,
      {
        ...named,
        assertion: generatedTitle,
        titlePath: ["acceptance", generatedTitle],
      },
      "vitest"
    ),
    true
  );
  const legacy = JSON.parse(JSON.stringify(vitestReport));
  for (const test of legacy.testResults[0].assertionResults)
    delete test.retryCount;
  assert.equal(
    passedAcceptanceTest(root, legacy, named, "vitest"),
    false,
    "missing retry information does not imply first-attempt success"
  );
  assert.equal(
    passedAcceptanceTest(root, vitestReport, short, "vitest"),
    false,
    "a skipped short name cannot borrow the longer passing name"
  );
  assert.equal(
    passedAcceptanceTest(
      root,
      vitestReport,
      { ...named, titlePath: ["other suite", named.assertion] },
      "vitest"
    ),
    false
  );
  const duplicate = JSON.parse(JSON.stringify(vitestReport));
  duplicate.testResults[0].assertionResults.push(
    duplicate.testResults[0].assertionResults.find(
      (test) => test.status === "passed"
    )
  );
  assert.equal(
    passedAcceptanceTest(root, duplicate, named, "vitest"),
    false,
    "ambiguous duplicate test identity is not acceptance"
  );

  mkdirSync(join(root, "e2e"));
  writeFileSync(
    join(root, "playwright.config.mjs"),
    'export default {testDir:"./e2e",outputDir:"./logs/playwright-results",projects:[{name:"fixture"}],workers:1};\n'
  );
  const playwrightImport = new URL(
    "../node_modules/@playwright/test/index.mjs",
    import.meta.url
  ).href;
  writeFileSync(
    join(root, "e2e/home-lobby.spec.ts"),
    `import {test,expect} from ${JSON.stringify(playwrightImport)}; test.describe("acceptance",()=>{test.skip("rejects invalid input",()=>{});test("rejects invalid input when strict",()=>expect(1).toBe(1));` +
      'for(const choice of ["first","second"])test(`generated case ${choice}`,()=>expect(choice).toBeTruthy());});\n'
  );
  mkdirSync(join(root, "node_modules/@playwright/test"), { recursive: true });
  writeFileSync(
    join(root, "node_modules/@playwright/test/cli.js"),
    `import ${JSON.stringify(new URL("../node_modules/@playwright/test/cli.js", import.meta.url).href)};\n`
  );
  git("add", ".");
  git("commit", "-m", "real named reporter fixtures");
  writeFileSync(
    join(root, "e2e/home-lobby.spec.ts"),
    readFileSync(join(root, "e2e/home-lobby.spec.ts"), "utf8") + "\n"
  );
  const inheritedOutput = join(root, "logs/inherited-playwright.json");
  writeFileSync(inheritedOutput, "retain existing output");
  const originalOutputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = inheritedOutput;
  try {
    await runGates({ root, profile: "finish" });
  } finally {
    if (originalOutputFile === undefined)
      delete process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    else process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = originalOutputFile;
  }
  assert.equal(readFileSync(inheritedOutput, "utf8"), "retain existing output");
  const playwrightJson = load(
    join(root, "logs/harness/latest.json")
  ).gates.find((gate) => gate.id === "home-layout").testResults.path;
  const playwrightReport = load(playwrightJson);
  const gui = {
    ...named,
    testFile: "e2e/home-lobby.spec.ts",
    project: "fixture",
  };
  assert.equal(
    passedAcceptanceTest(root, playwrightReport, gui, "playwright"),
    true
  );
  assert.equal(
    passedAcceptanceTest(
      root,
      playwrightReport,
      { ...short, testFile: gui.testFile, project: gui.project },
      "playwright"
    ),
    false
  );
  // Exercise registration and public-main reconciliation with an actual gate
  // and generated Playwright title, not only the JSON matcher in isolation.
  git("add", ".");
  git("commit", "-m", "generated reporter title verified");
  git("push", "origin", "main");
  const generated = request(81, "generated framework title acceptance");
  const generatedCoverage = {
    ...gui,
    gate: "home-layout",
    assertion: generatedTitle,
    titlePath: ["acceptance", generatedTitle],
  };
  assert.equal(
    readFileSync(join(root, gui.testFile), "utf8").includes(generatedTitle),
    false,
    "template titles are absent as complete literals from the real test source"
  );
  const generatedEntry = {
    ...entry(generated),
    fixCommit: git("rev-parse", "HEAD"),
    conditions: [
      {
        requirement: "generated framework title acceptance",
        coverage: [generatedCoverage],
      },
    ],
  };
  json(input, { schemaVersion: 1, requests: [generatedEntry] });
  assert.deepEqual(cli("record-acceptance", ["--input", input]).recordedIds, [
    generated.id,
  ]);
  const inventedEntry = globalThis.structuredClone(generatedEntry);
  inventedEntry.conditions[0].coverage[0].assertion = "generated case third";
  inventedEntry.conditions[0].coverage[0].titlePath = [
    "acceptance",
    "generated case third",
  ];
  json(input, { schemaVersion: 1, requests: [inventedEntry] });
  assert.throws(
    () => cli("record-acceptance", ["--input", input]),
    /No named passing execution/,
    "an unexecuted expansion cannot borrow either passing template instance"
  );
  assert.deepEqual(reconcile().resolvedIds, [generated.id]);
  assert.equal(
    passedAcceptanceTest(
      root,
      playwrightReport,
      { ...gui, project: "unrun" },
      "playwright"
    ),
    false
  );
  assert.equal(dirname(realpathSync(directory)), realpathSync(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
  console.log(
    "[test-supervisor-followup-evidence] passed: real gates and Git publication, batch reuse, changed conditions/code, failures, receipt identity, pending preservation"
  );
} catch (error) {
  console.error(`Follow-up evidence fixture retained: ${directory}`);
  throw error;
} finally {
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
