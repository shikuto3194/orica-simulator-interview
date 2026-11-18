#!/usr/bin/env node
/**
 * check:card-test-coverage — カード変換 / stub 解消の commit に対し、対象 cardNo を
 * 参照する test ファイルがリポジトリ内に少なくとも1件存在することを検査するゲート。
 *
 * 背景:
 *   fidelity / vitest / check:ssot が緑でも、worker が「effects を書いたが対応する
 *   意味差分テストを書かない」commit を量産すると、silent な意味的不一致 (immunity
 *   filter の組み合わせ違い / 名前一致モード違い / 印字 vs 実効値の取り違え) が
 *   検出できない。コード本体のテストでは「召喚できる」「型が通る」までしか踏まれず、
 *   効果固有の振る舞いを assert していない (issues/P3-89 系)。
 *
 *   この gate は「**effects を持つ全ての変更カードに、cardNo を参照する test ファイル
 *   が同じブランチに存在する**」という最低条件を機械的に強制する。test の内容が
 *   意味差分を踏んでいるかは検証エージェント (adversarial-verifier-prompt.md Lens 5)
 *   が見る — ここは存在のみ。
 *
 * 既定動作:
 *   - --changed-only (既定): git diff --name-only main...HEAD で変更された card-data
 *     ファイル中の cardNo を抽出し、それぞれに対応する test 参照を検査する。
 *   - --all: ALL_CARDS 全てを検査する (grandfather 用、警告のみ)。
 *
 * Usage:
 *   node scripts/check-card-test-coverage.mjs                # changed-only, warn のみ
 *   node scripts/check-card-test-coverage.mjs --gate         # changed-only, 違反で exit 1
 *   node scripts/check-card-test-coverage.mjs --all --json   # 全カード JSON
 *   node scripts/check-card-test-coverage.mjs --base main    # 比較先指定 (既定 main)
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  extractReferencedCardNos,
  extractDeclaredCardNos,
} from "./verifier-card-context.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

const args = process.argv.slice(2);
const GATE = args.includes("--gate");
const ALL = args.includes("--all");
const JSON_ONLY = args.includes("--json");
const BASE = (() => {
  const i = args.indexOf("--base");
  return i >= 0 ? args[i + 1] : "main";
})();

const log = (...m) => {
  if (!JSON_ONLY) console.log(...m);
};

function listTestFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git"
      )
        continue;
      listTestFiles(p, acc);
    } else if (
      entry.isFile() &&
      /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)
    ) {
      acc.push(p);
    }
  }
  return acc;
}

function collectReferencedCardNos() {
  const testFiles = [
    ...listTestFiles(join(ROOT, "packages")),
    ...listTestFiles(join(ROOT, "apps")),
    ...listTestFiles(join(ROOT, "tests")),
    ...listTestFiles(join(ROOT, "scripts")),
  ];
  const referenced = new Set();
  for (const f of testFiles) {
    let src;
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const cardNo of extractReferencedCardNos(src)) referenced.add(cardNo);
  }
  return referenced;
}

function changedCardFiles() {
  try {
    const out = execSync(
      `git diff --name-only --diff-filter=AMR ${BASE}...HEAD`,
      { cwd: ROOT, encoding: "utf8" }
    );
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /packages\/card-data\/src\/cards\/.+\.ts$/.test(l));
  } catch (e) {
    console.error(
      `[check:card-test-coverage] git diff vs ${BASE} 失敗: ${e.message}`
    );
    process.exit(2);
  }
}

function cardNosInFile(absPath) {
  if (!existsSync(absPath)) return [];
  return extractDeclaredCardNos(readFileSync(absPath, "utf8"));
}

async function main() {
  const referenced = collectReferencedCardNos();

  log(
    `[check:card-test-coverage] base=${BASE} mode=${ALL ? "all" : "changed-only"}`
  );
  log(`[check:card-test-coverage] test 参照 cardNo: ${referenced.size}`);

  let targetCardNos;

  if (ALL) {
    log("[check:card-test-coverage] building @orica/card-data ...");
    try {
      execSync("npx tsc -b packages/card-data", { cwd: ROOT, stdio: "pipe" });
    } catch (e) {
      console.error(
        "[check:card-test-coverage] build failed:\n" +
          (e.stdout || e).toString()
      );
      process.exit(2);
    }
    const distUrl = pathToFileURL(
      join(ROOT, "packages/card-data/dist/generated-index.js")
    ).href;
    const { ALL_CARDS } = await import(distUrl);
    targetCardNos = [];
    for (const c of ALL_CARDS) {
      const front = Array.isArray(c.effects) ? c.effects.length : 0;
      const back = Array.isArray(c.backFace?.effects)
        ? c.backFace.effects.length
        : 0;
      if (front + back > 0) targetCardNos.push(c.cardNo);
    }
  } else {
    const files = changedCardFiles();
    const set = new Set();
    for (const rel of files) {
      const abs = join(ROOT, rel);
      for (const no of cardNosInFile(abs)) set.add(no);
    }
    targetCardNos = [...set];
    log(
      `[check:card-test-coverage] 変更されたカード (vs ${BASE}): ${targetCardNos.length} 件`
    );
  }

  const missing = [];
  for (const no of targetCardNos) {
    if (!referenced.has(no)) missing.push(no);
  }

  const report = {
    generatedBy: "scripts/check-card-test-coverage.mjs",
    base: BASE,
    mode: ALL ? "all" : "changed-only",
    target: targetCardNos.length,
    referenced: targetCardNos.length - missing.length,
    missing,
    clean: missing.length === 0,
  };

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exit(GATE && !report.clean ? 1 : 0);
  }

  log(
    `\n対象: ${targetCardNos.length}  / 参照あり: ${report.referenced}  / 欠落: ${missing.length}`
  );
  if (missing.length > 0) {
    log("\n参照欠落 (cardNo を参照する test が見つからない):");
    for (const no of missing.slice(0, 50)) log(`  ${no}`);
    if (missing.length > 50) log(`  ... 他 ${missing.length - 50} 件`);
    log(
      `\n対応: 該当 cardNo を直接引用する .test.ts を追加し、効果固有の意味差分 (相手効果対象→ブロック確認 / コアシュート単源 deferred / 転醒 flip 後 等) を assert する。`
    );
    log(
      `テスト本体が「召喚できる」「型が通る」止まりかどうかは adversarial-verifier-prompt.md Lens 5 が検証する。`
    );
  } else {
    log(`\n✅ 変更カード全てに test 参照あり`);
  }

  process.exit(GATE && !report.clean ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
