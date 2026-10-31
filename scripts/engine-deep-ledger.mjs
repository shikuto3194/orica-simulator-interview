#!/usr/bin/env node
/**
 * engine-deep-ledger.mjs — engine-claude lane で park 済 ENGINE-* primitive を
 * multi-iteration で挑戦するための継承 ledger。
 *
 * 各 iteration の worker が起動時に status を読み、前回 worker が残した
 * approach 候補から再開する。worktree 直下 `.engine-deep-ledger.json` に保存。
 *
 * Schema (currentAttempt は 0 or 1 件):
 *   {
 *     "currentAttempt": null | {
 *       "engineTag": "ENGINE-grant-effect-leave-field-trigger",
 *       "startedAt": "ISO",
 *       "iterationsUsed": 2,
 *       "approaches": [
 *         { "iterationStart": "ISO", "approach": "...", "result": "refuted",
 *           "reason": "verifier lens 2: ...", "next": "次の試行案" }
 *       ]
 *     },
 *     "history": [
 *       { "engineTag": "...", "result": "landed"|"abandoned",
 *         "totalIterations": 4, "completedAt": "ISO",
 *         "commit": "<sha>" or "reason": "..." }
 *     ]
 *   }
 *
 * Usage:
 *   node scripts/engine-deep-ledger.mjs status [--worktree <path>]
 *   node scripts/engine-deep-ledger.mjs start --tag <ENGINE-X> --approach "..." [--worktree <path>]
 *   node scripts/engine-deep-ledger.mjs record --approach "..." --result refuted --reason "..." --next "..."
 *   node scripts/engine-deep-ledger.mjs finish --result landed --commit <sha>
 *   node scripts/engine-deep-ledger.mjs abandon --reason "..."
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MAX_ITERATIONS = 5;

function opt(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const worktree = opt("--worktree", process.cwd());
const ledgerPath = join(worktree, ".engine-deep-ledger.json");
const cmd = process.argv[2];

function readLedger() {
  if (!existsSync(ledgerPath)) {
    return { currentAttempt: null, history: [] };
  }
  try {
    return JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (e) {
    console.error(`[engine-deep-ledger] read 失敗: ${e.message}`);
    process.exit(2);
  }
}

function writeLedger(data) {
  writeFileSync(ledgerPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function fail(msg) {
  console.error(`[engine-deep-ledger] ${msg}`);
  process.exit(1);
}

function nowIso() {
  // Date.now / new Date() を禁じる runtime もあるが、ledger は実時刻が必要なので
  // Node 環境内の new Date() を使う（workflow harness 内ではなく CLI ツールとして起動される前提）。
  return new Date().toISOString();
}

if (cmd === "status") {
  const d = readLedger();
  if (!d.currentAttempt) {
    console.log("[engine-deep-ledger] currentAttempt: なし");
    if (d.history.length > 0) {
      console.log(`[engine-deep-ledger] history: ${d.history.length} 件`);
      const recent = d.history.slice(-3);
      for (const h of recent) {
        console.log(
          `  - ${h.engineTag} (${h.result}, ${h.totalIterations} iter, ${h.completedAt.slice(0, 10)})`
        );
      }
    }
    process.exit(0);
  }
  const a = d.currentAttempt;
  console.log(`[engine-deep-ledger] currentAttempt: ${a.engineTag}`);
  console.log(
    `  iterations: ${a.iterationsUsed}/${MAX_ITERATIONS}, started ${a.startedAt}`
  );
  if (a.approaches.length > 0) {
    console.log(`  approaches:`);
    for (const ap of a.approaches) {
      console.log(`    [${ap.iterationStart}] ${ap.approach}`);
      console.log(`      → ${ap.result}: ${ap.reason || "(no reason)"}`);
      if (ap.next) console.log(`      next: ${ap.next}`);
    }
  }
  const lastNext = a.approaches.length
    ? a.approaches[a.approaches.length - 1].next
    : null;
  if (lastNext) {
    console.log(
      `\n[engine-deep-ledger] このイテレーションで試す approach: ${lastNext}`
    );
  } else {
    console.log(
      `\n[engine-deep-ledger] 新しい approach を考案して record してください`
    );
  }
  process.exit(0);
}

if (cmd === "start") {
  const tag = opt("--tag");
  const approach = opt("--approach");
  if (!tag || !approach) fail("start requires --tag and --approach");
  const d = readLedger();
  if (d.currentAttempt) {
    fail(
      `currentAttempt 既存 (${d.currentAttempt.engineTag})。先に finish/abandon で閉じてください`
    );
  }
  d.currentAttempt = {
    engineTag: tag,
    startedAt: nowIso(),
    iterationsUsed: 1,
    approaches: [
      {
        iterationStart: nowIso(),
        approach,
        result: "in_progress",
        reason: null,
        next: null,
      },
    ],
  };
  writeLedger(d);
  console.log(`[engine-deep-ledger] started ${tag}`);
  process.exit(0);
}

if (cmd === "record") {
  const approach = opt("--approach");
  const result = opt("--result"); // refuted | vouched-partial | broken
  const reason = opt("--reason");
  const next = opt("--next");
  if (!approach || !result) fail("record requires --approach and --result");
  const d = readLedger();
  if (!d.currentAttempt) fail("currentAttempt なし。先に start してください");
  // 既存 in_progress があれば close
  const last =
    d.currentAttempt.approaches[d.currentAttempt.approaches.length - 1];
  if (last && last.result === "in_progress") {
    last.result = result;
    last.reason = reason || null;
    last.next = next || null;
    last.approach = approach;
  } else {
    d.currentAttempt.iterationsUsed += 1;
    d.currentAttempt.approaches.push({
      iterationStart: nowIso(),
      approach,
      result,
      reason: reason || null,
      next: next || null,
    });
  }
  if (
    d.currentAttempt.iterationsUsed >= MAX_ITERATIONS &&
    result !== "vouched-partial"
  ) {
    console.error(
      `[engine-deep-ledger] WARN: ${d.currentAttempt.iterationsUsed}/${MAX_ITERATIONS} iter 使用済。次は abandon 推奨`
    );
  }
  writeLedger(d);
  console.log(
    `[engine-deep-ledger] recorded approach #${d.currentAttempt.approaches.length}: ${result}`
  );
  process.exit(0);
}

if (cmd === "finish") {
  const result = opt("--result"); // landed
  const commit = opt("--commit");
  if (!result) fail("finish requires --result");
  const d = readLedger();
  if (!d.currentAttempt) fail("currentAttempt なし");
  d.history.push({
    engineTag: d.currentAttempt.engineTag,
    result,
    totalIterations: d.currentAttempt.iterationsUsed,
    completedAt: nowIso(),
    commit: commit || null,
    approaches: d.currentAttempt.approaches,
  });
  const tag = d.currentAttempt.engineTag;
  d.currentAttempt = null;
  writeLedger(d);
  console.log(`[engine-deep-ledger] finished ${tag} (${result})`);
  process.exit(0);
}

if (cmd === "abandon") {
  const reason = opt("--reason");
  if (!reason) fail("abandon requires --reason");
  const d = readLedger();
  if (!d.currentAttempt) fail("currentAttempt なし");
  d.history.push({
    engineTag: d.currentAttempt.engineTag,
    result: "abandoned",
    totalIterations: d.currentAttempt.iterationsUsed,
    completedAt: nowIso(),
    reason,
    approaches: d.currentAttempt.approaches,
  });
  const tag = d.currentAttempt.engineTag;
  d.currentAttempt = null;
  writeLedger(d);
  console.log(`[engine-deep-ledger] abandoned ${tag}: ${reason}`);
  process.exit(0);
}

console.error(
  "usage: engine-deep-ledger.mjs status|start|record|finish|abandon"
);
process.exit(1);
