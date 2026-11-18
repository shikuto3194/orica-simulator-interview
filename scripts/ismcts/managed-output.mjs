import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { programPaths, safePath, hash } from "./shared.mjs";
import { withOutputClaim } from "./budget.mjs";
import { checkIsmctsStorageAdmission } from "./storage-admission.mjs";

// Bounded in-memory artifact batches; larger checkpoints need a later streaming
// adapter. This does not change artifact-storage policy or permit arbitrary
// child-module paths. Payload claims exclude ledger/metadata overhead.
export const maximumManagedPayloadBytes = 64 * 1024 ** 2;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const intrinsic = (name, value) =>
  Object.getOwnPropertyDescriptor(typedArray, name).get.call(value);
export function assertManagedPayloadSize(size) {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > maximumManagedPayloadBytes
  )
    throw new Error("invalid managed artifact size");
}

export function writeManagedArtifact(worktree, id, owner, name, payload) {
  return writeReservedArtifact(
    programPaths(worktree).shared,
    id,
    owner,
    name,
    payload,
    (bytes) => checkIsmctsStorageAdmission(worktree, bytes)
  );
}

// Private fixtures inject capacity outcomes through this trusted lower seam.
// The public worktree API always resolves the shared namespace and real policy.
export function writeReservedArtifact(
  directory,
  id,
  owner,
  name,
  payload,
  admit,
  now = Date.now(),
  checkExecutionDeadline
) {
  const started = performance.now();
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      id
    ) ||
    typeof name !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name) ||
    !Buffer.isBuffer(payload) ||
    typeof admit !== "function" ||
    (checkExecutionDeadline !== undefined &&
      typeof checkExecutionDeadline !== "function")
  )
    throw new Error("invalid managed artifact");
  // Snapshot before any caller-controlled capacity callback can mutate input.
  // Use typed-array internal slots: own length/buffer/byteOffset properties
  // cannot turn a small validated size into a larger copy/allocation.
  const size = intrinsic("byteLength", payload);
  assertManagedPayloadSize(size);
  const bytes = Buffer.allocUnsafe(size);
  Uint8Array.prototype.set.call(
    bytes,
    new Uint8Array(
      intrinsic("buffer", payload),
      intrinsic("byteOffset", payload),
      size
    )
  );
  const file = safePath(
    resolve(directory, "managed-output", id, `artifact-${name}.bin`)
  );
  const checkExecution = () => {
    if (checkExecutionDeadline && checkExecutionDeadline() !== undefined)
      throw new Error("invalid output execution deadline result");
  };
  checkExecution();
  return withOutputClaim(
    directory,
    id,
    owner,
    bytes.length,
    (checkBudgetDeadline) => {
      const checkDeadline = () => {
        checkBudgetDeadline();
        checkExecution();
      };
      checkDeadline();
      if (admit(bytes.length) !== undefined)
        throw new Error("invalid output storage admission result");
      checkDeadline();
      mkdirSync(safePath(resolve(directory, "managed-output", id)), {
        recursive: true,
      });
      safePath(file);
      checkDeadline();
      const fd = openSync(file, "wx");
      try {
        // The claim and storage check both precede the first payload byte.
        writeFileSync(fd, bytes);
        fsyncSync(fd);
        checkDeadline();
      } finally {
        closeSync(fd);
      }
      // Failed/partial files are retained. No overwrite, retry credit or deletion.
      return { path: file, byteLength: bytes.length, sha256: hash(bytes) };
    },
    now + Math.floor(performance.now() - started)
  );
}
