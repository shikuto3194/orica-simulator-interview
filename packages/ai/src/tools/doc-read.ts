import { readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ToolDef } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function defaultManualRoot(): string {
  return resolve(HERE, "../../../../manual/ai-reference");
}

export interface DocReadOptions {
  manualRoot?: string;
  /** 1 回の read で返す最大文字数 (デフォルト 8000) */
  maxChars?: number;
}

const DocReadSchema = z.object({ path: z.string() });

export interface DocReadResult {
  path: string;
  content: string;
  truncated: boolean;
}

export function makeReadDocTool(
  options: DocReadOptions = {}
): ToolDef<typeof DocReadSchema, DocReadResult> {
  const root = options.manualRoot ?? defaultManualRoot();
  const maxChars = options.maxChars ?? 8_000;
  return {
    name: "read_doc",
    description:
      "manual/ai-reference 配下のルール / 設計ドキュメントを読む。path はリポジトリルートからの相対 (例: manual/ai-reference/10_rules/02_turn-flow-and-timing.md)。",
    schema: DocReadSchema,
    jsonSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    },
    execute: async ({ path }) => {
      const absRoot = resolve(root);
      const normalized = normalize(
        path.startsWith("manual/ai-reference")
          ? resolve(absRoot, "..", "..", path)
          : join(absRoot, path.replace(/^manual\/ai-reference\/?/, ""))
      );
      if (!normalized.startsWith(absRoot)) {
        throw new Error(
          `path must be inside manual/ai-reference: ${path} resolved to ${normalized}`
        );
      }
      const raw = await readFile(normalized, "utf8");
      const truncated = raw.length > maxChars;
      return {
        path,
        content: truncated ? raw.slice(0, maxChars) : raw,
        truncated,
      };
    },
  };
}
