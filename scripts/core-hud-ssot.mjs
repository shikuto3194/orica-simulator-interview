import ts from "typescript";

/** GUI コア選択の迂回を検知する。旧専用 selector と JSX 内の直接送信を退行 fixture にする。 */
export function hasDedicatedCoreSelector(text) {
  if (
    /\b(?:CoreCountModal|PendingLifeCoreSelectionModal|SummonCostCoreMoveChoiceModal|CoreSplitModal|CoreSourceAllocationModal)\b/.test(
      text
    )
  )
    return true;
  // 同じ大きな画面内に CoreSelectionHud があっても免除しない。
  if (
    /<button\b[\s\S]{0,900}?(?:costSourceInstanceId|availableNormalCoreCount)[\s\S]{0,400}?<\/button>/.test(
      text
    )
  )
    return true;
  if (/candidates\.map\([\s\S]{0,800}?payToActCoreSourceContainerId/.test(text))
    return true;
  // 共通HUDが同居していても、画面側で配分payloadを組み立てる並行経路は禁止。
  const file = ts.createSourceFile(
    "core-hud.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const allocationIdentifiers = new Set([
    "recomposeCoreSourceAllocationLegalAction",
    "coreSourceAllocations",
    "coreSourceSoulCoreInstanceId",
  ]);
  const visit = (node) =>
    (ts.isIdentifier(node) && allocationIdentifiers.has(node.text)) ||
    (ts.forEachChild(node, visit) ?? false);
  return visit(file);
}

/** pendingMultiPlacement の名だけで二段階を強制する JSX の再導入を検知。 */
export function hasForcedMultiPlacementPhase(text) {
  return /<CoreSelectionHud\b[^>]*\bmode\s*=\s*["']placement_multi["']/.test(
    text
  );
}

/** 複数配置の候補表示/grabで生のカード状態から配置元を再判定する回帰を検知。 */
export function hasRawMultiPlacementFieldSources(text) {
  const file = ts.createSourceFile(
    "core-hud.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const containsProperty = (node, name) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === name)
      return true;
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === name
    )
      return true;
    return (
      ts.forEachChild(node, (child) => containsProperty(child, name)) ?? false
    );
  };
  const visit = (node) => {
    if (
      ts.isIfStatement(node) &&
      containsProperty(node.expression, "pendingMultiPlacement") &&
      containsProperty(node.thenStatement, "cardInstances")
    )
      return true;
    return ts.forEachChild(node, visit) ?? false;
  };
  return visit(file);
}

/** Actual effect resolution may only auto-pay through the unique-normal-source gate. */
export function hasImplicitEffectCoreChoice(text) {
  const file = ts.createSourceFile(
    "effect-core-choice.ts",
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const implicitHelpers = new Set([
    "chooseAutoCardCostPaymentSources",
    "applyAutoEnterFieldCores",
  ]);
  const visit = (node, functionName = "") => {
    if (ts.isFunctionDeclaration(node)) functionName = node.name?.text ?? "";
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      implicitHelpers.has(node.expression.text) &&
      functionName !== "canExecuteSummonSelfNow"
    )
      return true;
    return (
      ts.forEachChild(node, (child) => visit(child, functionName)) ?? false
    );
  };
  return visit(file);
}
