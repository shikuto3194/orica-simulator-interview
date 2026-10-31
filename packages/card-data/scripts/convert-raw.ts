/**
 * raw/cardData.js → CardDefinition[] への変換スクリプト。
 * 実行: npx tsx packages/card-data/scripts/convert-raw.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Color / Symbol mapping ──

const COLOR_MAP: Record<string, string> = {
  赤: "red",
  紫: "purple",
  緑: "green",
  白: "white",
  黄: "yellow",
  青: "blue",
  黒: "black",
};

const SPECIAL_SYMBOL_MAP: Record<string, string> = {
  神: "god",
  導: "guide",
  極: "ultimate_symbol",
  七: "seven",
  六: "six",
};

function mapSymbol(raw: string): string[] {
  // 2文字シンボル (e.g. "白導") → 両方のシンボルを持つ1つのシンボル
  // 呼び出し側でこの配列の境界を symbolColorEntries として保持する。
  if (raw.length === 2) {
    const parts: string[] = [];
    for (const ch of raw) {
      const mapped = COLOR_MAP[ch] ?? SPECIAL_SYMBOL_MAP[ch];
      if (mapped) parts.push(mapped);
    }
    return parts.length > 0 ? parts : [raw];
  }

  if (raw === "") return [];
  const mapped = COLOR_MAP[raw] ?? SPECIAL_SYMBOL_MAP[raw];
  return mapped ? [mapped] : [raw];
}

function mapColor(raw: string): string | null {
  return COLOR_MAP[raw] ?? null;
}

// ── Type mapping ──

const TYPE_MAP: Record<string, { category: string; tags: string[] }> = {
  スピリット: { category: "spirit", tags: [] },
  契約スピリット: { category: "spirit", tags: ["contract"] },
  マジック: { category: "magic", tags: [] },
  ネクサス: { category: "nexus", tags: [] },
  契約ネクサス: { category: "nexus", tags: ["contract"] },
  ブレイヴ: { category: "brave", tags: [] },
  契約ブレイヴ: { category: "brave", tags: ["contract"] },
  アルティメット: { category: "ultimate", tags: [] },
  トークンスピリット: { category: "spirit", tags: ["token"] },
  トークンアルティメット: { category: "ultimate", tags: ["token"] },
  トークンマジック: { category: "magic", tags: ["token"] },
};

// ── Level mapping ──

function mapLevel(raw: { level: string; cost: number | string; bp?: number }): {
  level: number;
  requiredCores: number;
  bp: number;
} {
  const levelNum = parseInt(raw.level.replace(/\D/g, ""), 10) || 1;
  const cores =
    typeof raw.cost === "number"
      ? raw.cost
      : parseInt(String(raw.cost).replace(/\D/g, ""), 10) || 0;
  return { level: levelNum, requiredCores: cores, bp: raw.bp ?? 0 };
}

// ── Keyword extraction ──

function extractKeywordTags(effect: string, type: string): string[] {
  const tags: string[] = [];
  if (effect.includes("バースト") || /\bburst\b/i.test(effect)) {
    tags.push("burst");
  }
  if (effect.includes("【アクセル】")) tags.push("accel");
  if (effect.includes("【煌臨")) tags.push("advent");
  if (effect.includes("【転醒】")) tags.push("rebirth");
  if (effect.includes("【チェンジ】")) tags.push("change");
  if (effect.includes("【ゼロカウンター】")) tags.push("zero_counter");
  if (effect.includes("【神託】")) tags.push("oracle");
  if (effect.includes("【ミラージュ】")) tags.push("mirage");
  if (effect.includes("魂状態")) tags.push("soul_state");
  if (effect.includes("【星霊衣】")) tags.push("star_garment");
  const typeInfo = TYPE_MAP[type];
  if (typeInfo) tags.push(...typeInfo.tags);
  return tags;
}

// ── Main conversion ──

interface RawCard {
  id: number;
  name: string;
  color?: string[];
  cost?: number;
  reduction?: string[];
  type?: string;
  tribe?: string;
  symbol?: string[];
  rarity?: string;
  pack?: string;
  cardNumber?: string;
  levels?: Array<{ level: string; cost: number; bp: number }>;
  effect?: string;
  image?: string;
  maxDeckCount?: number;
  maxTokenDeckCount?: number;
  ocBoost?: { levelLabel: string; bp: string };
  combinedBoost?: unknown;
  relatedTokens?: string[];
  isDoubleSided?: boolean;
  front?: RawCard;
  back?: RawCard;
  isBanned?: boolean;
}

interface CardBackFaceOutput {
  printedOverCount?: { minCount: number; bpBonus: number };
  name: string;
  printedCategory: string;
  colors: string[];
  cost: number;
  reductionSymbols: string[];
  levelDefs: Array<{ level: number; requiredCores: number; bp: number }>;
  symbolColors: string[];
  symbolColorEntries?: string[][];
  textLines: string[];
  keywordTags: string[];
  tribe?: string;
  image?: string;
  rarity?: string;
  pack?: string;
  cardNo?: string;
  combinedBoost?: number;
}

interface CardDefinitionOutput {
  printedOverCount?: { minCount: number; bpBonus: number };
  cardNo: string;
  orikaId: number;
  orikaIndex: number;
  name: string;
  printedCategory: string;
  colors: string[];
  cost: number;
  reductionSymbols: string[];
  levelDefs: Array<{ level: number; requiredCores: number; bp: number }>;
  symbolColors: string[];
  symbolColorEntries?: string[][];
  textLines: string[];
  keywordTags: string[];
  tribe?: string;
  image?: string;
  rarity?: string;
  pack?: string;
  maxDeckCount?: number;
  maxTokenDeckCount?: number;
  isDoubleSided?: boolean;
  backFace?: CardBackFaceOutput;
  relatedTokenCardNos?: string[];
  combinedBoost?: number;
  sourceUrls: string[];
  sourceConfidence: string;
}

function convertOverCount(raw: RawCard) {
  if (!raw.ocBoost) return {};
  const minCount = /^OC(\d+)\+$/.exec(raw.ocBoost.levelLabel)?.[1];
  const bpBonus = /^\+(\d+)$/.exec(raw.ocBoost.bp)?.[1];
  if (minCount === undefined || bpBonus === undefined) {
    throw new Error(`Invalid ocBoost: ${raw.cardNumber}`);
  }
  return {
    printedOverCount: { minCount: Number(minCount), bpBonus: Number(bpBonus) },
  };
}

function convertCardFace(raw: RawCard): CardBackFaceOutput | null {
  const type = raw.type ?? "スピリット";
  const typeInfo = TYPE_MAP[type];
  if (!typeInfo) return null;

  const colors = (raw.color ?? [])
    .map(mapColor)
    .filter((c): c is string => c !== null);
  const reductionSymbols = (raw.reduction ?? []).flatMap(mapSymbol);
  const symbolColorEntries = (raw.symbol ?? [])
    .map(mapSymbol)
    .filter((entry) => entry.length > 0);
  const symbolColors = symbolColorEntries.flat();
  const levelDefs = (raw.levels ?? []).map(mapLevel);
  const effect = raw.effect ?? "";
  // 空行を "" として保持（効果ブロック区切り）。先頭・末尾の空行のみ除去。
  const rawLines = effect.split("\n").map((line) => line.trim());
  const firstNonEmpty = rawLines.findIndex((l) => l.length > 0);
  const lastNonEmpty = rawLines.findLastIndex((l) => l.length > 0);
  const textLines =
    firstNonEmpty >= 0 ? rawLines.slice(firstNonEmpty, lastNonEmpty + 1) : [];
  const keywordTags = extractKeywordTags(effect, type);

  return {
    name: raw.name,
    ...convertOverCount(raw),
    printedCategory: typeInfo.category,
    colors,
    cost: raw.cost ?? 0,
    reductionSymbols,
    levelDefs,
    symbolColors,
    ...(symbolColorEntries.some((entry) => entry.length > 1)
      ? { symbolColorEntries }
      : {}),
    textLines,
    keywordTags,
    ...(raw.tribe ? { tribe: raw.tribe } : {}),
    ...(raw.image ? { image: raw.image } : {}),
    ...(raw.rarity ? { rarity: raw.rarity } : {}),
    ...(raw.pack ? { pack: raw.pack } : {}),
    ...(raw.cardNumber ? { cardNo: raw.cardNumber } : {}),
    ...(typeof raw.combinedBoost === "number"
      ? { combinedBoost: raw.combinedBoost }
      : {}),
  };
}

function convertCard(
  raw: RawCard,
  arrayIndex: number
): CardDefinitionOutput | null {
  // Double-sided: use front face as primary, preserve back face
  if (raw.isDoubleSided && raw.front) {
    const front = convertCard(
      {
        ...raw.front,
        ocBoost: raw.front.ocBoost ?? raw.ocBoost,
        id: raw.id,
        maxDeckCount: raw.maxDeckCount,
      },
      arrayIndex
    );
    if (front) {
      front.keywordTags.push("double_sided");
      front.isDoubleSided = true;
      // Convert and attach back face
      if (raw.back) {
        const backFace = convertCardFace(raw.back);
        if (backFace) front.backFace = backFace;
      }
    }
    return front;
  }

  const type = raw.type ?? "スピリット";
  const typeInfo = TYPE_MAP[type];
  if (!typeInfo) {
    console.warn(`Unknown type: ${type} (card: ${raw.name})`);
    return null;
  }

  // colors は CardColor のみ（特殊シンボルは含めない）
  const colors = (raw.color ?? [])
    .map(mapColor)
    .filter((c): c is string => c !== null);

  const reductionSymbols = (raw.reduction ?? []).flatMap(mapSymbol);
  const symbolColorEntries = (raw.symbol ?? [])
    .map(mapSymbol)
    .filter((entry) => entry.length > 0);
  const symbolColors = symbolColorEntries.flat();
  const levelDefs = (raw.levels ?? []).map(mapLevel);

  const effect = raw.effect ?? "";
  // 空行を "" として保持（効果ブロック区切り）。先頭・末尾の空行のみ除去。
  const rawLines = effect.split("\n").map((line) => line.trim());
  const firstNonEmpty = rawLines.findIndex((l) => l.length > 0);
  const lastNonEmpty = rawLines.findLastIndex((l) => l.length > 0);
  const textLines =
    firstNonEmpty >= 0 ? rawLines.slice(firstNonEmpty, lastNonEmpty + 1) : [];

  const keywordTags = extractKeywordTags(effect, type);

  return {
    cardNo: raw.cardNumber ?? `RAW-${raw.id}`,
    ...convertOverCount(raw),
    orikaId: raw.id,
    orikaIndex: arrayIndex,
    name: raw.name,
    printedCategory: typeInfo.category,
    colors,
    cost: raw.cost ?? 0,
    reductionSymbols,
    levelDefs,
    symbolColors,
    ...(symbolColorEntries.some((entry) => entry.length > 1)
      ? { symbolColorEntries }
      : {}),
    textLines,
    keywordTags,
    ...(raw.tribe ? { tribe: raw.tribe } : {}),
    ...(raw.image ? { image: raw.image } : {}),
    ...(raw.rarity ? { rarity: raw.rarity } : {}),
    ...(raw.pack ? { pack: raw.pack } : {}),
    ...(raw.maxDeckCount !== undefined
      ? { maxDeckCount: raw.maxDeckCount }
      : {}),
    ...(raw.maxTokenDeckCount !== undefined
      ? { maxTokenDeckCount: raw.maxTokenDeckCount }
      : {}),
    ...(typeof raw.combinedBoost === "number"
      ? { combinedBoost: raw.combinedBoost }
      : {}),
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

// ── Run ──

const rawPath = path.resolve(__dirname, "../raw/cardData.js");
let rawSrc = fs.readFileSync(rawPath, "utf8");
rawSrc = rawSrc.replace(/export default cardData;?\s*$/, "");
const loadCards = new Function(rawSrc + "; return cardData;");
const rawCards: RawCard[] = loadCards();

const converted: CardDefinitionOutput[] = [];
const skipped: string[] = [];

for (let idx = 0; idx < rawCards.length; idx++) {
  const raw = rawCards[idx]!;
  const card = convertCard(raw, idx);
  if (card) {
    converted.push(card);
  } else {
    skipped.push(`${raw.id}: ${raw.name}`);
  }
}

// Build name → cardNo map for relatedTokens resolution
const nameToCardNo = new Map<string, string>();
for (const card of converted) {
  nameToCardNo.set(card.name, card.cardNo);
}

// Resolve relatedTokens (token names) → relatedTokenCardNos (cardNo strings)
for (let i = 0; i < rawCards.length; i++) {
  const raw = rawCards[i]!;
  if (
    !raw.relatedTokens ||
    !Array.isArray(raw.relatedTokens) ||
    raw.relatedTokens.length === 0
  )
    continue;
  const card = converted.find(
    (c) => c.cardNo === (raw.cardNumber ?? `RAW-${raw.id}`)
  );
  if (!card) continue;
  const tokenCardNos = raw.relatedTokens
    .map((name) => nameToCardNo.get(name))
    .filter((no): no is string => no !== undefined);
  if (tokenCardNos.length > 0) {
    card.relatedTokenCardNos = tokenCardNos;
  }
}

// Write per-pack output
const byPack: Record<string, CardDefinitionOutput[]> = {};
for (const card of converted) {
  const pack = card.pack ?? "unknown";
  const packCode = pack.split(" ")[0]!.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!byPack[packCode]) byPack[packCode] = [];
  byPack[packCode]!.push(card);
}

const outDir = path.resolve(__dirname, "../src/cards");
fs.mkdirSync(outDir, { recursive: true });

// 既存ファイルから手動追加された effects を読み取り、変換後のカードにマージする
const existingEffects = new Map<string, unknown>();
for (const f of fs.readdirSync(outDir)) {
  if (!f.endsWith(".ts")) continue;
  const raw = fs.readFileSync(path.join(outDir, f), "utf8");
  const jsonStr = raw
    .replace(/^import.*\n\nexport const \w+: CardDefinition\[\] = /, "")
    .replace(/;\s*$/, "");
  try {
    const cards = JSON.parse(jsonStr) as Array<{
      cardNo: string;
      effects?: unknown;
    }>;
    for (const card of cards) {
      if (
        card.effects &&
        Array.isArray(card.effects) &&
        card.effects.length > 0
      ) {
        existingEffects.set(card.cardNo, card.effects);
      }
    }
  } catch {
    /* parse error — skip */
  }
}
if (existingEffects.size > 0) {
  console.log(
    `Preserving effects from ${existingEffects.size} cards: ${[...existingEffects.keys()].join(", ")}`
  );
  for (const card of converted) {
    const existing = existingEffects.get(card.cardNo);
    if (existing) {
      (card as Record<string, unknown>).effects = existing;
    }
  }
}

