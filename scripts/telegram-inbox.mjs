#!/usr/bin/env node
/**
 * telegram-inbox — Telegram Bot API の受信を Codex supervisor 用 inbox に同期する。
 *
 * - poll: getUpdates で新規メッセージを logs/codex-telegram-inbox/pending に保存
 * - apply-rulings: 通常返信と明示裁定を独立した即時受付workerへ渡す
 * - quarantine-risky: 破壊的/広範な instruction を worker prompt へ渡さず隔離
 * - summary: 受付中の件数のみ。実装引継ぎはdurable follow-upから読む
 */

/* global fetch, AbortSignal */
import {
  appendFileSync,
  openSync,
  closeSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { sanitizeOutput } from "./telegram-secret-sanitize.mjs";
import {
  importTelegramDocument,
  TelegramImportError,
  TELEGRAM_IMPORT_VERSION,
} from "./telegram-document.mjs";
import { withInboxMutation } from "./telegram-inbox-store.mjs";
import { pinReceptionProfile } from "./telegram-reception-policy.mjs";
import {
  eligible,
  validInboxId,
  paths as receptionPaths,
} from "./telegram-message-worker.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.ORICA_TELEGRAM_REPO || join(SCRIPT_DIR, ".."));
const ENV_FILE = join(
  process.env.USERPROFILE || process.env.HOME || "",
  "Claude-Code-Remote",
  ".env"
);
const INBOX = join(ROOT, "logs", "codex-telegram-inbox");
const PENDING = join(INBOX, "pending");
const APPLIED = join(INBOX, "applied");
const FAILED = join(INBOX, "failed");
const PURGED = join(INBOX, "purged");
const REJECTED = join(INBOX, "rejected");
const STATE = join(INBOX, "state.json");
const SESSION = join(INBOX, "session.jsonl");
const DYNAMIC_DOMAINS = join(INBOX, "dynamic-domains.json");
const IMAGE_DIR = join(ROOT, ".telegram-images");
const REPORT = join(SCRIPT_DIR, "supervisor-report.mjs");
const SUPERVISOR_TASK_NAME = "orica-full-run-supervisor";
const SUPERVISOR_LOCK_TTL_MIN = 240;
const SESSION_CONTEXT_MAX_CHARS = 12000;
const TELEGRAM_PURGE_LIMIT = 100;

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function credentials() {
  const dotenv = loadDotEnv(ENV_FILE);
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || dotenv.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID || dotenv.TELEGRAM_CHAT_ID,
  };
}

function ensureDirs() {
  for (const dir of [PENDING, APPLIED, FAILED, PURGED])
    mkdirSync(dir, { recursive: true });
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function appendSessionEvent(event) {
  ensureDirs();
  appendFileSync(
    SESSION,
    `${JSON.stringify({
      schemaVersion: 1,
      at: new Date().toISOString(),
      ...event,
    })}\n`,
    "utf8"
  );
}

function readSessionEvents() {
  if (!existsSync(SESSION)) return [];
  return readFileSync(SESSION, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readDynamicDomains() {
  return readJson(DYNAMIC_DOMAINS, { domains: [] }).domains || [];
}

function writeDynamicDomains(domains) {
  writeJsonAtomic(DYNAMIC_DOMAINS, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    domains: [...new Set(domains)].sort(),
  });
}

function extractDomains(text) {
  const domains = [];
  const re = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  for (const match of text.matchAll(re)) {
    try {
      const url = new URL(match[0]);
      if (url.hostname) domains.push(url.hostname.toLowerCase());
    } catch {
      // Ignore malformed URLs pasted in chat.
    }
  }
  return [...new Set(domains)];
}

function extractAndRegisterDomains(text) {
  const domains = extractDomains(text);
  if (domains.length === 0) return [];
  const existing = new Set(readDynamicDomains());
  const added = domains.filter((domain) => !existing.has(domain));
  for (const domain of added) existing.add(domain);
  if (added.length > 0) writeDynamicDomains([...existing]);
  return added;
}

function clearDynamicDomains() {
  writeDynamicDomains([]);
}

function supervisorLockStatus() {
  const result = spawnSync(
    process.execPath,
    [
      join(SCRIPT_DIR, "supervisor-lock.mjs"),
      "status",
      "--lane",
      "supervisor",
      "--ttl",
      String(SUPERVISOR_LOCK_TTL_MIN),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    }
  );
  const text = (result.stdout || result.stderr || "").trim();
  return {
    held: result.status === 1 && /\bheld\b/.test(text),
    status: result.status,
    text,
  };
}

function scheduledSupervisorTaskState() {
  if (process.platform !== "win32") return null;
  const command = `$task = Get-ScheduledTask -TaskName '${SUPERVISOR_TASK_NAME}' -ErrorAction SilentlyContinue; if ($task) { [string]$task.State }`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    }
  );
  if (result.status !== 0) return null;
  return (result.stdout || "").trim() || null;
}

