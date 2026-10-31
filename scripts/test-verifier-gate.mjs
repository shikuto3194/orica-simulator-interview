#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVerificationTree,
  changedFilesBetweenTrees,
} from "./verifier-tree.mjs";
import {
  extractDeclaredCardNos,
  extractReferencedCardNos,
} from "./verifier-card-context.mjs";
import {
  fullGates,
  requiresMergeFuzz,
  selectGates,
  testGates,
} from "./harness/gate-manifest.mjs";
import {
  isCompleteTestGateReport,
  hasReusableTestGateEvidence,
  isReusableCompletionReport,
  isReusableGateSourceReport,
} from "./harness/run-gates.mjs";

assert.deepEqual(selectGates("dialogue", []), ["vitest"]);
assert.deepEqual(selectGates("dialogue", null), ["vitest"]);
assert.deepEqual(
  selectGates("dialogue", [
    "packages/rules-core/src/effect/action-count-selection.ts",
  ]),
  ["changed-style", "vitest"]
);
assert.deepEqual(
  selectGates("finish", ["packages/rules-core/src/runtime.ts"]),
  fullGates,
  "shared engine surfaces remain fail-closed"
);
assert.deepEqual(
  selectGates("finish", [
    "packages/rules-core/src/effect/action-count-selection.ts",
  ]),
  [
    "changed-style",
    "types",
    "vitest",
    "put-semantics",
    "fidelity",
    "ismcts-runtime",
  ]
);
assert.deepEqual(
  selectGates("merge", [
    "packages/rules-core/src/effect/action-count-selection.ts",
  ]),
  [
    "changed-style",
    "types",
    "vitest",
    "put-semantics",
    "fidelity",
    "ismcts-runtime",
  ],
  "known rules-core changes select game-relevant merge gates"
);
assert.deepEqual(
  selectGates("finish", ["packages/rules-core/test/trigger-system.test.ts"]),
  ["changed-style", "vitest"],
  "a rules-core test-only change selects the targeted suite, not operations"
);
assert.deepEqual(
  selectGates("merge", ["packages/card-data/src/cards/example.ts"]),
  [
    "changed-style",
    "types",
    "vitest",
    "put-semantics",
    "fidelity",
    "ismcts-runtime",
    "ledger",
    "card-tests",
  ],
  "card data changes retain ledger, coverage, and gameplay regression gates"
);
assert.deepEqual(
  selectGates("merge", ["packages/card-data/package.json"]),
  [...fullGates, "card-tests"],
  "package/dependency changes remain fail-closed"
);
assert.deepEqual(
  selectGates("finish", [
    "packages/rules-core/src/effect/action-count-selection.ts",
    "apps/playground-web/src/api/room.ts",
  ]),
  fullGates,
  "mixed game and unclassified API paths remain fail-closed"
);
assert.equal(
  requiresMergeFuzz([
    "packages/rules-core/src/effect/action-count-selection.ts",
  ]),
  true
);
assert.equal(
  requiresMergeFuzz(["packages/card-data/src/cards/example.ts"]),
  true
);
assert.equal(
  requiresMergeFuzz(["packages/rules-core/test/trigger-system.test.ts"]),
  false
);
assert.equal(requiresMergeFuzz(["manual/ai-reference/example.md"]), false);
assert.equal(
  requiresMergeFuzz(["scripts/run-supervisor-iteration.ps1"]),
  false
);
assert.equal(requiresMergeFuzz(["packages/rules-core/src/runtime.ts"]), true);
assert.equal(requiresMergeFuzz(["scripts/unclassified-change.mjs"]), true);
assert.equal(requiresMergeFuzz(["scripts/auto-merge.ps1"]), false);
const dialoguePackageLine =
  '"verify:dialogue": "node scripts/harness/run-gates.mjs --profile dialogue",';
assert.deepEqual(
  selectGates("finish", ["package.json"], () => [dialoguePackageLine]),
  ["changed-style", "harness"]
);
assert.equal(
  requiresMergeFuzz(["package.json"], () => [dialoguePackageLine]),
  false
);
assert.deepEqual(
  selectGates("finish", ["package.json"], () => [
    dialoguePackageLine,
    '"dependencies": {',
  ]),
  fullGates,
  "a dependency change alongside the dialogue command remains fail-closed"
);
assert.equal(
  requiresMergeFuzz([
    "manual/ai-reference/example.md",
    "packages/rules-core/src/effect/action-count-selection.ts",
  ]),
  true
);
assert.equal(
  isReusableCompletionReport({ schemaVersion: 2, completionGate: false }),
  false,
  "interactive and unit receipts cannot satisfy final acceptance"
);
assert.equal(
  isReusableCompletionReport({ schemaVersion: 1, completionGate: true }),
  false,
  "unknown receipt versions cannot be reused"
);
assert.equal(
  isReusableCompletionReport({ schemaVersion: 2, completionGate: true }),
  true
);
assert.equal(
  isReusableGateSourceReport({
    schemaVersion: 2,
    profile: "test",
    completionGate: false,
  }),
  true,
  "full test profile receipts may provide individually matching gates"
);
assert.equal(
  isReusableGateSourceReport({
    schemaVersion: 2,
    profile: "dialogue",
    completionGate: false,
  }),
  true,
  "dialogue results must still invalidate an older passing gate"
);
assert.equal(
  isReusableGateSourceReport({
    schemaVersion: 2,
    profile: "unit",
    completionGate: false,
  }),
  true,
  "unit results must still invalidate an older passing gate"
);

