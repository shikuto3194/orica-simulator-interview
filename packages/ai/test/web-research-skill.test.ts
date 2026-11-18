import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAllSkills, selectMatchingSkills } from "../src/context/skills";
import { loadAllCommands, findCommand } from "../src/context/commands";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const SKILLS_ROOT = resolve(PACKAGE_ROOT, "skills");
const COMMANDS_ROOT = resolve(PACKAGE_ROOT, "prompts/commands");

describe("web-research skill", () => {
  it("loads the web-research skill from disk", async () => {
    const skills = await loadAllSkills({ root: SKILLS_ROOT });
    const ws = skills.find((s) => s.name === "web-research");
    expect(ws).toBeDefined();
    expect(ws!.allowedTools).toContain("web_search");
    expect(ws!.allowedTools).toContain("web_fetch");
    expect(ws!.triggers.length).toBeGreaterThan(10);
  });

  it("activates on Japanese natural-language triggers", async () => {
    const skills = await loadAllSkills({ root: SKILLS_ROOT });
    const cases = [
      "ウェブリサーチして",
      "web リサーチをお願いします",
      "ネットで調べて",
      "公式サイトの最新FAQを教えて",
      "この URLを読んで要約して: https://example.com",
      "最新情報を確認したい",
      "ググって",
    ];
    for (const task of cases) {
      const matched = selectMatchingSkills(skills, task);
      expect(
        matched.some((s) => s.name === "web-research"),
        `expected web-research to match "${task}"`
      ).toBe(true);
    }
  });

  it("activates on English triggers too", async () => {
    const skills = await loadAllSkills({ root: SKILLS_ROOT });
    const cases = [
      "please search the web for battle spirits FAQ",
      "fetch the URL https://example.com",
      "look it up online",
    ];
    for (const task of cases) {
      const matched = selectMatchingSkills(skills, task);
      expect(
        matched.some((s) => s.name === "web-research"),
        `expected web-research to match "${task}"`
      ).toBe(true);
    }
  });

  it("does not over-trigger on unrelated rule questions", async () => {
    const skills = await loadAllSkills({ root: SKILLS_ROOT });
    const matched = selectMatchingSkills(
      skills,
      "煌臨条件のスタックタイミングを教えて"
    );
    expect(matched.some((s) => s.name === "web-research")).toBe(false);
  });
});

describe("/research slash command", () => {
  it("is loadable and references the web tools", async () => {
    const commands = await loadAllCommands({ root: COMMANDS_ROOT });
    const cmd = findCommand(commands, "research");
    expect(cmd).toBeDefined();
    expect(cmd!.allowedTools).toContain("web_search");
    expect(cmd!.allowedTools).toContain("web_fetch");
  });
});
