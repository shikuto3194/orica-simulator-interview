#!/usr/bin/env node
/**
 * Codex mobile hub へ渡す supervisor イベントをローカル outbox に積む。
 * heartbeat は未処理 JSON を読み、モバイルスレッドへ報告後 sent/ へ移す。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sanitizeOutput } from "./telegram-secret-sanitize.mjs";
import {
  enqueueFollowup,
  shouldQueueFollowup,
} from "./supervisor-followup.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

const kind = argValue("--kind", "progress");
const lane = argValue("--lane", process.env.ORICA_LANE_KIND || "unknown");
const repo = resolve(
  argValue("--repo", process.env.ORICA_SUPERVISOR_HUB_REPO || process.cwd())
);
const workerDeliveryFile =
  kind === "completed"
    ? argValue(
        "--worker-delivery-file",
        process.env.ORICA_WORKER_DELIVERY_FILE || null
      )
    : null;
const useStdin = args.includes("--stdin");
const explicitFollowup = args.includes("--followup");
const noRelay =
  args.includes("--no-relay") ||
  process.env.ORICA_SUPERVISOR_REPORT_NO_RELAY === "1";
const positional = args.filter(
  (value, index) =>
    !value.startsWith("--") &&
    args[index - 1] !== "--kind" &&
    args[index - 1] !== "--repo" &&
    args[index - 1] !== "--lane" &&
    args[index - 1] !== "--worker-delivery-file"
);
const rawText = useStdin ? readFileSync(0, "utf8") : positional.join(" ");
const sanitized = sanitizeOutput(rawText.trim());
const text =
  sanitized.detected.length > 0
    ? `⚠️ 秘密情報を検出しマスクしました: ${sanitized.detected.join(", ")}\n\n${sanitized.text}`
    : sanitized.text;

if (!rawText.trim()) {
  console.error("[supervisor-report] message is empty");
  process.exit(1);
}

const allowedKinds = new Set([
  "progress",
  "ruling",
  "completed",
  "error",
  "control",
]);
if (!allowedKinds.has(kind)) {
  console.error(`[supervisor-report] unsupported kind: ${kind}`);
  process.exit(1);
}

const outbox = join(repo, "logs", "codex-hub-outbox");
mkdirSync(outbox, { recursive: true });
const createdAt = new Date().toISOString();
const requiresFollowup =
  !args.includes("--no-followup") &&
  shouldQueueFollowup({
    kind,
    text: text.trim(),
    explicit: explicitFollowup,
  });
const followup = requiresFollowup
  ? enqueueFollowup({ repo, kind, lane, text: text.trim(), createdAt })
  : null;
const name = `${createdAt.replace(/[:.]/g, "-")}-${process.pid}-${randomUUID()}.json`;
const target = join(outbox, name);
const temporary = `${target}.tmp`;
const payload = {
  schemaVersion: 1,
  kind,
  lane,
  createdAt,
  text: text.trim(),
  sanitizedSecrets: sanitized.detected,
  ...(workerDeliveryFile ? { workerDeliveryFile } : {}),
  requiresFollowup,
  followupId: followup?.id || null,
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
renameSync(temporary, target);
console.log(`[supervisor-report] queued ${kind}: ${target}`);
if (followup) {
  console.log(`[supervisor-report] durable follow-up: ${followup.id}`);
}

if (!noRelay) {
  const relayScript = join(
    dirname(fileURLToPath(import.meta.url)),
    "relay-outbox-to-telegram.mjs"
  );
  if (existsSync(relayScript)) {
    const result = spawnSync(process.execPath, [relayScript, "--max", "10"], {
      cwd: repo,
      env: { ...process.env, ORICA_SUPERVISOR_HUB_REPO: repo },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    if (result.status !== 0) {
      console.error(
        `[supervisor-report] immediate Telegram relay failed: exit ${result.status}`
      );
    }
  }
}
