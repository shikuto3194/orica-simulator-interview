#!/usr/bin/env node
/**
 * check:wiring — DSL に登録された Action / Condition kind が consumer に配線されているかを
 * 静的に検査するゲート。
 *
 * 背景:
 *   `negate` DSL のように、Action 型を model.ts に追加しても interpreter / handler が
 *   未配線で no-op になる「registered-but-not-called」が頻発している
 *   ([[project_negate_primitive_noop]] / [[project_field_effect_target_index]] /
 *   [[feedback_impl_label_vs_wiring]])。型/test/check:ssot は緑のまま silent regression に
 *   なる。このゲートは consumer サイトの**存在**を機械的に強制する（中身の正しさは
 *   検証エージェント = adversarial-verifier-prompt.md Lens 2 が見る）。
 *
 * 検査ロジック:
 *   1. `packages/rules-core/src/model.ts` から `export interface XxxAction { kind: "<lit>"; ... }`
 *      のパターンで kind literal を列挙する。
 *   2. 各 literal について、rules-core/src 配下（model.ts / dsl-types.ts / test 除く）で
 *      下記のいずれかが現れるファイルを consumer 候補とする:
 *        - `kind === "<lit>"` / `kind !== "<lit>"` / `kind == "<lit>"` （discriminator 分岐）
 *        - `case "<lit>"` （switch 文 dispatch）
 *        - `\["<lit>"\]:` （Record / table dispatch のキー）
 *        - `\bXxxAction\b` （interface 名の型注釈・引数・generic 使用。
 *          `executeFoo(action: XxxAction)` 型シグネチャ消費もこれで検出）
 *   3. 全 detector で 0 件の kind を違反として報告する。
 *
 * NOTE: `kind: "<lit>"` の生成サイトは consumer ではなく producer なので検出から除外する。
 *       producer のみで consumer 不在のものを silent gap として顕在化させる。
 *
 * 例外:
 *   `scripts/check-wiring-allowlist.json` に `{"<kind>": "理由"}` を登録すれば見逃す。
 *   将来の予約・段階的配線中のものをここに置く（resolved 時に削除）。
 *
 * Usage:
 *   node scripts/check-wiring.mjs           # gate (違反で exit 1)
 *   node scripts/check-wiring.mjs --list    # kind → consumer files の対応表を出力
 *   node scripts/check-wiring.mjs --json    # JSON のみ
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

const args = process.argv.slice(2);
const LIST = args.includes("--list");
const JSON_ONLY = args.includes("--json");

const RULES_CORE_SRC = join(ROOT, "packages", "rules-core", "src");
const MODEL_TS = join(RULES_CORE_SRC, "model.ts");
const DSL_TYPES_TS = join(RULES_CORE_SRC, "dsl-types.ts");

const log = (...m) => {
  if (!JSON_ONLY) console.log(...m);
};

const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);
const SOURCE_RE = /\.ts$/;

function loadAllowlist() {
  const p = join(SCRIPT_DIR, "check-wiring-allowlist.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function extractActionKinds(modelSrc) {
  const kinds = [];
  const interfaceRe =
    /^export\s+interface\s+(\w+Action)\s*\{[\s\S]*?\bkind:\s*"([a-z][a-z0-9_-]*)"/gm;
  for (const m of modelSrc.matchAll(interfaceRe)) {
    kinds.push({ interfaceName: m[1], kind: m[2] });
  }
  return kinds;
}

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
      } else if (e.isFile() && SOURCE_RE.test(e.name)) {
        files.push(abs);
      }
    }
  }
  await walk(RULES_CORE_SRC);
  return files;
}

function isExcluded(absPath) {
  if (absPath === MODEL_TS || absPath === DSL_TYPES_TS) return true;
  const rel = relative(ROOT, absPath).replaceAll("\\", "/");
  if (/\.test\.ts$/.test(rel)) return true;
  if (/\.spec\.ts$/.test(rel)) return true;
  if (/[\\/]test[\\/]/.test(rel)) return true;
  return false;
}

function consumerPatternsFor(kindLit, interfaceName) {
  const esc = kindLit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ifaceEsc = interfaceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`\\bkind\\s*===\\s*"${esc}"`),
    new RegExp(`\\bkind\\s*!==\\s*"${esc}"`),
    new RegExp(`\\bkind\\s*==\\s*"${esc}"`),
    new RegExp(`\\bcase\\s+"${esc}"`),
    new RegExp(`\\["${esc}"\\]\\s*:`),
    // dispatch レジストリの bare-identifier キー (`<kind>: (ctx) =>` 型の table dispatch)。
    // P2-11/P2-12 で switch→型付きレジストリ根治した consumer 形。行頭のプロパティキーに限定。
    new RegExp(`^\\s*${esc}:\\s*[(\\w]`, "m"),
    // ContinuousEffect 経由のブリッジ消費 (Action.kind → CE.modifierTag) も配線扱い。
    // 例: `ce.modifierTag === "prevent_attack"` (battle-availability.ts)。
    new RegExp(`\\bmodifierTag\\s*===\\s*"${esc}"`),
    new RegExp(`\\bmodifierTag\\s*==\\s*"${esc}"`),
    // interface 名による型注釈・引数・generic 等の参照消費
    // (executeFoo(action: XxxAction) / function consumer (x): XxxAction => ... / <XxxAction>)。
    // ただし `kind: "<lit>"` の生成サイトと混同しないよう、interface 名そのものに限定する
    // (`new XxxAction()` 的な構築や `as XxxAction` キャスト、import/extends も含むが、
    // それでも純 producer ファイルが consumer と誤判定されることは稀)。
    new RegExp(`\\b${ifaceEsc}\\b`),
  ];
}

async function main() {
  if (!existsSync(MODEL_TS)) {
    console.error(`[check:wiring] model.ts が見つからない: ${MODEL_TS}`);
    process.exit(2);
  }
  const modelSrc = await readFile(MODEL_TS, "utf8");
  const kinds = extractActionKinds(modelSrc);
  const allowlist = loadAllowlist();
  const files = await collectSourceFiles();
  const cache = new Map();
  const results = [];

  for (const { interfaceName, kind } of kinds) {
    const patterns = consumerPatternsFor(kind, interfaceName);
    const consumers = [];
    for (const abs of files) {
      if (isExcluded(abs)) continue;
      let text = cache.get(abs);
      if (text === undefined) {
        text = await readFile(abs, "utf8");
        cache.set(abs, text);
      }
      if (patterns.some((re) => re.test(text))) {
        consumers.push(relative(ROOT, abs).replaceAll("\\", "/"));
      }
    }
    results.push({ interfaceName, kind, consumers });
  }

  const violations = results.filter(
    (r) => r.consumers.length === 0 && !allowlist[r.kind]
  );
  const allowed = results.filter(
    (r) => r.consumers.length === 0 && allowlist[r.kind]
  );

  const report = {
    generatedBy: "scripts/check-wiring.mjs",
    totalKinds: results.length,
    wired: results.filter((r) => r.consumers.length > 0).length,
    violations: violations.map((r) => ({
      interfaceName: r.interfaceName,
      kind: r.kind,
    })),
    allowed: allowed.map((r) => ({
      interfaceName: r.interfaceName,
      kind: r.kind,
      reason: allowlist[r.kind],
    })),
    clean: violations.length === 0,
  };

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exit(report.clean ? 0 : 1);
  }

  if (LIST) {
    log("=== Action kind → consumer files ===");
    for (const r of results) {
      log(
        `${r.kind.padEnd(40)} (${r.interfaceName}) — ${r.consumers.length} consumer(s)`
      );
      for (const c of r.consumers.slice(0, 5)) log(`    ${c}`);
      if (r.consumers.length > 5)
        log(`    ... 他 ${r.consumers.length - 5} 件`);
    }
    process.exit(0);
  }

  log(
    `\n[check:wiring] Action kinds=${results.length}  配線あり=${report.wired}  違反=${violations.length}  許可=${allowed.length}`
  );
  if (allowed.length > 0) {
    log("\n[allowlist] 配線無しだが明示許可 (check-wiring-allowlist.json):");
    for (const r of allowed)
      log(`  ${r.kind} (${r.interfaceName}) — ${allowlist[r.kind]}`);
  }
  if (violations.length > 0) {
    log("\n❌ 配線無し (registered-but-not-called):");
    for (const r of violations) log(`  ${r.kind} (${r.interfaceName})`);
    log(
      `\n対応: ${RULES_CORE_SRC} 配下の interpreter / handler / dispatch に該当 kind の case を追加するか、`
    );
    log(
      `段階的配線中なら scripts/check-wiring-allowlist.json に理由付きで append してください。`
    );
  } else {
    log(`\n✅ 全 Action kind に最低 1 件の consumer 配線あり`);
  }

  process.exit(report.clean ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
