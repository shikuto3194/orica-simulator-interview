// Pure helpers behind scripts/e2e-run.mjs (P2-17). No process, git, network
// or file access here: the runner owns those, this file owns the decisions, so
// the decisions can be tested without a browser.
//
// The e2e suite is not part of the public gates (P2-16), so a spec breaks
// silently. Two ways to notice, both built on the same runner:
//   --changed  the specs a change touched must pass (a gate);
//   --full     every spec runs and the failures are compared with a ledger of
//              known failures (a periodic run; it is not a gate: ~45 minutes).
// The ledger is the only way a failing test is tolerated, and its `skips` list
// the only way a skipped test is: a skip is "not verified", so one nobody
// listed (an unavailable login, a missing build) fails the run instead of
// passing as if it had been checked. A failure that is
// not in the ledger is new, and a ledger entry that now passes is stale, so
// the ledger can neither hide a new break nor outlive a fix.

export const LEDGER_PATH = "scripts/harness/e2e-known-failures.json";
// Playwright's default testMatch (any depth, spec|test, js|ts) under its
// testDir. Narrower than that and a spec it would run is never selected.
export const SPEC_PATTERN =
  /^e2e\/(?:.+\/)?[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/;
// Windows limits the command line, so a lane runs its specs in chunks.
export const CHUNK_SIZE = 40;

export function testKey({ file, project, title }) {
  return `${file}::${project}::${title}`;
}

// Playwright's JSON report nests describe blocks as suites. The title path
// (without the file-level suite) keeps two describes with the same test title
// apart.
export function flattenReport(report) {
  const results = [];
  const visit = (suite, path, isFile) => {
    const here = isFile || !suite.title ? path : [...path, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        // The error of the last attempt that has one. A serial group is retried
        // as a whole, and a test that failed on the first attempt can be skipped
        // on the retry (an earlier test of the group failed again): the skipped
        // attempt carries no error, but the failure it replaced is the one to judge.
        const attempts = test.results ?? [];
        const last =
          attempts.findLast((a) => a.errors?.length || a.error) ??
          attempts.at(-1) ??
          {};
        // A timeout reports "Test timeout" as the first error and the step it
        // stopped in (the locator, the line) as the second, so keep them all:
        // the ledger pins the place, and a first-error-only match cannot.
        const errors = last.errors?.length ? last.errors : [last.error];
        results.push({
          file: `e2e/${spec.file}`,
          project: test.projectName ?? "",
          title: [...here, spec.title].join(" › "),
          line: spec.line,
          status: test.status,
          error: errors
            .map((error) => String(error?.message ?? ""))
            .join("\n")
            // eslint-disable-next-line no-control-regex
            .replace(/\u001b\[[0-9;]*m/g, "")
            .slice(0, 2000),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, here, false);
  };
  for (const suite of report.suites ?? []) visit(suite, [], true);
  return results;
}

// A child process that fails to spawn emits "error" and then "close". Only the
// first result may count: the empty output of "close" would otherwise replace
// the error text that was just recorded.
export function firstCallOnly(fn) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return fn(...args);
  };
}

// Playwright reports a webServer failure, a load error or a stray test.only as
// top-level errors and then lists fewer (or no) tests, which would read as "no
// failures". A selected spec with no result at all is equally unjudged. Either
// is a broken run, not a pass.
export function runProblems(reports, results, selected) {
  const problems = [];
  for (const report of reports)
    for (const error of report.errors ?? [])
      problems.push(
        `playwright reported an error: ${String(error.message ?? error).slice(0, 300)}`
      );
  const judged = new Set(results.map((r) => r.file));
  for (const file of selected)
    if (!judged.has(file)) problems.push(`${file} produced no result`);
  return problems;
}

// The ref a change is measured against. `probe` answers three git questions:
// exists(ref), isRoot(ref) (no parent) and containsHead(ref) (HEAD is inside it).
//  - A root commit (the CI event base of a branch's first push) makes every file
//    "changed": measure against main instead.
//  - Work committed straight onto the base (HEAD is already inside it) differs
//    from it by nothing, which would select no spec at all and pass: measure
//    against the published origin/<base> instead. When that also contains HEAD
//    the work is already published, and an empty selection is true.
export function pickBase(base, probe) {
  let ref = [base, `origin/${base}`].find((candidate) =>
    probe.exists(candidate)
  );
  if (!ref) throw new Error(`base ref not found: ${base}`);
  if (probe.isRoot(ref)) {
    ref = ["main", "origin/main"].find((candidate) => probe.exists(candidate));
    if (!ref)
      throw new Error(`base ${base} is a root commit and main is missing`);
  }
  if (probe.containsHead(ref) && !ref.startsWith("origin/")) {
    const published = `origin/${ref}`;
    if (probe.exists(published) && !probe.containsHead(published))
      return published;
  }
  return ref;
}

export function selectChangedSpecs(changedFiles, exists) {
  return [...new Set(changedFiles)]
    .filter((file) => SPEC_PATTERN.test(file) && exists(file))
    .sort();
}

export function chunkSpecs(files, size = CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < files.length; index += size)
    chunks.push(files.slice(index, index + size));
  return chunks;
}

// Round-robin keeps the lanes balanced without knowing how long a spec takes.
export function assignLanes(chunks, lanes) {
  const assigned = Array.from({ length: Math.max(1, lanes) }, () => []);
  chunks.forEach((chunk, index) =>
    assigned[index % assigned.length].push(chunk)
  );
  return assigned.filter((lane) => lane.length > 0);
}

export function validateLedger(ledger) {
  const problems = [];
  if (!ledger || ledger.schema !== 1 || !Array.isArray(ledger.entries))
    return ["ledger must be {schema: 1, entries: [...]}"];
  for (const skip of ledger.skips ?? []) {
    const label = `skip ${skip?.file}::${skip?.title}`;
    if (!SPEC_PATTERN.test(skip?.file ?? ""))
      problems.push(`${label}: file is not an e2e spec path`);
    for (const field of ["project", "title", "reason"])
      if (typeof skip?.[field] !== "string" || skip[field].trim() === "")
        problems.push(`${label}: ${field} is required`);
  }
  const seen = new Set();
  for (const entry of ledger.entries) {
    const label = `${entry?.file}::${entry?.title}`;
    if (!SPEC_PATTERN.test(entry?.file ?? ""))
      problems.push(`${label}: file is not an e2e spec path`);
    for (const field of ["project", "title", "reason", "issue"])
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "")
        problems.push(`${label}: ${field} is required`);
    // errorIncludes: one string or a non-empty list; the failure must contain one.
    const pins = entry?.errorIncludes;
    if (
      pins !== undefined &&
      !(
        [].concat(pins).length > 0 &&
        [].concat(pins).every((p) => typeof p === "string" && p.trim() !== "")
      )
    )
      problems.push(`${label}: errorIncludes must be non-empty strings`);
    if (entry?.flaky !== undefined && typeof entry.flaky !== "boolean")
      problems.push(`${label}: flaky must be a boolean`);
    const key = testKey(entry ?? {});
    if (seen.has(key)) problems.push(`${label}: duplicate entry`);
    seen.add(key);
  }
  return problems;
}

