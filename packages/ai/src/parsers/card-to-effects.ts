import { OllamaClient } from "../client.js";
import type { AiConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { getModelProfile } from "../models.js";
import type { ModelRole } from "../models.js";
import {
  CARD_PARSE_SYSTEM,
  buildCardParseUserMessage,
} from "../prompts/card-parse.js";
import type { CardParseFewShot } from "../prompts/card-parse.js";
import { validateParseOutput } from "./zod-schemas.js";
import type { ParseOutput } from "./zod-schemas.js";

export interface ParseCardInput {
  cardNo: string;
  cardName: string;
  textLines: string[];
  fewShots: CardParseFewShot[];
  relevantDslHints?: string;
  role?: ModelRole;
  client?: OllamaClient;
  configOverride?: Partial<AiConfig>;
  /** 1 回だけ auto-repair を許可するか (デフォルト true) */
  autoRepair?: boolean;
}

export interface ParseCardSuccess {
  ok: true;
  cardNo: string;
  output: ParseOutput;
  repaired: boolean;
  rawJson: string;
}

export interface ParseCardFailure {
  ok: false;
  cardNo: string;
  error: string;
  rawJson: string;
  repaired: boolean;
}

export type ParseCardResult = ParseCardSuccess | ParseCardFailure;

export async function parseCardToEffects(
  input: ParseCardInput
): Promise<ParseCardResult> {
  const config = { ...loadConfig(), ...(input.configOverride ?? {}) };
  const client = input.client ?? new OllamaClient(config);
  const model = getModelProfile(input.role ?? "coder", config);
  const autoRepair = input.autoRepair ?? true;

  const userMessage = buildCardParseUserMessage({
    cardName: input.cardName,
    cardNo: input.cardNo,
    textLines: input.textLines,
    fewShots: input.fewShots,
    ...(input.relevantDslHints !== undefined
      ? { relevantDslHints: input.relevantDslHints }
      : {}),
  });

  const initial = await client.chat({
    model: model.tag,
    messages: [
      { role: "system", content: CARD_PARSE_SYSTEM },
      { role: "user", content: userMessage },
    ],
    format: "json",
  });
  const firstRaw = initial.message.content ?? "";
  const firstParsed = tryParse(firstRaw);
  const firstValidation = validateParseOutput(firstParsed.value);
  if (firstValidation.ok) {
    return {
      ok: true,
      cardNo: input.cardNo,
      output: firstValidation.value,
      repaired: false,
      rawJson: firstRaw,
    };
  }
  if (!autoRepair) {
    return {
      ok: false,
      cardNo: input.cardNo,
      error: firstParsed.error ?? firstValidation.error,
      rawJson: firstRaw,
      repaired: false,
    };
  }

  const repairMessage = `直前の出力は次の理由で無効でした:\n${firstParsed.error ?? firstValidation.error}\n\n同じカードについて、修正した JSON のみを再度出力してください。形式: { "effects": Effect[] }。`;
  const repaired = await client.chat({
    model: model.tag,
    messages: [
      { role: "system", content: CARD_PARSE_SYSTEM },
      { role: "user", content: userMessage },
      { role: "assistant", content: firstRaw },
      { role: "user", content: repairMessage },
    ],
    format: "json",
  });
  const repairedRaw = repaired.message.content ?? "";
  const repairedParsed = tryParse(repairedRaw);
  const repairedValidation = validateParseOutput(repairedParsed.value);
  if (repairedValidation.ok) {
    return {
      ok: true,
      cardNo: input.cardNo,
      output: repairedValidation.value,
      repaired: true,
      rawJson: repairedRaw,
    };
  }
  return {
    ok: false,
    cardNo: input.cardNo,
    error: repairedParsed.error ?? repairedValidation.error,
    rawJson: repairedRaw,
    repaired: true,
  };
}

interface ParseAttempt {
  value: unknown;
  error?: string;
}

function tryParse(raw: string): ParseAttempt {
  try {
    return { value: JSON.parse(raw) };
  } catch (err) {
    return {
      value: undefined,
      error: `JSON parse failed: ${(err as Error).message}`,
    };
  }
}
