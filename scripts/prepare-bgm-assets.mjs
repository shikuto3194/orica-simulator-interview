#!/usr/bin/env node
// Keep editable originals locally; commit browser-ready WebP and AAC/M4A only.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { WORKS } from "../apps/playground-web/src/bgm/works.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../apps/playground-web/package.json", import.meta.url)
);
const sharp = require("sharp");
// Release Windows image handles before moving the verified output.
sharp.cache({ files: 0 });
const exec = promisify(execFile);
const scratch = path.join(root, "artifacts", "bgm-prepare");
await mkdir(scratch, { recursive: true });
const reportFile = path.join(scratch, "report.json");
const settings = {
  webpQuality: 88,
  webpEffort: 6,
  audioCodec: "aac",
  audioBitrate: 128000,
};
let previous = {};
try {
  previous = JSON.parse(await readFile(reportFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const records = [];
const tasks = [];
const targets = new Set();
for (const work of WORKS) {
  for (const [kind, folder, pattern, extension] of [
    ["image", `images/title/${work.imageDir}`, /\.(png|jpe?g)$/i, ".webp"],
    ["audio", `sounds/music/${work.musicDir}`, /\.mp3$/i, ".m4a"],
  ]) {
    const sources = (await readdir(path.join(root, folder)))
      .filter((name) => pattern.test(name))
      .sort();
    if (!sources.length)
      throw new Error(
        `No original media in ${folder}; restore with pnpm fetch-bgm-assets`
      );
    for (const name of sources) {
      const source = `${folder}/${name}`;
      const output = source.replace(pattern, extension);
      if (targets.has(output)) throw new Error(`Duplicate output: ${output}`);
      targets.add(output);
      tasks.push({ kind, source, output });
    }
  }
}
async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function probe(file) {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "format=duration:stream=codec_name,sample_rate,channels",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(stdout);
  return { ...data.streams[0], duration: Number(data.format.duration) };
}
let next = 0;
async function worker() {
  while (next < tasks.length) {
    const index = next++;
    const task = tasks[index];
    const source = path.join(root, task.source);
    const output = path.join(root, task.output);
    const sourceHash = await hash(source);
    const cached = previous.records?.find(
      (record) => record.source === task.source
    );
    if (
      !process.argv.includes("--force") &&
      JSON.stringify(previous.settings) === JSON.stringify(settings) &&
      cached?.sourceHash === sourceHash
    ) {
      try {
        if ((await hash(output)) === cached.outputHash) {
          records.push(cached);
          continue;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const temporary = path.join(scratch, `${index}${path.extname(output)}`);
    let details;
    if (task.kind === "image") {
      const before = await sharp(source).metadata();
      await sharp(source)
        .webp({ quality: settings.webpQuality, effort: settings.webpEffort })
        .toFile(temporary);
      const after = await sharp(temporary).metadata();
      if (before.width !== after.width || before.height !== after.height)
        throw new Error(`Image dimensions changed: ${task.source}`);
      details = { width: after.width, height: after.height };
    } else {
      // Remux first: this preserves MP3 frames while removing tags/padding, including
      // the known 700 MB zero-filled tail that made one 4-minute song appear 16 hours long.
      const clean = path.join(scratch, `${index}-source.mp3`);
      await exec("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-c:a",
        "copy",
        "-map_metadata",
        "-1",
        clean,
      ]);
      const before = await probe(clean);
      await exec("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        clean,
        "-map",
        "0:a:0",
        "-c:a",
        settings.audioCodec,
        "-b:a",
        String(settings.audioBitrate),
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        temporary,
      ]);
      const after = await probe(temporary);
      if (
        after.codec_name !== "aac" ||
        after.channels !== before.channels ||
        !Number.isFinite(after.duration) ||
        Math.abs(after.duration - before.duration) > 0.15
      )
        throw new Error(`Audio verification failed: ${task.source}`);
      await exec("ffmpeg", [
        "-v",
        "error",
        "-xerror",
        "-i",
        temporary,
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ]);
      details = { ...after, sourceDuration: before.duration };
      await rm(clean);
    }
    const record = {
      ...task,
      sourceHash,
      outputHash: await hash(temporary),
      sourceBytes: (await stat(source)).size,
      outputBytes: (await stat(temporary)).size,
      ...details,
    };
    if (record.outputBytes >= 50 * 1024 * 1024)
      throw new Error(`Unexpectedly large Git media: ${task.output}`);
    await rename(temporary, output);
    records.push(record);
    if (records.length % 10 === 0 || records.length === tasks.length)
      console.log(`[bgm-prepare] verified ${records.length}/${tasks.length}`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
records.sort((a, b) => a.output.localeCompare(b.output, "en"));
const totals = {};
for (const kind of ["image", "audio"]) {
  const files = records.filter((record) => record.kind === kind);
  totals[kind] = {
    count: files.length,
    sourceBytes: files.reduce((sum, file) => sum + file.sourceBytes, 0),
    outputBytes: files.reduce((sum, file) => sum + file.outputBytes, 0),
  };
}
await writeFile(
  reportFile,
  JSON.stringify({ settings, totals, records }, null, 2) + "\n"
);
console.log(JSON.stringify(totals));
