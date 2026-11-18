#!/usr/bin/env node
import { OllamaClient } from "../client.js";
import { getModelProfile } from "../models.js";
import type { ModelRole } from "../models.js";
import { loadConfig } from "../config.js";

async function checkVisionCapabilities(
  client: OllamaClient,
  installed: string[]
): Promise<void> {
  const config = client.config;
  const profile = getModelProfile("vision", config);
  const baseTag = profile.tag.split(":")[0] ?? "";
  if (!installed.some((m) => m.startsWith(baseTag))) {
    console.warn(
      `[smoke] Vision: ${profile.tag} not pulled. Skipping capability check.`
    );
    return;
  }
  const caps = await client.showModelCapabilities(profile.tag);
  console.warn(
    `[smoke] Vision (${profile.tag}) capabilities: ${caps.join(", ") || "(unknown)"}`
  );
  if (caps.length === 0) {
    console.warn(
      `[smoke] ⚠ Vision capabilities are empty. Ollama may be older, or model manifest lacks "capabilities".`
    );
    return;
  }
  if (!caps.includes("vision")) {
    console.warn(
      `[smoke] ⚠ Vision: profile says supportsVision but manifest lacks "vision" capability.`
    );
  }
  if (profile.supportsTools && !caps.includes("tools")) {
    console.warn(
      `[smoke] ⚠ Vision: profile says supportsTools=true but manifest lacks "tools" capability.\n` +
        `       Ollama will reject tool calls for this model with "<model> does not support tools".\n` +
        `       Either set ORICA_AI_VISION_DISABLE_TOOLS=true, or switch to a vision model with tools capability.`
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new OllamaClient(config);
  const ok = await client.ping();
  if (!ok) {
    console.error(`[smoke] Ollama に接続できません (${config.baseUrl})`);
    process.exit(2);
  }
  const installed = await client.listModels();
  console.warn(`[smoke] Ollama OK at ${config.baseUrl}`);
  console.warn(`[smoke] Installed models: ${installed.join(", ") || "(none)"}`);

  const role: ModelRole = "fast";
  const profile = getModelProfile(role, config);
  const baseTag = profile.tag.split(":")[0] ?? "";
  if (!installed.some((m) => m.startsWith(baseTag))) {
    console.warn(`[smoke] Skipping chat: ${profile.tag} not pulled.`);
    await checkVisionCapabilities(client, installed);
    return;
  }

  const reply = await client.chat({
    model: profile.tag,
    messages: [
      {
        role: "user",
        content:
          "あなたが現在動いているローカルモデル名を 1 行で答えてください。余分な説明は不要。",
      },
    ],
    temperature: 0,
  });
  console.warn(`[smoke] Reply: ${reply.message.content?.trim()}`);

  await checkVisionCapabilities(client, installed);
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
