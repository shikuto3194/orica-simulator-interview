import {
  getPrintedSymbolEntries,
  type SymbolBundle,
  type SymbolColor,
} from "@orica/rules-core";

export const COLOR_JA: Record<string, string> = {
  red: "赤",
  purple: "紫",
  green: "緑",
  white: "白",
  yellow: "黄",
  blue: "青",
  black: "黒",
};

export const SYMBOL_JA: Record<string, string> = {
  ...COLOR_JA,
  god: "神",
  guide: "導",
  ultimate_symbol: "極",
  seven: "七",
  six: "六",
};

/** シンボルカラー → 表示用 hex (黒系は背景に埋もれない明るめに調整)。
 *  god / guide / ultimate_symbol は CSS 側で linear-gradient + background-clip:text による
 *  光沢表現に切り替えるため、ここの値はフォールバック色のみ。 */
export const SYMBOL_HEX: Record<string, string> = {
  red: "#ff5a5a",
  purple: "#c084fc",
  green: "#3ddc84",
  white: "#f1f1f1",
  yellow: "#ffd84d",
  blue: "#4ea8ff",
  // 黒は真黒に近づけ、CSS 側 .symbol-black で極細白縁取り (-webkit-text-stroke) を付与して視認性確保
  black: "#0a0a0a",
  god: "#bcdcff",
  guide: "#a8d840",
  ultimate_symbol: "#ffd34a",
  seven: "#e6c547",
  six: "#d6d6d6",
};

/** 光沢グラデーション表示の対象。CSS の `.symbol-glossy.symbol-<name>` で見た目を定義。 */
export const GLOSSY_SYMBOLS: ReadonlySet<string> = new Set([
  "ultimate_symbol",
  "god",
  "guide",
  "six",
  "seven",
]);

/** 単色シンボル列を「色n 色m ...」形式の chunk 配列に整形。各 chunk は色付き span 描画用。 */
export interface SymbolChunk {
  symbol: string;
  count: number;
  label: string;
  color: string;
  /** 光沢グラデーション表示にする場合 true (この場合 color は CSS 側で上書き)。 */
  glossy: boolean;
  /**
   * 多色シンボル (treat_as 等で 1 個のシンボルが複数色として扱われる) の場合、
   * 構成色を順序付き配列で提供する。単色の場合は省略 (= [symbol] と同等)。
   * 描画側は各色を 1 文字ずつ別 span で着色できる。
   */
  colors?: string[];
}

export function symbolListChunks(symbols: readonly string[]): SymbolChunk[] {
  if (symbols.length === 0) return [];
  const counts = new Map<string, number>();
  for (const s of symbols) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort(([a], [b]) => compareSymbol(a, b))
    .map(([s, n]) => ({
      symbol: s,
      count: n,
      label: SYMBOL_JA[s] ?? s,
      color: SYMBOL_HEX[s] ?? "#ffffff",
      glossy: GLOSSY_SYMBOLS.has(s),
    }));
}

export const SYMBOL_DISPLAY_ORDER: readonly string[] = [
  "red",
  "purple",
  "green",
  "white",
  "yellow",
  "blue",
  "black",
  "ultimate_symbol",
  "guide",
  "god",
  "seven",
  "six",
];

export function compareSymbol(a: string, b: string): number {
  const ai = SYMBOL_DISPLAY_ORDER.indexOf(a);
  const bi = SYMBOL_DISPLAY_ORDER.indexOf(b);
  return (
    (ai === -1 ? Number.POSITIVE_INFINITY : ai) -
    (bi === -1 ? Number.POSITIVE_INFINITY : bi)
  );
}

/** 1個のシンボル（軽減1枠を含む）の色を表示用にまとめる。別々の枠は結合しない。 */
export function symbolDisplayColors(colors: readonly string[]): string[] {
  const sorted = [...colors].sort(compareSymbol);
  const baseColors = Object.keys(COLOR_JA).filter((color) => color !== "black");
  return baseColors.every((color) => sorted.includes(color))
    ? [
        sorted.includes("black") ? "seven" : "six",
        ...sorted.filter((color) => !(color in COLOR_JA)),
      ]
    : sorted;
}

export function formatReductionSymbolEntries(
  entries: readonly { colors: readonly string[] }[]
): string {
  return entries
    .map((entry) =>
      symbolDisplayColors(entry.colors)
        .map((color) => SYMBOL_JA[color] ?? color)
        .join("")
    )
    .join("・");
}

/** 印字シンボルの物理的な境界を保ち、「黄導1」のように整形する。 */
export function formatPrintedSymbols(definition: {
  symbolColors: readonly string[];
  symbolColorEntries?: readonly (readonly string[])[];
}): string {
  return formatSymbolBundles(
    getPrintedSymbolEntries(definition).map((colors) => ({
      colors: colors as SymbolColor[],
      count: 1,
    }))
  );
}

/** 単色シンボル列 (`["purple","purple"]` 等) を「紫2」のように整形。 */
export function formatPrintedSymbolList(symbols: readonly string[]): string {
  if (symbols.length === 0) return "";
  const counts = new Map<string, number>();
  for (const s of symbols) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort(([a], [b]) => compareSymbol(a, b))
    .map(([s, n]) => `${SYMBOL_JA[s] ?? s}${n}`)
    .join(" ");
}

/**
 * SymbolBundle 列を chunk 配列に整形。六色・七色は表示上「六」「七」に省略し、
 * colors に表示用の構成色を渡す。同一構成 bundle は count 加算で集計。
 */
export function symbolBundleChunks(
  bundles: readonly SymbolBundle[]
): SymbolChunk[] {
  if (bundles.length === 0) return [];
  // 同一色組み合わせを集計
  const grouped = new Map<string, { colors: string[]; count: number }>();
  for (const b of bundles) {
    const sortedColors = [...b.colors].sort(compareSymbol);
    const key = sortedColors.join(",");
    const existing = grouped.get(key);
    if (existing) existing.count += b.count;
    else grouped.set(key, { colors: sortedColors, count: b.count });
  }
  // 単色 bundle 優先 → 多色を末尾、単色内は SYMBOL_DISPLAY_ORDER 順
  return Array.from(grouped.values())
    .sort((a, b) => {
      if (a.colors.length !== b.colors.length)
        return a.colors.length - b.colors.length;
      return compareSymbol(a.colors[0]!, b.colors[0]!);
    })
    .map(({ colors, count }) => {
      const displayColors = symbolDisplayColors(colors);
      const primary = displayColors[0]!;
      const label = displayColors.map((c) => SYMBOL_JA[c] ?? c).join("");
      return {
        symbol: colors.join("+"),
        count,
        label,
        color: SYMBOL_HEX[primary] ?? "#ffffff",
        glossy: GLOSSY_SYMBOLS.has(primary),
        ...(colors.length > 1 ? { colors: displayColors } : {}),
      };
    });
}

/** SymbolBundle 列を「赤紫1 黄2」のように整形。 */
export function formatSymbolBundles(bundles: readonly SymbolBundle[]): string {
  return symbolBundleChunks(bundles)
    .map((chunk) => `${chunk.label}${chunk.count}`)
    .join(" ");
}
