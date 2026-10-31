import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openAssetStore,
  type AssetStore,
  type StorageTier,
} from "../src/assets/local-asset-store";
import { parseAssetManifest } from "../src/assets/asset-contract";

function memory() {
  const data = new Map<string, Response>();
  const key = (input: RequestInfo | URL) =>
    input instanceof Request ? input.url : String(input);
  const store: AssetStore = {
    match: vi.fn(async (input) => data.get(key(input))?.clone()),
    put: vi.fn(async (input, response) => {
      data.set(key(input), response.clone());
    }),
    delete: vi.fn(async (input) => data.delete(key(input))),
    keys: vi.fn(async () =>
      [...data.keys()].map((url) => new Request(new URL(url, location.origin)))
    ),
  };
  return { data, store };
}
afterEach(() => vi.unstubAllGlobals());
describe("asset storage fallback", () => {
  it("uses files first, then retries the same verified body in cache when file writes fail", async () => {
    vi.stubGlobal("location", { origin: "https://orica.test" });
    const files = memory(),
      cache = memory();
    const tiers: StorageTier[] = [];
    const store = await openAssetStore(
      (tier) => tiers.push(tier),
      [async () => files.store, async () => cache.store]
    );
    await store.put("/images/a.png", new Response("old"));
    expect(tiers).toEqual(["files"]);
    vi.mocked(files.store.put).mockRejectedValue(
      new DOMException("full", "QuotaExceededError")
    );
    await store.put("/images/a.png", new Response("updated"));
    expect(tiers).toEqual(["files", "cache"]);
    expect(await (await store.match("/images/a.png"))!.text()).toBe("updated");
    expect(await cache.data.get("/images/a.png")!.clone().text()).toBe(
      "updated"
    );
    vi.mocked(cache.store.put).mockRejectedValue(
      new DOMException("full", "QuotaExceededError")
    );
    await expect(
      store.put("/sounds/a.mp3", new Response("audio"))
    ).rejects.toThrow();
    expect(tiers).toEqual(["files", "cache", "stream"]);
  });
  it("handles unavailable APIs and write-probe failure before any downloads", async () => {
    vi.stubGlobal("location", { origin: "https://orica.test" });
    const cache = memory();
    const tiers: StorageTier[] = [];
    const store = await openAssetStore(
      (tier) => tiers.push(tier),
      [
        async () => {
          throw new Error("unsupported");
        },
        async () => cache.store,
      ]
    );
    expect(tiers).toEqual(["cache"]);
    await store.put("/sounds/a.mp3", new Response("audio"));
    expect(await (await store.match("/sounds/a.mp3"))!.text()).toBe("audio");
    vi.mocked(cache.store.put).mockRejectedValue(new Error("denied"));
    await expect(
      openAssetStore(
        (tier) => tiers.push(tier),
        [
          async () => {
            throw new Error("unsupported");
          },
          async () => cache.store,
        ]
      )
    ).rejects.toThrow();
    expect(tiers.at(-1)).toBe("stream");
  });
  it("rejects foreign URLs, traversals, duplicates and malformed revisions in combined inventories", () => {
    const entry = { url: "/sounds/a.mp3", revision: "a".repeat(64), bytes: 10 };
    const manifest = { schema: 1, revision: "b".repeat(64), assets: [entry] };
    expect(parseAssetManifest(manifest)).toEqual(manifest);
    for (const url of [
      "https://evil.test/a.mp3",
      "/sounds/%2e%2e/a",
      "/api/game/state",
      "/sounds/a?query",
    ]) {
      expect(() =>
        parseAssetManifest({ ...manifest, assets: [{ ...entry, url }] })
      ).toThrow();
    }
    expect(() =>
      parseAssetManifest({ ...manifest, assets: [entry, entry] })
    ).toThrow();
  });
});
