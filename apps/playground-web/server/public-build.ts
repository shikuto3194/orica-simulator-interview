import path from "node:path";
import { readdir } from "node:fs/promises";
import type { Plugin } from "vite";
import { expandCardDefinitionsWithBackFaces } from "../../../packages/rules-core/src/effect/structured-effect-registrations";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { AVATARS, avatarSrc, avatarFullBodySrc } from "../src/avatars";
import { WORKS } from "../src/bgm/works";

// Publish only runtime media. A new folder under images/ is not automatically public.
const cardImageFiles = new Set(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).flatMap((card) =>
    card.image ? [card.image] : []
  )
);
const imageFiles = new Set([
  ...cardImageFiles,
  ...AVATARS.map((avatar) => avatarSrc(avatar.id).slice(1)),
  ...AVATARS.map((avatar) => avatarFullBodySrc(avatar.id).slice(1)),
  "images/ForGUI/card-back.jpg",
  "images/ForGUI/core.png",
  "images/ForGUI/soul-core.png",
  ...["tsuchi", "hi", "mizu", "kaze", "toki", "sora", "maboroshi"].map(
    (name) => `images/zokuseichi/${name}.png`
  ),
]);
const imageDirs = new Set(WORKS.map((work) => work.imageDir));
const musicDirs = new Set(WORKS.map((work) => work.musicDir));

export function assertPublicCardImages(files: Iterable<string>): void {
  const available = new Set(files);
  const missing = [...cardImageFiles].filter((file) => !available.has(file));
  if (missing.length)
    throw new Error(`Missing public card images:\n${missing.join("\n")}`);
}

/** Every registered work must ship its Git-managed background and audio. */
export function assertPublicBgmAssets(
  imagesByDir: Record<string, string[]>,
  musicByDir: Record<string, string[]>
): void {
  const missing = WORKS.flatMap((work) => [
    ...(!imagesByDir[work.imageDir]?.length
      ? [`images/title/${work.imageDir}`]
      : []),
    ...(!musicByDir[work.musicDir]?.length
      ? [`sounds/music/${work.musicDir}`]
      : []),
  ]);
  if (missing.length)
    throw new Error(
      `Missing public BGM assets:\n${missing.join("\n")}\nRestore the Git-managed WebP/M4A files, or restore originals with pnpm fetch-bgm-assets and run pnpm bgm:prepare.`
    );
}

export function isPublicMedia(file: string): boolean {
  if (imageFiles.has(file)) return true;
  const parts = file.split("/");
  if (parts.length !== 4) return false;
  if (parts[0] === "images" && parts[1] === "title")
    return imageDirs.has(parts[2]!) && /\.webp$/i.test(parts[3]!);
  if (parts[0] === "sounds" && parts[1] === "music")
    return musicDirs.has(parts[2]!) && /\.m4a$/i.test(parts[3]!);
  return false;
}

const publicFiles = new Set([
  "_headers",
  "fonts-license.txt",
  "apple-touch-icon.png",
  "pwa-192.png",
  "pwa-512.png",
  "pwa-maskable-512.png",
]);

export function isDevelopmentModule(id: string): boolean {
  const file = id.replaceAll("\\", "/").split("?")[0]!;
  return (
    /\/(packages\/ai|apps\/cli|scripts|e2e|manual|mockups)\//.test(file) ||
    /\/(test|__tests__|fixtures)\//.test(file) ||
    /\/(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /\/packages\/rules-core\/src\/(?:training-|ai-observation)/.test(file) ||
    /\/apps\/playground-web\/src\/(?:scenario[^/]*|development)\.[jt]s$/.test(
      file
    ) ||
    /\/DevelopmentReplayViewer\.tsx$/.test(file)
  );
}

/** Fail the build if a dev/AI import actually survives tree shaking. */
export function publicBuildPlugin(): Plugin {
  let publicDir: string | false;
  return {
    name: "public-build-boundary",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
      if (!config.isProduction)
        throw new Error(
          "Public builds require NODE_ENV=production; use the dev server for development tools."
        );
    },
    async buildStart() {
      // Vite copies public/ verbatim. Reject unreviewed files before it copies them.
      if (!publicDir) return;
      for (const entry of await readdir(publicDir, { withFileTypes: true })) {
        if (!entry.isFile() || !publicFiles.has(entry.name))
          this.error(`Unapproved public asset: ${entry.name}`);
      }
    },
    generateBundle(_options, bundle) {
      const leaked = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, module] of Object.entries(output.modules)) {
          if (module.renderedLength > 0 && isDevelopmentModule(id))
            leaked.add(path.relative(process.cwd(), id));
        }
      }
      if (leaked.size)
        this.error(
          `Development code in public bundle:\n${[...leaked].join("\n")}`
        );
    },
  };
}
