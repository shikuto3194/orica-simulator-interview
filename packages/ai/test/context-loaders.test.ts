import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatProjectSystemBlock,
  loadProjectContext,
} from "../src/context/project";
import {
  formatMemorySystemBlock,
  loadAllMemory,
  parseFrontmatter,
  selectRelevantMemories,
} from "../src/context/memory";
import {
  formatSkillsSystemBlock,
  loadAllSkills,
  selectMatchingSkills,
} from "../src/context/skills";
import {
  findCommand,
  loadAllCommands,
  renderCommandPrompt,
} from "../src/context/commands";
import { loadHooks } from "../src/context/hooks";

let workDir: string;

beforeEach(async () => {
  workDir = join(tmpdir(), `orica-ai-test-${Date.now()}-${Math.random()}`);
  await mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  it("extracts data and body", () => {
    const { data, body } = parseFrontmatter(
      "---\nname: foo\ntriggers: [a, b]\n---\n\nBody here."
    );
    expect(data.name).toBe("foo");
    expect(data.triggers).toEqual(["a", "b"]);
    expect(body.trim()).toBe("Body here.");
  });

  it("returns empty data when no frontmatter", () => {
    const { data, body } = parseFrontmatter("just body");
    expect(data).toEqual({});
    expect(body).toBe("just body");
  });

  it("parses multi-line bracket arrays (key on its own line, [ on next)", () => {
    const { data } = parseFrontmatter(
      "---\nname: x\ntriggers:\n  [\n    a,\n    b,\n    c,\n  ]\nother: y\n---\n\nbody"
    );
    expect(data.triggers).toEqual(["a", "b", "c"]);
    expect(data.name).toBe("x");
    expect(data.other).toBe("y");
  });

  it("parses multi-line bracket arrays (opening [ on same line)", () => {
    const { data } = parseFrontmatter(
      "---\ntriggers: [\n  a,\n  b,\n]\n---\n\nbody"
    );
    expect(data.triggers).toEqual(["a", "b"]);
  });
});

describe("project context", () => {
  it("loads CLAUDE.md when present", async () => {
    await writeFile(
      join(workDir, "CLAUDE.md"),
      "# Project\nrules here",
      "utf8"
    );
    const ctx = await loadProjectContext({ repoRoot: workDir });
    expect(ctx.claudeMd).toContain("rules here");
    const block = formatProjectSystemBlock(ctx);
    expect(block).toContain("プロジェクト前提");
    expect(block).toContain("rules here");
  });

  it("returns empty string when CLAUDE.md missing", async () => {
    const ctx = await loadProjectContext({ repoRoot: workDir });
    expect(ctx.claudeMd).toBe("");
    expect(formatProjectSystemBlock(ctx)).toBe("");
  });
});

describe("memory", () => {
  it("loads project memory and always includes it", async () => {
    const dir = join(workDir, ".claude/memory/project");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "alpha.md"),
      "---\nname: alpha\ndescription: alpha-desc\ntype: project\n---\nproject body",
      "utf8"
    );
    const mems = await loadAllMemory({ repoRoot: workDir });
    expect(mems).toHaveLength(1);
    expect(mems[0]?.name).toBe("alpha");
    const selected = selectRelevantMemories(mems, "totally unrelated task");
    expect(selected.map((m) => m.name)).toContain("alpha");
  });

  it("only includes reference memory when triggers match", async () => {
    const dir = join(workDir, ".claude/memory/reference");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "beta.md"),
      "---\nname: beta\ntype: reference\ntriggers: [スタック]\n---\nref body",
      "utf8"
    );
    const mems = await loadAllMemory({ repoRoot: workDir });
    expect(selectRelevantMemories(mems, "色の話").map((m) => m.name)).toEqual(
      []
    );
    expect(
      selectRelevantMemories(mems, "スタックって何").map((m) => m.name)
    ).toEqual(["beta"]);
  });

  it("formatMemorySystemBlock returns empty when no entries", () => {
    expect(formatMemorySystemBlock([])).toBe("");
  });
});

describe("skills", () => {
  it("matches by trigger and emits a system block", async () => {
    const root = join(workDir, "skills");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "card-parse.md"),
      "---\nname: card-parse\ndescription: parse cards\ntriggers: [カード, parse]\nallowed-tools: [lookup_card]\n---\nbody",
      "utf8"
    );
    const skills = await loadAllSkills({ root });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.allowedTools).toEqual(["lookup_card"]);
    expect(selectMatchingSkills(skills, "今日の天気")).toEqual([]);
    expect(selectMatchingSkills(skills, "カードの効果は?")).toHaveLength(1);
    expect(formatSkillsSystemBlock(skills)).toContain("card-parse");
  });
});

describe("commands", () => {
  it("loads commands and renders body with {{ARGS}}", async () => {
    const root = join(workDir, "commands");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "review.md"),
      "---\nname: review\ndescription: review diff\nallowed-tools: [git_diff]\n---\nReview {{ARGS}} now.",
      "utf8"
    );
    const commands = await loadAllCommands({ root });
    expect(commands).toHaveLength(1);
    const cmd = findCommand(commands, "/review");
    expect(cmd?.name).toBe("review");
    expect(renderCommandPrompt(cmd!, "src/foo.ts")).toBe(
      "Review src/foo.ts now."
    );
  });
});

describe("hooks settings parser", () => {
  it("accepts Claude Code nested schema", async () => {
    const claudeDir = join(workDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [
                { type: "command", command: "echo edit done", timeout: 5 },
              ],
            },
          ],
        },
      }),
      "utf8"
    );
    const hooks = await loadHooks({ repoRoot: workDir });
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PostToolUse?.[0]?.command).toBe("echo edit done");
    expect(hooks.PostToolUse?.[0]?.matcher).toBe("Edit");
    expect(hooks.PostToolUse?.[0]?.timeoutMs).toBe(5_000);
  });

  it("accepts flat schema", async () => {
    const claudeDir = join(workDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ command: "echo done", timeoutMs: 2000 }],
        },
      }),
      "utf8"
    );
    const hooks = await loadHooks({ repoRoot: workDir });
    expect(hooks.Stop?.[0]?.command).toBe("echo done");
    expect(hooks.Stop?.[0]?.timeoutMs).toBe(2_000);
  });

  it("returns empty when file missing", async () => {
    const hooks = await loadHooks({ repoRoot: workDir });
    expect(hooks).toEqual({});
  });
});
