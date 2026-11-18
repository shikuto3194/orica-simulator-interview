import {
  addedScenarios,
  scenarioModuleIsPure,
} from "./harness/scenario-registration-scope.mjs";
import { roomDeliveryOnlyChange } from "./harness/room-delivery-scope.mjs";
import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  staticReductionChange,
  changedCardRecords,
  typeOnlyChange,
  semanticScope,
  selectorManifestOnlyChange,
  revealedCardsUsageRemoval,
  preflightOnlyChange,
  assertCompleteFocusedResults,
  PLAYGROUND_SRC_GATES,
} from "./harness/semantic-scope.mjs";
import {
  selectGates,
  selectGatePlan,
  failedGateAliases,
} from "./harness/gate-manifest.mjs";
import { focusedInputs } from "./harness/focused-inputs.mjs";
import {
  reusableGates,
  gateInputFingerprints,
  runGates,
} from "./harness/run-gates.mjs";

const file = "packages/card-data/src/cards/BSDB01.ts";
const source =
  'export const cards = [{ cardNo: "BSDB01-C05", reductionSymbols: ["red"], cost: 4 }];';
const revised = source.replace('["red"]', '["red", "blue"]');
assert.deepEqual(staticReductionChange(file, source, revised), ["BSDB01-C05"]);
for (const invalid of [
  revised.replace("cost: 4", "cost: 5"),
  revised.replace("BSDB01-C05", "BSDB01-C06"),
  revised.replace('["red", "blue"]', "getReduction()"),
  revised + "\nimport './side-effect';",
])
  assert.equal(staticReductionChange(file, source, invalid), null);
assert.equal(
  typeOnlyChange(
    "packages/rules-core/src/model.ts",
    'export type T = import("./a").T; export const n = 1;',
    'export type T = import("./b").T; export const n = 1;'
  ),
  true
);
assert.equal(
  typeOnlyChange(
    "packages/rules-core/src/model.ts",
    'export const n = import("./a");',
    'export const n = import("./b");'
  ),
  false
);

const oldPreflight =
  '  $checkoutJson = & $node (Join-Path $Control "scripts/full-run-checkouts.mjs") --repo $Repo --full-run\n  if ($LASTEXITCODE -ne 0) { throw "Full-run checkout/ref binding failed; preserve existing work" }';
const newPreflight =
  '  . (Join-Path $Control "scripts\\lib\\full-run-checkout-preflight.ps1")\n  $checkoutJson = Invoke-FullRunCheckoutPreflight -Node $node -Script (Join-Path $Control "scripts/full-run-checkouts.mjs") -Repo $Repo';
