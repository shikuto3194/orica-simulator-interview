import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prepareAssets } from "../src/assets/prepare-assets";
import { openAssetStore } from "../src/assets/local-asset-store";
import { IMAGE_REVISION_HEADER } from "../src/assets/image-cache-contract";
import type { ImageDownloadProgress } from "../src/assets/download-images";

vi.mock("../src/assets/local-asset-store", () => ({ openAssetStore: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("shows and saves newly added audio after a complete previous installation", async () => {
  vi.stubGlobal("location", { origin: "https://orica.test" });
  vi.stubGlobal("navigator", {
    serviceWorker: { controller: {} },
    storage: {},
  });
  const old = { schema: 1, revision: "a".repeat(64), assets: [] };
  const body = "new audio";
  const asset = {
    url: "/sounds/music/new.m4a",
    bytes: body.length,
    revision: createHash("sha256").update(body).digest("hex"),
  };
  const latest = { ...old, revision: "b".repeat(64), assets: [asset] };
  const saved = new Map([["/asset-manifest.json", Response.json(old)]]);
  vi.mocked(openAssetStore).mockResolvedValue({
    match: async (input) => saved.get(String(input))?.clone(),
    put: async (input, response) => {
      saved.set(String(input), response.clone());
    },
    keys: async () => [],
    delete: async () => true,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/asset-version.json")
        return Response.json({ revision: latest.revision });
      if (url === "/asset-manifest.json") return Response.json(latest);
      return new Response(body, { headers: { "Content-Type": "audio/mp4" } });
    })
  );
  const progress: ImageDownloadProgress[] = [];
  await prepareAssets({
    signal: new AbortController().signal,
    onProgress: (value) => progress.push(value),
  });
  expect(progress[0]?.status).toBe("ready");
  expect(progress.some((value) => value.status === "downloading")).toBe(true);
  expect(progress.at(-1)?.status).toBe("ready");
  expect(saved.get(asset.url)?.headers.get(IMAGE_REVISION_HEADER)).toBe(
    asset.revision
  );
  expect(await saved.get("/asset-manifest.json")!.json()).toEqual(latest);
});
