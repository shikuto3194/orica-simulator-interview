#!/usr/bin/env node
// Runs the Playwright e2e specs and judges them against the ledger of known
// failures (P2-17). Decisions live in harness/e2e-run-core.mjs; this file does
// the process work: choosing specs, free ports, lanes, the build the public-
// build spec needs, and the exit code.
//
//   node scripts/e2e-run.mjs --changed [--base <ref>]... [--lanes 2]
//   node scripts/e2e-run.mjs --full [--lanes 2]
//   node scripts/e2e-run.mjs --specs e2e/a.spec.ts,e2e/b.spec.ts
//
// Exit 0: every judged test passed or is a ledgered known failure.
// Exit 1: a new failure, or a stale ledger entry.
// Exit 2: the run itself broke (no report, a bad ledger, no browser): never a pass.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { URL } from "node:url";
import {
  CHUNK_SIZE,
  LEDGER_PATH,
  SPEC_PATTERN,
  assignLanes,
  chunkSpecs,
  compareWithLedger,
  firstCallOnly,
  flattenReport,
  pickBase,
  runProblems,
  formatSummary,
  selectChangedSpecs,
  validateLedger,
} from "./harness/e2e-run-core.mjs";

const root = resolve(import.meta.dirname, "..");
const playwrightCli = join(root, "node_modules/@playwright/test/cli.js");
const runsDir = join(root, ".codex-temp/e2e-run");
let outDir;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}
const flag = (name) => process.argv.includes(name);

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean);
}

// A manual run can pass several `--base <ref>`; every one is read, not just
// the first. The e2e-changed gate passes its pinned comparison bases.
function optionAll(name) {
  return process.argv.flatMap((arg, index) =>
    arg === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  );
}

const gitStatus = (args) =>
  spawnSync("git", args, { cwd: root, stdio: "ignore" }).status;
const baseProbe = {
  exists: (ref) => gitStatus(["rev-parse", "--verify", "--quiet", ref]) === 0,
  isRoot: (ref) =>
    git(["rev-list", "--parents", "-n", "1", ref])[0].split(" ").length === 1,
  // 0 = HEAD is inside ref, 1 = it is not; anything else is git failing, which
  // must not read as "not inside" (the run would then pick the wrong base).
  containsHead: (ref) => {
    const status = gitStatus(["merge-base", "--is-ancestor", "HEAD", ref]);
    if (status !== 0 && status !== 1)
      throw new Error(
        `git merge-base --is-ancestor failed (${status}) for ${ref}`
      );
    return status === 0;
  },
};

function resolveBase(base) {
  const ref = pickBase(base, baseProbe);
  if (ref !== base)
    console.log(`e2e: measuring against ${ref} (asked for ${base})`);
  return ref;
}

function changedFiles(bases) {
  // Committed on the branch (against each base), edited in the tree, and not
  // yet tracked.
  return [
    ...bases.flatMap((base) =>
      git([
        "diff",
        "--name-only",
        "--diff-filter=d",
        `${resolveBase(base)}...HEAD`,
      ])
    ),
    ...git(["diff", "--name-only", "--diff-filter=d", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ];
}

function allSpecs() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (SPEC_PATTERN.test(path)) found.push(path);
    }
  };
  walk("e2e");
  return found.sort();
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

// The whole stdout/stderr of a run (the web server's startup error included)
// is kept in `logName` under the evidence directory. The summary lines cut an
// error to its tail, so without the file a failed web server start (CI run
// 42518230879) left only the end of a stack trace.
function playwright(args, env, logName) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [playwrightCli, ...args], {
      cwd: root,
      // The lane's web server runs on a free port. ORICA_E2E_LANE_SERVER names
      // that port for the dev server contract (vite.config.ts), which lifts its
      // main-port rule only for it; a primary checkout (every CI checkout)
      // rejected the port otherwise and no lane could start.
      env: {
        ...process.env,
        ORICA_E2E_LANE_SERVER: new URL(env.PW_BASE_URL).port,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const finish = firstCallOnly((result) => {
      if (logName) {
        // A log that cannot be written must not end the run in an uncaught
        // exception (exit 1 reads as a test failure); the judgment stays with
        // the JSON report.
        try {
          writeFileSync(join(outDir, logName), result.output);
        } catch (error) {
          console.error(`e2e: could not write ${logName}: ${error.message}`);
        }
      }
      resolveRun(result);
    });
    child.on("error", (error) => finish({ code: null, output: String(error) }));
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => finish({ code, output }));
  });
}

