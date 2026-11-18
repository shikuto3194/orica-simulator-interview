import { execFileSync } from "node:child_process";
import manifest from "./gate-manifest.json" with { type: "json" };
import { pathOverride } from "./semantic-scope.mjs";

/**
 * Inventory classification for discovery. fullScopes records older review
 * history. Such a path still needs a completion scope or a crosscutting rule.
 */
export function classifyPath(file, source = manifest) {
  const scopes = source.scopes.filter((scope) =>
    scope.patterns.some((pattern) => new RegExp(pattern).test(file))
  );
  const override = pathOverride(file);
  if (override) return { kind: "override", gates: override };
  if (scopes.length > 0)
    return {
      kind: "scoped",
      gates: [...new Set(scopes.flatMap((scope) => scope.gates))],
      conditional: scopes.some((scope) => scope.changedLines),
    };
  const reviewed = (source.fullScopes ?? []).find((scope) =>
    scope.patterns.some((pattern) => new RegExp(pattern).test(file))
  );
  // A script change stays blocked until a real scope exists (semanticScope).
  const blocking = /^scripts\/.+\.(mjs|cjs|ps1)$/.test(file);
  if (reviewed)
    return {
      kind: "reviewed-full",
      id: reviewed.id,
      reason: reviewed.reason,
      blocking,
    };
  return { kind: "unclassified", blocking };
}

/**
 * Files that verify other files (tests, specs, scripts, gate definitions). A
 * new one must come with its own scope: a reviewed-full entry only covers the
 * files that existed when it was reviewed, never an added verification.
 */
export const VERIFICATION_PATH =
  /^(?:e2e\/|scripts\/|\.codex\/hooks\/|.*\/(?:tests?|__tests__)\/|.*\.(?:test|spec)\.[cm]?[jt]sx?$)/;

/**
 * Changed paths the selection cannot narrow on purpose or by review:
 *   unclassified    no scope, no reviewed-full entry
 *   new-verification a new test/spec/script that only a reviewed-full entry or
 *                   nothing covers
 */
export function classificationFindings(
  changed,
  isNewPath = () => false,
  overrides = {}
) {
  if (!Array.isArray(changed)) return [];
  const findings = [];
  for (const file of changed) {
    // A semantic scope (e.g. a new leaf unit test -> focused-vitest) already
    // narrowed this file for the current change.
    if (overrides[file]) continue;
    const c = classifyPath(file);
    if (c.kind === "unclassified")
      findings.push({ file, reason: "unclassified" });
    else if (
      c.kind === "reviewed-full" &&
      VERIFICATION_PATH.test(file) &&
      isNewPath(file)
    )
      findings.push({ file, reason: "new-verification" });
  }
  return findings;
}

/**
 * Gate ids that no scope, required scope, full/test/source list or declared
 * semantic selection can ever choose: a newly registered check nobody runs.
 */
export function unreferencedGates(source = manifest) {
  const used = new Set([
    ...source.sourceGates,
    ...source.testGates,
    ...(source.semanticGates ?? []),
    ...source.scopes.flatMap((scope) => scope.gates),
    ...(source.requiredScopes ?? []).flatMap((scope) => scope.gates),
  ]);
  return Object.keys(source.gates).filter((id) => !used.has(id));
}

export function unclassifiedPaths(files, source = manifest) {
  return files.filter(
    (file) => classifyPath(file, source).kind === "unclassified"
  );
}

/** Git-tracked paths (cached + untracked-not-ignored), as the selection sees them. */
export function trackedPaths(root) {
  return execFileSync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true }
  )
    .split("\0")
    .filter(Boolean);
}
