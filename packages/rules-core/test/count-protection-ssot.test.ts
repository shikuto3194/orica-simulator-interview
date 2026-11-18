import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = join(__dirname, "../src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function protectedCountArithmeticViolations(path: string): string[] {
  if (path.endsWith("model.ts")) return [];
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const arithmeticOperators = new Set([
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.PercentToken,
  ]);

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      arithmeticOperators.has(node.operatorToken.kind)
    ) {
      const expression = node.getText(file);
      if (
        /\bcountValue\b/.test(expression) &&
        /\bprotectedCounts\b/.test(expression) &&
        !/\bcountValueVisibleToEffect\s*\(/.test(expression)
      ) {
        const { line } = file.getLineAndCharacterOfPosition(
          node.getStart(file)
        );
        violations.push(`${path}:${line + 1}: ${expression}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

describe("count protection SSOT", () => {
  it("keeps protected-count arithmetic behind the model helper", () => {
    const callers = sourceFiles(sourceRoot).flatMap((path) => {
      const contents = readFileSync(path, "utf8");
      return contents.includes("immuneProtectedCount(") &&
        !path.endsWith("model.ts")
        ? [path]
        : [];
    });
    const arithmetic = sourceFiles(sourceRoot).flatMap(
      protectedCountArithmeticViolations
    );

    expect({ callers, arithmetic }).toEqual({ callers: [], arithmetic: [] });
  });
});
