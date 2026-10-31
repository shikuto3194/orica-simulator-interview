#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { inspectIntegrationCheckout } from "../full-run-checkouts.mjs";
import {
  checkoutEnvironment,
  inspectCheckoutContext,
} from "./checkout-context.mjs";

const root = process.cwd();
const partial = [];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
    env: checkoutEnvironment(),
    windowsHide: true,
  });
  if (options.capture) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }
  return { status: result.status ?? 1 };
}

function requireFile(path) {
  const abs = resolve(root, path);
  if (!existsSync(abs)) {
    console.error(`[codex:preflight] missing required file: ${path}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[ok] ${path}`);
}

const checkout = inspectCheckoutContext(root);
console.log("[codex:preflight] checkout context (local refs only; no fetch)");
console.log(JSON.stringify(checkout, null, 2));
partial.push(...checkout.issues);
requireFile("CLAUDE.md");
requireFile("AGENTS.md");
requireFile("manual/ai-reference/README.md");
requireFile("manual/ai-reference/30_plan/02_detailed-todo.md");
requireFile("scripts/harness/pre-tool-guard-core.cjs");
requireFile("scripts/harness/dev-server-contract.json");
requireFile("scripts/harness/check-dev-server-contract.mjs");
requireFile(".codex/hooks/pre-tool-guard.js");
requireFile(".codex/hooks/package.json");

const status = run("git", ["status", "--short", "--branch"], { capture: true });
if (status.status === 0) {
  console.log("\n[git status]");
  process.stdout.write(status.stdout.trimEnd() + "\n");
} else {
  partial.push("git status unavailable");
  console.warn("[warn] git status failed");
  process.stdout.write(status.stderr);
}

const worktrees = run("git", ["worktree", "list"], { capture: true });
if (worktrees.status === 0) {
  console.log("\n[git worktree list]");
  process.stdout.write(worktrees.stdout.trimEnd() + "\n");
} else {
  partial.push("worktree inventory unavailable");
}

try {
  const target = inspectIntegrationCheckout(root);
  if (!target.configured || !target.ready) {
    partial.push("integration checkout not ready or unavailable");
    console.warn(
      `[warn] auto-merge main checkout: ${target.configured ? target.reason : "configuration-missing"}. Preserve other checkouts.`
    );
  }
} catch (error) {
  partial.push("integration checkout inspection unavailable");
  console.warn(
    `[warn] auto-merge main checkout check failed: ${error.message}`
  );
}

const hookSmoke = spawnSync(
  process.execPath,
  [
    "-e",
    "const {checkWriteAdvisor}=require('./scripts/harness/pre-tool-guard-core.cjs'); if (typeof checkWriteAdvisor !== 'function') process.exit(1);",
  ],
  { cwd: root, stdio: "inherit", shell: false }
);
if ((hookSmoke.status ?? 1) !== 0) {
  console.error("[codex:preflight] shared pre-tool guard failed to load");
  process.exitCode = 1;
} else {
  console.log("\n[ok] shared pre-tool guard loads");
}

const devServerCheck = run(process.execPath, [
  "scripts/harness/check-dev-server-contract.mjs",
]);
if (devServerCheck.status !== 0) {
  process.exitCode = 1;
}

if (process.exitCode) {
  console.error("[codex:preflight] failed");
} else if (partial.length) {
  console.warn(`\n[codex:preflight] partial: ${partial.join("; ")}`);
} else {
  console.log("\n[codex:preflight] ready (local prerequisite checks only)");
}
