import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defaultRepoRoot } from "./project.js";

export type MemoryType = "project" | "feedback" | "reference" | "user";

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  triggers: string[];
  body: string;
  path: string;
}

export interface LoadMemoryOptions {
  repoRoot?: string;
  /** memory ルート。デフォルト `<repoRoot>/.claude/memory` */
  root?: string;
}

const TYPES: MemoryType[] = ["project", "feedback", "reference", "user"];

export async function loadAllMemory(
  options: LoadMemoryOptions = {}
): Promise<MemoryEntry[]> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const root = options.root ?? resolve(repoRoot, ".claude/memory");
  const out: MemoryEntry[] = [];
  for (const t of TYPES) {
    const dir = join(root, t);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".md")) continue;
      const p = join(dir, f);
      try {
        const s = await stat(p);
        if (!s.isFile()) continue;
        const raw = await readFile(p, "utf8");
        out.push(parseMemoryFile(raw, t, p));
      } catch {
        continue;
      }
    }
  }
  return out;
}

/**
 * 与えられたタスク文に対して関連メモリを選別する。
 * フィルタ:
 * 1. project / feedback はデフォルトで全件採用 (常時有効)。
 * 2. reference / user は triggers のいずれかがタスク文に含まれる時のみ採用。
 */
export function selectRelevantMemories(
  all: MemoryEntry[],
  task: string
): MemoryEntry[] {
  const lower = task.toLowerCase();
  return all.filter((m) => {
    if (m.type === "project" || m.type === "feedback") return true;
    if (m.triggers.length === 0) return false;
    return m.triggers.some((t) => lower.includes(t.toLowerCase()));
  });
}

export function formatMemorySystemBlock(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  const sections = entries
    .map(
      (m) =>
        `## ${m.name} (${m.type})\n${m.description ? `_${m.description}_\n` : ""}${m.body.trim()}`
    )
    .join("\n\n");
  return `# 記憶 / 既知事項 (.claude/memory より自動注入)\n\n${sections}`;
}

interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { data: {}, body: raw };
  const header = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, unknown> = {};
  const lines = header.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const idx = line.indexOf(":");
    if (idx < 0) {
      i++;
      continue;
    }
    const key = line.slice(0, idx).trim();
    let valRaw = line.slice(idx + 1).trim();
    if (valRaw === "" || (valRaw.startsWith("[") && !valRaw.endsWith("]"))) {
      // Multi-line bracket array: collect successive lines until we see `]`.
      // Supports:
      //   triggers:
      //     [
      //       a,
      //       b,
      //     ]
      // and:
      //   triggers: [
      //     a,
      //     b,
      //   ]
      const buf = valRaw === "" ? [] : [valRaw];
      let j = i + 1;
      let opened = valRaw.startsWith("[");
      while (j < lines.length) {
        const next = (lines[j] ?? "").trim();
        if (!opened) {
          if (!next.startsWith("[")) break; // not a multi-line array, leave as ""
          opened = true;
        }
        buf.push(next);
        if (next.includes("]")) {
          j++;
          break;
        }
        j++;
      }
      if (opened) {
        valRaw = buf.join(" ").replace(/\s+/g, " ").trim();
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
    if (valRaw.startsWith("[") && valRaw.endsWith("]")) {
      data[key] = valRaw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      data[key] = valRaw.replace(/^["']|["']$/g, "");
    }
  }
  return { data, body };
}

function parseMemoryFile(
  raw: string,
  fallbackType: MemoryType,
  path: string
): MemoryEntry {
  const { data, body } = parseFrontmatter(raw);
  const triggers = Array.isArray(data.triggers)
    ? (data.triggers as string[])
    : [];
  return {
    name: typeof data.name === "string" ? data.name : path,
    description: typeof data.description === "string" ? data.description : "",
    type:
      typeof data.type === "string" && TYPES.includes(data.type as MemoryType)
        ? (data.type as MemoryType)
        : fallbackType,
    triggers,
    body,
    path,
  };
}
