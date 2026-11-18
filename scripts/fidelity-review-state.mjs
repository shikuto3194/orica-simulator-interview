/** Current source + runtime/ruling context bind review dispositions to one auditable state. */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectCardFaces } from "./card-text-accountability-core.mjs";
import { resolveReview } from "./fidelity-review-resolution.mjs";
import { auditContent } from "./audit-inputs.mjs";
import { reviewRuntimeInputs } from "./review-runtime-inputs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REVIEW_REGISTRY = "scripts/fidelity-review-resolutions.json";

function requireInside(physicalRoot, path) {
  const rel = relative(physicalRoot, realpathSync(path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Review context leaves repository: ${path}`);
  }
}

function readRegistry(repoRoot) {
  const path = join(repoRoot, REVIEW_REGISTRY);
  if (!existsSync(path)) return { schemaVersion: 1, records: [] };
  requireInside(realpathSync(repoRoot), path);
  if (lstatSync(path).isSymbolicLink())
    throw new Error("Review registry must not be a symlink.");
  return JSON.parse(readFileSync(path, "utf8"));
}

// Content, not HEAD, is significant: committing a confirmation must not stale itself.
// Include execution/ruling/test contracts so unchanged card DSL does not preserve a
// confirmation across a changed engine. Unrelated card changes are face-local.
export function reviewContextFingerprint(repoRoot = ROOT) {
  return contextFromRuntime(repoRoot, reviewRuntimeInputs(repoRoot));
}
function contextFromRuntime(repoRoot, runtimeInputs) {
  const physicalRoot = realpathSync(repoRoot);
  const paths = [];
  function collect(relative) {
    const path = join(repoRoot, relative);
    if (!existsSync(path)) {
      paths.push({ relative, missing: true });
      return;
    }
    requireInside(physicalRoot, path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error(`Review context must not follow symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort())
        collect(`${relative}/${name}`);
    } else paths.push({ relative, missing: false });
  }
  for (const relative of [
    ...runtimeInputs.files,
    "packages/rules-core/package.json",
    "packages/rules-core/tsconfig.json",
    "scripts/review-runtime-inputs.mjs",
    "manual/ai-reference/10_rules",
    "needs-ruling.jsonl",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    ".npmrc",
    "scripts/audit-inputs.mjs",
    "scripts/fidelity-review-resolution.mjs",
    "scripts/fidelity-review-state.mjs",
    "scripts/harness/gate-manifest.mjs",
    "scripts/harness/run-gates.mjs",
  ])
    collect(relative);
  // The full face and detector output bind each claim. Detector implementation
  // changes alone do not invalidate a proof of an unchanged claim. Each record
  // separately binds its selected tests and their shared fixtures.
  const hash = createHash("sha256").update("review-context-v4\0");
  // Dependency/module contracts are shared; commands and declarative gate
  // selection are bound to the regressions selected by each record instead.
  const packagePath = join(repoRoot, "package.json");
  requireInside(physicalRoot, packagePath);
  const { scripts: _scripts, ...packageContract } = JSON.parse(
    readFileSync(packagePath, "utf8")
  );
  hash.update(JSON.stringify(packageContract)).update("\0");
  for (const { relative, missing } of paths.sort((a, b) =>
    a.relative.localeCompare(b.relative)
  )) {
    hash
      .update(relative)
      .update("\0")
      .update(
        missing
          ? "missing"
          : auditContent(readFileSync(join(repoRoot, relative)))
      )
      .update("\0");
  }
  return hash.digest("hex");
}

export function applyReviewResolutions(cards, findings, options = {}) {
  const repoRoot = options.repoRoot ?? ROOT;
  const registryPath = join(repoRoot, REVIEW_REGISTRY);
  const registry = options.registry ?? readRegistry(repoRoot);
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.records)) {
    throw new Error(`Invalid review resolution registry: ${registryPath}`);
  }
  const runtimeInputs = reviewRuntimeInputs(repoRoot);
  const contextFingerprint = contextFromRuntime(repoRoot, runtimeInputs);
  // Call-local only: no parsed source or directory list survives a fresh audit.
  const proofCache = { runtimeFiles: new Set(runtimeInputs.files) };
  const faces = new Map(
    cards
      .flatMap(collectCardFaces)
      .map(({ cardNo, face }) => [cardNo, { ...face, cardNo }])
  );
  const pending = [];
  const confirmed = [];
  for (const finding of findings) {
    if (finding.severity !== "review") {
      pending.push(finding);
      continue;
    }
    const face = faces.get(finding.cardNo);
    if (!face) throw new Error(`Missing face for review: ${finding.cardNo}`);
    const resolution = resolveReview({
      repoRoot,
      face,
      finding,
      registry,
      contextFingerprint,
      proofCache,
    });
    const annotated = { ...finding, reviewResolution: resolution };
    if (resolution.status === "confirmed_correct") confirmed.push(annotated);
    else pending.push(annotated);
  }
  return { pending, confirmed, contextFingerprint };
}
