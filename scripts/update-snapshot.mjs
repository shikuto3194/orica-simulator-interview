#!/usr/bin/env node
/**
 * update-snapshot — 02_detailed-todo.md の「残量」行を機械的に更新し、
 * 残量メトリクスの機械可読 ledger (fidelity-baseline.json) を維持する。
 *
 * 背景: engine-drain ループは 1 landing ごとに 02 の残量行を手編集 → docs 単独
 * コミット、を繰り返していた（コミットの ~40% が簿記オーバーヘッド）。このスクリプトが
 * 残量行の唯一の書き手になることで、残量更新を feat コミットへ畳み、数値の出所も一本化する。
 *
 * データ源（いずれも既存の正源）:
 *   - fidelity-audit.json   : stub / uncovered / noTextRef / symbolMismatch（cards:fidelity 出力）
 *   - card-coverage.json    : coverage todo（cards:coverage 出力）
 *   - autorun-queue/needs-dsl*.jsonl : status:"open" 件数
 *   - needs-ruling.jsonl    : status:"open" 件数
 *
 * 残量メトリクス（停止条件と同じ）= fidelity violations 合計
 *   total = fidelity.violations.length（新しい検出種別も含める）
 * これを fidelity-baseline.json に追記し、low-water（最良値）からの増加を警告する。
 * 増加 = 監査死角の発見（過去の 752→812 等）。ブロックはしないが loud に出して
 * 「サイレントなゴールポスト移動」を防ぎ、進捗予測（ETA）の信頼性を保つ。
 *
 * Usage:
 *   node scripts/update-snapshot.mjs            # 既存 JSON を読み 02 を更新
 *   node scripts/update-snapshot.mjs --measure  # cards:fidelity + cards:coverage を先に実行
 *   node scripts/update-snapshot.mjs --note "<注記>"  # 残量行末尾の注記を差し替え
 *   node scripts/update-snapshot.mjs --landing "<着地>"  # 「engine-drain 直近着地」行に1件 fold（簿記の docs 単独コミットを廃す）
 *   node scripts/update-snapshot.mjs --check    # 02 を書かず数値と増減のみ表示（pre-push 等）
 *   node scripts/update-snapshot.mjs --date 2026-06-14  # 日付を明示（既定=今日）
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const TODO = join(ROOT, "manual/ai-reference/30_plan/02_detailed-todo.md");
const BASELINE = join(ROOT, "fidelity-baseline.json");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const MEASURE = has("--measure");
const CHECK = has("--check");
const NOTE = opt("--note");
const LANDING = opt("--landing");
const DATE = opt("--date") || new Date().toISOString().slice(0, 10);

// 「engine-drain 直近着地」行の最大長（02 entry サイズ規約 = 行 300 字内に収める）。
const LANDING_LINE_MAX = 280;

function countOpen(path) {
  if (!existsSync(path)) return 0;
  let n = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      if (JSON.parse(s).status === "open") n++;
    } catch {
      /* 壊れた行は無視（count を歪めない） */
    }
  }
  return n;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function gather() {
  if (MEASURE) {
    console.log("[update-snapshot] cards:fidelity / cards:coverage 計測中 ...");
    execSync("node scripts/cards-fidelity-audit.mjs --json", {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
    execSync("node scripts/cards-coverage.mjs", {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  const fidelity = readJson(join(ROOT, "fidelity-audit.json"));
  if (!fidelity) {
    console.error(
      "[update-snapshot] fidelity-audit.json 不在。--measure を付けるか先に cards:fidelity を実行してください。"
    );
    process.exit(2);
  }
  const coverage = readJson(join(ROOT, "card-coverage.json"));

  const t = fidelity.totals;
  if (!Array.isArray(fidelity.violations)) {
    throw new Error(
      "fidelity-audit.json に violations 配列がありません。再計測してください。"
    );
  }
  const queueDir = join(ROOT, "autorun-queue");
  const needsDslOpen = existsSync(queueDir)
    ? readdirSync(queueDir)
        .filter((f) => /^needs-dsl.*\.jsonl$/.test(f))
        .reduce((sum, f) => sum + countOpen(join(queueDir, f)), 0)
    : 0;

  return {
    date: DATE,
    stub: t.stub,
    uncovered: t.uncovered,
    noTextRef: t.noTextRef,
    symbolMismatch: t.symbolMismatch,
    total: fidelity.violations.length,
    semanticReviews: fidelity.semanticReviewCount ?? 0,
    coverageAuditViolations: coverage?.auditViolationCount ?? 0,
    coverageAuditReviews: coverage?.auditReviewCount ?? 0,
    needsDslOpen,
    needsRulingOpen: countOpen(join(ROOT, "needs-ruling.jsonl")),
    coverageTodo: coverage?.totals?.todo ?? 0,
  };
}

// 02 の「- 残量 (...): ...」行を再生成する。
function patchTodo(m) {
  const src = readFileSync(TODO, "utf8");
  const legacyRe =
    /^- 残量 \(.*?\): fidelity stub \*\*\d+\*\* \/ uncovered \*\*\d+\*\* \/ needs-dsl open \*\*\d+\*\* \/ needs-ruling open \*\*\d+\*\* \/ coverage todo \*\*\d+\*\*(（.*?）)?\s*$/m;
  const compactRe =
    /^- 残量 \(.*?\): coverage todo \d+ \/ fidelity stub \d+ \/ needs-dsl open \d+ \/ needs-ruling open \d+ \/\r?\n {2}SSOT probe 未分類 (\d+)/m;
  const scanCompactRe =
    /^- 残量 \(.*?\): coverage todo \d+ \/ fidelity stub \d+ \/ needs-dsl open \d+ \/ needs-ruling open \d+ \/ *(?:\r?\n {2})?`scan:ssot-candidates --gate` (\d+) probe \(green\)([^\r\n]*(?:\r?\n(?!- |## ).*)*)/m;
  const legacyMatch = legacyRe.exec(src);
  const compactMatch = legacyMatch ? null : compactRe.exec(src);
  const scanCompactMatch =
    legacyMatch || compactMatch ? null : scanCompactRe.exec(src);
  const found = legacyMatch ?? compactMatch ?? scanCompactMatch;
  if (found === null) {
    console.error(
      "[update-snapshot] 02 の残量行が見つかりません（書式変更？）。手動確認してください。"
    );
    process.exit(2);
  }
  const line = legacyMatch
    ? `- 残量 (${m.date}): fidelity stub **${m.stub}** / uncovered **${m.uncovered}** / needs-dsl open **${m.needsDslOpen}** / needs-ruling open **${m.needsRulingOpen}** / coverage todo **${m.coverageTodo}**${NOTE != null ? (NOTE ? `（${NOTE}）` : "") : (legacyMatch[1] ?? "")}`
    : scanCompactMatch
      ? `- 残量 (${m.date}): coverage todo ${m.coverageTodo} / fidelity stub ${m.stub} / needs-dsl open ${m.needsDslOpen} / needs-ruling open ${m.needsRulingOpen} /\n  \`scan:ssot-candidates --gate\` ${scanCompactMatch[1]} probe (green)${scanCompactMatch[2] ?? ""}`
      : `- 残量 (${m.date}): coverage todo ${m.coverageTodo} / fidelity stub ${m.stub} / needs-dsl open ${m.needsDslOpen} / needs-ruling open ${m.needsRulingOpen} /\n  SSOT probe 未分類 ${compactMatch?.[1] ?? 0}`;
  if (found[0].trimEnd() === line) return false; // 変化なし
  writeFileSync(
    TODO,
    src.replace(
      legacyMatch ? legacyRe : scanCompactMatch ? scanCompactRe : compactRe,
      line
    )
  );
  return true;
}

function landingAuditSummary(m) {
  return `fresh audit: coverage todo ${m.coverageTodo} / violation ${m.coverageAuditViolations} / review ${m.coverageAuditReviews}、fidelity violation ${m.total} / review ${m.semanticReviews}（active review ${m.coverageAuditReviews + m.semanticReviews}）。`;
}

function stripLandingAuditSummary(item) {
  // 着地行に古い計測値を fold すると、baseline は最新でも Current Snapshot
  // だけが過去の review 数を表示する。監査値は最新の先頭着地だけが持つ。
  return item
    .replace(
      /\s*fresh audit: coverage todo \d+ \/ violation \d+ \/ review \d+、fidelity violation \d+(?: \/ review \d+)?(?:（active review \d+）)?。?/,
      " "
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function landingDedupKey(item) {
  return stripLandingAuditSummary(item)
    .replace(/[。.]$/, "")
    .trim();
}

// 02 の「- engine-drain 直近着地候補 (...): a / b / c」行に新着地 1 件を先頭 fold し、
// 日付を更新する。古い項目は FIFO で落とし、行長を LANDING_LINE_MAX 内に保つ。
// これにより landing ごとの docs 単独コミット（簿記オーバーヘッド）を廃す。
function patchLanding(m, text) {
  const t = String(text).trim();
  if (!t) return false;
  const src = readFileSync(TODO, "utf8");
  const re = /^- engine-drain (直近着地(?:候補)?) \((.*?)(,.*)?\): (.*)$/m;
  const found = re.exec(src);
  if (!found) {
    const snapshotHeading = /^## Current Snapshot\r?\n/m;
    if (!snapshotHeading.test(src)) {
      console.error(
        "[update-snapshot] 02 の Current Snapshot が見つかりません。--landing を手動反映してください。"
      );
      return false;
    }
    const line = `- engine-drain 直近着地候補 (${m.date}, 検証・main統合待ち): ${t}。${landingAuditSummary(m)}`;
    writeFileSync(
      TODO,
      src.replace(snapshotHeading, (heading) => `${heading}\n${line}\n`)
    );
    return true;
  }
  // --landing はまだ統合されていない worker の着地候補だけを記録する。
  // 旧行が「直近着地 (..., main統合済)」でも、その表示を継承してはならない。
  const prefix = `- engine-drain 直近着地候補 (${m.date}, 検証・main統合待ち): `;
  let items = [
    `${t}。${landingAuditSummary(m)}`,
    // audit summary 自身も ` / ` を使うため、先に行全体から除いてから
    // landing item を分割する。先に split すると旧 metrics が断片化して残る。
    ...stripLandingAuditSummary(found[4])
      .split(" / ")
      .map((s) => s.trim()),
  ].filter(Boolean);
  items = items.filter(
    (value, index) =>
      items.findIndex(
        (candidate) => landingDedupKey(candidate) === landingDedupKey(value)
      ) === index
  );
  let line = prefix + items.join(" / ");
  while (items.length > 1 && line.length > LANDING_LINE_MAX) {
    items.pop();
    line = prefix + items.join(" / ");
  }
  if (found[0].trimEnd() === line) return false;
  writeFileSync(TODO, src.replace(re, line));
  return true;
}

// fidelity-baseline.json: 残量の機械可読 ledger。low-water からの増加を警告する。
function updateBaseline(m) {
  const prev = readJson(BASELINE);
  const low = prev?.low ?? { total: m.total, date: m.date };
  const lastTotal = prev?.current?.total ?? null;
  const deltaSinceLast = lastTotal == null ? null : m.total - lastTotal;
  const increasedOverLow = m.total > low.total;

  const history = (prev?.history ?? []).slice();
  const lastHist = history[history.length - 1];
  // 同じ残量の日次計測は current に反映するだけでよい。history は残量が変わった
  // 監査上の節目を保持し、上限到達を理由に古い根拠を削除しない。
  if (!lastHist || lastHist.total !== m.total) {
    history.push({
      date: m.date,
      total: m.total,
      stub: m.stub,
      uncovered: m.uncovered,
      delta: deltaSinceLast,
    });
  }
  const baseline = {
    note: "残量メトリクス ledger（停止条件 = fidelity violations 合計 total が 0）。update-snapshot.mjs が維持。",
    metric: "total = fidelity.violations.length (all violation kinds)",
    current: m,
    low: m.total <= low.total ? { total: m.total, date: m.date } : low,
    history,
  };
  if (!CHECK) {
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
  }
  return { deltaSinceLast, increasedOverLow, low: baseline.low };
}

function main() {
  const m = gather();
  const { deltaSinceLast, increasedOverLow, low } = updateBaseline(m);

  const arrow =
    deltaSinceLast == null
      ? ""
      : deltaSinceLast === 0
        ? " (±0)"
        : deltaSinceLast < 0
          ? ` (▼${-deltaSinceLast})`
          : ` (▲${deltaSinceLast})`;

  console.log(
    `[残量 ${m.date}] total ${m.total}${arrow}  (内訳抜粋: stub ${m.stub} / uncovered ${m.uncovered} / noTextRef ${m.noTextRef} / symMismatch ${m.symbolMismatch})`
  );
  console.log(
    `            needs-dsl open ${m.needsDslOpen} / needs-ruling open ${m.needsRulingOpen} / coverage todo ${m.coverageTodo}  (low-water ${low.total}@${low.date})`
  );
  console.log(
    `            active audit reviews ${m.semanticReviews + m.coverageAuditReviews} (fidelity ${m.semanticReviews} / coverage ${m.coverageAuditReviews}) / coverage violations ${m.coverageAuditViolations}`
  );

  if (increasedOverLow) {
    console.log(
      `⚠ 残量が low-water (${low.total}) を上回りました。監査死角の発見（新規 stub の顕在化）の可能性があります。意図通りか確認してください。`
    );
  }

  if (CHECK) {
    console.log("[update-snapshot] --check: 02 / baseline は書き換えません。");
    return;
  }
  const changed = patchTodo(m);
  console.log(
    changed
      ? "[update-snapshot] 02 の残量行を更新しました（feat コミットに含めてください）。"
      : "[update-snapshot] 02 の残量行は既に最新です。"
  );
  if (LANDING != null) {
    const landed = patchLanding(m, LANDING);
    console.log(
      landed
        ? "[update-snapshot] 02 の「直近着地」行に fold しました（同じ feat コミットに含めてください）。"
        : "[update-snapshot] 「直近着地」行は変化なし。"
    );
  }
}

main();
