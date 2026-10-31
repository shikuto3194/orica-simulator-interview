#!/usr/bin/env node
import { runGates } from "./run-gates.mjs";
import { leaseFailureExit } from "./gate-lease.mjs";
const args = process.argv.slice(2);
if (
  args.some((arg) => !["--full", "--reuse", "--fresh", "--plan"].includes(arg))
) {
  console.error(
    "Usage: codex-finish-check.mjs [--full] [--fresh|--reuse] [--plan]"
  );
  process.exitCode = 1;
} else {
  await runGates({
    profile: args.includes("--full") ? "full" : "finish",
    reuse: !args.includes("--fresh"),
    plan: args.includes("--plan"),
  }).catch((error) => {
    console.error("[codex:finish-check] " + error.message);
    process.exitCode = leaseFailureExit(error);
  });
}
