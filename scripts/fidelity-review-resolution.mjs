#!/usr/bin/env node
/**
 * Evidence-bound review dispositions. A record never resolves a violation.
 * Callers supply the current full face and a nonempty contextFingerprint covering
 * detector/runtime/ruling/test configuration. The registry loader belongs to the
 * caller; malformed input fails closed here. No card-number exemptions exist.
 *
 * testRefs must be ordinary-gate regressions: packages/apps Vitest test files, or
 * scripts/test-*.mjs reached by literal node commands in package.json's test chain.
 * Files are hashed, not executed here; the reviewer must run their regression gate.
 *
 * Single-record CLI (does not update a registry):
 * node scripts/fidelity-review-resolution.mjs --report report.json
 *   --collection auditIssues --index 0 --face face.json --context-fingerprint HASH
 *   --reason "source and behavior comparison" --evidence manual/ruling.md
 *   --test-ref packages/rules-core/test/example.test.ts --out record.json
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import ts from "typescript";
import { reviewRuntimeInputs } from "./review-runtime-inputs.mjs";
import { auditContentHash } from "./audit-inputs.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configDefaults } from "vitest/config";

// Use Vitest's installed matcher and defaults, rather than copying its exclusion
// list. The caller's context fingerprint includes the lockfile and test settings.
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const excludedByVitest = vitestRequire("picomatch")(configDefaults.exclude, {
  dot: true,
});

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const validHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = (message) => {
  throw new Error(message);
};

// JSON object order is immaterial; array order and all defined face fields matter.
// Unsupported values fail closed instead of silently discarding implementation.
function canonical(value, parents = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (!object(value) && !Array.isArray(value))
    fail("Fingerprint input must contain JSON-compatible values.");
  if (parents.has(value)) fail("Fingerprint input contains a cycle.");
  if (
    object(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("Fingerprint input contains a non-JSON object.");
  const next = new Set([...parents, value]);
  if (Array.isArray(value))
    return `[${Array.from(value, (item) => canonical(item, next)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key], next)}`)
    .join(",")}}`;
}

function identity(face, finding) {
  if (!object(face) || !nonempty(face.cardNo) || !Array.isArray(face.textLines))
    fail("A full card face with cardNo and textLines is required.");
  if (!object(finding) || finding.severity !== "review")
    fail("Only review findings can be resolved.");
  if (finding.cardNo !== face.cardNo)
    fail("Finding and face cardNo must match exactly.");
  if (!nonempty(finding.kind) || !nonempty(finding.path ?? finding.effectPath))
    fail("Finding kind and path are required.");
  if (
    !(
      nonempty(finding.evidence) ||
      (object(finding.evidence) && Object.keys(finding.evidence).length)
    )
  )
    fail("Finding evidence is required.");
  return {
    cardNo: finding.cardNo,
    severity: finding.severity,
    kind: finding.kind,
    path: finding.path ?? null,
    effectPath: finding.effectPath ?? null,
    textRef: finding.textRef ?? null,
    evidence: finding.evidence,
    detail: finding.detail ?? finding.message ?? null,
    auditFamily: finding.auditFamily ?? null,
  };
}

export function fingerprintReview({ face, finding }) {
  return hash(
    canonical({ schemaVersion: 1, face, finding: identity(face, finding) })
  );
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function repoFile(repoRoot, ref) {
  if (
    !nonempty(ref) ||
    ref.includes(":") ||
    ref.includes("\0") ||
    isAbsolute(ref) ||
    win32.isAbsolute(ref)
  )
    fail("Evidence paths must be repository-relative.");
  const root = realpathSync(repoRoot);
  const file = resolve(root, ref);
  if (!inside(root, file)) fail(`Path leaves the repository: ${ref}`);
  const physical = realpathSync(file);
  if (!inside(root, physical))
    fail(`Resolved path leaves the repository: ${ref}`);
  if (!statSync(physical).isFile()) fail(`Evidence is not a file: ${ref}`);
  return { path: relative(root, file).replaceAll("\\", "/"), file: physical };
}

// Deliberately narrow: interpolation, shell variables, conditionals and arbitrary
// wrappers cannot prove that a script is a normal-gate regression.
function gateRoutes(repoRoot) {
  const { file } = repoFile(repoRoot, "package.json");
  const scripts = JSON.parse(readFileSync(file, "utf8")).scripts;
  const found = new Map();
  function add(target, route) {
    found.set(target, [...(found.get(target) ?? []), route]);
  }
  function nodeTarget(file) {
    if (file === "scripts/vitest-with-jest-aliases.mjs") return "vitest";
    if (/^scripts\/test-[A-Za-z0-9_.-]+\.mjs$/.test(file)) return file;
    return null;
  }
  function visit(name, trail = [], parents = new Set()) {
    if (parents.has(name) || !nonempty(scripts?.[name])) return;
    // Hooks can mutate regression inputs through arbitrary/transitive commands.
    // Until their dependency closure is supported, reject the whole route.
    if (
      Object.hasOwn(scripts, `pre${name}`) ||
      Object.hasOwn(scripts, `post${name}`)
    )
      return;
    const next = new Set([...parents, name]);
    const commandLine = scripts[name];
    const route = [
      ...trail,
      {
        script: name,
        command: commandLine,
      },
    ];
    if (commandLine === "vitest run") {
      add("vitest", route);
      return;
    }
    if (commandLine === "node scripts/harness/run-gates.mjs --profile test") {
      // Read the same declarative manifest as the runner, never execute repo code.
      const manifest = JSON.parse(
        readFileSync(
          repoFile(repoRoot, "scripts/harness/gate-manifest.json").file,
          "utf8"
        )
      );
      if (!Array.isArray(manifest.testGates) || !manifest.gates)
        fail("Invalid test gate manifest");
      for (const id of manifest.testGates) {
        const gate = manifest.gates[id];
        if (!gate) fail(`Unknown test gate: ${id}`);
        // Selected args/filtering cannot establish a full normal regression.
        // Preserve the complete selected gate contract; unrelated gate entries
        // and finish/push scopes do not participate in this proof.
        if (gate.args?.length || gate.diffBase || gate.changedFiles) continue;
        const gateRoute = [...route, { gate: id, contract: gate }];
        // Match run-gates precedence: node, then bin, then package script.
        if (gate.node) {
          const target = typeof gate.node === "string" && nodeTarget(gate.node);
          if (target) add(target, gateRoute);
        } else if (!gate.bin && gate.script)
          visit(gate.script, gateRoute, next);
      }
      return;
    }
    // A quoted string can contain apparent `&& node ... &&` commands. Do not
    // tokenize any shell quoting, escaping, expansion or compound statements.
    if (
      /["'`\\$;|<>(){}\r\n%^!#]/.test(commandLine) ||
      commandLine.replaceAll("&&", "").includes("&")
    )
      return;
    const commands = commandLine.split("&&");
    // A single package alias has one traceable execution chain. In a mixed
    // command list, sibling aliases/preparation commands have dependencies that
    // cannot be proved by independently visiting the selected regression.
    const alias = /^\s*pnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)\s*$/.exec(
      commandLine
    );
    if (alias) {
      visit(alias[1], route, next);
      return;
    }
    if (
      !commands.every((command) => {
        const node = /^\s*node\s+(scripts\/[A-Za-z0-9_.-]+\.mjs)\s*$/.exec(
          command
        );
        return node && nodeTarget(node[1]);
      })
    )
      return;
    for (const command of commands) {
      const node = /^\s*node\s+(scripts\/[A-Za-z0-9_.-]+\.mjs)\s*$/.exec(
        command
      );
      if (node && nodeTarget(node[1])) add(nodeTarget(node[1]), route);
    }
  }
  visit("test");
  return found;
}

function testFile(repoRoot, ref) {
  const result = repoFile(repoRoot, ref);
  const vitest =
    /^(?:packages|apps)\/(?:[^/]+\/)+test\/(?:[^/]+\/)*[^/]+\.test\.ts$/.test(
      result.path
    );
  if (
    !(
      vitest &&
      !excludedByVitest(result.path) &&
      gateRoutes(repoRoot).has("vitest")
    ) &&
    !gateRoutes(repoRoot).has(result.path)
  )
    fail(`testRef is not a known normal-gate regression: ${result.path}`);
  return result;
}

// Keep execution evidence local to the selected tests. This is intentionally
// separate from source/evidence hashes: a removed or narrowed gate is stale
// even when the regression file itself has not changed.
function snapshotTestExecution(repoRoot, refs) {
  const routes = gateRoutes(repoRoot);
  return [...new Set(refs)].sort().map((ref) => {
    const { path } = testFile(repoRoot, ref);
    const vitest = /\.test\.ts$/.test(path);
    const execution = routes.get(vitest ? "vitest" : path);
    // Normal script regressions can launch this runner via child_process (for
    // example test-harness), outside the literal-import support closure. Keep
    // the shared execution floor for them too; extension is not a dependency proof.
    const files = [
      "vitest.config.ts",
      "scripts/vitest-with-jest-aliases.mjs",
    ].map((ref) => {
      if (!existsSync(resolve(repoRoot, ref)))
        return { path: ref, missing: true };
      const { path, file } = repoFile(repoRoot, ref);
      return { path, sha256: auditContentHash(readFileSync(file)) };
    });
    return { path, sha256: hash(canonical({ execution, files })) };
  });
}

function snapshotRefs(repoRoot, refs, test) {
  if (!Array.isArray(refs) || !refs.length || !refs.every(nonempty))
    fail(
      `${test ? "testRefs" : "evidenceRefs"} must contain repository file references.`
    );
  const snapshots = refs.map((ref) => {
    const { path, file } = test
      ? testFile(repoRoot, ref)
      : repoFile(repoRoot, ref);
    return { path, sha256: auditContentHash(readFileSync(file)) };
  });
  return [
    ...new Map(snapshots.map((entry) => [entry.path, entry])).values(),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

// Bind shared helpers/fixtures in the selected test suites, not every unrelated
// regression in the repository. Follow literal local imports too (including
// tests importing another test). Runtime API is covered globally; other engine entries are followed here.
function snapshotTestSupport(repoRoot, refs, proofCache = {}) {
  proofCache.runtimeFiles ??= new Set(reviewRuntimeInputs(repoRoot).files);
  proofCache.inventories ??= new Map();
  proofCache.closures ??= new Map();
  const selected = new Set(refs.map((ref) => testFile(repoRoot, ref).path));
  const dependencies = new Set();
  const coreEntries = new Set();
  const visited = new Set();
  let opaqueLoader = false;
  const regression = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
  function visit(ref) {
    const { path, file } = repoFile(repoRoot, ref);
    if (visited.has(path)) return;
    visited.add(path);
    if (!selected.has(path)) dependencies.add(path);
    if (!/\.[cm]?[jt]sx?$/.test(path)) return;
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) opaqueLoader = true;
    function inspect(node) {
      if (
        (ts.isIdentifier(node) &&
          ["require", "eval", "Function"].includes(node.text)) ||
        ts.isMetaProperty(node) ||
        (ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          (node.arguments.length !== 1 ||
            !ts.isStringLiteral(node.arguments[0])))
      )
        opaqueLoader = true;
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const { fileName } of imports) {
      if (fileName === "@orica/rules-core") {
        coreEntries.add("packages/rules-core/src/index.ts");
        continue;
      }
      if (!fileName.startsWith(".")) {
        if (!["vitest", "@orica/card-data"].includes(fileName))
          opaqueLoader = true;
        continue;
      }
      // TypeScript can substitute source for a JavaScript specifier.
      if (/\.[cm]?js$/.test(fileName)) opaqueLoader = true;
      const base = resolve(dirname(file), fileName);
      const candidates = [
        base,
        base.replace(/\.js$/, ".ts"),
        ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"].map(
          (suffix) => base + suffix
        ),
      ];
      const found = candidates.find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile()
      );
      if (!found)
        throw new Error(`Unresolved test dependency: ${path}: ${fileName}`);
      const dependency = relative(repoRoot, found).replaceAll("\\", "/");
      // Runtime API is globally bound. Tests reaching other engine entries bind
      // those transitive dependencies too; barrel imports deliberately stay broad.
      if (/^packages\/rules-core\/(?:src|dist)\//.test(dependency)) {
        coreEntries.add(
          dependency.includes("/dist/")
            ? "packages/rules-core/src/index.ts"
            : dependency
        );
        continue;
      }
      // Card definitions retain the existing face-local contract.
      if (
        /^packages\/(?:card-data\/(?:src|dist)|rules-core\/dist)\//.test(
          dependency
        )
      )
        continue;
      visit(dependency);
    }
  }
  function inventory(suite) {
    if (proofCache.inventories.has(suite))
      return proofCache.inventories.get(suite);
    const files = [];
    function collect(ref) {
      const full = resolve(repoRoot, ref);
      if (
        !inside(realpathSync(repoRoot), realpathSync(full)) ||
        lstatSync(full).isSymbolicLink()
      )
        throw new Error(
          `Test support leaves repository or follows symlink: ${ref}`
        );
      if (statSync(full).isDirectory()) {
        for (const name of readdirSync(full).sort()) collect(`${ref}/${name}`);
      } else files.push(ref);
    }
    collect(suite);
    proofCache.inventories.set(suite, files);
    return files;
  }
  for (const ref of selected) visit(ref);
  const suites = new Set(
    [...selected].map((ref) => /^(.*?\/test)\//.exec(ref)?.[1]).filter(Boolean)
  );
  for (const suite of suites) {
    // Opaque loaders can import regressions too; never guess a dynamic target.
    for (const ref of inventory(suite))
      if (
        opaqueLoader ||
        (!regression.test(ref) && !/\.[cm]?[jt]sx?$/.test(ref))
      )
        visit(ref);
  }
  // The shared runtime hash already covers these files. Follow only additional
  // engine entrypoints (e.g. the public AI barrel) and share that parse per audit.
  const additional = [...coreEntries]
    .filter((ref) => !proofCache.runtimeFiles.has(ref))
    .sort();
  if (additional.length || opaqueLoader) {
    const key = JSON.stringify([opaqueLoader, additional]);
    if (!proofCache.closures.has(key))
      proofCache.closures.set(
        key,
        reviewRuntimeInputs(repoRoot, additional, {
          conservative: opaqueLoader,
        }).files
      );
    for (const ref of proofCache.closures.get(key))
      if (!proofCache.runtimeFiles.has(ref)) dependencies.add(ref);
  }
  return [...dependencies].sort().map((ref) => {
    const { path, file } = repoFile(repoRoot, ref);
    return { path, sha256: auditContentHash(readFileSync(file)) };
  });
}

export function createReviewResolution({
  repoRoot,
  face,
  finding,
  contextFingerprint,
  reason,
  evidenceRefs,
  testRefs,
  disposition = "confirmed_correct",
}) {
  if (!nonempty(contextFingerprint)) fail("contextFingerprint is required.");
  if (!nonempty(reason)) fail("A concrete review reason is required.");
  if (disposition !== "confirmed_correct")
    fail("Only confirmed_correct review dispositions can be recorded.");
  return {
    schemaVersion: 3,
    fingerprint: fingerprintReview({ face, finding }),
    contextFingerprint,
    cardNo: face.cardNo,
    kind: finding.kind,
    path: finding.path ?? finding.effectPath,
    disposition: "confirmed_correct",
    reason,
    evidenceRefs: snapshotRefs(repoRoot, evidenceRefs, false),
    testRefs: snapshotRefs(repoRoot, testRefs, true),
    testSupport: snapshotTestSupport(repoRoot, testRefs),
    testExecution: snapshotTestExecution(repoRoot, testRefs),
  };
}

function validRecord(record) {
  const refs = (values) =>
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(
      (value) =>
        object(value) && nonempty(value.path) && validHash(value.sha256)
    );
  return (
    object(record) &&
    [1, 2, 3].includes(record.schemaVersion) &&
    validHash(record.fingerprint) &&
    nonempty(record.contextFingerprint) &&
    nonempty(record.cardNo) &&
    nonempty(record.kind) &&
    nonempty(record.path) &&
    record.disposition === "confirmed_correct" &&
    nonempty(record.reason) &&
    refs(record.evidenceRefs) &&
    refs(record.testRefs) &&
    (record.schemaVersion === 1 ||
      (Array.isArray(record.testSupport) &&
        record.testSupport.every(
          (value) =>
            object(value) && nonempty(value.path) && validHash(value.sha256)
        ))) &&
    (record.schemaVersion !== 3 || refs(record.testExecution))
  );
}

/** Never removes a finding. Consumers retain its evidence and attach this status. */
export function resolveReview({
  repoRoot,
  face,
  finding,
  contextFingerprint,
  registry,
  proofCache,
}) {
  let fingerprint = null;
  const pending = (reason, errors = []) => ({
    status: "pending",
    fingerprint,
    reason,
    errors,
    previouslyReviewed:
      Array.isArray(registry?.records) &&
      registry.records.some(
        (record) =>
          record?.cardNo === face?.cardNo &&
          record?.kind === finding?.kind &&
          record?.path === (finding?.path ?? finding?.effectPath)
      ),
  });
  if (finding?.severity !== "review") return pending("not_review");
  try {
    fingerprint = fingerprintReview({ face, finding });
  } catch (error) {
    return pending("invalid_finding", [error.message]);
  }
  if (!nonempty(contextFingerprint)) return pending("context_missing");
  if (registry === undefined || registry === null)
    return pending("registry_missing");
  if (
    !object(registry) ||
    registry.schemaVersion !== 1 ||
    !Array.isArray(registry.records) ||
    !registry.records.every(validRecord)
  )
    return pending("registry_invalid");
  const matches = registry.records.filter(
    (record) => record.fingerprint === fingerprint
  );
  if (matches.length === 0) return pending("unregistered");
  if (matches.length !== 1) return pending("duplicate_records");
  const record = matches[0];
  if (record.schemaVersion !== 3) return pending("legacy_context");
  if (
    record.cardNo !== face.cardNo ||
    record.kind !== finding.kind ||
    record.path !== (finding.path ?? finding.effectPath)
  )
    return pending("record_identity_mismatch");
  if (record.contextFingerprint !== contextFingerprint)
    return pending("context_changed");
  for (const [name, test] of [
    ["evidenceRefs", false],
    ["testRefs", true],
  ]) {
    try {
      const current = snapshotRefs(
        repoRoot,
        record[name].map(({ path }) => path),
        test
      );
      if (
        canonical(current) !==
        canonical(
          [...record[name]].sort((a, b) => a.path.localeCompare(b.path))
        )
      )
        return pending(`${name}_changed`);
    } catch (error) {
      return pending(`${name}_unavailable`, [error.message]);
    }
  }
  try {
    const execution = snapshotTestExecution(
      repoRoot,
      record.testRefs.map(({ path }) => path)
    );
    if (canonical(execution) !== canonical(record.testExecution))
      return pending("testExecution_changed");
  } catch (error) {
    return pending("testExecution_unavailable", [error.message]);
  }
  try {
    const support = snapshotTestSupport(
      repoRoot,
      record.testRefs.map(({ path }) => path),
      proofCache
    );
    if (canonical(support) !== canonical(record.testSupport))
      return pending("testSupport_changed");
  } catch (error) {
    return pending("testSupport_unavailable", [error.message]);
  }
  return {
    status: "confirmed_correct",
    fingerprint,
    reason: record.reason,
    record,
  };
}

