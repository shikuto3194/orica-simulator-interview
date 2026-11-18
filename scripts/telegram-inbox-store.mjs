import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Only local persistence belongs inside this short transaction; never an agent run or network request.
export function withInboxMutation(repo, mutate) {
  const token = randomUUID();
  const env = {
    ...process.env,
    ORICA_SUPERVISOR_LOCK: join(
      repo,
      "logs",
      "codex-telegram-inbox",
      "mutation.lock.json"
    ),
  };
  const lock = (command) =>
    spawnSync(
      process.execPath,
      [
        join(dirname(fileURLToPath(import.meta.url)), "supervisor-lock.mjs"),
        command,
        "--lane",
        "telegram-mutation",
        "--token",
        token,
        "--ttl",
        "1",
        "--wait",
        "5",
      ],
      { env, encoding: "utf8", windowsHide: true }
    );
  const acquired = lock("acquire");
  if (acquired.status !== 0)
    throw new Error(
      acquired.stderr || acquired.stdout || "inbox mutation lock failed"
    );
  try {
    return mutate();
  } finally {
    lock("release");
  }
}
