const ts = require("typescript");

const CONTINUATION_MODULE =
  /(?:^|[\\/])(?:pending-action-handlers|stack-resolution-core)\.ts$/;
const ACTION_MODULE = /(?:^|[\\/])legal-actions-apply\.ts$/;

/** Calls, including imported aliases, must use the bound resolution scope. */
function hasUnscopedResolutionCalls(text, finalizeOnly = false) {
  const names = new Set(
    finalizeOnly
      ? ["finalizeEffectResolution"]
      : ["executeEffect", "finalizeEffectResolution"]
  );
  const source = ts.createSourceFile(
    "resolution.ts",
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const aliases = new Set(names);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const entry of bindings.elements) {
        if (names.has((entry.propertyName ?? entry.name).text))
          aliases.add(entry.name.text);
      }
    }
  }
  let found = false;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        (ts.isIdentifier(expression) && aliases.has(expression.text)) ||
        (ts.isPropertyAccessExpression(expression) &&
          names.has(expression.name.text))
      )
        found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function violatesEffectResolutionScope(path, text) {
  return CONTINUATION_MODULE.test(path)
    ? hasUnscopedResolutionCalls(text)
    : ACTION_MODULE.test(path) && hasUnscopedResolutionCalls(text, true);
}

module.exports = { hasUnscopedResolutionCalls, violatesEffectResolutionScope };
