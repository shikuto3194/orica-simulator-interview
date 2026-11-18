import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// This entry selects literal files, never arbitrary Vitest flags or glob patterns.
export function unitTestFiles(root, input) {
  if (!Array.isArray(input) || input.length === 0)
    throw new Error(
      "test:unit requires explicit repository-relative .test.ts files"
    );
  const files = input.map((value) => {
    if (typeof value !== "string") throw new Error("Invalid unit test path");
    const file = value.replaceAll("\\", "/").replace(/^\.\//, "");
    if (
      !/^(packages|apps)\/.+\/test\/.+\.test\.ts$/.test(file) ||
      [...file].some((character) => character.charCodeAt(0) < 32) ||
      /[:*?[\]{}!()]/.test(file) ||
      file.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("test:unit accepts literal test files only: " + value);
    return file;
  });
  const canonicalRoot = realpathSync(root);
  for (const file of files) {
    let target = resolve(root);
    for (const part of file.split("/")) {
      target = join(target, part);
      if (lstatSync(target).isSymbolicLink())
        throw new Error("Linked unit test paths are not allowed: " + file);
    }
    const inside = relative(canonicalRoot, realpathSync(target));
    if (
      isAbsolute(inside) ||
      inside === ".." ||
      inside.startsWith(".." + sep) ||
      !lstatSync(target).isFile()
    )
      throw new Error(
        "Unit test must be a regular file inside the checkout: " + file
      );
  }
  // New, untracked regression tests are supported; ignored inputs are not part
  // of the verification tree and cannot be selected as if they were covered.
  const listed = execFileSync(
    "git",
    [
      "--literal-pathspecs",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...files,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  )
    .split("\0")
    .filter(Boolean);
  const key = (file) =>
    process.platform === "win32" ? file.toLowerCase() : file;
  const canonical = new Map(listed.map((file) => [key(file), file]));
  const selected = files.map((file) => {
    const found = canonical.get(key(file));
    if (!found)
      throw new Error(
        "Unit test is ignored or outside the source tree: " + file
      );
    return found;
  });
  return [...new Set(selected)].sort();
}

export function assertUnitTestResults(root, selected, resultPath) {
  const report = JSON.parse(readFileSync(resultPath, "utf8"));
  if (
    report.success !== true ||
    report.numFailedTests !== 0 ||
    !(report.numPassedTests > 0) ||
    !Array.isArray(report.testResults)
  )
    throw new Error("Unit result is missing successful executed tests");
  const actual = report.testResults
    .map((suite) => {
      if (typeof suite.name !== "string" || !isAbsolute(suite.name))
        throw new Error("Unit result has an invalid file identity");
      if (
        !Array.isArray(suite.assertionResults) ||
        !suite.assertionResults.some((test) => test.status === "passed") ||
        suite.assertionResults.some((test) => test.status === "failed")
      )
        throw new Error(
          "Selected unit file did not execute successful tests: " + suite.name
        );
      return relative(root, suite.name).split(sep).join("/");
    })
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(selected))
    throw new Error("Unit result files do not match the explicit selection");
}
