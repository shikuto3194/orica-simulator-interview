#!/usr/bin/env node
/**
 * stub-readiness.mjs — fidelity stub を「着手可」「ENGINE 待ち」「設計判断待ち」に分類する。
 *
 * worker (engine-claude / card-impl lane) の起動 prompt に客観データを inject するためのもの。
 * 「全 stub が primitive 待ち」と過剰一般化して空回りするのを防ぐ。
 *
 * 入力:
 *   - node scripts/cards-fidelity-audit.mjs --json (violations[])
 *   - autorun-queue/needs-dsl.*.jsonl の parked ENGINE エントリ
 *
 * 分類ルール（ヒューリスティック）:
 *   - BLOCKED-BY-ENGINE: detail が parked ENGINE タグ（contract-combine 等）に
 *     一致するキーワードを含む
 *   - BLOCKED-BY-QUARTZ: detail に「クォーツ set-effect システム未実装」/
 *     「クォーツ.*未実装」のシグネチャ
 *   - BLOCKED-BY-MISSING-PRIMITIVE: detail に「未対応」「未実装」「未対応のため」
 *     「primitive 未着地」が含まれるが上記分類に当てはまらない
 *   - READY: 上記のどれにも当てはまらない（既存 primitive 流用で書ける可能性大）
 *
 * Usage:
 *   node scripts/stub-readiness.mjs                # 集計表
 *   node scripts/stub-readiness.mjs --ready        # READY 候補のみ列挙（worker prompt 用）
 *   node scripts/stub-readiness.mjs --json         # 全分類を JSON で
 *   node scripts/stub-readiness.mjs --top N        # READY 上位 N 件
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(__dirname);
const args = process.argv.slice(2);
const READY_ONLY = args.includes("--ready");
const JSON_ONLY = args.includes("--json");
const TOP_IDX = args.indexOf("--top");
const TOP_N = TOP_IDX >= 0 ? Number(args[TOP_IDX + 1]) : null;

function parkedEngineEntries() {
  const queueFiles = [
    "autorun-queue/needs-dsl.audit.jsonl",
    "autorun-queue/needs-dsl.w1.jsonl",
  ];
  const entries = [];
  for (const rel of queueFiles) {
    const path = join(REPO, rel);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const status = row.status;
      if (status !== "open") continue;
      if (!row.parked && !row.parkedReason) continue;
      const cardNo = row.cardNo || "";
      if (!cardNo.startsWith("ENGINE-")) {
        // ENGINE-* park 以外（具体カードの park）も blocker キーワードに使う
        const reason = row.parkedReason || "";
        if (reason.includes("ENGINE-")) {
          const m = reason.match(/ENGINE-[A-Za-z0-9-]+/g) || [];
          for (const tag of m) {
            entries.push({ tag, source: cardNo });
          }
        }
        continue;
      }
      entries.push({ tag: cardNo, source: cardNo });
    }
  }
  return entries;
}

function buildBlockerKeywords(parked) {
  // ENGINE-foo-bar-baz → "foo bar baz" / "foo-bar-baz"
  const out = new Map();
  for (const { tag } of parked) {
    if (!tag.startsWith("ENGINE-")) continue;
    const stem = tag.slice("ENGINE-".length);
    out.set(stem, tag);
  }
  return out;
}

function classifyStub(detail, blockers) {
  const d = detail || "";
  // クォーツ set-effect は F2.4b ① 残（landed primitive あるが card 側 stub 多数）
  if (
    /クォーツ.*未実装|クォーツ.*未対応|クォーツ set-effect|【クォーツ/.test(d)
  ) {
    return { kind: "BLOCKED-BY-QUARTZ", blocker: "F2-quartz set-effect" };
  }
  // 既知 ENGINE blocker キーワードと照合
  for (const [stem, tag] of blockers.entries()) {
    const words = stem.split("-");
    // 全 word が detail に含まれていれば match
    if (words.every((w) => w.length >= 3 && d.toLowerCase().includes(w))) {
      return { kind: "BLOCKED-BY-ENGINE", blocker: tag };
    }
  }
  // 未対応シグナル（広めに拾う: 言い換え 10+ パターン）
  const unsupported = [
    /未対応/,
    /未実装/,
    /未配線/,
    /未表現/,
    /未着地/,
    /未代替/,
    /未表現のため未/,
    /primitive 未/,
    /基盤未/,
    /システム未/,
    /無いため/,
    /がない為/,
    /が無い(?:。|$|ため)/,
    /アクション\/?CE が無い/,
    /ハンドラが無い/,
    /既存.*?が無い/,
  ];
  if (unsupported.some((re) => re.test(d))) {
    return { kind: "BLOCKED-BY-MISSING-PRIMITIVE", blocker: null };
  }
  return { kind: "READY", blocker: null };
}

function loadFidelityJson() {
  // 直接 cards-fidelity-audit.mjs を子プロセスで JSON 出力させる
  const out = execFileSync(
    process.execPath,
    [join(REPO, "scripts", "cards-fidelity-audit.mjs"), "--json"],
    { cwd: REPO, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

function main() {
  const parked = parkedEngineEntries();
  const blockers = buildBlockerKeywords(parked);
  const fidelity = loadFidelityJson();
  const buckets = {
    READY: [],
    "BLOCKED-BY-QUARTZ": [],
    "BLOCKED-BY-ENGINE": [],
    "BLOCKED-BY-MISSING-PRIMITIVE": [],
  };
  for (const v of fidelity.violations || []) {
    if (v.kind !== "stub") continue;
    const cls = classifyStub(v.detail, blockers);
    buckets[cls.kind].push({
      cardNo: v.cardNo,
      detail: v.detail,
      blocker: cls.blocker,
    });
  }

  if (JSON_ONLY) {
    const out = {
      generatedAt: new Date().toISOString(),
      blockerCount: blockers.size,
      totals: Object.fromEntries(
        Object.entries(buckets).map(([k, v]) => [k, v.length])
      ),
      buckets,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  if (READY_ONLY) {
    const list = buckets.READY.slice(0, TOP_N ?? buckets.READY.length);
    if (list.length === 0) {
      console.log("[stub-readiness] READY 候補なし");
      return;
    }
    console.log(`[stub-readiness] READY ${list.length} 件 (上位):`);
    for (const item of list) {
      const detail =
        item.detail.length > 140
          ? item.detail.slice(0, 140) + "..."
          : item.detail;
      console.log(`  ${item.cardNo}: ${detail}`);
    }
    return;
  }

  console.log("=== stub-readiness 分類 ===");
  console.log(`parked ENGINE blockers: ${blockers.size}`);
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`  ${k.padEnd(32)} ${v.length}`);
  }
  console.log("");
  console.log("先頭 READY サンプル:");
  for (const item of buckets.READY.slice(0, 10)) {
    const detail =
      item.detail.length > 100
        ? item.detail.slice(0, 100) + "..."
        : item.detail;
    console.log(`  ${item.cardNo}: ${detail}`);
  }
}

main();
