#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { storedFileSizes } from "./lib/stored-file-sizes.mjs";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GiB = 1024 ** 3;
export const policy = JSON.parse(
  readFileSync(join(SCRIPT_DIR, "artifact-storage-policy.json"), "utf8")
);
for (const name of [
  "warningGiB",
  "maximumGiB",
  "targetGiB",
  "minimumFreeGiB",
  "warningFreeGiB",
  "minimumAgeHours",
  "keepLatestRuns",
]) {
  if (!Number.isFinite(policy[name]) || policy[name] <= 0)
    throw new Error("invalid artifact storage policy: " + name);
}
if (
  !(
    policy.targetGiB < policy.warningGiB &&
    policy.warningGiB <= policy.maximumGiB &&
    policy.minimumFreeGiB < policy.warningFreeGiB
  )
)
  throw new Error("invalid artifact storage thresholds");
const round = (bytes) => Math.round((bytes / GiB) * 1000) / 1000;
const MACHINE_PROTECTED_SAMPLE_LIMIT = 20;
const canonicalKey = (text) =>
  process.platform === "win32" ? text.toLowerCase() : text;
const normalized = (text) =>
  String(text)
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/");

// The supervisor consumes this JSON through PowerShell on Windows. Keep the
// transport ASCII-only so the console code page cannot corrupt a string while
// ConvertFrom-Json is parsing it.
export function stringifyMachineJson(value) {
  return JSON.stringify(value).replace(
    /[\u0080-\uFFFF]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || "cannot discover registered worktrees");
  return result.stdout.trim();
}

export function storageContext(repo = resolve(SCRIPT_DIR, "..")) {
  const common = git(repo, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const hub = realpathSync(dirname(common));
  const roots = git(hub, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => realpathSync(line.slice(9)));
  return { hub, roots: [...new Set(roots)], policy };
}

// Check every component, including the artifacts directory: a junction must never
// turn a repository cleanup into deletion elsewhere on the machine.
export function assertContained(root, target) {
  const base = resolve(root);
  const rel = relative(base, resolve(target));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`unsafe artifact path: ${target}`);
  }
  let current = base;
  if (lstatSync(current).isSymbolicLink())
    throw new Error(`linked root: ${current}`);
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`linked artifact path: ${current}`);
  }
  if (realpathSync(target) !== resolve(target))
    throw new Error(`non-canonical artifact path: ${target}`);
}

function filesUnder(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  if (lstatSync(directory).isSymbolicLink())
    throw new Error(`linked directory: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`linked artifact: ${path}`);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else if (stat.isFile())
      files.push({
        path,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ino: stat.ino,
      });
  }
  return files;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function liveWriter(run) {
  const path = join(run, ".storage-writer.json");
  if (!existsSync(path)) return false;
  const value = readJson(path);
  if (!Number.isInteger(value.pid) || value.pid <= 0)
    throw new Error(`invalid writer lease: ${path}`);
  try {
    process.kill(value.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function references(context, runs) {
  const found = new Set();
  const byBucket = new Map();
  for (const { key } of runs) {
    const slash = key.indexOf("/");
    const bucket = key.slice(0, slash);
    const group = byBucket.get(bucket) ?? new Map();
    group.set(key, key.slice(slash + 1));
    byBucket.set(bucket, group);
  }
  const add = (value) => {
    if (typeof value === "string") {
      const variants = [value];
      // Decode escaped bytes locally: an unrelated "100%" in issue prose
      // must not invalidate an encoded evidence path elsewhere in the document.
      const decoded = value.replace(/(?:%[0-9a-f]{2})+/gi, (part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
      if (decoded !== value) variants.push(decoded);
      for (const variant of variants) {
        const text = canonicalKey(normalized(variant));
        for (const match of text.matchAll(/\bartifacts\/([^/\s"'`<>]+)\//gi)) {
          const suffix = text.slice(match.index + match[0].length);
          for (const [key, name] of byBucket.get(match[1]) ?? []) {
            // Match real names, including spaces/parentheses. Markdown closing
            // punctuation must not become part of an inferred directory name.
            const next = suffix[name.length];
            if (
              suffix.startsWith(name) &&
              (next === undefined || /[^\p{L}\p{N}_-]/u.test(next))
            )
              found.add(key);
          }
        }
      }
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) add(item);
    }
  };
  for (const root of context.roots) {
    const registryPath = join(root, "autorun-queue", "cluster-registry.json");
    // Missing/invalid registry in the hub is unknown, never an empty work queue.
    if (root === context.hub || existsSync(registryPath)) {
      const registry = readJson(registryPath);
      if (!Array.isArray(registry.clusters))
        throw new Error(`invalid registry: ${registryPath}`);
      for (const cluster of registry.clusters) {
        if (!["done", "resolved", "closed"].includes(cluster.status))
          add(cluster);
      }
    }
    const state = join(root, "logs", "effect-debug-loop-state.json");
    if (existsSync(state)) add(readJson(state));
    const pending = join(root, "logs", "codex-supervisor-followups", "pending");
    for (const file of filesUnder(pending))
      if (file.path.endsWith(".json")) add(readJson(file.path));
    const issues = join(root, "issues");
    if (existsSync(issues)) {
      // Active issue documents can hold evidence that has not yet been promoted.
      const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === "archive" || entry.isSymbolicLink()) continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory()) visit(path);
          else if (entry.name.endsWith(".md")) add(readFileSync(path, "utf8"));
        }
      };
      visit(issues);
    }
  }
  return { found, add };
}

