import { GLOSSY_SYMBOLS, SYMBOL_HEX } from "../utils/symbol-format";
import type { SymbolChunk } from "../utils/symbol-format";

/** カード上・場外供給源で共通の多色/個数表示。 */
export function SymbolOverlayChunks({
  chunks,
}: {
  chunks: readonly SymbolChunk[];
}) {
  return (
    <>
      {chunks.map((c) => {
        // 多色シンボルは「六」「七」への省略後もラベルを個別に着色する。
        if (c.colors && c.colors.length > 0) {
          return (
            <span
              key={c.symbol}
              className="card-symbol-overlay-chunk card-symbol-overlay-multi"
            >
              {c.colors.map((col, i) => {
                const isGlossy = GLOSSY_SYMBOLS.has(col);
                return (
                  <span
                    key={col + i}
                    className={
                      `symbol-${col}` + (isGlossy ? " card-symbol-glossy" : "")
                    }
                    style={
                      isGlossy
                        ? undefined
                        : { color: SYMBOL_HEX[col] ?? "#ffffff" }
                    }
                  >
                    {c.label.charAt(i)}
                  </span>
                );
              })}
              {c.count}
            </span>
          );
        }
        return (
          <span
            key={c.symbol}
            className={
              "card-symbol-overlay-chunk" +
              ` symbol-${c.symbol}` +
              (c.glossy ? " card-symbol-glossy" : "")
            }
            style={c.glossy ? undefined : { color: c.color }}
          >
            {c.label}
            {c.count}
          </span>
        );
      })}
    </>
  );
}
