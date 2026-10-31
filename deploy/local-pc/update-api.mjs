import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import process from "node:process";

const exec = promisify(execFile);
const exportPaths = [
  "apps/playground-web/server",
  "apps/playground-web/shared",
  "apps/playground-web/src",
  "packages/rules-core",
  "packages/card-data",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "scripts/build-api.mjs",
  "scripts/check-api-build.mjs",
];

async function command(root, file, args) {
  // Build processes never need production credentials.
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
  };
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  return exec(file, args, {
    cwd: root,
    env,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

export async function publishedRevision(root) {
  await command(root, "git", ["fetch", "--quiet", "origin", "main"]);
  const { stdout } = await command(root, "git", [
    "rev-parse",
    "refs/remotes/origin/main",
  ]);
  const revision = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Invalid published revision");
  return revision;
}

export async function prepareRelease(root, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Invalid release revision");
  const base = resolve(root, "artifacts/pc-api");
  // Build trees contain dependency junctions. Keep these temporary inputs out
  // of artifacts, whose inventory must reject links and count only real files.
  const buildBase = resolve(root, ".codex-temp/pc-api-build");
  const stage = resolve(buildBase, revision);
  const directory = resolve(base, "releases", revision);
  try {
    if (
      JSON.parse(await readFile(resolve(directory, "release.json"), "utf8"))
        .revision === revision
    )
      return { revision, directory };
    throw new Error("Release manifest mismatch");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Only the isolated build tree can be removed. Active/rollback releases and
  // the checkout (including uncommitted edits) are never overwritten.
  if (!stage.startsWith(buildBase + sep)) throw new Error("Unsafe build path");
  for (const path of [
    resolve(root),
    resolve(root, ".codex-temp"),
    buildBase,
    stage,
  ]) {
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error(`Linked build path: ${path}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    const archive = resolve(stage, "source.tar");
    await command(root, "git", [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      revision,
      ...exportPaths,
    ]);
    await command(root, "tar", ["-xf", archive, "-C", stage]);
    if (
      !(await readFile(resolve(stage, "pnpm-lock.yaml"))).equals(
        await readFile(resolve(root, "node_modules/.pnpm/lock.yaml"))
      )
    ) {
      throw new Error(
        "Published dependencies differ: run pnpm install --frozen-lockfile before retrying"
      );
    }
    for (const path of ["node_modules", "apps/playground-web/node_modules"]) {
      await symlink(
        resolve(root, path),
        resolve(stage, path),
        process.platform === "win32" ? "junction" : "dir"
      );
    }
    await command(stage, process.execPath, [
      resolve(stage, "scripts/build-api.mjs"),
    ]);
    const output = resolve(stage, "dist/api");
    await command(stage, process.execPath, [
      resolve(stage, "scripts/check-api-build.mjs"),
      output,
    ]);
    // A revision's files are immutable, including lazily imported chunks.
    await mkdir(resolve(base, "releases"), { recursive: true });
    await writeFile(
      resolve(output, "release.json"),
      JSON.stringify({ revision }) + "\n"
    );
    await rename(output, directory);
    return { revision, directory };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Build while the current server remains live; rollback if startup/persistence fails. */
export async function replaceRelease(current, revision, operations) {
  if (current?.revision === revision) return current;
  const candidate = await operations.prepare(revision);
  await operations.preflight?.(candidate);
  await operations.stop();
  try {
    await operations.start(candidate);
    await operations.save(candidate);
    return candidate;
  } catch (error) {
    await operations.stop();
    if (current) await operations.start(current);
    throw error;
  }
}

export async function saveRelease(root, release) {
  const path = resolve(root, "artifacts/pc-api/current.json");
  await writeFile(path + ".tmp", JSON.stringify(release) + "\n");
  await rename(path + ".tmp", path);
}
