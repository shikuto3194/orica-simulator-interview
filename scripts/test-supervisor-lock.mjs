#!/usr/bin/env node
/**
 * supervisor-lock の owner / race / stale takeover 回帰テスト。
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const script = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "supervisor-lock.mjs"
);
const dir = mkdtempSync(join(tmpdir(), "orica-supervisor-lock-test-"));
const lock = join(dir, "lock.json");
const baseEnv = { ...process.env, ORICA_SUPERVISOR_LOCK: lock };

function run(args, env = baseEnv, nodeArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, script, ...args], {
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mutationBoundaryRace(action) {
  await run(["acquire", "--token", "boundary-a-token"]);
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lock, old, old);
  const ready = join(dir, `${action}-ready`);
  const proceed = join(dir, `${action}-proceed`);
  const preload = join(dir, `${action}-boundary.mjs`);
  writeFileSync(
    preload,
    `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.readFileSync;
let paused = false;
fs.readFileSync = function(path, ...args) {
  const result = original.call(this, path, ...args);
  if (!paused && String(path) === process.env.TEST_LOCK) {
    paused = true;
    fs.writeFileSync(process.env.TEST_READY, "ready");
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(process.env.TEST_PROCEED)) {
      if (Date.now() > deadline) throw new Error("boundary fixture timed out");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  return result;
};
syncBuiltinESMExports();
`
  );
  const first = run(
    [action, "--token", "boundary-a-token", "--ttl", "1"],
    {
      ...baseEnv,
      TEST_LOCK: lock,
      TEST_READY: ready,
      TEST_PROCEED: proceed,
    },
    ["--import", pathToFileURL(preload).href]
  );
  let second;
  try {
    const deadline = Date.now() + 10000;
    while (!existsSync(ready)) {
      assert(
        Date.now() < deadline,
        `${action} did not reach its read boundary`
      );
      await sleep(10);
    }
    second = run(["acquire", "--token", "boundary-b-token", "--ttl", "1"]);
    // Give the contender enough time to observe the old lock. It must wait on
    // the mutation guard until the original owner finishes its operation.
    await sleep(400);
  } finally {
    writeFileSync(proceed, "continue");
  }
  const [a, b] = await Promise.all([first, second]);
  assert(a.code === 0, `${action} owner failed: ${a.stderr}`);
  assert(
    b.code === (action === "refresh" ? 1 : 0),
    `${action} raced stale takeover: ${b.stdout} ${b.stderr}`
  );
  assert(existsSync(lock), `${action} removed the next owner's lock`);
  const expected =
    action === "refresh" ? "boundary-a-token" : "boundary-b-token";
  assert(
    JSON.parse(readFileSync(lock, "utf8")).token === expected,
    `${action} must preserve the correct lock owner`
  );
  await run(["release", "--token", expected]);
}

async function main() {
  try {
    const first = await run([
      "acquire",
      "--token",
      "owner-a-token",
      "--label",
      "owner-a",
    ]);
    assert(first.code === 0, `owner A acquire failed: ${first.stderr}`);

    const held = await run([
      "acquire",
      "--token",
      "owner-b-token",
      "--label",
      "owner-b",
    ]);
    assert(held.code === 1, "owner B must not acquire a live lock");

    const wrongRefresh = await run(["refresh", "--token", "owner-b-token"]);
    assert(wrongRefresh.code === 2, "wrong owner refresh must fail");

    const wrongRelease = await run(["release", "--token", "owner-b-token"]);
    assert(wrongRelease.code === 2, "wrong owner release must fail");
    assert(
      JSON.parse(readFileSync(lock, "utf8")).token === "owner-a-token",
      "wrong owner release modified the lock"
    );

    const ownRefresh = await run(["refresh", "--token", "owner-a-token"]);
    assert(ownRefresh.code === 0, "owner refresh failed");

    const ownRelease = await run(["release", "--token", "owner-a-token"]);
    assert(ownRelease.code === 0 && !existsSync(lock), "owner release failed");

    const race = await Promise.all([
      run(["acquire", "--token", "race-a-token", "--label", "race-a"]),
      run(["acquire", "--token", "race-b-token", "--label", "race-b"]),
    ]);
    assert(
      race.filter((result) => result.code === 0).length === 1 &&
        race.filter((result) => result.code === 1).length === 1,
      `atomic acquire race failed: ${JSON.stringify(race)}`
    );
    const raceOwner = JSON.parse(readFileSync(lock, "utf8")).token;
    await run(["release", "--token", raceOwner]);

    await run(["acquire", "--token", "stale-a-token", "--label", "stale-a"]);
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lock, old, old);
    const takeover = await run([
      "acquire",
      "--token",
      "stale-b-token",
      "--label",
      "stale-b",
      "--ttl",
      "1",
    ]);
    assert(takeover.code === 0, `stale takeover failed: ${takeover.stderr}`);
    assert(
      JSON.parse(readFileSync(lock, "utf8")).token === "stale-b-token",
      "stale takeover did not replace owner"
    );
    const oldOwnerRelease = await run(["release", "--token", "stale-a-token"]);
    assert(
      oldOwnerRelease.code === 2,
      "stale owner must not release the new owner's lock"
    );
    await run(["release", "--token", "stale-b-token"]);

    // reap (janitor): frees a stale lock without a token, keeps a fresh one.
    const reapFree = await run(["reap", "--ttl", "1"]);
    assert(
      reapFree.code === 0 && /free/.test(reapFree.stdout),
      "reap on a free lock must be a no-op success"
    );

    await run(["acquire", "--token", "reap-a-token", "--label", "reap-a"]);
    const reapFresh = await run(["reap", "--ttl", "5"]);
    assert(
      reapFresh.code === 1 && existsSync(lock),
      "reap must keep a fresh (not-yet-stale) lock and exit 1"
    );

    const staleTime = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lock, staleTime, staleTime);
    const reapStale = await run(["reap", "--ttl", "1"]);
    assert(
      reapStale.code === 0 &&
        /reaped \(janitor\)/.test(reapStale.stdout) &&
        !existsSync(lock),
      "reap must free a stale lock (no token) and exit 0"
    );

    await mutationBoundaryRace("release");
    await mutationBoundaryRace("refresh");
    await mutationBoundaryRace("reap");

    // A dead or partially written mutation guard is never automatically stolen.
    // Its metadata is diagnostic, not authorization to change another owner.
    const guard = `${lock}.mutation`;
    await run(["acquire", "--token", "guarded-owner-token"]);
    const lockRaw = readFileSync(lock, "utf8");
    const guardRaw = JSON.stringify({
      pid: 2147483647,
      token: "orphan-token",
      startedAt: "2000-01-01T00:00:00.000Z",
    });
    writeFileSync(guard, guardRaw);
    const guarded = await Promise.all([
      run(["acquire", "--token", "guarded-next-token"]),
      run(["refresh", "--token", "guarded-owner-token"]),
      run(["release", "--token", "guarded-owner-token"]),
      run(["reap", "--ttl", "1"]),
    ]);
    assert(
      guarded.every(
        (result) => result.code === 2 && /mutation guard/.test(result.stderr)
      ),
      "every mutation must fail closed with retained-guard recovery guidance"
    );
    assert(
      readFileSync(guard, "utf8") === guardRaw &&
        readFileSync(lock, "utf8") === lockRaw,
      "guard timeout must preserve the guard and lock state"
    );
    rmSync(guard);
    await run(["release", "--token", "guarded-owner-token"]);

    console.log("[test-supervisor-lock] passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[test-supervisor-lock] failed: ${error.message}`);
  process.exit(1);
});
