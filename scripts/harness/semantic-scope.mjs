import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, posix } from "node:path";
import state from "./verification-state.cjs";
import {
  CARD_IMAGE_PATTERN,
  SERVER_GAME_API,
  SERVER_STANDALONE_MODULES,
  SERVER_VITE_MODULES,
  STATIC_INPUT_PATTERNS,
  isE2eSpecFile,
  isPlaygroundSrcFile,
  isPlaygroundTestFile,
  isSqlInput,
  isStaticInput,
} from "./static-inputs.mjs";
import manifest from "./gate-manifest.json" with { type: "json" };
import { matchingScopes } from "./gate-manifest.mjs";
import { roomDeliveryOnlyChange } from "./room-delivery-scope.mjs";
import {
  addedScenarios,
  runtimeImports,
  scenarioModuleIsPure,
} from "./scenario-registration-scope.mjs";

const printer = ts.createPrinter({ removeComments: true });

// Compare the entire syntax tree, masking ONLY literal reduction arrays on
// identified card objects. Calls, spreads, other fields and added/deleted cards
// cannot disappear from this comparison.
export function reductionProjection(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) return null;
  const records = new Map();
  let invalid = false;
  const result = ts.transform(source, [
    (context) => {
      const visit = (node) => {
        if (ts.isObjectLiteralExpression(node)) {
          const props = node.properties;
          const id = props.find(
            (p) =>
              ts.isPropertyAssignment(p) &&
              ["cardNo", "cardNumber"].includes(
                p.name.getText(source).replaceAll('"', "")
              )
          );
          const reduction = props.find(
            (p) =>
              ts.isPropertyAssignment(p) &&
              ["reductionSymbols", "reduction"].includes(
                p.name.getText(source).replaceAll('"', "")
              )
          );
          if (id && reduction) {
            if (
              !ts.isStringLiteral(id.initializer) ||
              !ts.isArrayLiteralExpression(reduction.initializer) ||
              reduction.initializer.elements.some(
                (e) => !ts.isStringLiteral(e)
              ) ||
              records.has(id.initializer.text)
            ) {
              invalid = true;
              return node;
            }
            records.set(
              id.initializer.text,
              reduction.initializer.elements.map((e) => e.text)
            );
            return context.factory.updateObjectLiteralExpression(
              node,
              props.map((p) =>
                p === reduction
                  ? context.factory.updatePropertyAssignment(
                      p,
                      p.name,
                      context.factory.createStringLiteral("__reduction__")
                    )
                  : ts.visitNode(p, visit)
              )
            );
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  const skeleton = printer.printFile(result.transformed[0]);
  result.dispose();
  return invalid || records.size === 0 ? null : { skeleton, records };
}

export function staticReductionChange(file, before, after) {
  if (
    !/^packages\/card-data\/(?:src\/cards\/[^/]+\.ts|raw\/(?:by-pack\/[^/]+|cardData)\.js)$/.test(
      file
    )
  )
    return null;
  const old = reductionProjection(file, before),
    current = reductionProjection(file, after);
  if (!old || !current || old.skeleton !== current.skeleton) return null;
  const changed = [...current.records]
    .filter(
      ([id, value]) =>
        JSON.stringify(old.records.get(id)) !== JSON.stringify(value)
    )
    .map(([id]) => id);
  return changed.length ? changed : null;
}

export function typeOnlyChange(file, before, after) {
  if (
    !/^packages\/(?:rules-core|card-data)\/src\/.*\.ts$/.test(file) ||
    !before ||
    !after
  )
    return false;
  const emit = (text) =>
    ts.transpileModule(text, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        removeComments: true,
        verbatimModuleSyntax: true,
      },
    }).outputText;
  return before !== after && emit(before) === emit(after);
}

export function preflightOnlyChange(before, after) {
  const oldCall =
    '  $checkoutJson = & $node (Join-Path $Control "scripts/full-run-checkouts.mjs") --repo $Repo --full-run\n  if ($LASTEXITCODE -ne 0) { throw "Full-run checkout/ref binding failed; preserve existing work" }';
  const newCall =
    '  . (Join-Path $Control "scripts\\lib\\full-run-checkout-preflight.ps1")\n  $checkoutJson = Invoke-FullRunCheckoutPreflight -Node $node -Script (Join-Path $Control "scripts/full-run-checkouts.mjs") -Repo $Repo';
  before = before.replaceAll("\r\n", "\n");
  after = after.replaceAll("\r\n", "\n");
  return (
    before.includes(oldCall) &&
    after.includes(newCall) &&
    before.replace(oldCall, "__PREFLIGHT__") ===
      after.replace(newCall, "__PREFLIGHT__")
  );
}

// Runs only under RUN_FUZZ=1; see the override in semanticScope().
const FUZZ_ONLY_TEST = "apps/playground-web/test/selfplay-fuzz.test.ts";
// These suites explicitly skip cases unless an opt-in diagnostic is enabled.
const optInTest =
  /^apps\/playground-web\/test\/(?:mcts|position-bias(?:-diagnose)?|selfplay-(?:bench|fuzz|stuck-diag))\.test\.ts$/;

// The one test that reads the real cluster registry (it pins the canonical
// formatting). Every other script test builds its own registry fixture.
export const CLUSTER_REGISTRY_TEST =
  "packages/rules-core/test/cluster-registry-format.test.ts";
// Focused tests for the exact-path overrides that name "focused-vitest" (the SQL
// group has its own list, SQL_INPUT_TESTS, resolved by pathOverrideTests()).
// Without an entry the gate would run no file, so semanticScope throws instead.
export const PATH_OVERRIDE_TESTS = {
  "autorun-queue/cluster-registry.json": [CLUSTER_REGISTRY_TEST],
};

// Static inputs that no script gate reads (P2-16; patterns in static-inputs.mjs).
// Measured 2026-11-02 (確度B): breaking (content) and deleting the files of each
// group, then running the whole vitest suite (22436 tests) against an unmutated
// baseline. Images, deploy/oracle and the manual assets (665 files): both
// mutations left every test result identical to the baseline. The 19 SQL files:
// only the eight PGlite suites below changed result (a break failed 3 test
// cases and skipped 60 more behind a failed beforeAll; a delete skipped 57 and
// failed two files at load, so 11 cases never ran; cases counted per file). Earlier, across the other 28 gates,
// only format/lint and docs moved. Card images are the exception:
// assertPublicCardImages (public-build.ts) fails the build when a card.image file
// is missing, and deleting the 650 images/*.webp made both build and public-build
// fail (baseline passed), so they also run those two. secrets stays as the cheap
// content scan. types did not move: manual/_legacy and qa/ are outside every
// tsconfig. The merge fuzz is not expected to read them either (static reading plus one
// coarse direct run, 確度B; see requiresMergeFuzz).
export const STATIC_INPUT_GATES = ["format", "lint", "docs", "secrets"];
export const CARD_IMAGE_GATES = [
  ...STATIC_INPUT_GATES,
  "build",
  "public-build",
];
export const SQL_INPUT_GATES = [...STATIC_INPUT_GATES, "focused-vitest"];
export { CARD_IMAGE_PATTERN, STATIC_INPUT_PATTERNS };
// The suites that executed the SQL under the break and delete experiments.
export const SQL_INPUT_TESTS = [
  "apps/playground-web/test/account-link-postgres.test.ts",
  "apps/playground-web/test/input-validation-postgres.test.ts",
  "apps/playground-web/test/operation-notices-postgres.test.ts",
  "apps/playground-web/test/room-invitations-postgres.test.ts",
  "apps/playground-web/test/room-network-postgres.test.ts",
  "apps/playground-web/test/room-network-strict-postgres.test.ts",
  "apps/playground-web/test/room-replay-restore-contract.test.ts",
  "apps/playground-web/test/room-replay-restore-postgres.test.ts",
];

// Server modules (P2-16; exact paths in static-inputs.mjs). Measured 2026-11-02
// (確度B): corrupting all 15 files at once, then deleting them, then running 23
// gates against an unmutated baseline: the 28 full gates minus format, lint,
// types, docs, vitest and secrets (which stay anyway), plus card-tests. 22 of
// them kept their result, including handoff, ismcts-program, ismcts-runtime,
// harness and fidelity; only `ssot` failed, through game-api.ts
// (check-ssot.mjs gameApiRel). `docs` was measured separately: it passes a
// corruption but fails a deletion (links to game-api.ts and api-limits.ts), so
// it stays. The merge fuzz summary was identical as well. What does observe the
// files: the type check, the whole vitest suite (importers of every file), and
// for the twelve modules vite.config.ts loads the GUI gates that CI runs on a
// full fallback, so those four stay. The scenario registration gates and the
// saved-deck/title/home specs are not in the CI full set, so they are not
// added here either.
export const SERVER_STANDALONE_GATES = ["types", "vitest", "secrets", "docs"];
export const SERVER_VITE_GATES = [
  ...SERVER_STANDALONE_GATES,
  "scenario",
  "local-game-ui",
  "build",
  "public-build",
];
export function pathOverrideTests(file) {
  return isSqlInput(file) ? SQL_INPUT_TESTS : PATH_OVERRIDE_TESTS[file];
}

// Dropping the revealed-card strip from the effect-choice modal touches nothing
// but that JSX element. Only this exact removal (one occurrence of the
// five-line element, with no other edit) is covered by the reveal scenarios and the type check;
// every other BattleScreen edit keeps the full verification fallback.
const REVEALED_CARDS_USAGE = [
  "                <StepChoiceRevealedCards",
  "                  state={displayState}",
  "                  pending={pending}",
  "                  getDefinition={getDefinition}",
  "                />",
  "",
].join("\n");

export function revealedCardsUsageRemoval(file, before, after) {
  if (
    file !== "apps/playground-web/src/components/BattleScreen.tsx" ||
    !before ||
    !after
  )
    return false;
  // The element also remains in the placement HUD, so it can occur more than
  // once; the change is covered when removing one occurrence reproduces `after`.
  for (
    let index = before.indexOf(REVEALED_CARDS_USAGE);
    index >= 0;
    index = before.indexOf(REVEALED_CARDS_USAGE, index + 1)
  )
    if (
      before.slice(0, index) +
        before.slice(index + REVEALED_CARDS_USAGE.length) ===
      after
    )
      return true;
  return false;
}

export function selectorManifestOnlyChange(old, current) {
  if (
    !["sourceGates", "testGates", "requiredScopes"].every(
      (key) => JSON.stringify(old[key]) === JSON.stringify(current[key])
    )
  )
    return false;
  return Object.entries(old.gates).every(([id, gate]) => {
    const next = current.gates[id];
    if (JSON.stringify(gate) === JSON.stringify(next)) return true;
    if (
      id !== "scenario" ||
      !next ||
      JSON.stringify({ ...gate, args: [] }) !==
        JSON.stringify({ ...next, args: [] }) ||
      !Array.isArray(next.args) ||
      !gate.args.every((value, i) => next.args[i] === value)
    )
      return false;
    return next.args
      .slice(gate.args.length)
      .every(
        (file) =>
          /^e2e\/[a-z0-9-]+\.spec\.ts$/.test(file) &&
          JSON.stringify(
            current.gates[`scenario-file-${file.slice(4, -8)}`]
          ) === JSON.stringify({ bin: "playwright", args: ["test", file] })
      );
  });
}

// apps/playground-web/src and test (P2-16; exact paths in static-inputs.mjs).
// Measured 2026-11-03 (確度B): corrupting, then deleting, all 414 files (the 261
// reviewed-full src files, the 145 reviewed-full *.test.ts files and the 8 SQL
// suites) against an unmutated baseline. The heavy script gates kept their
// result in those two runs (handoff, ismcts-program, ismcts-runtime, fidelity,
// auto-merge-integration, effect-debug and 15 more), and the merge fuzz summary
// was identical for src and tests alike (the fuzz entry points import neither).
// What moved: ssot (it scans src), docs (a deletion breaks doc links), harness
// (deleting all the src files at once trips the GUI entry-file guard of the
// server rule; the SQL suites, now excluded, trip the SQL-naming guard). harness also stays for src
// because that rule's importer guard (a new import of a standalone server
// module) reads the src tree: static reading, not measured. It stays for the
// tests because a test that newly names the SQL is judged by the SQL-naming
// guard, which breaking or deleting an existing test cannot show; it runs only
// when this path rule applies (a leaf test edit is narrowed to focused-vitest). The src files are the
// GUI, so they also run the four GUI gates CI adds on a full fallback (chosen
// by reading, not mutated). card-tests is kept for the tests only: that run
// had no changed card against main, so it proves nothing, and
// check-card-test-coverage.mjs reads the card numbers of every apps/ test (49
// of the 145 listed tests contain some, and two of them are the only references
// to six card numbers). It costs about a second; the src files are not read
// by it (it lists *.test / *.spec files only, static reading, 確度B).
export const PLAYGROUND_SRC_GATES = [
  "types",
  "vitest",
  "secrets",
  "docs",
  "ssot",
  "harness",
  "scenario",
  "local-game-ui",
  "build",
  "public-build",
];
export const PLAYGROUND_TEST_GATES = [
  "types",
  "vitest",
  "secrets",
  "docs",
  "harness",
  "card-tests",
];
// e2e specs (P2-16; exact paths in static-inputs.mjs). Measured 2026-11-03
// (確度B): corrupting, then deleting, all 221 listed specs left 27 gates
// unchanged against an unmutated baseline: the 24 script gates, types, vitest
// (22449 tests in all three runs) and secrets. The four GUI gates (build,
// scenario, local-game-ui, public-build) were measured corrupted and unmutated
// only; the scenario baseline had one click timeout in reveal-retrieval-audit,
// a flake the corrupted run did not show. auto-merge-integration differs only
// by a random id. The merge fuzz summary was identical to an unmutated run on the
// same tree. The reason is structural: no gate executes these specs (each
// playwright gate names its own files or config), no file imports them, and no
// tsconfig or vitest include reaches them. What stays: secrets (the gate runs
// the scanner's own self-test; the real scan is pre-push and secrets.yml, which
// do not depend on this selection, so it is kept only as the cheap default the
// sibling groups use), docs (a doc link to a spec), and harness, which holds
// the list's own integrity (a deleted listed spec fails there); the experiment
// moved none of the three. A listed spec is executed by no gate by name, so the
// edited spec used to run nowhere; e2e-changed (P2-17) now runs exactly the
// specs a change touched, and only those, so an edited spec cannot stay red.
// Specs a change did not touch are covered by the periodic full run
// (scripts/e2e-run.mjs --full), not by a gate.
export const E2E_SPEC_GATES = ["secrets", "docs", "harness", "e2e-changed"];
// Path-only semantic scopes: no content or repository state is consulted, so
// the unclassified-path audit (list-unclassified.mjs) applies the same rule.
export function pathOverride(file) {
  let gates;
  if (
    [
      "scripts/harness/gate-manifest.mjs",
      "scripts/harness/semantic-scope.mjs",
      "scripts/harness/scenario-registration-scope.mjs",
      "scripts/harness/room-delivery-scope.mjs",
      "scripts/harness/static-inputs.mjs",
      "scripts/test-semantic-scope.mjs",
    ].includes(file)
  )
    gates = ["harness-selection", "verifier"];
  // test-audit-operations.mjs asserts selectGates() results, so a manifest
  // logic change must run it too; without it a stale expectation survives
  // until an unrelated change selects that gate.
  if (file === "scripts/harness/gate-manifest.mjs")
    gates = ["harness-selection", "verifier", "audit-operations"];
  // The fuzz test only runs under RUN_FUZZ=1, so a focused Vitest run always
  // skips it and can never complete. Its executable proof is the merge fuzz
  // run (requiresMergeFuzz); here it needs the type check.
  if (file === FUZZ_ONLY_TEST) gates = ["types"];
  // Lane ledgers (P2-16). Measured 2026-11-02 by corrupting the file and running
  // the gates: only effect-debug read the real cluster registry among the script
  // gates; handoff/harness/fidelity/ismcts-* build their own fixtures. docs checks
  // issue `cluster:` declarations against registry status, and the format test
  // pins the canonical form (semanticScope adds it as the focused test).
  if (file === "autorun-queue/cluster-registry.json")
    gates = ["docs", "effect-debug", "focused-vitest"];
  // No gate reads these queues; their readers are lane scripts run outside the
  // gates (needs-dsl-rank, stub-readiness, update-snapshot, cluster-claim).
  if (/^autorun-queue\/needs-(?:dsl|ruling)\.[^/]+\.jsonl$/.test(file))
    gates = ["docs"];
  if (isStaticInput(file))
    gates = CARD_IMAGE_PATTERN.test(file)
      ? [...CARD_IMAGE_GATES]
      : [...(isSqlInput(file) ? SQL_INPUT_GATES : STATIC_INPUT_GATES)];
  if (SERVER_STANDALONE_MODULES.includes(file))
    gates = [...SERVER_STANDALONE_GATES];
  if (SERVER_VITE_MODULES.includes(file))
    gates =
      file === SERVER_GAME_API
        ? [...SERVER_VITE_GATES, "ssot"]
        : [...SERVER_VITE_GATES];
  if (isPlaygroundSrcFile(file)) gates = [...PLAYGROUND_SRC_GATES];
  if (isPlaygroundTestFile(file)) gates = [...PLAYGROUND_TEST_GATES];
  if (isE2eSpecFile(file)) gates = [...E2E_SPEC_GATES];
  // Records and rule prose are inputs to audits/review, not changes to the
  // implementation of the audit detectors. Keep real-data audits, without
  // rerunning the detectors' own fixture regression for these inputs.
  if (
    [
      "fidelity-baseline.json",
      "scripts/fidelity-review-resolutions.json",
    ].includes(file)
  )
    gates = ["review-batch"];
  if (/^manual\/ai-reference\/10_rules\/.*\.md$/.test(file))
    gates = file.endsWith("04_state-based-rules.md")
      ? ["docs", "ssot"]
      : ["docs"];
  return gates;
}

const cardPack =
  /^packages\/card-data\/(?:src\/cards|raw\/by-pack)\/([^/]+)\.[jt]s$/;
const cardInputs = /^packages\/card-data\/(?:src|raw|scripts)\//;
const engineInputs = /^packages\/rules-core\/src\//;
const auditFixture =
  "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json";
const auditTest = "packages/rules-core/test/revealed-target-ui-audit.test.ts";
const auditInputs = [
  auditFixture,
  auditTest,
  "packages/rules-core/test/fixtures/revealed-target-ui-audit.json",
  "scripts/audit-revealed-target-ui.cjs",
];

const choiceTests = [
  "packages/rules-core/test/choice-prepaid-cost.test.ts",
  "packages/rules-core/test/choice-shared-usage-limit.test.ts",
  "packages/rules-core/test/conditional-cost-continuation-choice.test.ts",
  "packages/rules-core/test/continuation-choice-availability.test.ts",
  "packages/rules-core/test/effect-usage-accounting.test.ts",
  "packages/rules-core/test/per-choice-usage-limit.test.ts",
  "packages/rules-core/test/post-draw-selection.test.ts",
  "packages/rules-core/test/reveal-then-choose-retrieval.test.ts",
  "packages/rules-core/test/step-execution-mode-optional.test.ts",
  "apps/playground-web/test/effect-queue-action-routing.test.ts",
  "apps/playground-web/test/field-effect-choice.test.ts",
  "apps/playground-web/test/game-api.test.ts",
];
const choiceGui = [
  "scenario-file-scenario-post-stack-step-choice",
  "scenario-file-scenario-optional-choice-decline",
  "scenario-file-scenario-post-draw-selection",
  "local-game-ui",
];
const stepChoiceSource = "packages/rules-core/src/effect/effect-interpreter.ts";

function parse(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return source.parseDiagnostics.length ? null : source;
}

function astProjection(source, replace) {
  const result = ts.transform(source, [
    (context) => {
      const visit = (node) =>
        replace(node) ?? ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  const projection = printer.printFile(result.transformed[0]);
  result.dispose();
  return projection;
}

function cardProperty(node, name) {
  return node.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name
  );
}

function literalCard(node) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const number =
    cardProperty(node, "cardNo") ?? cardProperty(node, "cardNumber");
  if (number && ts.isStringLiteral(number.initializer))
    return number.initializer.text;
  const front = cardProperty(node, "front");
  return front ? literalCard(front.initializer) : null;
}

function identifiers(node) {
  const names = new Set();
  function visit(child) {
    if (ts.isIdentifier(child)) names.add(child.text);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return names;
}

function literalHelper(node) {
  if (
    !ts.isVariableStatement(node) ||
    node.modifiers?.length ||
    !(node.declarationList.flags & ts.NodeFlags.Const) ||
    node.declarationList.declarations.length !== 1
  )
    return null;
  const [decl] = node.declarationList.declarations;
  return ts.isIdentifier(decl.name) &&
    decl.initializer &&
    pureCardValue(decl.initializer)
    ? decl
    : null;
}

function pureCardValue(node) {
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every(
      (element) => !literalCard(element) && pureCardValue(element)
    );
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        pureCardValue(property.initializer)
    );
  return (
    ts.isLiteralExpression(node) ||
    ts.isIdentifier(node) ||
    [
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.NullKeyword,
    ].includes(node.kind)
  );
}

function projectCards(file, text) {
  const source = parse(file, text);
  if (!source) return null;
  let count = 0,
    duplicate = false;
  const records = new Map(),
    helpers = new Map();
  const skeleton = astProjection(source, (node) => {
    if (node.parent === source) {
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
        return ts.factory.createNotEmittedStatement(node);
      const helper = literalHelper(node);
      if (helper) {
        helpers.set(helper.name.text, {
          text: printer.printNode(
            ts.EmitHint.Expression,
            helper.initializer,
            source
          ),
          references: identifiers(helper.initializer),
        });
        return ts.factory.createNotEmittedStatement(node);
      }
    }
    if (
      !ts.isArrayLiteralExpression(node) ||
      !node.elements.length ||
      !node.elements.every(literalCard)
    )
      return undefined;
    for (const card of node.elements) {
      const back = cardProperty(card, "backFace") ?? cardProperty(card, "back");
      for (const face of [card, back?.initializer]) {
        if (!face) continue;
        const id = literalCard(face);
        if (!id) continue;
        if (records.has(id)) duplicate = true;
        records.set(id, {
          text: printer.printNode(ts.EmitHint.Expression, face, source),
          references: identifiers(face),
        });
      }
    }
    return ts.factory.createIdentifier(`__card_array_${count++}`);
  });
  return count && !duplicate ? { skeleton, records, helpers } : null;
}

function reachesHelper(record, helpers, changedHelpers) {
  const visited = new Set(),
    pending = [...(record?.references ?? [])];
  while (pending.length) {
    const name = pending.pop();
    if (changedHelpers.has(name)) return true;
    if (visited.has(name)) continue;
    visited.add(name);
    const helper = helpers?.get(name);
    if (helper) pending.push(...helper.references);
  }
  return false;
}

export function changedCardRecords(file, before, after) {
  const old = before === null ? null : projectCards(file, before);
  const current = after === null ? null : projectCards(file, after);
  const ids = [
    ...new Set([
      ...(old?.records.keys() ?? []),
      ...(current?.records.keys() ?? []),
    ]),
  ];
  const changedHelpers = new Set(
    [...(old?.helpers.keys() ?? []), ...(current?.helpers.keys() ?? [])].filter(
      (name) =>
        old?.helpers.get(name)?.text !== current?.helpers.get(name)?.text
    )
  );
  const changed = ids.filter((id) => {
    const beforeRecord = old?.records.get(id),
      afterRecord = current?.records.get(id);
    return (
      beforeRecord?.text !== afterRecord?.text ||
      reachesHelper(beforeRecord, old?.helpers, changedHelpers) ||
      reachesHelper(afterRecord, current?.helpers, changedHelpers)
    );
  });
  const oldOrder = [...(old?.records.keys() ?? [])].filter((id) =>
    current?.records.has(id)
  );
  const newOrder = [...(current?.records.keys() ?? [])].filter((id) =>
    old?.records.has(id)
  );
  const packWide =
    !old ||
    !current ||
    old.skeleton !== current.skeleton ||
    oldOrder.some((id, index) => id !== newOrder[index]) ||
    [old, current].some(({ skeleton, helpers }) =>
      reachesHelper(
        {
          references: identifiers(
            ts.createSourceFile(file, skeleton, ts.ScriptTarget.Latest)
          ),
        },
        helpers,
        changedHelpers
      )
    );
  return {
    ids: changed,
    impact: packWide ? ids : changed,
    packWide,
    definitions: ids.map((id) => [
      id,
      old?.records.get(id)?.text,
      current?.records.get(id)?.text,
    ]),
  };
}

// The registered continuation tests exercise the only caller in executeEffects,
// then the legal-action and API/GUI consumers of the resulting pending choice.
function onlyStepChoiceBody(file, before, after) {
  if (file !== stepChoiceSource || before === null || after === null)
    return false;
  const skeleton = (text) => {
    const source = parse(file, text);
    if (!source) return null;
    let matched = false;
    const value = astProjection(source, (node) => {
      if (
        !ts.isFunctionDeclaration(node) ||
        node.name?.text !== "handleStepChoiceSelection" ||
        !node.body
      )
        return undefined;
      matched = true;
      return ts.factory.updateFunctionDeclaration(
        node,
        node.modifiers,
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        ts.factory.createBlock([])
      );
    });
    return matched ? value : null;
  };
  const old = skeleton(before);
  return old !== null && old === skeleton(after);
}

function runtimeLoaders(file, text) {
  const source = parse(file, text ?? "");
  if (!source) return null;
  const opaque = [],
    literal = [];
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(source);
      const load = /(?:^|\.)(?:import|require)$/.test(callee);
      const specifier = node.arguments?.[0];
      if (
        load &&
        node.arguments?.length === 1 &&
        ts.isStringLiteralLike(specifier)
      )
        literal.push(specifier.text);
      else if (
        load ||
        /(?:^|\.)(?:eval|Function|createRequire|glob|globEager)$/.test(callee)
      )
        opaque.push(printer.printNode(ts.EmitHint.Expression, node, source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { opaque: JSON.stringify(opaque), literal };
}

// Read the dispatcher keys from the existing registration, rather than
// maintaining another list of action names.
function nativeHandlers(text) {
  const source = parse("native-action-registry.ts", text ?? "");
  const declaration = source?.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => entry.name.getText(source) === "NATIVE_ACTION_HANDLERS");
  if (
    !declaration?.initializer ||
    !ts.isObjectLiteralExpression(declaration.initializer)
  )
    return null;
  const handlers = new Map();
  const skeleton = astProjection(source, (node) => {
    if (node !== declaration.initializer) return undefined;
    for (const entry of node.properties) {
      if (!ts.isPropertyAssignment(entry) || !ts.isIdentifier(entry.name))
        return undefined;
      handlers.set(
        entry.name.text,
        printer.printNode(ts.EmitHint.Expression, entry.initializer, source)
      );
    }
    return ts.factory.createObjectLiteralExpression();
  });
  return handlers.size ? { skeleton, handlers } : null;
}

function changedNativeHandlers(file, before, after) {
  if (file !== "packages/rules-core/src/effect/native-action-registry.ts")
    return [];
  const old = nativeHandlers(before),
    current = nativeHandlers(after);
  if (!old || !current || old.skeleton !== current.skeleton) return [];
  return [
    ...new Set([...old.handlers.keys(), ...current.handlers.keys()]),
  ].filter((key) => old.handlers.get(key) !== current.handlers.get(key));
}

function packRegistration(text) {
  const source = parse("generated-index.ts", text ?? "");
  if (!source) return null;
  const matchedImports = new Map();
  for (const entry of source.statements) {
    if (
      !ts.isImportDeclaration(entry) ||
      !ts.isStringLiteral(entry.moduleSpecifier)
    )
      continue;
    const specifier = entry.moduleSpecifier.text;
    const bindings = entry.importClause?.namedBindings;
    if (
      !/^\.\/cards\/[^/]+\.js$/.test(specifier) ||
      entry.importClause?.isTypeOnly ||
      entry.importClause?.name ||
      !bindings ||
      !ts.isNamedImports(bindings) ||
      bindings.elements.length !== 1
    )
      continue;
    const [element] = bindings.elements;
    if (element.isTypeOnly) continue;
    matchedImports.set(element.name.text, {
      entry,
      file: "packages/card-data/src/" + specifier.slice(2, -3) + ".ts",
      symbol: (element.propertyName ?? element.name).text,
    });
  }
  const array = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (declaration) => declaration.name.getText(source) === "ALL_CARDS"
    )?.initializer;
  if (!array || !ts.isArrayLiteralExpression(array)) return null;
  const packs = array.elements.map((element) =>
    ts.isSpreadElement(element) && ts.isIdentifier(element.expression)
      ? matchedImports.get(element.expression.text)
      : null
  );
  if (packs.some((pack) => !pack) || new Set(packs).size !== packs.length)
    return null;
  const imports = new Set(packs.map((pack) => pack.entry));
  const skeleton = astProjection(source, (node) =>
    node === array
      ? ts.factory.createArrayLiteralExpression()
      : imports.has(node)
        ? ts.factory.createNotEmittedStatement(node)
        : undefined
  );
  // An import may also have a runtime use outside ALL_CARDS.
  const outside = identifiers(
    ts.createSourceFile("index.ts", skeleton, ts.ScriptTarget.Latest)
  );
  if ([...matchedImports.keys()].some((name) => outside.has(name))) return null;
  return { skeleton, packs };
}

function changedPackRegistration(before, after) {
  const old = packRegistration(before),
    current = packRegistration(after);
  if (!old || !current || old.skeleton !== current.skeleton) return [];
  const key = (pack) => JSON.stringify([pack.file, pack.symbol]);
  const oldKeys = old.packs.map(key),
    currentKeys = current.packs.map(key);
  const ordering = oldKeys.filter((value) => currentKeys.includes(value));
  const currentOrdering = currentKeys.filter((value) =>
    oldKeys.includes(value)
  );
  if (ordering.some((value, index) => value !== currentOrdering[index]))
    return [];
  return [
    ...new Set(
      [
        ...old.packs.filter((pack) => !currentKeys.includes(key(pack))),
        ...current.packs.filter((pack) => !oldKeys.includes(key(pack))),
      ].map((pack) => pack.file)
    ),
  ];
}

function cardActionKinds(definition) {
  const source = parse("card.ts", `const card = (${definition});`);
  const kinds = new Set();
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "action" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const kind = node.initializer.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === "kind"
      );
      if (kind && ts.isStringLiteral(kind.initializer))
        kinds.add(kind.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  if (source) visit(source);
  return kinds;
}

function changedCardSteps(before, after) {
  const collect = (definition) => {
    const source = parse("card.ts", `const card = (${definition});`);
    const records = new Map();
    const print = (node) =>
      printer.printNode(ts.EmitHint.Unspecified, node, source);
    const visit = (node, context = "", inChoice = false) => {
      if (ts.isObjectLiteralExpression(node)) {
        const steps = cardProperty(node, "steps");
        if (steps && ts.isArrayLiteralExpression(steps.initializer))
          context += node.properties
            .filter((property) => property !== steps)
            .map(print)
            .join("\n");
        const action = cardProperty(node, "action")?.initializer;
        inChoice ||= Boolean(cardProperty(node, "choice"));
        if (action && ts.isObjectLiteralExpression(action)) {
          const kind = cardProperty(action, "kind")?.initializer;
          if (kind && ts.isStringLiteral(kind)) {
            const mode = cardProperty(node, "executionMode")?.initializer;
            const optional =
              mode && ts.isStringLiteral(mode) && mode.text === "optional";
            const actionText = print(action);
            const choice =
              inChoice ||
              optional ||
              kind.text === "draw" ||
              (kind.text === "search_zone" && /["']trash["']/.test(actionText));
            records.set(JSON.stringify([context, print(node), choice]), {
              kind: kind.text,
              actionText,
              choice,
            });
          }
        }
      }
      if (ts.isArrayLiteralExpression(node)) {
        const owner = ts.isPropertyAssignment(node.parent)
          ? node.parent.name.getText(source)
          : "array";
        node.elements.forEach((element, index) =>
          visit(element, `${context}\n${owner}[${index}]`, inChoice)
        );
        return;
      }
      ts.forEachChild(node, (child) => visit(child, context, inChoice));
    };
    if (source) visit(source);
    return records;
  };
  const old = collect(before),
    current = collect(after);
  const changedSteps = (from, other) => {
    const otherActions = new Set(
      [...other.values()].map((step) => step.actionText)
    );
    return [...from]
      .filter(([key]) => before === after || !other.has(key))
      .map(([, value]) => ({
        ...value,
        actionChanged: !otherActions.has(value.actionText),
      }));
  };
  return [...changedSteps(old, current), ...changedSteps(current, old)];
}

export function semanticScope(root, changed, bases, tree) {
  const overrides = {},
    reasons = {},
    tests = new Set(),
    cards = new Set();
  if (!changed?.length || !bases.length)
    return { overrides, reasons, tests: [], cards: [] };
  if (bases.length > 1) {
    let unresolvedLockChange = false;
    for (const base of bases) {
      const changedFromBase = tree
        ? state
            .git(root, [
              "diff",
              "--no-renames",
              "--name-only",
              "-z",
              base,
              tree,
              "--",
            ])
            .split("\0")
        : state.changedPaths(root, base);
      const scope = semanticScope(
        root,
        changed.filter((file) => changedFromBase.includes(file)),
        [base],
        tree
      );
      if (
        changed.includes("pnpm-lock.yaml") &&
        changedFromBase.includes("pnpm-lock.yaml") &&
        scope.reasons["pnpm-lock.yaml"]?.unchangedResolution !== true
      )
        unresolvedLockChange = true;
      scope.tests.forEach((test) => tests.add(test));
      scope.cards.forEach((card) => cards.add(card));
      for (const [file, gates] of Object.entries(scope.overrides)) {
        overrides[file] = [...new Set([...(overrides[file] ?? []), ...gates])];
        const previous = reasons[file] ?? {};
        const next = scope.reasons[file] ?? {};
        const merged = { ...previous, ...next };
        for (const field of ["cards", "tests"])
          if (previous[field] || next[field])
            merged[field] = [
              ...new Set([...(previous[field] ?? []), ...(next[field] ?? [])]),
            ];
        reasons[file] = merged;
      }
    }
    // Every changed comparison must prove unchanged dependency inputs.
    // A base with a substantive lock change has no narrowing override.
    if (unresolvedLockChange) {
      delete overrides["pnpm-lock.yaml"];
      delete reasons["pnpm-lock.yaml"];
    }
    return {
      overrides,
      reasons,
      tests: [...tests].sort(),
      cards: [...cards].sort(),
    };
  }
  const files = [
    ...new Set(
      state
        .git(
          root,
          tree
            ? ["ls-tree", "-r", "--name-only", "-z", tree]
            : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]
        )
        .split("\0")
        .filter(Boolean)
    ),
  ];
  const fileSet = new Set(files);
  const hasFile = (file) =>
    tree ? fileSet.has(file) : existsSync(resolve(root, file));
  const readSource = (file) =>
    tree
      ? state.git(root, ["show", `${tree}:${file}`])
      : readFileSync(resolve(root, file), "utf8");
  const testFiles = files.filter(
    (file) =>
      /^(packages|apps)\/.+\/test\/.+\.test\.ts$/.test(file) && hasFile(file)
  );
  const testPaths = new Set(testFiles);
  const sourceTexts = new Map();
  const scenarioGates = new Map(
    Object.entries(manifest.gates)
      .filter(([id]) => id.startsWith("scenario-file-"))
      .map(([id, gate]) => [gate.args[1], id])
  );
  const textFor = (file) => {
    if (!sourceTexts.has(file)) sourceTexts.set(file, readSource(file));
    return sourceTexts.get(file);
  };
  let oldRegistry;
  try {
    oldRegistry = state.git(root, [
      "show",
      `${bases[0]}:apps/playground-web/src/scenarios.ts`,
    ]);
  } catch {
    oldRegistry = null;
  }
  const allowedImports =
    oldRegistry === null ? new Set() : runtimeImports(oldRegistry);
  const beforeTexts = new Map(),
    provenNew = new Set();
  const beforeText = (file) => {
    if (!beforeTexts.has(file)) {
      try {
        beforeTexts.set(file, state.git(root, ["show", `${bases[0]}:${file}`]));
      } catch {
        beforeTexts.set(file, null);
      }
    }
    return beforeTexts.get(file);
  };
  const coreLoadedBefore = (imports, visited = new Set()) => {
    for (const dependency of imports) {
      if (dependency === "@orica/rules-core") return true;
      if (
        !/^\.\/scenario-[a-z0-9-]+$/.test(dependency) ||
        visited.has(dependency)
      )
        continue;
      visited.add(dependency);
      const text = beforeText(
        `apps/playground-web/src/${dependency.slice(2)}.ts`
      );
      if (text !== null && coreLoadedBefore(runtimeImports(text), visited))
        return true;
    }
    return false;
  };
  const relatedScenarios = (initial) => {
    const required = new Set(),
      pending = [initial],
      visited = new Set();
    const unitConsumers = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const name =
        /^apps\/playground-web\/src\/(scenario-[a-z0-9-]+)\.ts$/.exec(
          file
        )?.[1];
      const gate = scenarioGates.get(`e2e/${name}.spec.ts`);
      if (
        !gate ||
        !hasFile(file) ||
        !scenarioModuleIsPure(textFor(file), allowedImports)
      )
        return null;
      const previous = beforeText(file);
      if (
        previous === null
          ? !provenNew.has(file)
          : !scenarioModuleIsPure(previous, allowedImports) ||
            JSON.stringify([...runtimeImports(previous)]) !==
              JSON.stringify([...runtimeImports(textFor(file))])
      )
        return null;
      for (const dependency of runtimeImports(textFor(file))) {
        if (dependency === "@orica/rules-core") continue;
        if (!/^\.\/scenario-[a-z0-9-]+$/.test(dependency)) return null;
        pending.push(`apps/playground-web/src/${dependency.slice(2)}.ts`);
      }
      required.add(gate);
      for (const other of files) {
        if (other === file || !/\.[cm]?[jt]sx?$/.test(other) || !hasFile(other))
          continue;
        const text = textFor(other);
        if (
          !text.includes(name) ||
          !ts.preProcessFile(text, true, true).importedFiles.some(
            (ref) =>
              ref.fileName
                .split("/")
                .at(-1)
                .replace(/\.[cm]?[jt]sx?$/, "") === name
          )
        )
          continue;
        if (
          other === "apps/playground-web/src/scenarios.ts" ||
          other === `e2e/${name}.spec.ts`
        )
          continue;
        if (/^(packages|apps)\/.+\/test\/.+\.test\.ts$/.test(other)) {
          const stem = other.split("/").at(-1).replace(/\.ts$/, "");
          if (
            files.some(
              (consumer) =>
                consumer !== other &&
                /\.[cm]?[jt]sx?$/.test(consumer) &&
                hasFile(consumer) &&
                textFor(consumer).includes(stem) &&
                ts
                  .preProcessFile(textFor(consumer), true, true)
                  .importedFiles.some(
                    (ref) =>
                      ref.fileName.split("/").at(-1).replace(/\.ts$/, "") ===
                      stem
                  )
            )
          )
            return null;
          unitConsumers.add(other);
          required.add("focused-vitest");
          continue;
        }
        if (!/^apps\/playground-web\/src\/scenario-[a-z0-9-]+\.ts$/.test(other))
          return null;
        pending.push(other);
      }
    }
    unitConsumers.forEach((file) => tests.add(file));
    return required;
  };
  const auditSources = new Set(auditInputs);
  for (const raw of [
    beforeText(auditFixture),
    files.includes(auditFixture) && hasFile(auditFixture)
      ? textFor(auditFixture)
      : null,
  ]) {
    if (raw !== null) {
      for (const file of Object.keys(JSON.parse(raw).sourceHashes ?? {}))
        auditSources.add(file);
    }
  }
  const hasAudit = files.includes(auditTest) && hasFile(auditTest);
  const checkedTests = (related) =>
    related.filter(
      (file) =>
        testPaths.has(file) && file !== auditTest && !optInTest.test(file)
    );
  const addTests = (file, related, gates, reason, details = {}) => {
    const selected = checkedTests([...new Set(related)]);
    selected.forEach((test) => tests.add(test));
    overrides[file] = [
      ...new Set([...gates, ...(selected.length ? ["focused-vitest"] : [])]),
    ];
    reasons[file] = { reason, tests: selected, ...details };
  };
  const exactConsumers = (file) => {
    const name = posix.basename(file);
    const stem = name.replace(/\.[cm]?[jt]sx?$/, "");
    return testFiles.filter(
      (test) =>
        textFor(test).includes(name) ||
        ts.preProcessFile(textFor(test), true, true).importedFiles.some(
          (ref) =>
            ref.fileName
              .split("/")
              .at(-1)
              .replace(/\.[cm]?[jt]sx?$/, "") === stem
        )
    );
  };
  const gameRegressions = testFiles.filter(
    (test) =>
      test.startsWith("packages/rules-core/test/") ||
      /(?:effect-queue|field-effect|game-api|local-game-api|snapshot-progress)/.test(
        test
      )
  );
  const cardRegressions = (ids) =>
    testFiles.filter((test) => {
      const normalized = test.toLowerCase().replaceAll("_", ".");
      return ids.some(
        (id) =>
          textFor(test).includes(id) ||
          normalized.includes(id.toLowerCase().replace(/\([AB]\)$/, ""))
      );
    });
  const mechanismRegressions = (kinds) => {
    const kindPatterns = [...new Set(kinds)]
      .filter((kind) => /^[a-z][a-z_0-9]*$/.test(kind))
      .map((kind) => new RegExp(`\\bkind:\\s*["']${kind}["']`));
    return kindPatterns.length
      ? gameRegressions.filter((test) =>
          kindPatterns.some((pattern) => pattern.test(textFor(test)))
        )
      : [];
  };
  const importedBy = (target, candidates) =>
    candidates.filter(
      (file) =>
        file !== target &&
        /\.[cm]?[jt]sx?$/.test(file) &&
        hasFile(file) &&
        ts
          .preProcessFile(textFor(file), true, true)
          .importedFiles.some(
            (ref) =>
              ref.fileName.startsWith(".") &&
              posix
                .normalize(posix.join(posix.dirname(file), ref.fileName))
                .replace(/\.[cm]?[jt]sx?$/, "") ===
                target.replace(/\.[cm]?[jt]sx?$/, "")
          )
    );
  const selectGameChange = (file, before, after) => {
    const cardPath = cardInputs.test(file);
    const gates = cardPath
      ? ["types", "ledger", "card-tests", "ismcts-catalog", "card-source"]
      : ["types", "put-semantics", "ismcts-catalog"];
    const pack = cardPack.exec(file)?.[1];
    if (pack) {
      const { ids, impact, packWide, definitions } = changedCardRecords(
        file,
        before,
        after
      );
      // Action payloads and their surrounding conditions are diffed as steps.
      // Choice coverage and action-specific coverage are independent.
      const steps = definitions
        .filter(([id]) => impact.includes(id))
        .flatMap(([, old, current]) => changedCardSteps(old, current));
      const choiceMechanism = steps.some((step) => step.choice);
      const common = mechanismRegressions(
        steps
          .filter(
            (step) =>
              !step.choice ||
              (!["draw", "search_zone", "noop"].includes(step.kind) &&
                (step.kind !== "count_increase" || step.actionChanged))
          )
          .map((step) => step.kind)
      );
      const related = cardRegressions(impact);
      if (packWide) {
        related.push(
          ...testFiles.filter((test) =>
            test.toLowerCase().replaceAll("_", ".").includes(pack.toLowerCase())
          )
        );
      }
      addTests(
        file,
        [
          ...related,
          ...common,
          ...(choiceMechanism
            ? choiceTests.filter((test) => !test.endsWith("/game-api.test.ts"))
            : []),
        ],
        [...gates, ...(choiceMechanism ? choiceGui.slice(0, 3) : [])],
        packWide
          ? "Pack registration or shared expression changed"
          : "Card records identified by syntax tree",
        { cards: ids }
      );
      if (!related.length && (impact.length || packWide))
        reasons[file].missing =
          `Register a regression for ${impact.join(", ") || pack}`;
      if (packWide && after !== null && !impact.length)
        reasons[file].missing =
          "Resolve the card identities or the module's registration consumers";
      return;
    }
    if (cardPath) {
      const registered =
        [
          "packages/card-data/src/index.ts",
          "packages/card-data/src/generated-index.ts",
        ].includes(file) ||
        /^packages\/card-data\/(?:scripts\/|raw\/cardData\.js$)/.test(file);
      const registrationPacks =
        file === "packages/card-data/src/generated-index.ts"
          ? changedPackRegistration(before, after)
          : [];
      if (registrationPacks.length) {
        const registrationCards = registrationPacks.flatMap((path) =>
          changedCardRecords(
            path,
            beforeText(path),
            hasFile(path) ? textFor(path) : null
          ).definitions.map(([id]) => id)
        );
        const selected = cardRegressions(registrationCards);
        if (selected.length) {
          addTests(
            file,
            selected,
            [...gates, ...choiceGui],
            "Generated card registration changed for " +
              registrationPacks.join(", ")
          );
          return;
        }
      }
      const packConsumers = importedBy(
        file,
        files.filter((path) => cardPack.test(path))
      );
      if (!registered && !packConsumers.length) {
        addTests(file, exactConsumers(file), gates, "Card-data module");
        reasons[file].missing = "Identify consuming packs or card registration";
        return;
      }
      const related = packConsumers.length
        ? packConsumers.flatMap((path) =>
            cardRegressions(
              changedCardRecords(path, null, textFor(path)).impact
            )
          )
        : gameRegressions;
      addTests(
        file,
        related,
        [...gates, ...choiceGui],
        packConsumers.length
          ? `Shared dependency of ${packConsumers.join(", ")}`
          : "Card generation or registration feeds the game regression domain"
      );
      return;
    }
    if (
      before === null &&
      !importedBy(
        file,
        files.filter((path) => engineInputs.test(path) || testPaths.has(path))
      ).length
    ) {
      addTests(file, [], gates, "Unresolved new engine module");
      reasons[file].missing =
        "Identify the new module's engine or regression consumer";
      return;
    }
    const narrow = onlyStepChoiceBody(file, before, after);
    const handlerKinds = narrow
      ? []
      : changedNativeHandlers(file, before, after);
    const handlerTests = mechanismRegressions(handlerKinds);
    if (handlerTests.length) {
      const registry = "packages/card-data/src/generated-index.ts";
      const registeredPacks = new Set(
        hasFile(registry)
          ? ts
              .preProcessFile(textFor(registry), true, true)
              .importedFiles.filter((entry) =>
                entry.fileName.startsWith("./cards/")
              )
              .map((entry) =>
                posix
                  .normalize(
                    posix.join("packages/card-data/src", entry.fileName)
                  )
                  .replace(/\.js$/, ".ts")
              )
          : []
      );
      const consumerCards = [...registeredPacks]
        .filter(hasFile)
        .flatMap((packFile) =>
          changedCardRecords(packFile, null, textFor(packFile))
            .definitions.filter(([, , definition]) =>
              handlerKinds.some((kind) => cardActionKinds(definition).has(kind))
            )
            .map(([id]) => id)
        );
      handlerTests.push(...cardRegressions(consumerCards));
    }
    const targets = narrow
      ? choiceTests
      : handlerTests.length
        ? handlerTests
        : gameRegressions;
    addTests(
      file,
      targets,
      [...gates, ...choiceGui],
      narrow
        ? "handleStepChoiceSelection to pending continuation, usage settlement and GUI/API choice resolution"
        : handlerTests.length
          ? `Native handlers and registered card consumers: ${handlerKinds.join(", ")}`
          : "Shared engine runtime feeds the game regression domain"
    );
    if (!targets.length)
      reasons[file].missing =
        "Register the engine mechanism's regression consumers";
    if (narrow && choiceTests.some((test) => !testPaths.has(test)))
      reasons[file].missing =
        "Restore the registered choice/continuation regressions";
  };
  for (const file of changed) {
    const fixed = pathOverride(file);
    if (fixed) overrides[file] = fixed;
    if (fixed?.includes("focused-vitest")) {
      const focused = pathOverrideTests(file);
      if (!focused)
        throw new Error(
          "pathOverride selects focused-vitest without tests: " + file
        );
      focused.forEach((test) => tests.add(test));
    }
    const scenarioModule =
      /^apps\/playground-web\/src\/(scenario-[a-z0-9-]+)\.ts$/.exec(file);
    if (
      scenarioModule &&
      scenarioGates.has(`e2e/${scenarioModule[1]}.spec.ts`)
    ) {
      const related = relatedScenarios(file);
      if (related) overrides[file] = ["types", ...related];
    }
    // A directory is not evidence of a script's consumers. Require a scope for
    // an unknown script rather than guessing that it is an operations fixture.
    if (
      /^scripts\/.+\.(mjs|cjs|ps1)$/.test(file) &&
      !manifest.scopes.some((s) =>
        s.patterns.some((p) => new RegExp(p).test(file))
      ) &&
      !auditInputs.includes(file)
    ) {
      overrides[file] = [];
      reasons[file] = {
        missing:
          "Unclassified script: register its affected checks in gate-manifest.json",
      };
      continue;
    }
    if (file === "scripts/audit-mirror-provenance.json")
      overrides[file] = ["card-source"];
    if (file === "needs-ruling.jsonl") {
      const previous = state.git(root, ["show", `${bases[0]}:${file}`]);
      const current = readSource(file);
      const records = (text) =>
        text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      const oldRecords = records(previous),
        currentRecords = records(current);
      const identities = (record) =>
        record.cardNo ? [record.cardNo] : record.cardNos;
      const ids = [
        ...new Set(
          [...oldRecords, ...currentRecords].flatMap(
            (record) => identities(record) ?? [null]
          )
        ),
      ];
      if (ids.some((id) => typeof id !== "string" || !id))
        throw new Error("Ruling record without card identity");
      const changedIds = ids.filter(
        (id) =>
          JSON.stringify(
            oldRecords.filter((r) => identities(r).includes(id))
          ) !==
          JSON.stringify(
            currentRecords.filter((r) => identities(r).includes(id))
          )
      );
      const related = testFiles.filter((test) =>
        changedIds.some((id) => textFor(test).includes(id))
      );
      overrides[file] = [
        "card-source",
        ...(related.length ? ["focused-vitest"] : []),
      ];
      related.forEach((test) => tests.add(test));
    }
    const after = hasFile(file) ? textFor(file) : null;
    const before = beforeText(file);
    if (file === "pnpm-lock.yaml" && before !== null && after !== null) {
      const resolution = (source) =>
        source
          .split(/\r?\n/)
          .filter((line) => line.trim() && !/^\s*#/.test(line))
          .join("\n");
      const blockScalar = /:\s*[|>][+-]?(?:\s|$)/m;
      if (
        ![before, after].some((source) => blockScalar.test(source)) &&
        resolution(before) === resolution(after)
      ) {
        overrides[file] = ["changed-style"];
        reasons[file] = {
          reason: "Only lockfile comments or blank lines changed",
          unchangedResolution: true,
        };
        continue;
      }
    }
    if (cardInputs.test(file) || engineInputs.test(file)) {
      const oldLoaders = runtimeLoaders(file, before);
      const newLoaders = runtimeLoaders(file, after);
      if (!newLoaders || oldLoaders?.opaque !== newLoaders.opaque) {
        addTests(file, [], ["types"], "Runtime loader or unparseable source");
        reasons[file].missing =
          "Resolve the loader targets or restore parseable source before selecting dependent checks";
        continue;
      }
      const changedLoads = [
        ...new Set([...oldLoaders.literal, ...newLoaders.literal]),
      ].filter(
        (specifier) =>
          oldLoaders.literal.filter((entry) => entry === specifier).length !==
          newLoaders.literal.filter((entry) => entry === specifier).length
      );
      if (changedLoads.length) {
        const resolved = changedLoads.every((specifier) => {
          if (!specifier.startsWith(".")) return false;
          const target = posix.normalize(
            posix.join(posix.dirname(file), specifier)
          );
          return (
            (engineInputs.test(target) || cardInputs.test(target)) &&
            [
              target,
              target.replace(/\.js$/, ".ts"),
              target + ".ts",
              target + "/index.ts",
            ].some(
              (candidate) =>
                hasFile(candidate) || beforeText(candidate) !== null
            )
          );
        });
        const loaderGates = engineInputs.test(file)
          ? ["types", "put-semantics", "ismcts-catalog"]
          : ["types", "ledger", "card-tests", "ismcts-catalog", "card-source"];
        addTests(
          file,
          resolved ? gameRegressions : [],
          resolved ? [...loaderGates, ...choiceGui] : loaderGates,
          `Runtime loader links the game domain: ${changedLoads.join(", ")}`
        );
        if (!resolved || !gameRegressions.length)
          reasons[file].missing =
            "Register the literal loader targets and their regression domain";
        continue;
      }
      if (
        /^packages\/rules-core\/src\/(?:model|dsl-types|runtime)\.ts$/.test(
          file
        )
      )
        continue;
      if (
        before !== null &&
        after !== null &&
        typeOnlyChange(file, before, after)
      ) {
        overrides[file] = ["types"];
        reasons[file] = { reason: "Unchanged TypeScript runtime emit" };
        continue;
      }
      if (
        before === null ||
        after === null ||
        !staticReductionChange(file, before, after)
      ) {
        selectGameChange(file, before, after);
        continue;
      }
    }
    if (after === null) continue;
    if (optInTest.test(file) && file !== FUZZ_ONLY_TEST) {
      addTests(file, [], ["types"], "Opt-in diagnostic suite");
      reasons[file].missing =
        "Register an executable gate with the suite's diagnostic mode enabled";
      continue;
    }
    if (testFiles.includes(file) && file !== FUZZ_ONLY_TEST) {
      // A test module imported by another test is a shared helper, not a leaf.
      const stem = file.split("/").at(-1).replace(/\.ts$/, "");
      if (
        !files.some(
          (other) =>
            other !== file &&
            /\.[cm]?[jt]sx?$/.test(other) &&
            hasFile(other) &&
            (() => {
              const text = sourceTexts.get(other) ?? readSource(other);
              sourceTexts.set(other, text);
              return (
                text.includes(stem) &&
                ts
                  .preProcessFile(text, true, true)
                  .importedFiles.some(
                    (ref) =>
                      ref.fileName.split("/").at(-1).replace(/\.ts$/, "") ===
                      stem
                  )
              );
            })()
        )
      ) {
        overrides[file] = ["focused-vitest"];
        tests.add(file);
      }
      continue;
    }
    if (before === null) continue;
    if (
      ["scripts/test-harness.mjs", "scripts/test-verifier-gate.mjs"].includes(
        file
      ) &&
      before
        .replaceAll('"ismcts-runtime"', '"__catalog_gate__"')
        .replaceAll('"ismcts-catalog"', '"__catalog_gate__"') ===
        after
          .replaceAll('"ismcts-runtime"', '"__catalog_gate__"')
          .replaceAll('"ismcts-catalog"', '"__catalog_gate__"')
    )
      overrides[file] = ["harness-selection", "verifier"];
    if (file === "scripts/harness/gate-manifest.json") {
      const old = JSON.parse(before),
        current = JSON.parse(after);
      // Selector edits still feed selectGates(), which test-audit-operations
      // asserts, so that gate stays selected here as well.
      if (selectorManifestOnlyChange(old, current))
        overrides[file] = ["harness-selection", "verifier", "audit-operations"];
    }
    if (
      file === "scripts/run-supervisor-iteration.ps1" &&
      preflightOnlyChange(before, after)
    ) {
      overrides[file] = ["supervisor-preflight"];
      continue;
    }
    if (file === "apps/playground-web/src/scenarios.ts") {
      const required = new Set();
      const additions = addedScenarios(
        before,
        after,
        new Set(scenarioGates.keys()),
        (name, priorImports) => {
          if (!coreLoadedBefore(priorImports)) return false;
          const moduleFile = `apps/playground-web/src/scenario-${name}.ts`;
          provenNew.add(moduleFile);
          const related = relatedScenarios(moduleFile);
          if (!related) return false;
          related.forEach((id) => required.add(id));
          return true;
        }
      );
      if (additions) {
        overrides[file] = ["types", ...required];
        for (const name of additions)
          overrides[`apps/playground-web/src/scenario-${name}.ts`] = [
            "types",
            ...required,
          ];
        continue;
      }
    }
    const ids = staticReductionChange(file, before, after);
    if (roomDeliveryOnlyChange(file, before, after)) {
      overrides[file] = ["types", "room-delivery-unit", "local-game-ui"];
      continue;
    }
    if (revealedCardsUsageRemoval(file, before, after)) {
      overrides[file] = [
        "types",
        "revealed-target-unit",
        "scenario-file-scenario-revealed-target-selection",
        "scenario-file-reveal-retrieval-audit",
      ];
      continue;
    }
    if (ids) {
      const related = testFiles.filter((test) =>
        ids.some((id) => textFor(test).includes(id))
      );
      if (related.length) {
        overrides[file] = ["static-reduction", "focused-vitest"];
        related.forEach((test) => tests.add(test));
        ids.forEach((id) => cards.add(id));
      }
    } else if (typeOnlyChange(file, before, after)) overrides[file] = ["types"];
  }
  for (const file of changed) {
    const lines = () => state.changedLines(root, file, bases[0], tree);
    const prior =
      overrides[file] ??
      matchingScopes(file, lines).flatMap((scope) => scope.gates);
    if (
      prior.includes("vitest") &&
      !["vitest.config.ts", "scripts/vitest-with-jest-aliases.mjs"].includes(
        file
      )
    ) {
      const related = exactConsumers(file);
      if (testPaths.has(file)) related.push(file);
      if (
        isPlaygroundSrcFile(file) ||
        SERVER_VITE_MODULES.includes(file) ||
        SERVER_STANDALONE_MODULES.includes(file) ||
        file === "apps/playground-web/src/components/BattleScreen.tsx"
      )
        related.push(
          ...testFiles.filter(
            (test) =>
              test.startsWith("apps/playground-web/test/") &&
              !test.endsWith("/mcts.test.ts")
          )
        );
      if (file.startsWith("packages/rules-core/test/helpers/"))
        related.push(...gameRegressions);
      addTests(
        file,
        related,
        prior.filter((gate) => gate !== "vitest"),
        "Registered checks and test consumers of the changed input"
      );
      if (!checkedTests(related).length)
        reasons[file].missing = "Register the consumers of this test input";
    }
    if (auditSources.has(file) && (hasAudit || files.includes(auditFixture))) {
      const existing = overrides[file] ?? prior;
      overrides[file] = [
        ...new Set([
          ...existing.filter(
            (gate) => gate !== "vitest" && gate !== "focused-vitest"
          ),
          "card-source-audit",
          ...(existing.includes("focused-vitest") && file !== auditTest
            ? ["focused-vitest"]
            : []),
        ]),
      ];
      const decision = reasons[file] ?? {
        reason: "Recorded audit fixture or implementation",
      };
      reasons[file] = {
        ...decision,
        reason: decision.reason + "; raw/structured audit input",
      };
      if (!hasAudit)
        reasons[file].missing =
          "Restore the source-audit test that verifies this input";
    }
  }
  tests.delete(auditTest);
  return {
    overrides,
    reasons,
    tests: [...tests].sort(),
    cards: [...cards].sort(),
  };
}

export function assertCompleteFocusedResults(root, files, report) {
  if (
    report.success !== true ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    !(report.numPassedTests > 0)
  )
    throw new Error(
      "Focused completion requires every collected case to pass without skips"
    );
  const expected = files.map((file) => resolve(root, file)).sort();
  const actual = report.testResults
    ?.map((suite) => {
      if (typeof suite.name !== "string" || !isAbsolute(suite.name))
        throw new Error("Invalid focused test file identity");
      return resolve(suite.name);
    })
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error("Focused completion file set mismatch");
  let count = 0;
  for (const suite of report.testResults) {
    const ids = new Set();
    if (!suite.assertionResults?.length)
      throw new Error("Empty focused test file");
    for (const test of suite.assertionResults) {
      const id = JSON.stringify([...(test.ancestorTitles ?? []), test.title]);
      if (
        !test.title ||
        ids.has(id) ||
        test.status !== "passed" ||
        test.retryCount !== 0
      )
        throw new Error("Missing, duplicate, skipped or retried focused case");
      ids.add(id);
      count++;
    }
  }
  if (count !== report.numPassedTests)
    throw new Error("Focused case count mismatch");
}
