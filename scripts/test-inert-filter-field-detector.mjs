#!/usr/bin/env node
/**
 * inert-filter-field-detector.mjs の単体テスト。pure 関数のため card-data ビルドや
 * engine 状態に依存しない。`node scripts/test-inert-filter-field-detector.mjs` で実行。
 *
 * 期待: `targetsGrandwalker` が `"only"` 以外のときの `grandwalkerKind` だけを不活性と判定し、
 * `"only"` 配下 / ConditionClause 側 (`targetsGrandwalker` を持たない) を false positive に
 * しないこと。深いネスト (choice 配下等) も拾うこと。
 */
import { findInertFilterFields } from "./inert-filter-field-detector.mjs";

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
}

const inert = { targetsGrandwalker: true, grandwalkerKind: "grandwalker" };
const active = { targetsGrandwalker: "only", grandwalkerKind: "grandwalker" };
const condClause = { grandwalkerKind: "grandwalker" }; // targetsGrandwalker 無し

check(
  "targetsGrandwalker:true + grandwalkerKind → 不活性",
  findInertFilterFields([{ filter: inert }]).length === 1
);
check(
  'targetsGrandwalker:"only" → 不活性でない',
  findInertFilterFields([{ filter: active }]).length === 0
);
check(
  "ConditionClause 系 (targetsGrandwalker 無し) → 対象外",
  findInertFilterFields([{ condition: [condClause] }]).length === 0
);
check(
  'grandwalkerKind:"any" は絞り込みでないので対象外',
  findInertFilterFields([
    { filter: { targetsGrandwalker: true, grandwalkerKind: "any" } },
  ]).length === 0
);
check(
  "targetsGrandwalker 省略 + grandwalkerKind 無し → 何も出ない",
  findInertFilterFields([{ filter: { category: ["nexus"] } }]).length === 0
);

// 深いネスト (実バグ BSTH11-X03 は choice[0].action.from.filter にあった)
const nested = [
  { steps: [{ choice: [{ action: { from: { filter: inert } } }] }] },
];
const found = findInertFilterFields(nested);
check("深いネストも拾う", found.length === 1);
check(
  "path が報告される",
  found[0]?.path === "effects[0].steps[0].choice[0].action.from.filter"
);
check(
  "detail に短絡の根拠が含まれる",
  /admitsAsGrandwalkerOnlyTarget/.test(found[0]?.detail ?? "")
);

check("空 effects で落ちない", findInertFilterFields([]).length === 0);
check("undefined で落ちない", findInertFilterFields(undefined).length === 0);

console.log(`inert-filter-field-detector: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