function parseArgs(args) {
  const options = { evidenceRefs: [], testRefs: [] };
  const keys = {
    "--report": "report",
    "--collection": "collection",
    "--index": "index",
    "--face": "face",
    "--context-fingerprint": "contextFingerprint",
    "--reason": "reason",
    "--out": "out",
    "--repo-root": "repoRoot",
  };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!nonempty(value)) fail(`Missing value for ${key}`);
    if (key === "--evidence") options.evidenceRefs.push(value);
    else if (key === "--test-ref") options.testRefs.push(value);
    else if (keys[key] && options[keys[key]] === undefined)
      options[keys[key]] = value;
    else fail(`Unknown or repeated option: ${key}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const key of [
    "report",
    "collection",
    "index",
    "face",
    "contextFingerprint",
    "reason",
    "out",
  ])
    if (!nonempty(options[key])) fail(`Missing required option: ${key}`);
  if (
    !["auditIssues", "semanticReviews", "issues"].includes(options.collection)
  )
    fail("Unsupported finding collection.");
  if (!/^(?:0|[1-9][0-9]*)$/.test(options.index))
    fail("index must identify exactly one finding.");
  const report = JSON.parse(readFileSync(resolve(options.report), "utf8"));
  const collection = report[options.collection];
  if (!Array.isArray(collection) || Number(options.index) >= collection.length)
    fail("Finding index is outside the report collection.");
  const record = createReviewResolution({
    ...options,
    repoRoot:
      options.repoRoot ??
      resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    face: JSON.parse(readFileSync(resolve(options.face), "utf8")),
    finding: collection[Number(options.index)],
  });
  // Never overwrite another disposition or a registry with a generated single record.
  writeFileSync(resolve(options.out), `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({ output: resolve(options.out), fingerprint: record.fingerprint })}\n`
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
