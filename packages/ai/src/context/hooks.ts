import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { defaultRepoRoot } from "./project.js";

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop" | "Start";

export interface HookConfig {
  /** ツール名の正規表現 (PreToolUse / PostToolUse のみ参照)。省略時は全マッチ */
  matcher?: string;
  /** 実行する shell コマンド */
  command: string;
  /** タイムアウト ms (デフォルト 30 秒) */
  timeoutMs?: number;
}

export type HooksSettings = Partial<Record<HookEvent, HookConfig[]>>;

export interface LoadHooksOptions {
  repoRoot?: string;
  /** settings ファイルパス。デフォルト `<repoRoot>/.claude/settings.json` */
  settingsPath?: string;
}

/**
 * `.claude/settings.json` を読む。Claude Code 互換のスキーマと、本パッケージ独自の
 * フラットなスキーマの両方を受け入れる。
 *
 * Claude Code 形式:
 *   { "hooks": { "PreToolUse": [ { "matcher": "Edit", "hooks": [ { "type": "command", "command": "...", "timeout": 60 } ] } ] } }
 *
 * フラット形式:
 *   { "hooks": { "PreToolUse": [ { "matcher": "read_file", "command": "...", "timeoutMs": 5000 } ] } }
 *
 * 両方とも `HookConfig[]` に正規化して返す。
 */
export async function loadHooks(
  options: LoadHooksOptions = {}
): Promise<HooksSettings> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const settingsPath =
    options.settingsPath ?? resolve(repoRoot, ".claude/settings.json");
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const hooksObj = (parsed as { hooks?: unknown }).hooks;
  if (!hooksObj || typeof hooksObj !== "object") return {};
  const out: HooksSettings = {};
  for (const [eventName, entries] of Object.entries(hooksObj)) {
    if (!isHookEvent(eventName) || !Array.isArray(entries)) continue;
    out[eventName] = normalizeHookEntries(entries as unknown[]);
  }
  return out;
}

function isHookEvent(s: string): s is HookEvent {
  return (
    s === "PreToolUse" || s === "PostToolUse" || s === "Stop" || s === "Start"
  );
}

function normalizeHookEntries(entries: unknown[]): HookConfig[] {
  const out: HookConfig[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const matcher = typeof e.matcher === "string" ? e.matcher : undefined;
    // Claude Code 形式: { matcher, hooks: [{ type, command, timeout }] }
    if (Array.isArray(e.hooks)) {
      for (const inner of e.hooks as unknown[]) {
        if (!inner || typeof inner !== "object") continue;
        const i = inner as Record<string, unknown>;
        if (i.type && i.type !== "command") continue;
        if (typeof i.command !== "string") continue;
        const timeoutMs =
          typeof i.timeout === "number"
            ? i.timeout * 1000
            : typeof i.timeoutMs === "number"
              ? i.timeoutMs
              : undefined;
        out.push({
          ...(matcher !== undefined ? { matcher } : {}),
          command: i.command,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
      }
      continue;
    }
    // フラット形式: { matcher, command, timeoutMs }
    if (typeof e.command === "string") {
      const timeoutMs =
        typeof e.timeoutMs === "number" ? e.timeoutMs : undefined;
      out.push({
        ...(matcher !== undefined ? { matcher } : {}),
        command: e.command,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
    }
  }
  return out;
}

export interface HookResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface HookContext {
  toolName?: string;
  /**
   * Tool 引数 (PreToolUse / PostToolUse のみ)。Claude Code 互換のため stdin に
   * `{ tool_name, tool_input, cwd, hook_event_name }` JSON として渡される。
   */
  toolInput?: unknown;
  cwd?: string;
}

export async function fireHooks(
  hooks: HooksSettings,
  event: HookEvent,
  context: HookContext
): Promise<HookResult[]> {
  const list = hooks[event] ?? [];
  const results: HookResult[] = [];
  for (const hook of list) {
    if (event === "PreToolUse" || event === "PostToolUse") {
      if (hook.matcher && context.toolName) {
        const re = new RegExp(hook.matcher);
        if (!re.test(context.toolName)) continue;
      }
    }
    results.push(await runCommand(hook, event, context));
  }
  return results;
}

async function runCommand(
  hook: HookConfig,
  event: HookEvent,
  context: HookContext
): Promise<HookResult> {
  const start = Date.now();
  return new Promise((resolveP) => {
    const child = spawn(hook.command, {
      shell: true,
      cwd: context.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    const payload = {
      hook_event_name: event,
      tool_name: context.toolName,
      tool_input: context.toolInput,
      cwd: context.cwd ?? process.cwd(),
    };
    try {
      child.stdin?.write(JSON.stringify(payload));
      child.stdin?.end();
    } catch {
      /* ignore: stdin may not be available */
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, hook.timeoutMs ?? 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({
        command: hook.command,
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveP({
        command: hook.command,
        exitCode: -1,
        stdout,
        stderr: stderr + String(err),
        durationMs: Date.now() - start,
      });
    });
  });
}
