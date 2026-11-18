#!/usr/bin/env node
/**
 * `pnpm ai:lint` — packages/ai 配下の skills/commands frontmatter と registry tool 一覧の
 * 整合性をチェックする静的 lint。
 *
 * 検出項目:
 *  - skill / command の name 欠落
 *  - skill / command の allowed-tools が registry に存在しない tool 名
 *  - skill の triggers が空 or 重複
 *  - skill / command の name と frontmatter `name:` 不一致
 *  - 同名 skill / command の重複
 *
 * 失敗時は exit 1。CI / pre-push に組み込み可能。
 */
import { buildDefaultRegistry } from "../tools/registry.js";
import { loadAllSkills } from "../context/skills.js";
import { loadAllCommands } from "../context/commands.js";

async function main(): Promise<void> {
  // すべての tool を含む registry を作る (web / write 両方)
  const registry = buildDefaultRegistry({
    env: {},
    includeWebTools: true,
    includeWriteTools: true,
  });
  const toolNames = new Set(registry.list().map((t) => t.name));
  const failures: string[] = [];

  const skills = await loadAllSkills();
  const skillNames = new Set<string>();
  for (const s of skills) {
    const base = s.path.replace(/.*[\\/]/, "").replace(/\.md$/, "");
    if (!s.name) {
      failures.push(`[skill] ${s.path}: name が空`);
    }
    if (s.name && s.name !== base) {
      failures.push(
        `[skill] ${s.path}: frontmatter name="${s.name}" がファイル名 "${base}" と不一致`
      );
    }
    if (skillNames.has(s.name)) {
      failures.push(`[skill] ${s.path}: name "${s.name}" は重複`);
    }
    skillNames.add(s.name);
    if (s.triggers.length === 0) {
      failures.push(`[skill] ${s.path}: triggers が空 (auto-trigger できない)`);
    }
    const triggerSeen = new Set<string>();
    for (const t of s.triggers) {
      const k = t.toLowerCase();
      if (triggerSeen.has(k)) {
        failures.push(`[skill] ${s.path}: trigger "${t}" が重複`);
      }
      triggerSeen.add(k);
    }
    for (const tool of s.allowedTools) {
      if (!toolNames.has(tool)) {
        failures.push(
          `[skill] ${s.path}: allowed-tools "${tool}" は registry に存在しない (typo?)`
        );
      }
    }
  }

  const commands = await loadAllCommands();
  const commandNames = new Set<string>();
  for (const c of commands) {
    const base = c.path.replace(/.*[\\/]/, "").replace(/\.md$/, "");
    if (!c.name) {
      failures.push(`[command] ${c.path}: name が空`);
    }
    if (c.name && c.name !== base) {
      failures.push(
        `[command] ${c.path}: frontmatter name="${c.name}" がファイル名 "${base}" と不一致`
      );
    }
    if (commandNames.has(c.name)) {
      failures.push(`[command] ${c.path}: name "${c.name}" は重複`);
    }
    commandNames.add(c.name);
    for (const tool of c.allowedTools) {
      if (!toolNames.has(tool)) {
        failures.push(
          `[command] ${c.path}: allowed-tools "${tool}" は registry に存在しない (typo?)`
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("ai:lint failed:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.warn(
    `ai:lint passed: ${skills.length} skill(s), ${commands.length} command(s), ${toolNames.size} tool(s).`
  );
}

main().catch((err) => {
  console.error("ai:lint crashed:", err);
  process.exit(2);
});
