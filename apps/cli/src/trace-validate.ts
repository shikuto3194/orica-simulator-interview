#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  assertTraceSmokeOutputValid,
  validateTraceSmokeOutput,
} from "./trace-artifacts";

interface ParsedArgs {
  dir?: string;
  help?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--dir":
      case "--out":
      case "--outDir":
      case "--out-dir":
        parsed.dir = next();
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "orica trace-validate",
    "",
    "Usage:",
    "  node apps/cli/dist/trace-validate.js --dir artifacts/trace-smoke/<run>",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

export async function runTraceValidateCli(
  argv: readonly string[]
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  if (!parsed.dir) throw new Error("--dir is required");
  const summary = await validateTraceSmokeOutput(parsed.dir);
  assertTraceSmokeOutputValid(summary);
  console.log(
    [
      `trace artifacts valid: ${summary.outputDir}`,
      `frames=${summary.frameCount}, trace=${summary.traceCount}, replays=${summary.replayCount}`,
    ].join("\n")
  );
}

if (isDirectExecution()) {
  runTraceValidateCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
