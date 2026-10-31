// This binding never compiles during job admission. Build it as a separate
// verification/deployment step; missing or stale native artifacts fail closed.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { hash, safePath } from "./shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function processMeterArtifact() {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("native Windows process meter requires win32/x64");
  const source = [
    "windows-process-handle.cc",
    "windows-process-handle.mjs",
    "build-process-handle.mjs",
  ].map((file) => [
    file,
    hash(readFileSync(resolve(root, "scripts/ismcts", file))),
  ]);
  const input = {
    schemaVersion: 1,
    source,
    node: process.version,
    arch: process.arch,
    napi: 8,
  };
  const directory = safePath(
    resolve(
      root,
      "artifacts/ismcts/native-process-handle",
      hash(JSON.stringify(input))
    )
  );
  return {
    input,
    directory,
    binary: safePath(resolve(directory, "meter.node")),
    manifest: safePath(resolve(directory, "manifest.json")),
  };
}

export function validateProcessMeterArtifact(manifest, input, bytes) {
  if (
    !manifest ||
    JSON.stringify(manifest.input) !== JSON.stringify(input) ||
    !/^[0-9a-f]{64}$/.test(manifest.binarySha256) ||
    hash(bytes) !== manifest.binarySha256
  )
    throw new Error("native process meter source/binary mismatch");
}

export function loadProcessMeter() {
  const artifact = processMeterArtifact();
  const manifest = JSON.parse(readFileSync(artifact.manifest, "utf8"));
  validateProcessMeterArtifact(
    manifest,
    artifact.input,
    readFileSync(artifact.binary)
  );
  return createRequire(import.meta.url)(artifact.binary);
}
