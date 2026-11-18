import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  startUpstreamWarmth,
  UPSTREAM_WARMTH_INTERVAL_MS,
} from "../server/upstream-warmth";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function okResponse() {
  return new Response(null, { status: 401 });
}

it("pings only while a player is connected, with the public key", async () => {
  let active = false;
  const request = vi.fn(async () => okResponse());
  const stop = startUpstreamWarmth({
    url: "https://db.example/rest/v1/",
    apikey: "public-key",
    isActive: () => active,
    request: request as unknown as typeof fetch,
  });
  await vi.advanceTimersByTimeAsync(UPSTREAM_WARMTH_INTERVAL_MS * 3);
  expect(request).not.toHaveBeenCalled();
  active = true;
  await vi.advanceTimersByTimeAsync(UPSTREAM_WARMTH_INTERVAL_MS * 2);
  expect(request).toHaveBeenCalledTimes(2);
  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://db.example/rest/v1/");
  expect(init.method).toBe("HEAD");
  expect(init.headers).toEqual({ apikey: "public-key" });
  stop();
  await vi.advanceTimersByTimeAsync(UPSTREAM_WARMTH_INTERVAL_MS * 3);
  expect(request).toHaveBeenCalledTimes(2);
});

it("never overlaps pings and survives failures", async () => {
  let release: (() => void) | undefined;
  let calls = 0;
  const request = vi.fn(async () => {
    calls += 1;
    if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
    if (calls === 2) throw new Error("network down");
    return okResponse();
  });
  const stop = startUpstreamWarmth({
    url: "https://db.example/rest/v1/",
    apikey: "k",
    isActive: () => true,
    request: request as unknown as typeof fetch,
  });
  await vi.advanceTimersByTimeAsync(UPSTREAM_WARMTH_INTERVAL_MS * 3);
  expect(request).toHaveBeenCalledTimes(1);
  release?.();
  await vi.advanceTimersByTimeAsync(UPSTREAM_WARMTH_INTERVAL_MS);
  expect(request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(UPSTREAM_WARMTH_INTERVAL_MS);
  expect(request).toHaveBeenCalledTimes(3);
  stop();
});