function activeSupervisorRun() {
  const taskState = scheduledSupervisorTaskState();
  if (taskState === "Running") {
    return { active: true, skipReason: "task-running", detail: taskState };
  }

  const lock = supervisorLockStatus();
  if (lock.held) {
    return { active: true, skipReason: "lock-held", detail: lock.text };
  }
  if (lock.status !== 0 && lock.status !== 1) {
    return {
      active: true,
      skipReason: "lock-status-failed",
      detail: lock.text || `exit=${lock.status ?? "unknown"}`,
    };
  }
  return { active: false, lockStatus: lock.text || "unknown" };
}

export function requestSupervisorRun(reason) {
  if (process.env.ORICA_TELEGRAM_AUTORUN === "0") {
    return { requested: false, skipped: true };
  }
  const active = activeSupervisorRun();
  if (active.active) {
    return {
      requested: false,
      skipped: true,
      reason,
      skipReason: active.skipReason,
      detail: active.detail,
    };
  }
  const result = spawnSync("schtasks", ["/Run", "/TN", SUPERVISOR_TASK_NAME], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
  return {
    requested: result.status === 0,
    reason,
    status: result.status,
    stderr: (result.stderr || "").trim(),
  };
}

function parseArgs(argv) {
  const hasCommand = argv[0] && !argv[0].startsWith("-");
  const out = {
    command: hasCommand ? argv[0] : "summary",
    max: 20,
    timeout: 0,
    strict: false,
    json: false,
    id: null,
    note: "",
  };
  for (let i = hasCommand ? 1 : 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--max":
        out.max = Number(next());
        break;
      case "--timeout":
        out.timeout = Number(next());
        break;
      case "--strict":
        out.strict = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--id":
        out.id = next();
        break;
      case "--note":
        out.note = next();
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/telegram-inbox.mjs poll [--max 20] [--timeout 50]",
    "  node scripts/telegram-inbox.mjs apply-rulings",
    "  node scripts/telegram-inbox.mjs quarantine-risky",
    "  node scripts/telegram-inbox.mjs summary",
    "  node scripts/telegram-inbox.mjs retry --id <message-id>",
    "  node scripts/telegram-inbox.mjs resolve --id <message-id> [--note <text>]",
  ].join("\n");
}

function instructionRisk(text) {
  const normalized = text.trim().toLowerCase();
  if (/^\/purge\b/.test(normalized)) return "high";
  if (/\bgit\s+reset\s+--hard\b/.test(normalized)) return "high";
  if (
    /\b(rm|del|erase|delete|remove|wipe|purge|reset|format)\b/.test(normalized)
  ) {
    if (
      /\b(all|everything|repo|repository|workspace|logs?|tasks?)\b/.test(
        normalized
      )
    ) {
      return "high";
    }
  }
  if (/(全部|全て|すべて|全消し|削除|初期化|リセット)/.test(text)) {
    // Exclude only this game-zone label, retaining compound operations (DeleteFile,
    // RemoveAll, etc.) and destructive instructions anywhere else in the message.
    const operationText = text.replace(
      /\bremoved[ \t]+from[ \t]+game\b/gi,
      " "
    );
    if (
      /(\b(?:rm|del|erase|format)\b|purge|delete|remove|wipe|reset|消す|消去|削除|初期化|リセット)/i.test(
        operationText
      )
    ) {
      return "high";
    }
  }
  return "normal";
}

function classifyText(text) {
  const trimmed = text.trim();
  const control = classifyControlCommand(trimmed);
  if (control) return control;
  const commandText = /^\/cmd\s+([\s\S]+)$/i.exec(trimmed);
  if (commandText) {
    const instruction = commandText[1].trim();
    return {
      kind: "instruction",
      text: instruction,
      risk: instructionRisk(instruction),
    };
  }
  const ruling =
    /^(?:\/ruling|\/裁定|ruling|裁定)\s+([^\s:：]+)\s+([\s\S]+)$/i.exec(
      trimmed
    ) || /^裁定[:：]\s*([^\s:：]+)\s*[:：]\s*([\s\S]+)$/i.exec(trimmed);
  if (ruling) {
    return {
      kind: "ruling",
      cardNo: ruling[1],
      ruling: ruling[2].trim(),
    };
  }
  return { kind: "instruction", text: trimmed, risk: instructionRisk(trimmed) };
}

function classifyControlCommand(trimmed) {
  if (trimmed === "/start") {
    return { kind: "control", command: "start", text: trimmed };
  }
  if (/^\/new\b/i.test(trimmed)) {
    return { kind: "control", command: "new", text: trimmed };
  }
  const retry = /^\/retry\s+(\d+(?:-(?:force|instruction))?)$/i.exec(trimmed);
  if (retry)
    return {
      kind: "control",
      command: "retry",
      retryId: retry[1],
      text: trimmed,
    };
  if (/^\/status\b/i.test(trimmed)) {
    return { kind: "control", command: "status", text: trimmed };
  }
  if (/^\/cancel\b/i.test(trimmed)) {
    return { kind: "control", command: "cancel", text: trimmed };
  }
  const domains = /^\/domains(?:\s+(clear))?$/i.exec(trimmed);
  if (domains) {
    return {
      kind: "control",
      command: "domains",
      domainsAction: domains[1] ? "clear" : "list",
      text: trimmed,
    };
  }
  const force = /^\/force(?:\s+([\s\S]+))?$/i.exec(trimmed);
  if (force) {
    return {
      kind: "control",
      command: "force",
      forceText: (force[1] || "").trim(),
      text: trimmed,
    };
  }
  const purge = /^\/purge(?:\s+([\s\S]+))?$/i.exec(trimmed);
  if (purge) {
    return {
      kind: "control",
      command: "purge",
      purgeArg: (purge[1] || "").trim().replace(/\s+/g, " ").toLowerCase(),
      text: trimmed,
    };
  }
  return null;
}

function isRelayEchoText(text) {
  return /^\[[^\]]+\]\s+\[orica\s+(?:progress|ruling|completed|error|control|msg)\]\b/i.test(
    text.trim()
  );
}

