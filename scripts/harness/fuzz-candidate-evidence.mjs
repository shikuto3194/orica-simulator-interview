import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const HASH_RE = /^[a-f0-9]{64}$/;
const OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export function selectCandidateFuzzEvidence({
  root,
  head,
  tree,
  sourceFingerprint,
  games = 200,
}) {
  if (
    typeof head !== "string" ||
    !OBJECT_ID_RE.test(head) ||
    !OBJECT_ID_RE.test(tree) ||
    !HASH_RE.test(sourceFingerprint) ||
    !Number.isInteger(games) ||
    games <= 0
  )
    throw new Error("Invalid candidate fuzz evidence identity");

  let directoryEntries;
  try {
    directoryEntries = readdirSync(join(root, "logs", "fuzz-runs"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const matches = [];
  for (const name of directoryEntries) {
    if (!/^[\w.-]+\.json$/.test(name)) continue;
    const file = join(root, "logs", "fuzz-runs", name);
    let stat;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile() || stat.size > 128 * 1024) continue;

    let report;
    let bytes;
    try {
      bytes = readFileSync(file);
      report = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    if (
      report.schemaVersion !== 1 ||
      report.status !== "passed" ||
      report.exitCode !== 0 ||
      report.games !== games ||
      report.sourceHead !== head ||
      report.sourceTree !== tree ||
      report.sourceFingerprint !== sourceFingerprint ||
      report.candidateHead !== head ||
      report.candidateTree !== tree ||
      !Number.isFinite(report.startedAt) ||
      !Number.isFinite(report.finishedAt) ||
      report.finishedAt < report.startedAt ||
      !Number.isFinite(report.leaseWaitMs) ||
      typeof report.seedBase !== "string" ||
      !report.queueReceipt ||
      !Number.isInteger(report.queueReceipt.sequence)
    )
      continue;

    matches.push({
      file: relative(root, file).split(sep).join("/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      report,
    });
  }
  matches.sort((a, b) => b.report.finishedAt - a.report.finishedAt);
  return matches[0] ?? null;
}