function isBulkFile(run, file) {
  const rel = normalized(relative(run, file.path)).replace(/\.gz$/, "");
  // Keep summaries, tickets, configuration, model checkpoints, and small ledgers.
  // Only recognized generated payloads are disposable; arbitrary assets are not.
  return (
    file.bytes > 0 &&
    (rel.endsWith(".partial") ||
      ((rel === "replay.json" || rel.startsWith("replays/")) &&
        rel.endsWith(".json")) ||
      (rel.endsWith(".jsonl") && !rel.endsWith("tickets.jsonl")) ||
      (rel.startsWith("games/") &&
        rel.endsWith(".json") &&
        file.bytes >= 1024 ** 2))
  );
}

function emptyDirectories(run) {
  // Pruned runs cannot resume; the cleanup timestamp is not new work.
  const pruned = existsSync(join(run.path, ".storage-pruned.json"));
  if (run.reasons.some((reason) => !(pruned && reason === "recent"))) return [];
  const directories = [];
  const visit = (path) => {
    assertContained(run.root, path);
    let empty = true;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`linked artifact: ${child}`);
      if (!entry.isDirectory() || !visit(child)) empty = false;
    }
    // Keep the run itself and bucket roots, even when entirely empty.
    if (empty && path !== run.path) directories.push(path);
    return empty;
  };
  visit(run.path);
  return directories;
}

