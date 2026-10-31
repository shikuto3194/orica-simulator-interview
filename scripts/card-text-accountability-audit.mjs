#!/usr/bin/env node
/**
 * cards:text-ledger — 全 nonblank card textLines の source-text accountability 監査。
 *
 * effects.textRef は構造的な原文対応であり、意味的同値の証明ではない。未参照の legacy
 * 本文は baseline で actionable と明示し、新規または変更された未参照本文だけを gate
 * failure にする。これにより marker-only 監査の死角を閉じながら、既存不足を黙殺しない。
 *
 * Usage:
 *   node scripts/card-text-accountability-audit.mjs
 *   node scripts/card-text-accountability-audit.mjs --gate
 *   node scripts/card-text-accountability-audit.mjs --json
 *   node scripts/card-text-accountability-audit.mjs --write-baseline
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildTextAccountabilityLedger,
  collectTestEvidenceRefs,
  createLegacyBaseline,
  validateInitialLegacyBaseline,
} from "./card-text-accountability-core.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const BASELINE_PATH =
  process.env.ORICA_TEXT_ACCOUNTABILITY_BASELINE_PATH ??
  join(SCRIPT_DIR, "card-text-accountability-baseline.json");
const BASELINE_REPO_PATH = relative(ROOT, BASELINE_PATH).replaceAll("\\", "/");
const OVERRIDES_PATH = resolve(
  SCRIPT_DIR,
  process.env.ORICA_TEXT_ACCOUNTABILITY_OVERRIDES_PATH ??
    "card-text-accountability-overrides.json"
);
const OUTPUT_PATH = join(ROOT, "text-accountability-audit.json");
const args = process.argv.slice(2);
const GATE = args.includes("--gate");
const JSON_ONLY = args.includes("--json");
const WRITE_BASELINE = args.includes("--write-baseline");
const FIXTURE_JSON = process.env.ORICA_TEXT_ACCOUNTABILITY_FIXTURE_JSON;
// Only explicit fixture mode can change discovery roots; production still
// validates the real workspace's executable tests.
const TEST_ROOT =
  FIXTURE_JSON !== undefined && process.env.ORICA_TEXT_ACCOUNTABILITY_TEST_ROOT
    ? resolve(process.env.ORICA_TEXT_ACCOUNTABILITY_TEST_ROOT)
    : ROOT;

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function listTestFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", ".git"].includes(entry.name)) {
        listTestFiles(path, acc);
      }
    } else if (
      entry.isFile() &&
      /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)
    ) {
      acc.push(path);
    }
  }
  return acc;
}

function loadTestFileContents() {
  const paths = [
    ...listTestFiles(join(TEST_ROOT, "packages")),
    ...listTestFiles(join(TEST_ROOT, "apps")),
    ...listTestFiles(join(TEST_ROOT, "tests")),
    ...listTestFiles(join(TEST_ROOT, "scripts")),
  ];
  const contents = new Map();
  for (const path of paths) {
    const rel = relative(TEST_ROOT, path).replaceAll("\\", "/");
    contents.set(rel, readFileSync(path, "utf8"));
  }
  return contents;
}

function loadDiscoveredTestTitles(testRefs, testFileContents) {
  const existingRefs = testRefs.filter((testRef) =>
    testFileContents.has(testRef)
  );
  const discovered = new Map(
    existingRefs.map((testRef) => [testRef, new Set()])
  );
  if (existingRefs.length === 0) return discovered;
  if (
    existingRefs.some(
      (testRef) =>
        !/^[A-Za-z0-9_./-]+\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(
          testRef
        )
    )
  ) {
    throw new Error("test evidence path has an unsupported format");
  }

  // Discover all referenced tests in one process, without shell interpolation.
  const listed = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "list",
        ...existingRefs,
        "--json",
      ],
      {
        cwd: TEST_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
  );
  for (const test of listed) {
    const listedRef = relative(TEST_ROOT, test.file).replaceAll("\\", "/");
    discovered.get(listedRef)?.add(test.name);
  }
  return discovered;
}

async function loadCards() {
  if (FIXTURE_JSON) return JSON.parse(FIXTURE_JSON);
  execSync("npx tsc -b packages/card-data", { cwd: ROOT, stdio: "pipe" });
  const distUrl = pathToFileURL(
    join(ROOT, "packages/card-data/dist/generated-index.js")
  ).href;
  const { ALL_CARDS } = await import(distUrl);
  return ALL_CARDS;
}

function changedCardDataPathsFromMain() {
  return execSync("git diff --name-only main -- packages/card-data/src", {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

function baselineDiffersFromMain() {
  return (
    execFileSync(
      "git",
      ["diff", "--name-only", "main", "--", BASELINE_REPO_PATH],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
      .split(/\r?\n/)
      .filter(Boolean).length > 0
  );
}

function isInitialBaselineInWorktree() {
  return existsSync(BASELINE_PATH) && !baselineExistsOnMain();
}

function baselineExistsOnMain() {
  try {
    execFileSync("git", ["cat-file", "-e", `main:${BASELINE_REPO_PATH}`], {
      cwd: ROOT,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function assertBaselineChangesAreSafe() {
  // Fixture input never reads card-data from this worktree. Its temporary
  // baseline must therefore be validated by the ledger rules themselves,
  // independent of an unrelated card-data change under test.
  if (FIXTURE_JSON !== undefined) return;
  if (!baselineDiffersFromMain() && !isInitialBaselineInWorktree()) return;
  if (baselineExistsOnMain()) {
    throw new Error(
      "baseline differs from main after its initial introduction. It is immutable; account for the source line through effects, a carrier, a rule, or an explicit exemption instead."
    );
  }
  const changedPaths = changedCardDataPathsFromMain();
  if (changedPaths.length > 0) {
    throw new Error(
      `refusing initial baseline introduction with card-data changes: ${changedPaths.join(", ")}. A baseline cannot bless the same change that introduced unaccounted source text.`
    );
  }
}

function assertBaselineBootstrapIsSafe() {
  if (baselineExistsOnMain()) {
    throw new Error(
      "baseline already exists on main and is immutable. Resolve entries through effects, a carrier, a rule, or an explicit exemption instead of replacing it."
    );
  }
  const changedPaths = changedCardDataPathsFromMain();
  if (changedPaths.length > 0) {
    throw new Error(
      `refusing baseline bootstrap while card data differs from main: ${changedPaths.join(", ")}. A baseline cannot bless the same change that introduced unaccounted source text.`
    );
  }
}

function mainRevision() {
  return execSync("git rev-parse main", {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main() {
  if (WRITE_BASELINE) assertBaselineBootstrapIsSafe();
  assertBaselineChangesAreSafe();
  let baseline = readJson(BASELINE_PATH, { legacyUnclaimed: {} });
  const overrides = readJson(OVERRIDES_PATH, { accounts: {} });
  const testFileContents = loadTestFileContents();
  const report = buildTextAccountabilityLedger({
    cards: await loadCards(),
    baseline,
    overrides,
    testFileContents,
    discoveredTestTitles: loadDiscoveredTestTitles(
      collectTestEvidenceRefs(overrides),
      testFileContents
    ),
  });

  if (WRITE_BASELINE) {
    baseline = {
      ...createLegacyBaseline(report),
      sourceGitBase: mainRevision(),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  }
  if (isInitialBaselineInWorktree()) {
    const seedFailures = validateInitialLegacyBaseline(report, baseline, {
      expectedSourceGitBase: mainRevision(),
    });
    if (seedFailures.length > 0) {
      report.gate.clean = false;
      report.gate.failures.push(
        ...seedFailures.map((reason) => ({
          id: "baseline-initialization",
          status: "invalid_baseline_seed",
          reason,
        }))
      );
      report.totals.invalid += seedFailures.length;
    }
  }
  if (process.env.ORICA_TEXT_ACCOUNTABILITY_NO_WRITE !== "1") {
    writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + "\n");
  }

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const t = report.totals;
    console.log("=== source-text accountability ledger ===");
    console.log(
      `nonblank ${t.nonblank} / structural ${t.structuralOnly} / carrier ${t.carrierContract} / rule ${t.generalRule} / exemption ${t.exemption}`
    );
    console.log(
      `legacy unclaimed ${t.legacyActionable} (actionable ${t.actionableLegacy}, execution-like ${t.executionLikeLegacy}) / new ${t.newUnaccounted} / changed ${t.changedUnaccounted} / invalid ${t.invalid}`
    );
    if (report.actionable.length > 0) {
      console.log("\nActionable unclaimed lines (first 20):");
      for (const line of report.actionable.slice(0, 20)) {
        console.log(`  ${line.id}: ${line.text.slice(0, 100)}`);
      }
      if (report.actionable.length > 20) {
        console.log(`  ... and ${report.actionable.length - 20} more`);
      }
    }
    console.log(`\nGate: ${report.gate.clean ? "PASS" : "FAIL"}`);
  }

  process.exit(GATE && !report.gate.clean ? 1 : 0);
}

main().catch((error) => {
  console.error(`[cards:text-ledger] ${error.message}`);
  process.exit(2);
});
