import "./artifact-free-space-fixture";

import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  ReplayDeltaEncoder,
  ReplayDeltaDecoder,
  REPLAY_DELTA_CODEC,
} from "../../../scripts/lib/replay-delta.mjs";
import {
  readArtifactText,
  readJsonRecords,
  readReplayArtifact,
  resolveJsonlSource,
} from "../../../scripts/lib/artifact-io.mjs";
import { ArtifactWriteBudget } from "../src/artifact-storage.js";
import {
  CompressedArtifactWriter,
  writeCompressedReplay,
  writeCompressedText,
} from "../src/compressed-artifact.js";

const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "orica-compressed-test-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
async function records(path: string, maxRecordBytes?: number) {
  const rows = [];
  for await (const row of readJsonRecords(path, {
    chunkSize: 3,
    maxRecordBytes,
  }))
    rows.push(row);
  return rows;
}

describe("lossless compressed evidence", () => {
  it("round trips every JSON value, key order, removals and anchors without mutating older frames", () => {
    const encoder = new ReplayDeltaEncoder(),
      decoder = new ReplayDeltaDecoder();
    const decoded: unknown[] = [],
      originals: string[] = [];
    for (let i = 0; i < 260; i++) {
      const special = JSON.parse(
        '{"__proto__":{"safe":true},"constructor":null}'
      ) as unknown;
      const frame = {
        state: i % 2 ? { a: special, b: [i, null] } : { b: [], a: special },
        log: Array.from({ length: i % 13 }, (_, n) => ({ text: "棋譜🌟", n })),
        absent: undefined,
      };
      const record = encoder.append(frame);
      if (i % 128 === 0) expect(record.base).toBeNull();
      decoded.push(decoder.append(JSON.parse(JSON.stringify(record))));
      originals.push(JSON.stringify(frame));
    }
    expect(decoded.map((frame) => JSON.stringify(frame))).toEqual(originals);
    expect({}).not.toHaveProperty("safe");
  });
  it("rejects missing/reordered deltas and corrupt object or array patches", () => {
    const encoder = new ReplayDeltaEncoder(),
      decoder = new ReplayDeltaDecoder();
    const first = encoder.append({ state: [1] }),
      second = encoder.append({ state: [2] });
    expect(() => decoder.append(second)).toThrow(/sequence/);
    decoder.append(first);
    expect(() =>
      decoder.append({
        ...second,
        patch: ["o", ["state"], [["state", ["a", 3, []]]]],
      })
    ).toThrow(/missing/);
    expect(() =>
      decoder.append({ ...second, patch: ["o", ["state", "state"], []] })
    ).toThrow(/object/);
    expect(decoder.append(second)).toEqual({ state: [2] });
  });
  it("commits one gzip stream, releases temporary bytes and permits repeated games inside the run budget", async () => {
    const dir = directory();
    const budget = new ArtifactWriteBudget(dir, {
      maximumRunGiB: 80000 / 1024 ** 3,
      maximumFileMiB: 1,
      maximumAggregateFileMiB: 1,
      minimumFreeGiB: 0,
    });
    const text = JSON.stringify({ evidence: "棋譜".repeat(5000) }) + "\n";
    for (let i = 0; i < 80; i++)
      await writeCompressedText(join(dir, i + ".jsonl.gz"), text, budget);
    const names = readdirSync(dir);
    expect(names).toHaveLength(80);
    expect(names.every((name) => name.endsWith(".gz"))).toBe(true);
    expect(
      names.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)
    ).toBeLessThan(80000);
    expect(await readArtifactText(join(dir, "0.jsonl.gz"))).toBe(text);
    const restored = await new Response(
      new Blob([readFileSync(join(dir, "0.jsonl.gz"))])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"))
    ).text();
    expect(restored).toBe(text);
  });
  it("bounds partial writes and keeps capacity errors sticky", async () => {
    const dir = directory(),
      path = join(dir, "oversized.jsonl.gz");
    const budget = new ArtifactWriteBudget(dir, {
      maximumRunGiB: 1,
      maximumFileMiB: 10 / 1024 ** 2,
      maximumAggregateFileMiB: 1,
      minimumFreeGiB: 0,
    });
    const writer = new CompressedArtifactWriter(path, budget);
    expect(() => writer.append("x".repeat(11))).toThrow(
      /ARTIFACT_STORAGE_LIMIT/
    );
    writer.abort();
    expect(() => budget.assertHealthy()).toThrow(/ARTIFACT_STORAGE_LIMIT/);
    expect(readdirSync(dir).every((name) => name.endsWith(".partial"))).toBe(
      true
    );
    expect(
      readdirSync(dir).reduce(
        (sum, name) => sum + statSync(join(dir, name)).size,
        0
      )
    ).toBeLessThanOrEqual(10);
  });
  it("reads legacy JSON and new delta gzip replays identically and rejects corruption", async () => {
    const dir = directory(),
      old = join(dir, "old.json"),
      path = join(dir, "new.jsonl.gz");
    const replay = {
      schemaVersion: 1,
      title: "棋譜",
      frames: [{ state: { value: 1 } }, { state: { value: 2 } }],
    };
    writeFileSync(old, JSON.stringify(replay));
    await writeCompressedReplay(path, replay, new ArtifactWriteBudget(dir));
    expect(await readReplayArtifact(path)).toEqual(
      await readReplayArtifact(old)
    );
    expect((await readArtifactText(path)).split("\n")[0]).toContain(
      REPLAY_DELTA_CODEC
    );
    writeFileSync(path, readFileSync(path).subarray(0, 15));
    await expect(readReplayArtifact(path)).rejects.toThrow();
  });
  it("streams legacy and gzip manifest members in order; fails closed on missing, duplicate and escaping evidence", async () => {
    const dir = directory(),
      games = join(dir, "games");
    mkdirSync(games);
    writeFileSync(join(games, "one.jsonl"), '{"label":"棋譜🌟"}\n');
    writeFileSync(join(games, "two.jsonl.gz"), gzipSync('{"label":"next"}\n'));
    const path = join(dir, "frames.manifest.json");
    const manifest = (files: string[]) =>
      writeFileSync(
        path,
        JSON.stringify({
          schemaVersion: 1,
          format: "orica-jsonl-manifest",
          files,
        })
      );
    manifest(["games/one.jsonl", "games/two.jsonl.gz"]);
    expect(resolveJsonlSource(dir, "frames")).toBe(path);
    expect(await records(path)).toEqual([
      { label: "棋譜🌟" },
      { label: "next" },
    ]);
    await expect(records(path, 4)).rejects.toThrow(/exceeds/);
    for (const files of [
      ["games/missing.jsonl"],
      ["games/one.jsonl", "games/one.jsonl"],
      ["../outside.jsonl"],
    ]) {
      manifest(files);
      await expect(records(path)).rejects.toThrow();
    }
    const outside = directory();
    writeFileSync(join(outside, "data.jsonl"), "{}\n");
    symlinkSync(
      outside,
      join(games, "linked"),
      process.platform === "win32" ? "junction" : "dir"
    );
    manifest(["games/linked/data.jsonl"]);
    await expect(records(path)).rejects.toThrow(/linked/);
    writeFileSync(join(games, "two.jsonl.gz"), gzipSync("{}\n\n{}\n"));
    await expect(records(join(games, "two.jsonl.gz"))).rejects.toThrow(/blank/);
  });
});
