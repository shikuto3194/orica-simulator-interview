import manifest from "./gate-manifest.json" with { type: "json" };
import {
  isE2eSpecFile,
  isPlaygroundSrcFile,
  isPlaygroundTestFile,
  isServerModule,
  isStaticInput,
} from "./static-inputs.mjs";
export const { gates, testGates } = manifest;
export const fullGates = [...manifest.sourceGates, ...testGates];
// A gate that drives a browser needs one installed even when its command is
// not Playwright's own (the e2e runner spawns it).
export function gateNeedsBrowser(gate) {
  return (
    gate.bin === "playwright" ||
    gate.node?.includes("@playwright/test/cli.js") === true ||
    gate.browser === true
  );
}
const unitGateIds = Object.keys(gates).filter(
  (id) => gates[id].node === "scripts/vitest-with-jest-aliases.mjs"
);
const scenarioPaths = new Map(
  Object.entries(gates)
    .filter(([id]) => id.startsWith("scenario-file-"))
    .map(([id, gate]) => [gate.args[1], id])
);
export function isReviewOnlyChange(changed) {
  return (
    Array.isArray(changed) &&
    changed.length > 0 &&
    changed.every((file) =>
      [
        "scripts/fidelity-review-resolutions.json",
        "fidelity-baseline.json",
        "manual/ai-reference/30_plan/02_detailed-todo.md",
      ].includes(file)
    )
  );
}
const completionProfiles = ["finish", "push", "merge", "ci"];

export function matchingScopes(file, getChangedLines) {
  const matches = manifest.scopes.filter((scope) => {
    if (!scope.patterns.some((pattern) => new RegExp(pattern).test(file)))
      return false;
    if (!scope.changedLines) return true;
    const lines = getChangedLines(file);
    return (
      lines?.length > 0 &&
      lines.every((line) => new RegExp(scope.changedLines).test(line))
    );
  });
  const specific = matches.filter((scope) => !scope.fallback);
  return specific.length ? specific : matches;
}

function crosscuttingScope(file) {
  return manifest.crosscuttingScopes.find((scope) =>
    scope.patterns.some((pattern) => new RegExp(pattern).test(file))
  );
}

function scopedGates(changed, getChangedLines, overrides, semanticReasons) {
  const ids = new Set(changed?.length ? ["changed-style"] : []);
  const decisions = [],
    unresolved = [];
  if (changed === null)
    unresolved.push({
      file: null,
      reason: "Establish the comparison base and rerun the plan",
    });
  for (const file of changed ?? []) {
    const broad = crosscuttingScope(file);
    const scopes = matchingScopes(file, getChangedLines);
    const semantic = semanticReasons[file];
    if (
      broad &&
      !semantic?.unchangedResolution &&
      (file !== "package.json" || !scopes.length)
    ) {
      decisions.push({ file, gates: fullGates, reason: broad.reason });
      continue;
    }
    const candidates =
      overrides[file] ?? scopes.flatMap((scope) => scope.gates);
    const selected = [...new Set(candidates.filter((id) => id !== "vitest"))];
    const reason =
      semantic?.reason ??
      (overrides[file]
        ? "Registered semantic scope"
        : "Registered path and changed-line scope");
    if (
      semantic?.missing ||
      !candidates.length ||
      candidates.includes("vitest")
    ) {
      unresolved.push({
        file,
        reason:
          semantic?.missing ??
          (candidates.includes("vitest")
            ? "Register the affected Vitest files or a bounded domain regression"
            : "Identify the affected consumers and register their checks"),
      });
    }
    for (const gate of selected) ids.add(gate);
    decisions.push({
      file,
      gates: ["changed-style", ...selected],
      reason,
      ...(semantic?.tests && { tests: semantic.tests }),
      ...(semantic?.cards && { cards: semantic.cards }),
    });
  }
  const broad = decisions.find((decision) => decision.gates === fullGates);
  return {
    ids: [...ids],
    reason: broad
      ? { kind: "crosscutting-change", file: broad.file, detail: broad.reason }
      : null,
    decisions,
    unresolved,
  };
}

export function selectGates(...args) {
  return selectGatePlan(...args).ids;
}

