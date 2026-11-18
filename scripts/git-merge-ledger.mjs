#!/usr/bin/env node
/**
 * git custom merge driver for fidelity-baseline.json（残量メトリクス ledger）。
 *
 * 背景:
 *   engine-drain / engine-claude の 2 lane が毎イテレーション fidelity-baseline.json を
 *   更新する（current 上書き + history 末尾追記）。cross-lane の `git merge main` で
 *   この生成 ledger が必ずテキスト競合し、解決が LLM 任せ → run クラッシュ（usage limit 等）で
 *   半端な乖離が残り、以後 auto-merge.ps1 が「main is not an ancestor」で永久 abort していた
 *   （2026-06-25 観測、23 回連続 abort）。
 *
 * これを「数」「append-mostly」の意味に沿って決定論的に自動マージし、競合を根絶する:
 *   - history: base との suffix overlap から各 lane の新規 tail を取り、base → ours tail →
 *     theirs tail を連結して HISTORY_CAP を適用する。update-snapshot.mjs の HISTORY_CAP による
 *     古い prefix trim 済み lane と未 trim lane のマージでも、削除済み prefix を重複復活させず
 *     新しい tail を保持する。
 *   - current: total が小さい方（= 進捗が大きい方）を採る。tie は ours。
 *   - low:     total が小さい方（low-water）を採る。
 *   - note / metric などその他フィールドは ours を保持。
 * いずれにせよ次イテレーションの `pnpm snapshot --measure` が current/low を再生成するため、
 * ここでの値は「競合を出さずに妥当な近似で通す」ことが目的。
 *
 * git 呼び出し規約: `node git-merge-ledger.mjs %O %A %B`
 *   %O = 共通祖先 / %A = ours（=ここに結果を書く） / %B = theirs
 *   exit 0 = 解決済 / 非0 = 競合のまま（git がマーカーを残す）。
 *
 * .gitattributes: `fidelity-baseline.json merge=oledger`
 * driver 定義（共有 .git/config、全 worktree 共通）は scripts/sync-worktree-to-main.mjs が
 * 冪等に登録する。
 */

import { readFileSync, writeFileSync } from "node:fs";

const HISTORY_CAP = 80;

const [, , oPath, aPath, bPath] = process.argv;

function load(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const ours = load(aPath);
const theirs = load(bPath);
const base = load(oPath);

// いずれかが JSON として読めなければ自動解決を諦め、競合を残す（fail-safe）。
if (!ours || !theirs || !base) {
  process.stderr.write(
    "[git-merge-ledger] base/ours/theirs が JSON parse 不能。競合を残す。\n"
  );
  process.exit(1);
}

function totalOf(entry) {
  return typeof entry?.total === "number" ? entry.total : Infinity;
}

function historyKey(entry) {
  return JSON.stringify({
    date: entry?.date,
    total: entry?.total,
  });
}

function suffixPrefixOverlapLen(baseHist, sideHist) {
  const baseKeys = baseHist.map(historyKey);
  const sideKeys = sideHist.map(historyKey);
  const max = Math.min(baseKeys.length, sideKeys.length);
  for (let n = max; n > 0; n--) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (baseKeys[baseKeys.length - n + i] !== sideKeys[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return n;
  }
  return 0;
}

function tailAfterBase(baseHist, sideHist) {
  return sideHist.slice(suffixPrefixOverlapLen(baseHist, sideHist));
}

function collapseConsecutiveSameIdentity(history) {
  const out = [];
  for (const entry of history) {
    if (
      out.length > 0 &&
      historyKey(out[out.length - 1]) === historyKey(entry)
    ) {
      continue;
    }
    out.push(entry);
  }
  return out;
}

function mergeTailSequences(a, b) {
  const aKeys = a.map(historyKey);
  const bKeys = b.map(historyKey);
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );
  for (let i = a.length; i >= 0; i--) dp[i][b.length] = a.length - i;
  for (let j = b.length; j >= 0; j--) dp[a.length][j] = b.length - j;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] =
        aKeys[i] === bKeys[j]
          ? 1 + dp[i + 1][j + 1]
          : 1 + Math.min(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const merged = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i === a.length) {
      merged.push(b[j++]);
    } else if (j === b.length) {
      merged.push(a[i++]);
    } else if (aKeys[i] === bKeys[j]) {
      merged.push(a[i++]);
      j++;
    } else if (dp[i + 1][j] <= dp[i][j + 1]) {
      merged.push(a[i++]);
    } else {
      merged.push(b[j++]);
    }
  }
  return merged;
}

function mergeHistory(baseHist, a, b) {
  const aTail = tailAfterBase(baseHist, a);
  const bTail = tailAfterBase(baseHist, b);
  const merged = collapseConsecutiveSameIdentity([
    ...baseHist,
    ...mergeTailSequences(aTail, bTail),
  ]);
  return merged.length > HISTORY_CAP ? merged.slice(-HISTORY_CAP) : merged;
}

const oHist = Array.isArray(base.history) ? base.history : [];
const aHist = Array.isArray(ours.history) ? ours.history : [];
const bHist = Array.isArray(theirs.history) ? theirs.history : [];
const mergedHistory = mergeHistory(oHist, aHist, bHist);

// current / low は total が小さい方（= 進捗が大きい / low-water）を採る。
const mergedCurrent =
  totalOf(ours.current) <= totalOf(theirs.current)
    ? ours.current
    : theirs.current;
const mergedLow =
  totalOf(ours.low) <= totalOf(theirs.low) ? ours.low : theirs.low;

const merged = {
  ...ours,
  current: mergedCurrent,
  low: mergedLow,
  history: mergedHistory,
};

writeFileSync(aPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
process.stderr.write(
  `[git-merge-ledger] 自動マージ: current.total=${totalOf(mergedCurrent)} low.total=${totalOf(mergedLow)} history=${mergedHistory.length}\n`
);
process.exit(0);
