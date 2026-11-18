import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./memory.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Skill {
  name: string;
  description: string;
  allowedTools: string[];
  triggers: string[];
  body: string;
  path: string;
}

export interface LoadSkillsOptions {
  /** skills ルート。デフォルト `packages/ai/skills` */
  root?: string;
}

function defaultSkillsRoot(): string {
  // HERE は src/context または dist/context のどちらかで、どちらも packages/ai 配下
  // depth 2 (../../) で packages/ai に届く
  return resolve(HERE, "../../skills");
}

export async function loadAllSkills(
  options: LoadSkillsOptions = {}
): Promise<Skill[]> {
  const root = options.root ?? defaultSkillsRoot();
  let files: string[];
  try {
    files = await readdir(root);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const p = join(root, f);
    const raw = await readFile(p, "utf8");
    const { data, body } = parseFrontmatter(raw);
    out.push({
      name: typeof data.name === "string" ? data.name : f.replace(/\.md$/, ""),
      description: typeof data.description === "string" ? data.description : "",
      allowedTools: Array.isArray(data["allowed-tools"])
        ? (data["allowed-tools"] as string[])
        : [],
      triggers: Array.isArray(data.triggers) ? (data.triggers as string[]) : [],
      body,
      path: p,
    });
  }
  return out;
}

/**
 * タスク文に対してマッチする skill を選ぶ。trigger 語のいずれかが含まれれば採用。
 * 複数マッチした場合は全部返す (system prompt に並べる)。
 */
export function selectMatchingSkills(all: Skill[], task: string): Skill[] {
  const lower = task.toLowerCase();
  return all.filter((s) =>
    s.triggers.some((t) => lower.includes(t.toLowerCase()))
  );
}

export function formatSkillsSystemBlock(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const sections = skills
    .map(
      (s) =>
        `## ${s.name}\n${s.description ? `_${s.description}_\n` : ""}${s.body.trim()}`
    )
    .join("\n\n");
  return `# 有効化された Skills (triggers 一致)\n\n${sections}`;
}