function pendingPath(id) {
  return join(PENDING, `${id}.json`);
}

function listPending() {
  ensureDirs();
  return readdirSync(PENDING)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(PENDING, name);
      return { path, item: readJson(path, null) };
    })
    .filter((entry) => entry.item);
}

function archiveDirFiles(sourceDir, targetDir, filter = () => true) {
  if (!existsSync(sourceDir)) return 0;
  mkdirSync(targetDir, { recursive: true });
  let moved = 0;
  for (const name of readdirSync(sourceDir)) {
    if (!filter(name)) continue;
    const source = join(sourceDir, name);
    const target = join(targetDir, name);
    try {
      renameSync(source, target);
      moved += 1;
    } catch {
      // Best-effort cleanup; files currently held by another process can stay.
    }
  }
  return moved;
}

function archiveFile(source, targetDir, targetName) {
  if (!existsSync(source)) return 0;
  mkdirSync(targetDir, { recursive: true });
  try {
    renameSync(source, join(targetDir, targetName));
    return 1;
  } catch {
    return 0;
  }
}

function sanitizeJsonValue(value, detected, stats) {
  if (typeof value === "string") {
    const result = sanitizeOutput(value);
    for (const name of result.detected) detected.add(name);
    if (result.text !== value) stats.fields += 1;
    return result.text;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, detected, stats));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeJsonValue(entry, detected, stats),
      ])
    );
  }
  return value;
}

function sanitizeTextFile(path) {
  if (!existsSync(path)) {
    return { path, found: false, maskedLines: 0, detected: [] };
  }
  const detected = new Set();
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let maskedLines = 0;
  const sanitizedLines = lines.map((line) => {
    if (!line.trim()) return line;
    const result = sanitizeOutput(line);
    for (const name of result.detected) detected.add(name);
    if (result.detected.length > 0) maskedLines += 1;
    return result.text;
  });
  writeFileSync(path, sanitizedLines.join("\n"), "utf8");
  return { path, found: true, maskedLines, detected: [...detected] };
}

function sanitizeJsonFile(path) {
  const detected = new Set();
  const stats = { fields: 0 };
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const sanitized = sanitizeJsonValue(value, detected, stats);
    if (stats.fields > 0) writeJsonAtomic(path, sanitized);
    return {
      path,
      found: true,
      maskedFields: stats.fields,
      detected: [...detected],
    };
  } catch {
    const fallback = sanitizeTextFile(path);
    return {
      path,
      found: fallback.found,
      maskedFields: fallback.maskedLines,
      detected: fallback.detected,
    };
  }
}

function sanitizeInboxJsonLogs() {
  const detected = new Set();
  let scannedFiles = 0;
  let maskedFiles = 0;
  let maskedFields = 0;
  for (const dir of [PENDING, APPLIED, FAILED]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const result = sanitizeJsonFile(join(dir, name));
      scannedFiles += 1;
      maskedFields += result.maskedFields;
      if (result.maskedFields > 0) maskedFiles += 1;
      for (const kind of result.detected) detected.add(kind);
    }
  }
  return {
    scannedFiles,
    maskedFiles,
    maskedFields,
    detected: [...detected],
  };
}

function purgeSessionLogs({ deleteSession = false } = {}) {
  const jsonLogs = sanitizeInboxJsonLogs();
  if (deleteSession) {
    let deleted = 0;
    if (existsSync(SESSION)) {
      unlinkSync(SESSION);
      deleted = 1;
    }
    return { session: { path: SESSION, deleted }, jsonLogs };
  }
  return { session: sanitizeTextFile(SESSION), jsonLogs };
}

async function telegramApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { ok: false, description: text };
  }
  if (!res.ok || !body.ok) {
    throw new Error(body.description || `${method} failed (${res.status})`);
  }
  return body.result;
}

function shouldRefreshWebhook(state) {
  if (!state.webhookDeletedAt) return true;
  const deletedAt = Date.parse(state.webhookDeletedAt);
  return (
    !Number.isFinite(deletedAt) || Date.now() - deletedAt > 6 * 60 * 60 * 1000
  );
}

async function ensurePollingMode(token, state) {
  if (!shouldRefreshWebhook(state)) return state;
  try {
    await telegramApi(token, "deleteWebhook", {});
    return { ...state, webhookDeletedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...state,
      webhookDeleteError:
        error instanceof Error ? error.message : String(error),
    };
  }
}

