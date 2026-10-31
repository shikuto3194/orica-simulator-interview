import { execFileSync } from "node:child_process";

export function checkoutEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
  );
}

// Local observations only: no fetch, checkout, ref update or process control.
export function inspectCheckoutContext(root, execute = execFileSync) {
  const result = {
    root,
    branch: null,
    head: null,
    upstream: null,
    ahead: null,
    behind: null,
    issues: [],
  };
  const git = (...args) =>
    execute("git", args, {
      cwd: root,
      encoding: "utf8",
      env: checkoutEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    result.root = git("rev-parse", "--show-toplevel");
    result.head = git("rev-parse", "--verify", "HEAD");
    result.branch = git("rev-parse", "--abbrev-ref", "HEAD");
    if (result.branch === "HEAD") {
      result.issues.push("detached HEAD; upstream comparison unavailable");
      return result;
    }
    result.upstream =
      git(
        "for-each-ref",
        "--format=%(upstream:short)",
        `refs/heads/${result.branch}`
      ) || null;
    if (!result.upstream) {
      result.issues.push("no upstream configured; comparison unavailable");
      return result;
    }
    const counts = git(
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${result.upstream}`
    ).split(/\s+/);
    if (counts.length !== 2 || counts.some((value) => !/^\d+$/.test(value)))
      throw new Error("invalid divergence result");
    [result.ahead, result.behind] = counts.map(Number);
    if (result.behind)
      result.issues.push(
        `local upstream is ${result.behind} commit(s) ahead; docs may differ`
      );
  } catch (error) {
    result.issues.push(
      `checkout inspection unavailable (${error.code ?? error.status ?? "error"})`
    );
  }
  return result;
}
