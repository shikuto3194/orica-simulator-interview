import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import state from "./harness/verification-state.cjs";

// Bind saved audit reports to the actual checkout, including registry, test
// support and the shared mirror. Derived progress ledgers are outputs, not
// audit inputs. Worker-only environment flags must not stale child reports.
export function auditInputFiles(repoRoot) {
  const extraFiles = [
    join(auditInputRoot(repoRoot), "external-qa/cardData.js"),
  ];
  const registryPath = join(
    repoRoot,
    "scripts/fidelity-review-resolutions.json"
  );
  const records = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, "utf8")).records
    : [];
  // A valid proof may cite an ignored local document. It is still an input.
  for (const record of Array.isArray(records) ? records : []) {
    for (const refs of [
      record?.evidenceRefs,
      record?.testRefs,
      record?.testSupport,
    ]) {
      for (const ref of Array.isArray(refs) ? refs : []) {
        if (
          typeof ref?.path !== "string" ||
          isAbsolute(ref.path) ||
          /[:\0]/.test(ref.path) ||
          ref.path.split(/[\\/]/).includes("..")
        )
          continue;
        const full = resolve(repoRoot, ref.path);
        if (existsSync(full)) {
          const physical = realpathSync(full);
          const rel = relative(realpathSync(repoRoot), physical);
          if (
            !rel ||
            rel === ".." ||
            rel.startsWith(`..${sep}`) ||
            isAbsolute(rel)
          )
            throw new Error("Review proof leaves repository");
          extraFiles.push(physical);
        }
        extraFiles.push(full);
      }
    }
  }
  // File symlinks must bind their contents as well as the link text.
  if (existsSync(extraFiles[0])) extraFiles.push(realpathSync(extraFiles[0]));
  return extraFiles;
}

export function auditStateFingerprint(repoRoot) {
  return state.sourceFingerprint(repoRoot, {
    includeEnvironment: false,
    exclude: [
      "fidelity-baseline.json",
      "manual/ai-reference/30_plan/02_detailed-todo.md",
    ],
    extraFiles: auditInputFiles(repoRoot),
  });
}

// Text checkouts may differ only by Git's LF/CRLF conversion. Binary fixtures
// remain byte-exact; do not normalize arbitrary binary data.
export function auditContent(bytes) {
  if (bytes.includes(0) || !isUtf8(bytes)) return bytes;
  return Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
}
export function auditContentHash(bytes) {
  return createHash("sha256").update(auditContent(bytes)).digest("hex");
}

export function auditInputRoot(repoRoot) {
  if (!existsSync(join(repoRoot, ".git"))) return resolve(repoRoot);
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) delete env[name];
  const common = execFileSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8", env, windowsHide: true }
  ).trim();
  return dirname(common);
}

export function loadAuditMirror(repoRoot) {
  const root = auditInputRoot(repoRoot);
  const path = join(root, "external-qa/cardData.js");
  if (!existsSync(path))
    return { cards: null, input: { status: "missing", sha256: null } };
  const bytes = readFileSync(path);
  const provenancePath = join(repoRoot, "scripts/audit-mirror-provenance.json");
  if (!existsSync(provenancePath))
    throw new Error(
      "Audit source is unreviewed: missing audit-mirror-provenance.json; review upstream and correction history before changing cards"
    );
  const provenanceBytes = readFileSync(provenancePath);
  const provenance = JSON.parse(provenanceBytes);
  const rawSha256 = auditContentHash(bytes);
  if (
    provenance.schemaVersion !== 1 ||
    provenance.sha256 !== rawSha256 ||
    !provenance.source?.revision ||
    !provenance.source?.path ||
    !provenance.reviewedAt ||
    !provenance.evidence
  )
    throw new Error(
      "Audit source version mismatch: review upstream, images and correction history; do not synchronize implementations to an unreviewed mirror"
    );
  const source = bytes
    .toString("utf8")
    .replace(/^import .*$/m, "const applyVersionToCard = (c) => c;")
    .replace(/^export default .*$/m, "return versionedCardData;");
  const cards = new Function(source)();
  if (!Array.isArray(cards))
    throw new Error("Invalid shared audit mirror: expected card array");
  return {
    cards,
    input: {
      status: "present",
      sha256: auditContentHash(
        Buffer.from(rawSha256 + auditContentHash(provenanceBytes))
      ),
      rawSha256,
      source: provenance.source,
      reviewedAt: provenance.reviewedAt,
    },
  };
}
