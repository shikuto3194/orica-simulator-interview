import ts from "typescript";

const printer = ts.createPrinter({ removeComments: true });
function project(file, text, pattern) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const fragment = ts.createSourceFile(
    "fragment.ts",
    pattern,
    ts.ScriptTarget.Latest,
    true
  );
  if (source.parseDiagnostics.length || fragment.parseDiagnostics.length)
    return null;
  const show = (node, owner) =>
    printer.printNode(ts.EmitHint.Unspecified, node, owner);
  const expected = fragment.statements.map((node) => show(node, fragment));
  let count = 0;
  const result = ts.transform(source, [
    (context) => {
      const visit = (node) => {
        if (ts.isBlock(node)) {
          const statements = [...node.statements];
          for (let i = 0; i <= statements.length - expected.length; i++) {
            if (
              expected.every(
                (value, j) => show(statements[i + j], source) === value
              )
            ) {
              count++;
              statements.splice(
                i,
                expected.length,
                context.factory.createEmptyStatement()
              );
            }
          }
          return context.factory.updateBlock(
            node,
            statements.map((statement) => ts.visitNode(statement, visit))
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  const projected = printer.printFile(result.transformed[0]);
  result.dispose();
  return count === 1 ? projected : null;
}

// Bound only the two reviewed delivery fixes, not arbitrary edits in these
// large modules. All other tokens, including changed callers, must agree.
export function roomDeliveryOnlyChange(file, before, after) {
  const patterns = {
    "apps/playground-web/src/components/BattleScreen.tsx": [
      "if (newState) applyRoomAuthoritativeState(newState);",
      "if (newState && newState !== lastRoomAuthoritativeStateRef.current) { applyRoomAuthoritativeState(newState); }",
    ],
    "apps/playground-web/src/hooks/useRoomSync.ts": [
      "if (data.version > lastKnownVersion.current) { return await fetchLatestState(); }",
      "if (data.version > lastKnownVersion.current) { return await fetchLatestState(); } if (data.version === lastKnownVersion.current) { return lastKnownState.current; }",
    ],
  };
  const pair = patterns[file];
  if (!pair) return false;
  const old = project(file, before, pair[0]);
  const current = project(file, after, pair[1]);
  return (
    old !== null &&
    current !== null &&
    JSON.stringify(old) === JSON.stringify(current)
  );
}