const indexImports: string[] = [];
const indexExports: string[] = [];

for (const [packCode, cards] of Object.entries(byPack).sort((a, b) =>
  a[0].localeCompare(b[0])
)) {
  const varName = packCode.replace(/[.-]/g, "_");
  const filePath = path.join(outDir, `${packCode}.ts`);
  const content = `import type { CardDefinition } from "@orica/rules-core";\n\nexport const ${varName}_CARDS: CardDefinition[] = ${JSON.stringify(cards, null, 2)};\n`;
  fs.writeFileSync(filePath, content, "utf8");
  indexImports.push(
    `import { ${varName}_CARDS } from "./cards/${packCode}.js";`
  );
  indexExports.push(`  ...${varName}_CARDS,`);
}

// Write index
const indexPath = path.resolve(__dirname, "../src/generated-index.ts");
const indexContent = `import type { CardDefinition } from "@orica/rules-core";\n${indexImports.join("\n")}\n\nexport const ALL_CARDS: CardDefinition[] = [\n${indexExports.join("\n")}\n];\n\nexport function getCardByNo(cardNo: string): CardDefinition | undefined {\n  return ALL_CARDS.find((card) => card.cardNo === cardNo);\n}\n`;
fs.writeFileSync(indexPath, indexContent, "utf8");

console.log(`Converted: ${converted.length} cards`);
console.log(`Packs: ${Object.keys(byPack).length}`);
if (skipped.length > 0) {
  console.log(`Skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s}`);
}
