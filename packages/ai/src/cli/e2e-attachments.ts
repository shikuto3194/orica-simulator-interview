#!/usr/bin/env node
/**
 * `pnpm ai:e2e:attachments` — 任意ファイル添付 → プロンプト埋め込みの実 LLM 疎通確認。
 *
 * Ollama が動いていることが前提。動いていなければ skip 扱い (exit 0)。
 * - text-like (md) 添付 → LLM が内容を要約できるか
 * - unsupported (zip) 添付 → notice/skip 動作が classifier で発生するか (LLM 不要)
 *
 * web-smoke 同様、layout 変化 / 仕様変更を素早く検知することが目的。
 */
import { OllamaClient } from "../client.js";
import { loadConfig } from "../config.js";
import { getModelProfile } from "../models.js";
import { runAgent } from "../agent.js";
import {
  buildAgentInputs,
  classifyAttachment,
  type RawAttachment,
} from "../server/attachments.js";

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

async function classifierUnsupported(): Promise<Result> {
  const att: RawAttachment = {
    name: "archive.zip",
    mimeType: "application/zip",
    base64: b64("PK"),
  };
  const classified = classifyAttachment(att);
  if (classified.kind !== "unsupported") {
    return {
      name: "classifier (unsupported zip)",
      ok: false,
      detail: `expected kind=unsupported, got ${classified.kind}`,
    };
  }
  return {
    name: "classifier (unsupported zip)",
    ok: true,
    detail: classified.reason,
  };
}

async function classifierText(): Promise<Result> {
  const att: RawAttachment = {
    name: "card-note.md",
    mimeType: "text/markdown",
    base64: b64("# 仕様メモ\n\nbatspi の API は HTTP GET。"),
  };
  const classified = classifyAttachment(att);
  if (classified.kind !== "text") {
    return {
      name: "classifier (markdown)",
      ok: false,
      detail: `expected kind=text, got ${classified.kind}`,
    };
  }
  if (!classified.text.includes("batspi")) {
    return {
      name: "classifier (markdown)",
      ok: false,
      detail: "text content lost during classification",
    };
  }
  return {
    name: "classifier (markdown)",
    ok: true,
    detail: `text=${classified.text.length} chars`,
  };
}

async function llmRoundTrip(): Promise<Result> {
  const config = loadConfig();
  const client = new OllamaClient(config);
  const reachable = await client.ping();
  if (!reachable) {
    return {
      name: "LLM roundtrip",
      ok: true,
      detail: `Ollama unreachable (${config.baseUrl}) — skipped`,
    };
  }
  const installed = await client.listModels();
  const profile = getModelProfile("fast", config);
  const baseTag = profile.tag.split(":")[0] ?? "";
  if (!installed.some((m) => m.startsWith(baseTag))) {
    return {
      name: "LLM roundtrip",
      ok: true,
      detail: `${profile.tag} not pulled — skipped`,
    };
  }
  const note = "secret-token-9f2c1: 添付経由で LLM に渡るかの sentinel";
  const att: RawAttachment = {
    name: "note.txt",
    mimeType: "text/plain",
    base64: b64(note),
  };
  const classified = classifyAttachment(att);
  const { task } = buildAgentInputs(
    "添付ファイル `note.txt` の中身にある sentinel 文字列をそのまま 1 行で答えて。",
    [classified]
  );
  const result = await runAgent({
    task,
    skipProjectContext: true,
    skipAutoContext: true,
    skipHooks: true,
    role: "fast",
  });
  if (!result.output.includes("secret-token-9f2c1")) {
    return {
      name: "LLM roundtrip",
      ok: false,
      detail: `attachment content was not echoed by LLM. output preview: ${result.output.slice(0, 200)}`,
    };
  }
  return {
    name: "LLM roundtrip",
    ok: true,
    detail: `LLM echoed sentinel through attachment in ${result.steps} step(s)`,
  };
}

async function main(): Promise<void> {
  console.warn("[e2e:attachments] running attachment pipeline checks");
  const results = await Promise.all([
    classifierUnsupported(),
    classifierText(),
    llmRoundTrip(),
  ]);
  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? "[ OK ]" : "[FAIL]";
    console.warn(`${tag} ${r.name}: ${r.detail}`);
    if (!r.ok) failed++;
  }
  if (failed > 0) {
    console.warn(`[e2e:attachments] ${failed} check(s) failed.`);
    process.exit(1);
  }
  console.warn("[e2e:attachments] all checks passed.");
}

main().catch((err) => {
  console.error("[e2e:attachments] unexpected failure:", err);
  process.exit(2);
});
