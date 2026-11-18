import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const delays = [60_000, 300_000, 900_000, 1_800_000];
export async function readUpdateFailure(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      !/^[a-f0-9]{40}$/.test(value.revision) ||
      !Number.isSafeInteger(value.attempt) ||
      value.attempt < 1 ||
      !Number.isFinite(value.retryAt)
    )
      throw new Error("Invalid API update failure receipt");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function shouldAttemptUpdate(failure, revision, now = Date.now()) {
  return !failure || failure.revision !== revision || now >= failure.retryAt;
}
export async function recordUpdateFailure(
  path,
  previous,
  revision,
  now = Date.now(),
  status = "failed"
) {
  const attempt =
    previous?.revision === revision
      ? previous.attempt +
        (previous.status === "attempting" && status === "failed" ? 0 : 1)
      : 1;
  const receipt = {
    revision,
    attempt,
    status,
    failedAt: now,
    retryAt: now + delays[Math.min(attempt - 1, delays.length - 1)],
  };
  // One supervisor owns this file. Do not persist exception messages or secrets.
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".tmp", JSON.stringify(receipt) + "\n");
  await rename(path + ".tmp", path);
  return receipt;
}

/** One absolute deadline covers network time AND delays, including rollback. */
export async function waitForApiReady(
  base,
  revision,
  alive,
  {
    timeoutMs = 15_000,
    now = () => globalThis.performance.now(),
    fetch = globalThis.fetch,
    sleep = delay,
  } = {}
) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!alive()) throw new Error("API exited during startup");
    try {
      const response = await fetch(`${base}/readyz`, {
        signal: globalThis.AbortSignal.timeout(
          Math.max(1, Math.min(1000, Math.ceil(deadline - now())))
        ),
      });
      const health = await response.json();
      if (
        now() < deadline &&
        response.ok &&
        health.ok === true &&
        health.revision === revision &&
        alive()
      )
        return;
    } catch {
      /* bounded startup retry */
    }
    if (now() < deadline) await sleep(Math.min(100, deadline - now()));
  }
  throw new Error("API readiness/revision check timed out");
}
