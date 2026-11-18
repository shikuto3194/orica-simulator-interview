import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadImages,
  type ImageDownloadProgress,
} from "../src/assets/download-images";
import {
  IMAGE_CACHE_NAME,
  IMAGE_MANIFEST_URL,
  IMAGE_REVISION_HEADER,
  parseImageManifest,
  type ImageAsset,
} from "../src/assets/image-cache-contract";

const origin = "https://orica.test";
function asset(name: string, body: string): ImageAsset {
  return {
    url: "/images/" + name,
    revision: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
  };
}
function harness(assets: ImageAsset[], bodies: Record<string, string>) {
  vi.stubGlobal("location", { origin });
  const saved = new Map<string, Response>();
  const key = (input: string | Request) =>
    new URL(typeof input === "string" ? input : input.url, origin).href;
  const cache = {
    match: vi.fn(async (input: string) => saved.get(key(input))?.clone()),
    put: vi.fn(async (input: string, response: Response) => {
      saved.set(key(input), response.clone());
    }),
    keys: async () => [...saved.keys()].map((url) => new Request(url)),
    delete: vi.fn(async (input: Request) => saved.delete(key(input))),
  };
  const storage = {
    open: vi.fn(async (name: string) => {
      expect(name).toBe(IMAGE_CACHE_NAME);
      return cache;
    }),
  } as unknown as CacheStorage;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === IMAGE_MANIFEST_URL) return Response.json({ schema: 1, assets });
    const body = bodies[url.split("?")[0]!];
    return body === undefined
      ? new Response("", { status: 404 })
      : new Response(body, { headers: { "Content-Type": "image/png" } });
  }) as unknown as typeof fetch;
  const updates: ImageDownloadProgress[] = [];
  const controller = new AbortController();
  const run = () =>
    downloadImages({
      storage,
      fetcher,
      signal: controller.signal,
      onProgress: (value) => updates.push(value),
    });
  return { saved, cache, storage, fetcher, updates, controller, run };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("title image download", () => {
  it("persists verified files and reuses them on the next visit (including dev reloads)", async () => {
    const a = asset("a.png", "aaa"),
      b = asset("b.png", "bbbbb");
    const h = harness([a, b], { [a.url]: "aaa", [b.url]: "bbbbb" });
    await h.run();
    expect(h.updates.at(-1)).toMatchObject({ status: "ready", percent: 100 });
    expect(
      h.updates.some(
        (p) => p.status === "downloading" && p.percent > 0 && p.percent < 100
      )
    ).toBe(true);
    expect(
      h.saved.get(origin + a.url)?.headers.get(IMAGE_REVISION_HEADER)
    ).toBe(a.revision);
    expect(
      [...h.saved.keys()].filter((url) =>
        new URL(url).pathname.startsWith("/images/")
      )
    ).toHaveLength(2);
    vi.mocked(h.fetcher).mockClear();
    await h.run();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.fetcher).toHaveBeenCalledWith(
      IMAGE_MANIFEST_URL,
      expect.objectContaining({ cache: "no-store" })
    );
  });
  it("downloads only modified or evicted files and removes obsolete images after success", async () => {
    const a = asset("a.png", "old"),
      b = asset("b.png", "bbb");
    const assets = [a, b];
    const bodies = { [a.url]: "old", [b.url]: "bbb" };
    const h = harness(assets, bodies);
    await h.run();
    assets[0] = asset("a.png", "new");
    bodies[a.url] = "new";
    h.saved.set(origin + "/images/obsolete.png", new Response("obsolete"));
    vi.mocked(h.fetcher).mockClear();
    await h.run();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(
      await h.saved
        .get(origin + a.url)!
        .clone()
        .text()
    ).toBe("new");
    expect(h.saved.has(origin + "/images/obsolete.png")).toBe(false);
    h.saved.delete(origin + b.url);
    vi.mocked(h.fetcher).mockClear();
    await h.run();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps completed files after a failed download and resumes only the missing file", async () => {
    const a = asset("a.png", "aaa"),
      b = asset("b.png", "bbb");
    const bodies = { [a.url]: "aaa" };
    const h = harness([a, b], bodies);
    await h.run();
    expect(h.updates.at(-1)?.status).toBe("error");
    expect(h.saved.has(origin + a.url)).toBe(true);
    expect(h.saved.has(origin + b.url)).toBe(false);
    bodies[b.url] = "bbb";
    vi.mocked(h.fetcher).mockClear();
    await h.run();
    expect(h.updates.at(-1)?.status).toBe("ready");
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not cache truncated or hash-mismatched files, or overwrite a valid old version", async () => {
    const a = asset("a.png", "abc");
    const h = harness([a], { [a.url]: "bad" });
    h.saved.set(
      origin + a.url,
      new Response("old", { headers: { [IMAGE_REVISION_HEADER]: "old" } })
    );
    await h.run();
    expect(h.updates.at(-1)?.status).toBe("error");
    expect(
      await h.saved
        .get(origin + a.url)!
        .clone()
        .text()
    ).toBe("old");
    expect(h.cache.put).not.toHaveBeenCalled();
  });
  it("reports quota exhaustion without claiming 100% or deleting unrelated data", async () => {
    const a = asset("a.png", "abc");
    const h = harness([a], { [a.url]: "abc" });
    h.cache.put.mockRejectedValue(
      new DOMException("full", "QuotaExceededError")
    );
    await h.run();
    expect(h.updates.at(-1)).toMatchObject({ status: "unavailable" });
    expect(h.updates.at(-1)!.percent).toBeLessThan(100);
    expect(h.updates.at(-1)!.logs).toEqual([]);
    expect(h.cache.delete).not.toHaveBeenCalled();
  });
  it("aborts before network work when the title is left or the user signs out", async () => {
    const h = harness([], {});
    h.controller.abort();
    await expect(h.run()).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "allows downloads longer than a minute while data arrives, but rejects stalled transfers (stalled=%s)",
    async (stalled) => {
      vi.useFakeTimers();
      const a = asset("slow.png", "abc");
      const h = harness([a], {});
      const requests: AbortSignal[] = [];
      vi.mocked(h.fetcher).mockImplementation(async (input, init) => {
        if (String(input) === IMAGE_MANIFEST_URL)
          return Response.json({ schema: 1, assets: [a] });
        const signal = init!.signal!;
        requests.push(signal);
        let timer: ReturnType<typeof setTimeout>;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                controller.error(signal.reason);
              },
              { once: true }
            );
            if (stalled) return;
            let index = 0;
            const next = () => {
              controller.enqueue(new TextEncoder().encode("abc"[index++]!));
              if (index === 3) controller.close();
              else timer = setTimeout(next, 40_000);
            };
            timer = setTimeout(next, 40_000);
          },
        });
        return new Response(body, { headers: { "Content-Type": "image/png" } });
      });
      const pending = h.run();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(stalled ? 180_000 : 120_000);
      await pending;
      expect(requests).toHaveLength(stalled ? 3 : 1);
      expect(h.updates.at(-1)?.status).toBe(stalled ? "error" : "ready");
      expect(h.saved.has(origin + a.url)).toBe(!stalled);
      if (stalled)
        expect(requests.every((signal) => signal.aborted)).toBe(true);
      else
        expect(
          await h.saved
            .get(origin + a.url)!
            .clone()
            .text()
        ).toBe("abc");
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it("rejects malformed manifests and path traversal", () => {
    expect(() =>
      parseImageManifest({ schema: 1, assets: [asset("../outside.png", "a")] })
    ).toThrow();
    expect(() =>
      parseImageManifest({
        schema: 1,
        assets: [asset("%2e%2e/outside.png", "a")],
      })
    ).toThrow();
    expect(() =>
      parseImageManifest({
        schema: 1,
        assets: [asset("a.png", "a"), asset("a.png", "a")],
      })
    ).toThrow();
  });
});
