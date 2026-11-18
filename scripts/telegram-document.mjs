/* global fetch, AbortSignal */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const TELEGRAM_IMPORT_VERSION = "json-document-v1";
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

export class TelegramImportError extends Error {}

export async function importTelegramDocument({
  root,
  token,
  document,
  updateId,
  telegramApi,
}) {
  const reject = (reason) => {
    throw new TelegramImportError(reason);
  };
  if (!Number.isSafeInteger(updateId) || updateId < 0)
    reject("受信IDを確認できませんでした。ファイルを再送してください。");
  if (
    typeof document.file_name !== "string" ||
    !/\.json$/i.test(document.file_name) ||
    (document.mime_type &&
      ![
        "application/json",
        "text/json",
        "text/plain",
        "application/octet-stream",
      ].includes(document.mime_type.toLowerCase()))
  )
    reject(
      "ファイル添付はJSON（.json）のみ対応しています。JSONで送るか、内容をテキストで送ってください。"
    );
  const checkSize = (size) => {
    if (
      size !== undefined &&
      (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOCUMENT_BYTES)
    )
      reject("JSONファイルは1MiB以下で送ってください。");
  };
  checkSize(document.file_size);
  if (!document.file_id)
    reject("ファイルを取得できませんでした。ファイルを再送してください。");
  let data;
  try {
    const file = await telegramApi(token, "getFile", {
      file_id: document.file_id,
    });
    checkSize(file?.file_size);
    // Only Telegram-relative paths; never use remote names as local paths.
    const remote = file?.file_path;
    if (
      typeof remote !== "string" ||
      !/^[A-Za-z0-9_./-]+$/.test(remote) ||
      remote.startsWith("/") ||
      remote.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("invalid remote file path");
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${remote}`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!response.ok || !response.body) throw new Error("download failed");
    const declared = response.headers.get("content-length");
    if (declared !== null) checkSize(Number(declared));
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      checkSize(bytes);
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof TelegramImportError) throw error;
    // fetch errors may contain token-bearing URLs. Never persist their text.
    reject(
      "ファイルを取得できませんでした。少し待ってファイルを再送してください。"
    );
  }
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(data)
    );
    if (value === null || typeof value !== "object")
      throw new Error("not structured JSON");
  } catch {
    reject(
      "JSONを読み取れませんでした。UTF-8のJSONオブジェクトまたは配列を送ってください。"
    );
  }
  const dir = join(root, ".codex-remote-attachments", "telegram");
  const path = join(dir, `${updateId}.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.tmp`, data);
    renameSync(`${path}.tmp`, path);
  } catch {
    reject(
      "ファイルを保存できませんでした。少し待ってファイルを再送してください。"
    );
  }
  return {
    type: "document",
    format: "json",
    path,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    untrusted: true,
  };
}
