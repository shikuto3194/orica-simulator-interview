import { describe, expect, it } from "vitest";
import { CARD_COLORS, type SymbolColor } from "@orica/rules-core";
import {
  formatPrintedSymbolList,
  formatPrintedSymbols,
  formatReductionSymbolEntries,
  formatSymbolBundles,
  symbolBundleChunks,
} from "../src/utils/symbol-format";

describe("シンボル表示と詳細・軽減の共通表記", () => {
  it("黄導1と黄1・導1を区別して印字表示する", () => {
    expect(
      formatPrintedSymbols({
        symbolColors: ["yellow", "guide"],
        symbolColorEntries: [["yellow", "guide"]],
      })
    ).toBe("黄導1");
    expect(formatPrintedSymbols({ symbolColors: ["yellow", "guide"] })).toBe(
      "黄1 導1"
    );
  });
  for (const [colors, label] of [
    [CARD_COLORS.filter((color) => color !== "black"), "六"],
    [[...CARD_COLORS], "七"],
    [[...CARD_COLORS, "god", "guide", "ultimate_symbol"], "七極導神"],
  ] as [SymbolColor[], string][]) {
    it(`${label}は1個の多色シンボルを省略し、個数と特殊シンボルを維持する`, () => {
      const bundles = [{ colors, count: 2 }];
      expect(symbolBundleChunks(bundles)[0]?.label).toBe(label);
      expect(formatSymbolBundles(bundles)).toBe(`${label}2`);
      expect(formatReductionSymbolEntries([{ colors }, { colors }])).toBe(
        `${label}・${label}`
      );
    });
  }
  it("色ごとに独立したシンボルや軽減枠は六・七の1個に縮約しない", () => {
    const entries = CARD_COLORS.map((color) => ({ colors: [color], count: 1 }));
    expect(formatSymbolBundles(entries)).toBe("赤1 紫1 緑1 白1 黄1 青1 黒1");
    expect(formatPrintedSymbolList(CARD_COLORS)).toBe(
      "赤1 紫1 緑1 白1 黄1 青1 黒1"
    );
    expect(formatReductionSymbolEntries(entries)).toBe(
      "赤・紫・緑・白・黄・青・黒"
    );
  });
  it("不足色がある多色と空欄を維持し、同じ構成は盤面と同じ順序・個数にする", () => {
    expect(
      formatSymbolBundles([
        { colors: ["blue", "white"], count: 1 },
        { colors: ["green"], count: 1 },
        { colors: ["white", "blue"], count: 2 },
        { colors: ["red"], count: 2 },
      ])
    ).toBe("赤2 緑1 白青3");
    expect(formatReductionSymbolEntries([{ colors: ["blue", "white"] }])).toBe(
      "白青"
    );
    expect(formatSymbolBundles([])).toBe("");
    expect(formatReductionSymbolEntries([])).toBe("");
  });
});
