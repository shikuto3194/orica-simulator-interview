/** Shared by the downloader, manifest producer and Workbox configuration. */
export const IMAGE_CACHE_NAME = "orica-images-v1";
export const IMAGE_MANIFEST_URL = "/image-manifest.json";
export const IMAGE_REVISION_HEADER = "X-Orica-Image-Revision";
export const IMAGE_VERIFIED_HEADER = "X-Orica-Image-Verified";

export interface ImageAsset {
  url: string;
  revision: string;
  bytes: number;
}

export interface ImageManifest {
  schema: 1;
  assets: ImageAsset[];
}

export function parseImageManifest(value: unknown): ImageManifest {
  const manifest = value as Partial<ImageManifest> | null;
  if (manifest?.schema !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error("画像一覧を読み込めませんでした");
  }
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (
      !asset ||
      typeof asset.url !== "string" ||
      !/^\/images\/[^?#]+$/.test(asset.url) ||
      !/^[a-f0-9]{64}$/.test(asset.revision) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      seen.has(asset.url)
    )
      throw new Error("画像一覧が不正です");
    const decoded = decodeURIComponent(asset.url);
    if (
      decoded.includes("\\") ||
      decoded.split("/").some((p) => p === "." || p === "..")
    ) {
      throw new Error("画像のパスが不正です");
    }
    seen.add(asset.url);
  }
  return manifest as ImageManifest;
}
