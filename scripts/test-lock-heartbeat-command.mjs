#!/usr/bin/env node
/** Native-command heartbeat, fencing and owned-tree cleanup regressions. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { terminateOwnedChild } from "./run-with-lock-heartbeat.mjs";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const helper = join(scripts, "run-with-lock-heartbeat.mjs");
const lockScript = join(scripts, "supervisor-lock.mjs");
const temp = mkdtempSync(join(tmpdir(), "orica-lock-command-test-"));
const lock = join(temp, "lock.json");
const fixture = join(temp, "native fixture.mjs");
const children = new Set();
const token = "command-heartbeat-owner";
const env = { ...process.env, ORICA_SUPERVISOR_LOCK: lock };

writeFileSync(
  fixture,
  `import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const [mode, marker, ...args] = process.argv.slice(2);
if (mode === "tree") {
  const child = spawn(process.execPath, [process.argv[1], "tick", marker + ".tick"], { stdio: "inherit", windowsHide: true });
  writeFileSync(marker, JSON.stringify({ parent: process.pid, child: child.pid }));
  setInterval(() => {}, 50);
} else if (mode === "tick") {
  setInterval(() => writeFileSync(marker, String(Date.now())), 50);
} else if (mode === "replace") {
  const lock = JSON.parse(readFileSync(process.env.ORICA_SUPERVISOR_LOCK, "utf8"));
  lock.token = "replacement-lock-owner";
  writeFileSync(process.env.ORICA_SUPERVISOR_LOCK, JSON.stringify(lock));
} else {
  writeFileSync(marker, "started");
  console.log(JSON.stringify(args));
  await new Promise((resolve) => setTimeout(resolve, mode === "wait" ? 3000 : 0));
  process.exitCode = mode === "fail" ? 17 : 0;
}
`,
  "utf8"
);

function start(command, args) {
  const child = spawn(command, args, {
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`fixture timed out: ${args.join(" ")}`)),
      15000
    );
    timeout.unref();
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      children.delete(child);
      resolve({ code, stdout, stderr });
    });
  });
  return { child, done };
}

function command(
  mode,
  marker,
  { owner = token, interval = 100, args = [] } = {}
) {
  return start(process.execPath, [
    helper,
    "--lane",
    "merge",
    "--token",
    owner,
    "--interval-ms",
    String(interval),
    "--",
    process.execPath,
    fixture,
    mode,
    marker,
    ...args,
  ]);
}

function lockCommand(operation, owner = token, args = []) {
  return spawnSync(
    process.execPath,
    [lockScript, operation, "--lane", "merge", "--token", owner, ...args],
    { env, windowsHide: true, shell: false, encoding: "utf8", timeout: 10000 }
  );
}

async function until(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await delay(25);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function main() {
  assert.equal(lockCommand("acquire").status, 0);
  const deniedMarker = join(temp, "denied");
  const denied = await command("success", deniedMarker, {
    owner: "wrong-owner-token",
  }).done;
  assert.equal(denied.code, 3, denied.stderr);
  assert.equal(existsSync(deniedMarker), false, "lost owner launched command");

  const missing = await start(process.execPath, [
    helper,
    "--lane",
    "merge",
    "--token",
    token,
    "--",
    join(temp, "missing-native-command"),
  ]).done;
  assert.equal(missing.code, 1, "native spawn failure was swallowed");

  const started = join(temp, "wait-started");
  const live = command("wait", started);
  await until(() => existsSync(started), "command did not start");
  const firstHeartbeat = statSync(lock).mtimeMs;
  await until(
    () => statSync(lock).mtimeMs > firstHeartbeat + 150,
    "heartbeat stopped during native command"
  );
  assert.equal(lockCommand("reap", token, ["--ttl", "1"]).status, 1);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, token);
  assert.equal((await live.done).code, 0);

  const exactArgs = [
    "value with spaces",
    "semi;colon",
    "$(not-a-command)",
    'quote"value',
    "--token",
  ];
  const result = await command("fail", join(temp, "failure"), {
    args: exactArgs,
  }).done;
  assert.equal(result.code, 17, "native failure code was swallowed");
  assert.deepEqual(
    JSON.parse(result.stdout.trim()),
    exactArgs,
    "native arguments or stdout changed"
  );

  const siblingMarker = join(temp, "sibling.tick");
  const sibling = start(process.execPath, [fixture, "tick", siblingMarker]);
  await until(
    () => existsSync(siblingMarker),
    "unrelated fixture did not start"
  );
  const treeMarker = join(temp, "tree");
  const fenced = command("tree", treeMarker);
  await until(
    () => existsSync(treeMarker + ".tick"),
    "command descendant did not start"
  );
  const pids = JSON.parse(readFileSync(treeMarker, "utf8"));
  const replacement = JSON.parse(readFileSync(lock, "utf8"));
  replacement.token = "replacement-lock-owner";
  writeFileSync(lock, JSON.stringify(replacement));
  const fencedResult = await fenced.done;
  assert.equal(fencedResult.code, 3, fencedResult.stderr);
  await until(
    () => !isAlive(pids.parent) && !isAlive(pids.child),
    "lock loss left command tree running"
  );
  assert.equal(
    isAlive(sibling.child.pid),
    true,
    "cleanup killed an unrelated process"
  );
  assert.equal(
    JSON.parse(readFileSync(lock, "utf8")).token,
    replacement.token,
    "cleanup modified replacement lock"
  );
  assert.equal(lockCommand("release", replacement.token).status, 0);
  assert.equal(lockCommand("acquire").status, 0);

  // The command itself loses ownership then exits before the next heartbeat.
  const finalCheck = await command("replace", join(temp, "unused"), {
    interval: 60000,
  }).done;
  assert.equal(
    finalCheck.code,
    3,
    "final ownership check accepted a lost lock"
  );
  assert.equal(lockCommand("release", replacement.token).status, 0);
  assert.equal(
    terminateOwnedChild(sibling.child, { processGroup: true }).stopped,
    true
  );
  await sibling.done;
  console.log("[test-lock-heartbeat-command] passed");
}

try {
  await main();
} finally {
  for (const child of children) {
    terminateOwnedChild(child, { processGroup: true });
  }
  // This test owns only the mkdtemp directory under the platform temp root.
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert.match(temp, /orica-lock-command-test-[^\\/]+$/);
  rmSync(temp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
