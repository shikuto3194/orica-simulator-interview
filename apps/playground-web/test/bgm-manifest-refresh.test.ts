import { afterEach, expect, it, vi } from "vitest";
import { fetchWorkAssets } from "../src/bgm/manifest";
import { readLocalAsset } from "../src/assets/local-asset-store";

vi.mock("../src/assets/local-asset-store", () => ({ readLocalAsset: vi.fn() }));
vi.mock("../src/assets/prepare-assets", () => ({
  waitForAssetPreparation: vi.fn(),
}));

const catalog = {
  imagesByDir: { koumakyo: ["title.webp"] },
  musicByDir: { 紅魔郷: ["タイトル.m4a"] },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("recovers the old public deployment's empty saved catalog from the network", async () => {
  vi.mocked(readLocalAsset).mockResolvedValue(
    Response.json({ imagesByDir: {}, musicByDir: {} })
  );
  const fetch = vi.fn().mockResolvedValue(Response.json(catalog));
  vi.stubGlobal("fetch", fetch);
  const works = await fetchWorkAssets();
  expect(fetch).toHaveBeenCalledWith(
    "/bgm-manifest.json?refresh=empty-catalog",
    expect.objectContaining({ cache: "no-store" })
  );
  expect(works).toHaveLength(1);
  expect(works[0]!.imageUrls).toEqual(["/images/title/koumakyo/title.webp"]);
  expect(works[0]!.titleTracks[0]!.url).toMatch(/\.m4a$/);
});

it("keeps a usable saved catalog available offline without a refresh request", async () => {
  vi.mocked(readLocalAsset).mockResolvedValue(Response.json(catalog));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await fetchWorkAssets()).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("still allows startup when an empty saved catalog cannot be refreshed", async () => {
  vi.mocked(readLocalAsset).mockResolvedValue(
    Response.json({ imagesByDir: {}, musicByDir: {} })
  );
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  expect(await fetchWorkAssets()).toEqual([]);
});
