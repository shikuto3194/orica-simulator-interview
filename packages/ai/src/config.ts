export interface AiConfig {
  baseUrl: string;
  flagshipModel: string;
  fastModel: string;
  coderModel: string;
  embedModel: string;
  visionModel: string;
  defaultTimeoutMs: number;
  maxAgentSteps: number;
}

const DEFAULTS: AiConfig = {
  baseUrl: "http://localhost:11434",
  flagshipModel: "qwen3:14b",
  fastModel: "qwen3:14b",
  coderModel: "qwen2.5-coder:14b",
  embedModel: "bge-m3",
  visionModel: "qwen2.5vl:7b",
  defaultTimeoutMs: 120_000,
  maxAgentSteps: 12,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    baseUrl: env.ORICA_AI_BASE_URL ?? DEFAULTS.baseUrl,
    flagshipModel: env.ORICA_AI_MODEL_FLAGSHIP ?? DEFAULTS.flagshipModel,
    fastModel: env.ORICA_AI_MODEL_FAST ?? DEFAULTS.fastModel,
    coderModel: env.ORICA_AI_MODEL_CODER ?? DEFAULTS.coderModel,
    embedModel: env.ORICA_AI_MODEL_EMBED ?? DEFAULTS.embedModel,
    visionModel: env.ORICA_AI_MODEL_VISION ?? DEFAULTS.visionModel,
    defaultTimeoutMs: numOrDefault(
      env.ORICA_AI_TIMEOUT_MS,
      DEFAULTS.defaultTimeoutMs
    ),
    maxAgentSteps: numOrDefault(
      env.ORICA_AI_MAX_AGENT_STEPS,
      DEFAULTS.maxAgentSteps
    ),
  };
}

function numOrDefault(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