// The config's testIgnore (specs that need their own server) is Playwright's
// to apply, so ask it which files it would run. It lists the whole suite, not
// the selection: a selection made only of ignored specs would make --list fail
// with "No tests found", which is not a broken run.
async function runnableSpecs(port) {
  const json = join(outDir, "list.json");
  const { code } = await playwright(
    ["test", "--list", "--reporter=json"],
    {
      PW_BASE_URL: `http://localhost:${port}`,
      PLAYWRIGHT_JSON_OUTPUT_NAME: json,
    },
    "list.log"
  );
  if (code !== 0 || !existsSync(json)) return null;
  const report = JSON.parse(readFileSync(json, "utf8"));
  return [...new Set(flattenReport(report).map((r) => r.file))];
}

async function runLane(laneIndex, chunks, port, reports) {
  for (const [chunkIndex, chunk] of chunks.entries()) {
    console.log(
      `e2e: lane ${laneIndex} chunk ${chunkIndex + 1}/${chunks.length}: ${chunk.length} specs starting`
    );
    const json = join(outDir, `lane${laneIndex}-chunk${chunkIndex}.json`);
    const { code, output } = await playwright(
      [
        "test",
        ...chunk,
        "--retries=1",
        "--forbid-only",
        "--reporter=json",
        "--output",
        join(outDir, `artifacts-lane${laneIndex}-chunk${chunkIndex}`),
      ],
      {
        PW_BASE_URL: `http://localhost:${port}`,
        PLAYWRIGHT_JSON_OUTPUT_NAME: json,
      },
      `lane${laneIndex}-chunk${chunkIndex}.log`
    );
    if (!existsSync(json)) {
      console.error(
        `lane ${laneIndex} chunk ${chunkIndex}: no report (exit ${code}).\n${output.slice(-1500)}`
      );
      reports.push(null);
    } else {
      const report = JSON.parse(readFileSync(json, "utf8"));
      // Exit 1 may describe ordinary test failures, including ledgered ones.
      // A crashed launcher or a failed process with an all-green report is not
      // evidence of a successful run.
      if (
        code !== 0 &&
        (code !== 1 ||
          !flattenReport(report).some((r) => r.status === "unexpected"))
      ) {
        report.errors = [
          ...(report.errors ?? []),
          {
            message: `Playwright process exited ${code}: ${output.slice(-500)}`,
          },
        ];
      }
      reports.push(report);
    }
    console.log(
      `e2e: lane ${laneIndex} chunk ${chunkIndex + 1}/${chunks.length}: exit ${code}`
    );
  }
}

