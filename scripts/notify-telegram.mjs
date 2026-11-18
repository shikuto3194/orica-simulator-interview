#!/usr/bin/env node
/**
 * notify-telegram — フルラン無人ループの進捗/裁定質問/完了を Telegram へ push する。
 *
 * 認証情報は Claude-Code-Remote の .env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) を流用。
 * 環境変数が既にあればそちらを優先。リポジトリには秘密情報を置かない。
 *
 * Usage:
 *   node scripts/notify-telegram.mjs "メッセージ"
 *   echo "長文" | node scripts/notify-telegram.mjs --stdin
 *   node scripts/notify-telegram.mjs --strict "..."   # 送信失敗で exit 1 (既定は exit 0)
 *
 * 既定で送信失敗でも exit 0: 通知不達で無人ループ全体を止めないため。
 */

/* global fetch */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizeOutput } from "./telegram-secret-sanitize.mjs";

const ENV_FILE = join(
  process.env.USERPROFILE || process.env.HOME || "",
  "Claude-Code-Remote",
  ".env"
);

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const USE_STDIN = args.includes("--stdin");
const JSON_OUTPUT = args.includes("--json");

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

const EDIT_MESSAGE_ID = argValue("--edit-message-id");
const positional = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--edit-message-id") {
    i += 1;
    continue;
  }
  if (arg.startsWith("--")) continue;
  positional.push(arg);
}

async function main() {
  const dotenv = loadDotEnv(ENV_FILE);
  const token = process.env.TELEGRAM_BOT_TOKEN || dotenv.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || dotenv.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error(
      `[notify-telegram] 認証情報が見つからない (env または ${ENV_FILE})`
    );
    process.exit(STRICT ? 1 : 0);
  }

  let text = positional.join(" ");
  if (USE_STDIN) {
    text = readFileSync(0, "utf8");
  }
  if (!text.trim()) {
    console.error("[notify-telegram] メッセージが空");
    process.exit(STRICT ? 1 : 0);
  }
  const sanitized = sanitizeOutput(text.trim());
  text = sanitized.text;
  if (sanitized.detected.length > 0) {
    text = `⚠️ 秘密情報を検出しマスクしました: ${sanitized.detected.join(", ")}\n\n${text}`;
  }
  // Telegram の上限 4096 文字。超過は分割せず末尾を切る（通知用途のため）
  if (text.length > 4000) text = text.slice(0, 4000) + "\n…(truncated)";

  try {
    const method = EDIT_MESSAGE_ID ? "editMessageText" : "sendMessage";
    const payload = EDIT_MESSAGE_ID
      ? { chat_id: chatId, message_id: Number(EDIT_MESSAGE_ID), text }
      : { chat_id: chatId, text };
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (
      !body.ok &&
      EDIT_MESSAGE_ID &&
      /message is not modified/i.test(body.description || "")
    ) {
      if (JSON_OUTPUT)
        console.log(
          JSON.stringify({
            ok: true,
            messageId: Number(EDIT_MESSAGE_ID),
            method,
          })
        );
      process.exit(0);
    }
    if (!body.ok) {
      if (JSON_OUTPUT)
        console.log(
          JSON.stringify({
            ok: false,
            canSendNew: Boolean(
              EDIT_MESSAGE_ID &&
              /message to edit not found/i.test(body.description || "")
            ),
          })
        );
      throw new Error(JSON.stringify(body));
    }
    const messageId = body.result?.message_id || Number(EDIT_MESSAGE_ID);
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ ok: true, messageId, method }));
    } else {
      console.log(`[notify-telegram] ${EDIT_MESSAGE_ID ? "edited" : "sent"}`);
    }
    process.exit(0);
  } catch (e) {
    console.error(`[notify-telegram] 送信失敗: ${e.message}`);
    process.exit(STRICT ? 1 : 0);
  }
}

main();
