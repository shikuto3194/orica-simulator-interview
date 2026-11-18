#!/usr/bin/env node
// Keep original PNGs locally; commit lossless WebP files for deployment.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(
  new URL("../apps/playground-web/package.json", import.meta.url)
);
const sharp = require("sharp");
const root = fileURLToPath(new URL("../images/", import.meta.url));
const files = (await readdir(root)).filter((file) => /^BS.*\.png$/.test(file));
if (!files.length) throw new Error("No original card PNGs found in images/");

let next = 0;
let completed = 0;
let converted = 0;
let sourceBytes = 0;
let outputBytes = 0;
async function pixels(input) {
  const decoded = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // WebP can discard invisible RGB values; preserve every visible channel and alpha.
  for (let offset = 0; offset < decoded.data.length; offset += 4)
    if (decoded.data[offset + 3] === 0)
      decoded.data.fill(0, offset, offset + 3);
  return decoded;
}
function samePixels(a, b) {
  return (
    a.info.width === b.info.width &&
    a.info.height === b.info.height &&
    a.data.equals(b.data)
  );
}
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const input = await readFile(`${root}/${file}`);
    const original = await pixels(input);
    const target = `${root}/${file.replace(/\.png$/, ".webp")}`;
    let output;
    try {
      const existing = await readFile(target);
      if (
        (await sharp(existing).metadata()).format === "webp" &&
        samePixels(original, await pixels(existing))
      )
        output = existing;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!output) {
      output = await sharp(input)
        .webp({ lossless: true, effort: 6 })
        .toBuffer();
      if (!samePixels(original, await pixels(output)))
        throw new Error(`WebP pixels differ from original: ${file}`);
      await writeFile(target, output);
      converted++;
    }
    sourceBytes += input.length;
    outputBytes += output.length;
    completed++;
    if (completed % 25 === 0 || completed === files.length)
      console.log(`[card-images] verified ${completed}/${files.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(
  JSON.stringify({ files: completed, converted, sourceBytes, outputBytes })
);
