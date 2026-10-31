#!/usr/bin/env node
/**
 * supervisor-lock — owner token 付き単一インスタンスロック。
 *
 * - acquire は `wx` で原子的に作成する。
 * - refresh / release は acquire 時と同じ token を必須とし、他 run のロックを触れない。
 * - owner確認から変更までを短命mutation guardで直列化する。guard残留は自動奪取しない。
 * - stale lock は一度 quarantine へ atomic rename し、移動後にも mtime を再検査してから奪取する。
 * - PID 生存判定には依存せず、mtime heartbeat + TTL でクラッシュを回収する。
 *
 * Usage:
 *   node scripts/supervisor-lock.mjs acquire --token <uuid> [--label <name>] [--lane <name>] [--ttl <min>] [--wait <sec>]
 *   node scripts/supervisor-lock.mjs refresh --token <uuid> [--lane <name>]
 *   node scripts/supervisor-lock.mjs release --token <uuid> [--lane <name>]
 *   node scripts/supervisor-lock.mjs status [--lane <name>] [--ttl <min>]
 *
 * Exit:
 *   acquire: 0=取得 / 1=保持中・wait timeout / 2=引数・I/Oエラー
 *   refresh: 0=更新 / 2=不在・owner不一致
 *   release: 0=解放または既にfree / 2=owner不一致
 *   status : 0=free/stale / 1=held / 2=I/Oエラー
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (flag, fallback = undefined) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const lane = opt("--lane", "supervisor");
const lockDir = process.env.ORICA_SUPERVISOR_LOCK_DIR || "C:\\dev\\orica-wt";
const lockPath =
  process.env.ORICA_SUPERVISOR_LOCK ||
  join(
    lockDir,
    lane === "supervisor"
      ? "orica-supervisor.lock.json"
      : `orica-supervisor.${lane}.lock.json`
  );
const ttlMin = Number(
  // 既定 60min: 長尺 worker run (vitest 全件 + adversarial verifier 多重 round、
  // Claude lane 実例 3h19m) を視野に旧 20→60 へ延長 (2026-06-21)。
  // stale 検出は heartbeat 停止後 60min 経過で発火するので復旧 delay は伸びるが、
  // 生存 run を誤って奪う方が運用コスト高い (進捗ロス + lock 再競合)。
  opt("--ttl") || process.env.ORICA_SUPERVISOR_LOCK_TTL_MIN || 60
);
const waitSec = Number(opt("--wait") || 0);
const label = opt("--label", "supervisor");
const token = opt("--token", process.env.ORICA_SUPERVISOR_LOCK_TOKEN);

function fail(message) {
  // Throw so an owned mutation guard is always released in finally.
  throw new Error(`[lock:${lane}] ${message}`);
}

function requireToken() {
  if (!token || !/^[A-Za-z0-9._:-]{8,200}$/.test(token)) {
    fail("acquire/refresh/release requires --token <owner-token>");
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withMutationGuard(action) {
  const guardPath = `${lockPath}.mutation`;
  const guardToken = randomUUID();
  const deadline = Date.now() + 2000;
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd;
  while (fd === undefined) {
    try {
      fd = openSync(guardPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST")
        fail(`cannot acquire mutation guard ${guardPath}: ${error.message}`);
      if (Date.now() >= deadline) {
        let owner = "unreadable or incomplete metadata";
        try {
          const data = JSON.parse(readFileSync(guardPath, "utf8"));
          owner = `pid=${data.pid}, token=${data.token}, startedAt=${data.startedAt}`;
        } catch {
          // Even an incomplete guard can belong to an active writer.
        }
        fail(
          `mutation guard busy: ${guardPath} (${owner}). No automatic takeover. Retry after the owner finishes; if it crashed, confirm that the recorded owner and all lock commands are absent, preserve this guard for inspection, then remove only this guard and retry. Do not remove the lane lock.`
        );
      }
      sleepSync(20);
    }
  }
  let recorded = false;
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token: guardToken,
        startedAt: new Date().toISOString(),
        command: cmd,
        lockPath,
      })}\n`,
      "utf8"
    );
    recorded = true;
    return action();
  } finally {
    closeSync(fd);
    // All normal mutations honor this guard; do not erase a manually replaced
    // guard or an incomplete one after a failed write. Both require inspection.
    if (recorded) {
      const current = JSON.parse(readFileSync(guardPath, "utf8"));
      if (current.token !== guardToken)
        fail(
          `mutation guard owner changed: ${guardPath}; preserved for inspection`
        );
      unlinkSync(guardPath);
    }
  }
}

function readLock(path = lockPath) {
  // acquire uses wx before writing its JSON. Another claimant can see that short
  // creation window; retry the read without stealing or deleting the new lock.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const meta = JSON.parse(readFileSync(path, "utf8"));
      const stat = statSync(path);
      return {
        meta,
        mtimeMs: stat.mtimeMs,
        ageMin: (Date.now() - stat.mtimeMs) / 60000,
      };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof SyntaxError && attempt < 3) {
        sleepSync(10 * (attempt + 1));
        continue;
      }
      fail(`cannot read lock ${path}: ${error.message}`);
    }
  }
}

function createLockExclusive() {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(
      fd,
      `${JSON.stringify(
        {
          schemaVersion: 2,
          token,
          label,
          lane,
          ttlMin,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    closeSync(fd);
    return true;
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
    if (error?.code === "EEXIST") return false;
    if (fd !== undefined) {
      try {
        unlinkSync(lockPath);
      } catch {
        // best-effort cleanup of this attempt's partially created lock
      }
    }
    fail(`cannot create lock ${lockPath}: ${error.message}`);
  }
}

function restoreQuarantine(quarantinePath) {
  if (!existsSync(lockPath)) {
    try {
      renameSync(quarantinePath, lockPath);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        fail(`cannot restore refreshed lock: ${error.message}`);
      }
    }
  }
  try {
    unlinkSync(quarantinePath);
  } catch {
    // A valid lock already exists; the quarantine copy is best-effort cleanup.
  }
}

function quarantineIfStillStale(observed, verb = "taking over") {
  const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    fail(`cannot quarantine stale lock: ${error.message}`);
  }

  const moved = readLock(quarantinePath);
  const sameOwner =
    moved?.meta?.token === observed.meta?.token &&
    moved?.meta?.startedAt === observed.meta?.startedAt;
  if (!moved || !sameOwner || moved.ageMin < ttlMin) {
    restoreQuarantine(quarantinePath);
    return false;
  }

  try {
    unlinkSync(quarantinePath);
  } catch (error) {
    fail(`cannot remove stale quarantine: ${error.message}`);
  }
  console.log(
    `[lock:${lane}] stale lock (heartbeat ${moved.ageMin.toFixed(1)} min >= TTL ${ttlMin} min, holder "${moved.meta.label}") — ${verb}`
  );
  return true;
}

function tryAcquireOnce() {
  if (createLockExclusive()) return { acquired: true };

  const current = readLock();
  if (!current) return { acquired: false, retry: true };
  if (current.ageMin < ttlMin) {
    return { acquired: false, held: current };
  }

  quarantineIfStillStale(current);
  if (createLockExclusive()) return { acquired: true };
  return { acquired: false, retry: true, held: readLock() };
}

function ownerMatches(current) {
  return current?.meta?.token === token;
}

function runCommand() {
  switch (cmd) {
    case "acquire": {
      requireToken();
      const deadline = Date.now() + waitSec * 1000;
      acquireLoop: for (;;) {
        // Release the guard between attempts so a waiting acquire never blocks
        // its current owner's refresh/release for the entire --wait interval.
        const result = withMutationGuard(tryAcquireOnce);
        if (result.acquired) {
          console.log(`[lock:${lane}] acquired by "${label}" token=${token}`);
          process.exitCode = 0;
          break acquireLoop;
        }
        if (Date.now() >= deadline) {
          const held = result.held || readLock();
          if (held) {
            console.log(
              `[lock:${lane}] held by "${held.meta.label}" (started ${held.meta.startedAt}, heartbeat ${held.ageMin.toFixed(1)} min ago, TTL ${ttlMin} min)` +
                (waitSec > 0 ? ` — wait ${waitSec}s timed out` : "") +
                " — exit"
            );
          } else {
            console.log(`[lock:${lane}] acquisition raced — exit`);
          }
          process.exitCode = 1;
          break acquireLoop;
        }
        sleepSync(5000);
      }
      break;
    }
    case "refresh": {
      requireToken();
      const current = readLock();
      if (!current) fail("cannot refresh: lock is free");
      if (!ownerMatches(current)) {
        fail(
          `cannot refresh: owner mismatch (holder "${current.meta.label}", token=${current.meta.token})`
        );
      }
      const now = new Date();
      try {
        utimesSync(lockPath, now, now);
      } catch (error) {
        fail(`cannot refresh lock: ${error.message}`);
      }
      console.log(`[lock:${lane}] heartbeat refreshed token=${token}`);
      process.exitCode = 0;
      break;
    }
    case "release": {
      requireToken();
      const current = readLock();
      if (!current) {
        console.log(`[lock:${lane}] already free`);
        process.exitCode = 0;
        break;
      }
      if (!ownerMatches(current)) {
        fail(
          `cannot release: owner mismatch (holder "${current.meta.label}", token=${current.meta.token})`
        );
      }
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== "ENOENT")
          fail(`cannot release lock: ${error.message}`);
      }
      console.log(`[lock:${lane}] released token=${token}`);
      process.exitCode = 0;
      break;
    }
    case "status": {
      const current = readLock();
      if (!current) {
        console.log(`[lock:${lane}] free`);
        process.exitCode = 0;
        break;
      }
      const stale = current.ageMin >= ttlMin;
      console.log(
        `[lock:${lane}] ${stale ? "STALE" : "held"} by "${current.meta.label}" (started ${current.meta.startedAt}, heartbeat ${current.ageMin.toFixed(1)} min ago)`
      );
      process.exitCode = stale ? 0 : 1;
      break;
    }
    case "reap": {
      // Janitor: free a lock whose heartbeat (file mtime) has stopped for >= TTL,
      // WITHOUT acquiring it. No token required — this is invoked by the watchdog
      // to collapse the orphan-lock dead window (worker died mid-run, leaving the
      // lock held until the 240-min run TTL expires). Uses --ttl as a heartbeat
      // timeout (default 60), not the run TTL. The atomic quarantine + re-check in
      // quarantineIfStillStale protects a live worker that refreshes concurrently.
      const current = readLock();
      if (!current) {
        console.log(`[lock:${lane}] free`);
        process.exitCode = 0;
        break;
      }
      if (current.ageMin < ttlMin) {
        console.log(
          `[lock:${lane}] held by "${current.meta.label}" (heartbeat ${current.ageMin.toFixed(1)} min ago, TTL ${ttlMin} min) — not stale, keeping`
        );
        process.exitCode = 1;
        break;
      }
      const reaped = quarantineIfStillStale(current, "reaped (janitor)");
      if (!reaped) {
        console.log(
          `[lock:${lane}] reap raced — lock was refreshed or removed, left intact`
        );
        process.exitCode = 1;
        break;
      }
      process.exitCode = 0;
      break;
    }
    default:
      fail(
        "usage: supervisor-lock.mjs acquire|refresh|release|status|reap --token <owner-token> [--label <name>] [--lane <name>] [--ttl <min>] [--wait <sec>]"
      );
  }
}

try {
  if (["refresh", "release", "reap"].includes(cmd))
    withMutationGuard(runCommand);
  else runCommand();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
