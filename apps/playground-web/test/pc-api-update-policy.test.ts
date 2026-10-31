import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import {
  readUpdateFailure,
  recordUpdateFailure,
  shouldAttemptUpdate,
  waitForApiReady,
} from "../../../deploy/local-pc/update-policy.mjs";

it("persists bounded per-revision backoff across process restarts and allows a new revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "orica-update-policy-"));
  try {
    const path = join(root, "failure.json");
    expect(await readUpdateFailure(path)).toBeNull();
    let previous = null;
    let now = 0;
    for (const wait of [60_000, 300_000, 900_000, 1_800_000, 1_800_000]) {
      await recordUpdateFailure(path, previous, "a".repeat(40), now);
      previous = await readUpdateFailure(path);
      expect(previous.retryAt).toBe(now + wait);
      expect(
        shouldAttemptUpdate(previous, "a".repeat(40), now + wait - 1)
      ).toBe(false);
      expect(shouldAttemptUpdate(previous, "a".repeat(40), now + wait)).toBe(
        true
      );
      expect(shouldAttemptUpdate(previous, "b".repeat(40), now)).toBe(true);
      now += wait;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("requires readyz and the exact candidate revision within one total deadline", async () => {
  let time = 0;
  const fetch = vi.fn(async (url: string) => {
    expect(url).toBe("http://127.0.0.1:1/readyz");
    time += 900;
    return { ok: true, json: async () => ({ ok: true, revision: "old" }) };
  });
  const options = {
    timeoutMs: 2000,
    now: () => time,
    fetch,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
  await expect(
    waitForApiReady("http://127.0.0.1:1", "new", () => true, options)
  ).rejects.toThrow("timed out");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(time).toBe(2000);
  time = 0;
  fetch.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => ({ ok: true, revision: "new" }),
  }));
  await waitForApiReady("http://127.0.0.1:1", "new", () => true, options);
});

it("retains a pre-build attempt after interruption and converts it to a bounded failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "orica-interrupted-update-"));
  try {
    const path = join(root, "failure.json");
    await recordUpdateFailure(path, null, "a".repeat(40), 1000, "attempting");
    const recovered = await readUpdateFailure(path);
    expect(recovered.status).toBe("attempting");
    const failed = await recordUpdateFailure(
      path,
      recovered,
      recovered.revision,
      100_000
    );
    expect(failed.attempt).toBe(1);
    expect(failed.retryAt).toBe(160_000);
    expect(shouldAttemptUpdate(failed, recovered.revision, 100_000)).toBe(
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
