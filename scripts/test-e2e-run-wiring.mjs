// Wiring test for scripts/e2e-run.mjs (P2-17). test-e2e-run.mjs pins the pure
// decisions; this file runs the real runner in a throwaway repo, with a fake
// Playwright CLI and real git, to pin what only the process work decides: the
// flags handed to Playwright, the lanes and their ports, the build the
// public-build spec needs, the git selection, and the exit code of each way a
// run can break. No browser, no network, no Supabase.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { URL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "orica-e2e-wiring-"));

// A stand-in for @playwright/test/cli.js. It answers `test --list` with the
// specs under e2e/ that fake-playwright.json does not ignore, and `test <files>`
// with a JSON report built from the same file. It logs every call.
const FAKE_PLAYWRIGHT = String.raw`
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync("fake-playwright.json", "utf8"));
if (process.env.FAKE_RUN_FAILURE) cfg.tests = { "e2e/a.spec.ts": [{ title: "t", status: "unexpected", error: "isolated failure" }] };
const out = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
fs.appendFileSync(
  "calls.jsonl",
  JSON.stringify({ args, base: process.env.PW_BASE_URL, json: out, laneServer: process.env.ORICA_E2E_LANE_SERVER }) + "\n"
);
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.join(dir, e.name))
      : /\.(?:spec|test)\.ts$/.test(e.name)
        ? [path.join(dir, e.name).split(path.sep).join("/")]
        : []
  );
const runnable = walk("e2e").filter(
  (f) => !(cfg.ignore ?? []).some((part) => f.includes(part))
);
const suiteFor = (file) => ({
  title: path.basename(file),
  specs: (cfg.tests?.[file] ?? [{ title: "t", status: "expected" }]).map(
    (t, index) => ({
      file: file.replace(/^e2e\//, ""),
      line: index + 1,
      title: t.title,
      tests: [
        {
          projectName: "chromium",
          status: t.status,
          results:
            t.status === "unexpected"
              ? [{ errors: [{ message: t.error ?? "boom" }] }]
              : [],
        },
      ],
    })
  ),
});
if (args.includes("--list")) {
  if (cfg.listFails) process.exit(1);
  fs.writeFileSync(out, JSON.stringify({ suites: runnable.map(suiteFor) }));
  process.exit(0);
}
const firstFlag = args.findIndex((a, i) => i > 0 && a.startsWith("--"));
const files = args.slice(1, firstFlag < 0 ? args.length : firstFlag);
if (process.env.FAKE_RUN_DELAY) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
if (files.some((f) => (cfg.noReport ?? []).includes(f))) {
  // A web server that cannot start: the cause is at the head and the summary
  // keeps only the tail, so the run must leave the whole output in a file.
  process.stderr.write("ROOT-CAUSE-AT-THE-HEAD " + "stack-tail ".repeat(400));
  process.exit(1);
}
const focused = files.some((f) =>
  fs.readFileSync(f, "utf8").includes("test.only(")
);
if (focused && args.includes("--forbid-only")) {
  fs.writeFileSync(
    out,
    JSON.stringify({ suites: [], errors: [{ message: "Error: item focused with .only" }] })
  );
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify({ suites: files.map(suiteFor) }));
process.exit(cfg.exitCode ?? 0);
`;

const BUILD_SCRIPT = String.raw`
const fs = require("fs");
if (fs.existsSync("build-fails")) process.exit(1);
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/built.txt", "ok");
`;

const emptyLedger = { schema: 1, entries: [], skips: [] };
const ledgerEntry = (extra = {}) => ({
  file: "e2e/a.spec.ts",
  project: "chromium",
  title: "t",
  reason: "r",
  issue: "issues/P2-17_e2e-unguarded-failures.md",
  ...extra,
});

