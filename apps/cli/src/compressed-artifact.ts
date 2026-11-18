import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { ArtifactWriteBudget } from "./artifact-storage.js";
import {
  ReplayDeltaEncoder,
  REPLAY_DELTA_CODEC,
} from "../../../scripts/lib/replay-delta.mjs";

const BUFFER_BYTES = 4 * 1024 * 1024;

/** Synchronous engine callbacks write bounded temporary data; gzip runs between games. */
export class CompressedArtifactWriter {
  private readonly temporary: string;
  private readonly descriptor: number;
  private buffers: Buffer[] = [];
  private bufferedBytes = 0;
  private rawBytes = 0;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly budget: ArtifactWriteBudget,
    private readonly aggregate = false
  ) {
    this.temporary = `${path}.${process.pid}.${Date.now()}.raw.partial`;
    this.descriptor = openSync(this.temporary, "wx");
  }

  append(text: string): void {
    if (this.closed) throw new Error("artifact writer is already closed");
    const input = Buffer.from(text);
    this.budget.reserve(input.length, this.rawBytes, this.fileLimit());
    this.rawBytes += input.length;
    for (let offset = 0; offset < input.length; ) {
      const length = Math.min(
        BUFFER_BYTES - this.bufferedBytes,
        input.length - offset
      );
      this.buffers.push(input.subarray(offset, offset + length));
      this.bufferedBytes += length;
      offset += length;
      if (this.bufferedBytes === BUFFER_BYTES) this.flush();
    }
  }

  async commit(): Promise<void> {
    if (this.closed) throw new Error("artifact writer is already closed");
    this.flush();
    closeSync(this.descriptor);
    this.closed = true;
    const compressed = this.temporary.replace(".raw.partial", ".gzip.partial");
    let compressedBytes = 0;
    const budget = this.budget,
      limit = this.fileLimit();
    await pipeline(
      createReadStream(this.temporary),
      createGzip({ level: 6 }),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          try {
            budget.reserve(chunk.length, compressedBytes, limit);
            compressedBytes += chunk.length;
            callback(null, chunk);
          } catch (error) {
            callback(error as Error);
          }
        },
      }),
      createWriteStream(compressed, { flags: "wx" })
    );
    if (existsSync(this.path)) this.budget.forgetFile(this.path);
    renameSync(compressed, this.path);
    this.budget.forgetFile(this.temporary);
    unlinkSync(this.temporary);
  }

  abort(): void {
    if (this.closed) return;
    this.buffers = [];
    this.bufferedBytes = 0;
    closeSync(this.descriptor);
    this.closed = true;
  }

  private fileLimit(): number {
    return this.budget.maximumFileBytes(this.aggregate);
  }
  private flush(): void {
    if (this.bufferedBytes)
      writeSync(
        this.descriptor,
        Buffer.concat(this.buffers, this.bufferedBytes)
      );
    this.buffers = [];
    this.bufferedBytes = 0;
  }
}

export class CompressedReplayWriter {
  private readonly writer: CompressedArtifactWriter;
  private readonly encoder = new ReplayDeltaEncoder();
  constructor(path: string, title: string, budget: ArtifactWriteBudget) {
    this.writer = new CompressedArtifactWriter(path, budget);
    this.writer.append(
      JSON.stringify({ schemaVersion: 2, codec: REPLAY_DELTA_CODEC, title }) +
        "\n"
    );
  }
  append(frame: unknown): void {
    this.writer.append(JSON.stringify(this.encoder.append(frame)) + "\n");
  }
  async commit(): Promise<void> {
    await this.writer.commit();
  }
  abort(): void {
    this.writer.abort();
  }
}

export async function writeCompressedText(
  path: string,
  text: string,
  budget: ArtifactWriteBudget,
  aggregate = false
): Promise<void> {
  const writer = new CompressedArtifactWriter(path, budget, aggregate);
  try {
    writer.append(text);
    await writer.commit();
  } catch (error) {
    writer.abort();
    throw error;
  }
}
export async function writeCompressedReplay(
  path: string,
  replay: unknown,
  budget: ArtifactWriteBudget
): Promise<void> {
  if (
    !replay ||
    typeof replay !== "object" ||
    !("frames" in replay) ||
    !Array.isArray(replay.frames)
  )
    throw new Error("invalid replay artifact");
  const title =
    "title" in replay && typeof replay.title === "string"
      ? replay.title
      : "replay";
  const writer = new CompressedReplayWriter(path, title, budget);
  try {
    for (const frame of replay.frames) writer.append(frame);
    await writer.commit();
  } catch (error) {
    writer.abort();
    throw error;
  }
}
