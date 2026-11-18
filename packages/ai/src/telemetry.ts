/**
 * 軽量テレメトリ: agent 実行ごとに 1 行 JSON を `.claude/ai-telemetry.jsonl` に追記する。
 *
 * 設計方針:
 *  - LLM 出力本文は記録しない (秘匿対策 + ファイル肥大化対策)
 *  - 記録するのは「どの skill / memory が trigger したか」「step 数」「task 先頭 120 文字」「実行時刻」のみ
 *  - 書き込み失敗は飲み込む (テレメトリで agent を止めない)
 *  - `ORICA_AI_TELEMETRY_OFF=true` で無効化
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defaultRepoRoot } from "./context/project.js";

export interface AgentTelemetryRecord {
  ts: string;
  taskPreview: string;
  steps: number;
  selectedSkills: string[];
  selectedMemories: string[];
  resolvedCommand?: string;
  attachmentCount?: number;
  hasImages?: boolean;
}

export function telemetryPath(repoRoot: string = defaultRepoRoot()): string {
  return resolve(repoRoot, ".claude/ai-telemetry.jsonl");
}

function previewTask(task: string): string {
  const single = task.replace(/\s+/g, " ").trim();
  return single.length > 120 ? single.slice(0, 119) + "…" : single;
}

export async function recordAgentRun(
  input: { task: string } & Omit<AgentTelemetryRecord, "ts" | "taskPreview">,
  options: { repoRoot?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const env = options.env ?? process.env;
  if (env.ORICA_AI_TELEMETRY_OFF === "true") return;
  const record: AgentTelemetryRecord = {
    ts: new Date().toISOString(),
    taskPreview: previewTask(input.task),
    steps: input.steps,
    selectedSkills: input.selectedSkills,
    selectedMemories: input.selectedMemories,
    ...(input.resolvedCommand !== undefined
      ? { resolvedCommand: input.resolvedCommand }
      : {}),
    ...(input.attachmentCount !== undefined
      ? { attachmentCount: input.attachmentCount }
      : {}),
    ...(input.hasImages !== undefined ? { hasImages: input.hasImages } : {}),
  };
  const path = telemetryPath(options.repoRoot);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* swallow: telemetry should never break the agent */
  }
}
