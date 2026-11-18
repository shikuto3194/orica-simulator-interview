import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createImageManifestReader } from "../server/image-assets";
import { parseAssetManifest } from "../src/assets/asset-contract";
import { isPublicMedia } from "../server/public-build";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (
      !path
        .resolve(folder)
        .startsWith(path.join(tmpdir(), "orica-image-manifest-"))
    )
      throw new Error("Unexpected test directory");
    await rm(folder, { recursive: true, force: true });
  }
});
it("filters public media before hashing and omits development assets from the download inventory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orica-image-manifest-"));
  folders.push(dir);
  await mkdir(path.join(dir, "ForGUI"));
  await mkdir(path.join(dir, "reference"));
  await writeFile(path.join(dir, "ForGUI", "core.png"), "core");
  await writeFile(path.join(dir, "reference", "draft.png"), "draft");
  const manifest = await createImageManifestReader(
    dir,
    "/images",
    undefined,
    (file) => isPublicMedia(`images/${file}`)
  )();
  expect(manifest.assets.map((asset) => asset.url)).toEqual([
    "/images/ForGUI/core.png",
  ]);
  expect((await createImageManifestReader(dir)()).assets).toHaveLength(2);
});
it("uses the same content inventory for audio with explicit supported file types", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orica-image-manifest-"));
  folders.push(dir);
  await writeFile(path.join(dir, "曲.mp3"), "audio");
  await writeFile(path.join(dir, "private.txt"), "unrelated");
  const manifest = await createImageManifestReader(dir, "/sounds", {
    ".mp3": "audio/mpeg",
  })();
  expect(manifest.assets).toEqual([
    {
      url: "/sounds/%E6%9B%B2.mp3",
      bytes: 5,
      revision: createHash("sha256").update("audio").digest("hex"),
    },
  ]);
  expect(
    parseAssetManifest({ ...manifest, revision: "a".repeat(64) }).assets
  ).toEqual(manifest.assets);
});
it("inventories nested image files with URL-safe names and content-based revisions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orica-image-manifest-"));
  folders.push(dir);
  await mkdir(path.join(dir, "作品"));
  await writeFile(path.join(dir, "作品", "a #1.png"), "first");
  await writeFile(path.join(dir, "ignore.mp3"), "audio");
  const read = createImageManifestReader(dir);
  const initial = await read();
  expect(initial.assets).toEqual([
    {
      url: "/images/%E4%BD%9C%E5%93%81/a%20%231.png",
      revision: createHash("sha256").update("first").digest("hex"),
      bytes: 5,
    },
  ]);
  expect(await read()).toEqual(initial);
  await writeFile(path.join(dir, "作品", "a #1.png"), "updated");
  const updated = await read();
  expect(updated.assets[0]!.revision).not.toBe(initial.assets[0]!.revision);
  expect(updated.assets[0]!.bytes).toBe(7);
});