async function downloadTelegramPhoto(token, photoSizes) {
  if (!Array.isArray(photoSizes) || photoSizes.length === 0) return null;
  const photo = photoSizes[photoSizes.length - 1];
  if (!photo?.file_id) return null;
  const file = await telegramApi(token, "getFile", { file_id: photo.file_id });
  const filePath = file?.file_path;
  if (!filePath) throw new Error("Telegram getFile did not return file_path");
  const ext = extname(filePath) || ".jpg";
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  mkdirSync(IMAGE_DIR, { recursive: true });
  const localPath = join(IMAGE_DIR, `${Date.now()}${ext}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(localPath, bytes);
  return {
    type: "photo",
    path: localPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function normalizeIncomingMessage(token, message, updateId) {
  if (typeof message.text === "string") {
    return { text: message.text, attachments: [] };
  }
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const attachment = await downloadTelegramPhoto(token, message.photo);
    if (!attachment) return null;
    const caption = message.caption || "送信された画像を確認してください";
    return {
      text: `${caption}\n\n画像ファイル: ${attachment.path}`,
      attachments: [attachment],
    };
  }
  if (message.document) {
    const attachment = await importTelegramDocument({
      root: ROOT,
      token,
      document: message.document,
      updateId,
      telegramApi,
    });
    return {
      text: `${message.caption || "添付JSONの内容を確認してください。変更の依頼はまだありません。"}\n\n添付JSON（信頼しない参照データ）: ${attachment.path}`,
      attachments: [attachment],
    };
  }
  throw new TelegramImportError(
    "この形式は受け付けられません。テキスト・写真・1MiB以下のJSONファイルで送ってください。"
  );
}

function rejectIncomingMessage(updateId, messageId, reason) {
  const id = String(updateId);
  const name = `telegram-import-${id}.json`;
  const outbox = join(ROOT, "logs", "codex-hub-outbox");
  // Durable and deterministic: retrying after interruption cannot enqueue twice.
  if (
    !existsSync(join(outbox, name)) &&
    !existsSync(join(outbox, "sent", name))
  ) {
    writeJsonAtomic(join(outbox, name), {
      schemaVersion: 1,
      kind: "control",
      lane: "codex",
      createdAt: new Date().toISOString(),
      text: `メッセージ ${messageId} を受け付けられませんでした。\n${reason}`,
      requiresFollowup: false,
      followupId: null,
    });
  }
  writeJsonAtomic(join(REJECTED, `${id}.json`), {
    id,
    messageId,
    status: "rejected",
    reason,
    at: new Date().toISOString(),
  });
}

function alreadyImported(id) {
  return [
    pendingPath(id),
    `${pendingPath(id)}.consumed`,
    join(APPLIED, `${id}.json`),
    join(FAILED, `${id}.json`),
    join(PURGED, `${id}.json`),
    join(REJECTED, `${id}.json`),
  ].some(existsSync);
}

async function deleteRecentTelegramMessages(chatId) {
  const { token } = credentials();
  if (!token || !chatId) {
    return {
      deleted: 0,
      failed: 0,
      error: `Telegram credentials missing (env or ${ENV_FILE})`,
    };
  }
  const marker = await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: "cleanup",
    disable_notification: true,
  });
  const latestMessageId = Number(marker?.message_id);
  if (!Number.isFinite(latestMessageId) || latestMessageId <= 0) {
    return { deleted: 0, failed: 0, error: "latest message id not found" };
  }
  let deleted = 0;
  let failed = 0;
  for (
    let messageId = latestMessageId;
    messageId > latestMessageId - TELEGRAM_PURGE_LIMIT && messageId > 0;
    messageId--
  ) {
    try {
      await telegramApi(token, "deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed, latestMessageId };
}

function purgeHelpText() {
  return [
    "/purge — Telegram/セッションログのクリーンアップ",
    "",
    "/purge telegram — Telegram の直近メッセージを削除 (最大100件)",
    "/purge session — ディスク上の Telegram session ログを秘密情報マスク化",
    "/purge session delete — session.jsonl を削除し、inbox JSON は秘密情報マスク化",
    "/purge all — Telegram削除 + ディスクマスク (文脈はリセットしない)",
    "",
    "/new — 文脈を切って新しい session を開始",
  ].join("\n");
}

function startHelpText() {
  return [
    "Claude/Codex Remote (Telegram inbox)",
    "",
    "メッセージを送ると独立した Codex 受付が内容を確認します。",
    "セッション文脈は /new まで保持されます。",
    "",
    "タスク中の介入方法:",
    "- テキスト送信: フルラン中でも即時に受付・回答",
    "- /force <指示>: 指示を保存し、受付の起動を要求",
    "- /cancel: pending 指示をキャンセル",
    "",
    "コマンド:",
    "/status — 状態確認",
    "/retry <id> — 失敗した受付を再試行",
    "/force <指示> — 指示保存 + 受付起動要求",
    "/cancel — pending 指示をキャンセル",
    "/new — 新しいセッション",
    "/domains — 許可済みドメイン確認 / clear",
    "/purge — チャット履歴のクリーンアップ",
  ].join("\n");
}

function summarizePurgeSessionResult(result) {
  const lines = [];
  if (result.session.deleted !== undefined) {
    lines.push(`- session.jsonl deleted: ${result.session.deleted}`);
  } else if (result.session.found) {
    lines.push(`- session.jsonl masked lines: ${result.session.maskedLines}`);
  } else {
    lines.push("- session.jsonl: not found");
  }
  lines.push(
    `- inbox JSON masked: ${result.jsonLogs.maskedFields} fields in ${result.jsonLogs.maskedFiles}/${result.jsonLogs.scannedFiles} files`
  );
  const detected = new Set([
    ...(result.session.detected || []),
    ...(result.jsonLogs.detected || []),
  ]);
  if (detected.size > 0) {
    lines.push(`- detected: ${[...detected].join(", ")}`);
  }
  return lines;
}

function recordControl(item, extra = {}) {
  const applied = {
    ...item,
    status: "applied",
    appliedAt: new Date().toISOString(),
    ...extra,
  };
  writeJsonAtomic(join(APPLIED, `${item.id}.json`), applied);
  return applied;
}

function applyStartControlCommand(item) {
  const applied = recordControl(item, { action: "help" });
  report("control", startHelpText());
  return applied;
}

function applyNewControlCommand(item) {
  const { archivedPending, archivedSession, applied } = withInboxMutation(
    ROOT,
    () => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archiveRoot = join(PURGED, `${stamp}-${item.command}`);
      const archivedPending = archiveDirFiles(
        PENDING,
        join(archiveRoot, "pending")
      );
      const archivedSession = archiveFile(
        SESSION,
        archiveRoot,
        "session.jsonl"
      );
      const applied = recordControl(item, {
        archived: {
          pending: archivedPending,
          session: archivedSession,
          path: archiveRoot,
        },
      });
      appendSessionEvent({
        role: "system",
        kind: "control",
        command: "new",
        text: `${item.rawText} applied; previous context archived`,
      });
      return { archivedPending, archivedSession, applied };
    }
  );
  report(
    "control",
    [
      "Telegram control applied by Codex inbox",
      `- command: ${item.rawText}`,
      `- archived pending/session: ${archivedPending}/${archivedSession}`,
      "A new Telegram inbox session context is now active.",
    ].join("\n")
  );
  return applied;
}

function applyStatusControlCommand(item) {
  const pending = listPending().map((entry) => entry.item);
  const instructions = pending.filter((entry) => entry.kind === "instruction");
  const rulings = pending.filter((entry) => entry.kind === "ruling");
  const state = readJson(STATE, { offset: 0 });
  const sessionEvents = readSessionEvents();
  const domains = readDynamicDomains();
  const supervisorStatus = spawnSync(
    process.execPath,
    [
      join(SCRIPT_DIR, "supervisor-lock.mjs"),
      "status",
      "--lane",
      "supervisor",
      "--ttl",
      String(SUPERVISOR_LOCK_TTL_MIN),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    }
  );
  const applied = recordControl(item, {
    inboxStatus: {
      pending: pending.length,
      instructions: instructions.length,
      rulings: rulings.length,
      sessionEvents: sessionEvents.length,
      domains: domains.length,
      offset: state.offset || 0,
      supervisor:
        (supervisorStatus.stdout || supervisorStatus.stderr || "").trim() ||
        "unknown",
    },
  });
  report(
    "control",
    [
      "Telegram inbox status",
      `- pending: ${pending.length} (instructions ${instructions.length}, rulings ${rulings.length})`,
      `- session events: ${sessionEvents.length}`,
      `- dynamic domains: ${domains.length}`,
      `- update offset: ${state.offset || 0}`,
      `- supervisor: ${(supervisorStatus.stdout || supervisorStatus.stderr || "").trim() || "unknown"}`,
    ].join("\n")
  );
  return applied;
}

function cancelPendingItems() {
  return withInboxMutation(ROOT, () => {
    const canceled = [];
    for (const { path, item } of listPending()) {
      item.status = "canceled";
      item.canceledAt = new Date().toISOString();
      item.error = "canceled by Telegram /cancel";
      writeJsonAtomic(join(FAILED, `${item.id}.json`), item);
      renameSync(path, `${path}.consumed`);
      canceled.push(item);
    }
    return canceled;
  });
}

function applyCancelControlCommand(item) {
  const canceled = cancelPendingItems();
  appendSessionEvent({
    role: "system",
    kind: "control",
    command: "cancel",
    text: `${item.rawText} applied; canceled pending=${canceled.length}`,
  });
  const applied = recordControl(item, {
    canceled: {
      pending: canceled.length,
      ids: canceled.map((entry) => entry.id),
    },
  });
  report(
    "control",
    canceled.length > 0
      ? [
          "Telegram cancel applied by Codex inbox",
          `- canceled pending items: ${canceled.length}`,
          ...canceled.slice(0, 8).map((entry) => `- id=${entry.id}`),
        ].join("\n")
      : "Telegram cancel received, but no pending instruction/ruling was waiting."
  );
  return applied;
}

function applyDomainsControlCommand(item) {
  if (item.domainsAction === "clear") {
    clearDynamicDomains();
    const applied = recordControl(item, { domains: { action: "clear" } });
    report("control", "Dynamic Telegram WebFetch domains cleared.");
    return applied;
  }
  const domains = readDynamicDomains();
  const applied = recordControl(item, { domains: { action: "list", domains } });
  report(
    "control",
    domains.length === 0
      ? "No dynamic Telegram WebFetch domains are registered. Send a URL in chat to add one."
      : [
          `Dynamic Telegram WebFetch domains (${domains.length}):`,
          ...domains.map((domain) => `- ${domain}`),
          "",
          "/domains clear clears this list.",
        ].join("\n")
  );
  return applied;
}

function writePendingInstructionFromControl(item, text, extra = {}) {
  const id = `${item.id}-${extra.priority === "force" ? "force" : "instruction"}`;
  const pending = {
    schemaVersion: 1,
    id,
    updateId: item.updateId,
    messageId: item.messageId,
    chatId: item.chatId,
    receivedAt: item.receivedAt || new Date().toISOString(),
    from: item.from,
    rawText: text,
    kind: "instruction",
    text,
    risk: instructionRisk(text),
    status: "pending",
    ...extra,
  };
  writeJsonAtomic(pendingPath(id), pending);
  appendSessionEvent({
    role: "user",
    id,
    messageId: item.messageId,
    kind: "instruction",
    text,
  });
  return pending;
}

function applyForceControlCommand(item) {
  const reason = (item.forceText || "").trim();
  if (!reason) {
    const applied = recordControl(item, { force: { action: "help" } });
    report(
      "control",
      "Usage: /force <new instruction>\nExample: /force git statusだけ確認して"
    );
    return applied;
  }
  const pending = writePendingInstructionFromControl(item, reason, {
    priority: "force",
    forcedAt: new Date().toISOString(),
  });
  const supervisorRun = requestReceptionRun();
  const applied = recordControl(item, {
    force: { pendingId: pending.id, supervisorRun },
  });
  report(
    "control",
    [
      "Telegram force instruction queued for Codex",
      `- id=${pending.id}: ${reason}`,
      `- reception run requested: ${supervisorRun.requested ? "yes" : "no"}`,
      supervisorRun.skipped
        ? `- reception run skipped: ${supervisorRun.skipReason || "yes"}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")
  );
  return applied;
}

