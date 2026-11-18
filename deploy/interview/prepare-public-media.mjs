import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CARDS } from "../../packages/card-data/dist/generated-index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.resolve(
  process.argv[2] ?? path.resolve(projectRoot, "../..", "orica-simulator")
);
if (sourceRoot === projectRoot) {
  throw new Error("The source media root must be the separate original repository.");
}

const avatarSource = await readFileText("apps/playground-web/src/avatars.ts");
const workSource = await readFileText("apps/playground-web/src/bgm/works.ts");
const avatarBlock = avatarSource.match(/export const AVATARS[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1];
const workBlock = workSource.match(/export const WORKS[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1];
if (!avatarBlock || !workBlock) throw new Error("Could not read the app media registries.");
const avatarIds = [...avatarBlock.matchAll(/\bid:\s*"([a-z0-9_-]+)"/g)].map((match) => match[1]);
const imageDirs = [...workBlock.matchAll(/\bimageDir:\s*"([^"]+)"/g)].map((match) => match[1]);
const musicDirs = [...workBlock.matchAll(/\bmusicDir:\s*"([^"]+)"/g)].map((match) => match[1]);
if (!avatarIds.length || !imageDirs.length || imageDirs.length !== musicDirs.length) {
  throw new Error("The app media registries are empty or inconsistent.");
}

const files = new Set();
for (const card of ALL_CARDS) {
  for (const image of [card.image, card.backFace?.image]) {
    if (typeof image === "string" && image.startsWith("images/")) files.add(image);
  }
}
for (const id of avatarIds) {
  files.add(`images/avater/${id}-icon.png`);
  files.add(`images/avater/fullbody/${id}.webp`);
}
for (const file of [
  "images/ForGUI/card-back.jpg",
  "images/ForGUI/core.png",
  "images/ForGUI/soul-core.png",
  ...["tsuchi", "hi", "mizu", "kaze", "toki", "sora", "maboroshi"].map(
    (name) => `images/zokuseichi/${name}.png`
  ),
]) files.add(file);

for (const dir of imageDirs) {
  for (const file of await filesIn(path.join(sourceRoot, "images", "title", dir), /\.webp$/i)) {
    files.add(`images/title/${dir}/${file}`);
  }
}
for (const dir of musicDirs) {
  for (const file of await filesIn(path.join(sourceRoot, "sounds", "music", dir), /\.m4a$/i)) {
    files.add(`sounds/music/${dir}/${file}`);
  }
}

let bytesCopied = 0;
for (const relative of [...files].sort()) {
  if (!/^(images|sounds)\//.test(relative) || relative.split("/").includes("..")) {
    throw new Error(`Refusing an unapproved media path: ${relative}`);
  }
  const source = path.resolve(sourceRoot, relative);
  const destination = path.resolve(projectRoot, relative);
  if (!destination.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Refusing an out-of-project destination: ${relative}`);
  }
  const info = await stat(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  bytesCopied += info.size;
}
console.log(`Prepared ${files.size} allowlisted media files (${(bytesCopied / 1024 ** 3).toFixed(2)} GiB).`);
console.log("Original repository was read-only; interview worktree received the copies.");

async function readFileText(relative) {
  return await (await import("node:fs/promises")).readFile(path.join(projectRoot, relative), "utf8");
}

async function filesIn(directory, pattern) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => entry.name);
}
