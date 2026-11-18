import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function resolveNoticeCodex({
  executable,
  env = process.env,
  platform = process.platform,
} = {}) {
  const explicit = executable || env.ORICA_NOTICE_CODEX;
  if (explicit) return explicit;
  if (platform === "win32" && env.LOCALAPPDATA) {
    // Match the supervisor's bundled-first resolution on every invocation;
    // desktop updates replace these version directories.
    const root = join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      entries = [];
    }
    const bundled = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        executable: join(root, entry.name, "codex.exe"),
        modified: statSync(join(root, entry.name)).mtimeMs,
      }))
      .filter((entry) => existsSync(entry.executable))
      .sort((left, right) => right.modified - left.modified);
    if (bundled.length) return bundled[0].executable;
  }
  return "codex";
}
