import type { Tool as OllamaTool } from "ollama";
import type { z } from "zod";

export interface ToolDef<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TResult = unknown,
> {
  name: string;
  description: string;
  schema: TSchema;
  jsonSchema: Record<string, unknown>;
  execute: (args: z.infer<TSchema>) => Promise<TResult> | TResult;
}

export type AnyToolDef = ToolDef<z.ZodTypeAny, unknown>;

export function toOllamaTool(def: AnyToolDef): OllamaTool {
  const tool = {
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.jsonSchema,
    },
  };
  return tool as unknown as OllamaTool;
}
