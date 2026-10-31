import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ORIKA_REACT_CARD_DATA =
  "C:\\Users\\kensh\\OneDrive\\ドキュメント\\orika-react\\src\\cardData.js";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const sourceArg = args.find((arg) => !arg.startsWith("--"));
const sourcePath = path.resolve(sourceArg ?? DEFAULT_ORIKA_REACT_CARD_DATA);

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parse(filePath, text) {
  const scriptKind = filePath.endsWith(".ts")
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
}

function propName(prop) {
  if (!ts.isPropertyAssignment(prop)) return undefined;
  const name = prop.name;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function getProp(objectLiteral, name) {
  return objectLiteral.properties.find((prop) => propName(prop) === name);
}

function getAnyProp(objectLiteral, names) {
  for (const name of names) {
    const prop = getProp(objectLiteral, name);
    if (prop) return prop;
  }
  return undefined;
}

function stringValue(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function numberValue(node) {
  if (!node) return undefined;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return undefined;
}

function isBraveType(typeText) {
  if (!typeText) return true;
  return typeText.includes("ブレイヴ") || typeText === "brave";
}

function walk(sourceFile, visit) {
  const recur = (node) => {
    visit(node);
    ts.forEachChild(node, recur);
  };
  recur(sourceFile);
}

function collectBoosts(filePath) {
  const text = readText(filePath);
  const sourceFile = parse(filePath, text);
  const boosts = new Map();
  const duplicates = [];

  walk(sourceFile, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const cardNoProp = getAnyProp(node, ["cardNumber", "cardNo"]);
    const boostProp = getProp(node, "combinedBoost");
    if (!cardNoProp || !boostProp) return;

    const cardNo = stringValue(cardNoProp.initializer);
    const boost = numberValue(boostProp.initializer);
    const typeText = stringValue(
      getAnyProp(node, ["type", "printedCategory"])?.initializer
    );
    if (
      !cardNo ||
      boost === undefined ||
      !Number.isFinite(boost) ||
      !isBraveType(typeText)
    ) {
      return;
    }

    const existing = boosts.get(cardNo);
    if (existing !== undefined && existing !== boost) {
      duplicates.push({ cardNo, previous: existing, next: boost });
    }
    boosts.set(cardNo, boost);
  });

  return { boosts, duplicates };
}

function lineIndent(text, pos) {
  const lineStart = text.lastIndexOf("\n", pos) + 1;
  const match = text.slice(lineStart, pos).match(/^[ \t]*/);
  return match?.[0] ?? "";
}

function plannedChangesForFile(filePath, referenceBoosts) {
  const text = readText(filePath);
  const sourceFile = parse(filePath, text);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const edits = [];
  const changes = [];

  walk(sourceFile, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const cardNoProp = getAnyProp(node, ["cardNumber", "cardNo"]);
    if (!cardNoProp) return;
    const cardNo = stringValue(cardNoProp.initializer);
    if (!cardNo || !referenceBoosts.has(cardNo)) return;

    const expected = referenceBoosts.get(cardNo);
    const boostProp = getProp(node, "combinedBoost");
    if (boostProp) {
      const actual = numberValue(boostProp.initializer);
      if (actual === expected) return;
      edits.push({
        start: boostProp.initializer.getStart(sourceFile),
        end: boostProp.initializer.getEnd(),
        replacement: String(expected),
      });
      changes.push({ cardNo, from: actual, to: expected, kind: "update" });
      return;
    }

    const anchor = getAnyProp(node, ["levelDefs", "levels"]) ?? cardNoProp;
    const indent = lineIndent(text, anchor.getStart(sourceFile));
    edits.push({
      start: anchor.getEnd(),
      end: anchor.getEnd(),
      replacement: `,${newline}${indent}combinedBoost: ${expected}`,
    });
    changes.push({ cardNo, from: undefined, to: expected, kind: "insert" });
  });

  return { text, edits, changes };
}

function applyEdits(text, edits) {
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

function listTargetFiles() {
  const files = [path.join(ROOT, "packages/card-data/raw/cardData.js")];
  for (const dir of [
    path.join(ROOT, "packages/card-data/raw/by-pack"),
    path.join(ROOT, "packages/card-data/src/cards"),
  ]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".ts")) continue;
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const { boosts, duplicates } = collectBoosts(sourcePath);
if (duplicates.length > 0) {
  console.warn(
    "Reference has duplicate card numbers with differing combinedBoost:"
  );
  for (const dup of duplicates) {
    console.warn(`  ${dup.cardNo}: ${dup.previous} -> ${dup.next}`);
  }
}

const allChanges = [];
for (const filePath of listTargetFiles()) {
  const plan = plannedChangesForFile(filePath, boosts);
  if (plan.edits.length === 0) continue;
  allChanges.push({ filePath, changes: plan.changes });
  if (!checkOnly) {
    fs.writeFileSync(filePath, applyEdits(plan.text, plan.edits), "utf8");
  }
}

const changeCount = allChanges.reduce(
  (sum, item) => sum + item.changes.length,
  0
);
console.log(`Reference combinedBoost entries: ${boosts.size}`);
console.log(
  `${checkOnly ? "Would change" : "Changed"} ${changeCount} entries in ${allChanges.length} files.`
);
for (const item of allChanges) {
  const rel = path.relative(ROOT, item.filePath).replaceAll("\\", "/");
  console.log(`\n${rel}`);
  for (const change of item.changes) {
    const from = change.from === undefined ? "(missing)" : change.from;
    console.log(`  ${change.cardNo}: ${from} -> ${change.to} (${change.kind})`);
  }
}

if (checkOnly && changeCount > 0) {
  process.exitCode = 1;
}