export function inspectStorage(context, now = Date.now()) {
  const config = context.policy;
  const runs = [];
  let bytes = 0,
    logicalBytes = 0;
  for (const root of context.roots) {
    const artifacts = join(root, "artifacts");
    if (!existsSync(artifacts)) continue;
    assertContained(root, artifacts);
    const inventory = filesUnder(artifacts);
    const sizes = storedFileSizes(inventory);
    inventory.forEach((file, index) => {
      file.storedBytes = sizes[index];
    });
    bytes += sizes.reduce((sum, size) => sum + size, 0);
    logicalBytes += inventory.reduce((sum, file) => sum + file.bytes, 0);
    for (const bucket of config.buckets) {
      const base = join(artifacts, bucket);
      if (!existsSync(base)) continue;
      assertContained(root, base);
      const group = [];
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new Error(`linked run: ${join(base, entry.name)}`);
        if (!entry.isDirectory()) continue;
        const path = join(base, entry.name);
        const files = inventory.filter((file) =>
          file.path.startsWith(path + sep)
        );
        const modified = Math.max(
          lstatSync(path).mtimeMs,
          ...files.map((f) => f.mtimeMs)
        );
        const bulk = files.filter((f) => isBulkFile(path, f));
        const run = {
          root,
          path,
          key: canonicalKey(`${bucket}/${entry.name}`),
          modified,
          files: bulk,
          bytes: files.reduce((sum, f) => sum + f.storedBytes, 0),
          reclaimableBytes: bulk.reduce((sum, f) => sum + f.storedBytes, 0),
          reasons: [],
        };
        if (now - modified < config.minimumAgeHours * 3600000)
          run.reasons.push("recent");
        if (liveWriter(path)) run.reasons.push("writer-active");
        if (existsSync(join(path, ".storage-pruning.json")))
          run.reasons.push("cleanup-in-progress");
        group.push(run);
      }
      group.sort((a, b) => b.modified - a.modified);
      group
        .filter((run) => !existsSync(join(run.path, ".storage-pruned.json")))
        .slice(0, config.keepLatestRuns)
        .forEach((run) => run.reasons.push("latest"));
      runs.push(...group);
    }
  }
  const { found, add } = references(context, runs);
  // Follow policy/checkpoint dependencies of every retained run, transitively.
  const expanded = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of runs) {
      if (
        (!found.has(run.key) && !run.reasons.length) ||
        expanded.has(run.path)
      )
        continue;
      expanded.add(run.path);
      changed = true;
      for (const name of ["config.json", "metrics.json", "checkpoint.json"]) {
        const file = join(run.path, name);
        if (existsSync(file)) add(readJson(file));
      }
    }
  }
  for (const run of runs)
    if (found.has(run.key)) run.reasons.push("referenced-evidence");
  for (const run of runs) run.emptyDirectories = emptyDirectories(run);
  const volumes = [
    ...new Set(
      context.roots.map((root) => {
        const stat = statfsSync(root);
        return Number(stat.bavail) * Number(stat.bsize);
      })
    ),
  ];
  const freeBytes = Math.min(...volumes);
  const status =
    bytes >= config.maximumGiB * GiB || freeBytes < config.minimumFreeGiB * GiB
      ? "blocked"
      : bytes >= config.warningGiB * GiB ||
          freeBytes < config.warningFreeGiB * GiB
        ? "warning"
        : "ok";
  const candidates = runs
    .filter((run) => !run.reasons.length && run.reclaimableBytes > 0)
    .sort((a, b) => a.modified - b.modified);
  let projectedBytes = bytes,
    projectedFree = freeBytes;
  const selected = [];
  for (const run of candidates) {
    if (
      projectedBytes <= config.targetGiB * GiB &&
      projectedFree >= config.warningFreeGiB * GiB
    )
      break;
    selected.push(run);
    projectedBytes -= run.reclaimableBytes;
    projectedFree += run.reclaimableBytes;
  }
  return {
    context,
    now,
    status,
    bytes,
    logicalBytes,
    freeBytes,
    runs,
    selected,
  };
}

export function summarizeStorage(result) {
  const protectedRuns = result.runs
    .filter((run) => run.reasons.length)
    .sort((a, b) => b.bytes - a.bytes);
  return {
    schemaVersion: 1,
    measuredAt: new Date(result.now).toISOString(),
    status: result.status,
    totalGiB: round(result.bytes),
    logicalGiB: round(result.logicalBytes),
    storageBasis:
      process.platform === "win32" ? "ntfs-stored-bytes" : "encoded-file-bytes",
    freeGiB: round(result.freeBytes),
    limits: result.context.policy,
    cleanupGiB: round(
      result.selected.reduce((sum, run) => sum + run.reclaimableBytes, 0)
    ),
    selected: result.selected.map((run) => ({
      path: run.path,
      GiB: round(run.reclaimableBytes),
      files: run.files.length,
    })),
    emptyDirectoryCount: result.runs.reduce(
      (sum, run) => sum + (run.emptyDirectories?.length ?? 0),
      0
    ),
    // The full protected list can contain every active-worktree evidence run
    // (well over PowerShell's reliable native-output size in practice). The
    // cleanup audit retains the complete deletion record; the supervisor only
    // needs a bounded diagnostic sample plus the aggregate to decide whether
    // storage repair is required.
    protectedCount: protectedRuns.length,
    protectedGiB: round(protectedRuns.reduce((sum, run) => sum + run.bytes, 0)),
    protectedTruncated: protectedRuns.length > MACHINE_PROTECTED_SAMPLE_LIMIT,
    protected: protectedRuns
      .slice(0, MACHINE_PROTECTED_SAMPLE_LIMIT)
      .map((run) => ({
        path: run.path,
        GiB: round(run.bytes),
        reasons: run.reasons,
      })),
    workerFocus:
      result.status === "ok"
        ? "storage capacity is healthy"
        : "容量整理を最優先: node scripts/artifact-storage.mjs maintain --apply を実行し、status が ok になるまで新規の大量棋譜収集をしない。保護中の棋譜・checkpointを削除せず、保護データだけで上限を超える場合は保存方式の改善を実装する。上限引き上げ・guard無効化で回避しない。",
  };
}

