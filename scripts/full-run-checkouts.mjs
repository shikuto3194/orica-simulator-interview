import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectPrimaryMain, inspectGitOperation } from "./primary-main.mjs";

function git(root, ...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return execFileSync("git", ["-C", root, ...args], {
    env,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}
const canonical = (path) => realpathSync(path);

function commonDirectory(repo) {
  return canonical(
    git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
  );
}

// Locate the shared hub without requiring main to be healthy. Monitoring must
// still report a broken integration checkout through its structured snapshot.
export function sharedRepositoryRoot(repo) {
  return dirname(commonDirectory(repo));
}

// Resolve from Git's registered main checkout, never from the interactive HEAD.
// No automatic switch, worktree creation, stash or ref update is performed here.
export function integrationCheckout(repo) {
  const common = commonDirectory(repo);
  const primary = dirname(common);
  const entries = git(repo, "worktree", "list", "--porcelain", "-z")
    .split("\0\0")
    .filter(Boolean)
    .map((entry) => entry.split("\0"));
  const owners = entries.filter((entry) =>
    entry.includes("branch refs/heads/main")
  );
  if (owners.length !== 1)
    throw new Error(
      "main must have exactly one registered integration checkout"
    );
  const owner = owners[0];
  if (owner.some((line) => /^(?:locked|prunable)(?: |$)/.test(line)))
    throw new Error("main integration checkout is locked or prunable");
  const mainWorktree = canonical(owner[0].slice("worktree ".length));
  const configFile = join(mainWorktree, "scripts/full-run-checkouts.json");
  const config = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8"))
    : null;
  if (
    config &&
    (config.schemaVersion !== 1 ||
      config.integrationRef !== "refs/heads/main" ||
      typeof config.workerRef !== "string" ||
      !config.workerRef.startsWith("refs/heads/") ||
      config.workerRef === config.integrationRef ||
      typeof config.workerWorktree !== "string" ||
      typeof config.integrationWorktree !== "string")
  )
    throw new Error("Invalid full-run checkout configuration");
  const integrationWorktree = config
    ? canonical(resolve(primary, config.integrationWorktree))
    : mainWorktree;
  if (integrationWorktree !== mainWorktree)
    throw new Error(
      "Configured integration checkout does not own refs/heads/main; preserve its current branch"
    );
  if (
    canonical(
      git(
        integrationWorktree,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir"
      )
    ) !== common
  )
    throw new Error("Integration checkout belongs to another repository");
  return {
    repo: primary,
    integrationWorktree,
    integrationRef: "refs/heads/main",
    workerWorktree: config
      ? canonical(resolve(primary, config.workerWorktree))
      : null,
    workerRef: config?.workerRef || null,
    configured: Boolean(config),
  };
}

export function assertFullRunWorker(repo, workdir) {
  const targets = integrationCheckout(repo);
  if (!targets.configured)
    throw new Error("Full-run checkout configuration is missing from main");
  if (
    canonical(workdir) !== targets.workerWorktree ||
    canonical(workdir) === canonical(targets.repo) ||
    canonical(workdir) === targets.integrationWorktree ||
    canonical(
      git(workdir, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ) !==
      canonical(
        git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
      ) ||
    git(workdir, "symbolic-ref", "HEAD") !== targets.workerRef
  )
    throw new Error(
      "Full-run worker checkout/ref does not match the configured lane"
    );
  const registered = git(repo, "worktree", "list", "--porcelain", "-z")
    .split("\0\0")
    .find((entry) => entry.split("\0").includes(`branch ${targets.workerRef}`));
  if (
    !registered ||
    registered
      .split("\0")
      .some((line) => /^(?:locked|prunable)(?: |$)/.test(line))
  )
    throw new Error(
      "Full-run worker checkout is unregistered, locked or prunable"
    );
  const operation = inspectGitOperation(workdir);
  if (operation)
    throw new Error(`Worker Git operation in progress: ${operation}`);
  return targets;
}

export function inspectIntegrationCheckout(repo) {
  const targets = integrationCheckout(repo);
  return { ...targets, ...inspectPrimaryMain(targets.integrationWorktree) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    const repo = args.includes("--repo")
      ? args[args.indexOf("--repo") + 1]
      : process.cwd();
    const targets = args.includes("--worker")
      ? assertFullRunWorker(repo, args[args.indexOf("--worker") + 1])
      : args.includes("--full-run")
        ? assertFullRunWorker(repo, integrationCheckout(repo).workerWorktree)
        : args.includes("--integration")
          ? inspectIntegrationCheckout(repo)
          : integrationCheckout(repo);
    console.log(JSON.stringify(targets));
    if (args.includes("--integration") && !targets.ready) process.exitCode = 2;
  } catch (error) {
    console.error(`[full-run-checkouts] ${error.message}`);
    process.exitCode = 2;
  }
}