async function applyPurgeControlCommand(item) {
  const arg = item.purgeArg || "";
  if (!arg || arg === "help") {
    const applied = recordControl(item, { purge: { arg, action: "help" } });
    report("control", purgeHelpText());
    return applied;
  }
  const valid =
    arg === "telegram" ||
    arg === "session" ||
    arg === "session delete" ||
    arg === "all";
  if (!valid) {
    const applied = recordControl(item, { purge: { arg, action: "invalid" } });
    report(
      "control",
      [`Unknown purge target: ${arg}`, "", purgeHelpText()].join("\n")
    );
    return applied;
  }

  const doTelegram = arg === "telegram" || arg === "all";
  const doSession = arg.startsWith("session") || arg === "all";
  const doDelete = arg === "session delete";
  const purge = { arg };
  const lines = ["Telegram cleanup completed by Codex inbox"];

  if (doTelegram) {
    try {
      purge.telegram = await deleteRecentTelegramMessages(
        item.chatId || credentials().chatId
      );
      lines.push(
        `- Telegram deleted: ${purge.telegram.deleted} (${purge.telegram.failed} not deletable)`
      );
    } catch (error) {
      purge.telegram = {
        deleted: 0,
        failed: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      lines.push(`- Telegram error: ${purge.telegram.error}`);
    }
  }

  if (doSession) {
    purge.session = purgeSessionLogs({ deleteSession: doDelete });
    lines.push(...summarizePurgeSessionResult(purge.session));
  }

  const applied = recordControl(item, { purge });
  if (!doDelete) {
    appendSessionEvent({
      role: "system",
      kind: "control",
      command: "purge",
      text: `${item.rawText} applied; security cleanup completed`,
    });
  }
  report("control", lines.join("\n"));
  return applied;
}

async function applyControlCommand(item) {
  if (item.command === "retry")
    return recordControl(item, { retry: retryReception(item.retryId) });
  if (item.command === "start") return applyStartControlCommand(item);
  if (item.command === "new") return applyNewControlCommand(item);
  if (item.command === "status") return applyStatusControlCommand(item);
  if (item.command === "cancel") return applyCancelControlCommand(item);
  if (item.command === "domains") return applyDomainsControlCommand(item);
  if (item.command === "force") return applyForceControlCommand(item);
  if (item.command === "purge") return applyPurgeControlCommand(item);
  throw new Error(`unknown control command: ${item.command}`);
}

function report(kind, text) {
  spawnSync(process.execPath, [REPORT, "--kind", kind, "--stdin"], {
    cwd: ROOT,
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
  });
}

async function poll(options) {
  ensureDirs();
  const { token, chatId } = credentials();
  if (!token || !chatId) {
    const error = `Telegram credentials missing (env or ${ENV_FILE})`;
    if (options.strict) throw new Error(error);
    return { status: "skipped", error, received: 0 };
  }
  let state = readJson(STATE, { offset: 0 });
  state = await ensurePollingMode(token, state);
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  if (state.offset) url.searchParams.set("offset", String(state.offset));
  const timeout = Number.isFinite(options.timeout)
    ? Math.max(0, Math.min(50, Math.trunc(options.timeout)))
    : 0;
  url.searchParams.set("timeout", String(timeout));
  url.searchParams.set("limit", String(options.max));
  url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
  const res = await fetch(url);
  const body = await res.json();
  if (!body.ok) throw new Error(JSON.stringify(body));
  let received = 0;
  let nextOffset = state.offset || 0;
  if (!state.initialized && !state.offset && (body.result || []).length > 0) {
    for (const update of body.result || []) {
      nextOffset = Math.max(nextOffset, update.update_id + 1);
    }
    writeJsonAtomic(STATE, {
      ...state,
      initialized: true,
      offset: nextOffset,
      updatedAt: new Date().toISOString(),
      skippedExisting: body.result.length,
    });
    return {
      status: "ok",
      received: 0,
      offset: nextOffset,
      skippedExisting: body.result.length,
    };
  }
  for (const update of body.result || []) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0)
      continue;
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const message = update.message || update.edited_message;
    if (!message) continue;
    if (String(message.chat?.id) !== String(chatId)) continue;
    if (message.from?.is_bot) continue;
    const id = `${update.update_id}`;
    if (alreadyImported(id)) continue;
    let incoming;
    try {
      incoming = await normalizeIncomingMessage(
        token,
        message,
        update.update_id
      );
    } catch (error) {
      rejectIncomingMessage(
        update.update_id,
        message.message_id,
        error instanceof TelegramImportError
          ? error.message
          : "添付ファイルを取得できませんでした。少し待って再送してください。"
      );
      continue;
    }
    if (!incoming?.text) continue;
    const { text, attachments } = incoming;
    const hasDocument = attachments.some(
      (attachment) => attachment.type === "document"
    );
    if (message.from?.is_bot || (!hasDocument && isRelayEchoText(text)))
      continue;
    const target = pendingPath(id);
    if (existsSync(target)) continue;
    const addedDomains = hasDocument ? [] : extractAndRegisterDomains(text);
    if (addedDomains.length > 0) {
      report(
        "control",
        `Dynamic Telegram WebFetch domains added: ${addedDomains.join(", ")}`
      );
    }
    // Attachment captions cannot invoke operational /stop, /purge or /ruling commands.
    const classified = hasDocument
      ? {
          kind: "instruction",
          text,
          risk: instructionRisk(message.caption || ""),
        }
      : classifyText(text);
    if (classified.kind === "control") {
      await applyControlCommand({
        schemaVersion: 1,
        id,
        updateId: update.update_id,
        messageId: message.message_id,
        chatId: message.chat?.id ?? null,
        receivedAt: new Date().toISOString(),
        from: {
          id: message.from?.id ?? null,
          isBot: message.from?.is_bot ?? false,
          username: message.from?.username ?? null,
          firstName: message.from?.first_name ?? null,
        },
        rawText: text,
        attachments,
        ...classified,
      });
      received += 1;
      continue;
    }
    appendSessionEvent({
      role: "user",
      id,
      messageId: message.message_id,
      kind: classified.kind,
      text,
      attachments,
    });
    writeJsonAtomic(target, {
      schemaVersion: 1,
      id,
      updateId: update.update_id,
      messageId: message.message_id,
      chatId: message.chat?.id ?? null,
      receivedAt: new Date().toISOString(),
      from: {
        id: message.from?.id ?? null,
        isBot: message.from?.is_bot ?? false,
        username: message.from?.username ?? null,
        firstName: message.from?.first_name ?? null,
      },
      rawText: text,
      attachments,
      ...classified,
      status: "pending",
    });

    received += 1;
  }
  writeJsonAtomic(STATE, {
    ...state,
    initialized: true,
    offset: nextOffset,
    updatedAt: new Date().toISOString(),
    importerVersion: TELEGRAM_IMPORT_VERSION,
  });
  const reception = requestReceptionRun();
  return {
    status: "ok",
    received,
    offset: nextOffset,
    reception,
    importerVersion: TELEGRAM_IMPORT_VERSION,
  };
}

