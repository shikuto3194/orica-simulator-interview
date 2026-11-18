#!/usr/bin/env node
/**
 * classify-parked-retry.mjs — needs-dsl.audit.jsonl の open+parked エントリを
 * parkedReason から **failure park** / **blocker park** に機械分類し、
 * 各行に `retryPolicy` 構造化 field を付与する。
 *
 * worker (engine-claude / engine-drain) はこの field を読んで deep mode 起動判定する。
 * parkedReason free text を直接 regex する弱い制御を廃止し、構造化された判定根拠を提供する。
 *
 * 分類ルール:
 *   - parkedReason に「blocked-by-P3-\d+」「blocked-by-ENGINE-」「blocked-by-<具体名>」
 *     のいずれかが含まれる → kind="blocker", blockerRef = match した token
 *     retryCondition = "blocker_resolved" (該当 cluster/issue が done)
 *                    OR "cooldown_14d" (parked から 14 日経過)
 *   - parkedReason に「refute」「reverted」「round\s*\d+」「design-flaw」「multi-round」
 *     のいずれかが含まれる → kind="failure"
 *     retryCondition = "immediate" (deep mode で即再挑戦可能)
 *   - 上記いずれにも該当しない → kind="unclassified"
 *     retryCondition = "manual" (人手判断要)
 *
 * Usage:
 *   node scripts/classify-parked-retry.mjs                 # 集計表
 *   node scripts/classify-parked-retry.mjs --apply         # in-place で retryPolicy field を更新
 *   node scripts/classify-parked-retry.mjs --json          # 分類結果 JSON のみ
 *
 * Exit: 0=成功 / 1=ファイル不正 / 2=書き込み失敗
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const AUDIT_PATH = "autorun-queue/needs-dsl.audit.jsonl";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const JSON_ONLY = args.includes("--json");

const BLOCKER_PATTERNS = [
  { re: /blocked-by-(P3-\d+(?:-[a-z0-9-]+)?)/i, kind: "issue" },
  { re: /blocked-by-(ENGINE-[A-Za-z0-9-]+)/i, kind: "engine" },
  { re: /blocked-by-([a-z][a-z0-9-]{4,})/i, kind: "generic" },
];

// 「blocked-by-missing-primitive」等は "primitive/ruling が未設計" という内的な
// engineering gap の記述であり、P3-*/ENGINE-* のような外部の具体的依存先(done判定
// 可能な cluster/issue)を指していない。blockerRef が "missing-primitive" のような
// 固定文言だと blocker_resolved 判定が恒久的に false になり、14日 cooldown だけが
// 唯一の起動経路になって空回りする(2026-08-03 発見、BSTH11-X01系3件で確認)。
// FAILURE 相当として即時 deep mode 起動対象にする。
const DESIGN_GAP_PATTERNS = [/blocked-by-missing-(primitive|ruling)\b/i];

const FAILURE_PATTERNS = [
  /multi-?round[- ]?refute/i,
  /round\s*[2-9](?:[+]| or more)?/i,
  /reverted/i,
  /refute/i,
  /design[- ]?flaw/i,
];

function classify(reason) {
  if (!reason) return { kind: "unclassified", retryCondition: "manual" };
  // design gap (missing-primitive/-ruling) は generic blocker より先に判定する
  // (generic パターンが "blocked-by-missing-primitive" も拾ってしまうため)。
  if (DESIGN_GAP_PATTERNS.some((p) => p.test(reason))) {
    return {
      kind: "failure",
      retryCondition: "immediate_deep_mode",
    };
  }
  // blocker 優先（具体的 dependency があるなら failure 表記より優先）
  for (const { re, kind } of BLOCKER_PATTERNS) {
    const m = reason.match(re);
    if (m) {
      return {
        kind: "blocker",
        blockerType: kind,
        blockerRef: m[1],
        retryCondition: "blocker_resolved_or_cooldown_14d",
      };
    }
  }
  if (FAILURE_PATTERNS.some((p) => p.test(reason))) {
    return {
      kind: "failure",
      retryCondition: "immediate_deep_mode",
    };
  }
  return { kind: "unclassified", retryCondition: "manual" };
}

function loadLines() {
  if (!existsSync(AUDIT_PATH)) {
    console.error(`[classify-parked-retry] ${AUDIT_PATH} 不在`);
    process.exit(1);
  }
  const raw = readFileSync(AUDIT_PATH, "utf8");
  return raw.split(/\r?\n/);
}

function main() {
  const lines = loadLines();
  const summary = {
    total: 0,
    openParked: 0,
    failure: 0,
    blocker: 0,
    unclassified: 0,
    classifications: [],
  };
  const newLines = [];
  for (const line of lines) {
    if (!line.trim()) {
      newLines.push(line);
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      console.error(`[classify-parked-retry] parse 失敗: ${e.message}`);
      newLines.push(line);
      continue;
    }
    summary.total++;
    if (row.status === "open" && row.parked) {
      summary.openParked++;
      const policy = classify(row.parkedReason);
      summary[policy.kind]++;
      summary.classifications.push({
        cardNo: row.cardNo,
        parked: row.parked,
        parkedReason: (row.parkedReason || "").slice(0, 80),
        retryPolicy: policy,
      });
      row.retryPolicy = policy;
    } else if (row.retryPolicy) {
      // resolved/abandoned/non-parked になったエントリの retryPolicy は除去
      delete row.retryPolicy;
    }
    newLines.push(JSON.stringify(row));
  }

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  console.log("=== classify-parked-retry 集計 ===");
  console.log(`総行数: ${summary.total}`);
  console.log(`open+parked: ${summary.openParked}`);
  console.log(`  failure (immediate deep retry): ${summary.failure}`);
  console.log(`  blocker (待ち): ${summary.blocker}`);
  console.log(`  unclassified (manual): ${summary.unclassified}`);
  console.log("");
  console.log("=== 分類詳細 ===");
  for (const c of summary.classifications) {
    const ref = c.retryPolicy.blockerRef
      ? ` ref=${c.retryPolicy.blockerRef}`
      : "";
    console.log(
      `  ${c.cardNo.padEnd(50)} [${c.retryPolicy.kind}${ref}] parked=${c.parked}`
    );
    console.log(`    reason: ${c.parkedReason}`);
  }

  if (APPLY) {
    writeFileSync(AUDIT_PATH, newLines.join("\n"), "utf8");
    console.log(
      `\n[classify-parked-retry] --apply: ${AUDIT_PATH} に retryPolicy field を書き込み済`
    );
  } else {
    console.log("\n[classify-parked-retry] dry-run (--apply で in-place 更新)");
  }
}

main();
