#!/usr/bin/env node
/** Replace placeholder cluster.resolvedCommit values with the commit that
 * introduced the corresponding resolvedCommit line. `done` must run before
 * the verified commit exists, so the next supervisor tick performs this
 * deterministic git-blame backfill. */

import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(join(SCRIPT_DIR, ".."));
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout;
}

export function blameCommitByFinalLine(output) {
  const commits = new Map();
  const lines = String(output).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/i);
    if (!header) continue;
    while (index + 1 < lines.length && !lines[index + 1].startsWith("\t")) {
      index += 1;
    }
    if (index + 1 < lines.length) {
      commits.set(Number(header[2]), header[1]);
      index += 1;
    }
  }
  return commits;
}

function clusterRecordAt(root, relativeRegistry, revision, id) {
  const result = spawnSync("git", ["show", `${revision}:${relativeRegistry}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) return null;
  try {
    const registry = JSON.parse(result.stdout);
    return registry.clusters?.find((cluster) => cluster.id === id) ?? null;
  } catch {
    return null;
  }
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function matchesCurrentResolution(candidate, current) {
  return (
    candidate?.status === "done" &&
    candidate.scope === current.scope &&
    sameJson(candidate.queueRefs, current.queueRefs) &&
    candidate.resolvedAt === current.resolvedAt &&
    candidate.resolvedNote === current.resolvedNote
  );
}

function isAuditableSameIdReopen({ current, candidate, parent }) {
  const reopenedFrom = current.reopenedFrom;
  return (
    parent?.status === "done" &&
    reopenedFrom?.resolvedAt === (parent.resolvedAt ?? null) &&
    reopenedFrom?.resolvedCommit === (parent.resolvedCommit ?? null) &&
    SHA_PATTERN.test(reopenedFrom?.resolvedCommit || "") &&
    matchesCurrentResolution(candidate, current)
  );
}

function resolutionEvidenceCommits(root, relativeRegistry, cluster) {
  const needles = [
    ...(Array.isArray(cluster.queueRefs)
      ? [...cluster.queueRefs].reverse()
      : []),
    cluster.scope,
  ].filter((value) => typeof value === "string" && value.length > 0);
  return [
    ...new Set(
      needles.flatMap((needle) =>
        git(root, ["log", "--format=%H", "-S", needle, "--", relativeRegistry])
          .split(/\r?\n/)
          .filter((sha) => SHA_PATTERN.test(sha))
      )
    ),
  ];
}

export function backfillClusterResolvedCommits({
  root = DEFAULT_ROOT,
  registryPath = join(root, "autorun-queue", "cluster-registry.json"),
  apply = false,
} = {}) {
  const absoluteRoot = resolve(root);
  const absoluteRegistry = resolve(registryPath);
  const relativeRegistry = relative(absoluteRoot, absoluteRegistry).replaceAll(
    "\\",
    "/"
  );
  if (relativeRegistry.startsWith("../") || relativeRegistry === "..") {
    throw new Error("cluster registry must be inside the git root");
  }
  const source = readFileSync(absoluteRegistry, "utf8");
  const registry = JSON.parse(source);
  const weak = (registry.clusters || []).filter(
    (cluster) =>
      cluster.status === "done" &&
      !SHA_PATTERN.test(cluster.resolvedCommit || "")
  );
  if (weak.length === 0) {
    return { weak: 0, backfilled: [], unresolved: [], applied: false };
  }

  const blame = blameCommitByFinalLine(
    git(absoluteRoot, [
      "blame",
      "-w",
      "--line-porcelain",
      "HEAD",
      "--",
      relativeRegistry,
    ])
  );
  const weakIds = new Set(weak.map((cluster) => cluster.id));
  const commitById = new Map();
  const statusCommitById = new Map();
  let currentClusterId = null;
  const sourceLines = source.split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const idMatch = line.match(/^\s*"id":\s*"([^"]+)"/);
    if (idMatch) currentClusterId = idMatch[1];
    if (
      currentClusterId &&
      weakIds.has(currentClusterId) &&
      /^\s*"resolvedCommit":/.test(line)
    ) {
      const sha = blame.get(index + 1);
      if (sha && !/^0+$/.test(sha)) commitById.set(currentClusterId, sha);
    }
    if (
      currentClusterId &&
      weakIds.has(currentClusterId) &&
      /^\s*"status":\s*"done"/.test(line)
    ) {
      const sha = blame.get(index + 1);
      if (sha && !/^0+$/.test(sha)) statusCommitById.set(currentClusterId, sha);
    }
  }

  const backfilled = [];
  const unresolved = [];
  for (const cluster of weak) {
    const blameSha =
      commitById.get(cluster.id) || statusCommitById.get(cluster.id);
    const candidateShas = [
      blameSha,
      ...resolutionEvidenceCommits(absoluteRoot, relativeRegistry, cluster),
    ].filter((sha, index, all) => sha && all.indexOf(sha) === index);
    if (candidateShas.length === 0) {
      unresolved.push({
        id: cluster.id,
        reason: "resolvedCommit line has no git blame",
      });
      continue;
    }
    let resolved = false;
    const rejected = [];
    for (const sha of candidateShas) {
      const resolvedRecord = clusterRecordAt(
        absoluteRoot,
        relativeRegistry,
        sha,
        cluster.id
      );
      const parentRecord = clusterRecordAt(
        absoluteRoot,
        relativeRegistry,
        `${sha}^`,
        cluster.id
      );
      const isStandardTransition =
        parentRecord?.status !== "done" &&
        matchesCurrentResolution(resolvedRecord, cluster);
      const isSameIdReopen = isAuditableSameIdReopen({
        current: cluster,
        candidate: resolvedRecord,
        parent: parentRecord,
      });
      if (isStandardTransition || isSameIdReopen) {
        cluster.resolvedCommit = sha;
        backfilled.push({ id: cluster.id, commit: sha });
        resolved = true;
        break;
      }
      rejected.push(sha);
    }
    if (!resolved) {
      unresolved.push({
        id: cluster.id,
        reason: `candidate ${rejected.join(", ")} is not an open/absent -> done transition or an auditable same-id reopen`,
      });
    }
  }

  if (apply && backfilled.length > 0) {
    const temporary = `${absoluteRegistry}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    renameSync(temporary, absoluteRegistry);
  }
  return {
    weak: weak.length,
    backfilled,
    unresolved,
    applied: apply && backfilled.length > 0,
  };
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

export function runBackfillCli(argv = process.argv.slice(2)) {
  const root = resolve(argValue(argv, "--root", DEFAULT_ROOT));
  const registryPath = resolve(
    argValue(
      argv,
      "--registry",
      process.env.ORICA_CLUSTER_REGISTRY ||
        join(root, "autorun-queue", "cluster-registry.json")
    )
  );
  const result = backfillClusterResolvedCommits({
    root,
    registryPath,
    apply: argv.includes("--apply"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.unresolved.length > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    process.exitCode = runBackfillCli();
  } catch (error) {
    process.stderr.write(
      `[cluster-resolved-commit-backfill] ${error.message}\n`
    );
    process.exitCode = 2;
  }
}