export function selectGatePlan(
  profile,
  changed = [],
  getChangedLines = () => null,
  _isNewPath = () => false,
  scenarioFiles = [],
  overrides = {},
  focusedTests = [],
  semanticReasons = {},
  forceFull = false
) {
  const completion = completionProfiles.includes(profile);
  const {
    ids: scoped,
    reason,
    decisions,
    unresolved,
  } = completion
    ? scopedGates(changed, getChangedLines, overrides, semanticReasons)
    : { ids: [], reason: null, decisions: [], unresolved: [] };
  const fullSelectionReason =
    profile === "full" || forceFull ? { kind: "explicit-full" } : reason;
  const selectedScope = fullSelectionReason
    ? [...fullGates, ...scoped.filter((id) => id !== "changed-style")]
    : scoped;
  const reviewOnly = profile === "merge" && isReviewOnlyChange(changed);
  const profiles = {
    test: testGates,
    unit: ["vitest"],
    // Fast feedback only; callers supply exact unit-test paths. This is not a
    // completion profile and cannot satisfy finish/push acceptance.
    dialogue:
      Array.isArray(changed) && changed.length > 0
        ? ["changed-style", "vitest"]
        : ["vitest"],
    full: fullGates,
    push: selectedScope,
    merge: fullSelectionReason
      ? [...selectedScope, "card-tests"]
      : reviewOnly
        ? ["changed-style", "docs", "review-batch"]
        : scoped,
    ci: fullSelectionReason
      ? [...selectedScope, "scenario", "local-game-ui", "build", "public-build"]
      : scoped,
    scenario: scenarioFiles.length
      ? scenarioFiles.map(scenarioGateForFile)
      : ["scenario"],
    "local-game": ["local-game-ui"],
    "public-build": ["build", "public-build"],
    finish: selectedScope,
  };
  if (!Object.hasOwn(profiles, profile))
    throw new Error("Unknown verification profile: " + profile);
  const selected = [...profiles[profile]];
  if (
    ["full", "finish", "push", "merge", "ci"].includes(profile) &&
    Array.isArray(changed)
  ) {
    for (const scope of manifest.requiredScopes ?? [])
      if (
        (scope.whenFull !== true ||
          fullGates.every((id) => selected.includes(id))) &&
        changed.some((file) =>
          scope.patterns.some((pattern) => new RegExp(pattern).test(file))
        )
      )
        selected.push(...scope.gates);
    // A full fallback must not discard the changed registered GUI test.
    for (const file of changed) {
      const target = scenarioPaths.get(file);
      if (target) selected.push(target);
      if (
        /^e2e\/(?:local-game-(?:sync\.spec|fixture)|scenario-(?:blazing-star-oracle|effect-usage-accounting)\.spec)\.ts$/.test(
          file
        )
      )
        selected.push("local-game-ui");
      if (file === "e2e/public-build.spec.ts")
        selected.push("build", "public-build");
    }
  }
  // The full collection already includes these same tests. Keep dedicated
  // scopes for small changes, but never execute the identical files twice.
  const declarationSpec = "e2e/scenario-declaration-cues.spec.ts";
  const changedE2eCoversDeclaration =
    selected.includes("e2e-changed") && changed?.includes(declarationSpec);
  const ids = [...new Set(selected)].filter(
    (id) =>
      !(
        changedE2eCoversDeclaration && id === scenarioPaths.get(declarationSpec)
      ) &&
      !(id === "harness-selection" && selected.includes("harness")) &&
      !(id === "ismcts-catalog" && selected.includes("ismcts-runtime")) &&
      !(
        id === "fidelity" &&
        !fullSelectionReason &&
        ["finish", "push", "merge", "ci"].includes(profile) &&
        isReviewOnlyChange(changed)
      ) &&
      !(
        selected.includes("focused-vitest") &&
        id !== "focused-vitest" &&
        gates[id].node === "scripts/vitest-with-jest-aliases.mjs" &&
        gates[id].args?.length &&
        gates[id].args.every((file) => focusedTests.includes(file))
      ) &&
      !(
        selected.includes("vitest") &&
        (id === "focused-vitest" ||
          (id !== "vitest" &&
            id !== "card-source-audit" &&
            gates[id].node === "scripts/vitest-with-jest-aliases.mjs" &&
            gates[id].args?.length &&
            gates[id].args.every((file) => file.endsWith(".test.ts"))))
      ) &&
      !(selected.includes("handoff") && id === "ismcts-dispatch")
  );
  // Check recorded source bytes before running game regressions or browsers.
  if (ids.includes("card-source-audit")) {
    ids.splice(ids.indexOf("card-source-audit"), 1);
    ids.unshift("card-source-audit");
  }
  if (completion && ids.includes("vitest") && !fullSelectionReason)
    throw new Error("Full Vitest needs an explicit or crosscutting reason");
  return {
    ids,
    fullSelectionReason,
    decisions: decisions.map((decision) => ({
      ...decision,
      gates: decision.gates.filter((id) => ids.includes(id)),
    })),
    unresolved: fullSelectionReason ? [] : unresolved,
  };
}

