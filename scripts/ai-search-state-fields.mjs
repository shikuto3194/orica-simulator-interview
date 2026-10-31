// Structural backstop for the I1 inventory. Reads source text, never GameState.
import ts from "typescript";

export function findAiSearchStateFieldIssues(modelText, registryText) {
  const issues = [];
  function parse(text) {
    const file = ts.createSourceFile(
      "input.ts",
      text,
      ts.ScriptTarget.Latest,
      true
    );
    if (file.parseDiagnostics.length)
      throw new Error("invalid TypeScript source");
    return file;
  }
  function name(node) {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
    throw new Error("unsupported field name");
  }
  function unwrap(node) {
    while (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
    )
      node = node.expression;
    return node;
  }
  try {
    const model = parse(modelText),
      registry = parse(registryText);
    const states = model.statements.filter(
      (node) =>
        ts.isInterfaceDeclaration(node) && node.name.text === "GameState"
    );
    if (!states.length) throw new Error("GameState interface missing");
    const fields = new Set();
    for (const state of states) {
      if (state.heritageClauses?.length)
        throw new Error("GameState inheritance requires review");
      for (const member of state.members) {
        if (!ts.isPropertySignature(member))
          throw new Error("unsupported GameState member");
        const key = name(member.name);
        if (fields.has(key))
          throw new Error(`duplicate GameState field: ${key}`);
        fields.add(key);
      }
    }
    const policies = registry.statements.filter(
      (node) =>
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === "AiSearchStateFieldPolicy"
    );
    if (policies.length !== 1 || !ts.isUnionTypeNode(policies[0].type))
      throw new Error("field policy union missing or unsupported");
    const allowed = new Set(
      policies[0].type.types.map((node) => {
        if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal))
          throw new Error("nonliteral field policy");
        return node.literal.text;
      })
    );
    const declarations = registry.statements
      .filter(ts.isVariableStatement)
      .flatMap((node) => [...node.declarationList.declarations])
      .filter(
        (node) =>
          ts.isIdentifier(node.name) &&
          node.name.text === "AI_SEARCH_STATE_FIELD_POLICIES"
      );
    if (declarations.length !== 1 || !declarations[0].initializer)
      throw new Error("field registry missing or duplicated");
    const object = unwrap(declarations[0].initializer);
    if (!ts.isObjectLiteralExpression(object))
      throw new Error("field registry must be a literal");
    const entries = new Map();
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property))
        throw new Error("unsupported registry property");
      const key = name(property.name),
        value = unwrap(property.initializer);
      if (entries.has(key)) throw new Error(`duplicate registry field: ${key}`);
      entries.set(key, ts.isStringLiteral(value) ? value.text : null);
    }
    for (const key of fields)
      if (!entries.has(key))
        issues.push(`unclassified GameState field: ${key}`);
    for (const [key, value] of entries) {
      if (!fields.has(key)) issues.push(`unknown registry field: ${key}`);
      if (!allowed.has(value)) issues.push(`invalid field policy: ${key}`);
    }
  } catch (error) {
    issues.push(error.message);
  }
  return issues;
}
