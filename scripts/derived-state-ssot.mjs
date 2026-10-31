import ts from "typescript";

export const DERIVED_STATE_FILES = {
  rebuild: "packages/rules-core/src/effect/continuous-effect-rebuild.ts",
  battle: "packages/rules-core/src/battle/battle-shared.ts",
  invariants: "packages/rules-core/src/invariants/game-state-invariants.ts",
  cards: "packages/rules-core/src/zone/card-instance-state.ts",
};
const finalizer = "finalizeContinuousEffectRebuild";
const requiredBoundaries = [
  "rebuildContinuousEffectsFromField",
  "recomputeAndRebuildContinuousEffects",
  "recomputeAndRebuildContinuousEffectsForSources",
  "recomputeAndRebuildBattleStateContinuousEffects",
];
const indexedArrays = new Set([
  "cardInstances",
  "activeContinuousEffects",
  "effectUsageRecords",
]);
const mutators = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);
const parse = (path, text) =>
  ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
const callName = (node) =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    ? node.expression.text
    : undefined;
function visitBody(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => {
    if (!ts.isFunctionLike(child)) visitBody(child, visit);
  });
}
function enclosingFunctionName(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name)
      return parent.name.text;
  }
  return undefined;
}

// Only the top-level copy helper's fixed return shape may copy observed counts.
// Preserve literal contents and exclude parameters/locals that can shadow the
// module's count/data validators; normalized source text cannot prove either.
function isObservedCountCopy(node, name) {
  if (!ts.isPropertyAssignment(node)) return false;
  const object = node.parent;
  const returned = object?.parent;
  const body = returned?.parent;
  const fn = body?.parent;
  if (
    !ts.isObjectLiteralExpression(object) ||
    object.properties.length !== 2 ||
    !object.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        ["handCount", "deckCount"].includes(property.name.text)
    ) ||
    new Set(object.properties.map((property) => property.name.text)).size !==
      2 ||
    !ts.isReturnStatement(returned) ||
    returned.expression !== object ||
    !ts.isBlock(body) ||
    body.statements.length !== 1 ||
    !ts.isFunctionDeclaration(fn) ||
    fn.name?.text !== "projectObservedZoneCounts" ||
    !ts.isSourceFile(fn.parent) ||
    fn.parameters.length !== 1 ||
    !ts.isIdentifier(fn.parameters[0].name) ||
    fn.parameters[0].name.text !== "player" ||
    fn.parameters[0].initializer ||
    fn.parameters[0].dotDotDotToken ||
    fn.asteriskToken ||
    fn.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
    )
  )
    return false;
  const checked = node.initializer;
  if (callName(checked) !== "count" || checked.arguments.length !== 1)
    return false;
  const read = checked.arguments[0];
  return (
    callName(read) === "data" &&
    read.arguments.length === 2 &&
    ts.isIdentifier(read.arguments[0]) &&
    read.arguments[0].text === "player" &&
    ts.isStringLiteral(read.arguments[1]) &&
    read.arguments[1].text === name
  );
}

