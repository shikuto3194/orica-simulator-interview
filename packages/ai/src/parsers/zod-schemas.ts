import { z } from "zod";
import type { Effect, EffectStep } from "@orica/rules-core";

// LLM 出力のゲートキーパー。未知フィールドはランタイムでは passthrough で許容する
// （AI 出力の揺れを吸収するため緩さは意図的）。一方、スキーマが「知っている」
// 既知フィールド名は SSOT である rules-core の Effect / EffectStep の実キーに
// `satisfies` で束縛する。rules-core 側でフィールドを rename / 削除すると下記
// shape の satisfies が型エラーになり、スキーマの追従を強制する。
// → 既知フィールドを足すときは shape に追加するだけでよい（キー名は自動検証される）。

const TimingSchema = z
  .object({
    kind: z.string(),
  })
  .passthrough();

const ActionSchema = z
  .object({
    kind: z.string(),
  })
  .passthrough();

const stepShape = {
  id: z.string().optional(),
  action: ActionSchema,
  executionMode: z.enum(["mandatory", "optional"]).optional(),
  connector: z.string().optional(),
  condition: z.unknown().optional(),
  stepCondition: z.unknown().optional(),
  choice: z.array(z.unknown()).optional(),
} satisfies Partial<Record<keyof EffectStep, z.ZodTypeAny>>;

const StepSchema = z.object(stepShape).passthrough();

const effectShape = {
  timing: TimingSchema,
  steps: z.array(StepSchema).min(1),
  applicability: z.unknown().optional(),
  condition: z.unknown().optional(),
  executionMode: z.enum(["mandatory", "optional"]).optional(),
  heading: z.string().optional(),
  triggerPhrases: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  stub: z.string().optional(),
} satisfies Partial<Record<keyof Effect, z.ZodTypeAny>>;

export const EffectSchema = z.object(effectShape).passthrough();

export const ParseOutputSchema = z.union([
  z.object({
    effects: z.array(EffectSchema),
  }),
  z.object({
    effects: z.array(EffectSchema).default([]),
    needsHumanReview: z.literal(true),
    reason: z.string(),
  }),
]);

export type EffectLike = z.infer<typeof EffectSchema>;
export type ParseOutput = z.infer<typeof ParseOutputSchema>;

export interface ValidationFailure {
  ok: false;
  error: string;
  raw: unknown;
}

export interface ValidationSuccess {
  ok: true;
  value: ParseOutput;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validateParseOutput(raw: unknown): ValidationResult {
  const result = ParseOutputSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error.toString(), raw };
}