async function main() {
  const specsOption = option("--specs", "");
  const bases = optionAll("--base");
  // Gates pass their pinned comparison SHAs. Manual runs default to main;
  // CI can provide its event base when invoked outside the gate runner.
  if (bases.length === 0)
    bases.push(process.env.ORICA_VERIFY_BASE?.trim() || "main");
  const lanes = Number(option("--lanes", "0"));
  if (![0, 1, 2].includes(lanes)) {
    console.error("e2e: --lanes must be 1 or 2 (at most two live lanes)");
    return 2;
  }
  const mode = flag("--full")
    ? "full"
    : specsOption
      ? "specs"
      : flag("--changed")
        ? "changed"
        : null;
  if (!mode) {
    console.error(
      "usage: e2e-run.mjs --changed|--full|--specs a,b [--lanes N]"
    );
    return 2;
  }

  const ledger = JSON.parse(readFileSync(join(root, LEDGER_PATH), "utf8"));
  const problems = validateLedger(ledger);
  if (problems.length > 0) {
    console.error(`${LEDGER_PATH} is invalid:\n- ${problems.join("\n- ")}`);
    return 2;
  }

  let selected =
    mode === "full"
      ? allSpecs()
      : mode === "specs"
        ? specsOption.split(",").filter(Boolean)
        : selectChangedSpecs(changedFiles(bases), (file) =>
            existsSync(join(root, file))
          );
  const unknown = selected.filter((file) => !SPEC_PATTERN.test(file));
  if (unknown.length > 0) {
    console.error(`not an e2e spec path: ${unknown.join(", ")}`);
    return 2;
  }
  // A path typed by hand that is not on disk is a mistake, not a spec the config
  // ignores: left to the listing below it would be "skipped" and the run green.
  const missing = selected.filter((file) => !existsSync(join(root, file)));
  if (missing.length > 0) {
    console.error(`e2e spec not found: ${missing.join(", ")}`);
    return 2;
  }
  if (selected.length === 0) {
    if (mode !== "changed") {
      console.error("e2e: explicit selection is empty; nothing was verified");
      return 2;
    }
    console.log("e2e: no e2e spec changed; nothing to run");
    return 0;
  }

  if (flag("--select-only")) {
    // For tests and for looking at what a base selects: no browser, no run.
    console.log(selected.join("\n"));
    return 0;
  }

  mkdirSync(runsDir, { recursive: true });
  outDir = mkdtempSync(join(runsDir, "run-"));
  console.log(`e2e: evidence ${outDir}`);
  const listPort = await freePort();
  const runnable = await runnableSpecs(listPort);
  if (!runnable) {
    console.error("e2e: playwright could not list the selected specs");
    return 2;
  }
  const ignored = selected.filter((file) => !runnable.includes(file));
  for (const file of ignored)
    console.log(`e2e: ${file} is not run by the default config; skipped`);
  selected = selected.filter((file) => runnable.includes(file));
  if (selected.length === 0) {
    if (mode === "full") {
      console.error("e2e: full run has no runnable specs");
      return 2;
    }
    return 0;
  }

  // public-build.spec.ts serves dist, which `pnpm build` makes.
  if (selected.includes("e2e/public-build.spec.ts")) {
    console.log("e2e: building dist for public-build.spec.ts");
    const build = spawnSync("pnpm", ["build"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    if (build.status !== 0) {
      console.error("e2e: pnpm build failed; public-build.spec.ts not judged");
      return 2;
    }
  }

  const laneCount = lanes > 0 ? lanes : selected.length > 8 ? 2 : 1;
  const assigned = assignLanes(chunkSpecs(selected, CHUNK_SIZE), laneCount);
  // One chunk per lane would idle lanes when there are few specs; chunking
  // by CHUNK_SIZE only matters for the command line, so split evenly instead.
  const perLane =
    assigned.length < laneCount && selected.length > laneCount
      ? assignLanes(
          chunkSpecs(selected, Math.ceil(selected.length / laneCount)),
          laneCount
        )
      : assigned;
  const ports = [];
  for (const _lane of perLane) ports.push(await freePort());
  const reports = [];
  await Promise.all(
    perLane.map((chunks, index) =>
      runLane(index, chunks, ports[index], reports)
    )
  );
  if (reports.some((report) => report === null)) return 2;

  const results = reports.flatMap(flattenReport);
  const unjudged = runProblems(reports, results, selected);
  if (unjudged.length > 0) {
    console.error(
      `e2e: the run did not judge every spec:\n- ${unjudged.join("\n- ")}`
    );
    return 2;
  }
  const ledgerScope =
    mode === "full"
      ? [
          ...new Set([
            ...selected,
            ...ledger.entries.map((entry) => entry.file),
          ]),
        ]
      : selected;
  const comparison = compareWithLedger(results, ledger, ledgerScope);
  writeFileSync(
    join(outDir, "report.json"),
    JSON.stringify({ mode, bases, selected, ignored, comparison }, null, 1)
  );
  console.log(formatSummary(comparison, selected));
  return comparison.ok ? 0 : 1;
}

process.exitCode = await main().catch((error) => {
  console.error(error);
  return 2;
});
