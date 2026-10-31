import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { checkoutEnvironment } from "./harness/checkout-context.mjs";
import { parsers } from "prettier/plugins/markdown";

// Use the already-installed formatter's public Markdown parser. Code examples,
// escapes and container boundaries must follow Markdown, not a second grammar.
export async function documentLinks(content) {
  const tree = await parsers.markdown.parse(content);
  if (tree?.type !== "root" || !Array.isArray(tree.children))
    throw new Error("Unsupported Markdown AST");
  const walk = (node, visit) => {
    visit(node);
    if (node.children !== undefined) {
      if (!Array.isArray(node.children))
        throw new Error("Invalid Markdown children");
      for (const child of node.children) walk(child, visit);
    }
  };
  const normalize = (id) => {
    if (typeof id !== "string") throw new Error("Invalid Markdown reference");
    return id.trim().replace(/\s+/g, " ").toLowerCase();
  };
  const definitions = new Map();
  walk(tree, (node) => {
    if (node.type !== "definition") return;
    if (typeof node.url !== "string")
      throw new Error("Invalid Markdown definition URL");
    const id = normalize(node.identifier);
    if (!definitions.has(id)) definitions.set(id, node.url);
  });
  const links = [];
  walk(tree, (node) => {
    if (!["link", "linkReference"].includes(node.type)) return;
    const target =
      node.type === "link"
        ? node.url
        : definitions.get(normalize(node.identifier));
    if (target === undefined && node.type === "linkReference") return; // Unresolved references render as text.
    if (
      typeof target !== "string" ||
      !Number.isInteger(node.position?.start?.line)
    )
      throw new Error("Invalid Markdown link");
    links.push({ target, line: node.position.start.line });
  });
  return links;
}

export function frozenDocument(path) {
  return (
    /(?:^|\/)(?:archive|_legacy)\//.test(path) ||
    /(?:^|\/)(?:history-[^/]+|03_completed-milestones-phase-[^/]+)\.md$/.test(
      path
    )
  );
}

// Git failures are inspection failures, never an empty tracked/ignored set.
export async function inspectDocumentLinks(
  root,
  documents,
  runGit = execFileSync
) {
  const git = (args, input) =>
    runGit("git", args, {
      cwd: root,
      encoding: "utf8",
      env: checkoutEnvironment(),
      input,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  const pathKey = (path) =>
    process.platform === "win32" ? path.toLowerCase() : path;
  const indexFiles = git(["ls-files", "--cached", "-z"]);
  const headFiles = git(["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  const tracked = new Set(
    (indexFiles + headFiles).split("\0").filter(Boolean).map(pathKey)
  );
  const violations = new Map();
  const entries = [];
  const targets = new Map();
  const addFailure = (file, line, target, reason) => {
    const found = violations.get(file) ?? [];
    found.push(`broken link (${target}) at L${line}: ${reason}`);
    violations.set(file, found);
  };
  for (const { rel, content } of documents) {
    if (frozenDocument(rel)) continue;
    for (const { target, line } of await documentLinks(content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      const pathname = target.split(/[?#]/, 1)[0];
      if (!pathname) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        addFailure(rel, line, target, "invalid URL encoding");
        continue;
      }
      const absolute = resolve(
        decoded.startsWith("/") ? root : dirname(resolve(root, rel)),
        decoded.startsWith("/") ? `.${decoded}` : decoded
      );
      const local = relative(root, absolute).split(sep).join("/");
      if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
        addFailure(
          rel,
          line,
          target,
          "outside repository; use an explicit external URL/path"
        );
        continue;
      }
      entries.push({ rel, line, target, local });
      if (!targets.has(local)) targets.set(local, absolute);
    }
  }
  const missing = new Set();
  for (const [local, absolute] of targets) {
    try {
      await stat(absolute);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      missing.add(local);
    }
  }
  // Tracked-but-deleted files must fail even if a new ignore rule matches them.
  const generatedRoots = new Set([
    "artifacts",
    "logs",
    "debug-screenshots",
    "test-results",
    "playwright-report",
    "coverage",
    "node_modules",
    "external-qa",
    "external-qa-official",
    "tmp",
  ]);
  const candidates = [...missing].filter(
    (path) =>
      !tracked.has(pathKey(path)) && generatedRoots.has(path.split("/")[0])
  );
  let ignored = new Set();
  if (candidates.length) {
    try {
      ignored = new Set(
        git(
          ["check-ignore", "--no-index", "--stdin", "-z"],
          candidates.join("\0") + "\0"
        )
          .split("\0")
          .filter(Boolean)
      );
    } catch (error) {
      if (error.status !== 1) throw error;
    }
  }
  for (const { rel, line, target, local } of entries) {
    if (missing.has(local) && !ignored.has(local))
      addFailure(rel, line, target, `missing ${local}`);
  }
  return { violations, ignoredTargets: [...ignored].sort() };
}
