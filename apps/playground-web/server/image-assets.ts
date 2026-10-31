import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import {
  assertPublicBgmAssets,
  assertPublicCardImages,
  isPublicMedia,
} from "./public-build";
import {
  IMAGE_MANIFEST_URL,
  type ImageManifest,
} from "../src/assets/image-cache-contract";
import {
  ASSET_MANIFEST_URL,
  ASSET_VERSION_URL,
  BGM_MANIFEST_URL,
  type AssetManifest,
} from "../src/assets/asset-contract";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Stat memoization avoids rehashing the entire image library on each visit. */
export function createImageManifestReader(
  imagesRoot: string,
  prefix = "/images",
  types = IMAGE_TYPES,
  include: (relativePath: string) => boolean = () => true
) {
  const hashes = new Map<string, { stamp: string; revision: string }>();
  let inFlight: Promise<ImageManifest> | undefined;
  async function scan(): Promise<ImageManifest> {
    const assets: ImageManifest["assets"] = [];
    async function visit(directory: string) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (
          directory === imagesRoot &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
          return;
        throw error;
      }
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name, "en")
      )) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(file);
          continue;
        }
        if (!entry.isFile() || !types[path.extname(entry.name).toLowerCase()])
          continue;
        if (!include(path.relative(imagesRoot, file).split(path.sep).join("/")))
          continue;
        const info = await stat(file);
        const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
        let revision =
          hashes.get(file)?.stamp === stamp
            ? hashes.get(file)!.revision
            : undefined;
        if (!revision) {
          const hash = createHash("sha256");
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          revision = hash.digest("hex");
          hashes.set(file, { stamp, revision });
        }
        assets.push({
          url: `${prefix}/${path.relative(imagesRoot, file).split(path.sep).map(encodeURIComponent).join("/")}`,
          revision,
          bytes: info.size,
        });
      }
    }
    await visit(imagesRoot);
    return { schema: 1, assets };
  }
  return () => {
    inFlight ??= scan().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

/** One inventory serves dev and is copied, with its images, into production dist. */
export function imageAssetsPlugin(projectRoot: string): Plugin {
  let publicBuild = false;
  const imagesRoot = path.join(projectRoot, "images");
  const readManifest = createImageManifestReader(
    imagesRoot,
    "/images",
    IMAGE_TYPES,
    (file) =>
      !/^BS[^/]+\.png$/i.test(file) &&
      (file.startsWith("title/")
        ? isPublicMedia(`images/${file}`)
        : !publicBuild || isPublicMedia(`images/${file}`))
  );
  const soundsRoot = path.join(projectRoot, "sounds");
  const audioTypes = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
  };
  const readSounds = createImageManifestReader(
    soundsRoot,
    "/sounds",
    audioTypes,
    (file) =>
      file.startsWith("music/")
        ? isPublicMedia(`sounds/${file}`)
        : !publicBuild || isPublicMedia(`sounds/${file}`)
  );
  async function mediaInventory() {
    const [images, sounds] = await Promise.all([readManifest(), readSounds()]);
    if (publicBuild)
      assertPublicCardImages(
        images.assets.map((asset) => decodeURIComponent(asset.url.slice(1)))
      );
    const imagesByDir: Record<string, string[]> = {};
    const musicByDir: Record<string, string[]> = {};
    for (const [manifest, prefix, groups] of [
      [images, "/images/title/", imagesByDir],
      [sounds, "/sounds/music/", musicByDir],
    ] as const) {
      for (const asset of manifest.assets) {
        if (!asset.url.startsWith(prefix)) continue;
        const parts = asset.url
          .slice(prefix.length)
          .split("/")
          .map(decodeURIComponent);
        if (parts.length === 2) (groups[parts[0]!] ??= []).push(parts[1]!);
      }
    }
    if (publicBuild) assertPublicBgmAssets(imagesByDir, musicByDir);
    const bgm = JSON.stringify({ imagesByDir, musicByDir });
    const assets = [
      ...images.assets,
      ...sounds.assets,
      {
        url: BGM_MANIFEST_URL,
        bytes: Buffer.byteLength(bgm),
        revision: createHash("sha256").update(bgm).digest("hex"),
      },
    ];
    const manifest: AssetManifest = {
      schema: 1,
      assets,
      revision: createHash("sha256")
        .update(JSON.stringify(assets))
        .digest("hex"),
    };
    return { images, bgm, manifest };
  }
  let outputRoot = "";
  let builtManifest: ImageManifest;
  let builtAssets: AssetManifest;
  return {
    name: "image-assets",
    configResolved(config) {
      publicBuild = config.command === "build";
      outputRoot = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (
          [
            ASSET_MANIFEST_URL,
            ASSET_VERSION_URL,
            BGM_MANIFEST_URL,
            "/api/bgm-manifest",
          ].includes(pathname)
        ) {
          void mediaInventory()
            .then(({ manifest, bgm }) => {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(
                pathname === ASSET_MANIFEST_URL
                  ? JSON.stringify(manifest)
                  : pathname === ASSET_VERSION_URL
                    ? JSON.stringify({ revision: manifest.revision })
                    : bgm
              );
            })
            .catch(next);
          return;
        }
        if (pathname === IMAGE_MANIFEST_URL) {
          void readManifest()
            .then((manifest) => {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(JSON.stringify(manifest));
            })
            .catch(next);
          return;
        }
        const isSound = pathname.startsWith("/sounds/");
        if (!isSound && !pathname.startsWith("/images/")) {
          next();
          return;
        }
        let relativePath: string;
        try {
          relativePath = decodeURIComponent(
            pathname.slice(isSound ? "/sounds/".length : "/images/".length)
          );
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }
        const sourceRoot = isSound ? soundsRoot : imagesRoot;
        const file = path.resolve(sourceRoot, relativePath);
        if (!file.startsWith(sourceRoot + path.sep)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        void stat(file)
          .then((info) => {
            if (!info.isFile()) {
              next();
              return;
            }
            res.setHeader(
              "Content-Type",
              (isSound ? (audioTypes as Record<string, string>) : IMAGE_TYPES)[
                path.extname(file).toLowerCase()
              ] ?? "application/octet-stream"
            );
            res.setHeader("Content-Length", info.size);
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Accept-Ranges", "bytes");
            let start = 0,
              end = info.size - 1;
            if (req.headers.range) {
              const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
              if (match && (match[1] || match[2])) {
                start = match[1]
                  ? Number(match[1])
                  : Math.max(0, info.size - Number(match[2]));
                end =
                  match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
              } else start = info.size;
              if (start > end || start >= info.size) {
                res.writeHead(416, {
                  "Content-Range": `bytes */${info.size}`,
                  "Content-Length": "0",
                });
                res.end();
                return;
              }
              res.statusCode = 206;
              res.setHeader(
                "Content-Range",
                `bytes ${start}-${end}/${info.size}`
              );
              res.setHeader("Content-Length", end - start + 1);
            }
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            const stream = createReadStream(file, { start, end });
            res.on("close", () => stream.destroy());
            stream.on("error", next).pipe(res);
          })
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              res.statusCode = 404;
              res.end();
            } else next(error);
          });
      });
    },
    async generateBundle() {
      const inventory = await mediaInventory();
      builtManifest = inventory.images;
      builtAssets = inventory.manifest;
      for (const [url, source] of [
        [ASSET_MANIFEST_URL, JSON.stringify(builtAssets)],
        [ASSET_VERSION_URL, JSON.stringify({ revision: builtAssets.revision })],
        [BGM_MANIFEST_URL, inventory.bgm],
      ]) {
        this.emitFile({
          type: "asset",
          fileName: url!.slice(1),
          source: source!,
        });
      }
      this.emitFile({
        type: "asset",
        fileName: IMAGE_MANIFEST_URL.slice(1),
        source: JSON.stringify(builtManifest),
      });
    },
    async writeBundle() {
      // Copy one file at a time: no multi-gigabyte Rollup buffers or duplicate copies in memory.
      for (const asset of builtAssets.assets) {
        if (asset.url === BGM_MANIFEST_URL) continue;
        const isSound = asset.url.startsWith("/sounds/");
        const prefix = isSound ? "/sounds/" : "/images/";
        const relativePath = decodeURIComponent(asset.url.slice(prefix.length));
        const target = path.join(outputRoot, prefix.slice(1), relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(
          path.join(isSound ? soundsRoot : imagesRoot, relativePath),
          target
        );
      }
    },
  };
}