assert.deepEqual(
  extractDeclaredCardNos(
    'const cards = [{ cardNo: "BSTH002-転醒R01(A)" }, { cardNo: "BSTH002-転醒R01(B)" }, { cardNo: "BSTH002-転醒R01(A)" }];'
  ),
  ["BSTH002-転醒R01(A)", "BSTH002-転醒R01(B)"]
);

assert.deepEqual(
  extractReferencedCardNos(
    '"BSTH002-転醒R01(A)" "BSTH002-転醒R01(B)" "BSTH02.7-TX01(B)" "BSTH03-C31"'
  ),
  ["BSTH002-転醒R01(A)", "BSTH002-転醒R01(B)", "BSTH02.7-TX01(B)", "BSTH03-C31"]
);
assert.deepEqual(extractReferencedCardNos('"BSTH002-転醒R01"'), [
  "BSTH002-転醒R01",
]);
assert.equal(
  extractReferencedCardNos('"BSTH002-転醒R01(B)"').includes(
    "BSTH002-転醒R01(A)"
  ),
  false
);
assert.deepEqual(extractReferencedCardNos('"BSTH03-C31A"'), []);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "orica-verifier-gate-"));
const currentTestFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: REPO_ROOT, encoding: "utf8" }
)
  .split("\0")
  .filter((file) => /^(packages|apps)\/.+\/test\/.+\.test\.ts$/.test(file));
const completeVitestPath = join(tempRoot, "complete-vitest.json");
writeFileSync(
  completeVitestPath,
  JSON.stringify({
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numPassedTests: currentTestFiles.length,
    testResults: currentTestFiles.map((file) => ({
      name: join(REPO_ROOT, file),
      assertionResults: [{ status: "passed" }],
    })),
  })
);
const completeTestReport = {
  schemaVersion: 2,
  profile: "test",
  completionGate: false,
  status: "passed",
  startedAt: 100,
  finishedAt: 200,
  selectedGates: [...testGates],
  vitestArgs: [],
  gates: testGates.map((id) => ({
    id,
    status: "passed",
    reused: false,
    ...(id === "vitest"
      ? { testResults: { kind: "vitest", path: completeVitestPath } }
      : {}),
  })),
};
// Git lists untracked files before tracked files; complete coverage is a set,
// not that listing order. Exercise this without changing the working checkout.
const orderRoot = join(tempRoot, "untracked-test-order");
const orderFiles = [
  "apps/fixture/test/a.test.ts",
  "apps/fixture/test/z.test.ts",
];
mkdirSync(join(orderRoot, "apps/fixture/test"), { recursive: true });
try {
  execFileSync("git", ["init", "--quiet", orderRoot], { windowsHide: true });
  for (const file of orderFiles)
    writeFileSync(join(orderRoot, file), "// fixture\n");
  execFileSync("git", ["add", "--", orderFiles[0]], {
    cwd: orderRoot,
    windowsHide: true,
  });
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: orderRoot, encoding: "utf8", windowsHide: true }
  )
    .split("\0")
    .filter(Boolean);
  assert.deepEqual(listed, [orderFiles[1], orderFiles[0]]);
  const resultPath = join(orderRoot, "complete.json");
  const suite = (file, status = "passed") => ({
    name: join(orderRoot, file),
    assertionResults: [{ status }],
  });
  const report = {
    ...completeTestReport,
    gates: completeTestReport.gates.map((gate) =>
      gate.id === "vitest"
        ? { ...gate, testResults: { kind: "vitest", path: resultPath } }
        : gate
    ),
  };
  const save = (testResults) =>
    writeFileSync(
      resultPath,
      JSON.stringify({
        success: true,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        numPassedTests: 2,
        testResults,
      })
    );
  save(orderFiles.map((file) => suite(file)));
  assert.equal(
    isCompleteTestGateReport(report, orderRoot),
    true,
    "complete tracked/untracked tests must not depend on Git listing order"
  );
  for (const [name, suites] of [
    ["missing", [suite(orderFiles[0])]],
    ["duplicate", [suite(orderFiles[0]), suite(orderFiles[0])]],
    ["skipped", [suite(orderFiles[0]), suite(orderFiles[1], "pending")]],
    ["failed", [suite(orderFiles[0]), suite(orderFiles[1], "failed")]],
  ]) {
    save(suites);
    assert.equal(
      isCompleteTestGateReport(report, orderRoot),
      false,
      `${name} test coverage must remain rejected`
    );
  }
} finally {
  assert.equal(dirname(orderRoot), tempRoot);
  rmSync(orderRoot, { recursive: true, force: true });
}

