import ts from "typescript";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";

// A focused test may reuse evidence after unrelated edits only when its input
// closure is statically known. File I/O, arbitrary packages, loaders and code
// evaluation deliberately fall back to the complete source fingerprint.
export function focusedInputs(root, tests) {
  if (!tests.length) return null;
  for (const [file, hash] of Object.entries(knownConfiguration)) {
    try {
      if (
        createHash("sha256")
          .update(
            readFileSync(resolve(root, file), "utf8").replaceAll("\r\n", "\n")
          )
          .digest("hex") !== hash
      )
        return null;
    } catch {
      return null;
    }
  }
  const inputs = new Set(),
    pending = [
      ...tests,
      "vitest.config.ts",
      "scripts/harness/vitest-unit.config.mjs",
      "scripts/harness/unit-test-input.mjs",
    ];
  // Harness helpers use filesystem APIs to validate the selected paths, so bind
  // their whole implementation as infrastructure instead of analyzing them as
  // application code. Selection and result policy changes invalidate evidence.
  const infrastructure = [
    "scripts/harness/vitest-unit.config.mjs",
    "scripts/harness/unit-test-input.mjs",
  ];
  while (pending.length) {
    const file = pending.pop();
    if (inputs.has(file)) continue;
    if (!existsSync(resolve(root, file))) return null;
    inputs.add(file);
    if (infrastructure.includes(file)) continue;
    const text = readFileSync(resolve(root, file), "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true
    );
    let opaque = false;
    const specs = [];
    function visit(node) {
      if (ts.isImportEqualsDeclaration(node)) opaque = true;
      if (
        (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
        /^(?:importActual|importMock|requireActual|requireMock|require|createRequire|getBuiltinModule|globalThis|global|mainModule|eval|Function|fetch)$/.test(
          node.text
        )
      )
        opaque = true;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        if (ts.isStringLiteral(node.moduleSpecifier))
          specs.push(node.moduleSpecifier.text);
        else opaque = true;
      }
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (
            node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0])
          )
            specs.push(node.arguments[0].text);
          else opaque = true;
        }
        if (
          /^(?:require|eval|Function|fetch)$|(?:createRequire|getBuiltinModule|\.binding|\.glob|\.globEager)$/.test(
            name
          )
        )
          opaque = true;
      }
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(source) === "Function"
      )
        opaque = true;
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (opaque || source.parseDiagnostics.length) return null;
    for (const spec of specs) {
      if (
        [
          "vitest",
          "vitest/config",
          "node:assert/strict",
          "node:path",
          "node:url",
          "node:crypto",
        ].includes(spec)
      )
        continue;
      let target;
      if (["@orica/rules-core", "@orica/card-data"].includes(spec))
        target = resolve(root, "packages", spec.slice(7), "src/index.ts");
      else if (spec.startsWith("."))
        target = resolve(root, dirname(file), spec);
      else return null;
      const found = [
        target,
        target + ".ts",
        target + ".tsx",
        target + ".mjs",
        target + "/index.ts",
        target.replace(/\.js$/, ".ts"),
      ].find((path) => existsSync(path) && /\.[cm]?[jt]sx?$/.test(path));
      if (!found) return null;
      if (
        realpathSync(found) !==
        resolve(realpathSync(root), relative(root, found))
      )
        return null;
      const ref = relative(root, found).replaceAll("\\", "/");
      if (ref.startsWith("../") || ref.includes(":")) return null;
      pending.push(ref);
    }
  }
  return inputs;
}

// Config-defined setup, plugin and alias inputs require a fresh reviewed closure.
const knownConfiguration = {
  "vitest.config.ts":
    "8f6117e757df42e514949b16a5ede263219bb71002bc835886f2edd8ad7fd5fe",
  "scripts/harness/vitest-unit.config.mjs":
    "85d6ec98878cb7c57a643f90ab8d24cf61b96271d274e0b4b7a02fe75d4639bf",
  "scripts/harness/vitest-pool.mjs":
    "a70164861f3f4cd1e1fd35be9f4f98512f604930ac65b08e06c9008f09497fde",
  "scripts/harness/unit-test-input.mjs":
    "99a2082f9433daba50084780e83735c675d2be249d4e3db45598475c8ee79785",
};
