import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAllSkills, selectMatchingSkills } from "../src/context/skills";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = resolve(HERE, "..", "skills");

interface TriggerCase {
  skill: string;
  task: string;
  tool: string;
}

const CASES: TriggerCase[] = [
  // card-info
  { skill: "card-info", task: "BSTH05-X01 を教えて", tool: "lookup_card" },
  {
    skill: "card-info",
    task: "緑のスピリットを探したい",
    tool: "filter_cards",
  },
  {
    skill: "card-info",
    task: "煌臨カードの一覧をください",
    tool: "lookup_card",
  },
  { skill: "card-info", task: "そのカードを調べて", tool: "lookup_card" },
  // code-edit
  { skill: "code-edit", task: "BSTH08-X05 を実装して", tool: "apply_edit" },
  { skill: "code-edit", task: "このバグを直して", tool: "apply_edit" },
  { skill: "code-edit", task: "テストを書いて", tool: "write_file" },
  { skill: "code-edit", task: "リファクタしたい", tool: "apply_edit" },
  // git-inspect
  { skill: "git-inspect", task: "今の差分を見せて", tool: "git_diff" },
  { skill: "git-inspect", task: "変更ファイルは?", tool: "git_status" },
  {
    skill: "git-inspect",
    task: "未コミットの変更が知りたい",
    tool: "git_diff",
  },
  // game-state
  { skill: "game-state", task: "盤面の状態は?", tool: "inspect_game_state" },
  { skill: "game-state", task: "合法手を教えて", tool: "legal_actions" },
  { skill: "game-state", task: "次に何ができる?", tool: "legal_actions" },
  { skill: "game-state", task: "手札の中身を確認", tool: "inspect_game_state" },
];

describe("skill auto-trigger coverage", () => {
  it("loads all 5 expected skills (rule-qa + test-fixing + web-research + card-info + code-edit + git-inspect + game-state)", async () => {
    const skills = await loadAllSkills({ root: SKILLS_ROOT });
    const names = new Set(skills.map((s) => s.name));
    expect(names.has("rule-qa")).toBe(true);
    expect(names.has("test-fixing")).toBe(true);
    expect(names.has("web-research")).toBe(true);
    expect(names.has("card-info")).toBe(true);
    expect(names.has("code-edit")).toBe(true);
    expect(names.has("git-inspect")).toBe(true);
    expect(names.has("game-state")).toBe(true);
  });

  for (const c of CASES) {
    it(`${c.skill} activates on "${c.task}" and lists ${c.tool}`, async () => {
      const skills = await loadAllSkills({ root: SKILLS_ROOT });
      const matched = selectMatchingSkills(skills, c.task);
      const found = matched.find((s) => s.name === c.skill);
      expect(
        found,
        `expected ${c.skill} to match "${c.task}" but got ${matched.map((s) => s.name).join(", ") || "none"}`
      ).toBeDefined();
      expect(found!.allowedTools).toContain(c.tool);
    });
  }
});
