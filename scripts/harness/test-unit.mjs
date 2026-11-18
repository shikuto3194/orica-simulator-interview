#!/usr/bin/env node
import { runGates } from "./run-gates.mjs";
import { leaseFailureExit } from "./gate-lease.mjs";

const files = process.argv.slice(2);
if (files[0] === "--") files.shift();
await runGates({ profile: "unit", extra: files }).catch((error) => {
  console.error("[test:unit] " + error.message);
  process.exitCode = leaseFailureExit(error);
});
