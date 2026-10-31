#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createReviewResolution } from "./fidelity-review-resolution.mjs";
import {
  applyReviewResolutions,
  reviewContextFingerprint,
  REVIEW_REGISTRY,
} from "./fidelity-review-state.mjs";

const repoRoot = mkdtempSync(join(tmpdir(), "orica-review-state-"));
const put = (path, content) => {
  mkdirSync(dirname(join(repoRoot, path)), { recursive: true });
  writeFileSync(join(repoRoot, path), content);
};
const face = {
  cardNo: "TEST01-C01",
  textLines: ["■このターンの間、効果を得る。"],
  effects: [{ timing: { kind: "on_summon" }, textRef: [0], steps: [] }],
};
const issue = {
  cardNo: face.cardNo,
  kind: "empty_effect_steps",
  severity: "review",
  effectPath: "effects[0]",
  textRef: [0],
  detail: "Verify declaration handling.",
  evidence: { sourceLines: [{ index: 0, text: face.textLines[0] }] },
};
const violation = {
  ...issue,
  kind: "invalid_effect_steps",
  severity: "violation",
};
let passed = 0;
function test(name, run) {
  run();
  console.log(`ok ${++passed} - ${name}`);
}
try {
  put("packages/rules-core/src/engine.ts", "export const value = 1;\n");
  put("scripts/fidelity-constraint-detector.mjs", "export const value = 1;\n");
  put("manual/ai-reference/10_rules/test-rule.md", "Current interpretation.\n");
  put(
    "manual/review-evidence.md",
    "Compared original source, declaration consumer and state assertions.\n"
  );
  put(
    "packages/rules-core/test/review.test.ts",
    "import { expected } from './helper'; import { test, expect } from 'vitest'; test('declaration', () => expect(expected).toBe(1));\n"
  );
  put("packages/rules-core/test/helper.ts", "export const expected = 1;\n");
  put("packages/rules-core/test/fixture.json", '{"expected":1}\n');
  put(
    "vitest.config.ts",
    'export default { test: { include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"] } };\n'
  );
  const packageConfig = {
    scripts: {
      test: "node scripts/harness/run-gates.mjs --profile test",
      "test:review": "node scripts/test-review-fixture.mjs",
      "ismcts:operation": "node scripts/ismcts/operation.mjs",
    },
    devDependencies: { vitest: "3.2.4" },
  };
  const manifest = {
    gates: {
      vitest: { node: "scripts/vitest-with-jest-aliases.mjs" },
      review: { script: "test:review" },
      ismcts: { node: "scripts/test-ismcts-program.mjs" },
    },
    testGates: ["vitest", "review", "ismcts"],
    scopes: [
      { patterns: ["^scripts/ismcts/.*\\.(?:mjs|json)$"], gates: ["ismcts"] },
    ],
  };
  put("scripts/test-review-fixture.mjs", "export const reviewed = true;\n");
  put("package.json", JSON.stringify(packageConfig));
  put("scripts/harness/gate-manifest.json", JSON.stringify(manifest));
  const contextFingerprint = reviewContextFingerprint(repoRoot);
  const record = createReviewResolution({
    repoRoot,
    face,
    finding: issue,
    contextFingerprint,
    reason:
      "The declaration consumer implements the printed effect; the regression asserts it.",
    evidenceRefs: ["manual/review-evidence.md"],
    testRefs: ["packages/rules-core/test/review.test.ts"],
  });
  const registry = { schemaVersion: 1, records: [record] };
  const scan = (cards = [face], findings = [issue], options = {}) =>
    applyReviewResolutions(cards, findings, { repoRoot, ...options });

  test("unregistered review is active and carries a fingerprint for a single confirmation", () => {
    const state = scan();
    assert.equal(state.pending.length, 1);
    assert.equal(state.confirmed.length, 0);
    assert.equal(
      state.pending[0].reviewResolution.fingerprint,
      record.fingerprint
    );
  });
  test("adding a registry does not invalidate its context or hide a strict violation", () => {
    put(REVIEW_REGISTRY, JSON.stringify(registry));
    assert.equal(reviewContextFingerprint(repoRoot), contextFingerprint);
    const state = scan([face], [issue, violation]);
    assert.deepEqual(state.pending, [violation]);
    assert.equal(state.confirmed.length, 1);
    assert.deepEqual(state.confirmed[0].evidence, issue.evidence);
    assert.equal(
      state.confirmed[0].reviewResolution.status,
      "confirmed_correct"
    );
  });
  test("an annotated report can be used for confirmation without changing identity", () => {
    const annotated = scan().confirmed[0];
    assert.equal(scan([face], [annotated]).confirmed.length, 1);
  });
  test("changing text or implementation reopens the review", () => {
    for (const changed of [
      { ...face, textLines: ["■このバトルの間、効果を得る。"] },
      {
        ...face,
        effects: [
          { ...face.effects[0], steps: [{ action: { kind: "noop" } }] },
        ],
      },
    ])
      assert.equal(scan([changed]).pending.length, 1);
  });
  test("changing engine, ruling or test contract invalidates confirmation", () => {
    for (const path of [
      "packages/rules-core/src/engine.ts",
      "manual/ai-reference/10_rules/test-rule.md",
      "vitest.config.ts",
    ]) {
      const original = path.endsWith("test-rule.md")
        ? "Current interpretation.\n"
        : path.endsWith("vitest.config.ts")
          ? 'export default { test: { include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"] } };\n'
          : "export const value = 1;\n";
      put(path, `${original}\n// changed\n`);
      assert.equal(
        scan().pending[0].reviewResolution.reason,
        path === "vitest.config.ts"
          ? "testExecution_changed"
          : "context_changed"
      );
      put(path, original);
      assert.equal(scan().confirmed.length, 1);
    }
  });
  test("changed evidence or regression content reopens without a runtime change", () => {
    for (const path of [
      "scripts/harness/gate-manifest.mjs",
      "scripts/harness/run-gates.mjs",
      "scripts/fidelity-review-state.mjs",
      "scripts/fidelity-review-resolution.mjs",
      "needs-ruling.jsonl",
    ]) {
      put(path, "{}\n");
      assert.equal(
        scan().pending[0].reviewResolution.reason,
        "context_changed"
      );
      rmSync(join(repoRoot, path));
      assert.equal(scan().confirmed.length, 1);
    }
    for (const [path, original] of [
      [
        "manual/review-evidence.md",
        "Compared original source, declaration consumer and state assertions.\n",
      ],
      [
        "packages/rules-core/test/review.test.ts",
        "import { expected } from './helper'; import { test, expect } from 'vitest'; test('declaration', () => expect(expected).toBe(1));\n",
      ],
    ]) {
      put(path, `${original}\nchanged\n`);
      assert.equal(scan().pending.length, 1);
      put(path, original);
      assert.equal(scan().confirmed.length, 1);
    }
  });
  test("ISMCTS extension scopes and unrelated gate/command edits preserve confirmations", () => {
    const changed = globalThis.structuredClone(manifest);
    changed.scopes[0].patterns = ["^scripts/ismcts/.*\\.(?:mjs|json|ps1|cs)$"];
    changed.gates.ismcts.args = ["--new-operation"];
    changed.testGates.push("unrelated");
    changed.gates.unrelated = { node: "scripts/test-unrelated.mjs" };
    put("scripts/harness/gate-manifest.json", JSON.stringify(changed));
    put(
      "package.json",
      JSON.stringify({
        ...packageConfig,
        scripts: {
          ...packageConfig.scripts,
          "ismcts:operation": "node scripts/ismcts/new-operation.mjs",
        },
      })
    );
    put(
      "scripts/ismcts/windows-job.cs",
      "// unrelated process implementation\n"
    );
    assert.equal(reviewContextFingerprint(repoRoot), contextFingerprint);
    assert.equal(scan().confirmed.length, 1);
    put("scripts/harness/gate-manifest.json", JSON.stringify(manifest));
    put("package.json", JSON.stringify(packageConfig));
  });
  test("selected gate contracts invalidate only records that depend on them", () => {
    const scriptIssue = { ...issue, kind: "script_review" };
    const makeScriptRecord = () =>
      createReviewResolution({
        repoRoot,
        face,
        finding: scriptIssue,
        contextFingerprint,
        reason: "Separate script regression supports this claim.",
        evidenceRefs: ["manual/review-evidence.md"],
        testRefs: ["scripts/test-review-fixture.mjs"],
      });
    const scriptRecord = makeScriptRecord();
    const both = () =>
      scan([face], [issue, scriptIssue], {
        registry: { schemaVersion: 1, records: [record, scriptRecord] },
      });
    assert.equal(both().confirmed.length, 2);
    for (const target of ["vitest", "review"]) {
      const changed = globalThis.structuredClone(manifest);
      changed.gates[target].reusable = false;
      put("scripts/harness/gate-manifest.json", JSON.stringify(changed));
      assert.equal(both().confirmed.length, 1);
      assert.equal(
        both().pending[0].kind,
        target === "vitest" ? issue.kind : scriptIssue.kind
      );
      assert.equal(
        both().pending[0].reviewResolution.reason,
        "testExecution_changed"
      );
      changed.gates[target].args = ["--filter", "unrelated"];
      put("scripts/harness/gate-manifest.json", JSON.stringify(changed));
      assert.equal(both().confirmed.length, 1);
      assert.equal(
        both().pending[0].reviewResolution.reason,
        "testRefs_unavailable"
      );
      changed.testGates = changed.testGates.filter((id) => id !== target);
      put("scripts/harness/gate-manifest.json", JSON.stringify(changed));
      assert.equal(both().confirmed.length, 1);
      put("scripts/harness/gate-manifest.json", JSON.stringify(manifest));
      assert.equal(both().confirmed.length, 2);
    }
    const vitestConfig = readFileSync(
      join(repoRoot, "vitest.config.ts"),
      "utf8"
    );
    put(
      "vitest.config.ts",
      `${vitestConfig}\n// Changed include/alias contract\n`
    );
    assert.equal(both().pending.length, 2);
    assert(
      both().pending.every(
        (item) => item.reviewResolution.reason === "testExecution_changed"
      )
    );
    put("vitest.config.ts", vitestConfig);
    // Like the real test-harness regression, launch the wrapper via a child
    // process, so a literal-import scan cannot discover this dependency.
    put(
      "scripts/test-review-fixture.mjs",
      `import { spawnSync } from "node:child_process";\nspawnSync(process.execPath, ["scripts/vitest-with-jest-aliases.mjs", "no-match.test.ts"]);\n`
    );
    const indirectRecord = createReviewResolution({
      repoRoot,
      face,
      finding: scriptIssue,
      contextFingerprint,
      reason: "The script checks a child-process regression runner.",
      evidenceRefs: ["manual/review-evidence.md"],
      testRefs: ["scripts/test-review-fixture.mjs"],
    });
    const indirect = () =>
      scan([face], [scriptIssue], {
        registry: { schemaVersion: 1, records: [indirectRecord] },
      });
    assert.equal(indirect().confirmed.length, 1);
    for (const ref of [
      "vitest.config.ts",
      "scripts/vitest-with-jest-aliases.mjs",
    ]) {
      put(ref, "// changed indirect execution dependency\n");
      assert.equal(
        indirect().pending[0].reviewResolution.reason,
        "testExecution_changed"
      );
      if (ref === "vitest.config.ts") put(ref, vitestConfig);
      else rmSync(join(repoRoot, ref));
      assert.equal(indirect().confirmed.length, 1);
    }
    put("scripts/test-review-fixture.mjs", "export const reviewed = true;\n");
    put(
      "package.json",
      JSON.stringify({
        ...packageConfig,
        scripts: {
          ...packageConfig.scripts,
          "test:review":
            "node scripts/test-review-fixture.mjs && node scripts/test-review-fixture.mjs",
        },
      })
    );
    assert.equal(both().confirmed.length, 1);
    assert.equal(both().pending[0].kind, scriptIssue.kind);
    assert.equal(
      both().pending[0].reviewResolution.reason,
      "testExecution_changed"
    );
    put("package.json", JSON.stringify(packageConfig));
    for (const hook of [
      "pretest:review",
      "posttest:review",
      "pretest",
      "posttest",
    ]) {
      put(
        "package.json",
        JSON.stringify({
          ...packageConfig,
          scripts: {
            ...packageConfig.scripts,
            [hook]: "node scripts/prepare-fixture.mjs",
          },
        })
      );
      const result = both();
      assert.equal(result.pending.length, hook.includes(":review") ? 1 : 2);
      assert(
        result.pending.every(
          (item) => item.reviewResolution.reason === "testRefs_unavailable"
        )
      );
      assert.throws(makeScriptRecord, /normal-gate/);
      put("package.json", JSON.stringify(packageConfig));
    }
    // A helper's command can change without changing the hook/parent string.
    // Neither indirect hooks nor mixed pnpm preparation chains prove a gate.
    for (const parent of [
      { "pretest:review": "pnpm prepare:review" },
      { "posttest:review": "pnpm prepare:review" },
      {
        "test:review":
          "pnpm prepare:review && node scripts/test-review-fixture.mjs",
      },
      {
        "test:review":
          "node scripts/test-review-fixture.mjs && pnpm prepare:review",
      },
      {
        "test:review":
          "node scripts/prepare-fixture.mjs && node scripts/test-review-fixture.mjs",
      },
    ]) {
      for (const preparation of [
        "node scripts/check-docs.mjs",
        "node scripts/check-wiring.mjs",
      ]) {
        put(
          "package.json",
          JSON.stringify({
            ...packageConfig,
            scripts: {
              ...packageConfig.scripts,
              ...parent,
              "prepare:review": preparation,
            },
          })
        );
        assert.equal(reviewContextFingerprint(repoRoot), contextFingerprint);
        assert.equal(both().confirmed.length, 1);
        assert.equal(
          both().pending[0].reviewResolution.reason,
          "testRefs_unavailable"
        );
        assert.throws(makeScriptRecord, /normal-gate/);
      }
    }
    const aliasPackage = {
      ...packageConfig,
      scripts: {
        ...packageConfig.scripts,
        "test:review": "pnpm run review:leaf",
        "review:leaf": "node scripts/test-review-fixture.mjs",
      },
    };
    put("package.json", JSON.stringify(aliasPackage));
    const aliasRecord = makeScriptRecord();
    const aliasScan = () =>
      scan([face], [issue, scriptIssue], {
        registry: { schemaVersion: 1, records: [record, aliasRecord] },
      });
    assert.equal(aliasScan().confirmed.length, 2);
    aliasPackage.scripts["review:leaf"] +=
      " && node scripts/test-review-fixture.mjs";
    put("package.json", JSON.stringify(aliasPackage));
    assert.equal(aliasScan().confirmed.length, 1);
    assert.equal(
      aliasScan().pending[0].reviewResolution.reason,
      "testExecution_changed"
    );
    aliasPackage.scripts["review:leaf"] = "pnpm test:review";
    put("package.json", JSON.stringify(aliasPackage));
    assert.equal(
      aliasScan().pending[0].reviewResolution.reason,
      "testRefs_unavailable"
    );
    assert.throws(makeScriptRecord, /normal-gate/);
    aliasPackage.scripts["review:leaf"] =
      "node scripts/test-review-fixture.mjs";
    aliasPackage.scripts["prereview:leaf"] = "pnpm prepare:review";
    put("package.json", JSON.stringify(aliasPackage));
    assert.equal(
      aliasScan().pending[0].reviewResolution.reason,
      "testRefs_unavailable"
    );
    assert.throws(makeScriptRecord, /normal-gate/);
    put("package.json", JSON.stringify(packageConfig));
    for (const shadow of [
      { node: "scripts/not-the-regression.mjs" },
      { bin: "unrelated" },
    ]) {
      put(
        "scripts/harness/gate-manifest.json",
        JSON.stringify({
          ...manifest,
          gates: {
            ...manifest.gates,
            review: { ...manifest.gates.review, ...shadow },
          },
        })
      );
      assert.equal(both().confirmed.length, 1);
      assert.equal(both().pending[0].kind, scriptIssue.kind);
      assert.equal(
        both().pending[0].reviewResolution.reason,
        "testRefs_unavailable"
      );
    }
    put("scripts/harness/gate-manifest.json", JSON.stringify(manifest));
    put(
      "package.json",
      JSON.stringify({ ...packageConfig, devDependencies: { vitest: "next" } })
    );
    assert.equal(both().pending.length, 2);
    put("package.json", JSON.stringify(packageConfig));
    assert.equal(both().confirmed.length, 2);
  });
  test("changed finding evidence does not reuse a card-number acknowledgement", () => {
    assert.equal(
      scan([face], [{ ...issue, evidence: "A different mismatch." }]).pending
        .length,
      1
    );
  });
  test("test helpers and JSON fixtures invalidate confirmation independently", () => {
    for (const [path, original] of [
      ["packages/rules-core/test/helper.ts", "export const expected = 1;\n"],
      ["packages/rules-core/test/fixture.json", '{"expected":1}\n'],
    ]) {
      put(path, `${original}\nchanged\n`);
      assert.equal(
        scan().pending[0].reviewResolution.reason,
        "testSupport_changed"
      );
      put(path, original);
      assert.equal(scan().confirmed.length, 1);
    }
  });
  test("detector-only edits and unrelated test additions preserve unchanged claims", () => {
    put(
      "scripts/fidelity-constraint-detector.mjs",
      "export const improved = true;\n"
    );
    put(
      "packages/rules-core/test/unrelated.test.ts",
      "test('unrelated', () => {});\n"
    );
    put("apps/other/test/unrelated.test.ts", "test('unrelated', () => {});\n");
    put(
      "packages/rules-core/test/unrelated-helper.ts",
      "export const unrelated = true;\n"
    );
    assert.equal(scan().confirmed.length, 1);
    assert.equal(
      scan([face], [{ ...issue, evidence: "new detector evidence" }]).pending
        .length,
      1
    );
  });
  test("LF/CRLF conversion preserves context, evidence and test support", () => {
    for (const [path, content] of [
      ["packages/rules-core/src/engine.ts", "export const value = 1;\r\n"],
      [
        "manual/review-evidence.md",
        "Compared original source, declaration consumer and state assertions.\r\n",
      ],
      ["packages/rules-core/test/helper.ts", "export const expected = 1;\r\n"],
    ])
      put(path, content);
    assert.equal(scan().confirmed.length, 1);
  });
  test("legacy records cannot be upgraded by replacing their common context hash", () => {
    for (const schemaVersion of [1, 2]) {
      const old = { ...record, schemaVersion };
      delete old.testExecution;
      if (schemaVersion === 1) delete old.testSupport;
      assert.equal(
        scan([face], [issue], {
          registry: { schemaVersion: 1, records: [old] },
        }).pending[0].reviewResolution.reason,
        "legacy_context"
      );
    }
  });
  test("a malformed registry cannot become zero active reviews", () => {
    put(REVIEW_REGISTRY, "{");
    assert.throws(() => scan());
    put(
      REVIEW_REGISTRY,
      JSON.stringify({ schemaVersion: 1, records: "invalid" })
    );
    assert.throws(() => scan(), /Invalid review resolution registry/);
    put(REVIEW_REGISTRY, JSON.stringify({ schemaVersion: 1, records: [{}] }));
    assert.equal(scan().pending.length, 1);
  });
  test("context rejects a parent junction into another directory", () => {
    const outside = mkdtempSync(
      join(tmpdir(), "orica-review-context-outside-")
    );
    const link = join(repoRoot, "packages/rules-core");
    const saved = join(repoRoot, "packages/rules-core-original");
    mkdirSync(join(outside, "src"));
    writeFileSync(
      join(outside, "src/engine.ts"),
      "External data must not be read.\n"
    );
    renameSync(link, saved);
    try {
      symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir"
      );
      assert.throws(
        () => reviewContextFingerprint(repoRoot),
        /leaves repository/
      );
    } finally {
      unlinkSync(link);
      renameSync(saved, link);
      rmSync(outside, { recursive: true, force: true });
    }
  });
  test("runtime closure rejects an internal parent junction before following relative imports", () => {
    const runtime = join(repoRoot, "packages/rules-core/src/runtime.ts");
    const original = existsSync(runtime) ? readFileSync(runtime) : null;
    const target = join(repoRoot, "packages/rules-core/src/junction-target");
    const link = join(repoRoot, "packages/rules-core/src/junction-alias");
    const decoy = join(
      repoRoot,
      "packages/rules-core/src/junction-dependency.ts"
    );
    let linked = false;
    try {
      put(
        "packages/rules-core/src/runtime.ts",
        "export { value } from './junction-alias/leaf';\n"
      );
      put(
        "packages/rules-core/src/junction-target/nested/leaf.ts",
        "export { value } from '../junction-dependency';\n"
      );
      put(
        "packages/rules-core/src/junction-target/junction-dependency.ts",
        "export const value = 1;\n"
      );
      writeFileSync(decoy, "export const value = 1;\n");
      symlinkSync(
        join(target, "nested"),
        link,
        process.platform === "win32" ? "junction" : "dir"
      );
      linked = true;
      assert.throws(
        () => reviewContextFingerprint(repoRoot),
        /follows symlink/
      );
      put(
        "packages/rules-core/src/junction-target/junction-dependency.ts",
        "export const value = 2;\n"
      );
      assert.throws(
        () => reviewContextFingerprint(repoRoot),
        /follows symlink/
      );
    } finally {
      if (linked) unlinkSync(link);
      if (original === null) rmSync(runtime, { force: true });
      else writeFileSync(runtime, original);
      rmSync(target, { recursive: true, force: true });
      rmSync(decoy, { force: true });
    }
  });
  test("registry containment is checked before reading an external record", () => {
    const outside = mkdtempSync(
      join(tmpdir(), "orica-review-registry-outside-")
    );
    const link = join(repoRoot, "scripts");
    const saved = join(repoRoot, "scripts-original");
    writeFileSync(
      join(outside, "fidelity-review-resolutions.json"),
      "Not JSON; containment must fail before parsing."
    );
    renameSync(link, saved);
    try {
      symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir"
      );
      assert.throws(() => scan(), /leaves repository/);
    } finally {
      unlinkSync(link);
      renameSync(saved, link);
      rmSync(outside, { recursive: true, force: true });
    }
  });
  test("runtime closure preserves unrelated AI changes but invalidates transitive primitives and test imports", () => {
    put("packages/rules-core/src/runtime.ts", 'export * from "./engine";\n');
    put("packages/rules-core/src/engine.ts", 'export * from "./primitive";\n');
    put("packages/rules-core/src/primitive.ts", "export const value = 1;\n");
    put("packages/rules-core/src/ai-search.ts", "export const search = 1;\n");
    const focusedContext = reviewContextFingerprint(repoRoot);
    put("packages/rules-core/src/ai-search.ts", "export const search = 2;\n");
    assert.equal(reviewContextFingerprint(repoRoot), focusedContext);
    put("packages/rules-core/src/primitive.ts", "export const value = 2;\n");
    assert.notEqual(reviewContextFingerprint(repoRoot), focusedContext);
    const context = reviewContextFingerprint(repoRoot);
    put(
      "packages/rules-core/test/review.test.ts",
      'import { search } from "../src/ai-search";\n'
    );
    const scopedRecord = createReviewResolution({
      repoRoot,
      face,
      finding: issue,
      contextFingerprint: context,
      reason: "runtime and test import reviewed",
      evidenceRefs: ["manual/review-evidence.md"],
      testRefs: ["packages/rules-core/test/review.test.ts"],
    });
    put(
      REVIEW_REGISTRY,
      JSON.stringify({ schemaVersion: 1, records: [scopedRecord] })
    );
    assert.equal(scan().confirmed.length, 1);
    put("packages/rules-core/src/ai-search.ts", "export const search = 3;\n");
    assert.equal(reviewContextFingerprint(repoRoot), context);
    assert.equal(
      scan().pending[0].reviewResolution.reason,
      "testSupport_changed"
    );
    put(
      "packages/rules-core/src/runtime.ts",
      "export const load = name => import(name);\n"
    );
    const dynamic = reviewContextFingerprint(repoRoot);
    put("packages/rules-core/src/ai-search.ts", "export const search = 4;\n");
    assert.notEqual(
      reviewContextFingerprint(repoRoot),
      dynamic,
      "unknown loader binds all core"
    );
    put("packages/rules-core/src/runtime.ts", 'export * from "./missing";\n');
    const unresolved = reviewContextFingerprint(repoRoot);
    put("packages/rules-core/src/ai-search.ts", "export const search = 5;\n");
    assert.notEqual(
      reviewContextFingerprint(repoRoot),
      unresolved,
      "unresolved import binds all core"
    );
    put(
      "packages/rules-core/test/review.test.ts",
      "const loader = name => import(name);\n"
    );
    put("packages/rules-core/src/runtime.ts", 'export * from "./engine";\n');
    const dynamicRecord = createReviewResolution({
      repoRoot,
      face,
      finding: issue,
      contextFingerprint: reviewContextFingerprint(repoRoot),
      reason: "opaque helper loader",
      evidenceRefs: ["manual/review-evidence.md"],
      testRefs: ["packages/rules-core/test/review.test.ts"],
    });
    put(
      REVIEW_REGISTRY,
      JSON.stringify({ schemaVersion: 1, records: [dynamicRecord] })
    );
    assert.equal(scan().confirmed.length, 1);
    put("packages/rules-core/src/ai-search.ts", "export const search = 6;\n");
    assert.equal(
      scan().pending.length,
      1,
      "opaque test loader must bind arbitrary core sources"
    );
    put("packages/rules-core/src/ai-search.ts", "export const search = 5;\n");
    put(
      "packages/rules-core/test/unrelated-helper.ts",
      "export const unrelated = false;\n"
    );
    assert.equal(
      scan().pending[0].reviewResolution.reason,
      "testSupport_changed",
      "opaque helper loader keeps conservative directory binding"
    );
  });
  console.log(`[test-fidelity-review-state] ${passed} passed`);
} finally {
  rmSync(repoRoot, { recursive: true, force: true });
}