export function maintainStorage(context, { emptyOnly = false } = {}) {
  const logDir = join(context.hub, "logs");
  mkdirSync(logDir, { recursive: true });
  const lock = join(logDir, "artifact-storage-cleanup.lock");
  writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { flag: "wx" }
  );
  let removedBytes = 0,
    removedFiles = 0,
    removedDirectories = 0;
  try {
    const plan = inspectStorage(context);
    const auditPath = join(
      logDir,
      `artifact-storage-cleanup-${Date.now()}.jsonl`
    );
    for (const candidate of emptyOnly ? [] : plan.selected) {
      // Refresh all retention roots and their dependencies: a recent/new run may
      // acquire evidence after planning without changing the registry or state.
      const current = candidate;
      const refreshed = inspectStorage(context);
      if (
        refreshed.bytes <= context.policy.targetGiB * GiB &&
        refreshed.freeBytes >= context.policy.warningFreeGiB * GiB
      )
        break;
      const freshRun = refreshed.runs.find((run) => run.path === current.path);
      if (!freshRun || freshRun.reasons.length) continue;
      const freshFiles = filesUnder(current.path);
      if (
        freshFiles.some(
          (file) =>
            file.mtimeMs > plan.now - context.policy.minimumAgeHours * 3600000
        )
      )
        continue;
      assertContained(current.root, current.path);
      const pruning = join(current.path, ".storage-pruning.json");
      writeFileSync(pruning, JSON.stringify({ pid: process.pid }), {
        flag: "wx",
      });
      try {
        if (liveWriter(current.path)) continue;
        const record = {
          at: new Date().toISOString(),
          run: current.path,
          files: current.files.map((f) => ({
            path: relative(current.path, f.path),
            bytes: f.bytes,
            storedBytes: f.storedBytes,
          })),
        };
        appendFileSync(auditPath, JSON.stringify(record) + "\n");
        writeFileSync(
          join(current.path, ".storage-pruned.json"),
          JSON.stringify({ ...record, files: record.files.length, auditPath }) +
            "\n"
        );
        for (const file of current.files) {
          assertContained(join(current.root, "artifacts"), file.path);
          const stat = lstatSync(file.path);
          if (
            stat.size !== file.bytes ||
            stat.mtimeMs !== file.mtimeMs ||
            stat.ino !== file.ino
          ) {
            throw new Error(`artifact changed during cleanup: ${file.path}`);
          }
          unlinkSync(file.path);
          removedBytes += file.storedBytes;
          removedFiles++;
        }
      } finally {
        unlinkSync(pruning);
      }
    }
    // Sweep previous cleanups too, even below capacity limits.
    for (const run of inspectStorage(context).runs) {
      if (!run.emptyDirectories.length) continue;
      assertContained(run.root, run.path);
      const originalTimes = lstatSync(run.path);
      const pruning = join(run.path, ".storage-pruning.json");
      writeFileSync(pruning, JSON.stringify({ pid: process.pid }), {
        flag: "wx",
      });
      try {
        if (liveWriter(run.path)) continue;
        for (const path of run.emptyDirectories) {
          assertContained(run.path, path);
          if (readdirSync(path).length) continue;
          appendFileSync(
            auditPath,
            JSON.stringify({
              at: new Date().toISOString(),
              run: run.path,
              emptyDirectory: relative(run.path, path),
              runMtimeMs: originalTimes.mtimeMs,
            }) + "\n"
          );
          try {
            // Never recurse: a concurrent new file must prevent removal.
            rmdirSync(path);
            removedDirectories++;
          } catch (error) {
            if (!["ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
          }
        }
      } finally {
        unlinkSync(pruning);
        // Housekeeping must not promote an old run into latest/recent retention.
        utimesSync(run.path, originalTimes.atime, originalTimes.mtime);
      }
    }
    return {
      ...summarizeStorage(inspectStorage(context)),
      removedGiB: round(removedBytes),
      removedFiles,
      removedDirectories,
      auditPath,
    };
  } finally {
    unlinkSync(lock);
  }
}

/** Lossless Windows migration: keep filenames and logical content for old evidence references. */
export function compactStorage(context, apply = false) {
  if (process.platform !== "win32")
    throw new Error("transparent compaction requires Windows NTFS");
  const before = inspectStorage(context);
  const candidates = before.runs.filter(
    (run) =>
      !run.reasons.some((reason) =>
        ["recent", "writer-active", "cleanup-in-progress"].includes(reason)
      )
  );
  const files = candidates.flatMap((run) =>
    run.files
      .filter(
        (file) =>
          !file.path.endsWith(".gz") &&
          !file.path.endsWith(".partial") &&
          file.bytes >= 1024 ** 2 &&
          file.storedBytes > file.bytes * 0.8
      )
      .map((file) => ({ ...file, root: run.root, run: run.path }))
  );
  const plan = {
    ...summarizeStorage(before),
    compactFiles: files.length,
    compactLogicalGiB: round(files.reduce((sum, file) => sum + file.bytes, 0)),
  };
  if (!apply) return plan;
  const auditPath = join(
    context.hub,
    "logs",
    `artifact-storage-compaction-${Date.now()}.jsonl`
  );
  mkdirSync(dirname(auditPath), { recursive: true });
  let compactedFiles = 0;
  for (let i = 0; i < files.length; i += 16) {
    const batch = files.slice(i, i + 16).filter((file) => {
      assertContained(file.root, file.path);
      const stat = lstatSync(file.path);
      return (
        stat.size === file.bytes &&
        stat.mtimeMs === file.mtimeMs &&
        stat.ino === file.ino &&
        !liveWriter(file.run) &&
        !existsSync(join(file.run, ".storage-pruning.json"))
      );
    });
    if (!batch.length) continue;
    appendFileSync(
      auditPath,
      JSON.stringify({
        at: new Date().toISOString(),
        files: batch.map(({ path, bytes, storedBytes }) => ({
          path,
          bytes,
          storedBytes,
        })),
      }) + "\n"
    );
    const result = spawnSync(
      "compact.exe",
      ["/C", "/Q", ...batch.map((file) => file.path)],
      { encoding: "utf8", windowsHide: true }
    );
    if (result.error || result.status !== 0)
      throw new Error(
        "artifact compaction failed: " +
          (result.error?.message || result.stderr || result.stdout)
      );
    compactedFiles += batch.length;
  }
  const after = inspectStorage(context);
  return {
    ...summarizeStorage(after),
    compactedFiles,
    freedGiB: round(before.bytes - after.bytes),
    auditPath,
  };
}

export function checkStorage(repo) {
  const result = summarizeStorage(inspectStorage(storageContext(repo)));
  if (result.status !== "ok")
    throw new Error(
      `ARTIFACT_STORAGE_LIMIT: ${result.totalGiB} GiB artifacts; ${result.freeGiB} GiB free. ${result.workerFocus}`
    );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    const command = args[0] ?? "status";
    if (!["status", "check", "maintain", "compact"].includes(command))
      throw new Error(
        "Usage: artifact-storage.mjs status|check|maintain|compact [--apply] [--empty-only] [--repo <path>]"
      );
    const emptyOnly = args.includes("--empty-only");
    if (emptyOnly && command !== "maintain")
      throw new Error("--empty-only requires maintain");
    const repoIndex = args.indexOf("--repo");
    const context = storageContext(
      repoIndex < 0 ? undefined : args[repoIndex + 1]
    );
    const result =
      command === "compact"
        ? compactStorage(context, args.includes("--apply"))
        : command === "maintain" && args.includes("--apply")
          ? maintainStorage(context, { emptyOnly })
          : summarizeStorage(inspectStorage(context));
    if (emptyOnly) {
      result.selected = [];
      result.cleanupGiB = 0;
    }
    console.log(stringifyMachineJson(result));
    if (command === "check" && result.status !== "ok") process.exitCode = 2;
  } catch (error) {
    console.log(
      stringifyMachineJson({
        schemaVersion: 1,
        status: "error",
        workerFocus: `容量計測・整理のエラーを修正するまで大量収集を開始しない: ${error.message}`,
      })
    );
    process.exitCode = 2;
  }
}
