import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { getModelProfile } from "../src/models";

describe("loadConfig", () => {
  it("returns defaults when no env vars set", () => {
    const config = loadConfig({});
    expect(config.baseUrl).toBe("http://localhost:11434");
    expect(config.flagshipModel).toBe("qwen3:14b");
    expect(config.coderModel).toBe("qwen2.5-coder:14b");
    expect(config.embedModel).toBe("bge-m3");
    expect(config.maxAgentSteps).toBe(12);
  });

  it("respects ORICA_AI_* overrides", () => {
    const config = loadConfig({
      ORICA_AI_BASE_URL: "http://example:9999",
      ORICA_AI_MODEL_FLAGSHIP: "qwen3:30b-a3b",
      ORICA_AI_MAX_AGENT_STEPS: "20",
    });
    expect(config.baseUrl).toBe("http://example:9999");
    expect(config.flagshipModel).toBe("qwen3:30b-a3b");
    expect(config.maxAgentSteps).toBe(20);
  });

  it("falls back to default for invalid numeric env", () => {
    const config = loadConfig({ ORICA_AI_TIMEOUT_MS: "not-a-number" });
    expect(config.defaultTimeoutMs).toBe(120_000);
  });
});

describe("getModelProfile", () => {
  it("returns flagship profile with tools support", () => {
    const profile = getModelProfile("flagship", loadConfig({}));
    expect(profile.role).toBe("flagship");
    expect(profile.supportsTools).toBe(true);
    expect(profile.supportsJsonFormat).toBe(true);
  });

  it("returns embed profile without tools", () => {
    const profile = getModelProfile("embed", loadConfig({}));
    expect(profile.role).toBe("embed");
    expect(profile.supportsTools).toBe(false);
  });
});
