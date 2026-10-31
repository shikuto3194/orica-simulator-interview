import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

interface StoragePolicy {
  maximumFileMiB: number;
  maximumRunGiB: number;
  minimumFreeGiB: number;
  maximumAggregateFileMiB: number;
}
export const artifactStoragePolicy: StoragePolicy = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../scripts/artifact-storage-policy.json"
    ),
    "utf8"
  )
) as StoragePolicy;
for (const name of [
  "maximumFileMiB",
  "maximumAggregateFileMiB",
  "maximumRunGiB",
  "minimumFreeGiB",
] as const) {
  if (
    !Number.isFinite(artifactStoragePolicy[name]) ||
    artifactStoragePolicy[name] <= 0
  )
    throw new Error("invalid artifact storage policy: " + name);
}

function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink())
    throw new Error("ARTIFACT_STORAGE_LIMIT: linked output directory");
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce(
    (sum, name) => sum + directoryBytes(join(path, name)),
    0
  );
}

/** This guard limits persisted evidence, not game mechanics or coverage criteria. */
export class ArtifactWriteBudget {
  private bytes: number;
  private sinceFreeCheck = 0;
  private failure: Error | null = null;
  constructor(
    private readonly outDir: string,
    private readonly limits = artifactStoragePolicy
  ) {
    if (
      existsSync(join(outDir, ".storage-pruned.json")) ||
      existsSync(join(outDir, ".storage-pruning.json"))
    ) {
      throw new Error(
        "ARTIFACT_STORAGE_LIMIT: this run was pruned; choose a new output directory"
      );
    }
    this.bytes = directoryBytes(outDir);
    this.checkFreeSpace();
  }
  reserve(
    bytes: number,
    fileBytes: number,
    fileLimit = this.limits.maximumFileMiB * 1024 ** 2
  ): void {
    this.assertHealthy();
    if (
      fileBytes + bytes > fileLimit ||
      this.bytes + bytes > this.limits.maximumRunGiB * 1024 ** 3
    ) {
      this.failure = new Error(
        "ARTIFACT_STORAGE_LIMIT: file/run evidence budget exceeded; preserve completed checkpoints and request storage maintenance, not higher limits"
      );
      throw this.failure;
    }
    this.sinceFreeCheck += bytes;
    if (this.sinceFreeCheck >= 4 * 1024 ** 2) {
      this.checkFreeSpace(this.sinceFreeCheck);
      this.sinceFreeCheck = 0;
    }
    this.bytes += bytes;
  }
  maximumFileBytes(aggregate = false): number {
    return (
      (aggregate
        ? this.limits.maximumAggregateFileMiB
        : this.limits.maximumFileMiB) *
      1024 ** 2
    );
  }
  async writeText(
    path: string,
    text: string,
    aggregate = false
  ): Promise<void> {
    this.forgetFile(path);
    this.reserve(
      Buffer.byteLength(text),
      0,
      (aggregate
        ? this.limits.maximumAggregateFileMiB
        : this.limits.maximumFileMiB) *
        1024 ** 2
    );
    await writeFile(path, text, "utf8");
  }
  forgetFile(path: string): void {
    if (existsSync(path)) this.bytes -= lstatSync(path).size;
  }
  assertHealthy(): void {
    if (this.failure) throw this.failure;
  }
  private checkFreeSpace(pendingBytes = 0): void {
    let directory = this.outDir;
    while (!existsSync(directory)) directory = dirname(directory);
    const stat = statfsSync(directory);
    if (
      Number(stat.bavail) * Number(stat.bsize) <
      this.limits.minimumFreeGiB * 1024 ** 3 + pendingBytes
    ) {
      this.failure = new Error(
        "ARTIFACT_STORAGE_LIMIT: insufficient free disk space; run artifact-storage maintenance"
      );
      throw this.failure;
    }
  }
}

export function acquireArtifactWriter(outDir: string): () => void {
  const lease = join(outDir, ".storage-writer.json");
  // A stale lease never permits deleting data; remove only the small lease file.
  if (existsSync(lease)) {
    const prior = JSON.parse(readFileSync(lease, "utf8")) as { pid: number };
    if (!Number.isInteger(prior.pid) || prior.pid <= 0)
      throw new Error("invalid artifact writer lease");
    try {
      process.kill(prior.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      unlinkSync(lease);
    }
  }
  writeFileSync(lease, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  if (
    existsSync(join(outDir, ".storage-pruning.json")) ||
    existsSync(join(outDir, ".storage-pruned.json"))
  ) {
    unlinkSync(lease);
    throw new Error(
      "ARTIFACT_STORAGE_LIMIT: run is being/has been pruned; choose a new output directory"
    );
  }
  return () => {
    unlinkSync(lease);
  };
}
