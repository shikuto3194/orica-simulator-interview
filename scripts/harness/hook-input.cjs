const fs = require("node:fs");
const path = require("node:path");

const EDIT_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "apply_edit",
  "write_file",
  "apply_patch",
  "str_replace_editor",
  "create_file",
]);
const CODE_EXT_PATTERN =
  /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|json|html|ya?ml|toml|ps1|sh)$/i;
const toolName = (name) =>
  String(name || "")
    .toLowerCase()
    .split(".")
    .pop();

function projectRoot(input = {}, fallback = process.cwd()) {
  let dir = path.resolve(
    input.cwd || process.env.CLAUDE_PROJECT_DIR || fallback
  );
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || fallback);
}

function patchText(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  for (const key of ["command", "patch", "diff", "content"]) {
    if (
      typeof input[key] === "string" &&
      input[key].includes("*** Begin Patch")
    )
      return input[key];
  }
  return "";
}

function inputPath(input) {
  for (const key of [
    "file_path",
    "filePath",
    "path",
    "filename",
    "file",
    "target_file",
  ]) {
    if (typeof input?.[key] === "string") return input[key];
  }
  return null;
}

function editedPaths(name, input) {
  if (!EDIT_TOOLS.has(toolName(name))) return [];
  const paths = [];
  for (const match of patchText(input).matchAll(
    /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm
  ))
    paths.push(match[1].trim());
  const direct = inputPath(input);
  if (direct) paths.push(direct);
  if (Array.isArray(input?.edits)) {
    for (const edit of input.edits) {
      const file = inputPath(edit);
      if (file) paths.push(file);
    }
  }
  return [...new Set(paths)];
}

// Reconstruct edits in memory; never write the user's working tree.
function proposedEdits(name, input, root) {
  if (!EDIT_TOOLS.has(toolName(name))) return [];
  const virtual = new Map(),
    before = new Map();
  const read = (file) => {
    const abs = path.resolve(root, file);
    if (!virtual.has(abs)) {
      let content;
      try {
        content = fs.readFileSync(abs, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      before.set(abs, content);
      virtual.set(abs, content);
    }
    return virtual.get(abs);
  };
  const put = (file, content) => {
    read(file);
    virtual.set(path.resolve(root, file), content);
  };
  const patch = patchText(input);
  if (patch) {
    const lines = patch.replaceAll("\r\n", "\n").split("\n");
    let i = lines.indexOf("*** Begin Patch") + 1;
    while (i < lines.length && lines[i] !== "*** End Patch") {
      const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines[i++]);
      if (!header)
        throw new Error("Unsupported patch header; cannot check edits");
      const [, kind, file] = header;
      if (kind === "Delete") {
        put(file, undefined);
        continue;
      }
      if (kind === "Add") {
        const added = [];
        while (i < lines.length && !lines[i].startsWith("*** ")) {
          if (!lines[i].startsWith("+"))
            throw new Error("Invalid add-file patch");
          added.push(lines[i++].slice(1));
        }
        put(file, added.join("\n") + "\n");
        continue;
      }
      let target = file;
      if (lines[i]?.startsWith("*** Move to: ")) target = lines[i++].slice(13);
      const original = read(file);
      if (original === undefined)
        throw new Error(`Patch source missing: ${file}`);
      let content = original.replaceAll("\r\n", "\n"),
        cursor = 0;
      while (
        i < lines.length &&
        !/^\*\*\* (?:Add|Update|Delete|End Patch)/.test(lines[i])
      ) {
        if (lines[i] === "*** End of File") {
          i++;
          continue;
        }
        if (lines[i].startsWith("@@ ")) {
          const anchor = lines[i].slice(3);
          const at = findWholeLines(content, anchor, cursor);
          if (at < 0) throw new Error(`Patch anchor does not match: ${file}`);
          cursor = at + anchor.length;
        }
        if (lines[i].startsWith("@@")) i++;
        const oldLines = [],
          newLines = [];
        while (
          i < lines.length &&
          !lines[i].startsWith("@@") &&
          !lines[i].startsWith("*** ")
        ) {
          const line = lines[i++];
          if (line.startsWith(" ")) {
            oldLines.push(line.slice(1));
            newLines.push(line.slice(1));
          } else if (line.startsWith("-")) oldLines.push(line.slice(1));
          else if (line.startsWith("+")) newLines.push(line.slice(1));
          else if (line === "") {
            oldLines.push("");
            newLines.push("");
          } else throw new Error("Unsupported patch line");
        }
        if (!oldLines.length) throw new Error("Update patch requires context");
        const oldText = oldLines.join("\n");
        const endOnly = lines[i] === "*** End of File";
        let at = findWholeLines(content, oldText, cursor);
        if (endOnly) {
          while (at >= 0 && content.slice(at + oldText.length).trim() !== "") {
            at = findWholeLines(content, oldText, at + 1);
          }
        }
        if (at < 0) throw new Error(`Patch context does not match: ${file}`);
        const replacement = newLines.join("\n");
        content =
          content.slice(0, at) +
          replacement +
          content.slice(at + oldText.length);
        cursor = at + replacement.length;
      }
      if (target !== file) put(file, undefined);
      put(target, content);
    }
    if (lines[i] !== "*** End Patch") throw new Error("Incomplete patch");
  } else {
    const operations = Array.isArray(input?.edits) ? input.edits : [input];
    for (const operation of operations) {
      const file = inputPath(operation) || inputPath(input);
      if (!file) throw new Error("Edit has no file path");
      if (["write", "write_file", "create_file"].includes(toolName(name))) {
        if (typeof operation.content !== "string")
          throw new Error("Write has no content");
        put(file, operation.content);
      } else {
        const oldText = operation.old_string ?? operation.oldString;
        const replacement = operation.new_string ?? operation.newString;
        const original = read(file);
        if (
          typeof original !== "string" ||
          typeof oldText !== "string" ||
          !oldText ||
          typeof replacement !== "string"
        )
          throw new Error("Invalid edit input");
        if (!original.includes(oldText))
          throw new Error(`Edit text does not match: ${file}`);
        put(
          file,
          operation.replace_all || operation.replaceAll
            ? original.split(oldText).join(replacement)
            : original.replace(oldText, replacement)
        );
      }
    }
  }
  return [...virtual].map(([file, content]) => ({
    file,
    previous: before.get(file),
    content,
  }));
}
function typecheckProjects(files, root) {
  const projects = new Set(["packages/rules-core"]);
  for (const file of files) {
    const relative = path
      .relative(root, path.resolve(root, file))
      .replaceAll("\\", "/");
    const match = /^(packages|apps)\/[^/]+\//.exec(relative);
    if (match && fs.existsSync(path.join(root, match[0], "tsconfig.json")))
      projects.add(match[0].slice(0, -1));
  }
  return [...projects];
}
function findWholeLines(content, context, start) {
  for (
    let at = content.indexOf(context, start);
    at >= 0;
    at = content.indexOf(context, at + 1)
  ) {
    const end = at + context.length;
    if (
      (at === 0 || content[at - 1] === "\n") &&
      (end === content.length || content[end] === "\n")
    )
      return at;
    if (at >= content.length) break;
  }
  return -1;
}
module.exports = {
  toolName,
  projectRoot,
  editedPaths,
  proposedEdits,
  CODE_EXT_PATTERN,
  EDIT_TOOLS,
  typecheckProjects,
};
