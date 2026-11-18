import {
  parseImageManifest,
  type ImageAsset,
  type ImageManifest,
} from "./image-cache-contract";
export const ASSET_MANIFEST_URL = "/asset-manifest.json";
export const ASSET_VERSION_URL = "/asset-version.json";
export const BGM_MANIFEST_URL = "/bgm-manifest.json";
export interface AssetManifest extends ImageManifest {
  revision: string;
}
export function parseAssetManifest(value: unknown): AssetManifest {
  const manifest = value as AssetManifest;
  if (
    !manifest ||
    !/^[a-f0-9]{64}$/.test(manifest.revision) ||
    !Array.isArray(manifest.assets)
  )
    throw new Error("素材一覧が不正です");
  // Reuse the image inventory's traversal, duplicate, hash and size validation.
  const mapped = manifest.assets.map((asset: ImageAsset) => {
    if (
      !asset ||
      typeof asset.url !== "string" ||
      !/^\/(?:images\/|sounds\/|bgm-manifest\.json$)/.test(asset.url)
    )
      throw new Error("素材のパスが不正です");
    return { ...asset, url: "/images/" + asset.url.slice(1) };
  });
  parseImageManifest({ schema: manifest.schema, assets: mapped });
  return manifest;
}
export function assetContentType(url: string) {
  if (url.startsWith("/images/")) return "image/";
  if (url.startsWith("/sounds/")) return "audio/";
  return "application/json";
}
