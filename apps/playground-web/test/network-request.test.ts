import { afterEach, expect, it, vi } from "vitest";
import { boundedJsonRequest, retryDelayMs } from "../src/networkRequest";
import { fetchWithAuthRetry } from "../src/authFetch";
import {
  readPendingMutation,
  writePendingMutation,
} from "../src/roomMutationJournal";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("deadline covers authentication and a response body that never completes", async () => {
  vi.useFakeTimers();
  for (const request of [
    () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const result = boundedJsonRequest(request, "/test", undefined, 100);
    const rejected = expect(result).rejects.toThrow("時間内");
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
  }
});
it("concurrent 401 responses share one refresh and preserve command bodies", async () => {
  let finish!: (token: string) => void;
  const refresh = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const fetcher = vi.fn(
    async (_url, init) =>
      new Response("{}", {
        status:
          new Headers(init.headers).get("Authorization") === "Bearer new"
            ? 200
            : 401,
      })
  );
  const source = {
    getAccessToken: async () => "old",
    refreshAccessToken: refresh,
  };
  const tasks = Array.from({ length: 5 }, () =>
    fetchWithAuthRetry(
      "/action",
      { method: "POST", body: "same" },
      source,
      fetcher
    )
  );
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  finish("new");
  expect((await Promise.all(tasks)).every((response) => response.ok)).toBe(
    true
  );
  expect(fetcher.mock.calls.every((call) => call[1].body === "same")).toBe(
    true
  );
});
it("respects Retry-After and bounds exponential retry growth", () => {
  expect(retryDelayMs("60", 1)).toBe(60_000);
  expect(retryDelayMs(null, 1000)).toBeLessThanOrEqual(12_500);
});
it("journal survives reload, isolates accounts and never stores state or credentials implicitly", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  const pending = {
    path: "step",
    payload: {},
    version: 7,
    id: "original",
    retryAt: 0,
  };
  writePendingMutation("alice:room", pending);
  expect(readPendingMutation("alice:room")).toEqual({
    ...pending,
    uncertain: true,
  });
  expect(readPendingMutation("bob:room")).toBeNull();
  writePendingMutation("alice:room", null);
  expect(readPendingMutation("alice:room")).toBeNull();
});

it("a hung refresh expires so the next reconnect can refresh successfully", async () => {
  vi.useFakeTimers();
  const source = {
    getAccessToken: async () => "old",
    refreshAccessToken: vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue("new"),
  };
  const fetcher = vi.fn(
    async (_url, init) =>
      new Response("{}", {
        status:
          new Headers(init.headers).get("Authorization") === "Bearer new"
            ? 200
            : 401,
      })
  );
  const first = fetchWithAuthRetry("/state", undefined, source, fetcher);
  const failure = expect(first).rejects.toThrow("認証");
  await vi.advanceTimersByTimeAsync(7_001);
  await failure;
  expect(
    (await fetchWithAuthRetry("/state", undefined, source, fetcher)).ok
  ).toBe(true);
  expect(source.refreshAccessToken).toHaveBeenCalledTimes(2);
});
