import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(root, args, extraEnv = {}, preserveTrailingNewline = false) {
  const output = execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
  return preserveTrailingNewline ? output : output.trimEnd();
}

export function resolveVerificationBase(root, base) {
  const baseCommit = git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  const mergeBase = git(root, ["merge-base", baseCommit, "HEAD"]);
  const baseTree = git(root, ["rev-parse", `${mergeBase}^{tree}`]);
  return { baseCommit, mergeBase, baseTree };
}

/**
 * HEAD + staged + unstaged + untracked（gitignore 対象外）を一時 index に積み、
 * commit を作らず検証対象 tree を生成する。実 worktree/index は変更しない。
 */
export function buildVerificationTree(root, base = "main") {
  const indexPath = join(
    tmpdir(),
    `orica-verifier-index-${process.pid}-${randomUUID()}`
  );
  const env = { GIT_INDEX_FILE: indexPath };

  try {
    // Merge mode applies sparse-checkout patterns to the temporary index.
    // Without it, add -A can remove intentionally absent tracked assets.
    git(root, ["read-tree", "-m", "HEAD"], env);
    git(root, ["-c", "core.safecrlf=false", "add", "-A", "--", "."], env);
    const headTree = git(root, ["write-tree"], env);
    return { base, ...resolveVerificationBase(root, base), headTree };
  } finally {
    if (existsSync(indexPath)) rmSync(indexPath, { force: true });
    if (existsSync(`${indexPath}.lock`))
      rmSync(`${indexPath}.lock`, { force: true });
  }
}

export function committedTree(root) {
  return git(root, ["rev-parse", "HEAD^{tree}"]);
}

export function diffBetweenTrees(root, fromTree, toTree, extraArgs = []) {
  return git(
    root,
    ["diff", "--no-ext-diff", "--no-textconv", ...extraArgs, fromTree, toTree],
    {},
    true
  );
}

export function changedFilesBetweenTrees(
  root,
  fromTree,
  toTree,
  executeDiff = diffBetweenTrees
) {
  const output = executeDiff(root, fromTree, toTree, ["--name-only"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
