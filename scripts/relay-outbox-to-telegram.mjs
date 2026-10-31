#!/usr/bin/env node
/**
 * relay-outbox-to-telegram — codex-hub-outbox/ の未処理 JSON を Telegram へ中継する。
 *
 * フルラン設計上、worker は supervisor-report.mjs で outbox に JSON を積み、
 * 「Codex App の固定 heartbeat スレッド」がそれを読んでモバイルへ中継する仕組み。
 * しかし heartbeat が止まると progress/ruling/completed/error が手元に届かない死角になる。
 *
 * 本スクリプトは heartbeat の代替/補完として、outbox を直接 Telegram へ流す:
 * - 各 lane wrapper の冒頭で 1 ショット呼び出し → 起動毎に溜まった outbox が掃ける
 * - 成功した JSON は sent/ へ移動 (heartbeat の挙動と同じ)
 * - 送信失敗は exit 0 のまま (無人ループを止めない設計、notify-telegram.mjs と同じポリシー)
 *
 * Usage:
 *   node scripts/relay-outbox-to-telegram.mjs              # 1 ショット中継
 *   node scripts/relay-outbox-to-telegram.mjs --max 5      # 最大 5 件まで (rate limit 回避)
 *   node scripts/relay-outbox-to-telegram.mjs --dry-run    # 送信せず内容だけ表示
 */

import {
  closeSync,
  existsSync,
  readdirSync,
  readFileSync,
  openSync,
  renameSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeOutput } from "./telegram-secret-sanitize.mjs";
import {
  completionDisposition,
  writeDelivery,
} from "./worker-telegram-delivery.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(
  process.env.ORICA_SUPERVISOR_HUB_REPO || join(SCRIPT_DIR, "..")
);
const OUTBOX = join(ROOT, "logs", "codex-hub-outbox");
const SENT = join(OUTBOX, "sent");
const LOCK = join(OUTBOX, ".relay.lock");
const NOTIFY = join(ROOT, "scripts", "notify-telegram.mjs");
const LOCK_STALE_MS = 15 * 60 * 1000;

const args = process.argv.slice(2);
const argValue = (k) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const MAX = Number(argValue("--max") || 20);
const DRY = args.includes("--dry-run");
const STRICT_EXIT = args.includes("--strict-exit");

mkdirSync(SENT, { recursive: true });

let lockFd = null;

function acquireLock() {
  try {
    const fd = openSync(LOCK, "wx");
    writeFileSync(
      fd,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      "utf8"
    );
    return fd;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const ageMs = Date.now() - statSync(LOCK).mtimeMs;
      if (ageMs > LOCK_STALE_MS) {
        unlinkSync(LOCK);
        return acquireLock();
      }
    } catch (staleError) {
      if (staleError?.code !== "ENOENT") throw staleError;
      return acquireLock();
    }
    console.log("[relay-outbox] another relay is active");
    process.exit(0);
  }
}

function releaseLock() {
  if (lockFd === null) return;
  try {
    closeSync(lockFd);
  } catch {
    // best-effort cleanup on process exit
  }
  try {
    if (existsSync(LOCK)) unlinkSync(LOCK);
  } catch {
    // best-effort cleanup on process exit
  }
  lockFd = null;
}

lockFd = acquireLock();
process.once("exit", releaseLock);

let entries;
try {
  entries = readdirSync(OUTBOX)
    .filter((n) => n.endsWith(".json"))
    .map((n) => ({
      name: n,
      path: join(OUTBOX, n),
      mtime: statSync(join(OUTBOX, n)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime); // 古い順 (FIFO)
} catch (e) {
  console.error(`[relay-outbox] outbox 読込失敗: ${e.message}`);
  process.exit(STRICT_EXIT ? 1 : 0);
}

if (entries.length === 0) {
  console.log("[relay-outbox] outbox 空");
  process.exit(0);
}

let relayed = 0;
let failed = 0;
for (const e of entries.slice(0, MAX)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(e.path, "utf8"));
  } catch (err) {
    console.error(`[relay-outbox] JSON parse 失敗 ${e.name}: ${err.message}`);
    failed++;
    continue;
  }

  const disposition = completionDisposition(payload);
  if (disposition.action === "wait") continue;
  if (disposition.action === "archive") {
    if (!DRY) renameSync(e.path, join(SENT, e.name));
    relayed++;
    console.log("[relay-outbox] covered by live completion: " + e.name);
    continue;
  }
  const kind = payload.kind || "msg";
  const lane = payload.lane || "unknown";
  const rawBody = payload.message || payload.text || "(no body)";
  const sanitized = sanitizeOutput(String(rawBody));
  const body =
    sanitized.detected.length > 0
      ? `⚠️ 秘密情報を検出しマスクしました: ${sanitized.detected.join(", ")}\n\n${sanitized.text}`
      : sanitized.text;
  // Telegram の上限 4096 文字。先頭に lane (claude/codex) を固定表示してどのレーンの通知か即判別できるようにする。
  const head = `[${lane}] [orica ${kind}] `;
  let text = head + body;
  if (text.length > 4000) text = text.slice(0, 4000) + "\n…(truncated)";

  if (disposition.receipt?.finalText) text = disposition.receipt.finalText;

  if (DRY) {
    console.log(`[dry] ${e.name}: ${text.slice(0, 120)}...`);
    relayed++;
    continue;
  }

  // notify-telegram.mjs に stdin で渡す。失敗しても次の outbox は処理 (best-effort)。

  const send = (id) =>
    spawnSync(
      process.execPath,
      [
        NOTIFY,
        "--stdin",
        "--strict",
        "--json",
        ...(id ? ["--edit-message-id", String(id)] : []),
      ],
      {
        input: text,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        timeout: 20000,
      }
    );
  let result = send(disposition.messageId);
  let deliveryResult;
  try {
    deliveryResult = JSON.parse(result.stdout || "{}");
  } catch {
    deliveryResult = {};
  }
  if (
    result.status !== 0 &&
    disposition.messageId &&
    deliveryResult.canSendNew
  ) {
    result = send(null);
    try {
      deliveryResult = JSON.parse(result.stdout || "{}");
    } catch {
      deliveryResult = {};
    }
  }

  if (result.status === 0) {
    if (disposition.file)
      writeDelivery(disposition.file, {
        ...disposition.receipt,
        finalDelivered: true,
        messageId: deliveryResult.messageId || disposition.messageId,
        updatedAt: new Date().toISOString(),
      });
    try {
      renameSync(e.path, join(SENT, e.name));
      relayed++;
      console.log(`[relay-outbox] relayed ${e.name} (${kind})`);
    } catch (mvErr) {
      console.error(
        `[relay-outbox] sent/ 移動失敗 ${e.name}: ${mvErr.message}`
      );
      // 次 run で再送されないようリネームできなかったので fail カウント
      failed++;
    }
  } else {
    failed++;
    console.error(
      `[relay-outbox] 送信失敗 ${e.name}: exit ${result.status}, stderr=${(result.stderr || "").slice(0, 200)}`
    );
    // 失敗した outbox は残す (次 run で再試行)
  }
}

console.log(
  `[relay-outbox] done: relayed=${relayed} failed=${failed} remaining=${Math.max(0, entries.length - relayed)}`
);
process.exit(STRICT_EXIT && failed > 0 ? 1 : 0);