assert.equal(
  isCompleteTestGateReport(completeTestReport, REPO_ROOT),
  true,
  "only a complete, unfiltered test profile with every current Vitest file can provide gate evidence"
);
assert.equal(
  hasReusableTestGateEvidence(completeTestReport, "harness", REPO_ROOT),
  true,
  "a fresh passing non-Vitest gate is reusable only in an exact full test-gate report"
);
assert.equal(
  hasReusableTestGateEvidence(
    {
      ...completeTestReport,
      selectedGates: completeTestReport.selectedGates.slice(1),
      gates: completeTestReport.gates.slice(1),
    },
    "harness",
    REPO_ROOT
  ),
  false,
  "a partial report cannot claim any test-profile gate as passed"
);
assert.equal(
  hasReusableTestGateEvidence(
    { ...completeTestReport, gates: [null] },
    "harness",
    REPO_ROOT
  ),
  false,
  "a malformed receipt gate entry is rejected without aborting fresh verification"
);
assert.equal(
  hasReusableTestGateEvidence(
    {
      ...completeTestReport,
      selectedGates: [...completeTestReport.selectedGates, "unknown-gate"],
      gates: [
        ...completeTestReport.gates,
        { id: "unknown-gate", status: "passed", reused: false },
      ],
    },
    "harness",
    REPO_ROOT
  ),
  false,
  "an extra unknown gate cannot turn a receipt into exact test-profile evidence"
);
const filteredTestReport = {
  ...completeTestReport,
  vitestArgs: ["--testNamePattern=one"],
};
assert.equal(
  hasReusableTestGateEvidence(filteredTestReport, "harness", REPO_ROOT),
  true,
  "a filtered Vitest run may still supply its separately executed non-Vitest gate result"
);
assert.equal(
  hasReusableTestGateEvidence(filteredTestReport, "vitest", REPO_ROOT),
  false,
  "a filtered Vitest result cannot replace the full suite"
);
assert.equal(
  isCompleteTestGateReport(
    {
      ...completeTestReport,
      selectedGates: completeTestReport.selectedGates.slice(1),
    },
    REPO_ROOT
  ),
  false,
  "a partial test selection is not a complete test report"
);
assert.equal(
  isCompleteTestGateReport(
    { ...completeTestReport, vitestArgs: ["--testNamePattern=x"] },
    REPO_ROOT
  ),
  false,
  "filtered test runs cannot provide reusable passes"
);
assert.equal(
  isCompleteTestGateReport(
    {
      ...completeTestReport,
      gates: completeTestReport.gates.map((gate) =>
        gate.id === "vitest" ? { ...gate, reused: true } : gate
      ),
    },
    REPO_ROOT
  ),
  false,
  "a report that reused a gate is not a complete fresh test profile"
);
const partialVitestPath = join(tempRoot, "partial-vitest.json");
writeFileSync(
  partialVitestPath,
  JSON.stringify({
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numPassedTests: 1,
    testResults: [
      {
        name: join(REPO_ROOT, currentTestFiles[0]),
        assertionResults: [{ status: "passed" }],
      },
    ],
  })
);
assert.equal(
  isCompleteTestGateReport(
    {
      ...completeTestReport,
      gates: completeTestReport.gates.map((gate) =>
        gate.id === "vitest"
          ? {
              ...gate,
              testResults: { kind: "vitest", path: partialVitestPath },
            }
          : gate
      ),
    },
    REPO_ROOT
  ),
  false,
  "a successful partial Vitest result cannot claim full-suite coverage"
);
const skippedVitestPath = join(tempRoot, "skipped-vitest.json");
writeFileSync(
  skippedVitestPath,
  JSON.stringify({
    success: true,
    numFailedTests: 0,
    numPendingTests: 1,
    numTodoTests: 0,
    numPassedTests: currentTestFiles.length,
    testResults: currentTestFiles.map((file) => ({
      name: join(REPO_ROOT, file),
      assertionResults: [
        { status: "passed" },
        ...(file === currentTestFiles[0] ? [{ status: "pending" }] : []),
      ],
    })),
  })
);
assert.equal(
  isCompleteTestGateReport(
    {
      ...completeTestReport,
      gates: completeTestReport.gates.map((gate) =>
        gate.id === "vitest"
          ? {
              ...gate,
              testResults: { kind: "vitest", path: skippedVitestPath },
            }
          : gate
      ),
    },
    REPO_ROOT
  ),
  false,
  "a passing report with skipped tests cannot provide complete-profile evidence"
);
const cloneParent = mkdtempSync(join(tmpdir(), "orica-verifier-clone-"));
const cloneRoot = join(cloneParent, "clone");
const previousLock = process.env.ORICA_SUPERVISOR_LOCK;
process.env.ORICA_SUPERVISOR_LOCK = join(
  cloneParent,
  "fixture-merge.lock.json"
);

function coverageFor(tree) {
  return {
    files: changedFilesBetweenTrees(tempRoot, tree.baseTree, tree.headTree),
    fullDiffRead: true,
    lenses: ["1", "2", "3", "4", "5", "6"].map((lens) => ({
      lens,
      status: "checked",
      evidence: ["fixture.ts:1"],
    })),
    unverified: [],
  };
}

function git(args) {
  return execFileSync("git", args, {
    cwd: tempRoot,
    encoding: "utf8",
  }).trim();
}

function assertCompleteUnifiedHunks(patch) {
  let remainingOld = 0;
  let remainingNew = 0;
  const finishHunk = () => {
    assert.equal(remainingOld, 0, "unified hunk is missing old-side lines");
    assert.equal(remainingNew, 0, "unified hunk is missing new-side lines");
  };

  for (const line of patch.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      finishHunk();
      remainingOld = hunk[1] === undefined ? 1 : Number(hunk[1]);
      remainingNew = hunk[2] === undefined ? 1 : Number(hunk[2]);
      continue;
    }
    if (line.startsWith("diff --git ")) {
      finishHunk();
      continue;
    }
    if (remainingOld === 0 && remainingNew === 0) continue;
    if (line.startsWith("-")) remainingOld -= 1;
    else if (line.startsWith("+")) remainingNew -= 1;
    else if (line.startsWith(" ")) {
      remainingOld -= 1;
      remainingNew -= 1;
    }
  }
  finishHunk();
}

