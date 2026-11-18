#!/usr/bin/env node
import assert from "node:assert/strict";
import "./test-telegram-documents.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  parseReply,
  paths,
  eligible,
  receptionPrompt,
} from "./telegram-message-worker.mjs";
import {
  completionDisposition,
  writeDelivery,
} from "./worker-telegram-delivery.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "orica-telegram-reception-"));
const p = paths(temp),
  env = {
    ...process.env,
    ORICA_TELEGRAM_REPO: temp,
    ORICA_SUPERVISOR_HUB_REPO: temp,
    ORICA_SUPERVISOR_REPORT_NO_RELAY: "1",
    ORICA_TELEGRAM_AUTORUN: "0",
    ORICA_CODEX_FULL_RUN: "0",
    ORICA_FULL_RUN_WORKER_REF: "",
    ORICA_TELEGRAM_PROGRESS_INTERVAL_SECONDS: "1",
    ORICA_TELEGRAM_LIVE_PROGRESS: "1",
    FAKE_ROOT: temp,
  };
const runner = join(temp, "scripts", "telegram-message-worker.mjs");
const scriptNames = [
  "auxiliary-model-policy.mjs",
  "telegram-reception-policy.mjs",
  "telegram-message-worker.mjs",
  "telegram-inbox-store.mjs",
  "worker-codex-stream.mjs",
  "supervisor-work-recovery.mjs",
  "supervisor-integration.mjs",
  "remote-main-integration.mjs",
  "verifier-tree.mjs",
  "run-with-lock-heartbeat.mjs",
  "full-run-checkouts.mjs",
  "primary-main.mjs",
  "supervisor-run-metrics.mjs",
  "audit-inputs.mjs",
  "harness/verification-state.cjs",
  "harness/gate-lease.mjs",
  "harness/recover-gate-lease.mjs",
  "harness/gate-queue.mjs",
  "worker-telegram-delivery.mjs",
  "telegram-inbox.mjs",
  "telegram-document.mjs",
  "supervisor-followup.mjs",
  "supervisor-report.mjs",
  "supervisor-lock.mjs",
  "telegram-secret-sanitize.mjs",
  "relay-outbox-to-telegram.mjs",
];
function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function records(path) {
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
}
function put(id, text = "裁定返信。戦力投入の使用コストとスタック窓を共通化") {
  mkdirSync(p.pending, { recursive: true });
  writeDelivery(join(p.pending, id + ".json"), {
    id,
    messageId: Number(id),
    kind: "instruction",
    status: "pending",
    risk: "normal",
    rawText: text,
    text,
  });
}
function run(script, args = [], extra = {}) {
  const result = spawnSync(
    process.execPath,
    [join(temp, "scripts", script), ...args],
    {
      env: { ...env, ...extra },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }
  );
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  return result;
}
const startedRunners = [];
function start(extra = {}) {
  const child = spawn(process.execPath, [runner, "drain"], {
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  const done = new Promise((res, rej) => {
    child.on("error", rej);
    child.on("close", (code) => (code === 0 ? res() : rej(Error(output))));
  });
  const running = { child, done, output: () => output };
  startedRunners.push(running);
  return running;
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(25);
  }
  throw Error(
    "condition timed out; fixture: " +
      temp +
      "\n" +
      startedRunners
        .map(
          ({ child, output }) =>
            `runner ${child.pid}, exit=${child.exitCode}, signal=${child.signalCode}\n${output().slice(-4000)}`
        )
        .join("\n")
  );
}
function relay(extra = {}) {
  return run("relay-outbox-to-telegram.mjs", ["--strict-exit"], extra);
}
let passed = false;
try {
  mkdirSync(join(temp, "scripts"), { recursive: true });
  for (const file of scriptNames) {
    mkdirSync(dirname(join(temp, "scripts", file)), { recursive: true });
    copyFileSync(join(scripts, file), join(temp, "scripts", file));
  }
  const fake = join(temp, "fake-codex.mjs");
  writeFileSync(
    fake,
    [
      'import {readFileSync,appendFileSync} from "node:fs";',
      'import {join} from "node:path";',
      'import {spawnSync} from "node:child_process";',
      "const root=process.env.FAKE_ROOT;",
      'const prompt=readFileSync(0,"utf8");',
      'appendFileSync(join(root,"prompts.jsonl"),JSON.stringify({args:process.argv.slice(2),prompt})+"\\n");',
      'await new Promise(r=>setTimeout(r,Number(process.env.FAKE_DELAY||"400")));',
      'const result=process.env.FAKE_INVALID ? "not json" : JSON.stringify({reply:"裁定を確認しました。使用コストと応答窓を共通経路へ統合します。",handoff:process.env.FAKE_HANDOFF_NULL?null:"戦力投入の使用SSOT修正。支払いと二つの応答窓を検証。"});',
      'if(!process.env.FAKE_NO_CHILD_REPORT)spawnSync(process.execPath,[join(root,"scripts","supervisor-report.mjs"),"--repo",root,"--kind","completed","--stdin"],{input:"same worker completion",env:process.env});',
      'console.log(JSON.stringify({type:"thread.started",thread_id:"fake"}));',
      'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:result}}));',
      'console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}));',
    ].join("\n")
  );
  const command = join(
    temp,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  writeFileSync(
    command,
    process.platform === "win32"
      ? '@echo off\r\n"' + process.execPath + '" "' + fake + '" %*\r\n'
      : '#!/bin/sh\n"' + process.execPath + '" "' + fake + '" "$@"\n',
    { mode: 0o755 }
  );
  env.ORICA_CODEX_EXECUTABLE = command;
  writeFileSync(
    join(temp, "scripts", "notify-telegram.mjs"),
    [
      'import {readFileSync,writeFileSync,appendFileSync,existsSync} from "node:fs";',
      'import {join} from "node:path";',
      'const root=process.env.FAKE_ROOT, args=process.argv.slice(2), i=args.indexOf("--edit-message-id");',
      'const counter=join(root,"counter.txt");',
      'let id=i>=0?Number(args[i+1]):(existsSync(counter)?Number(readFileSync(counter,"utf8")):100)+1;',
      "if(i<0)writeFileSync(counter,String(id));",
      'const ok=!(i>=0&&process.env.FAIL_EDITS==="1");',
      'appendFileSync(join(root,"notify.jsonl"),JSON.stringify({id,edit:i>=0,text:readFileSync(0,"utf8"),ok})+"\\n");',
      "console.log(JSON.stringify({ok,messageId:id}));process.exit(ok?0:1);",
    ].join("\n")
  );

  assert.deepEqual(parseReply('{"reply":"確認しました","handoff":null}'), {
    reply: "確認しました",
    handoff: null,
  });
  assert.throws(() => parseReply('{"reply":"完了"}'));
  assert.match(receptionPrompt({ text: "返信" }, "以前の裁定"), /読取専用/);
  assert.match(receptionPrompt({ text: "返信" }, ""), /taskなしのsearch\/show/);
  assert.match(receptionPrompt({ text: "返信" }, "以前の裁定"), /以前の裁定/);
  const receipt = join(temp, "receipt.json");
  writeDelivery(receipt, {
    status: "running",
    pid: 123,
    finalDelivered: false,
  });
  assert.equal(
    completionDisposition({ workerDeliveryFile: receipt }, () => true).action,
    "wait"
  );
  assert.equal(
    completionDisposition({ workerDeliveryFile: receipt }, () => false).action,
    "send"
  );
  writeDelivery(receipt, { status: "completed", finalDelivered: true });
  assert.equal(
    completionDisposition({ workerDeliveryFile: receipt }).action,
    "archive"
  );

  // Simulate a running engine supervisor. Reception never consults/acquires this lock.
  const engineLock = join(temp, "orica-supervisor.lock.json");
  writeDelivery(engineLock, { token: "engine-owned", status: "running" });
  put("8101");
  const first = start(),
    competing = start();
  await until(() => records(join(temp, "prompts.jsonl")).length === 1);
  put("8102", "追加補足。元のマジックは支払い前なら移動しない。");
  await Promise.all([first.done, competing.done]);
  assert.equal(
    records(join(temp, "prompts.jsonl")).length,
    2,
    "one execution per message under competing dispatch"
  );
  assert.equal(read(engineLock).token, "engine-owned");
  for (const id of ["8101", "8102"]) {
    assert.equal(
      read(join(p.inbox, "applied", id + ".json")).status,
      "applied"
    );
    assert.equal(read(join(p.results, id + ".json")).status, "completed");
    const state = read(join(p.inbox, "reception-" + id + ".json"));
    assert.equal(state.status, "completed");
    assert.match(state.finalText, /フルランキューへ登録済み/);
    assert(
      !state.finalText.startsWith("{"),
      "final preview must be user-facing reply, not JSON"
    );
  }
  const prompts = records(join(temp, "prompts.jsonl"));
  assert(
    prompts.every(
      (r) =>
        r.args.includes("read-only") &&
        !r.args.includes("--dangerously-bypass-approvals-and-sandbox")
    )
  );
  assert.match(
    prompts[1].prompt,
    /裁定を確認しました/,
    "later reply includes prior reception context"
  );
  const notifications = records(join(temp, "notify.jsonl"));
  assert.equal(notifications.filter((n) => !n.edit).length, 2);
  assert.equal(
    notifications.filter((n) => n.edit && n.text.startsWith("✅ 完了")).length,
    2
  );
  relay();
  assert.equal(
    records(join(temp, "notify.jsonl")).length,
    notifications.length,
    "both duplicate completed reports archived"
  );
  const followupDir = join(
    temp,
    "logs",
    "codex-supervisor-followups",
    "pending"
  );
  const count = readdirSync(followupDir).length;
  const secondComplete = spawnSync(
    process.execPath,
    [runner, "complete", "--id", "8101"],
    {
      env,
      input: '{"reply":"別の返答","handoff":"duplicate"}',
      encoding: "utf8",
    }
  );
  assert.equal(secondComplete.status, 0, secondComplete.stderr);
  assert.equal(
    read(join(p.results, "8101.json")).supervisorRequest.skipped,
    true,
    "scheduler outcome is persisted separately from acceptance"
  );
  assert.equal(
    readdirSync(followupDir).length,
    count,
    "completion is idempotent"
  );

  // Failed editing never creates a second message; relay retries that same message once.
  put("8103");
  await start({ FAIL_EDITS: "1" }).done;
  const before = records(join(temp, "notify.jsonl"));
  assert.equal(before.filter((n) => !n.edit).length, 3);
  const failedReceipt = read(join(p.inbox, "reception-8103.json"));
  assert.equal(failedReceipt.status, "completed");
  const beforeRelay = before.length;
  relay();
  const after = records(join(temp, "notify.jsonl"));
  assert.equal(after.length, beforeRelay + 1);
  assert.equal(after.at(-1).edit, true);
  assert.match(after.at(-1).text, /✅ 完了/);

  // Disabled live output still produces only one fallback completion, with the full reply.
  put("8104");
  const disabledBefore = after.length;
  await start({ ORICA_TELEGRAM_LIVE_PROGRESS: "0" }).done;
  assert.equal(records(join(temp, "notify.jsonl")).length, disabledBefore);
  relay();
  assert.equal(records(join(temp, "notify.jsonl")).length, disabledBefore + 1);
  assert.match(
    records(join(temp, "notify.jsonl")).at(-1).text,
    /フルランキューへ登録済み/
  );

  // Invalid model output stays pending, and retries are bounded.
  put("8105");
  await start({ FAKE_INVALID: "1" }).done;
  assert(existsSync(join(p.pending, "8105.json")));
  assert(!eligible(read(join(p.pending, "8105.json")), p));
  writeDelivery(join(p.attempts, "8105.json"), { count: 3, retryAfter: 0 });
  assert(!eligible(read(join(p.pending, "8105.json")), p));
  const cancelled = spawnSync(
    process.execPath,
    [runner, "complete", "--id", "8199"],
    {
      env,
      input: '{"reply":"回答","handoff":"must not enqueue"}',
      encoding: "utf8",
    }
  );
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");

  run("telegram-inbox.mjs", ["retry", "--id", "8105"]);
  assert(
    eligible(read(join(p.pending, "8105.json")), p),
    "retry clears the attempt limit"
  );
  put("8106", "/ruling BSAZ01-C12 補足裁定");
  writeDelivery(join(p.pending, "8106.json"), {
    ...read(join(p.pending, "8106.json")),
    kind: "ruling",
    cardNo: "BSAZ01-C12",
    ruling: "補足裁定",
  });
  const receptionUrl = pathToFileURL(
    join(temp, "scripts", "telegram-inbox.mjs")
  ).href;
  const dispatched = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {requestReceptionRun} from " +
        JSON.stringify(receptionUrl) +
        "; console.log(JSON.stringify(requestReceptionRun()));",
    ],
    {
      env: { ...env, ORICA_TELEGRAM_AUTORUN: "1", FAKE_HANDOFF_NULL: "1" },
      encoding: "utf8",
      windowsHide: true,
    }
  );
  assert.equal(dispatched.status, 0, dispatched.stderr);
  assert.equal(JSON.parse(dispatched.stdout).requested, true);
  await until(
    () =>
      existsSync(join(p.inbox, "applied", "8106.json")) && !existsSync(p.lock)
  );
  assert.equal(
    read(join(p.inbox, "applied", "8106.json")).status,
    "applied",
    "explicit ruling has same immediate path even without an open ruling row"
  );
  assert.equal(read(engineLock).token, "engine-owned");

  // Exercise the real /force and /retry control parser, plus isolated scheduler activation.
  const controlMock = join(temp, "control-fault-mock.mjs");
  writeFileSync(
    controlMock,
    [
      'import fs from "node:fs";',
      'import cp from "node:child_process";',
      'import {syncBuiltinESMExports} from "node:module";',
      'import {join} from "node:path";',
      "const root=process.env.FAKE_ROOT, rename=fs.renameSync, read=fs.readFileSync, spawn=cp.spawnSync;",
      'const marker=join(root,"fault-"+(process.env.FAULT_AFTER||"none"));',
      'fs.renameSync=function(a,b){const value=rename(a,b);const target=String(b).replaceAll("\\\\","/");if(process.env.FAULT_AFTER&&!fs.existsSync(marker)&&((process.env.FAULT_AFTER==="handoff"&&target.includes("/codex-supervisor-followups/pending/"))||(process.env.FAULT_AFTER==="consumed"&&target.endsWith(".json.consumed")))){fs.writeFileSync(marker,"1");throw Error("injected persistence interruption");}return value;};',
      'fs.readFileSync=function(p,...args){const result=read(p,...args);if(process.env.PAUSE_PENDING&&String(p).replaceAll("\\\\","/").endsWith("/pending/"+process.env.PAUSE_PENDING+".json")){fs.writeFileSync(join(root,"pending-read"),"1");while(!fs.existsSync(join(root,"release-read")))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return result;};',
      'cp.spawnSync=function(command,args,options){if(command==="powershell.exe")return {status:0,stdout:"Ready\\n",stderr:""};if(command==="schtasks"){fs.appendFileSync(join(root,"scheduler.jsonl"),JSON.stringify({lock:process.env.ORICA_SUPERVISOR_LOCK||null,receptionHeld:fs.existsSync(join(root,"logs/codex-telegram-inbox/reception.lock.json"))})+"\\n");return {status:0,stdout:"SUCCESS",stderr:""};}const result=spawn(command,args,options);if(process.env.STOP_RUNNER_AFTER_COMMIT&&args?.[1]==="complete"&&result.status===0)process.exit(77);return result;};',
      "syncBuiltinESMExports();",
      "globalThis.fetch=async()=>({json:async()=>({ok:true,result:process.env.UPDATE_TEXT?[{update_id:Number(process.env.UPDATE_ID),message:{message_id:Number(process.env.UPDATE_ID),chat:{id:123},from:{id:123,is_bot:false},text:process.env.UPDATE_TEXT}}]:[]})});",
    ].join("\n")
  );
  const controlEnv = {
    ...env,
    NODE_OPTIONS: "--import " + pathToFileURL(controlMock).href,
    TELEGRAM_BOT_TOKEN: "fixture-token",
    TELEGRAM_CHAT_ID: "123",
    ORICA_SUPERVISOR_LOCK_DIR: join(temp, "scheduler-locks"),
  };
  delete controlEnv.ORICA_SUPERVISOR_LOCK;
  writeDelivery(join(p.inbox, "state.json"), {
    initialized: true,
    offset: 8200,
  });
  function control(text, id) {
    return run("telegram-inbox.mjs", ["poll"], {
      ...controlEnv,
      UPDATE_TEXT: text,
      UPDATE_ID: String(id),
    });
  }
  control("/force 共通経路を修正", 8201);
  assert(existsSync(join(p.pending, "8201-force.json")));
  writeDelivery(join(p.attempts, "8201-force.json"), { count: 3 });
  writeDelivery(join(p.inbox, "reception-8201-force.json"), {
    model: "gpt-5.6-terra",
    reasoningEffort: "xhigh",
  });
  control("/retry 8201-force", 8202);
  assert(eligible(read(join(p.pending, "8201-force.json")), p));
  await start({ ...controlEnv, ORICA_TELEGRAM_AUTORUN: "1" }).done;
  assert.equal(read(join(p.results, "8201-force.json")).status, "completed");
  const scheduler = records(join(temp, "scheduler.jsonl"));
  assert(
    scheduler.some((r) => r.receptionHeld && r.lock === null),
    "supervisor starts while independent reception lock is held"
  );

  const rawReply = JSON.stringify({
    reply: "復旧した回答",
    handoff: "確定した一度だけの引継ぎ",
  });
  function complete(id, extra = {}) {
    return spawnSync(process.execPath, [runner, "complete", "--id", id], {
      env: { ...controlEnv, ...extra },
      input: rawReply,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  // A committed handoff may already be resolved before the controller retries.
  put("8203");
  const interruptedHandoff = complete("8203", { FAULT_AFTER: "handoff" });
  assert.notEqual(interruptedHandoff.status, 0);
  assert.equal(read(join(p.results, "8203.json")).status, "prepared");
  const handoffFile = readdirSync(followupDir).find((file) =>
    read(join(followupDir, file)).text.includes("inbox 8203 /")
  );
  assert(handoffFile);
  const handoff = read(join(followupDir, handoffFile));
  run("supervisor-followup.mjs", [
    "resolve",
    "--id",
    handoff.id,
    "--note",
    "worker completed",
    "--repo",
    temp,
  ]);
  const recovered = complete("8203");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).handoffId, handoff.id);
  assert(
    !existsSync(join(followupDir, handoffFile)),
    "resolved handoff must never be resurrected"
  );
  assert.match(JSON.parse(recovered.stdout).reply, /引継ぎ処理済み/);

  // The durable final result exists even when consumption is interrupted immediately after the rename.
  put("8204");
  const interruptedConsume = complete("8204", { FAULT_AFTER: "consumed" });
  assert.notEqual(interruptedConsume.status, 0);
  assert(!existsSync(join(p.pending, "8204.json")));
  assert.equal(read(join(p.results, "8204.json")).status, "completed");
  const afterConsume = complete("8204");
  assert.equal(afterConsume.status, 0, afterConsume.stderr);
  assert.equal(JSON.parse(afterConsume.stdout).status, "completed");
  // Repair pending consumption from a committed result even at the model retry limit, without another model run.
  put("8204");
  writeDelivery(join(p.attempts, "8204.json"), {
    count: 3,
    retryAfter: Date.now() + 60000,
  });
  const beforeRepair = records(join(temp, "prompts.jsonl")).length;
  await start({ ...controlEnv, FAKE_INVALID: "1" }).done;
  assert(!existsSync(join(p.pending, "8204.json")));
  assert.equal(records(join(temp, "prompts.jsonl")).length, beforeRepair);

  // If finalization wins the transaction, cancellation waits and cannot claim to cancel that message.
  put("8205");
  const committing = spawn(
    process.execPath,
    [runner, "complete", "--id", "8205"],
    {
      env: { ...controlEnv, PAUSE_PENDING: "8205" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  committing.stdin.end(rawReply);
  const committingDone = new Promise((res) => committing.once("close", res));
  await until(() => existsSync(join(temp, "pending-read")));
  const cancelling = spawn(
    process.execPath,
    [join(temp, "scripts", "telegram-inbox.mjs"), "poll"],
    {
      env: { ...controlEnv, UPDATE_TEXT: "/cancel", UPDATE_ID: "8206" },
      stdio: "ignore",
      windowsHide: true,
    }
  );
  let cancelFinished = false;
  const cancelDone = new Promise((res) =>
    cancelling.once("close", (code) => {
      cancelFinished = true;
      res(code);
    })
  );
  await delay(200);
  assert(!cancelFinished, "cancel must wait for the persistence transaction");
  writeFileSync(join(temp, "release-read"), "1");
  assert.equal(await committingDone, 0);
  assert.equal(await cancelDone, 0);
  assert.equal(read(join(p.inbox, "applied", "8206.json")).canceled.pending, 0);
  assert(read(join(p.results, "8205.json")).handoffId);
  // If cancel/new wins first, a late result never queues a task.
  for (const [id, commandId, command] of [
    ["8207", "8208", "/cancel"],
    ["8209", "8210", "/new"],
  ]) {
    put(id);
    control(command, commandId);
    const late = complete(id);
    assert.equal(late.status, 0, late.stderr);
    assert.equal(JSON.parse(late.stdout).status, "cancelled");
    assert(
      !readdirSync(followupDir).some((file) =>
        read(join(followupDir, file)).text.includes("inbox " + id + " /")
      )
    );
  }

  // Real read-only reception emits no child completion report. Kill its runner after the
  // controller commits; the already durable outbox must finish the original message.
  run("relay-outbox-to-telegram.mjs", ["--strict-exit", "--max", "200"]);
  put("8211", "確定直後のrunner停止から返信を復旧");
  const beforeCrash = records(join(temp, "notify.jsonl")).length;
  await start({
    ...controlEnv,
    STOP_RUNNER_AFTER_COMMIT: "1",
    FAKE_NO_CHILD_REPORT: "1",
  }).done;
  const committedAfterCrash = read(join(p.results, "8211.json"));
  assert.equal(committedAfterCrash.status, "completed");
  assert(!existsSync(join(p.pending, "8211.json")));
  const crashNotifications = records(join(temp, "notify.jsonl")).slice(
    beforeCrash
  );
  assert.equal(crashNotifications.length, 1);
  assert.equal(crashNotifications[0].edit, false);
  const crashReceipt = read(committedAfterCrash.workerDeliveryFile);
  assert.equal(crashReceipt.finalDelivered, false);
  const promptsBeforeRecovery = records(join(temp, "prompts.jsonl")).length;
  await start({ ...controlEnv, FAKE_INVALID: "1", FAKE_NO_CHILD_REPORT: "1" })
    .done;
  relay();
  const recoveredNotifications = records(join(temp, "notify.jsonl")).slice(
    beforeCrash
  );
  assert.equal(recoveredNotifications.length, 2);
  assert.equal(recoveredNotifications[1].edit, true);
  assert.equal(recoveredNotifications[1].id, crashNotifications[0].id);
  assert.match(recoveredNotifications[1].text, /✅ 完了/);
  assert.match(recoveredNotifications[1].text, /フルランキューへ登録済み/);
  assert.equal(
    records(join(temp, "prompts.jsonl")).length,
    promptsBeforeRecovery
  );
  relay();
  assert.equal(records(join(temp, "notify.jsonl")).length, beforeCrash + 2);
  // Telegram's unchanged-message response is success; only a deleted ID permits sending anew.
  const fetchMock = join(temp, "fake-fetch.mjs");
  writeFileSync(
    fetchMock,
    "globalThis.fetch=async()=>({json:async()=>({ok:false,description:process.env.FAKE_TELEGRAM_ERROR})});"
  );
  const notifyArgs = [
    "--import",
    pathToFileURL(fetchMock).href,
    join(scripts, "notify-telegram.mjs"),
    "--stdin",
    "--strict",
    "--json",
    "--edit-message-id",
    "123",
  ];
  const notifyEnv = {
    ...env,
    TELEGRAM_BOT_TOKEN: "fixture-token",
    TELEGRAM_CHAT_ID: "123",
  };
  const unchanged = spawnSync(process.execPath, notifyArgs, {
    env: {
      ...notifyEnv,
      FAKE_TELEGRAM_ERROR: "Bad Request: message is not modified",
    },
    input: "text",
    encoding: "utf8",
  });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(JSON.parse(unchanged.stdout).ok, true);
  const deleted = spawnSync(process.execPath, notifyArgs, {
    env: {
      ...notifyEnv,
      FAKE_TELEGRAM_ERROR: "Bad Request: message to edit not found",
    },
    input: "text",
    encoding: "utf8",
  });
  assert.equal(deleted.status, 1);
  assert.equal(JSON.parse(deleted.stdout).canSendNew, true);

  // Routine jobs are light from the first call, isolated from inherited full-run flags.
  const routineBefore = records(join(temp, "prompts.jsonl")).length;
  const handoffsBefore = readdirSync(followupDir).length;
  put("8501", "フルランの状況");
  await start({
    FAKE_HANDOFF_NULL: "1",
    ORICA_CODEX_FULL_RUN: "1",
    ORICA_FULL_RUN_WORKER_REF: "must-not-be-used",
  }).done;
  const routineCall = records(join(temp, "prompts.jsonl")).at(-1);
  assert.equal(records(join(temp, "prompts.jsonl")).length, routineBefore + 1);
  assert.equal(
    routineCall.args[routineCall.args.indexOf("-m") + 1],
    "gpt-6-luna"
  );
  assert(
    routineCall.args.some((arg) =>
      /^model_reasoning_effort="?high"?$/.test(arg)
    )
  );
  assert(!routineCall.prompt.includes("過去の会話"));
  assert.equal(readdirSync(followupDir).length, handoffsBefore);
  // A failed routine response cannot escalate or create a full-run handoff.
  put("8502", "使えるコマンド一覧");
  await start().done;
  assert(existsSync(join(p.pending, "8502.json")));
  assert.equal(readdirSync(followupDir).length, handoffsBefore);
  assert.equal(records(join(temp, "prompts.jsonl")).length, routineBefore + 2);
  run("telegram-inbox.mjs", ["retry", "--id", "8502"]);
  await start({
    FAKE_HANDOFF_NULL: "1",
    ORICA_CODEX_MODEL: "gpt-6.1-sol",
    ORICA_CODEX_REASONING_EFFORT: "xhigh",
  }).done;
  const retried = records(join(temp, "prompts.jsonl")).at(-1);
  assert.equal(retried.args[retried.args.indexOf("-m") + 1], "gpt-6-luna");
  assert(
    retried.args.some((arg) => /^model_reasoning_effort="?high"?$/.test(arg))
  );
  assert.equal(read(join(p.results, "8502.json")).status, "completed");
  assert.equal(records(join(temp, "prompts.jsonl")).length, routineBefore + 3);

  // /retry must not erase the only evidence of a pre-policy execution whose model is unknown.
  put("8503", "フルランの状況");
  writeDelivery(join(p.attempts, "8503.json"), { count: 3, retryAfter: 0 });
  const orphanRetry = spawnSync(
    process.execPath,
    [join(temp, "scripts/telegram-inbox.mjs"), "retry", "--id", "8503"],
    { env, encoding: "utf8", windowsHide: true }
  );
  assert.notEqual(orphanRetry.status, 0);
  assert.match(orphanRetry.stderr, /no model receipt/);
  assert.equal(read(join(p.attempts, "8503.json")).count, 3);
  assert(!existsSync(join(p.inbox, "reception-models/8503.json")));
  assert.equal(records(join(temp, "prompts.jsonl")).length, routineBefore + 3);

  // Exercise real poll classification and quarantine, with Telegram/LLM disabled.
  const removedFromGameReport =
    "デッキ除外効果のカード移動先がvoidになっている効果がある。すべてremoved from gameに統一せよ\n\n" +
    "BSTH05.5-X02\nLv2【導域】『自分のアタックステップ』\n" +
    "相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする。\n\n" +
    "この効果が正常に動作しないことを観測している。調査して修正せよ";
  const normalInstructions = [
    removedFromGameReport,
    "すべての除外先表示を REMOVED FROM GAME に統一する",
    "All cards are removed from game. Check this zone label.",
    "すべてのログに removed from game と表示される原因を調査する",
    "BSTH05.5-X02 のデッキ破棄からデッキ除外への置換を調査する",
  ];
  const blockedInstructions = [
    ...[
      "rm",
      "del",
      "erase",
      "delete",
      "remove",
      "wipe",
      "purge",
      "reset",
      "format",
    ].map((verb) => `${verb} all files`),
    "DELETE EVERYTHING",
    "remove repository",
    "wipe workspace",
    "delete logs",
    "remove task",
    "/cmd /purge all",
    "git reset --hard HEAD",
    ...["全部", "全て", "すべて"].flatMap((scope) => [
      `${scope}のファイルを削除`,
      `${scope}のログを消す`,
      `${scope}のタスクを消去`,
      `${scope}deleteして`,
      `${scope}removeして`,
      ...["rm", "del", "erase", "format"].flatMap((operation) => [
        `${scope}のファイルを ${operation} で処理する`,
        `${removedFromGameReport}\n${scope}のファイルを ${operation} で処理する`,
      ]),
    ]),
    "作業領域を初期化",
    "リポジトリをリセット",
    "全消しするため削除",
    "すべて Remove-Item -Recurse で処理する",
    // Preserve conservative substring checks outside the exact game-zone label.
    "すべての項目に deleted と表示される理由を調査する",
    "すべての移動先を removed に統一する",
    "すべての移動先を removed from gameplay に統一する",
    "すべてのファイルを remove_all で処理する",
    "リポジトリ内のファイルすべてに Scripting.FileSystemObject.DeleteFile を実行せよ",
    ...[
      "DeleteFile",
      "RemoveAll",
      "wipeDisk",
      "purgeTasks",
      "resetDatabase",
    ].flatMap((operation) => [
      `すべてのファイルを ${operation} で処理する`,
      `${removedFromGameReport}\nすべてのファイルを ${operation} で処理する`,
    ]),
    "ゲームの仕様を確認してから delete all files",
    "ゲーム内のカードをすべて remove from game に移動",
    "ゲーム内のカードをすべて delete する",
    `${removedFromGameReport}\n続けてログをすべて削除せよ`,
    `${removedFromGameReport}\n続けて delete all files`,
    `remove all logs\n${removedFromGameReport}`,
    `git reset --hard HEAD\n${removedFromGameReport}`,
  ];
  const riskCases = [
    ...normalInstructions.map((text) => ({ text, risk: "normal" })),
    ...blockedInstructions.map((text) => ({ text, risk: "high" })),
  ].map((entry, index) => ({ ...entry, id: String(8600 + index) }));
  for (const { text, risk, id } of riskCases) {
    control(text, id);
    const item = read(join(p.pending, id + ".json"));
    assert.equal(item.risk, risk, `risk classification: ${text}`);
    assert.equal(
      eligible(item, p),
      risk === "normal",
      `worker eligibility: ${text}`
    );
  }
  const quarantined = run("telegram-inbox.mjs", ["quarantine-risky", "--json"]);
  assert.equal(
    JSON.parse(quarantined.stdout).blocked,
    blockedInstructions.length
  );
  for (const { text, risk, id } of riskCases) {
    assert.equal(
      existsSync(join(p.pending, id + ".json")),
      risk === "normal",
      text
    );
    assert.equal(
      existsSync(join(p.pending, id + ".json.consumed")),
      risk === "high",
      text
    );
    assert.equal(
      existsSync(join(p.inbox, "failed", id + ".json")),
      risk === "high",
      text
    );
    if (risk === "high") {
      assert.equal(
        read(join(p.inbox, "failed", id + ".json")).status,
        "blocked",
        text
      );
    }
  }

  console.log(
    "[test-telegram-reception] passed: independent/serialized dispatch, durable handoff, context, cancellation, retries, single-message completion/fallback, instruction risk/quarantine"
  );
  passed = true;
} finally {
  // Only the exact temporary fixture directory created above can be removed.
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert(basename(temp).startsWith("orica-telegram-reception-"));
  if (passed) rmSync(temp, { recursive: true, force: true });
  else
    console.error(
      "[test-telegram-reception] failed fixture preserved: " + temp
    );
}
