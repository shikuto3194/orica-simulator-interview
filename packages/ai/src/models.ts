import type { AiConfig } from "./config.js";

export type ModelRole = "flagship" | "fast" | "coder" | "embed" | "vision";

export interface ModelProfile {
  role: ModelRole;
  tag: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsJsonFormat: boolean;
  /** 画像入力対応か */
  supportsVision: boolean;
}

export function getModelProfile(
  role: ModelRole,
  config: AiConfig
): ModelProfile {
  switch (role) {
    case "flagship":
      return {
        role,
        tag: config.flagshipModel,
        contextWindow: 32_768,
        supportsTools: true,
        supportsJsonFormat: true,
        supportsVision: false,
      };
    case "fast":
      return {
        role,
        tag: config.fastModel,
        contextWindow: 32_768,
        supportsTools: true,
        supportsJsonFormat: true,
        supportsVision: false,
      };
    case "coder":
      return {
        role,
        tag: config.coderModel,
        contextWindow: 32_768,
        supportsTools: true,
        supportsJsonFormat: true,
        supportsVision: false,
      };
    case "embed":
      return {
        role,
        tag: config.embedModel,
        contextWindow: 8_192,
        supportsTools: false,
        supportsJsonFormat: false,
        supportsVision: false,
      };
    case "vision":
      return {
        role,
        tag: config.visionModel,
        // qwen2.5vl 系は default ctx が巨大 (128K) で 32GB RAM を超えるので明示的に絞る
        contextWindow: 8_192,
        // qwen2.5vl は tool calling を一応サポート (反応の質はサイズ依存)。
        // ORICA_AI_VISION_DISABLE_TOOLS=true で従来の安全側 (tool 無効) に戻せる。
        supportsTools: process.env.ORICA_AI_VISION_DISABLE_TOOLS !== "true",
        supportsJsonFormat: true,
        supportsVision: true,
      };
  }
}
