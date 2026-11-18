// Capacity admission for the currently managed ISMCTS namespace. This is not a
// writer guard: arbitrary module output, concurrent growth and program-wide
// accounting still require enforcement before production acceptance.
import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  inspectStorage,
  storageContext,
  policy,
} from "../artifact-storage.mjs";
import { programPaths, safePath } from "./shared.mjs";
import { profile } from "./resources.mjs";

const GiB = 1024 ** 3;
function bytes(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid storage byte measurement");
  return value;
}

// Private fixtures can exercise arithmetic without creating multi-GiB files.
// Limits always come from the existing policy/profile, never from the caller.
export function assertStorageHeadroom(snapshot, namespaceBytes, outputBytes) {
  bytes(namespaceBytes);
  bytes(outputBytes);
  if (outputBytes > profile.offline.outputBytes)
    throw new Error("invalid reserved storage output");
  if (!snapshot || snapshot.status !== "ok")
    throw new Error("ARTIFACT_STORAGE_LIMIT: storage is not healthy");
  bytes(snapshot.bytes);
  bytes(snapshot.freeBytes);
  const projectedNamespace = bytes(namespaceBytes + outputBytes),
    projectedGlobal = bytes(snapshot.bytes + outputBytes);
  if (
    projectedNamespace >= profile.offline.programSoftBytes ||
    projectedGlobal >= policy.warningGiB * GiB ||
    snapshot.freeBytes - outputBytes < policy.warningFreeGiB * GiB
  )
    throw new Error("ARTIFACT_STORAGE_LIMIT: reserved output exceeds headroom");
}

function directoryBytes(directory) {
  safePath(directory);
  let stat;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  if (!stat.isDirectory()) throw new Error("invalid ISMCTS storage directory");
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    safePath(file);
    const current = lstatSync(file);
    if (current.isDirectory()) total = bytes(total + directoryBytes(file));
    else if (current.isFile()) total = bytes(total + bytes(current.size));
    else throw new Error("non-regular ISMCTS artifact");
  }
  return total;
}

// Logical sizes conservatively count compressed files/hard links without
// treating compression as permission to expand the managed 20-GiB namespace.
export function measureIsmctsNamespace(roots, shared) {
  const directories = new Set([
    ...roots.map((root) => resolve(root, "artifacts/ismcts")),
    resolve(shared),
  ]);
  let total = 0;
  for (const directory of directories)
    total = bytes(total + directoryBytes(directory));
  return total;
}

export function checkIsmctsStorageAdmission(worktree, outputBytes) {
  const paths = programPaths(worktree),
    context = storageContext(worktree);
  if (resolve(context.hub) !== resolve(paths.repo))
    throw new Error("ISMCTS storage hub mismatch");
  const snapshot = inspectStorage(context),
    namespaceBytes = measureIsmctsNamespace(context.roots, paths.shared);
  assertStorageHeadroom(snapshot, namespaceBytes, outputBytes);
  // No stale snapshot is handed to the runtime as ongoing write permission.
}
