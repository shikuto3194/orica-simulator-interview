// Private fixed workload. No output path, deck, seed, limit or agent override.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fixedSmokeInput, playFixedSmokeGame } from "./fixed-smoke.mjs";
import { withFixedDeckCatalog } from "./fixed-decks.mjs";
import { writeManagedArtifact } from "./managed-output.mjs";
import { hash } from "./shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv.length !== 5 || !/^(?:[0-9]|1[0-5])$/.test(process.argv[2]))
  throw new Error("invalid private smoke arguments");
const input = fixedSmokeInput(Number(process.argv[2]));
const [id, owner] = process.argv.slice(3);
// Bind engine/definitions and the workload to their actual execution bytes.
// This is provenance for the diagnostic run, not a new acceptance ledger.
const files = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--",
    "packages/rules-core/src",
    "packages/card-data/src",
    "apps/cli/src/trace-smoke.ts",
    "scripts/ismcts",
  ],
  { cwd: root, encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean);
const sources = files.map((file) => ({
  path: file,
  sha256: hash(readFileSync(resolve(root, file))),
}));
// Include newly added workload files before their first verified commit.
for (const file of [
  "scripts/ismcts/fixed-smoke.mjs",
  "scripts/ismcts/fixed-smoke-admission-worker.mjs",
  "scripts/ismcts/fixed-smoke-worker.mjs",
  "packages/rules-core/src/ai-work-telemetry.ts",
])
  if (!sources.some((entry) => entry.path === file))
    sources.push({
      path: file,
      sha256: hash(readFileSync(resolve(root, file))),
    });
writeManagedArtifact(
  root,
  id,
  owner,
  "fixed-smoke-sources",
  Buffer.from(JSON.stringify(sources))
);
try {
  const result = await withFixedDeckCatalog((catalog) => {
    const telemetry = new catalog.core.AiWorkTelemetry();
    try {
      return playFixedSmokeGame(catalog, Number(process.argv[2]), telemetry);
    } finally {
      writeManagedArtifact(
        root,
        id,
        owner,
        "fixed-smoke-work-telemetry",
        Buffer.from(JSON.stringify(telemetry.snapshot()))
      );
    }
  });
  writeManagedArtifact(
    root,
    id,
    owner,
    "fixed-smoke-result",
    Buffer.from(JSON.stringify(result))
  );
} catch {
  writeManagedArtifact(
    root,
    id,
    owner,
    "fixed-smoke-failure",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "i0-fixed-smoke-failure",
        input,
        attempted: 1,
        completed: 0,
        failed: 1,
        reason: "engine_or_output_failure",
      })
    )
  );
  process.exitCode = 1;
}
