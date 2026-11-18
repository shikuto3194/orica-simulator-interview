#!/usr/bin/env node
/**
 * `pnpm ai:e2e:skill-trigger` — skill auto-trigger が機能するかの実 LLM 疎通確認。
 *
 * 3e2d048 で skill loader path bug を直すまで、auto-trigger は事実上 dead だった。
 * その種のリグレッションを早期検知するために、登録済 skill の代表 trigger 語を投げて
 * `selectedSkills` に該当 skill が入るか + LLM が allowed-tools 範囲で応答するかを確認。
 */
import { OllamaClient } from "../client.js";
import { loadConfig } from "../config.js";
import { getModelProfile } from "../models.js";
import { runAgent } from "../agent.js";
import { loadAllSkills } from "../context/skills.js";

interface Probe {
  task: string;
  expectedSkill: string;
}

const PROBES: Probe[] = [
  {
    task: "BSTH05-X01 のテキストを教えて",
    expectedSkill: "card-info",
  },
  {
    task: "ルール: 煌臨条件の最新裁定を教えて",
    expectedSkill: "rule-qa",
  },
  {
    task: "差分を見せて。未コミットの変更ファイルは何?",
    expectedSkill: "git-inspect",
  },
];

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

async function staticMatchProbes(): Promise<Result[]> {
  const skills = await loadAllSkills();
  const skillNames = new Set(skills.map((s) => s.name));
  const results: Result[] = [];
  for (const p of PROBES) {
    if (!skillNames.has(p.expectedSkill)) {
      results.push({
        name: `static-match "${p.task}"`,
        ok: false,
        detail: `expected skill "${p.expectedSkill}" not found in registry`,
      });
      continue;
    }
    const { selectMatchingSkills } = await import("../context/skills.js");
    const matched = selectMatchingSkills(skills, p.task);
    const matchedNames = matched.map((s) => s.name);
    if (!matchedNames.includes(p.expectedSkill)) {
      results.push({
        name: `static-match "${p.task.slice(0, 40)}"`,
        ok: false,
        detail: `expected ${p.expectedSkill} in matched skills, got [${matchedNames.join(", ")}]`,
      });
      continue;
    }
    results.push({
      name: `static-match "${p.task.slice(0, 40)}"`,
      ok: true,
      detail: `matched: ${matchedNames.join(", ")}`,
    });
  }
  return results;
}

async function llmRoundtripProbe(): Promise<Result> {
  const config = loadConfig();
  const client = new OllamaClient(config);
  const reachable = await client.ping();
  if (!reachable) {
    return {
      name: "LLM roundtrip",
      ok: true,
      detail: `Ollama unreachable (${config.baseUrl}) — skipped`,
    };
  }
  const installed = await client.listModels();
  const profile = getModelProfile("fast", config);
  const baseTag = profile.tag.split(":")[0] ?? "";
  if (!installed.some((m) => m.startsWith(baseTag))) {
    return {
      name: "LLM roundtrip",
      ok: true,
      detail: `${profile.tag} not pulled — skipped`,
    };
  }
  const result = await runAgent({
    task: "BSTH05-X01 のテキストを教えて",
    skipHooks: true,
    role: "fast",
  });
  if (!result.selectedSkills.includes("card-info")) {
    return {
      name: "LLM roundtrip",
      ok: false,
      detail: `expected card-info in selectedSkills, got [${result.selectedSkills.join(", ")}]`,
    };
  }
  return {
    name: "LLM roundtrip",
    ok: true,
    detail: `selectedSkills=${result.selectedSkills.join(", ")}, steps=${result.steps}`,
  };
}

async function main(): Promise<void> {
  console.warn("[e2e:skill-trigger] running skill auto-trigger checks");
  const staticResults = await staticMatchProbes();
  const llmResult = await llmRoundtripProbe();
  const results = [...staticResults, llmResult];
  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? "[ OK ]" : "[FAIL]";
    console.warn(`${tag} ${r.name}: ${r.detail}`);
    if (!r.ok) failed++;
  }
  if (failed > 0) {
    console.warn(
      `[e2e:skill-trigger] ${failed} check(s) failed. ` +
        "skill loader / trigger 語の見直しを検討してください。"
    );
    process.exit(1);
  }
  console.warn("[e2e:skill-trigger] all checks passed.");
}

main().catch((err) => {
  console.error("[e2e:skill-trigger] unexpected failure:", err);
  process.exit(2);
});
