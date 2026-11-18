#!/usr/bin/env node
/**
 * 《ソウルコア》以外 → `effectKind:"normal_only"` 監査の候補一覧を出す薄い CLI。
 *
 * 判定ロジックは `soul-core-exclusion-detector.mjs`（cards-fidelity-audit.mjs と共有する
 * SSOT）。本スクリプトは card-data を読んで detector に流すだけで、独自判定を持たない。
 *
 * 存在理由: cluster の `evidence` として worker の prompt に注入するため
 * （`cards-fidelity-audit.mjs --json` は全カード分の巨大 JSON で evidence 上限を超える）。
 * 除外は cards-fidelity-audit と同じ `soul-core-exclusion-exceptions.json` を読む。
 *
 * Usage: node scripts/soul-core-exclusion-scan.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

import { findSoulCoreExclusionViolation } from "./soul-core-exclusion-detector.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

function loadExceptions() {
  const p = join(SCRIPT_DIR, "soul-core-exclusion-exceptions.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

async function loadCards() {
  const distUrl = pathToFileURL(
    join(ROOT, "packages/card-data/dist/generated-index.js")
  );
  const { ALL_CARDS } = await import(distUrl);
  return ALL_CARDS;
}

async function main() {
  const exceptions = loadExceptions();
  const cards = await loadCards();
  const found = [];

  // front / backFace を同じ扱いで走査する (cards-fidelity-audit の auditFaceWithNested と
  // 同じ粒度。backFace 側にしか語彙が無いカードがある — 実例 BSDB01-TX01(B))。
  for (const card of cards) {
    const faces = [
      { cardNo: card.cardNo, textLines: card.textLines, effects: card.effects },
    ];
    if (card.backFace) {
      // cardNo は cards-fidelity-audit.mjs と同一規約にする (backFace.cardNo 優先、
      // 無ければ `<cardNo>#back`)。独自表記にすると監査ログと突き合わせられない。
      faces.push({
        cardNo: card.backFace.cardNo || `${card.cardNo}#back`,
        textLines: card.backFace.textLines ?? card.textLines,
        effects: card.backFace.effects,
      });
    }
    for (const face of faces) {
      if (exceptions[face.cardNo]) continue;
      const v = findSoulCoreExclusionViolation(face.textLines, face.effects);
      if (v) found.push({ cardNo: face.cardNo, ...v });
    }
  }

  console.log(`《ソウルコア》以外 effectKind 監査: ${found.length} 件`);
  for (const f of found) {
    console.log(`  [${f.reason}] ${f.cardNo}`);
    console.log(`      ${f.detail}`);
  }
  if (found.length === 0) {
    console.log("  (全件解消済み。probe/監査の卒業を検討する)");
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("soul-core-exclusion-scan crashed:", err);
    process.exit(1);
  });
