const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
function changedPaths(root, base = "HEAD") {
  return [
    ...new Set(
      [
        ...git(root, [
          "diff",
          "--no-renames",
          "--name-only",
          "-z",
          base,
          "--",
        ]).split("\0"),
        ...git(root, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ]).split("\0"),
      ].filter(Boolean)
    ),
  ].sort();
}
// Only known delivery/launcher metadata is excluded. Unknown ORICA_* keys,
// data roots and computational settings remain verification inputs.
const nonVerificationEnvironment = new Set([
  "NODE_REPL_NODE_MODULE_DIRS",
  "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
  "NODE_REPL_TRUSTED_CODE_PATHS",
  "NODE_REPL_TRUSTED_SERVICES",
  "ORICA_SUPERVISOR_RUN_LOG",
  "ORICA_WORK_RECOVERY_CONTEXT",
  "ORICA_INTEGRATION_REQUEST",
  "ORICA_WORKER_DELIVERY_FILE",
  "ORICA_CODEX_CLI",
  "ORICA_CODEX_FULL_RUN",
  "ORICA_CODEX_MODEL",
  "ORICA_CODEX_REASONING_EFFORT",
  "ORICA_CODEX_VERBOSITY",
  "ORICA_FULL_RUN_WORKER_REF",
  "ORICA_LANE_KIND",
]);
function isVerificationEnvironment(name) {
  if (nonVerificationEnvironment.has(name.toUpperCase())) return false;
  return /^(?:NODE_|CI$|TZ$|VITEST_|PW_|RUN_|FUZZ_|BENCH_|MCTS_|PB_|ORICA_|ORIKA_TEST_URL$|SUPABASE_|VITE_|OMP_|MKL_|OPENBLAS_)/i.test(
    name
  );
}
function sourceFingerprintDetails(root, options = {}) {
  const requiredFiles = new Set([
    ".env",
    ".env.local",
    ...[".", "apps/playground-web"].flatMap((directory) => {
      try {
        return fs
          .readdirSync(path.join(root, directory))
          .filter((name) => /^\.env(?:\.|$)/.test(name))
          .map((name) => path.posix.join(directory, name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return [];
      }
    }),
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
    ...(options.extraFiles || []),
  ]);
  const files = [
    ...new Set([
      ...git(root, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ])
        .split("\0")
        .filter(Boolean),
      ...requiredFiles,
    ]),
  ]
    .filter(
      (file) =>
        !(options.exclude || []).includes(file) && !options.excludeFile?.(file)
    )
    .sort();
  const hash = crypto.createHash("sha256");
  const components = Object.fromEntries(
    ["runtime", "environment", "files"].map((name) => [
      name,
      crypto.createHash("sha256"),
    ])
  );
  function update(component, value) {
    // Preserve the existing fingerprint byte sequence; diagnostics never relax
    // source, dependency, environment or historical-success matching.
    hash.update(value);
    components[component].update(value);
  }
  for (const value of [
    fs.realpathSync(root),
    process.version,
    process.platform,
    process.arch,
  ])
    update("runtime", value);
  // Hash values without recording secrets. npm lifecycle/Git hook variables are
  // deliberately excluded: committing identical bytes must preserve evidence.
  const environmentKeys = (
    options.includeEnvironment === false ? [] : Object.keys(process.env)
  )
    .filter(isVerificationEnvironment)
    .sort();
  for (const name of environmentKeys)
    update("environment", "\0env:" + name + "\0" + process.env[name]);
  for (const file of files) {
    const full = path.resolve(root, file);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Git lists a deleted tracked path until it is staged/committed. The
      // absent source is identical on both sides; required external inputs keep
      // their explicit missing marker even when absent from the Git index.
      if (!requiredFiles.has(file)) continue;
    }
    update("files", "\0" + file + "\0");
    if (!stat) {
      update("files", "<deleted>");
      continue;
    }
    try {
      update("files", String(stat.mode));
      update(
        "files",
        stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full)
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      update("files", "<deleted>");
    }
  }
  return {
    fingerprint: hash.digest("hex"),
    components: Object.fromEntries(
      Object.entries(components).map(([name, component]) => [
        name,
        component.digest("hex"),
      ])
    ),
    environmentKeys,
  };
}
function sourceFingerprint(root, options = {}) {
  return sourceFingerprintDetails(root, options).fingerprint;
}
// Preserve the acceptance digest format while sharing the same input policy
// with ordinary verification. Delivery changes cannot invalidate either proof.
function followupFingerprint(root, options = {}) {
  const environment = Object.entries(process.env)
    .filter(([name]) => isVerificationEnvironment(name))
    .sort(([a], [b]) => a.localeCompare(b));
  return crypto
    .createHash("sha256")
    .update(sourceFingerprint(root, { ...options, includeEnvironment: false }))
    .update(JSON.stringify(environment))
    .digest("hex");
}
// Shared by gate reuse and consumers that validate the original fresh run.
function gateInputsMatch(previous, current, id, inputScope) {
  if (
    typeof previous.fingerprint === "string" &&
    previous.fingerprint === current.fingerprint
  )
    return true;
  const input = current.gateInputs?.[id];
  return (
    inputScope === "operational-fixtures-v1" &&
    typeof input === "string" &&
    /^[a-f0-9]{64}$/.test(input) &&
    previous.gateInputs?.[id] === input
  );
}
function changedLines(root, file, base = "HEAD", tree) {
  const diff = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--no-renames",
    "--unified=0",
    base,
    ...(tree === undefined ? [] : [tree]),
    "--",
    file,
  ]);
  let inHunk = false;
  const lines = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && /^[+-]/.test(line)) lines.push(line.slice(1));
  }
  return lines;
}
function pushChanges(root, input) {
  if (input === undefined) {
    let upstream;
    try {
      upstream = git(root, ["rev-parse", "--verify", "@{upstream}"]).trim();
    } catch {
      // No known base: never mistake a clean checkout for a docs-only push.
      return { paths: null, bases: [] };
    }
    return { paths: changedPaths(root, upstream), bases: [upstream] };
  }
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const changed = new Set();
  const bases = new Set();
  let unknownBase = false;
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (
      fields.length !== 4 ||
      ![fields[1], fields[3]].every((sha) =>
        /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sha)
      )
    )
      throw new Error("Invalid pre-push ref input");
    const [, localSha, , remoteSha] = fields;
    if (/^0+$/.test(localSha)) continue; // Deleting a remote ref has no source.
    if (git(root, ["rev-parse", localSha + "^{commit}"]).trim() !== head)
      throw new Error("Check out the pushed commit before verifying it");
    if (changedPaths(root).length)
      throw new Error(
        "Push verification requires the committed tree; finish or isolate working changes first"
      );
    if (/^0+$/.test(remoteSha)) {
      unknownBase = true;
      continue;
    }
    try {
      git(root, ["cat-file", "-e", remoteSha + "^{commit}"]);
    } catch {
      unknownBase = true;
      continue;
    }
    for (const file of changedPaths(root, remoteSha)) changed.add(file);
    bases.add(remoteSha);
  }
  return { paths: unknownBase ? null : [...changed].sort(), bases: [...bases] };
}
function pushChangedPaths(root, input) {
  return pushChanges(root, input).paths;
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function sessionPath(root, input) {
  const key = crypto
    .createHash("sha256")
    .update(
      (input.session_id || "unknown") + "/" + (input.turn_id || "session")
    )
    .digest("hex");
  return path.join(root, "logs", "harness", "sessions", key + ".json");
}
function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return fallback;
  }
}
module.exports = {
  git,
  changedPaths,
  sourceFingerprint,
  sourceFingerprintDetails,
  followupFingerprint,
  isVerificationEnvironment,
  pushChangedPaths,
  pushChanges,
  changedLines,
  gateInputsMatch,
  atomicJson,
  sessionPath,
  readJson,
};
