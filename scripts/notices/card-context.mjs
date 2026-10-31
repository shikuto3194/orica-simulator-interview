import ts from "typescript";

// Parse source as data; never import/evaluate card files in the notice editor.
export function cardDefinitions(source) {
  const file = ts.createSourceFile(
    "cards.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const cards = new Map();
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const property = node.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText(file) === "cardNo"
      );
      if (
        property &&
        ts.isStringLiteral(property.initializer) &&
        node.properties.some(
          (p) => ts.isPropertyAssignment(p) && p.name.getText(file) === "name"
        )
      ) {
        const cardNo = property.initializer.text;
        if (cards.has(cardNo))
          throw new Error(`Duplicate card context: ${cardNo}`);
        cards.set(cardNo, node.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return cards;
}

export function changedCardContexts(path, beforeSource, afterSource) {
  const before = cardDefinitions(beforeSource);
  const after = cardDefinitions(afterSource);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((cardNo) => before.get(cardNo) !== after.get(cardNo))
    .map((cardNo) => ({
      path,
      cardNo,
      before: before.get(cardNo) ?? "",
      after: after.get(cardNo) ?? "",
    }));
}