/** ASTで実コードを検査する。コメントや文字列に書かれた呼出しは証跡にしない。 */
export function findDerivedStateSsotIssues(sources) {
  const issues = [];
  const report = (file, detail) => issues.push({ file, detail });
  const trees = new Map(
    [...sources].map(([file, text]) => [file, parse(file, text)])
  );
  for (const file of Object.values(DERIVED_STATE_FILES)) {
    if (!trees.has(file)) report(file, "derived-state owner file missing");
  }
  const rebuild = trees.get(DERIVED_STATE_FILES.rebuild);
  if (rebuild) {
    const functions = new Map(
      rebuild.statements
        .filter(ts.isFunctionDeclaration)
        .filter((fn) => fn.name && fn.body)
        .map((fn) => [fn.name.text, fn])
    );
    const boundaries = [...functions.keys()].filter((name) =>
      /^(rebuild|recomputeAndRebuild).*ContinuousEffects/.test(name)
    );
    for (const name of requiredBoundaries)
      if (!functions.has(name))
        report(DERIVED_STATE_FILES.rebuild, `missing boundary ${name}`);
    const destinations = new Map();
    for (const name of boundaries) {
      const targets = [];
      visitBody(functions.get(name).body, (node) => {
        if (!ts.isReturnStatement(node)) return;
        const target = node.expression && callName(node.expression);
        targets.push(target);
        if (target !== finalizer && !boundaries.includes(target))
          report(
            DERIVED_STATE_FILES.rebuild,
            `${name} returns without derived-state finalization`
          );
      });
      destinations.set(name, targets);
    }
    const reachesFinalizer = (name, seen = new Set()) => {
      if (name === finalizer) return true;
      if (seen.has(name)) return false;
      return (destinations.get(name) ?? []).some((next) =>
        reachesFinalizer(next, new Set([...seen, name]))
      );
    };
    for (const name of boundaries)
      if (!reachesFinalizer(name))
        report(
          DERIVED_STATE_FILES.rebuild,
          `${name} has no path to ${finalizer}`
        );
    const fn = functions.get(finalizer);
    const finalizerReturns = [];
    if (fn)
      visitBody(fn.body, (node) => {
        if (!ts.isReturnStatement(node)) return;
        let finalizes = false;
        if (
          node.expression &&
          callName(node.expression) === "recomputeBattleEntityBp"
        ) {
          const input = node.expression.arguments[0];
          const assignment = fn.body.statements
            .filter(ts.isVariableStatement)
            .flatMap((statement) => [...statement.declarationList.declarations])
            .find(
              (decl) => decl.name.getText(rebuild) === input?.getText(rebuild)
            );
          finalizes = Boolean(
            assignment?.initializer &&
            callName(assignment.initializer) ===
              "removeSuppressedContinuousEffects" &&
            assignment.end < node.pos
          );
        }
        finalizerReturns.push(finalizes);
      });
    if (!finalizerReturns.length || finalizerReturns.some((valid) => !valid))
      report(
        DERIVED_STATE_FILES.rebuild,
        "finalizer must return battle values recomputed after suppression removal"
      );
  }
  const battle = trees.get(DERIVED_STATE_FILES.battle);
  if (battle) {
    const fn = battle.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "resolveEffectiveIdentity"
    );
    let reads = false,
      writes = false;
    const comparisons = new Set();
    if (fn?.body)
      visitBody(fn.body, (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(battle) === "identityCache"
        ) {
          if (["get", "set"].includes(node.expression.name.text)) {
            if (node.arguments[0]?.getText(battle) !== "state")
              report(
                DERIVED_STATE_FILES.battle,
                "identity cache must be keyed by the whole immutable state"
              );
            if (node.expression.name.text === "get") reads = true;
            else writes = true;
          }
        }
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        ) {
          comparisons.add(
            `${node.left.getText(battle).replaceAll("?.", ".")}===${node.right.getText(battle)}`
          );
        }
      });
    if (!reads || !writes)
      report(
        DERIVED_STATE_FILES.battle,
        "identity cache state ownership missing"
      );
    for (const [field, argument] of [
      ["card", "card"],
      ["definition", "def"],
      ["lookup", "getCardDefinitionById"],
    ]) {
      if (
        ![...comparisons].some((text) =>
          text.endsWith(`.${field}===${argument}`)
        )
      )
        report(
          DERIVED_STATE_FILES.battle,
          `identity cache must validate ${field} input`
        );
    }
  }
  const invariants = trees.get(DERIVED_STATE_FILES.invariants);
  if (invariants) {
    let wired = false;
    const walk = (node) => {
      if (callName(node) === "collectBattleEntityDerivedValueIssues")
        wired = true;
      ts.forEachChild(node, walk);
    };
    walk(invariants);
    if (!wired)
      report(
        DERIVED_STATE_FILES.invariants,
        "derived battle values must be checked by the shared invariant collector"
      );
  }
  for (const [file, tree] of trees) {
    if (!file.startsWith("packages/rules-core/src/")) continue;
    const aliases = new Set();
    const isIndexedArray = (node) =>
      Boolean(
        node &&
        ((ts.isPropertyAccessExpression(node) &&
          indexedArrays.has(node.name.text)) ||
          (ts.isElementAccessExpression(node) &&
            ts.isStringLiteral(node.argumentExpression) &&
            indexedArrays.has(node.argumentExpression.text)) ||
          (ts.isIdentifier(node) && aliases.has(node.text)))
      );
    const walk = (node) => {
      if (
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)
      ) {
        const name = node.name.getText(tree).replaceAll(/['"]/g, "");
        const owner = enclosingFunctionName(node);
        const factory = file === "packages/rules-core/src/factories.ts";
        const initializes =
          factory && ["initializeGame", "createEmptyGameState"].includes(owner);
        const phaseMetadata =
          file ===
            "packages/rules-core/src/effect/pending-resolution-policy.ts" &&
          ts.isPropertyAssignment(node) &&
          ts.isStringLiteral(node.initializer) &&
          node.initializer.text === "outside";
        // The search inventory names source fields but contains no state
        // values. Recognize only its top-level literal declaration; real
        // state construction/mutation in the same file remains guarded.
        let declaration = node.parent;
        while (
          declaration &&
          (ts.isObjectLiteralExpression(declaration) ||
            ts.isAsExpression(declaration) ||
            ts.isSatisfiesExpression(declaration) ||
            ts.isParenthesizedExpression(declaration))
        )
          declaration = declaration.parent;
        const searchFieldMetadata =
          file === "packages/rules-core/src/ai-search-state-fields.ts" &&
          ts.isPropertyAssignment(node) &&
          ts.isStringLiteral(node.initializer) &&
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          declaration.name.getText(tree) === "AI_SEARCH_STATE_FIELD_POLICIES" &&
          ts.isVariableDeclarationList(declaration.parent) &&
          ts.isVariableStatement(declaration.parent.parent) &&
          ts.isSourceFile(declaration.parent.parent.parent);
        if (
          name === "cardInstances" &&
          file !== DERIVED_STATE_FILES.cards &&
          !initializes &&
          !phaseMetadata &&
          !searchFieldMetadata
        ) {
          report(
            file,
            "cardInstances updates must go through replaceCardInstances"
          );
        }
        if (
          ["handCount", "deckCount"].includes(name) &&
          file !== DERIVED_STATE_FILES.cards &&
          !(
            factory &&
            ["createPlayerState", "createEmptyGameState"].includes(owner)
          )
        ) {
          const projection =
            file === "packages/rules-core/src/ai-observation.ts" &&
            owner === "buildPlayerFeatures" &&
            ts.isPropertyAssignment(node) &&
            node.initializer.getText(tree) === `player.${name}`;
          // A search constraint is a detached copy of an already observed
          // count, not a GameState counter writer. Recognize only the named
          // copy helper's literal validated reads. Arithmetic, other functions
          // and every mutation in that same file remain guarded.
          const searchProjection =
            file === "packages/rules-core/src/ai-search-deck-knowledge.ts" &&
            owner === "projectObservedZoneCounts" &&
            isObservedCountCopy(node, name);
          if (!projection && !searchProjection)
            report(
              file,
              "zone counts must be written by the card-instance state owner"
            );
        }
        if (
          name === "zoneCountMode" &&
          !(factory && owner === "createEmptyGameState") &&
          !phaseMetadata &&
          !searchFieldMetadata
        ) {
          report(
            file,
            "abstract zone counts are restricted to the explicit fixture factory"
          );
        }
      }
      const mutated =
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ? node.left
          : (ts.isPrefixUnaryExpression(node) ||
                ts.isPostfixUnaryExpression(node)) &&
              [
                ts.SyntaxKind.PlusPlusToken,
                ts.SyntaxKind.MinusMinusToken,
              ].includes(node.operator)
            ? node.operand
            : undefined;
      const mutatedName =
        mutated &&
        (ts.isPropertyAccessExpression(mutated)
          ? mutated.name.text
          : ts.isElementAccessExpression(mutated) &&
              ts.isStringLiteral(mutated.argumentExpression)
            ? mutated.argumentExpression.text
            : undefined);
      if (["handCount", "deckCount", "zoneCountMode"].includes(mutatedName)) {
        report(file, "zone counts and their mode cannot be mutated in place");
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        isIndexedArray(node.initializer)
      )
        aliases.add(node.name.text);
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        mutators.has(node.expression.name.text) &&
        isIndexedArray(node.expression.expression)
      )
        report(
          file,
          `in-place indexed array mutation: ${node.expression.getText(tree)}`
        );
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        !ts.isIdentifier(node.left) &&
        (isIndexedArray(node.left) ||
          ((ts.isElementAccessExpression(node.left) ||
            ts.isPropertyAccessExpression(node.left)) &&
            isIndexedArray(node.left.expression)))
      )
        report(
          file,
          "indexed arrays must be replaced together with a new state object"
        );
      ts.forEachChild(node, walk);
    };
    walk(tree);
  }
  return issues;
}
