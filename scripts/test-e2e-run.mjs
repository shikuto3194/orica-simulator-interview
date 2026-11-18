import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEDGER_PATH,
  SPEC_PATTERN,
  assignLanes,
  chunkSpecs,
  compareWithLedger,
  firstCallOnly,
  flattenReport,
  pickBase,
  formatSummary,
  selectChangedSpecs,
  runProblems,
  testKey,
  validateLedger,
} from "./harness/e2e-run-core.mjs";
import {
  fullGates,
  gateNeedsBrowser,
  gates,
  selectGates,
} from "./harness/gate-manifest.mjs";
import { pathOverride } from "./harness/semantic-scope.mjs";

const root = resolve(import.meta.dirname, "..");
const entry = (title, extra = {}) => ({
  file: "e2e/a.spec.ts",
  project: "chromium",
  title,
  reason: "r",
  issue: "issues/P2-17_e2e-unguarded-failures.md",
  ...extra,
});
const result = (title, status, extra = {}) => ({
  file: "e2e/a.spec.ts",
  project: "chromium",
  title,
  status,
  error: "boom",
  ...extra,
});

// A describe block keeps two tests with the same title apart; ANSI colour in the
// error is dropped; the last retry decides the error.
{
  const report = {
    suites: [
      {
        title: "a.spec.ts",
        specs: [
          {
            file: "a.spec.ts",
            line: 3,
            title: "top",
            tests: [
              { projectName: "chromium", status: "expected", results: [] },
            ],
          },
        ],
        suites: [
          {
            title: "group",
            specs: [
              {
                file: "a.spec.ts",
                line: 9,
                title: "inner",
                tests: [
                  {
                    projectName: "chromium",
                    status: "unexpected",
                    results: [
                      { errors: [{ message: "first" }] },
                      { errors: [{ message: "\u001b[31mlast\u001b[39m" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const flat = flattenReport(report);
  assert.deepEqual(
    flat.map((r) => [r.file, r.title, r.status, r.error]),
    [
      ["e2e/a.spec.ts", "top", "expected", ""],
      ["e2e/a.spec.ts", "group › inner", "unexpected", "last"],
    ]
  );
  assert.equal(testKey(flat[1]), "e2e/a.spec.ts::chromium::group › inner");
}

// A serial group is retried as a whole: a test that failed on the first attempt
// is then skipped on the retry, without an error. The failure it replaced is the
// one to judge (and to match against a ledger pin), not the empty skipped attempt.
{
  const retried = {
    suites: [
      {
        title: "a.spec.ts",
        specs: [
          {
            file: "a.spec.ts",
            line: 7,
            title: "later in a serial group",
            tests: [
              {
                projectName: "chromium",
                status: "unexpected",
                results: [
                  { status: "failed", errors: [{ message: "pinned failure" }] },
                  { status: "skipped", errors: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const [only] = flattenReport(retried);
  assert.equal(only.error, "pinned failure");
  const pinned = {
    schema: 1,
    entries: [
      entry("later in a serial group", { errorIncludes: "pinned failure" }),
    ],
  };
  assert.equal(compareWithLedger([only], pinned, ["e2e/a.spec.ts"]).ok, true);
  // With several attempts that carry an error, the LAST one is judged: a first
  // failure that a retry then fails differently must not hide the new failure.
  const [twice] = flattenReport({
    suites: [
      {
        title: "a.spec.ts",
        specs: [
          {
            file: "a.spec.ts",
            line: 9,
            title: "fails twice, differently",
            tests: [
              {
                projectName: "chromium",
                status: "unexpected",
                results: [
                  { status: "failed", errors: [{ message: "old failure A" }] },
                  { status: "failed", errors: [{ message: "new failure B" }] },
                  { status: "skipped", errors: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(twice.error, "new failure B");
  const pinnedToOld = {
    schema: 1,
    entries: [
      entry("fails twice, differently", { errorIncludes: "old failure A" }),
    ],
  };
  assert.equal(
    compareWithLedger([twice], pinnedToOld, ["e2e/a.spec.ts"]).ok,
    false,
    "a pin on the first failure does not tolerate a different last failure"
  );
  // With no error anywhere, the result is still empty (and matches no pin).
  const [bare] = flattenReport({
    suites: [
      {
        title: "a.spec.ts",
        specs: [
          {
            file: "a.spec.ts",
            line: 8,
            title: "x",
            tests: [
              {
                projectName: "chromium",
                status: "unexpected",
                results: [{ status: "skipped", errors: [] }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(bare.error, "");
}

// A timeout names the step it stopped in as the second error. Every error is
// kept, so a ledger entry can pin the place and not only "Test timeout".
{
  const timedOut = {
    suites: [
      {
        title: "a.spec.ts",
        specs: [
          {
            file: "a.spec.ts",
            line: 5,
            title: "slow",
            tests: [
              {
                projectName: "chromium",
                status: "unexpected",
                results: [
                  {
                    errors: [
                      { message: "Test timeout of 30000ms exceeded." },
                      {
                        message:
                          "locator.click: waiting for getByRole('button')",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const [slow] = flattenReport(timedOut);
  assert.match(
    slow.error,
    /Test timeout of 30000ms exceeded\.\nlocator\.click: waiting for getByRole/
  );
  const pinned = {
    schema: 1,
    entries: [
      entry("slow", { errorIncludes: "waiting for getByRole('button')" }),
    ],
  };
  const generic = { ...slow, error: "Test timeout of 30000ms exceeded." };
  assert.equal(compareWithLedger([slow], pinned, ["e2e/a.spec.ts"]).ok, true);
  assert.equal(
    compareWithLedger([generic], pinned, ["e2e/a.spec.ts"]).ok,
    false,
    "a timeout that does not name the pinned step is a different failure"
  );
}

// Only existing spec paths in e2e/ are selected; helpers, deleted files and
// other directories are not.
assert.deepEqual(
  selectChangedSpecs(
    [
      "e2e/b.spec.ts",
      "e2e/a.spec.ts",
      "e2e/a.spec.ts",
      "e2e/security/c.spec.ts",
      "e2e/helpers.ts",
      "e2e/gone.spec.ts",
      "docs/x.spec.ts",
      "e2e/Bad_Name.spec.ts",
      "e2e/deep/er/x.test.ts",
      "e2e/notes.md",
    ],
    (file) => file !== "e2e/gone.spec.ts"
  ),
  [
    "e2e/Bad_Name.spec.ts",
    "e2e/a.spec.ts",
    "e2e/b.spec.ts",
    "e2e/deep/er/x.test.ts",
    "e2e/security/c.spec.ts",
  ]
);
// The pattern is what Playwright would run (any depth, spec or test, js or ts),
// so a spec named outside the existing convention is still selected.
for (const name of [
  "e2e/Foo_bar.spec.ts",
  "e2e/sub/x.spec.ts",
  "e2e/x.test.mjs",
  "e2e/x.spec.tsx",
])
  assert.match(name, SPEC_PATTERN, name);
for (const name of [
  "e2e/helpers.ts",
  "docs/a.spec.ts",
  "e2e/a.spec.ts.bak",
  "e2e/x.json",
])
  assert.doesNotMatch(name, SPEC_PATTERN, name);

assert.deepEqual(chunkSpecs(["a", "b", "c", "d", "e"], 2), [
  ["a", "b"],
  ["c", "d"],
  ["e"],
]);
assert.deepEqual(assignLanes([["a"], ["b"], ["c"]], 2), [
  [["a"], ["c"]],
  [["b"]],
]);
assert.deepEqual(assignLanes([["a"]], 3), [[["a"]]]);

// The ledger is validated before it is trusted.
assert.deepEqual(validateLedger({ schema: 1, entries: [entry("t")] }), []);
assert.ok(validateLedger({ schema: 2, entries: [] }).length > 0);
assert.ok(
  validateLedger({
    schema: 1,
    entries: [entry("t"), entry("t")],
  }).some((p) => p.includes("duplicate"))
);
assert.ok(
  validateLedger({ schema: 1, entries: [entry("t", { reason: " " })] }).some(
    (p) => p.includes("reason")
  )
);
assert.ok(
  validateLedger({
    schema: 1,
    entries: [entry("t", { file: "docs/a.spec.ts" })],
  }).some((p) => p.includes("file"))
);

const ledger = { schema: 1, entries: [entry("known"), entry("fixed")] };
const scope = ["e2e/a.spec.ts"];

// A failure outside the ledger fails the run; a ledgered one does not.
{
  const c = compareWithLedger(
    [
      result("known", "unexpected"),
      result("fixed", "unexpected"),
      result("fresh", "unexpected"),
    ],
    ledger,
    scope
  );
  assert.deepEqual(
    c.newFailures.map((r) => r.title),
    ["fresh"]
  );
  assert.equal(c.knownFailures.length, 2);
  assert.equal(c.ok, false);
}
{
  const c = compareWithLedger(
    [result("known", "unexpected"), result("fixed", "unexpected")],
    ledger,
    scope
  );
  assert.equal(c.ok, true);
}
// An entry that passes (or vanished) is stale: the ledger cannot outlive a fix.
{
  const c = compareWithLedger(
    [result("known", "unexpected"), result("fixed", "expected")],
    ledger,
    scope
  );
  assert.deepEqual(
    c.stale.map((s) => [s.entry.title, s.why]),
    [["fixed", "the test passes now"]]
  );
  assert.equal(c.ok, false);
  const gone = compareWithLedger(
    [result("known", "unexpected")],
    ledger,
    scope
  );
  assert.equal(gone.stale[0].why, "the test no longer exists");
  const flakyEntry = compareWithLedger(
    [result("known", "unexpected"), result("fixed", "flaky")],
    ledger,
    scope
  );
  assert.equal(flakyEntry.stale.length, 1);
}
// A flaky entry is a known failure that may also pass: passing is not stale,
// failing is still known, and a non-boolean flag is rejected.
{
  const flakyLedger = {
    schema: 1,
    entries: [entry("blinks", { flaky: true })],
  };
  assert.equal(
    compareWithLedger([result("blinks", "expected")], flakyLedger, scope).ok,
    true
  );
  assert.equal(
    compareWithLedger([result("blinks", "flaky")], flakyLedger, scope).ok,
    true
  );
  const failing = compareWithLedger(
    [result("blinks", "unexpected")],
    flakyLedger,
    scope
  );
  assert.equal(failing.ok, true);
  assert.equal(failing.knownFailures.length, 1);
  assert.ok(
    validateLedger({
      schema: 1,
      entries: [entry("t", { flaky: "yes" })],
    }).some((p) => p.includes("flaky"))
  );
}
// A run that did not cover a spec does not judge that spec's entries.
{
  const c = compareWithLedger([], ledger, ["e2e/other.spec.ts"]);
  assert.deepEqual(c.stale, []);
  assert.equal(c.ok, true);
}
// A retry-pass is reported but does not fail. A skip is never folded into the
// passed count: a listed skip (an opt-in, a serial test behind a ledgered
// failure) is reported as not verified, and an unlisted one fails the run.
{
  const skip = (title) => ({
    file: "e2e/a.spec.ts",
    project: "chromium",
    title,
    reason: "r",
  });
  const withSkips = { ...ledger, skips: [skip("known"), skip("opt-in")] };
  const c = compareWithLedger(
    [
      result("known", "skipped"),
      result("fixed", "unexpected"),
      result("steady", "expected"),
      result("blinks", "flaky"),
      result("opt-in", "skipped"),
    ],
    withSkips,
    scope
  );
  assert.equal(c.ok, true);
  assert.equal(c.passed, 1);
  assert.equal(c.flaky.length, 1);
  assert.equal(c.skipped.length, 2);
  assert.equal(c.unexpectedSkips.length, 0);
  const text = formatSummary(c, scope);
  assert.match(
    text,
    /NOT VERIFIED \(skipped, listed\) e2e\/a\.spec\.ts \[chromium\] opt-in/
  );
  assert.match(text, /flaky \(passed on retry\)/);
  assert.doesNotMatch(text, /NEW FAILURE|UNEXPECTED SKIP/);

  // The same skip without a listing (for example the login is unavailable)
  // fails the run instead of passing as if it had been checked.
  const unlisted = compareWithLedger(
    [
      result("known", "unexpected"),
      result("fixed", "unexpected"),
      result("auth", "skipped"),
    ],
    ledger,
    scope
  );
  assert.equal(unlisted.ok, false);
  assert.deepEqual(
    unlisted.unexpectedSkips.map((r) => r.title),
    ["auth"]
  );
  assert.match(
    formatSummary(unlisted, scope),
    /UNEXPECTED SKIP e2e\/a\.spec\.ts \[chromium\] auth/
  );
}
// A ledger entry that pins the error tolerates only that failure: the same
// test failing differently (a new regression behind an old title) is new.
{
  const pinned = {
    schema: 1,
    entries: [entry("t", { errorIncludes: ["card-eugeo-sword", "arrows"] })],
  };
  const fails = (error) =>
    compareWithLedger([result("t", "unexpected", { error })], pinned, scope);
  assert.equal(fails("Locator: getByTestId('card-eugeo-sword')").ok, true);
  assert.equal(fails("the public arrows are missing").ok, true);
  const other = fails(
    "expect(received).toBe(expected) Expected: 3 Received: 2"
  );
  assert.equal(other.ok, false);
  assert.equal(other.knownFailures.length, 0);
  assert.match(other.newFailures[0].error, /expects a different error/);
  assert.equal(
    compareWithLedger(
      [result("t", "unexpected", { error: "anything" })],
      { schema: 1, entries: [entry("t")] },
      scope
    ).ok,
    true,
    "an entry without errorIncludes tolerates any error of that test"
  );
  for (const bad of ["", [], [""], [1], 5])
    assert.ok(
      validateLedger({
        schema: 1,
        entries: [entry("t", { errorIncludes: bad })],
      }).some((p) => p.includes("errorIncludes")),
      JSON.stringify(bad)
    );
}
// A malformed skips list is rejected.
assert.ok(
  validateLedger({
    schema: 1,
    entries: [],
    skips: [{ file: "docs/a.spec.ts", project: "", title: "t", reason: "r" }],
  }).length >= 2
);
{
  const text = formatSummary(
    compareWithLedger([result("fresh", "unexpected")], ledger, scope),
    scope
  );
  assert.match(
    text,
    /NEW FAILURE e2e\/a\.spec\.ts \[chromium\] fresh\n {4}boom/
  );
  assert.match(text, /STALE LEDGER/);
}

// The base a change is measured against. A fake probe stands in for git.
{
  const probe = ({ exists = [], roots = [], withHead = [] }) => ({
    exists: (ref) => exists.includes(ref),
    isRoot: (ref) => roots.includes(ref),
    containsHead: (ref) => withHead.includes(ref),
  });
  // An ordinary branch: HEAD is not in main, main is the base.
  assert.equal(
    pickBase("main", probe({ exists: ["main", "origin/main"] })),
    "main"
  );
  // No local main: the remote one.
  assert.equal(
    pickBase("main", probe({ exists: ["origin/main"] })),
    "origin/main"
  );
  assert.throws(() => pickBase("main", probe({})), /not found/);
  // A branch's first CI push has the root commit as its base: use main.
  assert.equal(
    pickBase(
      "1234abcd",
      probe({ exists: ["1234abcd", "main"], roots: ["1234abcd"] })
    ),
    "main"
  );
  assert.throws(
    () =>
      pickBase(
        "1234abcd",
        probe({ exists: ["1234abcd"], roots: ["1234abcd"] })
      ),
    /root commit and main is missing/
  );
  // Committed straight onto local main: HEAD is inside main, so main selects
  // nothing. Measure against what is published.
  assert.equal(
    pickBase(
      "main",
      probe({ exists: ["main", "origin/main"], withHead: ["main"] })
    ),
    "origin/main"
  );
  // Already published too: nothing is unpublished, an empty selection is true.
  assert.equal(
    pickBase(
      "main",
      probe({
        exists: ["main", "origin/main"],
        withHead: ["main", "origin/main"],
      })
    ),
    "main"
  );
  // No remote to compare with: keep main.
  assert.equal(
    pickBase("main", probe({ exists: ["main"], withHead: ["main"] })),
    "main"
  );
  // An explicit event SHA that contains HEAD has no origin/<sha>: keep it.
  assert.equal(
    pickBase(
      "0123abcd",
      probe({ exists: ["0123abcd"], withHead: ["0123abcd"] })
    ),
    "0123abcd"
  );
}

// A run that judged nothing is a problem, never a pass: Playwright's top-level
// errors (webServer failure, load error, test.only) and a selected spec that
// has no result both count.
{
  const ok = { suites: [] };
  assert.deepEqual(
    runProblems([ok], [result("t", "expected")], ["e2e/a.spec.ts"]),
    []
  );
  assert.match(
    runProblems(
      [{ errors: [{ message: "Error: Timed out waiting for webServer" }] }],
      [result("t", "expected")],
      ["e2e/a.spec.ts"]
    )[0],
    /playwright reported an error: Error: Timed out waiting for webServer/
  );
  assert.deepEqual(runProblems([ok], [], ["e2e/a.spec.ts"]), [
    "e2e/a.spec.ts produced no result",
  ]);
  assert.deepEqual(
    runProblems(
      [ok],
      [result("t", "expected")],
      ["e2e/a.spec.ts", "e2e/b.spec.ts"]
    ),
    ["e2e/b.spec.ts produced no result"]
  );
}

// The CI plan installs a browser only for gates that need one. The e2e gate
// spawns Playwright through its own runner, so it must say so.
assert.equal(gateNeedsBrowser({ bin: "playwright" }), true);
assert.equal(
  gateNeedsBrowser({ node: "node_modules/@playwright/test/cli.js" }),
  true
);
assert.equal(gateNeedsBrowser({ node: "scripts/e2e-run.mjs" }), false);
assert.equal(
  gateNeedsBrowser({ node: "scripts/e2e-run.mjs", browser: true }),
  true
);
assert.equal(gateNeedsBrowser(gates["e2e-changed"]), true);
// The selected specs depend on the profile base, not just the source tree.
// Reuse must match the pinned base SHA as well as the input fingerprint.
assert.equal(gates["e2e-changed"].diffBase, true);

// A spec edited together with other files falls back to the full gate set. The
// gate must be in it, or a mixed change would skip the spec it edited.
assert.ok(fullGates.includes("e2e-changed"));
{
  const spec = "e2e/scenario-mandatory-followup.spec.ts";
  for (const profile of ["finish", "push", "merge", "ci"]) {
    assert.ok(
      selectGates(
        profile,
        [spec],
        () => null,
        () => false,
        [],
        {
          [spec]: pathOverride(spec),
        }
      ).includes("e2e-changed"),
      `${profile}: a spec alone`
    );
    assert.ok(
      selectGates(
        profile,
        [spec, "scripts/some-new-tool.mjs"],
        () => null,
        () => false,
        [],
        { [spec]: pathOverride(spec) }
      ).includes("e2e-changed"),
      `${profile}: a spec next to an unrelated file`
    );
  }
}

// Every e2e spec is run by some gate when it changes alone: either the
// e2e-changed gate or a gate that names it. Four specs are run through a
// config's testMatch instead, by the gate on the right.
{
  const viaConfig = {
    "e2e/local-game-sync.spec.ts": "local-game-ui",
    "e2e/scenario-blazing-star-oracle.spec.ts": "local-game-ui",
    "e2e/scenario-effect-usage-accounting.spec.ts": "local-game-ui",
    "e2e/public-build.spec.ts": "public-build",
  };
  const specs = execFileSync("git", ["ls-files", "e2e"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => SPEC_PATTERN.test(file));
  assert.ok(specs.length > 200);
  for (const spec of specs) {
    const selected = selectGates(
      "finish",
      [spec],
      () => null,
      () => false,
      [],
      { [spec]: pathOverride(spec) }
    );
    const runs =
      selected.includes("e2e-changed") ||
      selected.some((id) => (gates[id].args ?? []).includes(spec)) ||
      selected.includes(viaConfig[spec]);
    assert.ok(
      runs,
      `${spec} alone selects only ${selected.join(",")}: no gate runs it`
    );
  }
}

// The committed ledger is valid and names specs that exist.
{
  const committed = JSON.parse(
    readFileSync(resolve(root, LEDGER_PATH), "utf8")
  );
  assert.deepEqual(validateLedger(committed), []);
  for (const e of committed.entries)
    assert.ok(existsSync(resolve(root, e.file)), `${e.file} is missing`);
  for (const e of committed.entries)
    assert.ok(
      existsSync(resolve(root, e.issue.split("#")[0])),
      `${e.issue} is missing`
    );
}

// A spawn failure emits "error" and then "close": only the first result is
// used, so the error text is not replaced by the empty output of "close".
{
  const seen = [];
  const once = firstCallOnly((value) => {
    seen.push(value);
    return value;
  });
  assert.equal(once("error: spawn ENOENT"), "error: spawn ENOENT");
  assert.equal(once(""), undefined);
  assert.deepEqual(seen, ["error: spawn ENOENT"]);
}

console.log("e2e run tests passed");
