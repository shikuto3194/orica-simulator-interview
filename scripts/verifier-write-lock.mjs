/** Serialize verifier artifact mutations with publication's existing merge lock. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { runWithLockHeartbeat } from "./run-with-lock-heartbeat.mjs";

const lockScript = fileURLToPath(
  new URL("./supervisor-lock.mjs", import.meta.url)
);
export const VERIFIER_WRITE_LOCK_PROTOCOL = 1;

const ownerFlag = "--verifier-write-owner";
const parentFlag = "--verifier-write-parent";

function lock(command, token, extra = [], env = process.env) {
  const result = spawnSync(
    process.execPath,
    [lockScript, command, "--lane", "merge", "--token", token, ...extra],
    {
      env,
      windowsHide: true,
      shell: false,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 65536,
    }
  );
  if (result.status !== 0)
    throw new Error(
      "Verifier/publication merge lock " +
        command +
        " failed: " +
        (result.error?.message ||
          result.stderr?.trim() ||
          result.stdout?.trim() ||
          "exit " + result.status)
    );
}

// A separate parent keeps heartbeat alive while the writer uses synchronous I/O
// or exits directly on invalid evidence. Never inherit a publisher's token.
export async function runVerifierWriter(scriptUrl, action) {
  const args = process.argv.slice(2);
  const index = args.indexOf(ownerFlag);
  if (index !== -1 || args.includes(parentFlag)) {
    if (
      index < 0 ||
      index !== args.length - 4 ||
      args[index + 2] !== parentFlag ||
      args.lastIndexOf(ownerFlag) !== index ||
      args.lastIndexOf(parentFlag) !== index + 2 ||
      args[index + 3] !== String(process.ppid)
    )
      throw new Error("Invalid verifier writer parent binding");
    lock("refresh", args[index + 1]);
    await action();
    return 0;
  }
  const token = randomUUID();
  const script = fileURLToPath(scriptUrl);
  return await runMergeLockedCommand({
    token,
    label: "verifier-write " + basename(script),
    command: process.execPath,
    args: [script, ...args, ownerFlag, token, parentFlag, String(process.pid)],
  });
}

export async function runMergeLockedCommand({
  token = randomUUID(),
  label,
  command,
  args = [],
  env = process.env,
  onChild = () => {},
  onSuccess = () => {},
  onStderr,
}) {
  // Fail before touching artifacts if publication is already in progress. A
  // nested hook writer must not deadlock its publisher by waiting for that lock.
  lock("acquire", token, ["--ttl", "20", "--wait", "0", "--label", label], env);
  try {
    const code = await runWithLockHeartbeat({
      lockScript,
      lane: "merge",
      token,
      command,
      args,
      env,
      onChild,
      onStderr,
    });
    if (code === 0) {
      lock("refresh", token, [], env);
      onSuccess(); // Synchronous final persistence while ownership is retained.
    }
    return code;
  } finally {
    lock("release", token, [], env);
  }
}
