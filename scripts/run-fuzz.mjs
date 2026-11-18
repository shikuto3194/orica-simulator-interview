#!/usr/bin/env node
/** pnpm fuzz: preserve fixed regressions and reserve a fresh discovery range. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runFuzz } from "./fuzz-runner.mjs";
import { COMPUTE_WORKERS } from "./harness/vitest-pool.mjs";
import { leaseFailureExit } from "./harness/gate-lease.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The seed list is split across the shared two-worker compute limit. A fuzz run
// never overlaps the Vitest suite (both hold the gate lease), so this does not
// add compute; FUZZ_SHARDS=1 restores the single process run.
const requested = process.env.FUZZ_SHARDS ?? String(COMPUTE_WORKERS);
if (!/^[1-9]$/.test(requested) || Number(requested) > COMPUTE_WORKERS) {
  console.error(
    `[fuzz] FUZZ_SHARDS must be an integer from 1 to ${COMPUTE_WORKERS}: ${requested}`
  );
  process.exit(1);
}
try {
  const games = Number(process.env.FUZZ_GAMES ?? 200);
  // Never more shards than games; runFuzz rejects an invalid game count itself.
  const shards =
    Number.isInteger(games) && games > 0
      ? Math.min(Number(requested), games)
      : Number(requested);
  process.exitCode = await runFuzz({ root, shards });
} catch (error) {
  console.error(`[fuzz] ${error.message}`);
  process.exitCode = leaseFailureExit(error);
}