export function requiresMergeFuzz(
  all,
  getChangedLines = () => null,
  _isNewPath = () => false
) {
  if (!Array.isArray(all)) return true;
  // The merge fuzz plays self-play games from rules-core and card-data sources
  // and a seed ledger (static reading: no file I/O of its own). Breaking or
  // deleting SQL, card images, deploy/oracle and the manual assets left the
  // summary of selfplay-fuzz.test.ts run directly (100 games, default seeds, not
  // the 200-game pnpm fuzz) identical to the unmutated baseline (P2-16, 確度B).
  // The same held for the 15 apps/playground-web/server modules (corrupted and
  // deleted: identical summary; the entry points' static import closure holds
  // none of them; P2-16, 確度B). The same held for the exact-path src and
  // *.test.ts lists (corrupted and deleted: identical summary; none of the
  // entry points imports them). The same held for the exact-path e2e spec list
  // (corrupted and deleted: identical summary; the entry points import no
  // spec). Only these groups (the static
  // inputs by pattern, the rest by exact lists) are
  // exempt; every other path keeps the safe fallback below.
  const changed = all.filter(
    (file) =>
      !isStaticInput(file) &&
      !isServerModule(file) &&
      !isPlaygroundSrcFile(file) &&
      !isPlaygroundTestFile(file) &&
      !isE2eSpecFile(file)
  );
  if (changed.length === 0) return false;
  const plan = scopedGates(changed, getChangedLines, {}, {});
  if (
    plan.reason ||
    plan.unresolved.some(
      ({ file }) => !matchingScopes(file, getChangedLines).length
    )
  )
    return true;
  return changed.some(
    (file) =>
      /^packages\/(?:rules-core\/src|card-data\/src)\//.test(file) ||
      // A change to the fuzz machinery must be proven by running it.
      /^(?:scripts\/(?:fuzz-runner|run-fuzz|fuzz-seed-ledger)\.mjs|apps\/playground-web\/test\/selfplay-(?:fuzz\.test|driver)\.ts)$/.test(
        file
      )
  );
}

// A narrowed runtime regression still changes the simulated game. Type-only
// and verified literal reduction edits keep their existing exemptions.
export function mergeFuzzRequired(changed, overrides = {}, getChangedLines) {
  if (!Array.isArray(changed)) return true;
  return requiresMergeFuzz(
    changed.filter(
      (file) =>
        !overrides[file] ||
        file === "apps/playground-web/test/selfplay-fuzz.test.ts" ||
        (/^packages\/(?:rules-core|card-data)\/src\//.test(file) &&
          !overrides[file].includes("static-reduction") &&
          overrides[file].some(
            (gate) => !["types", "card-source-audit"].includes(gate)
          ))
    ),
    getChangedLines
  );
}

/** Only registered, exact test paths may narrow an interactive scenario run. */
export function scenarioGateForFile(file) {
  const match = scenarioPaths.get(file);
  if (!match) throw new Error(`Unregistered scenario test: ${file}`);
  return match;
}

/** Aggregate and per-file failures overlap, but their successes are never interchangeable. */
export function failedGateAliases(id) {
  if (id === "harness") return [id, "harness-selection"];
  if (id === "harness-selection") return [id, "harness"];
  if (id === "ismcts-runtime") return [id, "ismcts-catalog"];
  if (id === "ismcts-catalog") return [id, "ismcts-runtime"];
  if (id === "vitest") return [...new Set([id, ...unitGateIds])];
  if (unitGateIds.includes(id))
    return [...new Set([id, "vitest", "focused-vitest"])];
  if (id === "scenario") return [id, ...scenarioPaths.values()];
  if ([...scenarioPaths.values()].includes(id)) return [id, "scenario"];
  return [id];
}