function runEvidence(args, expectSuccess = true, cwd = tempRoot) {
  const result = spawnSync("node", ["scripts/verifier-evidence.mjs", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (expectSuccess) {
    assert.equal(result.status, 0, result.stderr);
  } else {
    assert.notEqual(result.status, 0, "command unexpectedly succeeded");
  }
  return result;
}

try {
  mkdirSync(join(tempRoot, "scripts"));
  mkdirSync(join(tempRoot, "scripts", "harness"), { recursive: true });
  mkdirSync(join(tempRoot, "manual", "ai-reference", "30_plan"), {
    recursive: true,
  });
  mkdirSync(join(tempRoot, "packages", "card-data", "src", "cards"), {
    recursive: true,
  });
  mkdirSync(join(tempRoot, "packages", "rules-core", "src", "mechanics"), {
    recursive: true,
  });
  for (const file of [
    "verifier-write-lock.mjs",
    "supervisor-lock.mjs",
    "run-with-lock-heartbeat.mjs",
  ])
    copyFileSync(join(SCRIPT_DIR, file), join(tempRoot, "scripts", file));
  copyFileSync(
    join(SCRIPT_DIR, "verifier-tree.mjs"),
    join(tempRoot, "scripts", "verifier-tree.mjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "quantified-effect-repeat.mjs"),
    join(tempRoot, "scripts", "quantified-effect-repeat.mjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "verifier-card-context.mjs"),
    join(tempRoot, "scripts", "verifier-card-context.mjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "verifier-evidence.mjs"),
    join(tempRoot, "scripts", "verifier-evidence.mjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "harness", "fuzz-candidate-evidence.mjs"),
    join(tempRoot, "scripts", "harness", "fuzz-candidate-evidence.mjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "harness", "verification-state.cjs"),
    join(tempRoot, "scripts", "harness", "verification-state.cjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "spawn-verifier.mjs"),
    join(tempRoot, "scripts", "spawn-verifier.mjs")
  );
  copyFileSync(
    join(SCRIPT_DIR, "verified-commit.mjs"),
    join(tempRoot, "scripts", "verified-commit.mjs")
  );
  writeFileSync(
    join(tempRoot, ".gitignore"),
    ".verifier-context.json\n.verifier-prompt.txt\n.verifier-report.json\n.verifier-result.json\nlogs/\n"
  );
  writeFileSync(
    join(
      tempRoot,
      "manual",
      "ai-reference",
      "30_plan",
      "adversarial-verifier-prompt.md"
    ),
    [
      "# test prompt",
      "## 検証エージェント宛のプロンプト本体",
      "````text",
      "<DIFF_SUMMARY>",
      "<CHANGED_CARDS>",
      "<PRIMITIVES_TOUCHED>",
      "<RELATED_ISSUES>",
      "````",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(tempRoot, "packages", "card-data", "src", "cards", "BSAZ01.ts"),
    [
      "export const cards = [{",
      '  cardNo: "BSAZ01-C05",',
      '  name: "邂逅と決別",',
      '  textLines: ["バトルしている2体を破壊する。", "そうしたとき、双方の手札を破棄する。"],',
      "}, {",
      '  cardNo: "BSAZ01-C06",',
      '  name: "未変更の量化カード",',
      '  textLines: ["この効果を自分のカウント1につき1回発揮できる。"],',
      "}];",
      "",
    ].join("\n")
  );
  const engineFiller = Array.from(
    { length: 50 },
    (_, index) => `// engine filler ${index}`
  );
  writeFileSync(
    join(
      tempRoot,
      "packages",
      "rules-core",
      "src",
      "mechanics",
      "magic-system.ts"
    ),
    [
      'export const declarationMode = "before";',
      ...engineFiller,
      'export const affectMode = "before";',
      "",
    ].join("\n")
  );
  writeFileSync(join(tempRoot, "committed.txt"), "base\n");
  writeFileSync(join(tempRoot, "deleted.txt"), "review deletion\n");
  const registryPath = join(tempRoot, "zzzz-verifier-registry.json");
  const registryRows = Array.from(
    { length: 2000 },
    (_, index) => `row-${index}`
  );
  const registryText = () =>
    JSON.stringify({ rows: registryRows }, null, 2) + "\n\n";
  writeFileSync(registryPath, registryText());
  git(["init", "-b", "main"]);
  git(["config", "user.email", "verifier@example.invalid"]);
  git(["config", "user.name", "Verifier Test"]);
  git(["config", "core.safecrlf", "false"]);
  // A user's preferred diff context must not silently inflate verifier input.
  git(["config", "diff.context", "999999"]);
  git(["config", "diff.interHunkContext", "999999"]);
  git(["add", "."]);
  git(["commit", "-m", "base"]);

  git(["switch", "-c", "feat/test"]);
  rmSync(join(tempRoot, "deleted.txt"));
  writeFileSync(
    join(tempRoot, "packages", "card-data", "src", "cards", "BSAZ01.ts"),
    [
      "export const cards = [{",
      '  cardNo: "BSAZ01-C05",',
      '  name: "邂逅と決別",',
      '  textLines: ["バトルしている2体を破壊する。", "そうしたとき、双方の手札を破棄する。"],',
      "}, {",
      '  cardNo: "BSAZ01-C06A",',
      '  name: "未変更の量化カード",',
      '  textLines: ["この効果を自分のカウント1につき1回発揮できる。"],',
      "}];",
      "",
    ].join("\n")
  );
  const boundaryResult = spawnSync(
    "node",
    [
      "scripts/spawn-verifier.mjs",
      "--base",
      "main",
      "--json",
      "--out",
      ".verifier-prompt.txt",
    ],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.equal(boundaryResult.status, 0, boundaryResult.stderr);
  assert.deepEqual(JSON.parse(boundaryResult.stdout).changedCardNos, [
    "BSAZ01-C06A",
  ]);
  writeFileSync(
    join(tempRoot, "packages", "card-data", "src", "cards", "BSAZ01.ts"),
    [
      "export const cards = [{",
      '  cardNo: "BSAZ01-C05",',
      '  name: "邂逅と決別",',
      '  textLines: ["バトルしている2体を破壊する。", "この効果を自分の手札のカード１枚につき、追加で１回発揮する。", "この効果を自分のカウントの数まで追加で発揮できる。"],',
      "}, {",
      '  cardNo: "BSAZ01-C06",',
      '  name: "未変更の量化カード",',
      '  textLines: ["この効果を自分のカウント1につき1回発揮できる。"],',
      "}];",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(
      tempRoot,
      "packages",
      "rules-core",
      "src",
      "mechanics",
      "magic-system.ts"
    ),
    [
      "export const targetsValidatedAtDeclaration = true;",
      ...engineFiller,
      "export const targetIsStillAddressable = true;",
      "",
    ].join("\n")
  );
  writeFileSync(join(tempRoot, "committed.txt"), "feature\n");
  const trackedBinaryFixture = join(tempRoot, "tracked-binary-fixture.bin");
  writeFileSync(
    trackedBinaryFixture,
    Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff])
  );
  git(["add", "committed.txt", "tracked-binary-fixture.bin"]);
  git(["commit", "-m", "feature"]);
  writeFileSync(join(tempRoot, "staged.txt"), "staged\n");
  git(["add", "staged.txt"]);
  writeFileSync(join(tempRoot, "committed.txt"), "unstaged\n");
  writeFileSync(
    trackedBinaryFixture,
    Buffer.from([0x00, 0x01, 0x02, 0x04, 0xfe, 0xff])
  );
  writeFileSync(join(tempRoot, "untracked.txt"), "untracked\n");
  registryRows[1999] = "CHANGED_REGISTRY_VALUE";
  writeFileSync(registryPath, registryText());
  writeFileSync(
    join(tempRoot, "zz-verifier-regression.test.ts"),
    [
      "// BSAZ01-C05 regression",
      ...Array.from({ length: 80 }, (_, index) => `// filler ${index}`),
      "// literal replacement tokens: $' $& $` <CHANGED_CARDS> <DIFF_SUMMARY>",
      'expect(result).toBe("TAIL_EXPECTATION_SHOULD_BE_VISIBLE");',
      "",
    ].join("\n")
  );

  const tree = buildVerificationTree(tempRoot, "main");
  const changed = changedFilesBetweenTrees(
    tempRoot,
    tree.baseTree,
    tree.headTree
  );
  assert.deepEqual(changed.sort(), [
    "committed.txt",
    "deleted.txt",
    "packages/card-data/src/cards/BSAZ01.ts",
    "packages/rules-core/src/mechanics/magic-system.ts",
    "staged.txt",
    "tracked-binary-fixture.bin",
    "untracked.txt",
    "zz-verifier-regression.test.ts",
    "zzzz-verifier-registry.json",
  ]);
  assert.equal(git(["show", `${tree.headTree}:committed.txt`]), "unstaged");
  assert.equal(git(["show", `${tree.headTree}:staged.txt`]), "staged");
  assert.equal(git(["show", `${tree.headTree}:untracked.txt`]), "untracked");
  assert.equal(git(["diff", "--cached", "--name-only"]), "staged.txt");

  const spawnResult = spawnSync(
    "node",
    [
      "scripts/spawn-verifier.mjs",
      "--base",
      "main",
      "--json",
      "--max-diff-lines",
      "30",
    ],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.equal(spawnResult.status, 0, spawnResult.stderr);
  const spawnedContext = JSON.parse(spawnResult.stdout);
  const verifierPrompt = spawnedContext.prompt;
  const fullDiff = readFileSync(spawnedContext.fullDiffPath, "utf8");
  assert.deepEqual(spawnedContext.changedCardNos, ["BSAZ01-C05"]);
  assert.match(fullDiff, /TAIL_EXPECTATION_SHOULD_BE_VISIBLE/);
  assert.match(
    fullDiff,
    /diff --git a\/tracked-binary-fixture\.bin b\/tracked-binary-fixture\.bin/
  );
  assert.match(fullDiff, /GIT binary patch/);
  assert.match(fullDiff, /CHANGED_REGISTRY_VALUE/);
  assert.doesNotMatch(fullDiff, /row-1000|\/\/ engine filler 25/);
  assert.ok(
    Buffer.byteLength(fullDiff) < 12000,
    "unchanged rows must not swamp review input"
  );
  assertCompleteUnifiedHunks(fullDiff);
  assert.doesNotThrow(() =>
    execFileSync(
      "git",
      ["apply", "--check", "--reverse", spawnedContext.fullDiffPath],
      { cwd: tempRoot, encoding: "utf8" }
    )
  );
  const patchEnv = {
    ...process.env,
    GIT_INDEX_FILE: join(cloneParent, "patch-proof.index"),
  };
  const patchGit = (args) =>
    execFileSync("git", args, {
      cwd: tempRoot,
      env: patchEnv,
      encoding: "utf8",
    }).trim();
  patchGit(["read-tree", tree.baseTree]);
  patchGit(["apply", "--cached", spawnedContext.fullDiffPath]);
  assert.equal(
    patchGit(["write-tree"]),
    tree.headTree,
    "complete patch reconstructs every changed file and binary"
  );
  patchGit(["apply", "--cached", "--reverse", spawnedContext.fullDiffPath]);
  assert.equal(patchGit(["write-tree"]), tree.baseTree);
  const truncatedPatch = join(cloneParent, "truncated.patch");
  writeFileSync(truncatedPatch, fullDiff.trimEnd());
  assert.notEqual(
    spawnSync("git", ["apply", "--cached", "--check", truncatedPatch], {
      cwd: tempRoot,
      env: patchEnv,
      encoding: "utf8",
    }).status,
    0,
    "truncated trailing context must fail instead of becoming review evidence"
  );
  assert.match(verifierPrompt, /BSAZ01-C05 邂逅と決別/);
  assert.match(verifierPrompt, /card-data編集ファイル数: 1/);
  assert.match(verifierPrompt, /各file\/hunk先頭末尾/);
  assert.match(
    verifierPrompt,
    /diff --git a\/packages\/rules-core\/src\/mechanics\/magic-system\.ts/
  );
  assert.match(verifierPrompt, /targetsValidatedAtDeclaration/);
  assert.match(verifierPrompt, /targetIsStillAddressable/);
  assert.match(verifierPrompt, /TAIL_EXPECTATION_SHOULD_BE_VISIBLE/);
  const literalResult = spawnSync(
    "node",
    [
      "scripts/spawn-verifier.mjs",
      "--base",
      "main",
      "--json",
      "--max-diff-lines",
      "1000000",
    ],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.equal(literalResult.status, 0, literalResult.stderr);
  const literalPrompt = JSON.parse(literalResult.stdout).prompt;
  const literalSource =
    "// literal replacement tokens: $' $& $` <CHANGED_CARDS> <DIFF_SUMMARY>";
  assert.ok(
    literalPrompt.includes(literalSource),
    "diff source must be inserted literally"
  );
  assert.equal(
    literalPrompt.split(literalSource).length,
    2,
    "source must not duplicate prompt sections"
  );
  writeFileSync(join(tempRoot, ".verifier-result.json"), "{}");
  const failedSpawn = spawnSync(
    "node",
    ["scripts/spawn-verifier.mjs", "--max-diff-lines", "0"],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.notEqual(failedSpawn.status, 0);
  assert.equal(
    JSON.parse(readFileSync(join(tempRoot, ".verifier-context.json"))).pending,
    true
  );
  assert.equal(existsSync(join(tempRoot, ".verifier-result.json")), false);

  writeFileSync(
    join(tempRoot, ".verifier-context.json"),
    `${JSON.stringify({ schemaVersion: 1, base: "main", headTree: tree.headTree, changedCardNos: ["BSAZ01-C05"] })}\n`
  );
  const validReport = {
    summary: "全 vouch",
    items: [],
    coverage: coverageFor(tree),
    quantifiedEffectReview: {
      applicability: "applicable",
      mappings: [
        {
          cardNo: "BSAZ01-C05",
          clauses: [
            {
              text: "この効果を自分の手札のカード1枚につき、追加で1回発揮する",
              meaning: "count N を基本1回に追加して独立解決する",
              carrier: "EffectStep.repeat と pending continuation",
              mode: "additional",
              counterexamples: [
                {
                  n: 0,
                  scenario: "count 0",
                  expected: "基本1巡を完走",
                  evidence: "fixture.ts:1",
                  executions: 1,
                },
                {
                  n: 1,
                  scenario: "count 1",
                  expected: "基本1巡と追加1巡を完走",
                  evidence: "fixture.ts:1",
                  executions: 2,
                },
                {
                  n: 2,
                  scenario: "count 2",
                  expected: "基本1巡と追加2巡を完走",
                  evidence: "fixture.ts:1",
                  executions: 3,
                },
              ],
            },
          ],
        },
      ],
    },
  };
  validReport.quantifiedEffectReview.mappings[0].clauses.push({
    ...validReport.quantifiedEffectReview.mappings[0].clauses[0],
    text: "この効果を自分のカウントの数まで追加で発揮できる",
    meaning: "基本1回に最大count N回を任意で追加し、最大時は1/2/3巡を完走する",
  });
  for (const coverage of [
    undefined,
    { ...validReport.coverage, files: [] },
    {
      ...validReport.coverage,
      files: validReport.coverage.files.filter(
        (file) => file !== "deleted.txt"
      ),
    },
    { ...validReport.coverage, fullDiffRead: false },
    { ...validReport.coverage, lenses: [] },
    { ...validReport.coverage, unverified: ["fixture.ts"] },
  ]) {
    writeFileSync(
      join(tempRoot, ".verifier-report.json"),
      JSON.stringify({ ...validReport, coverage })
    );
    runEvidence(["record"], false);
  }
  for (const quantifiedEffectReview of [
    undefined,
    { applicability: "not_applicable", reason: "fixture", mappings: [] },
    {
      ...validReport.quantifiedEffectReview,
      mappings: [
        {
          ...validReport.quantifiedEffectReview.mappings[0],
          clauses: validReport.quantifiedEffectReview.mappings[0].clauses.slice(
            0,
            1
          ),
        },
      ],
    },
    {
      ...validReport.quantifiedEffectReview,
      mappings: [
        {
          ...validReport.quantifiedEffectReview.mappings[0],
          clauses: [
            {
              ...validReport.quantifiedEffectReview.mappings[0].clauses[0],
              counterexamples:
                validReport.quantifiedEffectReview.mappings[0].clauses[0].counterexamples.slice(
                  0,
                  2
                ),
            },
            ...validReport.quantifiedEffectReview.mappings[0].clauses.slice(1),
          ],
        },
      ],
    },
    {
      ...validReport.quantifiedEffectReview,
      mappings: [
        {
          ...validReport.quantifiedEffectReview.mappings[0],
          clauses: [
            {
              ...validReport.quantifiedEffectReview.mappings[0].clauses[0],
              counterexamples:
                validReport.quantifiedEffectReview.mappings[0].clauses[0].counterexamples.map(
                  (entry) =>
                    entry.n === 0 ? { ...entry, executions: 0 } : entry
                ),
            },
            ...validReport.quantifiedEffectReview.mappings[0].clauses.slice(1),
          ],
        },
      ],
    },
    {
      ...validReport.quantifiedEffectReview,
      mappings: [
        {
          ...validReport.quantifiedEffectReview.mappings[0],
          cardNo: "BSAZ01-C99",
        },
      ],
    },
    {
      ...validReport.quantifiedEffectReview,
      mappings: [
        {
          ...validReport.quantifiedEffectReview.mappings[0],
          clauses: [
            {
              ...validReport.quantifiedEffectReview.mappings[0].clauses[0],
              text: "この効果を自分のカウント1につき1回発揮できる",
            },
            ...validReport.quantifiedEffectReview.mappings[0].clauses.slice(1),
          ],
        },
      ],
    },
  ]) {
    writeFileSync(
      join(tempRoot, ".verifier-report.json"),
      JSON.stringify({ ...validReport, quantifiedEffectReview })
    );
    runEvidence(["record"], false);
  }
  for (const changedCardNos of [[], ["BSAZ01-C99"]]) {
    writeFileSync(
      join(tempRoot, ".verifier-context.json"),
      `${JSON.stringify({ schemaVersion: 1, base: "main", headTree: tree.headTree, changedCardNos })}\n`
    );
    writeFileSync(
      join(tempRoot, ".verifier-report.json"),
      `${JSON.stringify(validReport)}\n`
    );
    runEvidence(["record"], false);
  }
  writeFileSync(
    join(tempRoot, ".verifier-context.json"),
    `${JSON.stringify({ schemaVersion: 1, base: "main", headTree: tree.headTree, changedCardNos: ["BSAZ01-C05"] })}\n`
  );
  writeFileSync(
    join(tempRoot, ".verifier-report.json"),
    `${JSON.stringify(validReport)}\n`
  );
  runEvidence(["record"]);
  const evidence = JSON.parse(
    readFileSync(join(tempRoot, ".verifier-result.json"), "utf8")
  );
  assert.equal(evidence.schemaVersion, 3);
  assert.equal(evidence.headTree, tree.headTree);
  assert.equal(evidence.refuted, 0);
  assert.deepEqual(evidence.report, validReport);
  assert.equal(
    JSON.parse(Buffer.from(evidence.reportBase64, "base64").toString("utf8"))
      .summary,
    "全 vouch"
  );
  const archivedReportPath = join(
    tempRoot,
    evidence.archiveRelativePath,
    "report.json"
  );
  assert.deepEqual(
    JSON.parse(readFileSync(archivedReportPath, "utf8")),
    evidence.report
  );
  runEvidence(["check-worktree"]);
  writeFileSync(archivedReportPath, '{"summary":"tampered","items":[]}\n');
  runEvidence(["check-worktree"], false);
  writeFileSync(archivedReportPath, `${JSON.stringify(evidence.report)}\n`);
  runEvidence(["check-worktree"]);

  const verifiedCommit = spawnSync(
    "node",
    ["scripts/verified-commit.mjs", "-m", "verified tree"],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.equal(verifiedCommit.status, 0, verifiedCommit.stderr);
  runEvidence(["check"]);
  runEvidence(["check-commit"]);
  execFileSync("git", ["clone", "--quiet", tempRoot, cloneRoot]);
  runEvidence(["check-commit"], true, cloneRoot);
  const clonedMessage = execFileSync(
    "git",
    ["show", "-s", "--format=%B", "HEAD"],
    { cwd: cloneRoot, encoding: "utf8" }
  );
  assert.match(clonedMessage, /Verifier-Report-Base64:/);

  const emptyAuditTree = buildVerificationTree(tempRoot, "main");
  writeFileSync(
    join(tempRoot, ".verifier-context.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      base: "main",
      headTree: emptyAuditTree.headTree,
      changedCardNos: ["BSAZ01-C05"],
    })}\n`
  );
  writeFileSync(
    join(tempRoot, ".verifier-report.json"),
    `${JSON.stringify({ summary: "empty audit vouch", items: [], coverage: coverageFor(emptyAuditTree), quantifiedEffectReview: validReport.quantifiedEffectReview })}\n`
  );
  runEvidence(["record"]);
  assert.equal(git(["status", "--porcelain"]), "");
  const headBeforeMessageNamedLikeFlag = git(["rev-parse", "HEAD"]);
  const messageNamedLikeFlag = spawnSync(
    "node",
    ["scripts/verified-commit.mjs", "-m", "--allow-empty"],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.notEqual(messageNamedLikeFlag.status, 0);
  assert.equal(git(["rev-parse", "HEAD"]), headBeforeMessageNamedLikeFlag);
  const treeBeforeEmptyAudit = git(["rev-parse", "HEAD^{tree}"]);
  const emptyAuditCommit = spawnSync(
    "node",
    [
      "scripts/verified-commit.mjs",
      "--allow-empty",
      "-m",
      "empty verified audit",
    ],
    { cwd: tempRoot, encoding: "utf8" }
  );
  assert.equal(emptyAuditCommit.status, 0, emptyAuditCommit.stderr);
  assert.equal(git(["rev-parse", "HEAD^{tree}"]), treeBeforeEmptyAudit);
  runEvidence(["check"]);
  runEvidence(["check-commit"]);

  writeFileSync(join(tempRoot, "committed.txt"), "changed after verify\n");
  git(["add", "committed.txt"]);
  git(["commit", "-m", "post verification mutation"]);
  runEvidence(["check"], false);
  runEvidence(["check-worktree"], false);

  const changedTree = buildVerificationTree(tempRoot, "main");
  writeFileSync(
    join(tempRoot, ".verifier-context.json"),
    `${JSON.stringify({ schemaVersion: 1, base: "main", headTree: changedTree.headTree, changedCardNos: ["BSAZ01-C05"] })}\n`
  );
  writeFileSync(
    join(tempRoot, ".verifier-report.json"),
    `${JSON.stringify({
      summary: "1件 refuted",
      coverage: coverageFor(changedTree),
      quantifiedEffectReview: validReport.quantifiedEffectReview,
      items: [
        {
          cardNo: "TEST-001",
          lens: "1",
          refuted: true,
          claim: "claim",
          evidence: "committed.txt:1",
          expected: "fix it",
        },
      ],
    })}\n`
  );
  runEvidence(["record"], false);
  assert.throws(() => readFileSync(join(tempRoot, ".verifier-result.json")));

  writeFileSync(join(tempRoot, ".verifier-result.json"), "stale\n");
  writeFileSync(join(tempRoot, ".verifier-report.json"), "not json\n");
  runEvidence(["record"], false);
  assert.throws(() => readFileSync(join(tempRoot, ".verifier-result.json")));

  const sparseRoot = join(cloneParent, "sparse");
  mkdirSync(join(sparseRoot, "source"), { recursive: true });
  mkdirSync(join(sparseRoot, "assets"));
  writeFileSync(join(sparseRoot, "source", "fixture.ts"), "before\n");
  writeFileSync(join(sparseRoot, "assets", "retained.txt"), "retained\n");
  const sparseGit = (args) =>
    execFileSync("git", args, { cwd: sparseRoot, encoding: "utf8" }).trim();
  sparseGit(["init", "-b", "main"]);
  sparseGit(["config", "user.name", "Verifier test"]);
  sparseGit(["config", "user.email", "verifier@example.test"]);
  sparseGit(["add", "-A"]);
  sparseGit(["commit", "-m", "sparse fixture"]);
  sparseGit(["sparse-checkout", "set", "--cone", "--sparse-index", "source"]);
  assert.throws(() => readFileSync(join(sparseRoot, "assets", "retained.txt")));
  writeFileSync(join(sparseRoot, "source", "fixture.ts"), "after\n");
  const sparseIndexBefore = readFileSync(join(sparseRoot, ".git", "index"));
  const sparseTree = buildVerificationTree(sparseRoot, "main");
  assert.equal(
    sparseGit(["show", `${sparseTree.headTree}:assets/retained.txt`]),
    "retained"
  );
  assert.equal(
    sparseGit(["show", `${sparseTree.headTree}:source/fixture.ts`]),
    "after"
  );
  assert.deepEqual(
    readFileSync(join(sparseRoot, ".git", "index")),
    sparseIndexBefore
  );
  assert.throws(() => readFileSync(join(sparseRoot, "assets", "retained.txt")));

  console.log("[test-verifier-gate] all checks passed");
} finally {
  if (previousLock === undefined) delete process.env.ORICA_SUPERVISOR_LOCK;
  else process.env.ORICA_SUPERVISOR_LOCK = previousLock;
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(cloneParent, { recursive: true, force: true });
}
