import { setArtifactFreeBytes } from "./artifact-free-space-fixture";

import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactWriteBudget,
  acquireArtifactWriter,
  artifactStoragePolicy,
} from "../src/artifact-storage.js";
describe("artifact write budget", () => {
  it("enforces the production free-space floor independently of the host disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "orica-budget-"));
    try {
      const floor = artifactStoragePolicy.minimumFreeGiB * 1024 ** 3;
      setArtifactFreeBytes(floor - 1);
      expect(() => new ArtifactWriteBudget(dir)).toThrow(/free disk space/);

      setArtifactFreeBytes(floor);
      const budget = new ArtifactWriteBudget(dir);
      const pendingBytes = 4 * 1024 ** 2;
      setArtifactFreeBytes(floor + pendingBytes - 1);
      expect(() => budget.reserve(pendingBytes, 0)).toThrow(/free disk space/);
      setArtifactFreeBytes(floor + pendingBytes);
      expect(() => budget.reserve(1, 0)).toThrow(/free disk space/);

      const healthy = new ArtifactWriteBudget(dir);
      expect(() => healthy.reserve(pendingBytes, 0)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not write oversized payloads and accounts for replaced files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orica-budget-"));
    try {
      const file = join(dir, "frames.jsonl");
      writeFileSync(file, "abcd");
      const budget = new ArtifactWriteBudget(dir, {
        maximumFileMiB: 1,
        maximumAggregateFileMiB: 2,
        maximumRunGiB: 8 / 1024 ** 3,
        minimumFreeGiB: 0,
      });
      await budget.writeText(file, "12345678");
      expect(readFileSync(file, "utf8")).toBe("12345678");
      await expect(budget.writeText(file, "123456789")).rejects.toThrow(
        /ARTIFACT_STORAGE_LIMIT/
      );
      expect(readFileSync(file, "utf8")).toBe("12345678");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("enforces exact byte limits and keeps a limit failure sticky", () => {
    const dir = mkdtempSync(join(tmpdir(), "orica-budget-"));
    try {
      const budget = new ArtifactWriteBudget(dir, {
        maximumFileMiB: 1,
        maximumAggregateFileMiB: 2,
        maximumRunGiB: 1,
        minimumFreeGiB: 0,
      });
      budget.reserve(1024 ** 2, 0);
      expect(() => budget.reserve(1, 1024 ** 2)).toThrow(
        /ARTIFACT_STORAGE_LIMIT/
      );
      expect(() => budget.assertHealthy()).toThrow(/ARTIFACT_STORAGE_LIMIT/);
      expect(() => budget.reserve(1, 0)).toThrow(/ARTIFACT_STORAGE_LIMIT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("counts existing files toward the run budget and refuses low free space", () => {
    const dir = mkdtempSync(join(tmpdir(), "orica-budget-"));
    try {
      writeFileSync(join(dir, "prior"), "abcd");
      const limits = {
        maximumFileMiB: 1,
        maximumAggregateFileMiB: 2,
        maximumRunGiB: 8 / 1024 ** 3,
        minimumFreeGiB: 0,
      };
      const budget = new ArtifactWriteBudget(dir, limits);
      budget.reserve(4, 0);
      expect(() => budget.reserve(1, 0)).toThrow(/budget exceeded/);
      expect(
        () =>
          new ArtifactWriteBudget(dir, {
            ...limits,
            minimumFreeGiB: Number.MAX_SAFE_INTEGER,
          })
      ).toThrow(/free disk space/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps active output leased, refuses another writer, and blocks pruned runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "orica-budget-"));
    try {
      const release = acquireArtifactWriter(dir);
      expect(
        JSON.parse(readFileSync(join(dir, ".storage-writer.json"), "utf8")).pid
      ).toBe(process.pid);
      expect(() => acquireArtifactWriter(dir)).toThrow();
      release();
      expect(existsSync(join(dir, ".storage-writer.json"))).toBe(false);
      writeFileSync(join(dir, ".storage-pruned.json"), "{}");
      expect(() => acquireArtifactWriter(dir)).toThrow(/pruned/);
      expect(existsSync(join(dir, ".storage-writer.json"))).toBe(false);
      expect(() => new ArtifactWriteBudget(dir)).toThrow(/pruned/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
