import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";
import { ReplayDeltaDecoder, REPLAY_DELTA_CODEC } from "./replay-delta.mjs";

export function resolveJsonlSource(directory, name) {
  for (const suffix of [".manifest.json", ".jsonl.gz", ".jsonl"]) {
    const path = join(directory, name + suffix);
    if (existsSync(path)) return path;
  }
  return join(directory, name + ".jsonl");
}

function manifestFiles(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    value?.schemaVersion !== 1 ||
    value?.format !== "orica-jsonl-manifest" ||
    !Array.isArray(value.files)
  )
    throw new Error("invalid artifact manifest");
  const base = realpathSync(dirname(path)),
    seen = new Set();
  return value.files.map((name) => {
    if (
      typeof name !== "string" ||
      isAbsolute(name) ||
      !/\.jsonl(?:\.gz)?$/.test(name)
    )
      throw new Error("invalid artifact manifest member");
    const file = resolve(base, name),
      rel = relative(base, file);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      throw new Error("artifact manifest escapes its run");
    let component = base;
    for (const part of rel.split(sep)) {
      component = join(component, part);
      if (lstatSync(component).isSymbolicLink())
        throw new Error("linked artifact manifest member");
    }
    const canonical = realpathSync(file);
    const key =
      process.platform === "win32" ? canonical.toLowerCase() : canonical;
    if (seen.has(key)) throw new Error("duplicate artifact manifest member");
    seen.add(key);
    return file;
  });
}

async function* artifactChunks(path, chunkSize) {
  const source = createReadStream(path, { highWaterMark: chunkSize });
  const input = path.endsWith(".gz") ? createGunzip() : source;
  if (input !== source) {
    source.on("error", (error) => input.destroy(error));
    source.pipe(input);
  }
  try {
    for await (const chunk of input) yield chunk;
  } finally {
    input.destroy();
    source.destroy();
  }
}

export async function readArtifactText(path) {
  const chunks = [];
  for await (const chunk of artifactChunks(path, 1024 * 1024))
    chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export async function* readJsonRecords(
  path,
  { chunkSize = 1024 * 1024, maxRecordBytes = 64 * 1024 * 1024 } = {}
) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0)
    throw new Error("invalid JSONL chunk size");
  if (!Number.isInteger(maxRecordBytes) || maxRecordBytes <= 0)
    throw new Error("invalid JSONL record limit");
  if (path.endsWith(".manifest.json")) {
    for (const file of manifestFiles(path))
      yield* readJsonRecords(file, { chunkSize, maxRecordBytes });
    return;
  }
  let remainder = Buffer.alloc(0),
    sawRecord = false,
    pendingBlankLine = false;
  const parse = (buffer) => {
    if (buffer.length > maxRecordBytes)
      throw new Error(
        `JSONL record exceeds ${maxRecordBytes} bytes; refusing to materialize it`
      );
    const line = buffer.toString("utf8").replace(/\r$/, "").trim();
    if (!line) {
      if (sawRecord) pendingBlankLine = true;
      return [];
    }
    if (pendingBlankLine)
      throw new Error("invalid JSONL: blank line between records");
    sawRecord = true;
    return [JSON.parse(line)];
  };
  for await (const chunk of artifactChunks(path, chunkSize)) {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0x0a, start);
      if (end < 0) break;
      const line = chunk.subarray(start, end);
      if (remainder.length + line.length > maxRecordBytes)
        throw new Error(
          `JSONL record exceeds ${maxRecordBytes} bytes; refusing to materialize it`
        );
      yield* parse(remainder.length ? Buffer.concat([remainder, line]) : line);
      remainder = Buffer.alloc(0);
      start = end + 1;
    }
    const tail = chunk.subarray(start);
    if (remainder.length + tail.length > maxRecordBytes)
      throw new Error(
        `JSONL record exceeds ${maxRecordBytes} bytes; refusing to materialize it`
      );
    if (tail.length)
      remainder = remainder.length
        ? Buffer.concat([remainder, tail])
        : Buffer.from(tail);
  }
  if (remainder.length) yield* parse(remainder);
}

export async function readReplayArtifact(path) {
  if (!/\.jsonl(?:\.gz)?$/.test(path))
    return JSON.parse(await readArtifactText(path));
  let title = "replay",
    decoder = null,
    first = true;
  const frames = [];
  for await (const record of readJsonRecords(path)) {
    if (
      first &&
      record &&
      typeof record.title === "string" &&
      record.state === undefined
    ) {
      title = record.title;
      if (record.codec !== undefined) {
        if (record.codec !== REPLAY_DELTA_CODEC)
          throw new Error("unsupported replay codec");
        decoder = new ReplayDeltaDecoder();
      }
    } else frames.push(decoder ? decoder.append(record) : record);
    first = false;
  }
  if (!frames.length) throw new Error("replay contains no frames");
  return { schemaVersion: 1, title, frames };
}
