#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const contract = require("./dev-server-contract.json");
const { checkDevServerCommand } = require("./pre-tool-guard-core.cjs");
const root = process.cwd();
const failures = [];

function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function expectIncludes(label, actual, expected) {
  if (!actual.includes(expected)) {
    failures.push(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function expectGuard(label, command, shouldBlock, options = {}) {
  const result = checkDevServerCommand(command, options, {});
  if ((result !== null) !== shouldBlock) {
    failures.push(
      `${label}: ${shouldBlock ? "must block" : "must allow"} ${JSON.stringify(command)}`
    );
  }
}

const packageJson = readJson("package.json");
expectEqual(
  "package.json dev:web",
  packageJson.scripts?.["dev:web"],
  contract.command
);
expectEqual(
  "package.json check:dev-server",
  packageJson.scripts?.["check:dev-server"],
  "node scripts/harness/check-dev-server-contract.mjs"
);
const { selectGates } = await import("./gate-manifest.mjs");
expectEqual(
  "verify profile dev contract",
  selectGates("full").includes("dev-contract"),
  true
);

const appPackage = readJson("apps/playground-web/package.json");
expectEqual(
  "playground package dev proxy",
  appPackage.scripts?.dev,
  "pnpm --dir ../.. dev:web"
);

const playwrightConfig = read("playwright.config.ts");
expectIncludes("Playwright webServer", playwrightConfig, contract.command);

for (const rel of [
  "README.md",
  "manual/ai-reference/00_meta/local-tooling.md",
]) {
  expectIncludes(rel, read(rel), contract.command);
}
expectIncludes("CLAUDE.md", read("CLAUDE.md"), "00_meta/local-tooling.md");

const viteConfig = read("apps/playground-web/vite.config.ts");
expectIncludes("Vite contract import", viteConfig, "dev-server-contract.json");
expectIncludes("Vite strict port", viteConfig, "strictPort: true");
expectIncludes(
  "Vite main port",
  viteConfig,
  "port: devServerContract.mainPort"
);
expectIncludes(
  "Vite CLI assertion",
  viteConfig,
  "assertCanonicalDevServerInvocation()"
);
// The mark that lifts the main-port rule for a runner lane is set by the runner
// and read by the config under one name; a typo on either side would end the
// runs in a primary checkout (every CI checkout) with "web server did not start".
expectIncludes(
  "Vite lane mark",
  viteConfig,
  "process.env.ORICA_E2E_LANE_SERVER"
);
expectIncludes(
  "runner lane mark",
  read("scripts/e2e-run.mjs"),
  "ORICA_E2E_LANE_SERVER: new URL(env.PW_BASE_URL).port"
);

// `.claude/` is a user-local, untracked tool configuration. Its presence or
// version must not change a repository gate; only the tracked Codex wrapper
// participates in this harness contract.
const hookWrappers = [".codex/hooks/pre-tool-guard.js"];
for (const rel of hookWrappers) {
  expectIncludes(rel, read(rel), "checkDevServerCommand(command");
}
const hookConfigs = [".codex/hooks.json"];
for (const rel of hookConfigs) {
  const hooks = read(rel);
  for (const token of ["Bash", "shell_command", "functions.shell_command"]) {
    expectIncludes(`${rel} matcher`, hooks, token);
  }
}

expectGuard("canonical main command", contract.command, false);
expectGuard(
  "canonical PowerShell background command",
  "Start-Process npx.cmd -ArgumentList 'vite','--config','apps/playground-web/vite.config.ts','--port','4173'",
  false
);
expectGuard("package alias is forbidden to AI", "pnpm dev:web", true);
// The runner's mark lifts the main-port rule, so an AI command must not set it.
for (const [label, command] of [
  ["env prefix", `ORICA_E2E_LANE_SERVER=4999 ${contract.command}`],
  ["env command", "env ORICA_E2E_LANE_SERVER=4999 node run.js"],
  ["export", "export ORICA_E2E_LANE_SERVER=4999"],
  ["PowerShell", '$env:ORICA_E2E_LANE_SERVER="4999"; node run.js'],
  ["cmd set", "set ORICA_E2E_LANE_SERVER=4999 && node run.js"],
  ["PowerShell braces", '${env:ORICA_E2E_LANE_SERVER}="4999"; node run.js'],
  ["PowerShell append", '$env:ORICA_E2E_LANE_SERVER += "4"; node run.js'],
  ["Set-Item", "Set-Item env:ORICA_E2E_LANE_SERVER 4999; node run.js"],
  [
    "Set-Item with a path",
    "Set-Item -Path Env:ORICA_E2E_LANE_SERVER -Value 4999",
  ],
  ["New-Item", "New-Item -Path Env:ORICA_E2E_LANE_SERVER -Value 4999"],
  [
    "SetEnvironmentVariable",
    "[Environment]::SetEnvironmentVariable('ORICA_E2E_LANE_SERVER','4999')",
  ],
  [
    "process.env index",
    `node -e "process.env['ORICA_E2E_LANE_SERVER']='4999'"`,
  ],
])
  expectGuard(`lane mark assignment (${label}) is forbidden`, command, true);
for (const [label, command] of [
  ["a grep", "grep -rn ORICA_E2E_LANE_SERVER scripts"],
  ["a read", "echo $env:ORICA_E2E_LANE_SERVER"],
  ["a listing", "Get-ChildItem env:ORICA_E2E_LANE_SERVER"],
  ["unset", "unset ORICA_E2E_LANE_SERVER"],
  ["a property read", "rg process.env.ORICA_E2E_LANE_SERVER apps"],
])
  expectGuard(
    `reading the lane mark (${label}) is not an assignment`,
    command,
    false
  );
expectGuard(
  "comparing the lane mark is not an assignment",
  'echo process.env.ORICA_E2E_LANE_SERVER === "1"',
  false
);
expectGuard(
  "filtered package dev is forbidden to AI",
  "pnpm --filter @orica/playground-web dev",
  true
);
expectGuard("bare vite is forbidden", "npx vite", true);
expectGuard(
  "missing explicit port is forbidden",
  "npx vite --config apps/playground-web/vite.config.ts",
  true
);
expectGuard(
  "wrong main port is forbidden",
  "npx vite --config apps/playground-web/vite.config.ts --port 4174",
  true
);
expectGuard("preview is forbidden to AI", "npx vite preview", true);
expectGuard(
  "parallel worktree assigned port",
  "npx vite --config apps/playground-web/vite.config.ts --port 4182",
  false,
  { isPrimaryWorktree: false }
);
expectGuard(
  "build is not a dev start",
  "npx vite build --config apps/playground-web/vite.config.ts",
  false
);
expectGuard(
  "searching for a command is not execution",
  `rg -n "${contract.command}" .`,
  false
);

if (failures.length > 0) {
  console.error("[check:dev-server] contract violations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[check:dev-server] ok: ${contract.command}`);
