#!/usr/bin/env node
/**
 * scan:ssot-candidates — 「まだ登録されていない正源」の並行実装候補を決定論的に列挙する探索器。
 *
 * `check-ssot.mjs` との役割分担 (両者は補集合):
 * - check:ssot は **RULES に登録済みの概念** だけを見る gate (偽陽性ゼロを優先する設計)。
 *   → 穴は常に「まだ登録していない概念」側にできる。
 * - 本スクリプトは **未登録概念** の候補を出す探索器。gate ではない (常に exit 0)。
 *   出した候補を人/worker が「正源へ寄せる」か「別概念として分類する」まで消し込み、
 *   全件分類し切ったら check-ssot.mjs の RULES へ *卒業* させる。
 *
 * 卒業したら PROBES から probe を削除する。RULES 名との衝突は graduation warning で
 * 機械検出するので、2 レジストリが同じ概念を二重に持つことはない。
 *
 * 分類の粒度は **file + マッチ形状** (行番号ではない)。行番号キーは無関係な編集で
 * 壊れて分類が失効するため採らない。同一ファイル内の同形状マッチはまとめて 1 分類。
 *
 * 運用ループの正源: manual/ai-reference/30_plan/guard-audit-runbook.md
 *
 * Usage:
 *   node scripts/ssot-candidate-scan.mjs           # 未分類候補を列挙 (常に exit 0)
 *   node scripts/ssot-candidate-scan.mjs --all     # 分類済みも含めて全マッチを表示
 *   node scripts/ssot-candidate-scan.mjs --json    # 機械可読 (cluster evidence 生成用)
 *   node scripts/ssot-candidate-scan.mjs --gate    # 未分類が残れば exit 1 (停止条件 8 用)
 *
 * `--gate` はフルラン停止条件の 8 番目 (full-run-supervisor.md)。これが無いと、
 * fidelity violations 0 到達 = 停止条件 2 達成と同時にフルランが止まり、
 * 本ループの cluster (precondition: fidelity-total-zero で解禁される) が
 * 永久に claim されないまま残る。
 *
 * 限界 (承知の上): gate が見るのは **登録済み probe の未分類** だけで、
 * 「まだ思いついていない probe」は判定できない。PROBES が空なら自明に緑になる。
 * probe を足す判断は人 (または planner) の仕事であって、停止条件で機械化できない。
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  ".turbo",
  ".vite",
  "coverage",
  "playwright-report",
  "test-results",
  "debug-screenshots",
]);

const SCAN_ROOTS = ["apps", "packages"];
const SOURCE_RE = /\.(ts|tsx)$/;

// テストは意図的に生の判定を書くことがある (正源の挙動を固定する assert 等)。
const COMMON_ALLOW = [/[\\/]test[\\/]/, /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/];

// ------------------------------------------------------------------
// probe 定義
// ------------------------------------------------------------------

// P3-139 に続き、tribe-match-inline probe (系統トークン集合に対する some/every +
// includes による系統マッチ判定のインライン実装) は 2026-08-05 に全件分類済に到達し
// check-ssot.mjs の RULES (`tribe-match-inline`) へ卒業した。恒久 gate はそちらを参照。
// 判断基準 (subset-type-unification、(a) matchesTribes 統合 / (b) 別概念分類) は
// check-ssot.mjs の TRIBE_MATCH_INLINE_BASELINE_FILES コメントへ移植済み。

// guard-audit-card-filter-projection: card-filter-enumerated-projection probe
// (CardFilter 系の値を per-field 条件付きスプレッドで列挙コピーしている射影) は
// 2026-08-05 に全件分類済 (native-action-registry.ts / native-ce-registration-
// handlers.ts / native-target-resolution.ts / structured-cost-gate.ts の 5 経路を
// 素のスプレッドへ統合) に到達し check-ssot.mjs の RULES
// (`card-filter-enumerated-projection`) へ卒業した。恒久 gate はそちらを参照。

// core-source-takeable-parallel probe は 2026-08-05 に全件修正済
// (required-effect-cost-gate.ts を getFieldCoreSourceTakeableCount へ統合、
// structured-core-move.ts の redundant filter 再判定を削除) に到達し
// check-ssot.mjs の RULES (`core-source-takeable-parallel`) へ卒業した。
// 恒久 gate はそちらを参照。

// P3-139: kind dispatch の `default:` が具体ドメイン値へ silent fallback する構造を
// 検出していた probe `kind-dispatch-silent-default` は、2026-08-04 に全件分類済に到達し
// check-ssot.mjs の RULES (`kind-dispatch-silent-default`) へ卒業した。恒久 gate は
// そちらを参照。

const PROBES = [];

// check-ssot.mjs に既に登録済みの RULE 名 (卒業判定用)。
// 同名が両方に存在する = 卒業漏れ or 二重管理。
const GRADUATED_RULE_NAMES = [
  "core-zone-display-mapping",
  "target-affect-gate-consumer",
  "stack-window-opener-direct-call",
  "exclude-category-effective-lookup",
  "kind-dispatch-silent-default",
  "tribe-match-inline",
  "card-filter-enumerated-projection",
  "core-source-takeable-parallel",
];

// ------------------------------------------------------------------

async function collectSourceFiles() {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(abs);
      } else if (SOURCE_RE.test(e.name)) {
        files.push(abs);
      }
    }
  }
  for (const r of SCAN_ROOTS) await walk(join(ROOT, r));
  return files;
}

function toPosix(absPath) {
  return relative(ROOT, absPath).replaceAll("\\", "/");
}

function normalizeMatch(text) {
  return text.replace(/\s+/g, " ").trim();
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

async function runProbe(probe, files, cache) {
  const hits = [];
  for (const abs of files) {
    const rel = toPosix(abs);
    const winNorm = rel.replaceAll("/", "\\");
    if (probe.scope && !probe.scope.test(winNorm) && !probe.scope.test(rel))
      continue;
    if (COMMON_ALLOW.some((re) => re.test(winNorm))) continue;
    if (probe.allow.some((re) => re.test(winNorm))) continue;

    let text = cache.get(abs);
    if (text === undefined) {
      text = await readFile(abs, "utf8");
      cache.set(abs, text);
    }
    // probe は `pattern` (単一 regex、各マッチ = 1 候補) か `find(text)` (複数マッチを
    // まとめて 1 候補にする等の集約が要るもの) のどちらかを持つ。
    let raw;
    if (probe.find) {
      raw = probe.find(text);
    } else {
      raw = [];
      probe.pattern.lastIndex = 0;
      let m;
      while ((m = probe.pattern.exec(text)) !== null) {
        raw.push({ index: m.index, match: m[0] });
      }
    }
    for (const r of raw) {
      const snippet = normalizeMatch(r.match);
      const classified = probe.classified.find(
        (c) => c.file === rel && normalizeMatch(c.match) === snippet
      );
      hits.push({
        file: rel,
        line: lineOf(text, r.index),
        match: snippet,
        classified: classified ? classified.reason : null,
      });
    }
  }
  return hits;
}

async function main() {
  const showAll = process.argv.includes("--all");
  const asJson = process.argv.includes("--json");
  const gate = process.argv.includes("--gate");
  const files = await collectSourceFiles();
  const cache = new Map();

  const report = [];
  for (const probe of PROBES) {
    const hits = await runProbe(probe, files, cache);
    report.push({
      probe: probe.name,
      description: probe.description,
      canonical: probe.canonical,
      unclassified: hits.filter((h) => h.classified === null),
      classified: hits.filter((h) => h.classified !== null),
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ probes: report }, null, 2));
    return 0;
  }

  let totalUnclassified = 0;
  for (const r of report) {
    const shown = showAll
      ? [...r.unclassified, ...r.classified]
      : r.unclassified;
    totalUnclassified += r.unclassified.length;
    console.log(
      `# probe: ${r.probe} — 未分類 ${r.unclassified.length} / 分類済 ${r.classified.length}`
    );
    console.log(`  正源: ${r.canonical}`);
    for (const h of shown) {
      const tag = h.classified ? `[分類済: ${h.classified}]` : "[未分類]";
      console.log(`  ${tag} ${h.file}:${h.line}`);
      console.log(`      ${h.match}`);
    }
    if (r.unclassified.length === 0) {
      console.log(
        `  → 全件分類済。check-ssot.mjs の RULES へ卒業させ、本 probe を PROBES から削除すること。`
      );
    }
    console.log("");
  }

  // 卒業漏れ / 二重管理の機械検出。
  for (const probe of PROBES) {
    if (GRADUATED_RULE_NAMES.includes(probe.name)) {
      console.warn(
        `WARN: probe "${probe.name}" は check-ssot.mjs の RULES にも存在する (二重管理)。` +
          ` gate 化が済んでいるので PROBES から削除すること。`
      );
    }
  }

  if (gate) {
    console.log(
      `停止条件 8 (未分類 0): ${totalUnclassified === 0 ? "✅ 達成" : `❌ 未達 (${totalUnclassified} 件)`}` +
        ` — ${PROBES.length} probe(s)`
    );
    return totalUnclassified === 0 ? 0 : 1;
  }

  console.log(
    `scan:ssot-candidates: ${PROBES.length} probe(s), 未分類 ${totalUnclassified} 件。` +
      ` (探索器のため exit 0。--gate で停止条件判定、卒業後の恒久 gate は check:ssot)`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("scan:ssot-candidates crashed:", err);
    process.exit(1);
  });
