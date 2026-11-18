#!/usr/bin/env node
/**
 * node scripts/gate-evidence.mjs --paths <regex> [--gate id,...] [--json]
 *
 * Evidence for classifying a path group: which gates can observe it. For each
 * gate it follows the entry scripts' static/dynamic imports, require() calls,
 * `new URL(.., import.meta.url)` and every string literal that names an existing
 * repo file or directory (spawn/readFileSync/readdirSync arguments), and
 * reports whether any file in that closure imports or names the target paths.
 *
 *   reaches     the closure names/imports a target (chain printed)
 *   unreached   closure fully resolved and names no target. Static evidence
 *               only (確度B): non-literal paths are counted in `dynamic`.
 *   inherent    the gate is a whole-repo tool (tsc, eslint, prettier, vitest,
 *               gitleaks) that reads every tracked file by construction.
 *
 * A directory named by a literal puts every file below it in the closure, so
 * `readdirSync("scripts")` correctly reaches scripts, and a mention of a
 * target's directory (e.g. "apps/playground-web/server") reaches the target.
 * Reads only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gates } from "./harness/gate-manifest.mjs";
import { trackedPaths } from "./harness/path-classification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INHERENT = new Set([
  "format",
  "lint",
  "types",
  "vitest",
  "focused-vitest",
  "secrets",
  "changed-style",
  "build",
  "public-build",
  "saved-deck-types",
]);
const EXT = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".ps1", ""];
const TEXT = /\.(?:[cm]?[jt]sx?|json|ps1|cmd|sh)$/;
const aliases = new Map(
  readdirSync(join(root, "packages")).flatMap((dir) => {
    const file = join(root, "packages", dir, "package.json");
    if (!existsSync(file)) return [];
    const name = JSON.parse(readFileSync(file, "utf8")).name;
    return [[name, join(root, "packages", dir, "src/index.ts")]];
  })
);
const packageScripts = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
).scripts;
const textCache = new Map();
function textOf(file) {
  if (!textCache.has(file))
    textCache.set(
      file,
      isFile(file) && TEXT.test(file)
        ? readFileSync(file, "utf8").replaceAll("\\\\", "/")
        : ""
    );
  return textCache.get(file);
}
const toRel = (file) => relative(root, file).replaceAll("\\", "/");
const isFile = (p) => existsSync(p) && statSync(p).isFile();

const resolveCache = new Map();
function resolveSpec(spec, from) {
  // Non-relative specs also try the importer's directory, so the importer is part of the key.
  const key = dirname(from) + "|" + spec;
  if (!resolveCache.has(key))
    resolveCache.set(key, resolveSpecUncached(spec, from));
  return resolveCache.get(key);
}
function resolveSpecUncached(spec, from) {
  if (aliases.has(spec)) return aliases.get(spec);
  const bases = spec.startsWith(".")
    ? [resolve(dirname(from), spec)]
    : [resolve(root, spec), resolve(dirname(from), spec)];
  for (const base of bases)
    for (const ext of EXT) {
      if (isFile(base + ext)) return base + ext;
      if (ext && isFile(join(base, "index" + ext)))
        return join(base, "index" + ext);
    }
  for (const base of bases)
    if (existsSync(base) && statSync(base).isDirectory()) return base;
  return null;
}

function literals(text) {
  const found = new Set();
  for (const m of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\r\n$]){2,200})\1/g))
    if (/[/.]/.test(m[2]) && !/[\s*?<>|]/.test(m[2])) found.add(m[2]);
  return found;
}

function dynamicCount(text) {
  return text.match(/\b(?:import|require)\s*\(\s*[^"'`\s)]/g)?.length ?? 0;
}

function entriesOf(id, seen = new Set()) {
  const gate = gates[id];
  if (gate.node)
    return [gate.node, ...(gate.args ?? []).filter((a) => /[./]/.test(a))];
  if (gate.bin === "playwright")
    return [
      ...(gate.args ?? []).filter((a) => /[./]/.test(a)),
      "playwright.config.ts",
      "playwright.local.config.ts",
    ];
  if (gate.script) return scriptEntries(gate.script, seen);
  return [];
}

function scriptEntries(name, seen) {
  if (seen.has(name)) return [];
  seen.add(name);
  const command = packageScripts[name] ?? "";
  const out = [];
  for (const nested of command.matchAll(/(?:pnpm|npm) (?:run )?([\w:-]+)/g))
    out.push(...scriptEntries(nested[1], seen));
  for (const token of command.split(/\s+/))
    if (/[./]/.test(token) && !token.startsWith("-")) out.push(token);
  return out;
}

export function closureOf(entries) {
  const files = new Map(); // abs path -> parent abs path
  const dirs = new Set();
  const queue = [];
  let dynamic = 0;
  const add = (abs, parent) => {
    // Tool packages are opaque: the gate is its entry file, not its dependencies.
    if (!abs || files.has(abs) || /[\\/]node_modules[\\/]/.test(abs)) return;
    files.set(abs, parent);
    if (isFile(abs)) queue.push(abs);
    else dirs.add(abs);
  };
  for (const entry of entries) add(resolveSpec(entry, join(root, "x")), null);
  while (queue.length) {
    const file = queue.pop();
    if (!TEXT.test(file)) continue;
    const text = textOf(file);
    dynamic += dynamicCount(text);
    for (const literal of literals(text)) {
      const target = resolveSpec(literal, file);
      if (target) add(target, file);
    }
  }
  return { files, dirs, dynamic };
}

export function reach(gateId, targets) {
  if (INHERENT.has(gateId)) return { status: "inherent" };
  const { files, dirs, dynamic } = closureOf(entriesOf(gateId));
  const hits = [];
  for (const target of targets) {
    const abs = resolve(root, target);
    // The repo root and top-level folders ("." , "apps") name the working
    // directory in nearly every script, so they are not evidence of a scan;
    // they are reported as broadDirs for the reviewer instead.
    const viaDir = [...dirs].find(
      (dir) =>
        toRel(dir).split("/").length >= 2 &&
        (abs.startsWith(dir + "\\") || abs.startsWith(dir + "/"))
    );
    if (files.has(abs) || viaDir) {
      hits.push({
        target,
        via: viaDir ? `dir ${toRel(viaDir)}` : "import/name",
      });
      continue;
    }
    // A closure file naming the target's directory or path as a string.
    const dir = toRel(dirname(abs));
    const namer = [...files.keys()].find((file) => {
      const text = textOf(file);
      return text.includes(target) || text.includes(dir + "/");
    });
    if (namer) hits.push({ target, via: `names it in ${toRel(namer)}` });
  }
  const broadDirs = [...dirs]
    .map(toRel)
    .filter((dir) => dir.split("/").length < 2)
    .sort();
  return {
    status: hits.length ? "reaches" : "unreached",
    broadDirs,
    closureFiles: files.size,
    dynamic,
    hits: hits.slice(0, 5),
    hitCount: hits.length,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  if (!args.includes("--paths") || !value("--paths"))
    throw new Error("--paths <regex> is required");
  const pattern = new RegExp(value("--paths"));
  const targets = trackedPaths(root).filter((file) => pattern.test(file));
  if (targets.length === 0)
    throw new Error(
      `no tracked path matches ${pattern}; "unreached" would be vacuous`
    );
  const ids = args.includes("--gate")
    ? value("--gate").split(",")
    : Object.keys(gates).filter((id) => !id.startsWith("scenario-file-"));
  const report = { paths: targets.length, gates: {} };
  for (const id of ids) report.gates[id] = reach(id, targets);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${targets.length} path(s) match ${pattern}`);
    for (const [id, r] of Object.entries(report.gates))
      console.log(
        `${id.padEnd(26)} ${r.status.padEnd(9)}` +
          (r.status === "unreached"
            ? ` closure=${r.closureFiles} dynamic=${r.dynamic}`
            : r.status === "reaches"
              ? ` ${r.hitCount}/${targets.length} e.g. ${r.hits[0].target} <- ${r.hits[0].via}`
              : "")
      );
  }
}
