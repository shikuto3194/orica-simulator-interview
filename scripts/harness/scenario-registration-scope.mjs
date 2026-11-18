import ts from "typescript";

const printer = ts.createPrinter({ removeComments: true });
const key = (node) =>
  ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;

// Prove that only new, registered scenario entries and their named imports
// were added. Existing entries and all registry control flow stay identical.
export function scenarioModuleIsPure(text, allowedImports) {
  const source = ts.createSourceFile(
    "scenario.ts",
    text,
    ts.ScriptTarget.Latest,
    true
  );
  if (source.parseDiagnostics.length) return false;
  return source.statements.every((node) => {
    if (ts.isImportDeclaration(node))
      return (
        !!node.importClause &&
        (node.importClause.isTypeOnly ||
          (ts.isStringLiteral(node.moduleSpecifier) &&
            allowedImports.has(node.moduleSpecifier.text)))
      );
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEmptyStatement(node)
    );
  });
}

export function runtimeImports(text) {
  const source = ts.createSourceFile(
    "scenarios.ts",
    text,
    ts.ScriptTarget.Latest,
    true
  );
  return new Set(
    source.statements
      .filter(
        (node) =>
          ts.isImportDeclaration(node) &&
          node.importClause &&
          !node.importClause.isTypeOnly &&
          (node.importClause.name ||
            (node.importClause.namedBindings &&
              (ts.isNamespaceImport(node.importClause.namedBindings) ||
                node.importClause.namedBindings.elements.some(
                  (e) => !e.isTypeOnly
                ))))
      )
      .map((node) => node.moduleSpecifier.text)
  );
}

export function addedScenarios(before, after, registered, verifyModule) {
  const parse = (text) =>
    ts.createSourceFile("scenarios.ts", text, ts.ScriptTarget.Latest, true);
  const old = parse(before),
    current = parse(after);
  if (old.parseDiagnostics.length || current.parseDiagnostics.length)
    return null;
  const find = (source) =>
    source.statements
      .flatMap((node) =>
        ts.isVariableStatement(node)
          ? [...node.declarationList.declarations]
          : []
      )
      .find(
        (node) => ts.isIdentifier(node.name) && node.name.text === "SCENARIOS"
      )?.initializer;
  const a = find(old),
    b = find(current);
  if (
    !a ||
    !b ||
    !ts.isObjectLiteralExpression(a) ||
    !ts.isObjectLiteralExpression(b)
  )
    return null;
  const existing = new Set(a.properties.map((node) => key(node.name)));
  const additions = b.properties.filter(
    (node) => !existing.has(key(node.name))
  );
  if (!additions.length) return null;
  const imports = new Set(),
    names = [];
  for (const entry of additions) {
    const name = key(entry.name);
    if (
      !name ||
      !/^[a-z0-9-]+$/.test(name) ||
      !registered.has(`e2e/scenario-${name}.spec.ts`) ||
      !ts.isPropertyAssignment(entry) ||
      !ts.isObjectLiteralExpression(entry.initializer)
    )
      return null;
    const properties = entry.initializer.properties;
    if (
      properties.length !== 3 ||
      new Set(properties.map((p) => key(p.name))).size !== 3
    )
      return null;
    if (
      properties.some(
        (p) =>
          !ts.isPropertyAssignment(p) ||
          !["name", "description", "build"].includes(key(p.name))
      )
    )
      return null;
    if (
      properties.some(
        (p) =>
          key(p.name) !== "build" &&
          !ts.isStringLiteral(p.initializer) &&
          !ts.isNoSubstitutionTemplateLiteral(p.initializer)
      )
    )
      return null;
    const build = properties.find((p) => key(p.name) === "build")?.initializer;
    if (!build || !ts.isIdentifier(build)) return null;
    const declaration = current.statements.find(
      (node) =>
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier.text === `./scenario-${name}` &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.length === 1 &&
        node.importClause.namedBindings.elements[0].name.text === build.text &&
        !node.importClause.name
    );
    if (
      !declaration ||
      old.statements.some(
        (node) =>
          ts.isImportDeclaration(node) &&
          node.moduleSpecifier.text === declaration.moduleSpecifier.text
      )
    )
      return null;
    const priorImports = new Set(
      current.statements
        .slice(0, current.statements.indexOf(declaration))
        .filter(
          (node) =>
            ts.isImportDeclaration(node) &&
            node.importClause &&
            !node.importClause.isTypeOnly &&
            (node.importClause.name ||
              (node.importClause.namedBindings &&
                (ts.isNamespaceImport(node.importClause.namedBindings) ||
                  node.importClause.namedBindings.elements.some(
                    (element) => !element.isTypeOnly
                  ))))
        )
        .map((node) => node.moduleSpecifier.text)
    );
    if (typeof verifyModule !== "function" || !verifyModule(name, priorImports))
      return null;
    imports.add(declaration);
    names.push(name);
  }
  const transformed = ts.transform(current, [
    (context) => {
      const visit = (node) => {
        if (node === b)
          return context.factory.updateObjectLiteralExpression(
            node,
            context.factory.createNodeArray(
              node.properties.filter((p) => !additions.includes(p)),
              node.properties.hasTrailingComma
            )
          );
        return ts.visitEachChild(node, visit, context);
      };
      return (source) =>
        context.factory.updateSourceFile(
          source,
          source.statements
            .filter((node) => !imports.has(node))
            .map((node) => ts.visitNode(node, visit))
        );
    },
  ]);
  const same =
    printer.printFile(old) === printer.printFile(transformed.transformed[0]);
  transformed.dispose();
  return same ? names : null;
}