export function requestReceptionRun() {
  if (process.env.ORICA_TELEGRAM_AUTORUN === "0")
    return { requested: false, skipped: true, skipReason: "disabled" };
  const p = receptionPaths(ROOT);
  if (!pendingTelegramMessages().some((item) => eligible(item, p)))
    return {
      requested: false,
      skipped: true,
      skipReason: "no-eligible-message",
    };
  const lock = spawnSync(
    process.execPath,
    [
      join(SCRIPT_DIR, "supervisor-lock.mjs"),
      "status",
      "--lane",
      "telegram-reception",
      "--ttl",
      "5",
    ],
    {
      env: { ...process.env, ORICA_SUPERVISOR_LOCK: p.lock },
      encoding: "utf8",
      windowsHide: true,
    }
  );
  if (lock.status !== 0)
    return {
      requested: false,
      skipped: true,
      skipReason:
        lock.status === 1 ? "reception-running" : "reception-lock-error",
    };
  mkdirSync(INBOX, { recursive: true });
  const fd = openSync(join(INBOX, "reception.log"), "a");
  try {
    const child = spawn(
      process.execPath,
      [join(SCRIPT_DIR, "telegram-message-worker.mjs"), "drain"],
      {
        cwd: ROOT,
        env: { ...process.env, ORICA_TELEGRAM_REPO: ROOT },
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      }
    );
    child.on("error", (error) =>
      appendFileSync(join(INBOX, "reception.log"), error.message + "\n")
    );
    child.unref();
    return { requested: true, pid: child.pid };
  } finally {
    closeSync(fd);
  }
}

