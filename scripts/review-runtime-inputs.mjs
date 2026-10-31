/** Conservative static closure for review runtime inputs. Unknown loaders bind all core source. */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

export function reviewRuntimeInputs(
  repoRoot,
  entries = ["packages/rules-core/src/runtime.ts"],
  { conservative = false } = {}
) {
  const root = realpathSync(repoRoot);
  const core = "packages/rules-core/src";
  const visited = new Set();
  let uncertain = conservative;
  function checked(file) {
    const full = resolve(root, file);
    const paths = [relative(root, full), relative(root, realpathSync(full))];
    if (
      paths.some(
        (ref) => ref === ".." || ref.startsWith(`..${sep}`) || isAbsolute(ref)
      )
    )
      throw new Error(`Review runtime input leaves repository: ${file}`);
    // A parent junction can remain inside the repository while changing the
    // base of relative imports. Reject every linked path component before
    // resolving imports from the lexical path or hashing its dependencies.
    for (let current = full; current !== root; current = dirname(current)) {
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Review runtime input follows symlink: ${file}`);
    }
    return full;
  }
  function visit(file) {
    if (visited.has(file)) return;
    const full = checked(file);
    visited.add(file);
    const source = readFileSync(full, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) uncertain = true;
    function inspect(node) {
      if (
        ts.isIdentifier(node) &&
        ["require", "eval", "Function"].includes(node.text)
      )
        uncertain = true;
      // Dynamic loading, filesystem access and unknown aliases cannot justify
      // excluding source. Static relative imports/exports (including types) can.
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        if (
          node.arguments.length !== 1 ||
          !ts.isStringLiteral(node.arguments[0])
        )
          uncertain = true;
      }
      if (
        ts.isMetaProperty(node) &&
        node.keywordToken === ts.SyntaxKind.ImportKeyword
      )
        uncertain = true;
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
    for (const { fileName } of ts.preProcessFile(source, true, true)
      .importedFiles) {
      if (!fileName.startsWith(".")) {
        uncertain = true;
        continue;
      }
      // TypeScript may substitute .ts for a .js specifier. Keep both source
      // alternatives bound until module-resolution options are proven here.
      if (/\.[cm]?js$/.test(fileName)) uncertain = true;
      const base = resolve(dirname(full), fileName);
      const target = [
        base,
        base.replace(/\.js$/, ".ts"),
        ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"].map(
          (suffix) => base + suffix
        ),
      ].find(
        (candidate) => existsSync(candidate) && lstatSync(candidate).isFile()
      );
      if (!target) {
        uncertain = true;
        continue;
      }
      const ref = relative(root, target).replaceAll("\\", "/");
      visit(ref);
    }
  }
  for (const entry of entries) {
    if (!existsSync(resolve(root, entry))) uncertain = true;
    else visit(entry);
  }
  if (uncertain) {
    function collect(file) {
      if (!existsSync(resolve(root, file))) return;
      const full = checked(file);
      if (lstatSync(full).isDirectory()) {
        for (const name of readdirSync(full).sort()) collect(`${file}/${name}`);
      } else visited.add(file);
    }
    collect(core);
  }
  return { files: [...visited].sort(), conservative: uncertain };
}
