#!/usr/bin/env node
/** pnpm fuzz: preserve fixed regressions and reserve a fresh discovery range. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runFuzz } from "./fuzz-runner.mjs";
import { leaseFailureExit } from "./harness/gate-lease.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.exitCode = await runFuzz({ root });
} catch (error) {
  console.error(`[fuzz] ${error.message}`);
  process.exitCode = leaseFailureExit(error);
}
