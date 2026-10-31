import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// 実行経路の監査記録: 03_completed-milestones-phase-6-trigger-boundary-audit.md。
// CE 再構築はイベント実行ではない。それ以外の interpreter 呼び出しは
// after_triggers にも到達するので、外側 finalizer だけに lookup を渡しても不十分。
it("全効果実行・継続経路が誘発とバーストの登録情報を引き継ぐ", () => {
  const root = join(process.cwd(), "packages/rules-core/src");
  const violations: string[] = [];
  let executionSites = 0;
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!path.endsWith(".ts")) continue;
      const file = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          [
            "executeEffect",
            "executeEffectFn",
            "args.executeEffectFn",
            "resolution.execute",
          ].includes(node.expression.getText(file))
        ) {
          executionSites++;
          const argument = node.arguments[0];
          const keys =
            argument && ts.isObjectLiteralExpression(argument)
              ? argument.properties.map((property) =>
                  property.name?.getText(file)
                )
              : [];
          const text = argument?.getText(file) ?? "";
          if (entry.name === "effect-resolution-scope.ts") {
            expect(text).toContain("...options");
            return;
          }
          for (const lookup of [
            "getRegisteredTriggeredEffectActions",
            "getRegisteredBurstActions",
          ]) {
            if (
              lookup === "getRegisteredBurstActions" &&
              entry.name === "continuous-effect-rebuild.ts"
            )
              continue;
            if (!keys.includes(lookup) && !text.includes(lookup)) {
              violations.push(
                `${relative(root, path)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${lookup}`
              );
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  };
  walk(root);
  expect(executionSites).toBeGreaterThan(30);
  expect(violations).toEqual([]);
});