assert.equal(preflightOnlyChange(oldPreflight, newPreflight), true);
assert.equal(
  preflightOnlyChange(oldPreflight, newPreflight + "\nWrite-Output changed"),
  false
);
assert.equal(
  preflightOnlyChange(
    oldPreflight,
    newPreflight.replace("-Repo $Repo", "-Repo $Control")
  ),
  false
);
const noticeTest = "apps/playground-web/test/operation-notice-digest.test.ts";
const noticeOverrides = { [noticeTest]: ["focused-vitest"] };
assert.deepEqual(
  selectGates(
    "finish",
    ["scripts/notices/codex-summary.mjs", noticeTest],
    undefined,
    undefined,
    [],
    noticeOverrides,
    [noticeTest]
  ),
  ["changed-style", "auxiliary-model-policy", "focused-vitest"]
);
assert.ok(
  selectGates(
    "finish",
    ["scripts/notices/codex-summary.mjs", noticeTest],
    undefined,
    undefined,
    [],
    noticeOverrides,
    []
  ).includes("notice-editor"),
  "unknown file coverage cannot remove a dedicated check"
);
const root = mkdtempSync(join(tmpdir(), "orica-semantic-"));
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const put = (file, text) => {
  mkdirSync(resolve(root, file, ".."), { recursive: true });
  writeFileSync(resolve(root, file), text);
};
try {
  git("init", "-b", "main");
  git("config", "user.name", "scope-test");
  git("config", "user.email", "scope@test.invalid");
  const test = "packages/rules-core/test/card.test.ts";
  put(file, source);
  put(test, '// BSDB01-C05\nit("reduction", () => {});');
  git("add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  put(file, revised);
  for (const config of [
    "vitest.config.ts",
    "scripts/harness/vitest-unit.config.mjs",
    "scripts/harness/vitest-pool.mjs",
    "scripts/harness/unit-test-input.mjs",
  ])
    put(config, readFileSync(new URL("../" + config, import.meta.url), "utf8"));
  put("packages/rules-core/test/helper.ts", "export const n = 1;");
  put(
    test,
    'import { n } from "./helper"; // BSDB01-C05\nit("reduction", () => n);'
  );
  assert.ok(
    focusedInputs(root, [test]).has("packages/rules-core/test/helper.ts")
  );
  put(
    "packages/rules-core/test/helper.ts",
    'import { readFileSync } from "node:fs"; export const n = readFileSync("arbitrary");'
  );
  assert.equal(
    focusedInputs(root, [test]),
    null,
    "opaque inputs retain whole-source matching"
  );
  put("packages/rules-core/test/helper.ts", "export const n = 1;");
  put(
    "packages/rules-core/test/helper.ts",
    'import { vi } from "vitest"; vi.importActual("../src/hidden");'
  );
  assert.equal(
    focusedInputs(root, [test]),
    null,
    "Vitest runtime module loaders are opaque"
  );
  put("packages/rules-core/test/helper.ts", "export const n = 1;");
  const configBefore = readFileSync(resolve(root, "vitest.config.ts"), "utf8");
  put(
    "vitest.config.ts",
    configBefore + "\n// changed config requires reviewed inputs\n"
  );
  assert.equal(
    focusedInputs(root, [test]),
    null,
    "unreviewed config cannot omit setup/plugin/alias inputs"
  );
  put("vitest.config.ts", configBefore);
  const scope = semanticScope(root, [file, test], [base]);
  const inputsBefore = gateInputFingerprints(root, { tests: [test] });
  put("packages/rules-core/src/unrelated.ts", "export const x = 1;");
  assert.equal(
    gateInputFingerprints(root, { tests: [test] })["focused-vitest"],
    inputsBefore["focused-vitest"],
    "unimported source does not invalidate a focused proof"
  );
  put("packages/rules-core/test/helper.ts", "export const n = 2;");
  assert.notEqual(
    gateInputFingerprints(root, { tests: [test] })["focused-vitest"],
    inputsBefore["focused-vitest"],
    "transitive helper edits invalidate proof"
  );
  const oldCi = process.env.CI;
  delete process.env.CI;
  try {
    const receipt = {
      schemaVersion: 2,
      profile: "finish",
      completionGate: true,
      status: "passed",
      startedAt: 1,
      finishedAt: 2,
      fingerprint: "old-tree",
      gateInputs: { "focused-vitest": "a".repeat(64) },
      gates: [{ id: "focused-vitest", status: "passed", reused: false }],
      vitestArgs: [],
      focusedTests: [test],
    };
    put("logs/harness/runs/1.json", JSON.stringify(receipt));
    const reuse = () =>
      reusableGates(
        root,
        "current-tree",
        { "focused-vitest": "a".repeat(64) },
        "finish",
        true,
        [],
        [],
        { tests: [test] }
      );
    assert.ok(reuse().has("focused-vitest"));
    put(
      "logs/harness/runs/2.json",
      JSON.stringify({
        ...receipt,
        startedAt: 3,
        finishedAt: 4,
        fingerprint: "different-tree",
        gateInputs: {},
        status: "failed",
        gates: [{ id: "vitest", status: "failed" }],
      })
    );
    assert.equal(
      reuse().has("focused-vitest"),
      false,
      "a later broad failure cannot be hidden by a dependency-matching old pass"
    );
  } finally {
    if (oldCi === undefined) delete process.env.CI;
    else process.env.CI = oldCi;
  }
  assert.deepEqual(scope.cards, ["BSDB01-C05"]);
  assert.deepEqual(scope.tests, [test]);
  for (const profile of ["finish", "push", "merge", "ci"])
    assert.deepEqual(
      selectGates(
        profile,
        [file, test],
        () => [],
        () => false,
        [],
        scope.overrides
      ),
      ["changed-style", "static-reduction", "focused-vitest"]
    );
  rmSync(resolve(root, test));
  assert.deepEqual(
    semanticScope(root, [test], [base]).overrides[test],
    [],
    "deleted tests cannot certify an empty focused run"
  );
  const result = {
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numPassedTests: 1,
    testResults: [
      {
        name: resolve(root, test),
        assertionResults: [
          {
            title: "case",
            ancestorTitles: [],
            status: "passed",
            retryCount: 0,
          },
        ],
      },
    ],
  };
  assertCompleteFocusedResults(root, [test], result);
  for (const field of ["numFailedTests", "numPendingTests", "numTodoTests"])
    assert.throws(() =>
      assertCompleteFocusedResults(root, [test], { ...result, [field]: 1 })
    );
  for (const patch of [
    { status: "pending" },
    { retryCount: 1 },
    { retryCount: null },
    { title: undefined },
  ])
    assert.throws(() =>
      assertCompleteFocusedResults(root, [test], {
        ...result,
        testResults: [
          {
            ...result.testResults[0],
            assertionResults: [
              { ...result.testResults[0].assertionResults[0], ...patch },
            ],
          },
        ],
      })
    );
  assert.throws(() =>
    assertCompleteFocusedResults(root, [test, "missing.test.ts"], result)
  );
  assert.ok(failedGateAliases("focused-vitest").includes("vitest"));
  assert.ok(failedGateAliases("vitest").includes("focused-vitest"));
  const scenarioA =
    "apps/playground-web/src/scenario-mirage-individual-swap.ts";
  const scenarioB = "apps/playground-web/src/scenario-four-of-a-kind.ts";
  put(
    "apps/playground-web/src/scenarios.ts",
    'import { version } from "@orica/rules-core"; import { buildA } from "./scenario-mirage-individual-swap"; import { buildB } from "./scenario-four-of-a-kind"; export const SCENARIOS = {};'
  );
  put(
    scenarioA,
    'import { version } from "@orica/rules-core"; export function buildA(){return 1;}'
  );
  put(
    scenarioB,
    'import { buildA } from "./scenario-mirage-individual-swap"; export function buildB(){return buildA();}'
  );
  git("add", ".");
  git(
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "scenario scope baseline"
  );
  const scenarioBase = git("rev-parse", "HEAD");
  put(
    scenarioA,
    'import { version } from "@orica/rules-core"; export function buildA(){return 2;}'
  );
  const related = semanticScope(root, [scenarioA], [scenarioBase]);
  assert.ok(
    related.overrides[scenarioA].includes(
      "scenario-file-scenario-mirage-individual-swap"
    )
  );
  assert.ok(
    related.overrides[scenarioA].includes(
      "scenario-file-scenario-four-of-a-kind"
    ),
    "shared consumer GUI is required"
  );
  put(
    "apps/playground-web/src/unknown-consumer.ts",
    'import { buildA } from "./scenario-mirage-individual-swap"; export const x=buildA();'
  );
  // The scenario module is in the exact-path src list (P2-16): a rejected
  // scenario narrowing leaves that measured override, not a scenario-file one.
  assert.deepEqual(
    semanticScope(root, [scenarioA], [scenarioBase]).overrides[scenarioA],
    PLAYGROUND_SRC_GATES.filter((gate) => gate !== "vitest"),
    "unregistered consumer rejects narrowing"
  );
  rmSync(resolve(root, "apps/playground-web/src/unknown-consumer.ts"));
  put(scenarioA, "globalThis.poison=true; export function buildA(){return 2;}");
  assert.deepEqual(
    semanticScope(root, [scenarioA], [scenarioBase]).overrides[scenarioA],
    PLAYGROUND_SRC_GATES.filter((gate) => gate !== "vitest"),
    "top-level side effect rejects narrowing"
  );
  rmSync(resolve(root, scenarioA));
  assert.deepEqual(
    semanticScope(root, [scenarioA], [scenarioBase]).overrides[scenarioA],
    PLAYGROUND_SRC_GATES.filter((gate) => gate !== "vitest"),
    "deleted module keeps the measured src scope"
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(
  "semantic scope, strict focused execution and failure overlap passed"
);

for (const profile of ["finish", "push", "merge", "ci"]) {
  const selected = selectGates(profile, [
    "scripts/fidelity-review-resolutions.json",
    "fidelity-baseline.json",
  ]);
  assert.ok(selected.includes("review-batch"));
  assert.ok(!selected.includes("fidelity"));
}

const screenFile = "apps/playground-web/src/components/BattleScreen.tsx";
const screenBefore =
  "function poll() { if (newState) applyRoomAuthoritativeState(newState); } function other() { return value; } const x = <p>a b</p>;";
const screenAfter = screenBefore.replace(
  "if (newState) applyRoomAuthoritativeState(newState);",
  "if (newState && newState !== lastRoomAuthoritativeStateRef.current) { applyRoomAuthoritativeState(newState); }"
);
assert.equal(
  roomDeliveryOnlyChange(screenFile, screenBefore, screenAfter),
  true
);
for (const bad of [
  screenAfter.replace("return value", "return\nvalue"),
  screenAfter.replace("a b</p>", "a  b</p>"),
  screenAfter.replace(
    "lastRoomAuthoritativeStateRef.current",
    "anotherRef.current"
  ),
])
  assert.equal(roomDeliveryOnlyChange(screenFile, screenBefore, bad), false);
const mixed = selectGates("finish", [
  "scripts/fidelity-review-resolutions.json",
  "packages/rules-core/src/effect/structured-core-move.ts",
]);
for (const id of ["review-batch", "types", "ismcts-catalog"])
  assert.ok(mixed.includes(id));
for (const id of ["telegram", "handoff", "storage"])
  assert.ok(!mixed.includes(id));
assert.ok(
  selectGatePlan("finish", [
    "scripts/fidelity-review-resolutions.json",
    "unknown-source.ts",
  ]).unresolved.some(({ file }) => file === "unknown-source.ts"),
  "unknown runtime input cannot be narrowed"
);

const registryBefore =
  'export const SCENARIOS = { old: {name:"old", build:oldBuilder} }; function other(){return 1;}';
const registryAfter =
  'import { buildNew } from "./scenario-new"; export const SCENARIOS = { old: {name:"old", build:oldBuilder}, "new": {name:"new", description:"fixture", build:buildNew} }; function other(){return 1;}';
assert.deepEqual(
  addedScenarios(
    registryBefore,
    registryAfter,
    new Set(["e2e/scenario-new.spec.ts"]),
    () => true
  ),
  ["new"]
);
for (const bad of [
  registryAfter.replace("return 1", "return 2"),
  registryAfter.replace("build:oldBuilder", "build:buildNew"),
  registryAfter.replace("./scenario-new", "./other-module"),
  registryAfter.replace('description:"fixture"', "description: sideEffect()"),
])
  assert.equal(
    addedScenarios(
      registryBefore,
      bad,
      new Set(["e2e/scenario-new.spec.ts"]),
      () => true
    ),
    null
  );
assert.equal(addedScenarios(registryBefore, registryAfter, new Set()), null);

assert.equal(
  scenarioModuleIsPure(
    'import { x } from "@orica/rules-core"; export function build(){ return x; }',
    new Set(["@orica/rules-core"])
  ),
  true
);
assert.equal(
  scenarioModuleIsPure(
    "globalThis.poison = true; export function build() {}",
    new Set()
  ),
  false
);
assert.equal(
  scenarioModuleIsPure(
    'import "./side-effect"; export function build() {}',
    new Set()
  ),
  false
);
assert.equal(
  scenarioModuleIsPure(
    "const x = run(); export function build() {}",
    new Set()
  ),
  false
);

assert.ok(failedGateAliases("ismcts-runtime").includes("ismcts-catalog"));
assert.ok(failedGateAliases("ismcts-catalog").includes("ismcts-runtime"));

const cloneManifest = (value) => JSON.parse(JSON.stringify(value));
const manifestBase = {
  sourceGates: [],
  testGates: [],
  requiredScopes: [],
  gates: {
    scenario: { bin: "playwright", args: ["test", "e2e/scenario-old.spec.ts"] },
    vitest: { node: "safe.mjs" },
  },
};
const manifestAdded = cloneManifest(manifestBase);
manifestAdded.gates.scenario.args.push("e2e/scenario-new.spec.ts");
manifestAdded.gates["scenario-file-scenario-new"] = {
  bin: "playwright",
  args: ["test", "e2e/scenario-new.spec.ts"],
};
assert.equal(selectorManifestOnlyChange(manifestBase, manifestAdded), true);
const changedCommand = cloneManifest(manifestAdded);
changedCommand.gates.vitest.node = "other.mjs";
assert.equal(selectorManifestOnlyChange(manifestBase, changedCommand), false);
const removedTest = cloneManifest(manifestAdded);
removedTest.gates.scenario.args.shift();
assert.equal(selectorManifestOnlyChange(manifestBase, removedTest), false);
// A registered spec need not be named scenario-*.spec.ts (ai-search-* and
// reveal-retrieval-audit are registered that way); the gate must still be the
// exact single-spec Playwright command.
const manifestOtherName = cloneManifest(manifestBase);
manifestOtherName.gates.scenario.args.push(
  "e2e/reveal-retrieval-audit.spec.ts"
);
manifestOtherName.gates["scenario-file-reveal-retrieval-audit"] = {
  bin: "playwright",
  args: ["test", "e2e/reveal-retrieval-audit.spec.ts"],
};
assert.equal(selectorManifestOnlyChange(manifestBase, manifestOtherName), true);
const manifestWrongCommand = cloneManifest(manifestOtherName);
manifestWrongCommand.gates["scenario-file-reveal-retrieval-audit"].args = [
  "test",
  "e2e/other.spec.ts",
];
assert.equal(
  selectorManifestOnlyChange(manifestBase, manifestWrongCommand),
  false
);

// Only the exact five-line StepChoiceRevealedCards element, removed once and
// with no other edit, narrows a BattleScreen change. Generic lines elsewhere in
// that 12k-line file (pending={pending}, '/>') must keep the full fallback.
{
  const screen = "apps/playground-web/src/components/BattleScreen.tsx";
  const lines = (...rows) => rows.join("\n");
  const usage =
    lines(
      "                <StepChoiceRevealedCards",
      "                  state={displayState}",
      "                  pending={pending}",
      "                  getDefinition={getDefinition}",
      "                />"
    ) + "\n";
  const before = lines("function a() {", usage + "  return 1;", "}", "");
  const after = lines("function a() {", "  return 1;", "}", "");
  assert.equal(revealedCardsUsageRemoval(screen, before, after), true);
  // Another file, or an extra edit in the same change, is not covered.
  assert.equal(revealedCardsUsageRemoval("other.tsx", before, after), false);
  assert.equal(
    revealedCardsUsageRemoval(screen, before, after + "const x = 1;\n"),
    false
  );
  // A single generic line removed from an unrelated element.
  const generic = lines("<Other", "  pending={pending}", "/>", "");
  assert.equal(
    revealedCardsUsageRemoval(
      screen,
      generic,
      generic.replace("  pending={pending}\n", "")
    ),
    false
  );
  // The element also stays in the placement HUD: removing one of two
  // occurrences is covered, removing both or editing besides is not.
  assert.equal(revealedCardsUsageRemoval(screen, usage + usage, usage), true);
  assert.equal(revealedCardsUsageRemoval(screen, usage + usage, ""), false);
  // Nothing removed.
  assert.equal(revealedCardsUsageRemoval(screen, before, before), false);
}

// A selector-only edit of the real manifest is overridden to the narrow
// selection gates; the selectGates() assertions in test-audit-operations must
// stay in that override or a stale expectation survives.
{
  const manifestPath = "scripts/harness/gate-manifest.json";
  const manifestRoot = mkdtempSync(join(tmpdir(), "orica-manifest-scope-"));
  const run = (...args) =>
    execFileSync("git", args, {
      cwd: manifestRoot,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  try {
    run("init", "-b", "main");
    run("config", "user.name", "scope-test");
    run("config", "user.email", "scope@test.invalid");
    const real = readFileSync(
      new URL("../" + manifestPath, import.meta.url),
      "utf8"
    );
    mkdirSync(resolve(manifestRoot, "scripts/harness"), { recursive: true });
    writeFileSync(resolve(manifestRoot, manifestPath), real);
    run("add", ".");
    run("-c", "core.hooksPath=/dev/null", "commit", "-m", "base");
    const manifestBaseCommit = run("rev-parse", "HEAD");
    const edited = JSON.parse(real);
    edited.scopes.push({ patterns: ["^never-matches$"], gates: ["docs"] });
    writeFileSync(
      resolve(manifestRoot, manifestPath),
      JSON.stringify(edited, null, 2) + "\n"
    );
    const manifestScope = semanticScope(
      manifestRoot,
      [manifestPath],
      [manifestBaseCommit]
    );
    assert.deepEqual(manifestScope.overrides[manifestPath], [
      "harness-selection",
      "verifier",
      "audit-operations",
    ]);
    // The fuzz test runs only under RUN_FUZZ=1: a focused Vitest run skips it
    // and can never satisfy "no skips", so it is typed and proven by the fuzz run.
    const fuzzTest = "apps/playground-web/test/selfplay-fuzz.test.ts";
    mkdirSync(resolve(manifestRoot, "apps/playground-web/test"), {
      recursive: true,
    });
    writeFileSync(resolve(manifestRoot, fuzzTest), "// base\n");
    run("add", ".");
    run("-c", "core.hooksPath=/dev/null", "commit", "-m", "fuzz test");
    const fuzzBase = run("rev-parse", "HEAD");
    writeFileSync(resolve(manifestRoot, fuzzTest), "// changed\n");
    const fuzzScope = semanticScope(manifestRoot, [fuzzTest], [fuzzBase]);
    assert.deepEqual(fuzzScope.overrides[fuzzTest], ["types"]);
    assert.deepEqual(fuzzScope.tests, []);
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
}

assert.deepEqual(
  addedScenarios(
    registryBefore.replace("build:oldBuilder} }", "build:oldBuilder}, }"),
    registryAfter.replace("build:buildNew} }", "build:buildNew}, }"),
    new Set(["e2e/scenario-new.spec.ts"]),
    () => true
  ),
  ["new"],
  "trailing comma must survive registry projection"
);

// Exercise the same frozen base resolution and selection as all four CLI
// entry points, against real Git diffs including an untracked source.
{
  const fixture = mkdtempSync(join(tmpdir(), "orica-publication-scope-"));
  const engine = "packages/rules-core/src/effect/effect-interpreter.ts";
  const card = "packages/card-data/src/cards/BSDB01.ts";
  const cardTest = "packages/rules-core/test/bsdb01-cards.test.ts";
  const fixturePath =
    "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json";
  const audit = "packages/rules-core/test/revealed-target-ui-audit.test.ts";
  const engineTests = [
    "choice-prepaid-cost",
    "choice-shared-usage-limit",
    "conditional-cost-continuation-choice",
    "continuation-choice-availability",
    "effect-usage-accounting",
    "per-choice-usage-limit",
    "post-draw-selection",
    "reveal-then-choose-retrieval",
    "step-execution-mode-optional",
  ]
    .map((name) => `packages/rules-core/test/${name}.test.ts`)
    .concat(
      ["effect-queue-action-routing", "field-effect-choice", "game-api"].map(
        (name) => `apps/playground-web/test/${name}.test.ts`
      )
    );
  const originalCard =
    'export const CARDS = [{ cardNo: "BSDB01-C06", effects: [] }, { cardNo: "BSDB01-C07", effects: [] }];';
  const newCard =
    'const present = { kind: "field_has" }; export const CARDS = [{ cardNo: "BSDB01-C06", effects: [{ condition: [present], steps: [{ action: { kind: "draw" }, choice: [] }] }] }, { cardNo: "BSDB01-C07", effects: [] }];';
  const originalEngine =
    "function handleStepChoiceSelection() { return 0; } export function executeEffects() { return handleStepChoiceSelection(); }";
  const newEngine = originalEngine.replace("return 0", "return 1");
  const put = (file, text) => {
    mkdirSync(resolve(fixture, file, ".."), { recursive: true });
    writeFileSync(resolve(fixture, file), text);
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: fixture,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  const registry = "packages/card-data/src/generated-index.ts";
  const baseRegistry =
    'import { BSDB01 } from "./cards/BSDB01.js"; export const ALL_CARDS = [...BSDB01];';
  const registered =
    'import { BSSG01 } from "./cards/BSSG01.js"; ' +
    baseRegistry.replace("...BSDB01", "...BSDB01, ...BSSG01");
  const otherPack = "packages/card-data/src/cards/BSSG01.ts";
  const otherTest = "packages/rules-core/test/bssg01-cards.test.ts";
  const otherDefinition =
    'export const BSSG01 = [{cardNo: "BSSG01-C01", effects: [{timing: "attack", steps: [{action: {kind: "draw", count: 1}}, {action: {kind: "destroy", count: 1}}]}]}];';
  const destroyTest =
    "packages/rules-core/test/cumulative-bp-budget-destroy.test.ts";
  const turnTest = "packages/rules-core/test/turn-system.test.ts";
  const lock = "pnpm-lock.yaml";
  const baseLock = 'lockfileVersion: "9.0"\nimporters: {}\n';
  const changedLock = baseLock.replace("9.0", "8.0");
  const priorCi = process.env.CI,
    priorBase = process.env.ORICA_VERIFY_BASE;
  try {
    git("init", "-b", "main");
    git("config", "user.name", "scope-test");
    git("config", "user.email", "scope@test.invalid");
    put(engine, originalEngine);
    put(card, originalCard);
    put(registry, baseRegistry);
    put(otherPack, otherDefinition);
    put(destroyTest, 'const example = {kind: "destroy"};');
    put("packages/rules-core/src/turn-system.ts", "export const step = 1;");
    put(turnTest, "const coversTurn = true;");
    put(otherTest, 'const id = "BSSG01-C01";');
    put(
      fixturePath,
      JSON.stringify({ sourceHashes: { [card]: "recorded source hash" } })
    );
    put(audit, "");
    put(cardTest, 'const id = "BSDB01-C06";');
    for (const test of engineTests) put(test, "");
    put(lock, baseLock);
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("switch", "-c", "candidate");
    git("branch", "--set-upstream-to=main");
    process.env.CI = "1";
    process.env.ORICA_VERIFY_BASE = base;
    const profiles = ["finish", "push", "merge", "ci"];
    const results = async (operation) => {
      const log = console.log;
      console.log = () => {};
      try {
        for (const profile of profiles) {
          const plan = await runGates({ root: fixture, profile, plan: true });
          operation(plan);
        }
      } finally {
        console.log = log;
      }
    };
    const bounded = (plan) => {
      assert.equal(plan.fullSelectionReason, null, plan.profile);
      assert.deepEqual(plan.unresolved, [], plan.profile);
      assert.ok(!plan.gates.includes("vitest"), plan.profile);
    };
    await results((plan) => {
      bounded(plan);
      assert.deepEqual(plan.gates, []);
      assert.deepEqual(plan.bases, [base]);
    });
    assert.deepEqual(changedCardRecords(card, originalCard, newCard).ids, [
      "BSDB01-C06",
    ]);
    assert.equal(
      changedCardRecords(card, originalCard, newCard).packWide,
      false
    );
    assert.deepEqual(
      changedCardRecords(
        card,
        newCard,
        newCard.replace("field_has", "cards_in_zone")
      ).ids,
      ["BSDB01-C06"]
    );
    assert.deepEqual(
      changedCardRecords(
        card,
        originalCard,
        originalCard.replace("BSDB01-C07", "BSDB01-C08")
      ).ids,
      ["BSDB01-C07", "BSDB01-C08"]
    );
    const rawFace = "packages/card-data/raw/by-pack/BSDB01.js";
    const rawCard =
      'const cards = [{front: {cardNumber: "BSDB01-TX01(A)"}, back: {cardNumber: "BSDB01-TX01(B)"}}];';
    assert.equal(
      changedCardRecords(rawFace, rawCard, rawCard + "// raw comment").packWide,
      false
    );
    put(registry, registered);
    await results((plan) => {
      bounded(plan);
      assert.deepEqual(plan.focusedTests, [otherTest]);
      assert.match(plan.decisions[0].reason, /BSSG01/);
    });
    put(registry, baseRegistry);
    put(
      otherPack,
      otherDefinition.replace(
        'kind: "destroy", count: 1',
        'kind: "destroy", count: 2'
      )
    );
    await results((plan) => {
      bounded(plan);
      assert.deepEqual(plan.focusedTests, [otherTest, destroyTest]);
      assert.ok(!plan.needsBrowser, plan.profile);
    });
    const draw = '{action: {kind: "draw", count: 1}}';
    const destroy = '{action: {kind: "destroy", count: 1}}';
    for (const changedSteps of [
      `${destroy}, ${draw}`,
      `${draw}, ${draw}, ${destroy}`,
    ]) {
      put(
        otherPack,
        otherDefinition.replace(`${draw}, ${destroy}`, changedSteps)
      );
      await results((plan) => {
        bounded(plan);
        assert.ok(plan.focusedTests.includes(destroyTest));
        assert.ok(
          plan.gates.includes("scenario-file-scenario-post-draw-selection")
        );
      });
    }
    put(otherPack, otherDefinition);
    put(card, newCard);
    await results((plan) => {
      bounded(plan);
      assert.deepEqual(plan.changed, [card]);
      assert.equal(plan.gates[0], "card-source-audit");
      assert.ok(plan.gates.includes("ledger"));
      assert.ok(plan.gates.includes("card-tests"));
      assert.ok(plan.focusedTests.includes(cardTest));
      assert.deepEqual(plan.decisions[0].cards, ["BSDB01-C06"]);
    });
    put(card, originalCard);
    put(engine, newEngine);
    await results((plan) => {
      bounded(plan);
      assert.deepEqual(plan.focusedTests, [...engineTests].sort());
      assert.ok(plan.gates.includes("local-game-ui"));
      if (plan.profile === "merge") assert.equal(plan.fuzzRequired, true);
    });
    put(card, newCard);
    await results((plan) => {
      bounded(plan);
      assert.deepEqual(plan.focusedTests, [...engineTests, cardTest].sort());
      assert.equal(plan.gates[0], "card-source-audit");
    });
    put(lock, baseLock + "# comments do not change dependency inputs\n");
    await results(bounded);
    put(lock, changedLock);
    await results((plan) => {
      assert.equal(plan.fullSelectionReason.kind, "crosscutting-change");
      assert.equal(plan.fullSelectionReason.file, "pnpm-lock.yaml");
      assert.ok(plan.gates.includes("vitest"));
      for (const gate of [
        "card-source-audit",
        "card-source",
        "card-tests",
        "local-game-ui",
        "scenario-file-scenario-post-stack-step-choice",
        "scenario-file-scenario-optional-choice-decline",
        "scenario-file-scenario-post-draw-selection",
      ])
        assert.ok(plan.gates.includes(gate), plan.profile + ": " + gate);
      assert.ok(!plan.gates.includes("focused-vitest"), plan.profile);
    });
    put(lock, baseLock);
    const log = console.log;
    console.log = () => {};
    try {
      for (const profile of profiles) {
        const plan = await runGates({
          root: fixture,
          profile,
          forceFull: true,
          plan: true,
        });
        assert.equal(plan.fullSelectionReason.kind, "explicit-full");
        assert.ok(plan.gates.includes("vitest"));
      }
    } finally {
      console.log = log;
    }
    const fullEntry = fileURLToPath(
      new URL("./harness/codex-finish-check.mjs", import.meta.url)
    );
    const fullEntryPlan = JSON.parse(
      execFileSync(process.execPath, [fullEntry, "--full", "--plan"], {
        cwd: fixture,
        encoding: "utf8",
      })
    );
    assert.equal(fullEntryPlan.fullSelectionReason.kind, "explicit-full");
    assert.equal(fullEntryPlan.gates[0], "card-source-audit");
    assert.ok(
      fullEntryPlan.gates.includes(
        "scenario-file-scenario-post-stack-step-choice"
      )
    );
    assert.ok(fullEntryPlan.gates.includes("vitest"));
    put(engine, originalEngine.replace("return 0", "return import(name)"));
    await results((plan) => {
      assert.equal(plan.fullSelectionReason, null);
      assert.ok(
        plan.unresolved.some(
          ({ file, reason }) => file === engine && reason.includes("loader")
        )
      );
      assert.ok(!plan.gates.includes("vitest"));
    });
    put(engine, originalEngine);
    put(
      engine,
      originalEngine.replace(
        "return 0",
        'void import("../turn-system"); return 1'
      )
    );
    await results((plan) => {
      bounded(plan);
      assert.ok(plan.focusedTests.includes(turnTest));
      assert.match(
        plan.decisions.find((decision) => decision.file === engine).reason,
        /turn-system/
      );
    });
    put(
      engine,
      originalEngine.replace("return 0", 'void import("../unknown"); return 1')
    );
    await results((plan) => {
      assert.equal(plan.fullSelectionReason, null);
      assert.ok(plan.unresolved.some(({ file }) => file === engine));
    });
    put(engine, originalEngine);
    const fresh = "packages/rules-core/src/effect/new-choice-helper.ts";
    put(fresh, "export const newChoiceHelper = 1;");
    await results((plan) => {
      assert.equal(plan.fullSelectionReason, null);
      assert.ok(plan.unresolved.some(({ file }) => file === fresh));
      assert.ok(!plan.gates.includes("vitest"));
    });
    put(
      engine,
      'import { newChoiceHelper } from "./new-choice-helper"; ' +
        originalEngine.replace("return 0", "return newChoiceHelper")
    );
    await results(bounded);
    put(lock, changedLock);
    git("add", lock);
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "changed dependency base"
    );
    const resolutionBase = git("rev-parse", "HEAD");
    put(lock, baseLock + "# comparison comment\n");
    for (const comparison of [
      [base, resolutionBase],
      [resolutionBase, base],
    ]) {
      const scope = semanticScope(fixture, [lock], comparison);
      const plan = selectGatePlan(
        "push",
        [lock],
        undefined,
        undefined,
        [],
        scope.overrides,
        scope.tests,
        scope.reasons
      );
      assert.equal(plan.fullSelectionReason.kind, "crosscutting-change");
      assert.ok(plan.ids.includes("vitest"));
    }
  } finally {
    if (priorCi === undefined) delete process.env.CI;
    else process.env.CI = priorCi;
    if (priorBase === undefined) delete process.env.ORICA_VERIFY_BASE;
    else process.env.ORICA_VERIFY_BASE = priorBase;
    rmSync(fixture, { recursive: true, force: true });
  }
}