// Compatibility command: explicit /ruling and natural replies use the same reception pipeline.
function applyRulings() {
  return requestReceptionRun();
}

function quarantineRiskyInstructions() {
  const blocked = [];
  for (const { path, item } of listPending()) {
    const risk = item.risk || instructionRisk(item.text || item.rawText || "");
    if (item.kind !== "instruction" || risk !== "high") continue;
    item.risk = risk;
    item.status = "blocked";
    item.blockedAt = new Date().toISOString();
    item.error =
      "destructive or broad Telegram instruction requires local confirmation";
    writeJsonAtomic(join(FAILED, `${item.id}.json`), item);
    renameSync(path, `${path}.consumed`);
    appendSessionEvent({
      role: "system",
      kind: "blocked",
      id: item.id,
      text: item.rawText,
      note: item.error,
    });
    blocked.push(item);
  }
  if (blocked.length > 0) {
    report(
      "error",
      [
        "Telegram instruction blocked by Codex inbox safety gate",
        ...blocked.map((item) => `- id=${item.id}: ${item.rawText}`),
        "Re-send a narrow, explicit instruction if this was intentional.",
      ].join("\n")
    );
  }
  return { blocked: blocked.length };
}

function formatSessionContext(events) {
  if (events.length === 0) return "";
  const lines = ["Telegram session context (since /new):"];
  for (const event of events) {
    const at = event.at ? String(event.at) : "";
    if (event.role === "user") {
      lines.push(
        `- ${at} user(${event.kind || "message"} id=${event.id}): ${event.text || ""}`
      );
    } else if (event.role === "codex") {
      lines.push(
        `- ${at} codex(${event.kind || "note"} id=${event.id || "-"}): ${event.text || event.note || ""}`
      );
    } else {
      lines.push(
        `- ${at} system(${event.kind || "event"} id=${event.id || "-"}): ${event.text || event.note || ""}`
      );
    }
  }
  const text = lines.join("\n");
  if (text.length <= SESSION_CONTEXT_MAX_CHARS) return text;
  return [
    `Telegram session context (older entries omitted; showing last ${SESSION_CONTEXT_MAX_CHARS} chars):`,
    text.slice(-SESSION_CONTEXT_MAX_CHARS),
  ].join("\n");
}

