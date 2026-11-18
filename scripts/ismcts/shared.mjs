import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  realpathSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
  lstatSync,
} from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import state from "../harness/verification-state.cjs";
import { integrationCheckout } from "../full-run-checkouts.mjs";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const fileHash = (file) => hash(readFileSync(file));
// Inspect lexical ancestors before realpath: a redirected base must not become
// the new trusted root. Missing leaves are allowed for atomic creation, but
// existing symlinks/junctions are never a valid program evidence/ledger path.
export function safePath(file) {
  const full = resolve(file);
  let current = full;
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("symlink/junction in ISMCTS storage path");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return full;
    current = parent;
  }
}
export const readJson = (file) =>
  JSON.parse(readFileSync(safePath(file), "utf8"));
export function atomicJson(file, value) {
  const full = safePath(file);
  mkdirSync(dirname(full), { recursive: true });
  safePath(full);
  return state.atomicJson(full, value);
}

export function contained(base, file) {
  safePath(base);
  const path = realpathSync(safePath(resolve(base, file)));
  const rel = relative(realpathSync(base), path);
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  )
    throw new Error("path outside evidence root");
  return path;
}

export function programPaths(worktree, repo) {
  const targets = integrationCheckout(worktree);
  if (repo && realpathSync(repo) !== realpathSync(targets.repo))
    throw new Error("ISMCTS repository binding mismatch");
  safePath(targets.repo);
  return {
    ...targets,
    shared: safePath(resolve(targets.repo, "logs/ismcts-program")),
  };
}

// This is a budget/index transaction lock, never the supervisor lock. An
// interrupted transaction is left for explicit recovery; unknown is not empty.
export function transaction(directory, fn) {
  safePath(directory);
  mkdirSync(directory, { recursive: true });
  const lock = safePath(resolve(directory, "transaction.lock"));
  const token = randomUUID();
  const fd = openSync(lock, "wx");
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token,
        startedAt: Date.now(),
      })
    );
    fsyncSync(fd);
    return fn();
  } finally {
    closeSync(fd);
    const owner = readJson(lock);
    // Retain a changed lock; never unlink another transaction's ownership.
    if (owner.token === token) unlinkSync(lock);
  }
}

export function descriptor(base, file) {
  const full = contained(base, file);
  return {
    path: relative(realpathSync(base), full).replaceAll("\\", "/"),
    sha256: fileHash(full),
  };
}

export function checkDescriptor(base, item) {
  if (
    !item ||
    typeof item.path !== "string" ||
    !/^[0-9a-f]{64}$/.test(item.sha256)
  )
    throw new Error("invalid evidence file descriptor");
  if (fileHash(contained(base, item.path)) !== item.sha256)
    throw new Error(`evidence hash mismatch: ${item.path}`);
}

export function timestamp(value, now = Date.now()) {
  if (!Number.isSafeInteger(value) || value < 0 || value > now)
    throw new Error("invalid/future evidence timestamp");
  return value;
}

export function git(root, args) {
  return state.git(root, args).trim();
}

export function sharedFile(directory, name) {
  const file = resolve(directory, name);
  if (dirname(file) !== resolve(directory))
    throw new Error("invalid shared filename");
  return safePath(file);
}
