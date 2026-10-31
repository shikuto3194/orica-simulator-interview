#!/usr/bin/env node
/** Run a native command while retaining an existing supervisor owner token. */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { clearInterval, setInterval } from "node:timers";

// Call only with the ChildProcess this caller started. Never enumerate or stop
// other workers, and never target a PID after observing the child's exit.
export function terminateOwnedChild(child, { processGroup = false } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return { stopped: true };
  }
  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, encoding: "utf8", timeout: 10000, shell: false }
    );
    if (result.status === 0) return { stopped: true };
    // The direct child may have finished while taskkill was being launched.
    try {
      process.kill(child.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return { stopped: true };
    }
    return {
      stopped: false,
      error:
        result.error?.message || result.stderr?.trim() || "taskkill failed",
    };
  }
  try {
    if (processGroup) process.kill(-child.pid, "SIGKILL");
    else if (!child.kill("SIGKILL"))
      return { stopped: false, error: "child termination failed" };
    return { stopped: true };
  } catch (error) {
    if (error.code === "ESRCH") return { stopped: true };
    return { stopped: false, error: error.message };
  }
}

export async function runWithLockHeartbeat({
  lockScript = fileURLToPath(new URL("./supervisor-lock.mjs", import.meta.url)),
  lane,
  token,
  intervalMs = 30000,
  command,
  args = [],
  env = process.env,
  onChild = () => {},
  onStderr,
}) {
  if (!lane || !token || !command)
    throw new Error("lane, token and command are required");
  if (!Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 60000) {
    throw new Error("heartbeat interval must be between 50 and 60000 ms");
  }
  const refresh = () => {
    const result = spawnSync(
      process.execPath,
      [lockScript, "refresh", "--lane", lane, "--token", token],
      {
        env,
        windowsHide: true,
        shell: false,
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 65536,
      }
    );
    if (result.status === 0) return true;
    console.error(
      `[lock-command:${lane}] lock heartbeat failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`
    );
    return false;
  };

  // Refuse to launch even a short command if ownership has already changed.
  if (!refresh()) return 3;
  let failureCode = 0;
  let timer;
  const child = spawn(command, args, {
    env,
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
    stdio: onStderr ? ["inherit", "inherit", "pipe"] : "inherit",
  });
  const stop = (code) => {
    if (failureCode) return;
    failureCode = code;
    clearInterval(timer);
    const result = terminateOwnedChild(child, { processGroup: true });
    if (!result.stopped) {
      console.error(
        `[lock-command:${lane}] own command cleanup failed: ${result.error}`
      );
    }
  };
  const onInterrupt = () => stop(130);
  const onTerminate = () => stop(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  timer = setInterval(() => {
    if (!refresh()) stop(3);
  }, intervalMs);
  let commandCode;
  try {
    commandCode = await new Promise((resolve) => {
      child.once("error", (error) => {
        console.error(
          `[lock-command:${lane}] command failed: ${error.message}`
        );
        resolve(1);
      });
      child.once("close", (code) => resolve(code ?? 1));
      if (onStderr)
        child.stderr.on("data", (bytes) => {
          process.stderr.write(bytes);
          try {
            onStderr(bytes.toString());
          } catch {
            stop(1);
          }
        });
      try {
        onChild(child);
      } catch (error) {
        console.error(
          `[lock-command:${lane}] child registration failed: ${error.message}`
        );
        stop(1);
      }
    });
  } finally {
    clearInterval(timer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    onChild(null);
  }
  // A command finishing between heartbeats must not conceal a lost lock.
  if (failureCode) return failureCode;
  if (!refresh()) return 3;
  return commandCode;
}

async function main() {
  const argv = process.argv.slice(2);
  const separator = argv.indexOf("--");
  if (separator < 0)
    throw new Error("expected -- followed by a native command");
  const options = {};
  const names = {
    "--lock-script": "lockScript",
    "--lane": "lane",
    "--token": "token",
    "--interval-ms": "intervalMs",
  };
  for (let index = 0; index < separator; index += 2) {
    const key = names[argv[index]];
    if (!key || index + 1 >= separator)
      throw new Error(`invalid option: ${argv[index]}`);
    options[key] =
      key === "intervalMs" ? Number(argv[index + 1]) : argv[index + 1];
  }
  process.exitCode = await runWithLockHeartbeat({
    ...options,
    command: argv[separator + 1],
    args: argv.slice(separator + 2),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`[lock-command] ${error.message}`);
    process.exitCode = 2;
  });
}
