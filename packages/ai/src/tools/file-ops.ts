import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { assertWritable, resolveInsideRepo } from "./fs-guard.js";
import type { PathGuardOptions } from "./fs-guard.js";
import { assertWriteCompliance } from "./write-advisor.js";

const ReadFileSchema = z.object({
  path: z.string(),
  /** 1 回で返す最大文字数。デフォルト 16000 */
  maxChars: z.number().int().positive().max(64_000).optional(),
});

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export function makeReadFileTool(
  options: PathGuardOptions = {}
): ToolDef<typeof ReadFileSchema, ReadFileResult> {
  return {
    name: "read_file",
    description:
      "リポジトリ内のファイルを読む。path はリポジトリルートからの相対。.env や node_modules は弾かれる。",
    schema: ReadFileSchema,
    jsonSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        maxChars: { type: "integer", minimum: 1, maximum: 64_000 },
      },
    },
    execute: async ({ path, maxChars }) => {
      const resolved = resolveInsideRepo(path, options);
      const raw = await readFile(resolved.abs, "utf8");
      const cap = maxChars ?? 16_000;
      return {
        path: resolved.rel,
        content: raw.length > cap ? raw.slice(0, cap) : raw,
        truncated: raw.length > cap,
        bytes: Buffer.byteLength(raw, "utf8"),
      };
    },
  };
}

const WriteFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  /** 既存ファイルを上書きするか。デフォルト false (新規のみ) */
  overwrite: z.boolean().optional(),
});

export function makeWriteFileTool(
  options: PathGuardOptions = {}
): ToolDef<typeof WriteFileSchema, { path: string; bytes: number }> {
  return {
    name: "write_file",
    description:
      "ファイルを新規作成または上書き。保護パス (node_modules / .git / .env 等) は拒否。overwrite=true で既存上書き。",
    schema: WriteFileSchema,
    jsonSchema: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        overwrite: { type: "boolean" },
      },
    },
    execute: async ({ path, content, overwrite }) => {
      const resolved = resolveInsideRepo(path, options);
      assertWritable(resolved, options);
      let previous: string | undefined;
      try {
        previous = await readFile(resolved.abs, "utf8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
      if (previous !== undefined && !overwrite) {
        throw new Error(
          `file exists: ${resolved.rel}. Pass overwrite=true to replace.`
        );
      }
      assertWriteCompliance({
        rel: resolved.rel,
        content,
        ...(previous !== undefined ? { previousContent: previous } : {}),
      });
      await mkdir(dirname(resolved.abs), { recursive: true });
      await writeFile(resolved.abs, content, "utf8");
      return {
        path: resolved.rel,
        bytes: Buffer.byteLength(content, "utf8"),
      };
    },
  };
}

const ApplyEditSchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
  /** old が複数回ある時に全置換するか。デフォルト false (1 回のみ、複数あればエラー) */
  replaceAll: z.boolean().optional(),
});

export interface ApplyEditResult {
  path: string;
  replacements: number;
}

export function makeApplyEditTool(
  options: PathGuardOptions = {}
): ToolDef<typeof ApplyEditSchema, ApplyEditResult> {
  return {
    name: "apply_edit",
    description:
      "ファイル内の oldString を newString に置換する。replaceAll=false (デフォルト) で複数一致するとエラー。",
    schema: ApplyEditSchema,
    jsonSchema: {
      type: "object",
      required: ["path", "oldString", "newString"],
      properties: {
        path: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
    },
    execute: async ({ path, oldString, newString, replaceAll }) => {
      const resolved = resolveInsideRepo(path, options);
      assertWritable(resolved, options);
      const raw = await readFile(resolved.abs, "utf8");
      let next: string;
      let count: number;
      if (replaceAll) {
        const parts = raw.split(oldString);
        count = parts.length - 1;
        next = parts.join(newString);
      } else {
        const occurrences = raw.split(oldString).length - 1;
        if (occurrences === 0) {
          throw new Error(`oldString not found in ${resolved.rel}`);
        }
        if (occurrences > 1) {
          throw new Error(
            `oldString matches ${occurrences} times in ${resolved.rel}. Pass replaceAll=true or narrow the match.`
          );
        }
        next = raw.replace(oldString, newString);
        count = 1;
      }
      if (next === raw) {
        return { path: resolved.rel, replacements: 0 };
      }
      assertWriteCompliance({
        rel: resolved.rel,
        content: next,
        previousContent: raw,
      });
      await writeFile(resolved.abs, next, "utf8");
      return { path: resolved.rel, replacements: count };
    },
  };
}
