#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  createReviewResolution,
  fingerprintReview,
  resolveReview,
} from "./fidelity-review-resolution.mjs";

const script = fileURLToPath(
  new URL("./fidelity-review-resolution.mjs", import.meta.url)
);
const suite = mkdtempSync(join(tmpdir(), "orica-fidelity-resolution-"));
const repoRoot = join(suite, "repo");
const evidence = "manual/ruling.md";
const regression = "packages/rules-core/test/review.test.ts";
const scriptTest = "scripts/test-fidelity-fixture.mjs";
const contextFingerprint = "context-sha256-v1";
const face = {
  cardNo: "TEST01-C01(B)",
  textLines: ["■自分はデッキから1枚ドローする。"],
  effects: [
    {
      timing: { kind: "on_summon" },
      textRef: [0],
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const finding = {
  cardNo: face.cardNo,
  severity: "review",
  kind: "source_review",
  effectPath: "effects[0]",
  path: "effects[0].steps[0]",
  textRef: [0],
  evidence: { sourceLines: [{ index: 0, text: face.textLines[0] }] },
  detail: "Compare source meaning.",
};
const options = {
  repoRoot,
  face,
  finding,
  contextFingerprint,
  reason: "The source and regression establish this behavior.",
  evidenceRefs: [evidence],
  testRefs: [regression],
};
const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const registry = (record) => ({ schemaVersion: 1, records: [record] });
const disposition = (record, overrides = {}) =>
  resolveReview({ ...options, registry: registry(record), ...overrides });
const copy = (value) => globalThis.structuredClone(value);
let passed = 0;
function test(name, run) {
  run();
  console.log(`ok ${++passed} - ${name}`);
}
function resetFiles() {
  put(
    join(repoRoot, evidence),
    "Source ruling: this implementation is correct.\n"
  );
  put(
    join(repoRoot, regression),
    'import { it, expect } from "vitest"; it("regression", () => expect(1).toBe(1));\n'
  );
  put(
    join(repoRoot, scriptTest),
    'import assert from "node:assert/strict"; assert.equal(1, 1);\n'
  );
  put(
    join(repoRoot, "package.json"),
    JSON.stringify({
      scripts: {
        test: "pnpm test:fidelity",
        "test:fidelity": `node ${scriptTest} && node scripts/vitest-with-jest-aliases.mjs`,
      },
    })
  );
}
function cli(overrides = {}, extraArgs = []) {
  put(
    join(suite, "report.json"),
    JSON.stringify({ auditIssues: [overrides.finding ?? finding] })
  );
  put(join(suite, "face.json"), JSON.stringify(face));
  const out = join(suite, `record-${passed}.json`);
  const args = [
    script,
    "--repo-root",
    repoRoot,
    "--report",
    join(suite, "report.json"),
    "--collection",
    "auditIssues",
    "--index",
    overrides.index ?? "0",
    "--face",
    join(suite, "face.json"),
    ...(overrides.omitContext
      ? []
      : ["--context-fingerprint", contextFingerprint]),
    "--reason",
    options.reason,
    "--evidence",
    evidence,
    "--test-ref",
    regression,
    "--out",
    out,
    ...extraArgs,
  ];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { ...result, out };
}

try {
  resetFiles();
  test("a reviewed finding resolves only with complete evidence snapshots", () => {
    const record = createReviewResolution(options);
    assert.equal(record.disposition, "confirmed_correct");
    assert.match(record.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(disposition(record).status, "confirmed_correct");
    assert.deepEqual(
      record.evidenceRefs.map(({ path }) => path),
      [evidence]
    );
    assert.deepEqual(
      record.testRefs.map(({ path }) => path),
      [regression]
    );
  });
  test("object key order is stable but array order is significant", () => {
    const reordered = Object.fromEntries(Object.entries(face).reverse());
    assert.equal(
      fingerprintReview({ face, finding }),
      fingerprintReview({ face: reordered, finding })
    );
    const changed = copy(face);
    changed.textLines.unshift("A new source line.");
    assert.notEqual(
      fingerprintReview({ face, finding }),
      fingerprintReview({ face: changed, finding })
    );
  });
  test("all face implementation fields participate, not just referenced effect", () => {
    const record = createReviewResolution(options);
    for (const changed of [
      { ...face, cost: 8 },
      { ...face, maxCombinedBraves: 2 },
      { ...face, mirageData: { cost: 2, effects: [] } },
      {
        ...face,
        effects: [
          ...face.effects,
          { timing: { kind: "continuous" }, steps: [] },
        ],
      },
    ])
      assert.equal(disposition(record, { face: changed }).status, "pending");
  });
  test("source text and back-face identity changes invalidate confirmation", () => {
    const record = createReviewResolution(options);
    assert.equal(
      disposition(record, {
        face: { ...face, textLines: ["■自分はデッキから2枚ドローする。"] },
      }).status,
      "pending"
    );
    const other = { ...face, cardNo: "TEST01-C01(A)" };
    assert.equal(
      disposition(record, {
        face: other,
        finding: { ...finding, cardNo: other.cardNo },
      }).status,
      "pending"
    );
  });
  test("finding kind, exact paths, references and evidence invalidate confirmation", () => {
    const record = createReviewResolution(options);
    for (const changes of [
      { kind: "other_review" },
      { path: "effects[1]" },
      { effectPath: "effects[1]" },
      { textRef: [1] },
      { evidence: "New detector evidence." },
      { detail: "Changed meaning." },
    ]) {
      assert.equal(
        disposition(record, { finding: { ...finding, ...changes } }).status,
        "pending"
      );
    }
  });
  test("consumer reviewResolution metadata never feeds back into identity", () => {
    const record = createReviewResolution(options);
    assert.equal(
      disposition(record, {
        finding: {
          ...finding,
          reviewResolution: { status: "pending", fingerprint: "old" },
          generatedAt: "tomorrow",
        },
      }).status,
      "confirmed_correct"
    );
  });
  test("violation and unknown severity cannot be recorded or resolved", () => {
    const record = createReviewResolution(options);
    for (const severity of ["violation", undefined, "warning"]) {
      const changed = { ...finding, severity };
      assert.throws(
        () => createReviewResolution({ ...options, finding: changed }),
        /Only review/
      );
      assert.equal(
        disposition(record, { finding: changed }).reason,
        "not_review"
      );
    }
  });
  test("missing or changed context always invalidates the disposition", () => {
    const record = createReviewResolution(options);
    for (const value of [undefined, "", " "]) {
      assert.throws(
        () => createReviewResolution({ ...options, contextFingerprint: value }),
        /contextFingerprint/
      );
      assert.equal(
        disposition(record, { contextFingerprint: value }).reason,
        "context_missing"
      );
    }
    assert.equal(
      disposition(record, { contextFingerprint: "context-v2" }).reason,
      "context_changed"
    );
  });
  test("unregistered findings and card-number-only acknowledgements stay pending", () => {
    assert.equal(resolveReview({ ...options }).reason, "registry_missing");
    assert.equal(
      resolveReview({ ...options, registry: { schemaVersion: 1, records: [] } })
        .reason,
      "unregistered"
    );
    assert.equal(
      resolveReview({
        ...options,
        registry: registry({
          cardNo: face.cardNo,
          disposition: "confirmed_correct",
        }),
      }).reason,
      "registry_invalid"
    );
  });
  test("corrupt registry, duplicate matches and needs-ruling records fail closed", () => {
    const record = createReviewResolution(options);
    for (const bad of [
      "invalid json",
      [],
      {},
      { schemaVersion: 2, records: [record] },
      registry(null),
      registry({ ...record, disposition: "needs_ruling" }),
      registry({ ...record, evidenceRefs: [] }),
    ]) {
      assert.equal(
        resolveReview({ ...options, registry: bad }).reason,
        "registry_invalid"
      );
    }
    assert.equal(
      resolveReview({
        ...options,
        registry: { schemaVersion: 1, records: [record, record] },
      }).reason,
      "duplicate_records"
    );
  });
  test("record identity cannot be swapped independently of its fingerprint", () => {
    const record = createReviewResolution(options);
    assert.equal(
      disposition({ ...record, cardNo: "OTHER" }).reason,
      "record_identity_mismatch"
    );
  });
  test("reason, evidence and regression references are mandatory", () => {
    for (const changes of [
      { reason: "" },
      { evidenceRefs: [] },
      { testRefs: [] },
      { evidenceRefs: [""] },
    ])
      assert.throws(() => createReviewResolution({ ...options, ...changes }));
  });
  test("needs-ruling cannot be generated as a confirmed disposition", () => {
    assert.throws(
      () => createReviewResolution({ ...options, disposition: "needs_ruling" }),
      /Only confirmed_correct/
    );
  });
  test("changing evidence bytes invalidates its hash", () => {
    const record = createReviewResolution(options);
    put(join(repoRoot, evidence), "Changed ruling.\n");
    assert.equal(disposition(record).reason, "evidenceRefs_changed");
    resetFiles();
  });
  test("changing regression bytes invalidates its hash", () => {
    const record = createReviewResolution(options);
    put(join(repoRoot, regression), "// Different regression.\n");
    assert.equal(disposition(record).reason, "testRefs_changed");
    resetFiles();
  });
  test("missing evidence or regression files do not conceal a finding", () => {
    for (const [ref, expected] of [
      [evidence, "evidenceRefs_unavailable"],
      [regression, "testRefs_unavailable"],
    ]) {
      const record = createReviewResolution(options);
      rmSync(join(repoRoot, ref));
      const result = disposition(record);
      assert.equal(result.reason, expected);
      assert.ok(result.errors.length);
      resetFiles();
    }
  });
  test("a manually corrupted stored hash cannot resolve", () => {
    const record = createReviewResolution(options);
    record.evidenceRefs[0].sha256 = "0".repeat(64);
    assert.equal(disposition(record).reason, "evidenceRefs_changed");
  });
  test("absolute paths, traversal, directories and symlink escapes are rejected", () => {
    put(join(suite, "outside", "ruling.md"), "Outside repository.\n");
    symlinkSync(join(suite, "outside"), join(repoRoot, "escaped"), "junction");
    for (const ref of [
      join(repoRoot, evidence),
      "../outside/ruling.md",
      "escaped/ruling.md",
      "manual",
      "C:\\outside\\ruling.md",
    ]) {
      assert.throws(() =>
        createReviewResolution({ ...options, evidenceRefs: [ref] })
      );
    }
    const record = createReviewResolution(options);
    record.evidenceRefs[0].path = "escaped/ruling.md";
    assert.equal(disposition(record).reason, "evidenceRefs_unavailable");
  });
  test("deduplicated repo-relative references have deterministic order", () => {
    put(join(repoRoot, "manual", "additional.md"), "Additional source.\n");
    const first = createReviewResolution({
      ...options,
      evidenceRefs: [evidence, "manual/additional.md", evidence],
    });
    const second = createReviewResolution({
      ...options,
      evidenceRefs: ["manual/additional.md", evidence],
    });
    assert.deepEqual(first, second);
  });
  test("a documentation file or an unexecuted script is not a regression testRef", () => {
    put(join(repoRoot, "scripts", "test-unwired.mjs"), "// Not in the gate.\n");
    for (const ref of [evidence, "scripts/test-unwired.mjs"])
      assert.throws(
        () => createReviewResolution({ ...options, testRefs: [ref] }),
        /normal-gate/
      );
  });
  test("script regressions must remain in the normal package test chain", () => {
    const record = createReviewResolution({
      ...options,
      testRefs: [scriptTest],
    });
    assert.equal(disposition(record).status, "confirmed_correct");
    put(
      join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node scripts/not-a-regression.mjs",
          "test:unused": `node ${scriptTest}`,
        },
      })
    );
    assert.equal(disposition(record).reason, "testRefs_unavailable");
    resetFiles();
  });
  test("shell text containing apparent node commands cannot prove gate membership", () => {
    resetFiles();
    const manifestFile = join(repoRoot, "scripts/harness/gate-manifest.json");
    put(
      join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: { test: "node scripts/harness/run-gates.mjs --profile test" },
      })
    );
    put(
      manifestFile,
      JSON.stringify({
        gates: { regression: { node: scriptTest } },
        testGates: ["regression"],
      })
    );
    const record = createReviewResolution({
      ...options,
      testRefs: [scriptTest],
    });
    assert.equal(disposition(record).status, "confirmed_correct");
    put(
      manifestFile,
      JSON.stringify({
        gates: { regression: { node: scriptTest } },
        testGates: [],
      })
    );
    assert.equal(disposition(record).reason, "testRefs_unavailable");
    resetFiles();
    for (const command of [
      `node -e "console.log('ok && node ${scriptTest} && done')"`,
      `echo $(echo ok && node ${scriptTest} && echo done)`,
      `echo quoted\\ && node ${scriptTest}`,
      `echo ok & node ${scriptTest}`,
      `echo ok\nnode ${scriptTest}`,
      `echo ok # && node ${scriptTest}`,
      `false && node ${scriptTest}`,
    ]) {
      put(
        join(repoRoot, "package.json"),
        JSON.stringify({ scripts: { test: command } })
      );
      assert.throws(
        () => createReviewResolution({ ...options, testRefs: [scriptTest] }),
        /normal-gate/
      );
    }
    resetFiles();
  });
  test("apps and nested Vitest regressions are allowed, unrelated spec files are not", () => {
    const ref = "apps/playground-web/test/nested/review.test.ts";
    put(
      join(repoRoot, ref),
      'import { it } from "vitest"; it("regression", () => {});\n'
    );
    assert.equal(
      disposition(createReviewResolution({ ...options, testRefs: [ref] }))
        .status,
      "confirmed_correct"
    );
    put(
      join(repoRoot, "tests/review.spec.ts"),
      "// Outside ordinary Vitest include.\n"
    );
    assert.throws(
      () =>
        createReviewResolution({
          ...options,
          testRefs: ["tests/review.spec.ts"],
        }),
      /normal-gate/
    );
  });
  test("Vitest default-excluded files are not accepted as normal-gate regressions", () => {
    for (const ref of [
      "packages/rules-core/test/dist/fake.test.ts",
      "packages/rules-core/test/node_modules/fake.test.ts",
      "packages/rules-core/test/cypress/fake.test.ts",
      "packages/rules-core/test/.cache/fake.test.ts",
      "apps/playground-web/test/vitest.config.test.ts",
    ]) {
      put(
        join(repoRoot, ref),
        'import { it } from "vitest"; it("unexecuted", () => {});\n'
      );
      assert.throws(
        () => createReviewResolution({ ...options, testRefs: [ref] }),
        /normal-gate/
      );
    }
  });
  test("non-JSON face values and cycles fail closed", () => {
    for (const extension of [() => {}, Number.NaN, new Date()]) {
      const changed = { ...face, extension };
      assert.throws(() => fingerprintReview({ face: changed, finding }));
      assert.equal(
        resolveReview({ ...options, face: changed }).reason,
        "invalid_finding"
      );
    }
    const cyclic = copy(face);
    cyclic.self = cyclic;
    assert.throws(() => fingerprintReview({ face: cyclic, finding }), /cycle/);
  });
  test("CLI emits exactly one record and refuses to overwrite its output", () => {
    const result = cli();
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(readFileSync(result.out, "utf8"));
    assert.equal(disposition(record).status, "confirmed_correct");
    assert.equal(record.records, undefined);
    const again = cli();
    assert.equal(again.status, 2);
    assert.match(again.stderr, /EEXIST/);
  });
  test("CLI rejects violations, batch index and missing context", () => {
    assert.equal(
      cli({ finding: { ...finding, severity: "violation" } }).status,
      2
    );
    const batch = cli({ index: "all" });
    assert.equal(batch.status, 2);
    assert.match(batch.stderr, /exactly one finding/);
    const missing = cli({ omitContext: true });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /contextFingerprint/);
  });
  test("module import is inert and API calls do not mutate their inputs", () => {
    const before = JSON.stringify(options);
    const record = createReviewResolution(options);
    disposition(record);
    assert.equal(JSON.stringify(options), before);
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(new URL("./fidelity-review-resolution.mjs", import.meta.url).href)}); console.log('imported');`,
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "imported");
  });
  console.log(`PASS ${passed} fidelity review resolution tests`);
} finally {
  // Verify the computed recursive cleanup target remains the one fixture directory.
  const target = realpathSync(suite);
  assert.equal(dirname(target), realpathSync(tmpdir()));
  assert.ok(basename(target).startsWith("orica-fidelity-resolution-"));
  rmSync(target, { recursive: true, force: true });
}