function retryReception(id) {
  withInboxMutation(ROOT, () => {
    if (!validInboxId(id) || !existsSync(pendingPath(id)))
      throw new Error("pending inbox id required");
    // Preserve the old attempt until its actual model has been recovered.
    // Otherwise /retry could erase the only evidence that this is not a new job.
    pinReceptionProfile(ROOT, readJson(pendingPath(id), null));
    const attempt = join(receptionPaths(ROOT).attempts, id + ".json");
    if (existsSync(attempt)) unlinkSync(attempt);
  });
  return { id, reception: requestReceptionRun() };
}

export function pendingTelegramMessages() {
  return listPending().map((entry) => entry.item);
}
export function telegramSessionContext() {
  return formatSessionContext(readSessionEvents());
}
function summary() {
  const pending = pendingTelegramMessages();
  return pending.length === 0
    ? "(Telegram pending instruction/ruling なし)"
    : "Telegram受付エージェントが独立処理中: " +
        pending.length +
        "件。ここで重複実行せず、受付済みの変更要求はdurable follow-upを確認する。";
}

export function resolveInstruction(options) {
  if (!options.id) throw new Error("--id required");
  const path = pendingPath(options.id);
  if (!existsSync(path))
    throw new Error(`pending message not found: ${options.id}`);
  const item = readJson(path, null);
  item.status = "applied";
  item.appliedAt = new Date().toISOString();
  if (options.note) item.appliedNote = options.note;
  writeJsonAtomic(join(APPLIED, `${item.id}.json`), item);
  renameSync(path, `${path}.consumed`);
  appendSessionEvent({
    role: "codex",
    kind: "resolved",
    id: item.id,
    text: options.note || "handled",
  });
  return { resolved: options.id };
}

export async function runTelegramInboxCli(
  argv = process.argv.slice(2),
  { quiet = false } = {}
) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  let result;
  switch (options.command) {
    case "poll":
      result = await poll(options);
      break;
    case "apply-rulings":
      result = applyRulings();
      break;
    case "quarantine-risky":
      result = quarantineRiskyInstructions();
      break;
    case "summary":
      result = { text: summary() };
      break;
    case "retry":
      result = retryReception(options.id);
      break;
    case "resolve":
      result = withInboxMutation(ROOT, () => resolveInstruction(options));
      break;
    default:
      throw new Error(`unknown command: ${options.command}`);
  }
  if (quiet) return result;
  if (options.json) console.log(JSON.stringify(result));
  else if (typeof result?.text === "string") console.log(result.text);
  else console.log(JSON.stringify(result));
}

function isDirectExecution() {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(entry).href : false;
}

if (isDirectExecution()) {
  runTelegramInboxCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
