/**
 * DL AI choice coverage guard.
 *
 * LegalAction.kind covers the top-level action menu. Human/AI parameter choices
 * such as payment source, target selection, mulligan-adjacent setup choices, and
 * core distribution are carried by ApplyLegalActionOptions instead. This test
 * fails when a new ApplyLegalActionOptions field is added without classifying
 * whether learning AI must see it as a decision input.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  APPLY_OPTION_FIELD_ROLES,
  SELFPLAY_AUTO_INPUT_FIELDS,
  type ApplyOptionFieldRole,
} from "./ai-action-input-fields";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGAL_ACTION_TYPES_PATH = resolve(
  __dirname,
  "../../../packages/rules-core/src/legal/legal-actions-types.ts"
);
const GAME_API_PATH = resolve(__dirname, "../server/game-api.ts");
const SELFPLAY_DRIVER_PATH = resolve(__dirname, "./selfplay-driver.ts");
const SHARED_INPUT_PATH = resolve(
  __dirname,
  "../../../packages/rules-core/src/action-input-choices.ts"
);

function functionBody(file: ts.SourceFile, name: string): ts.Block {
  const fn = file.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  if (!fn?.body) throw new Error(`${name} function body not found`);
  return fn.body;
}

function caseBody(
  file: ts.SourceFile,
  functionName: string,
  kind: string
): ts.CaseClause {
  let found: ts.CaseClause | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCaseClause(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === kind
    )
      found = node;
    ts.forEachChild(node, visit);
  };
  visit(functionBody(file, functionName));
  if (!found) throw new Error(`${functionName}: ${kind} case not found`);
  return found;
}

function caseCalls(
  file: ts.SourceFile,
  functionName: string,
  kind: string,
  callee: string
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCaseClause(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === kind
    ) {
      const calls = (child: ts.Node): void => {
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === callee
        )
          found = true;
        ts.forEachChild(child, calls);
      };
      const clauses = (node.parent as ts.CaseBlock).clauses;
      let index = clauses.indexOf(node);
      // Empty cases intentionally share the following case's input builder.
      // Do not infer delegation across a case with its own statements.
      while (index >= 0 && index < clauses.length) {
        const clause = clauses[index]!;
        clause.statements.forEach(calls);
        if (clause.statements.length > 0) break;
        index += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionBody(file, functionName));
  return found;
}

function collectCallObjectFields(
  file: ts.SourceFile,
  functionName: string,
  callee: string,
  argumentIndex = 0,
  kind?: string
): string[] {
  const fields: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === callee &&
      node.arguments[argumentIndex]
    )
      fields.push(
        ...collectDirectObjectPropertyNames(node.arguments[argumentIndex]!)
      );
    ts.forEachChild(node, visit);
  };
  visit(
    kind ? caseBody(file, functionName, kind) : functionBody(file, functionName)
  );
  return sortedUnique(fields);
}

function collectPaymentInputFields(
  file: ts.SourceFile,
  functionName: string,
  kind?: string
): string[] {
  const fields: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "generatePaymentSourceOptions" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties)
        if (
          ts.isPropertyAssignment(property) &&
          propertyNameText(property.name) === "field" &&
          ts.isStringLiteral(property.initializer)
        )
          fields.push(property.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(
    kind ? caseBody(file, functionName, kind) : functionBody(file, functionName)
  );
  return sortedUnique(fields);
}

function collectMappedObjectFields(
  file: ts.SourceFile,
  functionName: string
): string[] {
  const fields: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map" &&
      node.arguments[0] &&
      ts.isArrowFunction(node.arguments[0]) &&
      !ts.isBlock(node.arguments[0].body)
    ) {
      fields.push(...collectDirectObjectPropertyNames(node.arguments[0].body));
    }
    ts.forEachChild(node, visit);
  };
  visit(functionBody(file, functionName));
  return sortedUnique(fields);
}

function sourceFile(path: string): ts.SourceFile {
  const source = readFileSync(path, "utf8");
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}

function propertyNameText(name: ts.PropertyName): string {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  throw new Error(`Unsupported property name: ${name.getText()}`);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function collectInterfaceFields(
  file: ts.SourceFile,
  interfaceName: string
): string[] {
  for (const statement of file.statements) {
    if (
      !ts.isInterfaceDeclaration(statement) ||
      statement.name.text !== interfaceName
    ) {
      continue;
    }
    return sortedUnique(
      statement.members
        .filter(ts.isPropertySignature)
        .map((member) => propertyNameText(member.name))
    );
  }
  throw new Error(`${interfaceName} interface not found`);
}

function collectStringArrayConst(
  file: ts.SourceFile,
  constName: string
): string[] {
  let values: string[] | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`${constName} is not an array literal`);
      }
      values = initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) {
          throw new Error(`${constName} contains a non-string element`);
        }
        return element.text;
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  if (!values) throw new Error(`${constName} const not found`);
  return sortedUnique(values);
}

function collectDirectObjectPropertyNames(expression: ts.Expression): string[] {
  const current = unwrapExpression(expression);
  if (ts.isConditionalExpression(current)) {
    return [
      ...collectDirectObjectPropertyNames(current.whenTrue),
      ...collectDirectObjectPropertyNames(current.whenFalse),
    ];
  }
  if (!ts.isObjectLiteralExpression(current)) return [];

  return current.properties.flatMap((property) => {
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property)
    ) {
      return [propertyNameText(property.name)];
    }
    if (ts.isSpreadAssignment(property)) {
      return collectDirectObjectPropertyNames(property.expression);
    }
    return [];
  });
}

function collectReturnObjectFieldsInFunction(
  file: ts.SourceFile,
  functionName: string
): string[] {
  const fields: string[] = [];
  let found = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === functionName &&
      node.body
    ) {
      found = true;
      const visitBody = (child: ts.Node): void => {
        if (ts.isReturnStatement(child) && child.expression) {
          fields.push(...collectDirectObjectPropertyNames(child.expression));
        }
        ts.forEachChild(child, visitBody);
      };
      visitBody(node.body);
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  if (!found) throw new Error(`${functionName} function not found`);
  return sortedUnique(fields);
}

function fieldsForRole(role: ApplyOptionFieldRole): string[] {
  return sortedUnique(
    Object.entries(APPLY_OPTION_FIELD_ROLES)
      .filter(([, fieldRole]) => fieldRole === role)
      .map(([field]) => field)
  );
}

describe("AI action input coverage", () => {
  it("classifies every ApplyLegalActionOptions field", () => {
    const declaredFields = collectInterfaceFields(
      sourceFile(LEGAL_ACTION_TYPES_PATH),
      "ApplyLegalActionOptions"
    );
    const classifiedFields = sortedUnique(
      Object.keys(APPLY_OPTION_FIELD_ROLES)
    );

    expect(classifiedFields).toEqual(declaredFields);
  });

  it("passes every AI-decision ApplyLegalActionOptions field through the action API", () => {
    const passthroughFields = collectStringArrayConst(
      sourceFile(GAME_API_PATH),
      "passthroughKeys"
    );

    expect(passthroughFields).toEqual(fieldsForRole("ai_decision"));
  });

  it("keeps self-play fuzz auto-filled inputs explicit and classified", () => {
    const driver = sourceFile(SELFPLAY_DRIVER_PATH);
    const shared = sourceFile(SHARED_INPUT_PATH);
    // 委譲後も数量選択・カードごとの行先・支払い/コア配分を分類対象に保持する。
    // caseからの実配線と、生成器が実際に渡すobjectキーを照合する。
    expect(
      caseCalls(
        driver,
        "resolveActionInputs",
        "resolve_pending_zone_selection",
        "generateActionInputChoices"
      )
    ).toBe(true);
    expect(
      caseCalls(
        shared,
        "generateActionInputChoices",
        "resolve_pending_zone_selection",
        "zoneSelectionChoices"
      )
    ).toBe(true);
    for (const kind of [
      "resolve_pending_effect_target",
      "resolve_pending_step_optional_target_selection",
    ]) {
      expect(
        caseCalls(
          driver,
          "resolveActionInputs",
          kind,
          "generateActionInputChoices"
        )
      ).toBe(true);
      expect(
        caseCalls(
          shared,
          "generateActionInputChoices",
          kind,
          "targetInputGroup"
        )
      ).toBe(true);
    }
    const coreMoveKind = "resolve_pending_summon_cost_core_move_choice";
    const excludeKind = "resolve_pending_summon_cost_exclude_choice";
    for (const kind of [coreMoveKind, excludeKind])
      expect(
        caseCalls(
          driver,
          "resolveActionInputs",
          kind,
          "generateActionInputChoices"
        )
      ).toBe(true);
    for (const [file, name] of [
      [driver, "resolveActionInputs"],
      [shared, "generateActionInputChoices"],
    ] as const)
      expect(
        caseCalls(
          file,
          name,
          excludeKind,
          "summonCostExcludePaymentChoicesForSelection"
        )
      ).toBe(true);
    const excludePaymentFields = collectPaymentInputFields(
      shared,
      "summonCostExcludePaymentChoicesForSelection"
    );
    const coreMovePaymentFields = collectPaymentInputFields(
      shared,
      "generateActionInputChoices",
      coreMoveKind
    );
    expect(excludePaymentFields).toEqual(["paymentSources"]);
    expect(coreMovePaymentFields).toEqual(["paymentSources"]);
    const autoFilledFields = sortedUnique([
      ...collectReturnObjectFieldsInFunction(driver, "resolveActionInputs"),
      ...collectCallObjectFields(shared, "zoneSelectionChoices", "addPayment"),
      ...collectMappedObjectFields(shared, "targetInputGroup"),
      ...collectCallObjectFields(
        shared,
        "generateActionInputChoices",
        "pushLimited",
        1,
        coreMoveKind
      ),
      ...excludePaymentFields,
      ...coreMovePaymentFields,
    ]);

    expect(autoFilledFields).toEqual([...SELFPLAY_AUTO_INPUT_FIELDS].sort());
    expect(
      autoFilledFields.filter(
        (field) => APPLY_OPTION_FIELD_ROLES[field] !== "ai_decision"
      )
    ).toEqual([]);
  });

  it("detects renamed shared core-move and payment fields in memory", () => {
    const fixture = ts.createSourceFile(
      "cost-input-fixture.ts",
      'function generateActionInputChoices(action: any) { switch(action.kind) { case "cost": generatePaymentSourceOptions({ field: "paymentSourcesBROKEN" }); pushLimited(acc, { summonCostCoreMoveAllocationsBROKEN: [] }); } }',
      ts.ScriptTarget.Latest,
      true
    );
    const fields = [
      ...collectCallObjectFields(
        fixture,
        "generateActionInputChoices",
        "pushLimited",
        1,
        "cost"
      ),
      ...collectPaymentInputFields(
        fixture,
        "generateActionInputChoices",
        "cost"
      ),
    ];
    expect(fields).toEqual([
      "summonCostCoreMoveAllocationsBROKEN",
      "paymentSourcesBROKEN",
    ]);
    expect(
      fields.filter(
        (field) => APPLY_OPTION_FIELD_ROLES[field] !== "ai_decision"
      )
    ).toEqual(fields);
  });

  it("detects a broken delegation or a renamed shared target input in memory", () => {
    const fixture = ts.createSourceFile(
      "target-input-fixture.ts",
      'function resolveActionInputs(action: any) { switch(action.kind) { case "target": case "optional": return generateActionInputChoices(); case "broken": return {}; } } function targetInputGroup() { return ids.map(id => ({ targetInstanceIdsBROKEN: [id] })); }',
      ts.ScriptTarget.Latest,
      true
    );
    expect(
      caseCalls(
        fixture,
        "resolveActionInputs",
        "target",
        "generateActionInputChoices"
      )
    ).toBe(true);
    expect(
      caseCalls(
        fixture,
        "resolveActionInputs",
        "broken",
        "generateActionInputChoices"
      )
    ).toBe(false);
    const fields = collectMappedObjectFields(fixture, "targetInputGroup");
    expect(fields).toEqual(["targetInstanceIdsBROKEN"]);
    expect(
      fields.filter(
        (field) => APPLY_OPTION_FIELD_ROLES[field] !== "ai_decision"
      )
    ).toEqual(fields);
  });
});
