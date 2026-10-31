const JP_SYMBOL = {
  赤: "red",
  青: "blue",
  黄: "yellow",
  緑: "green",
  白: "white",
  紫: "purple",
  黒: "black",
  導: "guide",
  神: "god",
  極: "ultimate_symbol",
  六: "six",
  七: "seven",
};

// ミラーの symbol / reduction 配列を SymbolColor 多重集合へ正規化。
// 余白除去・連結トークン (例 "黄導") の 1 文字分解を行い、未知シンボルは
// `?<char>` センチネルとして残す（黙殺せず mismatch で顕在化させる）。
export function normalizeMirrorSymbols(arr) {
  const out = [];
  for (const tok of arr || []) {
    for (const ch of String(tok).trim()) {
      if (!ch.trim()) continue;
      out.push(JP_SYMBOL[ch] ?? `?${ch}`);
    }
  }
  return out.sort();
}

// 原文の配列要素が物理的な1個。黄導と黄・導を区別し、色順だけを正規化する。
export function normalizeSymbolEntries(entries) {
  return entries.map((colors) => [...colors].sort().join("+")).sort();
}