// `scope` is the set of spec files this run covered. A ledger entry outside it
// is not judged: a --changed run must not call another spec's entry stale.
export function compareWithLedger(results, ledger, scope) {
  const inScope = new Set(scope);
  const entries = new Map(ledger.entries.map((e) => [testKey(e), e]));
  const byKey = new Map(results.map((r) => [testKey(r), r]));
  const failures = results.filter((r) => r.status === "unexpected");
  // A ledger entry tolerates a failure only when the failure is the one it
  // describes: with errorIncludes pinned, a different error (an engine
  // regression behind the same test title) is a new failure.
  const tolerated = (r) => {
    const entry = entries.get(testKey(r));
    if (!entry) return false;
    if (entry.errorIncludes === undefined) return true;
    return []
      .concat(entry.errorIncludes)
      .some((part) => r.error.includes(part));
  };
  const newFailures = failures
    .filter((r) => !tolerated(r))
    .map((r) =>
      entries.has(testKey(r))
        ? {
            ...r,
            error: `(the ledger entry expects a different error) ${r.error}`,
          }
        : r
    );
  const knownFailures = failures.filter(tolerated);
  const allowedSkips = new Set((ledger.skips ?? []).map(testKey));
  const skipped = results.filter((r) => r.status === "skipped");
  const stale = [];
  for (const entry of ledger.entries) {
    if (!inScope.has(entry.file)) continue;
    const result = byKey.get(testKey(entry));
    if (!result) stale.push({ entry, why: "the test no longer exists" });
    // An entry marked flaky fails only some of the time (its issue says why), so
    // passing is not proof of a fix; only a deterministic entry goes stale.
    else if (
      !entry.flaky &&
      (result.status === "expected" || result.status === "flaky")
    )
      stale.push({ entry, why: "the test passes now" });
    // A skipped entry (a serial test behind a ledgered failure) stays listed
    // as not verified; it is neither stale nor accepted.
  }
  return {
    newFailures,
    knownFailures,
    stale,
    flaky: results.filter((r) => r.status === "flaky"),
    skipped,
    unexpectedSkips: skipped.filter((r) => !allowedSkips.has(testKey(r))),
    passed: results.filter((r) => r.status === "expected").length,
    ok:
      newFailures.length === 0 &&
      stale.length === 0 &&
      skipped.every((r) => allowedSkips.has(testKey(r))),
  };
}

export function formatSummary(comparison, selected) {
  const lines = [
    `e2e: ${selected.length} spec(s); passed ${comparison.passed}, ` +
      `new failures ${comparison.newFailures.length}, ` +
      `known failures ${comparison.knownFailures.length}, ` +
      `stale ledger entries ${comparison.stale.length}, ` +
      `flaky ${comparison.flaky.length}, skipped ${comparison.skipped.length} ` +
      `(unexpected ${comparison.unexpectedSkips.length})`,
  ];
  for (const r of comparison.newFailures)
    lines.push(
      `NEW FAILURE ${r.file} [${r.project}] ${r.title}\n    ${r.error.slice(0, 600)}`
    );
  for (const { entry, why } of comparison.stale)
    lines.push(
      `STALE LEDGER ${entry.file} [${entry.project}] ${entry.title}: ${why}; remove or fix the entry (${entry.issue})`
    );
  for (const r of comparison.flaky)
    lines.push(`flaky (passed on retry) ${r.file} [${r.project}] ${r.title}`);
  // A skip is not a pass: say so instead of folding it into the count. An
  // unlisted one also fails the run.
  const unexpected = new Set(comparison.unexpectedSkips);
  for (const r of comparison.skipped)
    lines.push(
      `${unexpected.has(r) ? "UNEXPECTED SKIP" : "NOT VERIFIED (skipped, listed)"} ` +
        `${r.file} [${r.project}] ${r.title}`
    );
  return lines.join("\n");
}
