#!/usr/bin/env node
/**
 * Commit exactly the tree that passed the adversarial verifier.
 *
 * The verifier evidence is generated before commit from HEAD + staged +
 * unstaged + untracked. This wrapper checks that evidence against the current
 * worktree, stages that same tree, commits it, then checks the committed tree.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function fail(message, code = 2) {
  console.error(`[verified-commit] ${message}`);
  process.exit(code);
}

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function values(name) {
  const result = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === name) result.push(args[i + 1]);
  }
  return result;
}

function hasStandaloneFlag(name) {
  for (let index = 0; index < args.length; index++) {
    if (["-m", "--message", "--base", "--evidence"].includes(args[index])) {
      index += 1;
      continue;
    }
    if (args[index] === name) return true;
  }
  return false;
}

function rootPath(value) {
  return isAbsolute(value) ? value : resolve(ROOT, value);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    shell: false,
  });
  if ((result.status ?? 1) !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || result.stdout || "");
    }
    fail(`${command} ${commandArgs.join(" ")} failed`, result.status ?? 1);
  }
  return result;
}

const base = option("--base", "main");
const evidence = rootPath(option("--evidence", ".verifier-result.json"));
const messages = [...values("-m"), ...values("--message")];
const allowEmpty = hasStandaloneFlag("--allow-empty");

if (args.includes("-h") || args.includes("--help")) {
  console.log(
    "usage: node scripts/verified-commit.mjs -m <message> [--base main] [--evidence .verifier-result.json] [--allow-empty]"
  );
  process.exit(0);
}

if (messages.length === 0 || messages.some((message) => !message.trim())) {
  fail("commit message is required: -m <message>");
}
if (!existsSync(evidence)) {
  fail(`verifier evidence not found: ${evidence}`);
}
let evidencePayload;
try {
  evidencePayload = JSON.parse(readFileSync(evidence, "utf8"));
} catch (error) {
  fail(
    `verifier evidence JSON parse failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}
if (
  evidencePayload.schemaVersion !== 3 ||
  typeof evidencePayload.headTree !== "string" ||
  typeof evidencePayload.reportSha256 !== "string" ||
  typeof evidencePayload.reportBase64 !== "string"
) {
  fail("verifier evidence schema 3 / commit audit fields are required");
}

const evidenceArgs = [
  "scripts/verifier-evidence.mjs",
  "check-worktree",
  "--base",
  base,
  "--evidence",
  evidence,
];

run(process.execPath, evidenceArgs);
run("git", ["add", "-A", "--", "."]);
run(process.execPath, evidenceArgs);

const diffResult = spawnSync("git", ["diff", "--cached", "--quiet"], {
  cwd: ROOT,
  stdio: "ignore",
  shell: false,
});
const stagedDiffStatus = diffResult.status ?? 1;
if (stagedDiffStatus === 0) {
  if (!allowEmpty) fail("no staged changes to commit");
} else if (stagedDiffStatus !== 1) {
  fail(`git diff --cached --quiet failed`, stagedDiffStatus);
}

const commitArgs = ["commit"];
if (allowEmpty) commitArgs.push("--allow-empty");
for (const message of messages) commitArgs.push("-m", message);
commitArgs.push(
  "-m",
  [
    `Verifier-Evidence-Schema: ${evidencePayload.schemaVersion}`,
    `Verifier-Head-Tree: ${evidencePayload.headTree}`,
    `Verifier-Report-SHA256: ${evidencePayload.reportSha256}`,
    `Verifier-Report-Base64: ${evidencePayload.reportBase64}`,
  ].join("\n")
);
run("git", commitArgs);
run(process.execPath, [
  "scripts/verifier-evidence.mjs",
  "check",
  "--base",
  base,
  "--evidence",
  evidence,
]);

console.error("[verified-commit] committed verified tree");
