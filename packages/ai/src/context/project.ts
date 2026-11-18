import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * リポジトリルート (packages/ai/dist/context/ から見て 4 つ上)。
 * 開発時 (src/) からも tsc 出力 (dist/) からも 4 階層上で同じ。
 */
export function defaultRepoRoot(): string {
  return resolve(HERE, "../../../..");
}

export interface ProjectContext {
  /** CLAUDE.md の本文 */
  claudeMd: string;
  /** リポジトリルートの絶対パス */
  repoRoot: string;
}

export interface LoadProjectContextOptions {
  repoRoot?: string;
}

export async function loadProjectContext(
  options: LoadProjectContextOptions = {}
): Promise<ProjectContext> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const claudeMd = await readFile(resolve(repoRoot, "CLAUDE.md"), "utf8").catch(
    () => ""
  );
  return { claudeMd, repoRoot };
}

/**
 * project context を system prompt 用のブロックに整形する。
 * Claude Code が CLAUDE.md を自動注入するのと同じ役割。
 */
export function formatProjectSystemBlock(context: ProjectContext): string {
  if (!context.claudeMd) return "";
  return `# プロジェクト前提 (CLAUDE.md より自動注入)\n\n${context.claudeMd.trim()}`;
}
