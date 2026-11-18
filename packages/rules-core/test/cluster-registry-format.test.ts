/**
 * 機械ガード: `autorun-queue/cluster-registry.json` の整形往復 churn を防ぐ。
 *
 * 背景 (2026-08-04): このファイルは `scripts/cluster-claim.mjs` が
 * `JSON.stringify(registry, null, 2)` で書く機械所有 ledger だが、prettier の対象でも
 * あった。prettier は printWidth に収まる配列を 1 行へ畳むため、
 * 「script が展開 → prettier が畳む」の往復で毎回 300 行規模の意味的差分ゼロな
 * dirty が発生し、同内容の stash が 3 件（うち 1 件は lint-staged の自動 backup）
 * 溜まっていた。
 *
 * 対策は prettier ignore + 正準形を script 側に一本化。展開形は 1 値 1 行なので、
 * cross-lane で競合追記される ledger としては 3-way マージ耐性も高い。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const REGISTRY_PATH = "autorun-queue/cluster-registry.json";

const read = (relative: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../${relative}`, import.meta.url)),
    "utf8"
  );

describe("cluster-registry.json の整形正準形", () => {
  it("cluster-claim.mjs の出力形 (2 space + 末尾改行) と一致する", () => {
    const raw = read(REGISTRY_PATH);
    const canonical = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
    // 失敗したら prettier などが整形し直している。差分は意味的にはゼロなので、
    // 内容を直す必要はなく正準形へ書き戻せばよい。
    expect(raw).toBe(canonical);
  });

  it("prettier ignore に登録されている", () => {
    const entries = read(".prettierignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    // この登録が外れると lint-staged の prettier --write が再び畳み始める。
    expect(entries).toContain(REGISTRY_PATH);
  });
});
