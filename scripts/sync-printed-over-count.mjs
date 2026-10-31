import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// 印字値だけを補完する。DSLのOC加算効果やengine用overCountには触れない。
const args = process.argv.slice(2);
const sourcePath =
  args.find((arg) => !arg.startsWith("--")) ??
  "packages/card-data/raw/cardData.js";
const check = args.includes("--check");
const parse = (file, text) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const prop = (node, name) =>
  node.properties.find(
    (p) =>
      ts.isPropertyAssignment(p) &&
      p.name.getText().replace(/["']/g, "") === name
  )?.initializer;
const string = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
function walk(node, visit) {
  if (ts.isObjectLiteralExpression(node)) visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
const reference = new Map();
walk(parse(sourcePath, fs.readFileSync(sourcePath, "utf8")), (node) => {
  const oc = prop(node, "ocBoost");
  if (!oc) return;
  const front = prop(node, "front");
  const cardNo =
    string(prop(node, "cardNumber")) ??
    (front && string(prop(front, "cardNumber")));
  const min = /^OC(\d+)\+$/.exec(string(prop(oc, "levelLabel")) ?? "")?.[1];
  const bonus = /^\+(\d+)$/.exec(string(prop(oc, "bp")) ?? "")?.[1];
  if (!cardNo || min === undefined || bonus === undefined)
    throw new Error(`Invalid ocBoost: ${cardNo}`);
  const value = { minCount: Number(min), bpBonus: Number(bonus) };
  if (
    reference.has(cardNo) &&
    JSON.stringify(reference.get(cardNo)) !== JSON.stringify(value)
  ) {
    throw new Error(`Conflicting ocBoost: ${cardNo}`);
  }
  reference.set(cardNo, value);
});
if (!reference.size) throw new Error("No ocBoost found in source");
const seen = new Set();
let changed = 0;
const changedFiles = [];
for (const file of fs.readdirSync("packages/card-data/src/cards")) {
  if (!file.endsWith(".ts")) continue;
  const target = path.join("packages/card-data/src/cards", file);
  let text = fs.readFileSync(target, "utf8");
  const ast = parse(target, text);
  const edits = [];
  walk(ast, (node) => {
    const cardNo = string(prop(node, "cardNo"));
    const expected = reference.get(cardNo);
    if (!expected) return;
    seen.add(cardNo);
    const current = prop(node, "printedOverCount");
    if (
      current &&
      Number(prop(current, "minCount")?.getText()) === expected.minCount &&
      Number(prop(current, "bpBonus")?.getText()) === expected.bpBonus
    )
      return;
    const value = `{ minCount: ${expected.minCount}, bpBonus: ${expected.bpBonus} }`;
    if (current) {
      edits.push({
        start: current.getStart(ast),
        end: current.getEnd(),
        value,
      });
    } else {
      const anchor = prop(node, "levelDefs");
      if (!anchor) throw new Error(`Missing levels: ${cardNo}`);
      const indent = text
        .slice(text.lastIndexOf("\n", anchor.getStart(ast)) + 1)
        .match(/^[ \t]*/)[0];
      const newline = text.includes("\r\n") ? "\r\n" : "\n";
      edits.push({
        start: anchor.getEnd(),
        end: anchor.getEnd(),
        value: `,${newline}${indent}printedOverCount: ${value}`,
      });
    }
  });
  if (!edits.length) continue;
  changed += edits.length;
  changedFiles.push(target);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  }
  if (!check) fs.writeFileSync(target, text);
}
const missing = [...reference.keys()].filter((cardNo) => !seen.has(cardNo));
if (missing.length) throw new Error(`Missing cards: ${missing.join(", ")}`);
console.log(
  `Printed OC: ${reference.size} cards; ${check ? "missing/different" : "updated"}: ${changed}`
);
for (const file of changedFiles) console.log(file);
if (check && changed) process.exitCode = 1;
