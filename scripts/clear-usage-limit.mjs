#!/usr/bin/env node
// clear-usage-limit.mjs — usage limit サーキットブレーカーを手動解除する。
//
// run-supervisor-iteration.ps1 / run-card-impl-iteration.ps1 は
// Codex/Claude の「usage limit ... try again at <date>」を検知すると
// logs/usage-limit-state.<lane>.json に reset 日時を記録し、それまでの run を自動 skip する
// (scripts/lib/usage-limit-breaker.ps1)。だが state file は検知時点の reset 日時をそのまま
// 覚えるだけなので、ユーザーがクレジット購入/プラン変更等で reset 日時より前に手動でクォータを
// 回復させた場合、breaker はそれを知らず古い reset 日時まで skip し続けてしまう。
//
// そのケースでは、クォータ回復後にこのスクリプトを実行して state file を削除する。
// 次回の run から通常運用に戻る（削除しなくても reset 日時経過後は自動復帰する）。
//
// Usage:
//   node scripts/clear-usage-limit.mjs             # 全レーンを解除 (pnpm usage-limit:clear)
//   node scripts/clear-usage-limit.mjs codex-supervisor engine-claude  # 指定レーンのみ解除

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const logDir = join(ROOT, "logs");
const requestedLanes = process.argv.slice(2);

const statePrefix = "usage-limit-state.";
const stateSuffix = ".json";

function laneStateFile(lane) {
  return join(logDir, `${statePrefix}${lane}${stateSuffix}`);
}

const targets = requestedLanes.length
  ? requestedLanes.map((lane) => ({ lane, path: laneStateFile(lane) }))
  : existsSync(logDir)
    ? readdirSync(logDir)
        .filter((f) => f.startsWith(statePrefix) && f.endsWith(stateSuffix))
        .map((f) => ({
          lane: f.slice(statePrefix.length, -stateSuffix.length),
          path: join(logDir, f),
        }))
    : [];

if (targets.length === 0) {
  console.log(
    "[clear-usage-limit] armed なサーキットブレーカーはありません（何もしません）。"
  );
  process.exit(0);
}

for (const { lane, path } of targets) {
  if (!existsSync(path)) {
    console.log(
      `[clear-usage-limit] ${lane}: armed されていません（スキップ）。`
    );
    continue;
  }
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    console.log(
      `[clear-usage-limit] ${lane}: 解除します resetAt=${state.resetAt} detectedAt=${state.detectedAt}`
    );
  } catch {
    console.log(
      `[clear-usage-limit] ${lane}: state file 解析失敗、削除して解除します。`
    );
  }
  unlinkSync(path);
}

console.log(
  "[clear-usage-limit] 解除完了。対象レーンは次回 run から通常運用に戻ります。"
);
