import { expect, it } from "vitest";
import {
  normalizeMirrorSymbols,
  normalizeSymbolEntries,
} from "../../../scripts/printed-symbol-audit.mjs";

it("原文監査は黄導1を黄1・導1へ平坦化せず、順序だけを正規化する", () => {
  const raw = (symbols: string[]) =>
    normalizeSymbolEntries(
      symbols.map((symbol) => normalizeMirrorSymbols([symbol]))
    );
  expect(raw(["黄導"])).toEqual(normalizeSymbolEntries([["yellow", "guide"]]));
  expect(raw(["黄導"])).not.toEqual(
    normalizeSymbolEntries([["yellow"], ["guide"]])
  );
  expect(raw(["導黄", "黄導"])).toEqual(
    normalizeSymbolEntries([
      ["yellow", "guide"],
      ["guide", "yellow"],
    ])
  );
  expect(raw(["黄?"])).not.toEqual(raw(["黄"]));
});
