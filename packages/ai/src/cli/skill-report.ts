#!/usr/bin/env node
/**
 * `pnpm ai:skill-report` — `.claude/ai-telemetry.jsonl` を集計して skill / memory の
 * 起動率を表示する。
 *
 * 出力:
 *   - 過去 N 件 (デフォルト 200) のうち各 skill が trigger した回数 + 比率
 *   - 起動率 0% の skill は trigger 語が外している可能性として「未起動」セクションに出す
 *   - command / attachment / vision の利用比率も合わせて
 *
 * オプション:
 *   --limit <N>  集計対象を直近 N 件に絞る (デフォルト 200)
 *   --json       JSON で出す
 */
import { readFile } from "node:fs/promises";
import { loadAllSkills } from "../context/skills.js";
import { telemetryPath } from "../telemetry.js";

interface ParsedRecord {
  ts: string;
  taskPreview: string;
  steps: number;
  selectedSkills: string[];
  selectedMemories: string[];
  resolvedCommand?: string;
  attachmentCount?: number;
  hasImages?: boolean;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let limit = 200;
  let jsonMode = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") {
      limit = parseInt(argv[++i] ?? "200", 10);
    } else if (a === "--json") {
      jsonMode = true;
    } else if (a === "--help" || a === "-h") {
      console.warn(
        "usage: ai:skill-report [--limit N] [--json]\n  集計対象は直近 N 件 (デフォルト 200)"
      );
      return;
    }
  }
  const path = telemetryPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    console.warn(`(no telemetry at ${path} yet)`);
    return;
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const records: ParsedRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as ParsedRecord);
    } catch {
      /* skip malformed line */
    }
  }
  const recent = records.slice(-limit);
  const skills = await loadAllSkills();
  const skillCounts = new Map<string, number>();
  for (const s of skills) skillCounts.set(s.name, 0);
  const memoryCounts = new Map<string, number>();
  let commandRuns = 0;
  let visionRuns = 0;
  let attachmentRuns = 0;
  for (const r of recent) {
    for (const s of r.selectedSkills) {
      skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
    }
    for (const m of r.selectedMemories) {
      memoryCounts.set(m, (memoryCounts.get(m) ?? 0) + 1);
    }
    if (r.resolvedCommand) commandRuns++;
    if (r.hasImages) visionRuns++;
    if ((r.attachmentCount ?? 0) > 0) attachmentRuns++;
  }
  const total = recent.length;
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          total,
          skills: Object.fromEntries(skillCounts),
          memories: Object.fromEntries(memoryCounts),
          commandRuns,
          visionRuns,
          attachmentRuns,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }
  console.warn(`ai:skill-report (直近 ${total} 件 / 全 ${records.length} 件)`);
  console.warn("");
  console.warn("Skills (trigger 起動率):");
  const sortedSkills = [...skillCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedSkills) {
    const pct = total === 0 ? 0 : (count / total) * 100;
    console.warn(
      `  ${name.padEnd(20)} ${count.toString().padStart(4)}  (${pct.toFixed(1)}%)`
    );
  }
  const zero = sortedSkills.filter(([, c]) => c === 0).map(([n]) => n);
  if (zero.length > 0) {
    console.warn("");
    console.warn(
      `⚠ 起動 0 件の skill (trigger 語の見直し候補): ${zero.join(", ")}`
    );
  }
  if (memoryCounts.size > 0) {
    console.warn("");
    console.warn("Memories (auto-attach 頻度):");
    const sortedMem = [...memoryCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sortedMem.slice(0, 20)) {
      console.warn(`  ${name.padEnd(40)} ${count}`);
    }
  }
  console.warn("");
  console.warn(
    `Command runs: ${commandRuns} / Vision runs: ${visionRuns} / Attachment runs: ${attachmentRuns}`
  );
}

main().catch((err) => {
  console.error("ai:skill-report failed:", err);
  process.exit(1);
});
