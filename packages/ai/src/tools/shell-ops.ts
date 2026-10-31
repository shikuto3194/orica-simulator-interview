import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { defaultRepoRoot } from "../context/project.js";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunCommandOptions {
  /** 許可されたコマンドのリスト (完全一致または前方一致) */
  allowlist?: string[];
  /** タイムアウト ms */
  timeoutMs?: number;
  /** 作業ディレクトリ。デフォルトはリポジトリルート */
  cwd?: string;
}

const DEFAULT_ALLOWLIST = [
  "pnpm test",
  "pnpm check",
  "pnpm lint",
  "pnpm format",
  "pnpm format:check",
  "pnpm verify",
  "pnpm docs:lint",
  "pnpm ai:smoke",
  "pnpm ai:parse-card",
  "git status",
  "git diff",
  "git log",
];

function isAllowed(command: string, allowlist: string[]): boolean {
  const trimmed = command.trim();
  return allowlist.some(
    (a) =>
      trimmed === a ||
      trimmed.startsWith(`${a} `) ||
      trimmed.startsWith(`${a}--`)
  );
}

const RunCommandSchema = z.object({
  command: z.string(),
});

export function makeRunCommandTool(
  options: RunCommandOptions = {}
): ToolDef<typeof RunCommandSchema, RunResult> {
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST;
  return {
    name: "run_command",
    description: `許可されたコマンドを実行する (allowlist: ${allowlist.join(" | ")})。stdout/stderr/exit を返す。`,
    schema: RunCommandSchema,
    jsonSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "shell コマンド" },
      },
    },
    execute: async ({ command }) => {
      if (!isAllowed(command, allowlist)) {
        throw new Error(
          `command not in allowlist: ${command}. Allowed prefixes: ${allowlist.join(", ")}`
        );
      }
      return runShell(command, {
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
        cwd: options.cwd ?? defaultRepoRoot(),
      });
    },
  };
}

const RunTestsSchema = z.object({
  filter: z.string().optional(),
});

export function makeRunTestsTool(
  options: RunCommandOptions = {}
): ToolDef<typeof RunTestsSchema, RunResult> {
  return {
    name: "run_tests",
    description:
      "vitest を実行する。filter を渡すとファイル名フィルタになる (例: 'card-data')。",
    schema: RunTestsSchema,
    jsonSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "ファイル名フィルタ" },
      },
    },
    execute: ({ filter }) => {
      const cmd = filter ? `pnpm test -- ${filter}` : "pnpm test";
      return runShell(cmd, {
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : { timeoutMs: 300_000 }),
        cwd: options.cwd ?? defaultRepoRoot(),
      });
    },
  };
}

const RunTypecheckSchema = z.object({}).strict();

export function makeRunTypecheckTool(
  options: RunCommandOptions = {}
): ToolDef<typeof RunTypecheckSchema, RunResult> {
  return {
    name: "run_typecheck",
    description: "プロジェクト全体の型チェック (`pnpm check`) を走らせる。",
    schema: RunTypecheckSchema,
    jsonSchema: { type: "object", properties: {} },
    execute: () =>
      runShell("pnpm check", {
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : { timeoutMs: 300_000 }),
        cwd: options.cwd ?? defaultRepoRoot(),
      }),
  };
}

const GitStatusSchema = z.object({}).strict();

export function makeGitStatusTool(
  options: RunCommandOptions = {}
): ToolDef<typeof GitStatusSchema, RunResult> {
  return {
    name: "git_status",
    description: "`git status --short` の結果を返す。",
    schema: GitStatusSchema,
    jsonSchema: { type: "object", properties: {} },
    execute: () =>
      runShell("git status --short", {
        timeoutMs: 15_000,
        cwd: options.cwd ?? defaultRepoRoot(),
      }),
  };
}

const GitDiffSchema = z.object({
  path: z.string().optional(),
  staged: z.boolean().optional(),
});

export function makeGitDiffTool(
  options: RunCommandOptions = {}
): ToolDef<typeof GitDiffSchema, RunResult> {
  return {
    name: "git_diff",
    description:
      "`git diff` (path 指定可、staged=true で --cached) の結果を返す。差分が巨大な場合は head_limit で切る。",
    schema: GitDiffSchema,
    jsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        staged: { type: "boolean" },
      },
    },
    execute: ({ path, staged }) => {
      const parts = ["git diff"];
      if (staged) parts.push("--cached");
      if (path) parts.push(`-- ${shellQuote(path)}`);
      return runShell(parts.join(" "), {
        timeoutMs: 30_000,
        cwd: options.cwd ?? defaultRepoRoot(),
      });
    },
  };
}

function shellQuote(s: string): string {
  if (/^[\w./-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

interface RunShellOptions {
  timeoutMs?: number;
  cwd: string;
}

async function runShell(
  command: string,
  options: RunShellOptions
): Promise<RunResult> {
  const start = Date.now();
  return new Promise((resolveP) => {
    const child = spawn(command, { shell: true, cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, options.timeoutMs ?? 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({
        exitCode: code ?? -1,
        stdout: truncate(stdout, 16_000),
        stderr: truncate(stderr, 16_000),
        durationMs: Date.now() - start,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveP({
        exitCode: -1,
        stdout: truncate(stdout, 16_000),
        stderr: truncate(stderr + String(err), 16_000),
        durationMs: Date.now() - start,
      });
    });
  });
}

function truncate(s: string, max: number): string {
  return s.length > max
    ? s.slice(0, max) + `\n…(truncated, was ${s.length} chars)`
    : s;
}
