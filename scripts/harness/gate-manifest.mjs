import manifest from "./gate-manifest.json" with { type: "json" };
export const { gates, testGates } = manifest;
export const fullGates = [...manifest.sourceGates, ...testGates];
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
function requiresFullMerge(changed) {
  return (
    Array.isArray(changed) &&
    changed.includes("scripts/test-supervisor-environment.mjs")
  );
}
function hasDynamicLoaderChange(changed, getChangedLines) {
  const commentsAndWhitespace =
    "(?:(?:\\s+)|(?:/\\*[\\s\\S]*?\\*/)|(?://[^\\r\\n]*(?:\\r?\\n|$)))*";
  const dynamicLoader = new RegExp(
    `\\b(?:import|require|eval|Function)\\b${commentsAndWhitespace}\\(`
  );
  return changed.some((file) => {
    if (!/^packages\/(?:rules-core\/src|card-data\/src)\//.test(file))
      return false;
    return dynamicLoader.test((getChangedLines(file) ?? []).join("\n"));
  });
}
function scopedGates(changed, getChangedLines, isNewPath = () => false) {
  if (changed === null) return fullGates;
  if (changed.length === 0) return [];
  // A newly introduced module has no reviewed dependency history, even when
  // its directory currently contains files with a narrow scope.
  if (
    changed.some(
      (file) =>
        isNewPath(file) &&
        /^packages\/(?:rules-core\/src\/(?:effect|battle|stack|play)|card-data\/src)\//.test(
          file
        )
    )
  )
    return fullGates;
  // A recognized directory is not enough when the changed code introduces a
  // dynamic loader. Its dependency closure cannot be bounded by path scope.
  if (hasDynamicLoaderChange(changed, getChangedLines)) return fullGates;
  // Existing modules under these domain roots can be cross-area shared while
  // remaining game-engine dependencies; the complete engine regression scope
  // below covers them without running unrelated operational suites.
  const selected = new Set(["changed-style"]);
  for (const file of changed) {
    const scopes = manifest.scopes.filter((scope) => {
      if (!scope.patterns.some((pattern) => new RegExp(pattern).test(file)))
        return false;
      if (!scope.changedLines) return true;
      const lines = getChangedLines(file);
      return (
        lines?.length > 0 &&
        lines.every((line) => new RegExp(scope.changedLines).test(line))
      );
    });
    // Unknown paths, engine/API changes and build/dependency configuration
    // retain full verification until their impact has a reviewed scope.
    if (scopes.length === 0) return fullGates;
    for (const scope of scopes)
      for (const gate of scope.gates) selected.add(gate);
  }
  // Mixed changes may alter the review contract (including schema migration).
  // Every normal regression runs; the receipt gate requires unchanged code.
  if (selected.has("review-batch") && !isReviewOnlyChange(changed))
    return fullGates;
  return [...selected];
}
export function selectGates(
  profile,
  changed = [],
  getChangedLines = () => null,
  isNewPath = () => false,
  scenarioFiles = []
) {
  const scoped = ["finish", "push", "merge"].includes(profile)
    ? scopedGates(changed, getChangedLines, isNewPath)
    : [];
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
    push: scoped,
    merge: isReviewOnlyChange(changed)
      ? ["changed-style", "docs", "fidelity", "review-batch"]
      : requiresFullMerge(changed) ||
          scoped === fullGates ||
          scoped.length === 0
        ? [...fullGates, "card-tests"]
        : scoped,
    ci: [...fullGates, "scenario", "local-game-ui", "build", "public-build"],
    scenario: scenarioFiles.length
      ? scenarioFiles.map(scenarioGateForFile)
      : ["scenario"],
    "local-game": ["local-game-ui"],
    "public-build": ["build", "public-build"],
    finish: scoped,
  };
  if (!Object.hasOwn(profiles, profile))
    throw new Error("Unknown verification profile: " + profile);
  const selected = [...profiles[profile]];
  if (
    ["full", "finish", "push", "merge"].includes(profile) &&
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
        /^e2e\/(?:local-game-(?:sync\.spec|fixture)|scenario-blazing-star-oracle\.spec)\.ts$/.test(
          file
        )
      )
        selected.push("local-game-ui");
      if (file === "e2e/public-build.spec.ts")
        selected.push("build", "public-build");
    }
  }
  return [...new Set(selected)];
}

export function requiresMergeFuzz(
  changed,
  getChangedLines = () => null,
  isNewPath = () => false
) {
  if (!Array.isArray(changed)) return true;
  if (changed.length === 0) return false;
  const selected = scopedGates(changed, getChangedLines, isNewPath);
  if (selected === fullGates) return true;
  return changed.some((file) =>
    /^packages\/(?:rules-core\/src|card-data\/src)\//.test(file)
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
  if (id === "scenario") return [id, ...scenarioPaths.values()];
  if ([...scenarioPaths.values()].includes(id)) return [id, "scenario"];
  return [id];
}
