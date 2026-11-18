import { describe, expect, it, vi } from "vitest";
import type { ChatRequest, ChatResponse } from "ollama";
import { runAgent } from "../src/agent";
import { OllamaClient } from "../src/client";
import { getModelProfile } from "../src/models";
import { loadConfig } from "../src/config";

interface CaptureCall {
  request: ChatRequest;
}

function makeCapturingClient(captured: CaptureCall[]): OllamaClient {
  const client = new OllamaClient();
  (
    client as unknown as {
      chatStream: (req: ChatRequest) => Promise<AsyncIterable<ChatResponse>>;
    }
  ).chatStream = vi.fn(async (req: ChatRequest) => {
    // 参照ではなくスナップショットを取る (agent 側が後から messages を mutate するため)
    captured.push({
      request: { ...req, messages: [...req.messages] },
    });
    async function* gen(): AsyncGenerator<ChatResponse> {
      yield {
        model: req.model,
        created_at: new Date(),
        message: { role: "assistant", content: "ok" },
        done: true,
        done_reason: "stop",
        total_duration: 0,
        load_duration: 0,
        prompt_eval_count: 0,
        prompt_eval_duration: 0,
        eval_count: 0,
        eval_duration: 0,
      } as ChatResponse;
    }
    return gen();
  });
  return client;
}

const baseInput = {
  skipProjectContext: true,
  skipAutoContext: true,
  skipHooks: true,
} as const;

describe("vision routing", () => {
  it("config defaults include vision model and tools are allowed by default", () => {
    const prev = process.env.ORICA_AI_VISION_DISABLE_TOOLS;
    delete process.env.ORICA_AI_VISION_DISABLE_TOOLS;
    try {
      const config = loadConfig({});
      expect(config.visionModel).toBe("qwen2.5vl:7b");
      const profile = getModelProfile("vision", config);
      expect(profile.supportsVision).toBe(true);
      // 既定では vision でも tools 有効。ORICA_AI_VISION_DISABLE_TOOLS=true で無効化可。
      expect(profile.supportsTools).toBe(true);
    } finally {
      if (prev !== undefined) process.env.ORICA_AI_VISION_DISABLE_TOOLS = prev;
    }
  });

  it("ORICA_AI_VISION_DISABLE_TOOLS=true disables vision tools", () => {
    const prev = process.env.ORICA_AI_VISION_DISABLE_TOOLS;
    process.env.ORICA_AI_VISION_DISABLE_TOOLS = "true";
    try {
      const profile = getModelProfile("vision", loadConfig({}));
      expect(profile.supportsTools).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.ORICA_AI_VISION_DISABLE_TOOLS;
      else process.env.ORICA_AI_VISION_DISABLE_TOOLS = prev;
    }
  });

  it("respects ORICA_AI_MODEL_VISION override", () => {
    const config = loadConfig({ ORICA_AI_MODEL_VISION: "minicpm-v:8b" });
    expect(config.visionModel).toBe("minicpm-v:8b");
  });

  it("uses flagship model and tools when no images", async () => {
    const captured: CaptureCall[] = [];
    const client = makeCapturingClient(captured);
    await runAgent({
      ...baseInput,
      task: "hello",
      client,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.request.model).toBe("qwen3:14b");
    expect(Array.isArray(captured[0]?.request.tools)).toBe(true);
  });

  it("switches to vision model and keeps tools enabled when images present (default)", async () => {
    const captured: CaptureCall[] = [];
    const client = makeCapturingClient(captured);
    await runAgent({
      ...baseInput,
      task: "what is this",
      client,
      images: ["FAKE_BASE64=="],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.request.model).toBe("qwen2.5vl:7b");
    // vision でも tool 注入は維持される (model.supportsTools=true がデフォルト)
    expect(Array.isArray(captured[0]?.request.tools)).toBe(true);
    const lastMsg = captured[0]?.request.messages.at(-1);
    expect(lastMsg?.role).toBe("user");
    expect(lastMsg?.images).toEqual(["FAKE_BASE64=="]);
  });
});