function write(sandbox, file, text) {
  const path = join(sandbox, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// The runner derives its root from its own location, so the real runner and
// its core are copied next to a fake Playwright.
function makeSandbox(
  name,
  { specs = [], ledger = emptyLedger, config = {} } = {}
) {
  const sandbox = join(scratch, name);
  mkdirSync(join(sandbox, "e2e"), { recursive: true });
  mkdirSync(join(sandbox, "scripts/harness"), { recursive: true });
  copyFileSync(
    join(repoRoot, "scripts/e2e-run.mjs"),
    join(sandbox, "scripts/e2e-run.mjs")
  );
  copyFileSync(
    join(repoRoot, "scripts/harness/e2e-run-core.mjs"),
    join(sandbox, "scripts/harness/e2e-run-core.mjs")
  );
  write(
    sandbox,
    "scripts/harness/e2e-known-failures.json",
    JSON.stringify(ledger)
  );
  write(sandbox, "node_modules/@playwright/test/cli.js", FAKE_PLAYWRIGHT);
  write(sandbox, "fake-playwright.json", JSON.stringify(config));
  write(sandbox, "build.js", BUILD_SCRIPT);
  write(
    sandbox,
    "package.json",
    JSON.stringify({ name: "sandbox", scripts: { build: "node build.js" } })
  );
  for (const spec of specs) write(sandbox, spec, "// spec\n");
  return sandbox;
}

function run(sandbox, args, env = {}) {
  // A hook-run parent (pre-commit) exports GIT_DIR and friends, which would
  // point the runner's git at the real repository.
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") &&
        key !== "ORICA_VERIFY_BASE" &&
        key !== "ORICA_E2E_LANE_SERVER"
    )
  );
  const result = spawnSync(
    process.execPath,
    [join(sandbox, "scripts/e2e-run.mjs"), ...args],
    { cwd: sandbox, encoding: "utf8", env: { ...clean, ...env } }
  );
  return {
    code: result.status,
    out: `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
  };
}

function calls(sandbox) {
  const file = join(sandbox, "calls.jsonl");
  return existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse)
    : [];
}
const listCalls = (sandbox) =>
  calls(sandbox).filter((call) => call.args.includes("--list"));
const runCalls = (sandbox) =>
  calls(sandbox).filter((call) => !call.args.includes("--list"));
const filesOf = (call) =>
  call.args.slice(
    1,
    call.args.findIndex((a, i) => i > 0 && a.startsWith("--"))
  );

function git(sandbox, ...args) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: sandbox, encoding: "utf8", env: clean }
  );
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  for (const args of [
    ["--specs", ","],
    ["--full"],
    ["--changed", "--lanes", "3"],
    ["--changed", "--lanes", "NaN"],
  ]) {
    const sandbox = makeSandbox(`invalid-${args.join("-")}`);
    assert.equal(run(sandbox, args).code, 2, JSON.stringify(args));
  }
  for (const exitCode of [1, 2]) {
    const sandbox = makeSandbox(`process-failure-${exitCode}`, {
      specs: ["e2e/a.spec.ts"],
      config: { exitCode },
    });
    const result = run(sandbox, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /Playwright process exited/);
  }
  {
    const sandbox = makeSandbox("process-error-with-test-failure", {
      specs: ["e2e/a.spec.ts"],
      config: {
        exitCode: 2,
        tests: { "e2e/a.spec.ts": [{ title: "t", status: "unexpected" }] },
      },
    });
    const result = run(sandbox, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /Playwright process exited/);
  }
  // A passing run hands Playwright the flags that make its answer trustworthy:
  // JSON output, one retry, test.only forbidden and a private output directory;
  // it lists first, runs on a local port, writes report.json and exits 0.
  {
    const sandbox = makeSandbox("pass", {
      specs: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
    });
    const r = run(sandbox, ["--specs", "e2e/a.spec.ts,e2e/b.spec.ts"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /passed 2, new failures 0/);
    assert.equal(listCalls(sandbox).length, 1);
    assert.ok(listCalls(sandbox)[0].args.includes("--reporter=json"));
    const runs = runCalls(sandbox);
    assert.equal(runs.length, 1);
    for (const flag of ["--retries=1", "--forbid-only", "--reporter=json"])
      assert.ok(runs[0].args.includes(flag), `run lacks ${flag}`);
    assert.equal(runs[0].args[0], "test");
    assert.deepEqual(filesOf(runs[0]), ["e2e/a.spec.ts", "e2e/b.spec.ts"]);
    const output = runs[0].args[runs[0].args.indexOf("--output") + 1];
    assert.ok(output?.includes("artifacts-lane0"), "output dir per lane");
    assert.match(runs[0].base, /^http:\/\/localhost:\d+$/);
    // The lane's web server is marked for the dev server contract (vite.config.ts).
    // It names the lane's own port (the contract lifts its rule for that port only).
    assert.equal(runs[0].laneServer, new URL(runs[0].base).port);
    assert.ok(runs[0].laneServer, "the mark is the port, not empty");
    assert.equal(
      listCalls(sandbox)[0].laneServer,
      new URL(listCalls(sandbox)[0].base).port
    );
    const report = JSON.parse(
      readFileSync(join(dirname(runs[0].json), "report.json"), "utf8")
    );
    assert.equal(report.mode, "specs");
    assert.equal(report.comparison.ok, true);
    const firstDir = dirname(runs[0].json);
    // Every Playwright call leaves its whole output in the evidence directory.
    assert.ok(
      existsSync(join(firstDir, "list.log")),
      "the list call has a log"
    );
    assert.ok(
      existsSync(join(firstDir, "lane0-chunk0.log")),
      "the lane has a log"
    );
    const again = run(sandbox, ["--specs", "e2e/a.spec.ts,e2e/b.spec.ts"]);
    assert.equal(again.code, 0, again.out);
    const secondDir = dirname(runCalls(sandbox).at(-1).json);
    assert.notEqual(firstDir, secondDir, "each invocation owns its evidence");
    assert.ok(
      existsSync(join(firstDir, "report.json")),
      "prior evidence survives"
    );
  }

  {
    const sandbox = makeSandbox("deleted-ledger-spec", {
      specs: ["e2e/b.spec.ts"],
      ledger: { ...emptyLedger, entries: [ledgerEntry()] },
    });
    const result = run(sandbox, ["--full"]);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /STALE LEDGER/);
    assert.match(result.out, /the test no longer exists/);
  }

  {
    const sandbox = makeSandbox("concurrent-runs", {
      specs: ["e2e/a.spec.ts"],
    });
    const start = (fail) =>
      new Promise((resolve, reject) => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith("GIT_") && key !== "ORICA_VERIFY_BASE"
          )
        );
        const child = spawn(
          process.execPath,
          [join(sandbox, "scripts/e2e-run.mjs"), "--full", "--lanes", "1"],
          {
            cwd: sandbox,
            env: {
              ...env,
              FAKE_RUN_DELAY: "1",
              FAKE_RUN_FAILURE: fail ? "1" : "",
            },
            stdio: "pipe",
          }
        );
        let out = "";
        child.stdout.on("data", (data) => {
          out += data;
        });
        child.stderr.on("data", (data) => {
          out += data;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, out }));
      });
    const [pass, fail] = await Promise.all([start(false), start(true)]);
    assert.equal(pass.code, 0, pass.out);
    assert.equal(fail.code, 1, fail.out);
    assert.match(fail.out, /isolated failure/);
    const dirs = runCalls(sandbox).map((call) => dirname(call.json));
    assert.equal(new Set(dirs).size, 2);
    for (const dir of dirs) assert.ok(existsSync(join(dir, "report.json")));
  }

  // A failure the ledger does not know is a new failure: exit 1.
  {
    const sandbox = makeSandbox("new-failure", {
      specs: ["e2e/a.spec.ts"],
      config: {
        tests: {
          "e2e/a.spec.ts": [{ title: "t", status: "unexpected", error: "x" }],
        },
      },
    });
    const r = run(sandbox, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NEW FAILURE e2e\/a\.spec\.ts/);
  }

  // A ledgered failure with its pinned error is tolerated (exit 0); the same
  // test failing with another error is new (exit 1); a ledgered test that
  // passes is stale (exit 1); an unlisted skip fails (exit 1).
  {
    const known = {
      schema: 1,
      entries: [ledgerEntry({ errorIncludes: "expected-boom" })],
      skips: [],
    };
    const failing = (error) => ({
      tests: {
        "e2e/a.spec.ts": [{ title: "t", status: "unexpected", error }],
      },
    });
    const same = makeSandbox("known", {
      specs: ["e2e/a.spec.ts"],
      ledger: known,
      config: failing("expected-boom"),
    });
    const r1 = run(same, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r1.code, 0, r1.out);
    assert.match(r1.out, /known failures 1/);

    const other = makeSandbox("known-other-error", {
      specs: ["e2e/a.spec.ts"],
      ledger: known,
      config: failing("another-break"),
    });
    const r2 = run(other, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r2.code, 1, r2.out);
    assert.match(r2.out, /the ledger entry expects a different error/);

    const stale = makeSandbox("stale", {
      specs: ["e2e/a.spec.ts"],
      ledger: { schema: 1, entries: [ledgerEntry()], skips: [] },
    });
    const r3 = run(stale, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r3.code, 1, r3.out);
    assert.match(r3.out, /STALE LEDGER e2e\/a\.spec\.ts/);

    const skipConfig = {
      tests: { "e2e/a.spec.ts": [{ title: "t", status: "skipped" }] },
    };
    const unlisted = makeSandbox("skip-unlisted", {
      specs: ["e2e/a.spec.ts"],
      config: skipConfig,
    });
    const r4 = run(unlisted, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r4.code, 1, r4.out);
    assert.match(r4.out, /UNEXPECTED SKIP e2e\/a\.spec\.ts/);

    const listed = makeSandbox("skip-listed", {
      specs: ["e2e/a.spec.ts"],
      ledger: {
        schema: 1,
        entries: [],
        skips: [
          {
            file: "e2e/a.spec.ts",
            project: "chromium",
            title: "t",
            reason: "r",
          },
        ],
      },
      config: skipConfig,
    });
    const r5 = run(listed, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r5.code, 0, r5.out);
    assert.match(r5.out, /NOT VERIFIED \(skipped, listed\)/);
  }

  // A run that cannot judge is a broken run (exit 2), never a pass: a stray
  // test.only (Playwright reports it as a top-level error), a lane that wrote
  // no report, a Playwright that cannot list, a ledger that is not valid, a
  // path that is not a spec, and no mode at all.
  {
    const only = makeSandbox("only", { specs: ["e2e/a.spec.ts"] });
    write(only, "e2e/a.spec.ts", 'test.only("t", () => {});\n');
    const r1 = run(only, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r1.code, 2, r1.out);
    assert.match(r1.out, /focused with \.only/);

    const noReport = makeSandbox("no-report", {
      specs: ["e2e/a.spec.ts"],
      config: { noReport: ["e2e/a.spec.ts"] },
    });
    const r2 = run(noReport, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r2.code, 2, r2.out);
    assert.match(r2.out, /no report/);
    // The whole output of the failed lane is kept in the evidence directory,
    // not only the tail the console summary prints.
    const evidence = /e2e: evidence (.+)/.exec(r2.out)?.[1]?.trim();
    assert.ok(evidence, r2.out);
    const laneLog = readFileSync(join(evidence, "lane0-chunk0.log"), "utf8");
    assert.match(laneLog, /ROOT-CAUSE-AT-THE-HEAD/);
    assert.ok(laneLog.length > 1500, "the lane log is cut to the summary size");

    const noList = makeSandbox("no-list", {
      specs: ["e2e/a.spec.ts"],
      config: { listFails: true },
    });
    const r3 = run(noList, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r3.code, 2, r3.out);
    assert.match(r3.out, /could not list/);
    assert.equal(runCalls(noList).length, 0);

    const badLedger = makeSandbox("bad-ledger", {
      specs: ["e2e/a.spec.ts"],
      ledger: { schema: 2, entries: [] },
    });
    const r4 = run(badLedger, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r4.code, 2, r4.out);
    assert.match(r4.out, /is invalid/);
    assert.equal(calls(badLedger).length, 0);

    const notSpec = makeSandbox("not-spec", { specs: ["e2e/a.spec.ts"] });
    const r5 = run(notSpec, ["--specs", "e2e/helpers.ts"]);
    assert.equal(r5.code, 2, r5.out);
    assert.match(r5.out, /not an e2e spec path/);

    // A spec path that is not on disk is a typo, not a spec the config ignores.
    const typo = run(notSpec, ["--specs", "e2e/does-not-exist.spec.ts"]);
    assert.equal(typo.code, 2, typo.out);
    assert.match(typo.out, /e2e spec not found: e2e\/does-not-exist\.spec\.ts/);
    assert.equal(runCalls(notSpec).length, 0);

    const r6 = run(notSpec, []);
    assert.equal(r6.code, 2, r6.out);
    assert.match(r6.out, /usage:/);
  }

  // A spec the config ignores is named and left out; a selection made only of
  // ignored specs runs nothing and passes.
  {
    const sandbox = makeSandbox("ignored", {
      specs: ["e2e/a.spec.ts", "e2e/local-game-sync.spec.ts"],
      config: { ignore: ["local-game-sync"] },
    });
    const r = run(sandbox, [
      "--specs",
      "e2e/a.spec.ts,e2e/local-game-sync.spec.ts",
    ]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /local-game-sync\.spec\.ts is not run by the default/);
    assert.deepEqual(filesOf(runCalls(sandbox)[0]), ["e2e/a.spec.ts"]);

    const only = makeSandbox("ignored-only", {
      specs: ["e2e/local-game-sync.spec.ts"],
      config: { ignore: ["local-game-sync"] },
    });
    const r2 = run(only, ["--specs", "e2e/local-game-sync.spec.ts"]);
    assert.equal(r2.code, 0, r2.out);
    assert.equal(runCalls(only).length, 0);
    const emptyFull = run(only, ["--full"]);
    assert.equal(emptyFull.code, 2, emptyFull.out);
    assert.match(emptyFull.out, /full run has no runnable specs/);
  }

  // Lanes: more than 8 specs use two lanes, each with its own port and output
  // directory, and every spec runs in exactly one lane. Three specs with
  // --lanes 2 are still split across two lanes; --lanes 1 keeps one.
  {
    const names = Array.from({ length: 10 }, (_, i) => `e2e/s${i}.spec.ts`);
    const sandbox = makeSandbox("lanes", { specs: names });
    const r = run(sandbox, ["--specs", names.join(",")]);
    assert.equal(r.code, 0, r.out);
    const runs = runCalls(sandbox);
    assert.equal(runs.length, 2);
    assert.notEqual(runs[0].base, runs[1].base);
    const outputs = runs.map((c) => c.args[c.args.indexOf("--output") + 1]);
    assert.equal(new Set(outputs).size, 2);
    assert.deepEqual(runs.flatMap(filesOf).sort(), [...names].sort());

    const few = names.slice(0, 3);
    const split = makeSandbox("lanes-split", { specs: few });
    assert.equal(
      run(split, ["--specs", few.join(","), "--lanes", "2"]).code,
      0
    );
    assert.equal(runCalls(split).length, 2);
    assert.deepEqual(runCalls(split).flatMap(filesOf).sort(), [...few].sort());

    const single = makeSandbox("lanes-single", { specs: few });
    assert.equal(
      run(single, ["--specs", few.join(","), "--lanes", "1"]).code,
      0
    );
    assert.equal(runCalls(single).length, 1);
  }

  // public-build.spec.ts needs dist: the build runs before the specs, and a
  // failing build is a broken run that never reaches Playwright's run.
  {
    const sandbox = makeSandbox("build", {
      specs: ["e2e/public-build.spec.ts", "e2e/a.spec.ts"],
    });
    const r = run(sandbox, ["--specs", "e2e/public-build.spec.ts"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(sandbox, "dist/built.txt"), "utf8"), "ok");
    assert.match(r.out, /building dist for public-build\.spec\.ts/);

    const noBuild = makeSandbox("no-build", { specs: ["e2e/a.spec.ts"] });
    assert.equal(run(noBuild, ["--specs", "e2e/a.spec.ts"]).code, 0);
    assert.equal(existsSync(join(noBuild, "dist")), false);

    const failing = makeSandbox("build-fails", {
      specs: ["e2e/public-build.spec.ts"],
    });
    write(failing, "build-fails", "");
    const r2 = run(failing, ["--specs", "e2e/public-build.spec.ts"]);
    assert.equal(r2.code, 2, r2.out);
    assert.match(r2.out, /pnpm build failed/);
    assert.equal(runCalls(failing).length, 0);
  }

  // --changed reads real git: what a branch committed against main, what is
  // edited in the tree, and what is untracked; deleted specs and non-specs are
  // not selected. ORICA_VERIFY_BASE and --base move the base; a root-commit
  // base is measured against main instead of selecting every file.
  {
    const sandbox = makeSandbox("changed", {
      specs: [
        "e2e/a.spec.ts",
        "e2e/b.spec.ts",
        "e2e/d.spec.ts",
        "e2e/f.spec.ts",
      ],
    });
    write(sandbox, "e2e/helpers.ts", "export {};\n");
    git(sandbox, "init", "-q", "-b", "main");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-q", "-m", "base");
    const base = git(sandbox, "rev-parse", "HEAD");
    git(sandbox, "switch", "-q", "-c", "feature");
    write(sandbox, "e2e/a.spec.ts", "// committed on the branch\n");
    git(sandbox, "commit", "-q", "-am", "edit a");
    write(sandbox, "e2e/b.spec.ts", "// edited in the tree\n");
    write(sandbox, "e2e/c.spec.ts", "// untracked\n");
    write(sandbox, "e2e/helpers.ts", "export const x = 1;\n");
    rmSync(join(sandbox, "e2e/d.spec.ts"));
    // The finish gate runs on a staged tree: a staged edit and a staged new
    // spec are neither committed nor untracked.
    write(sandbox, "e2e/f.spec.ts", "// staged edit\n");
    write(sandbox, "e2e/e.spec.ts", "// staged new\n");
    git(sandbox, "add", "e2e/f.spec.ts", "e2e/e.spec.ts");
    const select = (args = [], env = {}) =>
      run(sandbox, ["--changed", "--select-only", ...args], env)
        .stdout.split("\n")
        .filter((line) => line.startsWith("e2e/"));
    assert.deepEqual(select(), [
      "e2e/a.spec.ts",
      "e2e/b.spec.ts",
      "e2e/c.spec.ts",
      "e2e/e.spec.ts",
      "e2e/f.spec.ts",
    ]);
    assert.deepEqual(select(["--base", base]), select());
    // Against the branch's own tip only the tree edits remain.
    assert.deepEqual(select([], { ORICA_VERIFY_BASE: "feature" }), [
      "e2e/b.spec.ts",
      "e2e/c.spec.ts",
      "e2e/e.spec.ts",
      "e2e/f.spec.ts",
    ]);
    assert.deepEqual(select(["--base", "feature"]), [
      "e2e/b.spec.ts",
      "e2e/c.spec.ts",
      "e2e/e.spec.ts",
      "e2e/f.spec.ts",
    ]);
    // A root commit as base would make every file "changed".
    const rootBase = run(sandbox, [
      "--changed",
      "--select-only",
      "--base",
      base,
    ]);
    assert.equal(rootBase.code, 0, rootBase.out);
    assert.doesNotMatch(rootBase.out, /e2e\/s?d\.spec\.ts/);
    assert.match(rootBase.out, /measuring against main \(asked for /);
    // A ref that does not exist is a broken run.
    const missing = run(sandbox, [
      "--changed",
      "--select-only",
      "--base",
      "nope",
    ]);
    assert.equal(missing.code, 2, missing.out);
    assert.match(missing.out, /base ref not found: nope/);
    // A full run through the runner reaches Playwright with the selection.
    const full = run(sandbox, ["--changed"]);
    assert.equal(full.code, 0, full.out);
    assert.deepEqual(runCalls(sandbox).flatMap(filesOf).sort(), [
      "e2e/a.spec.ts",
      "e2e/b.spec.ts",
      "e2e/c.spec.ts",
      "e2e/e.spec.ts",
      "e2e/f.spec.ts",
    ]);
  }

  // Work committed straight onto main: main...HEAD is empty, so the runner
  // measures against the published origin/main; once that holds HEAD too the
  // selection is empty on purpose and nothing runs.
  {
    const sandbox = makeSandbox("on-main", {
      specs: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
    });
    git(sandbox, "init", "-q", "-b", "main");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-q", "-m", "published");
    const published = git(sandbox, "rev-parse", "HEAD");
    git(sandbox, "update-ref", "refs/remotes/origin/main", published);
    write(sandbox, "e2e/a.spec.ts", "// committed on main, not published\n");
    git(sandbox, "commit", "-q", "-am", "edit a");
    const r = run(sandbox, ["--changed", "--select-only"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /measuring against origin\/main \(asked for main\)/);
    assert.match(r.stdout, /e2e\/a\.spec\.ts/);
    assert.doesNotMatch(r.stdout, /e2e\/b\.spec\.ts/);

    git(sandbox, "update-ref", "refs/remotes/origin/main", "HEAD");
    const done = run(sandbox, ["--changed"]);
    assert.equal(done.code, 0, done.out);
    assert.match(done.out, /no e2e spec changed; nothing to run/);
    assert.equal(calls(sandbox).length, 0);
  }

  // A report left by an earlier run is not this run's report: the output
  // directory is emptied first, so a Playwright that wrote nothing this time is
  // a broken run even though a passing report from before is still on disk.
  {
    const sandbox = makeSandbox("stale-report", { specs: ["e2e/a.spec.ts"] });
    assert.equal(run(sandbox, ["--specs", "e2e/a.spec.ts"]).code, 0);
    write(
      sandbox,
      "fake-playwright.json",
      JSON.stringify({ noReport: ["e2e/a.spec.ts"] })
    );
    const r = run(sandbox, ["--specs", "e2e/a.spec.ts"]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no report/);
  }

  // git failing is a broken run, not "no spec changed": a branch with no common
  // history with main has no merge base, and the runner must stop on it.
  {
    const sandbox = makeSandbox("git-fails", { specs: ["e2e/a.spec.ts"] });
    git(sandbox, "init", "-q", "-b", "main");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-q", "-m", "base");
    // checkout --orphan keeps the working tree; switch --orphan would empty it.
    git(sandbox, "checkout", "-q", "--orphan", "unrelated");
    write(sandbox, "e2e/a.spec.ts", "// no history shared with main\n");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-q", "-m", "orphan");
    const r = run(sandbox, ["--changed", "--select-only"]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /failed/);
    assert.doesNotMatch(r.out, /nothing to run/);
  }

  // --full (pnpm e2e:full) selects every spec, nested directories included, and
  // hands all of them to Playwright; more specs than one command line takes are
  // split into chunks that one lane runs in turn.
  {
    const nested = [
      "e2e/a.spec.ts",
      "e2e/security/b.spec.ts",
      "e2e/security/deep/c.test.ts",
    ];
    const sandbox = makeSandbox("full", { specs: nested });
    write(sandbox, "e2e/helpers.ts", "export {};\n");
    const selected = run(sandbox, ["--full", "--select-only"])
      .stdout.split("\n")
      .filter((line) => line.startsWith("e2e/"));
    assert.deepEqual(selected, [...nested].sort());
    const r = run(sandbox, ["--full"]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(
      runCalls(sandbox).flatMap(filesOf).sort(),
      [...nested].sort()
    );

    const many = Array.from(
      { length: 90 },
      (_, i) => `e2e/m${String(i).padStart(2, "0")}.spec.ts`
    );
    const chunked = makeSandbox("chunks", { specs: many });
    const r2 = run(chunked, ["--full", "--lanes", "1"]);
    assert.equal(r2.code, 0, r2.out);
    const runs = runCalls(chunked);
    assert.equal(runs.length, 3);
    assert.ok(runs.every((call) => filesOf(call).length <= 40));
    assert.deepEqual(runs.flatMap(filesOf).sort(), [...many].sort());
    // One report per chunk: no chunk overwrites another's.
    assert.equal(new Set(runs.map((call) => call.json)).size, 3);
    assert.equal(
      new Set(runs.map((call) => call.args[call.args.indexOf("--output") + 1]))
        .size,
      3,
      "retain each chunk's traces and screenshots"
    );
    assert.match(r2.out, /passed 90, new failures 0/);
  }

  // The gate passes one --base per base of the profile; every one counts. The
  // history is: root (no spec), specs added, a edited, b edited. A root commit
  // would be replaced by main, so the bases here are the later commits.
  {
    const sandbox = makeSandbox("multi-base", { specs: [] });
    git(sandbox, "init", "-q", "-b", "main");
    write(sandbox, "notes.txt", "root\n");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-q", "-m", "root");
    write(sandbox, "e2e/a.spec.ts", "// added\n");
    write(sandbox, "e2e/b.spec.ts", "// added\n");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-q", "-m", "specs");
    write(sandbox, "e2e/a.spec.ts", "// edited\n");
    git(sandbox, "commit", "-q", "-am", "edit a");
    git(sandbox, "switch", "-q", "-c", "feature");
    write(sandbox, "e2e/b.spec.ts", "// edited\n");
    git(sandbox, "commit", "-q", "-am", "edit b");
    const select = (...bases) =>
      run(sandbox, [
        "--changed",
        "--select-only",
        ...bases.flatMap((base) => ["--base", base]),
      ])
        .stdout.split("\n")
        .filter((line) => line.startsWith("e2e/"));
    assert.deepEqual(select("HEAD~1"), ["e2e/b.spec.ts"]);
    assert.deepEqual(select("HEAD~2"), ["e2e/a.spec.ts", "e2e/b.spec.ts"]);
    // The second base adds a spec the first does not reach.
    assert.deepEqual(select("HEAD~1", "HEAD~2"), [
      "e2e/a.spec.ts",
      "e2e/b.spec.ts",
    ]);
    assert.deepEqual(select("HEAD~2", "HEAD~1"), [
      "e2e/a.spec.ts",
      "e2e/b.spec.ts",
    ]);
  }

  console.log("e2e-run wiring tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
