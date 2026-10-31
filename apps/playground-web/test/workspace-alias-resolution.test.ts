/**
 * 機械ガード: ワークスペース参照 (`@orica/card-data` / `@orica/rules-core`) が
 * **src** に解決されることを保証する。
 *
 * 背景 (2026-08-02): `vitest.config.ts` に alias が無かった頃、これらは
 * package.json の exports (`./dist/index.js`) に解決され、vitest は
 * ビルド済み dist を検証していた。`pnpm test` は card-data を再ビルドしないため、
 * src を壊してもテストは緑のまま通る。発覚時、dist は 2026-06-11 ビルドで
 * 567 枚 / src は 580 枚 (BSTH11 弾が dist に存在すらしない) という乖離だった。
 *
 * さらに `tsconfig.base.json` の `paths` は当時から src を指していたため、
 * 「型は src・実行は dist」が型エラー無しで成立し、静的検査では検知できなかった。
 *
 * 検知方式は「モジュール同一性」。枚数や cardNo 集合の内容比較では不十分で、
 * `pnpm check` (`tsc -b`) が dist を再ビルドするため、check 直後は dist も src と
 * 同一内容になり alias 欠落を見逃す (`pnpm verify` は check → test の順で走るので、
 * まさにこの経路が今回のバグを隠していた)。参照同一性なら dist の鮮度に依存せず
 * 常に正しく判定でき、副産物として同一モジュールの二重ロード (dual-instance:
 * モジュールレベル状態が分裂し `instanceof` が壊れる) も検知する。
 *
 * このガードが落ちたら `vitest.config.ts` の `resolve.alias` を確認すること。
 * dist は .gitignore 対象のローカル成果物であり、staleness はマシン / worktree
 * ごとに異なる = テスト結果が再現しなくなる。
 */
import { describe, expect, it } from "vitest";

// パッケージ名経由 (vitest.config.ts の alias が効いていれば src に解決される)
import { ALL_CARDS } from "@orica/card-data";
import { CARD_COLORS } from "@orica/rules-core";
// src 直読み (alias の有無に関わらず必ず src)
import { ALL_CARDS as ALL_CARDS_FROM_SRC } from "../../../packages/card-data/src/index";
import { CARD_COLORS as CARD_COLORS_FROM_SRC } from "../../../packages/rules-core/src/index";

describe("workspace alias resolution", () => {
  it("`@orica/card-data` は dist ではなく src に解決される", () => {
    // 同一モジュールインスタンスなら export は同じ配列参照になる。
    // alias が外れて dist に解決されると別インスタンスとなり参照が一致しない。
    expect(ALL_CARDS).toBe(ALL_CARDS_FROM_SRC);
  });

  it("`@orica/rules-core` は dist ではなく src に解決される", () => {
    expect(CARD_COLORS).toBe(CARD_COLORS_FROM_SRC);
  });
});
