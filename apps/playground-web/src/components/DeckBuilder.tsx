import { PACK_OPTIONS } from "../utils/deck-packs";
import { withDeckSaveTimes } from "../utils/saved-deck-sort";
import { SavedDeckBrowser } from "./SavedDeckBrowser";
import "../deck-builder-layout.css";
import { cardCategoryLabel } from "@orica/rules-core";
/**
 * DeckBuilder — デッキ構築画面（検索 / 編集 / 保存タブ）。
 *
 * クリック対話パターンの統一方針対象外:
 *   バトル中モーダルでは「クリック=アクション、長押し/右クリック=詳細」で統一しているが、
 *   ここはプライマリアクションが「カード詳細を見る」のためクリック=詳細を維持する。
 *   デッキ枚数の +/- は inline ボタンで操作する別パスに分離されている。
 */
import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { FixedSizeList, FixedSizeGrid } from "react-window";
import {
  getCardDefinitionMainDeckMaxCount,
  isCardDefinitionMainDeckAllowed,
  isContractDefinition,
  sanitizeMainDeckDefinitions,
  type CardDefinition,
} from "@orica/rules-core";
import { useAuth } from "../AuthContext";
import {
  deleteCloudDeck,
  useCloudDecks,
  upsertCloudDeck,
} from "../hooks/useCloudDecks";
import { HomeLobby } from "./HomeLobby";
import { CardDetailModal } from "./CardDetailModal";
import { DeckViewModal } from "./DeckViewModal";
import { QaTab } from "./QaTab";
import {
  INPUT_LIMITS,
  limitInputText,
  validateDeckName,
  parseCardNos,
  parseCardNoCounts,
  parseStoredDeck,
  expandCardCounts,
  readDeckFile,
  type StoredDeckInput,
} from "../input-validation";

// ─── Constants ───

interface DeckBuilderProps {
  allCards: CardDefinition[];
  onStartBattle?: (
    aliceDeck: CardDefinition[],
    bobDeck: CardDefinition[]
  ) => void;
  onBack?: () => void;
  onNavigate?: (screen: string) => void;
  /** 開発用スナップショット読み込み (home タブ 開発者向け セクション) */
  onLoadSnapshot?: (file: File) => void;
  /** 保存した棋譜の読み込み (home タブ) */
  onLoadReplay?: (file: File) => void;
  snapshotError?: string | null;
  replayError?: string | null;
}

type ActiveTab = "home" | "search" | "deck" | "saved" | "qa";
type ViewMode = "list" | "grid";

const _TYPE_SORT_ORDER: Record<string, number> = {
  spirit: 1,
  ultimate: 2,
  brave: 3,
  nexus: 4,
  magic: 5,
};

const COLOR_JA: Record<string, string> = {
  red: "赤",
  purple: "紫",
  green: "緑",
  white: "白",
  yellow: "黄",
  blue: "青",
  black: "黒",
};
const SYMBOL_JA: Record<string, string> = {
  ...COLOR_JA,
  god: "神",
  guide: "導",
  ultimate_symbol: "極",
  seven: "七",
  six: "六",
};

const STORAGE_KEY = "orica-deck-v2";
const SAVED_DECKS_KEY = "orica-saved-decks-v2";
const ARCHETYPE_CARD_THRESHOLD = 10;
const DECK_ARCHETYPE_SHARE_THRESHOLD = 0.5;
const ARCHETYPE_NAME_OVERRIDES: Record<string, string> = {
  東方靈異伝: "靈異伝",
  東方封魔録: "封魔録",
  東方夢時空: "夢時空",
  東方紅魔郷: "紅魔郷",
  東方妖々夢: "妖々夢",
  夢違科学世紀: "夢違",
  東方永夜抄: "永夜抄",
  東方花映塚: "花映塚",
  東方風神録: "風神録",
  東方緋想天: "緋想天",
  東方地霊殿: "地霊殿",
  東方星蓮船: "星蓮船",
  妖精大戦争: "大戦争",
  東方神霊廟: "神霊廟",
  東方心綺楼: "心綺楼",
  東方輝針城: "輝針城",
  東方天空璋: "天空璋",
  "ソードアートオンライン-アリシゼーション-公理協会編": "公理協会",
  ゴッドイーター: "ゴッド",
  "アルドノア・ゼロ-地球-": "地球",
  "アルドノア・ゼロ-火星-": "火星",
  "戦姫絶唱シンフォギア-切歌＆調-": "切調",
  "フェアリーテイル-ルーシィ・ハートフィリア-": "ルーシィ",
  "８６-エイティシックス-": "８６",
  俺だけレベルアップな件: "俺レベ",
  るろうに剣心: "剣心",
  転生したらスライムだった件: "転スラ",
  ドラゴンボールZ: "DBZ",
  英雄伝説軌跡シリーズ: "軌跡",
  "英雄伝説 軌跡シリーズ": "軌跡",
  "星のカービィシリーズ-メタナイト編-": "メタナイト",
};

function getArchetypeKeyFromCardNumber(cardNumber: string | undefined): string {
  const raw = String(cardNumber || "").trim();
  const match = raw.match(/^(.+?)-(?=(?:転醒)?(?:CX|TX|TR|XX|[CMRXT])\d)/);
  if (match) return match[1]!.trim();
  const fallback = raw.split("-")[0]?.trim();
  return fallback || "";
}

function getArchetypeKeyFromPack(pack: string | undefined): string {
  const prefix = String(pack || "")
    .trim()
    .split(/\s+/)[0];
  return prefix || "";
}

function getCardArchetypePrints(
  card: CardDefinition
): Array<{ key: string; pack: string }> {
  const faces: Array<{
    cardNo: string | undefined;
    pack: string | undefined;
  }> = [{ cardNo: card.cardNo, pack: card.pack }];
  if (card.backFace) {
    faces.push({
      cardNo: card.backFace.cardNo,
      pack: card.backFace.pack ?? card.pack,
    });
  }

  const prints: Array<{ key: string; pack: string }> = [];
  const seenKeys = new Set<string>();
  for (const face of faces) {
    const key =
      getArchetypeKeyFromCardNumber(face.cardNo) ||
      getArchetypeKeyFromPack(face.pack);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    prints.push({ key, pack: face.pack || card.pack || key });
  }
  return prints;
}

function getPackTitle(pack: string | undefined): string {
  return String(pack || "")
    .replace(/^[A-Z0-9.-]+\s*/, "")
    .trim();
}

function getArchetypeName(pack: string | undefined): string {
  const base = getPackTitle(pack);
  if (ARCHETYPE_NAME_OVERRIDES[base]) return ARCHETYPE_NAME_OVERRIDES[base];

  const parts = base
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
  let name = parts.length > 1 ? parts[parts.length - 1]! : base;
  name = name
    .replace(/^東方/, "")
    .replace(/シリーズ/g, "")
    .replace(/編$/, "")
    .replace(/[（）()]/g, "")
    .trim();

  const chars = Array.from(name);
  return chars.length > 5 ? chars.slice(0, 5).join("") : name || base;
}

// ─── Deck entry & sort ───

interface DeckEntry {
  card: CardDefinition;
  count: number;
}

function getTypeRank(card: CardDefinition): number {
  const tags = card.keywordTags;
  const cat = card.printedCategory;
  if (tags.includes("contract")) return 0;
  if (cat === "spirit") return 1;
  if (cat === "ultimate") return 2;
  if (cat === "brave") return 3;
  if (cat === "nexus") {
    const tribe = card.tribe ?? "";
    if (tribe.includes("創界神")) return 4;
    if (tribe.includes("導界者") || tribe.includes("創界石")) return 5;
    return 6;
  }
  if (cat === "magic") return 7;
  return 99;
}

function sortDeckEntries(entries: DeckEntry[]): DeckEntry[] {
  return [...entries].sort((a, b) => {
    const ta = getTypeRank(a.card);
    const tb = getTypeRank(b.card);
    if (ta !== tb) return ta - tb;
    if (a.card.cost !== b.card.cost) return a.card.cost - b.card.cost;
    return a.card.name.localeCompare(b.card.name, "ja");
  });
}

function getCategoryLabel(card: CardDefinition): string {
  const base = cardCategoryLabel(card.printedCategory);
  if (card.keywordTags.includes("contract")) return `契約${base}`;
  if (card.keywordTags.includes("token")) return `トークン${base}`;
  return base;
}

function isTokenCard(card: CardDefinition): boolean {
  return card.keywordTags.includes("token");
}

function sanitizeMainDeckCardNos(
  cardNos: readonly string[],
  cardNoMap: ReadonlyMap<string, CardDefinition>
): string[] {
  const cards: CardDefinition[] = [];
  for (const cardNo of cardNos) {
    const card = cardNoMap.get(cardNo);
    if (card) cards.push(card);
  }
  return sanitizeMainDeckDefinitions(cards).map((card) => card.cardNo);
}

function deckMapToCardNos(deckMap: ReadonlyMap<string, number>): string[] {
  return expandCardCounts(
    [...deckMap]
      .filter(([, count]) => count > 0)
      .map(([cardNo, count]) => ({ cardNo, count }))
  );
}

function cardNosToDeckMap(cardNos: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cardNo of cardNos) {
    counts.set(cardNo, (counts.get(cardNo) ?? 0) + 1);
  }
  return counts;
}

function sanitizeMainDeckMap(
  deckMap: ReadonlyMap<string, number>,
  cardNoMap: ReadonlyMap<string, CardDefinition>
): Map<string, number> {
  return cardNosToDeckMap(
    sanitizeMainDeckCardNos(deckMapToCardNos(deckMap), cardNoMap)
  );
}

function deckMapsEqual(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>
): boolean {
  if (a.size !== b.size) return false;
  for (const [cardNo, count] of a) {
    if (b.get(cardNo) !== count) return false;
  }
  return true;
}

// ─── Saved deck format ───

type SavedDeck = StoredDeckInput;

function loadSavedDecks(): SavedDeck[] {
  try {
    // Try v2 first, then fallback to v1
    const raw =
      localStorage.getItem(SAVED_DECKS_KEY) ??
      localStorage.getItem("orica-saved-decks-v1");
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const decks = parsed.map(parseStoredDeck);
    // 同名 dedupe (後勝ち)。過去バージョンや手動編集で混入した重複を読み込み時に解消し、
    // key={deck.name} の React key 衝突 warn を防ぐ。検出したら永続化し直す。
    const byName = new Map<string, SavedDeck>();
    for (const d of decks) byName.set(d.name, d);
    const deduped = Array.from(byName.values());
    if (deduped.length !== decks.length) {
      localStorage.setItem(SAVED_DECKS_KEY, JSON.stringify(deduped));
    }
    return deduped;
  } catch {
    return [];
  }
}
function persistSavedDecks(decks: SavedDeck[]) {
  localStorage.setItem(SAVED_DECKS_KEY, JSON.stringify(decks));
}

// ─── Share URL encoding ───

function encodeDeck(
  deckMap: Map<string, number>,
  allCards: CardDefinition[]
): string {
  const orikaIdMap = new Map<string, number>();
  for (const c of allCards)
    if (c.orikaId != null) orikaIdMap.set(c.cardNo, c.orikaId);
  const pairs: number[] = [];
  for (const [cardNo, count] of deckMap) {
    const id = orikaIdMap.get(cardNo);
    if (id != null) {
      pairs.push(id);
      pairs.push(count);
    }
  }
  const bytes = new Uint8Array(pairs.length * 2);
  for (let i = 0; i < pairs.length; i += 2) {
    const id = pairs[i]!;
    const cnt = pairs[i + 1]!;
    const off = i;
    bytes[off] = (id >> 8) & 0xff;
    bytes[off + 1] = id & 0xff;
    bytes[off + 2] = (cnt >> 8) & 0xff;
    bytes[off + 3] = cnt & 0xff;
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeDeck(
  encoded: string,
  allCards: CardDefinition[]
): Map<string, number> {
  const idToCardNo = new Map<number, string>();
  for (const c of allCards)
    if (c.orikaId != null) idToCardNo.set(c.orikaId, c.cardNo);
  if (encoded.length > Math.ceil((INPUT_LIMITS.deckCards * 16) / 3))
    throw new Error("デッキURLが長すぎます");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = new Map<string, number>();
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const id = (bytes[i]! << 8) | bytes[i + 1]!;
    const cnt = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const cardNo = idToCardNo.get(id);
    if (cardNo) result.set(cardNo, cnt);
  }
  parseCardNoCounts([...result].map(([cardNo, count]) => ({ cardNo, count })));
  return result;
}

// ─── Grid cell component (memo'd) ───

interface GridCellData {
  cards: CardDefinition[];
  columns: number;
  getCount: (cardNo: string) => number;
  getMax: (card: CardDefinition) => number;
  onIncrease: (cardNo: string) => void;
  onDecrease: (cardNo: string) => void;
  onCardClick: (card: CardDefinition) => void;
  isTokenBadge?: boolean;
}

const CardGridCell = memo(function CardGridCell({
  columnIndex,
  rowIndex,
  style,
  data,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: GridCellData;
}) {
  const idx = rowIndex * data.columns + columnIndex;
  if (idx >= data.cards.length) return null;
  const card = data.cards[idx]!;
  const count = data.getCount(card.cardNo);
  const max = data.getMax(card);
  const isToken = isTokenCard(card) || data.isTokenBadge;
  const imgSrc = card.image ? `/${card.image}` : null;

  return (
    <div
      style={{
        ...style,
        padding: 0,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <div
        className="db-grid-card-img-wrap"
        onClick={() => data.onCardClick(card)}
      >
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={card.name}
            className="db-grid-card-img"
            loading="lazy"
          />
        ) : (
          <div className="db-grid-card-placeholder">{card.name}</div>
        )}
        {count > 0 && (
          <span className={`db-grid-card-badge${isToken ? " token" : ""}`}>
            {count}
          </span>
        )}
        {max > 0 && (
          <div className="db-grid-card-btns">
            <button
              className={`db-grid-minus${isToken ? " db-token-outline" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                data.onDecrease(card.cardNo);
              }}
              disabled={count <= 0}
            >
              −
            </button>
            <button
              className={`db-grid-plus${isToken ? " db-token-solid" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                data.onIncrease(card.cardNo);
              }}
              disabled={count >= max}
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── List row component for deck tab ───

interface DeckListData {
  mainCards: DeckEntry[];
  tokenCards: Array<{ card: CardDefinition; count: number }>;
  tokenTotal: number;
  onIncrease: (cardNo: string) => void;
  onDecrease: (cardNo: string) => void;
  onTokenIncrease: (cardNo: string) => void;
  onTokenDecrease: (cardNo: string) => void;
  onCardClick: (card: CardDefinition) => void;
}

const DeckListRow = memo(function DeckListRow({
  index,
  style,
  data,
}: {
  index: number;
  style: React.CSSProperties;
  data: DeckListData;
}) {
  const mainLen = data.mainCards.length;
  const hasTokens = data.tokenCards.length > 0;

  // Main card rows
  if (index < mainLen) {
    const entry = data.mainCards[index]!;
    const { card, count } = entry;
    const max = getCardDefinitionMainDeckMaxCount(card);
    const type = getCategoryLabel(card);
    const imgSrc = card.image ? `/${card.image}` : null;
    return (
      <div
        className="db-list-item"
        style={{ ...style, touchAction: "pan-y", cursor: "pointer" }}
        onClick={() => data.onCardClick(card)}
      >
        <div className="db-list-thumb-wrap">
          {imgSrc && (
            <img src={imgSrc} alt={card.name} className="db-list-thumb" />
          )}
        </div>
        <div className="db-list-info">
          <b>{card.name}</b> <span className="db-list-type">({type})</span>
        </div>
        {max > 0 && (
          <div className="db-list-controls">
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onDecrease(card.cardNo);
              }}
              disabled={count <= 0}
            >
              −
            </button>
            <span>
              {count} / {max}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onIncrease(card.cardNo);
              }}
              disabled={count >= max}
            >
              +
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!hasTokens) return null;

  // Token header row
  if (index === mainLen) {
    return (
      <div
        className="db-token-heading"
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          padding: "0 0.8em",
        }}
      >
        トークンデッキ: {data.tokenTotal}枚
      </div>
    );
  }

  // Token card rows
  const t = data.tokenCards[index - mainLen - 1];
  if (!t) return null;
  const { card: tc, count: tCount } = t;
  const tMax = tc.maxTokenDeckCount ?? 9;
  const imgSrc = tc.image ? `/${tc.image}` : null;
  return (
    <div
      className="db-list-item"
      style={{ ...style, touchAction: "pan-y", cursor: "pointer" }}
      onClick={() => data.onCardClick(tc)}
    >
      <div className="db-list-thumb-wrap">
        {imgSrc && <img src={imgSrc} alt={tc.name} className="db-list-thumb" />}
      </div>
      <div className="db-list-info">
        <b>{tc.name}</b>{" "}
        <span className="db-list-type">({getCategoryLabel(tc)})</span>
      </div>
      <div className="db-list-controls token">
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onTokenDecrease(tc.cardNo);
          }}
          disabled={tCount <= 0}
        >
          −
        </button>
        <span>
          {tCount} / {tMax}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onTokenIncrease(tc.cardNo);
          }}
          disabled={tCount >= tMax}
        >
          +
        </button>
      </div>
    </div>
  );
});

// ─── Search list row ───

interface SearchListData {
  cards: CardDefinition[];
  getCount: (cardNo: string) => number;
  onIncrease: (cardNo: string) => void;
  onDecrease: (cardNo: string) => void;
  onCardClick: (card: CardDefinition) => void;
}

const SearchListRow = memo(function SearchListRow({
  index,
  style,
  data,
}: {
  index: number;
  style: React.CSSProperties;
  data: SearchListData;
}) {
  const card = data.cards[index]!;
  const count = data.getCount(card.cardNo);
  const isToken = isTokenCard(card);
  const max = isToken
    ? (card.maxTokenDeckCount ?? 9)
    : getCardDefinitionMainDeckMaxCount(card);
  const type = getCategoryLabel(card);
  const imgSrc = card.image ? `/${card.image}` : null;
  return (
    <div
      className="db-list-item"
      style={{ ...style, touchAction: "pan-y", cursor: "pointer" }}
      onClick={() => data.onCardClick(card)}
    >
      <div className="db-list-thumb-wrap">
        {imgSrc && (
          <img
            src={imgSrc}
            alt={card.name}
            className="db-list-thumb"
            loading="lazy"
          />
        )}
      </div>
      <div className="db-list-info">
        <b>{card.name}</b> <span className="db-list-type">({type})</span>
      </div>
      {max > 0 && (
        <div className={`db-list-controls${isToken ? " token" : ""}`}>
          <button
            className={isToken ? "db-token-outline" : ""}
            onClick={(e) => {
              e.stopPropagation();
              data.onDecrease(card.cardNo);
            }}
            disabled={count <= 0}
          >
            −
          </button>
          <span>
            {count}/{max}
          </span>
          <button
            className={isToken ? "db-token-solid" : ""}
            onClick={(e) => {
              e.stopPropagation();
              data.onIncrease(card.cardNo);
            }}
            disabled={count >= max}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════
// ─── Main DeckBuilder component ───
// ═══════════════════════════════════════════════════

export function DeckBuilder({
  allCards,
  onStartBattle: _onStartBattle,
  onBack: _onBack,
  onNavigate,
  onLoadSnapshot,
  onLoadReplay,
  snapshotError,
  replayError,
}: DeckBuilderProps) {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const {
    decks: cloudDecks,
    scope: deckScope,
    error: cloudError,
    shared: decksShared,
  } = useCloudDecks(user?.id, allCards);
  const previousScope = useRef<string | null>(null);
  const snapshotFileInputRef = useRef<HTMLInputElement | null>(null);
  const replayFileInputRef = useRef<HTMLInputElement | null>(null);

  // Tab & view
  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Measure the card pane in landscape; preserve the portrait dimensions.
  const searchCardsRef = useRef<HTMLDivElement>(null);
  const deckCardsRef = useRef<HTMLDivElement>(null);
  const [isLandscape, setIsLandscape] = useState(
    () => window.matchMedia("(orientation: landscape)").matches
  );
  const [listSize, setListSize] = useState({
    width: Math.max(window.innerWidth, 320),
    height: Math.max(window.innerHeight - 200, 300),
  });
  useEffect(() => {
    const pane =
      activeTab === "deck" ? deckCardsRef.current : searchCardsRef.current;
    const measure = () => {
      const landscape = window.matchMedia("(orientation: landscape)").matches;
      setIsLandscape(landscape);
      const width =
        landscape && pane?.clientWidth
          ? pane.clientWidth
          : Math.max(window.innerWidth, 320);
      const height =
        landscape && pane?.clientHeight
          ? pane.clientHeight
          : Math.max(window.innerHeight - 200, 300);
      setListSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      );
    };
    const observer = new ResizeObserver(measure);
    if (pane) observer.observe(pane);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeTab]);
  const [gridScrollbarWidth, setGridScrollbarWidth] = useState(0);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll;scrollbar-gutter:stable;";
    document.body.appendChild(probe);
    setGridScrollbarWidth(probe.offsetWidth - probe.clientWidth);
    probe.remove();
  }, []);
  const gridColumns = isLandscape ? 5 : 4;
  const safeWidth = Math.max(listSize.width, 1);
  const safeHeight = Math.max(listSize.height, 1);
  const gridColWidth = Math.max(
    Math.floor(
      (safeWidth - (isLandscape ? gridScrollbarWidth : 0)) / gridColumns
    ),
    1
  );
  const gridImgWidth = Math.floor(gridColWidth * 0.92);
  const gridImgHeight = Math.floor((gridImgWidth * 561) / 385);
  const gridRowHeight = Math.floor(gridImgHeight / 0.92);

  // Card lookup
  const cardNoMap = useMemo(
    () => new Map(allCards.map((c) => [c.cardNo, c])),
    [allCards]
  );

  // ─── Deck state ───

  const [deckMap, setDeckMap] = useState<Map<string, number>>(() => {
    try {
      if (userId) return new Map();
      const raw =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem("orica-deck-v1");
      if (!raw) return new Map();
      const cardNos = parseCardNos(JSON.parse(raw) as unknown);
      const counts = new Map<string, number>();
      for (const no of cardNos) counts.set(no, (counts.get(no) ?? 0) + 1);
      return counts;
    } catch {
      return new Map();
    }
  });

  const [tokenDeckMap, setTokenDeckMap] = useState<Map<string, number>>(() => {
    try {
      if (userId) return new Map();
      const raw = localStorage.getItem(STORAGE_KEY + "-tokens");
      if (!raw) return new Map();
      const arr = parseCardNoCounts(JSON.parse(raw) as unknown);
      return new Map(arr.map((e) => [e.cardNo, e.count]));
    } catch {
      return new Map();
    }
  });

  const [deckThumbnailCardNo, setDeckThumbnailCardNo] = useState<string | null>(
    () => {
      return userId ? null : localStorage.getItem(STORAGE_KEY + "-thumb");
    }
  );

  const [deckName, setDeckName] = useState("");
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>(() =>
    userId ? [] : loadSavedDecks()
  );
  const [showDeckInfoModal, setShowDeckInfoModal] = useState(false);
  const [message, setMessage] = useState("");

  // Card detail modal
  const [detailCard, setDetailCard] = useState<CardDefinition | null>(null);

  // DeckViewModal state
  const [viewDeck, setViewDeck] = useState<SavedDeck | null>(null);

  useEffect(() => {
    if (!userId) {
      setSavedDecks(loadSavedDecks());
      return;
    }
    setSavedDecks(
      cloudDecks.map((deck) => ({
        name: deck.name,
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        cardNos: deck.cardNos,
        tokenDeck: deck.tokenDeck,
        ...(deck.thumbnailCardNo
          ? { thumbnailCardNo: deck.thumbnailCardNo }
          : {}),
      }))
    );
  }, [cloudDecks, userId]);

  useEffect(() => {
    if (
      previousScope.current &&
      deckScope &&
      previousScope.current !== deckScope
    ) {
      setDeckMap(new Map());
      setTokenDeckMap(new Map());
      setDeckName("");
      setDeckThumbnailCardNo(null);
      setViewDeck(null);
      setMessage("連携設定が変更されたためデッキを再読み込みしました");
    }
    if (deckScope) previousScope.current = deckScope;
  }, [deckScope]);

  // ─── Tab swipe ───
  const TAB_ORDER: ActiveTab[] = ["home", "search", "deck", "saved", "qa"];
  const homeContainerRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const deckContainerRef = useRef<HTMLDivElement>(null);
  const savedContainerRef = useRef<HTMLDivElement>(null);
  const qaContainerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const useSwipeTab = (
    containerRef: React.RefObject<HTMLDivElement | null>
  ) => {
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      el.style.touchAction = "pan-y";
      const handleTouchStart = (e: TouchEvent) => {
        touchStartRef.current = { x: null, y: null };
        // Nested horizontal gestures (such as the home avatar picker) own
        // their swipe; they must not also navigate the workspace tabs.
        if (
          (e.target as Element).closest("[data-swipe-owner]") ||
          e.touches.length !== 1
        )
          return;
        const t = e.touches[0]!;
        touchStartRef.current = { x: t.clientX, y: t.clientY };
      };
      const handleTouchEnd = (e: TouchEvent) => {
        if (
          touchStartRef.current.x === null ||
          touchStartRef.current.y === null
        )
          return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - touchStartRef.current.x;
        const dy = t.clientY - touchStartRef.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          setActiveTab((prev) => {
            const idx = TAB_ORDER.indexOf(prev);
            if (dx < 0 && idx < TAB_ORDER.length - 1)
              return TAB_ORDER[idx + 1]!;
            if (dx > 0 && idx > 0) return TAB_ORDER[idx - 1]!;
            return prev;
          });
        }
        touchStartRef.current = { x: null, y: null };
      };
      const cancelTouch = () => {
        touchStartRef.current = { x: null, y: null };
      };
      el.addEventListener("touchstart", handleTouchStart, { passive: true });
      el.addEventListener("touchend", handleTouchEnd, { passive: true });
      el.addEventListener("touchcancel", cancelTouch, { passive: true });
      return () => {
        el.removeEventListener("touchstart", handleTouchStart);
        el.removeEventListener("touchend", handleTouchEnd);
        el.removeEventListener("touchcancel", cancelTouch);
      };
    }, [containerRef]);
  };
  useSwipeTab(homeContainerRef);
  useSwipeTab(searchContainerRef);
  useSwipeTab(deckContainerRef);
  useSwipeTab(savedContainerRef);
  useSwipeTab(qaContainerRef);

  // Filter state
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [filterColor, setFilterColor] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterRarity, setFilterRarity] = useState("");
  const [filterTribe, setFilterTribe] = useState("");
  const [filterPack, setFilterPack] = useState("");
  const [filterCost, setFilterCost] = useState("");
  const [filterReduction, setFilterReduction] = useState("");
  const [filterSymbol, setFilterSymbol] = useState("");

  // Tribe autocomplete
  const [tribeDropdownOpen, setTribeDropdownOpen] = useState(false);
  const tribeDropdownRef = useRef<HTMLDivElement>(null);
  const tribeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) {
      if (c.tribe)
        for (const t of c.tribe.split(/[・／/]/)) {
          const trimmed = t.trim();
          if (trimmed) set.add(trimmed);
        }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ja"));
  }, [allCards]);
  const filteredTribeOptions = useMemo(() => {
    if (!filterTribe) return tribeOptions;
    return tribeOptions.filter((t) => t.includes(filterTribe));
  }, [tribeOptions, filterTribe]);

  // Close tribe dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        tribeDropdownRef.current &&
        !tribeDropdownRef.current.contains(e.target as Node)
      )
        setTribeDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Computed ───

  const totalCards = useMemo(() => {
    let t = 0;
    for (const count of deckMap.values()) t += count;
    return t;
  }, [deckMap]);

  const tokenTotal = useMemo(() => {
    let t = 0;
    for (const count of tokenDeckMap.values()) t += count;
    return t;
  }, [tokenDeckMap]);

  // ─── Persistence helpers ───

  const persistDeck = useCallback(
    (map: Map<string, number>) => {
      const cardNos = deckMapToCardNos(map);
      if (userId) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cardNos));
    },
    [userId]
  );

  const persistTokenDeck = useCallback(
    (map: Map<string, number>) => {
      const arr = [...map.entries()]
        .filter(([, c]) => c > 0)
        .map(([cardNo, count]) => ({ cardNo, count }));
      if (userId) return;
      localStorage.setItem(STORAGE_KEY + "-tokens", JSON.stringify(arr));
    },
    [userId]
  );

  const persistThumbnail = useCallback(
    (cardNo: string | null) => {
      if (userId) return;
      if (cardNo) localStorage.setItem(STORAGE_KEY + "-thumb", cardNo);
      else localStorage.removeItem(STORAGE_KEY + "-thumb");
    },
    [userId]
  );

  useEffect(() => {
    setDeckMap((prev) => {
      const next = sanitizeMainDeckMap(prev, cardNoMap);
      if (deckMapsEqual(prev, next)) return prev;
      persistDeck(next);
      return next;
    });
  }, [cardNoMap, persistDeck]);

  // ─── Deck operations ───

  const updateDeckMap = useCallback(
    (fn: (prev: Map<string, number>) => Map<string, number>) => {
      setDeckMap((prev) => {
        const next = fn(prev);
        if (
          [...next.values()].reduce((total, count) => total + count, 0) >
          INPUT_LIMITS.deckCards
        )
          return prev;
        persistDeck(next);
        return next;
      });
    },
    [persistDeck]
  );

  const addCard = useCallback(
    (cardNo: string) => {
      const card = cardNoMap.get(cardNo);
      if (!card || !isCardDefinitionMainDeckAllowed(card)) return;
      updateDeckMap((prev) => {
        const count = prev.get(cardNo) ?? 0;
        if (count >= getCardDefinitionMainDeckMaxCount(card)) return prev;
        if (isContractDefinition(card)) {
          for (const [existingCardNo, existingCount] of prev) {
            const existingCard = cardNoMap.get(existingCardNo);
            if (
              existingCount > 0 &&
              existingCardNo !== cardNo &&
              existingCard &&
              isContractDefinition(existingCard)
            ) {
              return prev;
            }
          }
        }
        const next = new Map(prev);
        next.set(cardNo, count + 1);
        return next;
      });
      // Auto-add related tokens
      const card2 = cardNoMap.get(cardNo);
      if (card2?.relatedTokenCardNos) {
        setTokenDeckMap((prev) => {
          const next = new Map(prev);
          for (const tNo of card2.relatedTokenCardNos!) {
            if (!next.has(tNo)) {
              const tCard = cardNoMap.get(tNo);
              next.set(tNo, Math.min(9, tCard?.maxTokenDeckCount ?? 9));
            }
          }
          if (
            [...next.values()].reduce((total, count) => total + count, 0) >
            INPUT_LIMITS.deckCards
          )
            return prev;
          persistTokenDeck(next);
          return next;
        });
      }
    },
    [cardNoMap, updateDeckMap, persistTokenDeck]
  );

  const removeCard = useCallback(
    (cardNo: string) => {
      updateDeckMap((prev) => {
        const count = prev.get(cardNo) ?? 0;
        if (count <= 0) return prev;
        const next = new Map(prev);
        if (count === 1) next.delete(cardNo);
        else next.set(cardNo, count - 1);
        return next;
      });
    },
    [updateDeckMap]
  );

  const increaseTokenCount = useCallback(
    (cardNo: string) => {
      const card = cardNoMap.get(cardNo);
      const max = card?.maxTokenDeckCount ?? 9;
      setTokenDeckMap((prev) => {
        const cnt = prev.get(cardNo) ?? 0;
        if (
          cnt >= max ||
          [...prev.values()].reduce((total, count) => total + count, 0) >=
            INPUT_LIMITS.deckCards
        )
          return prev;
        const next = new Map(prev);
        next.set(cardNo, cnt + 1);
        persistTokenDeck(next);
        return next;
      });
    },
    [cardNoMap, persistTokenDeck]
  );

  const decreaseTokenCount = useCallback(
    (cardNo: string) => {
      setTokenDeckMap((prev) => {
        const cnt = prev.get(cardNo) ?? 0;
        if (cnt <= 0) return prev;
        const next = new Map(prev);
        next.set(cardNo, cnt - 1);
        persistTokenDeck(next);
        return next;
      });
    },
    [persistTokenDeck]
  );

  const getTokenCount = useCallback(
    (cardNo: string) => tokenDeckMap.get(cardNo) ?? 0,
    [tokenDeckMap]
  );

  // ─── Filters ───

  const resetFilters = useCallback(() => {
    setSearch("");
    setFilterColor("");
    setFilterType("");
    setFilterRarity("");
    setFilterTribe("");
    setFilterPack("");
    setFilterCost("");
    setFilterReduction("");
    setFilterSymbol("");
  }, []);

  const filteredCards = useMemo(() => {
    const keyword = search.toLowerCase();
    return allCards
      .filter((card) => {
        const name = card.name;
        const effect = card.textLines?.join(" ") ?? "";
        const colors = card.colors ?? [];
        const colorJa = colors.map((c) => COLOR_JA[c] ?? c);
        const categoryLabel = getCategoryLabel(card);
        const rarity = card.rarity ?? "";
        const tribe = card.tribe ?? "";
        const cost = String(card.cost);
        const reductions = (card.reductionSymbols ?? []).map(
          (r) => SYMBOL_JA[r] ?? r
        );
        const symbols = (card.symbolColors ?? []).map((s) => SYMBOL_JA[s] ?? s);
        const pack = card.pack ?? "";

        if (keyword) {
          const match =
            name.toLowerCase().includes(keyword) ||
            effect.toLowerCase().includes(keyword) ||
            colorJa.join("").includes(keyword) ||
            categoryLabel.toLowerCase().includes(keyword) ||
            rarity.toLowerCase().includes(keyword) ||
            tribe.toLowerCase().includes(keyword) ||
            cost.includes(keyword) ||
            pack.toLowerCase().includes(keyword) ||
            card.cardNo.toLowerCase().includes(keyword);
          if (!match) return false;
        }
        if (filterColor) {
          if (filterColor === "多色") {
            if (colors.length < 2) return false;
          } else {
            const eng =
              Object.entries(COLOR_JA).find(
                ([, v]) => v === filterColor
              )?.[0] ?? filterColor;
            if (!(colors as readonly string[]).includes(eng)) return false;
          }
        }
        if (filterType) {
          if (!categoryLabel.includes(filterType)) return false;
        }
        if (filterRarity && rarity !== filterRarity) return false;
        if (
          filterTribe &&
          !tribe.toLowerCase().includes(filterTribe.toLowerCase())
        )
          return false;
        if (filterPack && !pack.includes(filterPack)) return false;
        if (filterCost && cost !== filterCost) return false;
        if (filterReduction && !reductions.includes(filterReduction))
          return false;
        if (filterSymbol && !symbols.join("").includes(filterSymbol))
          return false;
        return true;
      })
      .sort((a, b) => (a.orikaIndex ?? 9999) - (b.orikaIndex ?? 9999));
  }, [
    allCards,
    search,
    filterColor,
    filterType,
    filterRarity,
    filterTribe,
    filterPack,
    filterCost,
    filterReduction,
    filterSymbol,
  ]);

  const deckInfo = useMemo(() => {
    const archetypeCandidates = new Map<
      string,
      { key: string; pack: string; cardNos: Set<string> }
    >();
    for (const card of allCards) {
      for (const print of getCardArchetypePrints(card)) {
        if (!archetypeCandidates.has(print.key)) {
          archetypeCandidates.set(print.key, {
            key: print.key,
            pack: print.pack,
            cardNos: new Set<string>(),
          });
        }
        const candidate = archetypeCandidates.get(print.key)!;
        if (
          (!candidate.pack || candidate.pack === candidate.key) &&
          print.pack
        ) {
          candidate.pack = print.pack;
        }
        candidate.cardNos.add(card.cardNo);
      }
    }

    const archetypes = [...archetypeCandidates.values()]
      .filter((candidate) => candidate.cardNos.size >= ARCHETYPE_CARD_THRESHOLD)
      .map((candidate) => ({
        key: candidate.key,
        pack: candidate.pack,
        packTitle: getPackTitle(candidate.pack),
        name: getArchetypeName(candidate.pack),
        cardTypeCount: candidate.cardNos.size,
      }));
    const eligibleKeys = new Set(archetypes.map((archetype) => archetype.key));

    const coveredKeys = new Set<string>();
    for (const saved of savedDecks) {
      const deckPackCounts = new Map<string, number>();
      let deckTotal = 0;
      const addCardToDeckCounts = (
        card: CardDefinition | undefined,
        count: number
      ) => {
        if (!card || count <= 0) return;
        deckTotal += count;
        for (const print of getCardArchetypePrints(card)) {
          deckPackCounts.set(
            print.key,
            (deckPackCounts.get(print.key) ?? 0) + count
          );
        }
      };

      const mainCounts = cardNosToDeckMap(saved.cardNos);
      for (const [cardNo, count] of mainCounts) {
        addCardToDeckCounts(cardNoMap.get(cardNo), count);
      }
      for (const token of saved.tokenDeck ?? []) {
        addCardToDeckCounts(cardNoMap.get(token.cardNo), token.count);
      }

      if (deckTotal <= 0 || deckPackCounts.size === 0) continue;
      const [mainKey, mainCount] = [...deckPackCounts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0]!;
      if (
        eligibleKeys.has(mainKey) &&
        mainCount / deckTotal >= DECK_ARCHETYPE_SHARE_THRESHOLD
      ) {
        coveredKeys.add(mainKey);
      }
    }

    const coveredArchetypes = archetypes.filter((archetype) =>
      coveredKeys.has(archetype.key)
    );
    const missingArchetypes = archetypes.filter(
      (archetype) => !coveredKeys.has(archetype.key)
    );

    return {
      totalDecks: savedDecks.length,
      totalArchetypes: archetypes.length,
      coveredArchetypes,
      missingArchetypes,
    };
  }, [allCards, cardNoMap, savedDecks]);

  // ─── Sorted deck entries ───

  const deckEntries = useMemo((): DeckEntry[] => {
    const entries: DeckEntry[] = [];
    for (const [cardNo, count] of deckMap) {
      const card = cardNoMap.get(cardNo);
      if (card) entries.push({ card, count });
    }
    return sortDeckEntries(entries);
  }, [deckMap, cardNoMap]);

  // Token cards in deck
  const tokenCardsInDeck = useMemo((): Array<{
    card: CardDefinition;
    count: number;
  }> => {
    // Collect from related tokens
    const tokenNos = new Set<string>();
    for (const [cardNo] of deckMap) {
      const card = cardNoMap.get(cardNo);
      if (card?.relatedTokenCardNos) {
        for (const tNo of card.relatedTokenCardNos) tokenNos.add(tNo);
      }
    }
    // Also include any manually added tokens
    for (const [cardNo, cnt] of tokenDeckMap) {
      if (cnt > 0) tokenNos.add(cardNo);
    }
    const result: Array<{ card: CardDefinition; count: number }> = [];
    for (const tNo of tokenNos) {
      const cnt = tokenDeckMap.get(tNo) ?? 0;
      if (cnt <= 0) continue;
      const card = cardNoMap.get(tNo);
      if (card) result.push({ card, count: cnt });
    }
    return result;
  }, [deckMap, tokenDeckMap, cardNoMap]);

  // ─── Thumbnail ───

  const thumbnailCard = useMemo(() => {
    if (deckThumbnailCardNo) {
      const card = cardNoMap.get(deckThumbnailCardNo);
      if (
        card &&
        (deckMap.has(card.cardNo) || (tokenDeckMap.get(card.cardNo) ?? 0) > 0)
      )
        return card;
    }
    // Fallback to first deck card
    for (const [cardNo] of deckMap) {
      const card = cardNoMap.get(cardNo);
      if (card) return card;
    }
    // Fallback to first token
    for (const [cardNo, cnt] of tokenDeckMap) {
      if (cnt > 0) {
        const card = cardNoMap.get(cardNo);
        if (card) return card;
      }
    }
    return null;
  }, [deckThumbnailCardNo, deckMap, tokenDeckMap, cardNoMap]);

  // ─── Save / Load / Clear ───

  const saveCurrentDeck = useCallback(async () => {
    let name: string;
    try {
      name = validateDeckName(deckName);
    } catch (cause) {
      setMessage((cause as Error).message);
      return;
    }
    if (totalCards === 0 && tokenTotal === 0) {
      setMessage("デッキが空です");
      return;
    }
    const cardNos = deckMapToCardNos(deckMap);
    const tokenArr = [...tokenDeckMap.entries()]
      .filter(([, c]) => c > 0)
      .map(([cardNo, count]) => ({ cardNo, count }));
    const previousDeck = savedDecks.find((d) => d.name === name);
    const newDeck: SavedDeck = withDeckSaveTimes(
      {
        name,
        cardNos,
        ...(deckThumbnailCardNo != null
          ? { thumbnailCardNo: deckThumbnailCardNo }
          : {}),
      },
      previousDeck
    );
    if (tokenArr.length > 0) newDeck.tokenDeck = tokenArr;
    const existing = savedDecks.findIndex((d) => d.name === deckName.trim());
    if (
      existing >= 0 &&
      !window.confirm(`デッキ「${deckName.trim()}」を上書きしますか？`)
    ) {
      return;
    }
    const newDecks = [...savedDecks];
    if (existing >= 0) newDecks[existing] = newDeck;
    else newDecks.push(newDeck);
    if (
      userId &&
      !(await upsertCloudDeck(userId, newDeck, allCards, deckScope))
    ) {
      setMessage(
        "保存できませんでした。連携設定と通信を確認して再読み込みしてください"
      );
      return;
    }
    setSavedDecks(newDecks);
    if (!userId) persistSavedDecks(newDecks);
    setMessage("保存しました");
    setTimeout(() => setMessage(""), 2000);
  }, [
    allCards,
    deckName,
    deckMap,
    tokenDeckMap,
    totalCards,
    tokenTotal,
    savedDecks,
    deckThumbnailCardNo,
    userId,
    deckScope,
  ]);

  const loadSavedDeckData = useCallback(
    (deck: SavedDeck) => {
      const counts = cardNosToDeckMap(
        sanitizeMainDeckCardNos(deck.cardNos, cardNoMap)
      );
      setDeckMap(counts);
      persistDeck(counts);
      const tokenCounts = new Map<string, number>();
      if (deck.tokenDeck) {
        for (const t of deck.tokenDeck) tokenCounts.set(t.cardNo, t.count);
      }
      setTokenDeckMap(tokenCounts);
      persistTokenDeck(tokenCounts);
      setDeckThumbnailCardNo(deck.thumbnailCardNo ?? null);
      persistThumbnail(deck.thumbnailCardNo ?? null);
      setDeckName(deck.name);
      setActiveTab("deck");
    },
    [cardNoMap, persistDeck, persistTokenDeck, persistThumbnail]
  );

  const deleteDeck = useCallback(
    async (name: string) => {
      if (!window.confirm(`デッキ「${name}」を削除しますか？`)) return;
      if (userId && !(await deleteCloudDeck(userId, name, deckScope))) {
        setMessage(
          "削除できませんでした。連携設定と通信を確認して再読み込みしてください"
        );
        return;
      }
      const newDecks = savedDecks.filter((d) => d.name !== name);
      setSavedDecks(newDecks);
      if (!userId) persistSavedDecks(newDecks);
    },
    [savedDecks, userId, deckScope]
  );

  const clearDeck = useCallback(() => {
    setDeckMap(new Map());
    persistDeck(new Map());
    setTokenDeckMap(new Map());
    persistTokenDeck(new Map());
    setDeckThumbnailCardNo(null);
    persistThumbnail(null);
    setDeckName("");
  }, [persistDeck, persistTokenDeck, persistThumbnail]);

  // ─── Share URL ───

  const getShareUrl = useCallback(() => {
    const encoded = encodeDeck(deckMap, allCards);
    const base = window.location.origin + window.location.pathname;
    let url = `${base}?deck=${encoded}`;
    if (tokenDeckMap.size > 0) {
      const tokenEncoded = encodeDeck(tokenDeckMap, allCards);
      url += `&token=${tokenEncoded}`;
    }
    return url;
  }, [deckMap, tokenDeckMap, allCards]);

  // Load from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deckParam = params.get("deck");
    if (deckParam) {
      try {
        const decoded = decodeDeck(deckParam, allCards);
        const sanitized = sanitizeMainDeckMap(decoded, cardNoMap);
        if (sanitized.size > 0) {
          setDeckMap(sanitized);
          persistDeck(sanitized);
          const tokenParam = params.get("token");
          if (tokenParam) {
            const tokenDecoded = decodeDeck(tokenParam, allCards);
            setTokenDeckMap(tokenDecoded);
            persistTokenDeck(tokenDecoded);
          }
          setActiveTab("deck");
          // Clean URL
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch {
        /* ignore invalid */
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only URL load

  // ─── JSON import ───

  const handleJsonImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const lookup = new Map(
          allCards
            .filter((card) => card.orikaId != null)
            .map((card) => [card.orikaId!, card.cardNo])
        );
        const deck = await readDeckFile(file, lookup);
        const previousDeck = savedDecks.find(
          (saved) => saved.name === deck.name
        );
        const newDeck: SavedDeck = withDeckSaveTimes(
          {
            ...deck,
            cardNos: sanitizeMainDeckCardNos(deck.cardNos, cardNoMap),
          },
          previousDeck
        );
        if (
          savedDecks.some((saved) => saved.name === deck.name) &&
          !confirm("同名のデッキ「" + deck.name + "」を上書きしますか？")
        )
          return;
        if (
          userId &&
          !(await upsertCloudDeck(userId, newDeck, allCards, deckScope))
        )
          throw new Error("保存に失敗しました。再読み込みしてください");
        const next = previousDeck
          ? savedDecks.map((saved) =>
              saved.name === deck.name ? newDeck : saved
            )
          : [...savedDecks, newDeck];
        setSavedDecks(next);
        if (!userId) persistSavedDecks(next);
        alert("デッキ「" + deck.name + "」を保存デッキに追加しました");
      } catch (cause) {
        alert(
          cause instanceof Error
            ? cause.message
            : "ファイルの読み込みに失敗しました"
        );
      } finally {
        e.target.value = "";
      }
    },
    [allCards, cardNoMap, savedDecks, userId, deckScope]
  );

  // ─── Grid data (memoized) ───

  const getCount = useCallback(
    (cardNo: string) => deckMap.get(cardNo) ?? 0,
    [deckMap]
  );
  const getMax = useCallback(
    (card: CardDefinition) =>
      isTokenCard(card) ? 0 : getCardDefinitionMainDeckMaxCount(card),
    []
  );

  // 検索タブ用: トークンカードは maxTokenDeckCount でボタン表示し、トークンデッキ操作に分岐
  const searchGetCount = useCallback(
    (cardNo: string) => {
      const card = allCards.find((c) => c.cardNo === cardNo);
      if (card && isTokenCard(card)) return tokenDeckMap.get(cardNo) ?? 0;
      return deckMap.get(cardNo) ?? 0;
    },
    [allCards, deckMap, tokenDeckMap]
  );
  const searchGetMax = useCallback((card: CardDefinition) => {
    if (isTokenCard(card)) return card.maxTokenDeckCount ?? 9;
    return getCardDefinitionMainDeckMaxCount(card);
  }, []);
  const searchIncrease = useCallback(
    (cardNo: string) => {
      const card = allCards.find((c) => c.cardNo === cardNo);
      if (card && isTokenCard(card)) {
        increaseTokenCount(cardNo);
      } else {
        addCard(cardNo);
      }
    },
    [allCards, addCard, increaseTokenCount]
  );
  const searchDecrease = useCallback(
    (cardNo: string) => {
      const card = allCards.find((c) => c.cardNo === cardNo);
      if (card && isTokenCard(card)) {
        decreaseTokenCount(cardNo);
      } else {
        removeCard(cardNo);
      }
    },
    [allCards, removeCard, decreaseTokenCount]
  );

  const searchGridData = useMemo(
    (): GridCellData => ({
      cards: filteredCards,
      columns: gridColumns,
      getCount: searchGetCount,
      getMax: searchGetMax,
      onIncrease: searchIncrease,
      onDecrease: searchDecrease,
      onCardClick: setDetailCard,
    }),
    [
      filteredCards,
      gridColumns,
      searchGetCount,
      searchGetMax,
      searchIncrease,
      searchDecrease,
    ]
  );

  const deckGridData = useMemo(
    (): GridCellData => ({
      cards: deckEntries.map((e) => e.card),
      columns: gridColumns,
      getCount,
      getMax,
      onIncrease: addCard,
      onDecrease: removeCard,
      onCardClick: setDetailCard,
    }),
    [deckEntries, gridColumns, getCount, getMax, addCard, removeCard]
  );

  const tokenGridData = useMemo(
    (): GridCellData => ({
      cards: tokenCardsInDeck.map((e) => e.card),
      columns: gridColumns,
      getCount: getTokenCount,
      getMax: (card) => card.maxTokenDeckCount ?? 9,
      onIncrease: increaseTokenCount,
      onDecrease: decreaseTokenCount,
      onCardClick: setDetailCard,
      isTokenBadge: true,
    }),
    [
      tokenCardsInDeck,
      gridColumns,
      getTokenCount,
      increaseTokenCount,
      decreaseTokenCount,
    ]
  );

  const searchListData = useMemo(
    (): SearchListData => ({
      cards: filteredCards,
      getCount: searchGetCount,
      onIncrease: searchIncrease,
      onDecrease: searchDecrease,
      onCardClick: setDetailCard,
    }),
    [filteredCards, searchGetCount, searchIncrease, searchDecrease]
  );

  const deckListData = useMemo(
    (): DeckListData => ({
      mainCards: deckEntries,
      tokenCards: tokenCardsInDeck,
      tokenTotal,
      onIncrease: addCard,
      onDecrease: removeCard,
      onTokenIncrease: increaseTokenCount,
      onTokenDecrease: decreaseTokenCount,
      onCardClick: setDetailCard,
    }),
    [
      deckEntries,
      tokenCardsInDeck,
      tokenTotal,
      addCard,
      removeCard,
      increaseTokenCount,
      decreaseTokenCount,
    ]
  );

  // ─── Render ───

  const hasAnyCards = totalCards > 0 || tokenTotal > 0;
  const deckListTotalCount =
    deckEntries.length +
    (tokenCardsInDeck.length > 0 ? 1 + tokenCardsInDeck.length : 0);

  const deckFooter = (
    <div className="db-deck-bottom db-workspace-footer">
      <div className="db-input-row">
        <input
          type="text"
          placeholder="デッキ名"
          value={deckName}
          onChange={(e) =>
            setDeckName(limitInputText(e.target.value, INPUT_LIMITS.deckName))
          }
          aria-label="デッキ名"
          title={"デッキ名（" + INPUT_LIMITS.deckName + "文字以内）"}
          className="db-deck-name-input"
        />
      </div>
      <div className="db-input-row" style={{ gap: "0.5em" }}>
        <button className="db-btn-save" onClick={() => void saveCurrentDeck()}>
          {isLandscape ? "保存" : "デッキ保存"}
        </button>
        <button
          className="db-btn-share"
          onClick={() => {
            const url = getShareUrl();
            window.prompt("このURLをコピーして共有できます", url);
          }}
          disabled={!hasAnyCards}
        >
          {isLandscape ? "共有" : "デッキ共有URL"}
        </button>
      </div>
      <button className="db-btn-clear" onClick={clearDeck}>
        クリア
      </button>
      {message && <div className="db-message">{message}</div>}
    </div>
  );

  return (
    <div className="db-root">
      {/* Tab bar */}
      <div className="db-tab-bar">
        <button
          className={`db-tab-btn db-tab-home${activeTab === "home" ? " active" : ""}`}
          aria-label="ホーム"
          onClick={() => setActiveTab("home")}
        >
          🏠
        </button>
        <button
          className={`db-tab-btn${activeTab === "search" ? " active" : ""}`}
          onClick={() => setActiveTab("search")}
        >
          カード検索
        </button>
        <button
          className={`db-tab-btn${activeTab === "deck" ? " active" : ""}`}
          onClick={() => setActiveTab("deck")}
        >
          作成中デッキ
        </button>
        <button
          className={`db-tab-btn${activeTab === "saved" ? " active" : ""}`}
          onClick={() => setActiveTab("saved")}
        >
          保存デッキ
        </button>
        <button
          className={"db-tab-btn" + (activeTab === "qa" ? " active" : "")}
          onClick={() => setActiveTab("qa")}
        >
          QA
        </button>
      </div>

      {/* ====== ホーム tab (起動画面からの集約画面) ====== */}
      <div
        ref={homeContainerRef}
        className="db-tab-content db-home-tab"
        style={{ display: activeTab === "home" ? "flex" : "none" }}
      >
        <HomeLobby
          canAutoUpdate={
            deckMap.size === 0 && tokenDeckMap.size === 0 && !deckName
          }
          displayName={profile?.display_name || user?.email || "プレイヤー"}
          avatarId={profile?.avatar_id}
          cardCount={allCards.length}
          savedDeckCount={savedDecks.length}
          onNavigate={(destination) => onNavigate?.(destination)}
          onDeckTab={() => setActiveTab("deck")}
          onSavedTab={() => setActiveTab("saved")}
        >
          {(onLoadSnapshot || onLoadReplay) && (
            <details className="db-home-dev">
              <summary>棋譜・盤面の読み込み</summary>
              <div className="db-home-dev-body">
                {onLoadSnapshot && (
                  <>
                    <button
                      type="button"
                      className="db-home-dev-btn"
                      data-testid="btn-import-snapshot"
                      onClick={() => snapshotFileInputRef.current?.click()}
                      title="スナップショット JSON を読み込んで盤面を復元"
                    >
                      スナップショット読み込み
                    </button>
                    <input
                      ref={snapshotFileInputRef}
                      type="file"
                      accept="application/json,.json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onLoadSnapshot(file);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
                {onLoadReplay && (
                  <>
                    <button
                      type="button"
                      className="db-home-dev-btn"
                      data-testid="btn-import-replay"
                      onClick={() => replayFileInputRef.current?.click()}
                      title="保存した棋譜を読み込んで対戦を再生"
                    >
                      棋譜読み込み
                    </button>
                    <input
                      ref={replayFileInputRef}
                      data-testid="input-import-replay"
                      type="file"
                      accept="application/json,application/x-ndjson,application/gzip,.json,.jsonl,.gz"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onLoadReplay(file);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
                {snapshotError && (
                  <p className="db-home-dev-error" data-testid="snapshot-error">
                    {snapshotError}
                  </p>
                )}
                {replayError && (
                  <p className="db-home-dev-error" data-testid="replay-error">
                    {replayError}
                  </p>
                )}
              </div>
            </details>
          )}
        </HomeLobby>
      </div>

      {/* ====== カード検索 tab ====== */}
      <div
        ref={searchContainerRef}
        className="db-tab-content db-workspace"
        style={{ display: activeTab === "search" ? undefined : "none" }}
      >
        <div className="db-workspace-controls">
          <div className="db-input-row">
            <input
              type="text"
              placeholder="カード名、色、効果、作品名で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="db-filter-input"
            />
            <button className="db-search-btn" onClick={() => {}}>
              検索
            </button>
          </div>

          <div className="db-result-header">
            <span className="db-results-label">検索結果</span>
            <span className="db-filter-count">{filteredCards.length} 件</span>
          </div>

          <div className="db-filter-toggle-row">
            <button
              className="db-filter-toggle"
              onClick={() => setShowFilter((f) => !f)}
            >
              {showFilter
                ? isLandscape
                  ? "閉じる"
                  : "フィルターを閉じる"
                : isLandscape
                  ? "フィルター"
                  : "フィルターを開く"}
            </button>
            <button className="db-filter-reset" onClick={resetFilters}>
              {isLandscape ? "リセット" : "条件リセット"}
            </button>
          </div>

          {showFilter && (
            <div className="db-filter-panel">
              <div className="db-filter-field">
                <label>色</label>
                <select
                  value={filterColor}
                  onChange={(e) => setFilterColor(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  <option value="赤">赤</option>
                  <option value="紫">紫</option>
                  <option value="緑">緑</option>
                  <option value="白">白</option>
                  <option value="黄">黄</option>
                  <option value="青">青</option>
                  <option value="黒">黒</option>
                  <option value="多色">多色</option>
                </select>
              </div>
              <div className="db-filter-field">
                <label>カード種類</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  <option value="スピリット">スピリット</option>
                  <option value="アルティメット">アルティメット</option>
                  <option value="ブレイヴ">ブレイヴ</option>
                  <option value="ネクサス">ネクサス</option>
                  <option value="マジック">マジック</option>
                  <option value="契約スピリット">契約スピリット</option>
                  <option value="契約ブレイヴ">契約ブレイヴ</option>
                  <option value="契約ネクサス">契約ネクサス</option>
                  <option value="トークン">トークン</option>
                </select>
              </div>
              <div className="db-filter-field">
                <label>レアリティ</label>
                <select
                  value={filterRarity}
                  onChange={(e) => setFilterRarity(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  <option value="C">C</option>
                  <option value="R">R</option>
                  <option value="M">M</option>
                  <option value="X">X</option>
                  <option value="XX">XX</option>
                  <option value="TR">TR</option>
                  <option value="TX">TX</option>
                  <option value="CX">CX</option>
                  <option value="T">T</option>
                </select>
              </div>
              <div className="db-filter-field">
                <label>系統</label>
                <div ref={tribeDropdownRef} style={{ position: "relative" }}>
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns: "2fr 1fr",
                    }}
                  >
                    <input
                      type="text"
                      value={filterTribe}
                      onChange={(e) => setFilterTribe(e.target.value)}
                      onFocus={() => setTribeDropdownOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setTribeDropdownOpen(false);
                        if (
                          e.key === "Enter" &&
                          tribeDropdownOpen &&
                          filteredTribeOptions.length > 0
                        ) {
                          setFilterTribe(filteredTribeOptions[0]!);
                          setTribeDropdownOpen(false);
                        }
                      }}
                      placeholder="例: 幻想"
                      className="db-filter-input-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTribeDropdownOpen((v) => !v);
                        if (!tribeDropdownOpen) setFilterTribe("");
                      }}
                      style={{ minWidth: 0 }}
                    >
                      ▼
                    </button>
                  </div>
                  {tribeDropdownOpen && filteredTribeOptions.length > 0 && (
                    <div className="db-tribe-dropdown">
                      {filteredTribeOptions.slice(0, 50).map((t) => (
                        <div
                          key={t}
                          className="db-tribe-option"
                          onClick={() => {
                            setFilterTribe(t);
                            setTribeDropdownOpen(false);
                          }}
                        >
                          {t}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="db-filter-field">
                <label>収録パック</label>
                <select
                  value={filterPack}
                  onChange={(e) => setFilterPack(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  {PACK_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="db-filter-field">
                <label>コスト</label>
                <select
                  value={filterCost}
                  onChange={(e) => setFilterCost(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  {Array.from({ length: 14 }, (_, i) => (
                    <option key={i} value={String(i)}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div className="db-filter-field">
                <label>軽減シンボル</label>
                <select
                  value={filterReduction}
                  onChange={(e) => setFilterReduction(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  <option value="赤">赤</option>
                  <option value="紫">紫</option>
                  <option value="緑">緑</option>
                  <option value="白">白</option>
                  <option value="黄">黄</option>
                  <option value="青">青</option>
                  <option value="黒">黒</option>
                  <option value="神">神</option>
                  <option value="導">導</option>
                  <option value="極">極</option>
                </select>
              </div>
              <div className="db-filter-field">
                <label>シンボル</label>
                <select
                  value={filterSymbol}
                  onChange={(e) => setFilterSymbol(e.target.value)}
                >
                  <option value="">(指定なし)</option>
                  <option value="赤">赤</option>
                  <option value="紫">紫</option>
                  <option value="緑">緑</option>
                  <option value="白">白</option>
                  <option value="黄">黄</option>
                  <option value="青">青</option>
                  <option value="黒">黒</option>
                  <option value="神">神</option>
                  <option value="導">導</option>
                  <option value="極">極</option>
                </select>
              </div>
            </div>
          )}

          <div className="db-view-toggle-row">
            <button
              className={`db-view-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              ≡
            </button>
            <button
              className={`db-view-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              ■
            </button>
          </div>
        </div>
        <div className="db-workspace-cards" ref={searchCardsRef}>
          {viewMode === "list" ? (
            <div
              className="db-virtual-list-wrap"
              style={{ width: safeWidth, touchAction: "pan-y" }}
            >
              <FixedSizeList
                height={safeHeight}
                itemCount={filteredCards.length}
                itemSize={80}
                width={safeWidth}
                itemData={searchListData}
                overscanCount={3}
              >
                {SearchListRow}
              </FixedSizeList>
            </div>
          ) : (
            <div
              className="db-virtual-grid-wrap"
              style={{ width: safeWidth, touchAction: "pan-y" }}
            >
              <FixedSizeGrid
                height={Math.min(
                  Math.ceil(filteredCards.length / gridColumns) * gridRowHeight,
                  safeHeight
                )}
                columnCount={gridColumns}
                columnWidth={gridColWidth}
                rowCount={Math.ceil(filteredCards.length / gridColumns)}
                rowHeight={gridRowHeight}
                width={safeWidth}
                itemData={searchGridData}
              >
                {CardGridCell}
              </FixedSizeGrid>
            </div>
          )}
        </div>
      </div>

      {/* ====== 作成中デッキ tab ====== */}
      <div
        ref={deckContainerRef}
        className="db-tab-content db-workspace db-workspace-deck"
        style={{ display: activeTab === "deck" ? undefined : "none" }}
      >
        <div className="db-workspace-controls">
          <h2 style={{ margin: "0.5em 0" }}>作成中デッキ</h2>
          {hasAnyCards && (
            <div className="db-deck-header">
              {thumbnailCard && (
                <div className="db-deck-thumb-wrap">
                  {thumbnailCard.image ? (
                    <img
                      src={`/${thumbnailCard.image}`}
                      alt="サムネイル"
                      className="db-deck-thumb-img"
                    />
                  ) : (
                    <div className="db-deck-thumb-placeholder" />
                  )}
                </div>
              )}
              <span className="db-deck-count">
                メインデッキ: {totalCards}枚
              </span>
              {tokenTotal > 0 && (
                <span className="db-deck-token-count">
                  トークンデッキ: {tokenTotal}枚
                </span>
              )}
              <div className="db-view-toggle-row" style={{ margin: 0 }}>
                <button
                  className={`db-view-btn${viewMode === "list" ? " active" : ""}`}
                  onClick={() => setViewMode("list")}
                >
                  ≡
                </button>
                <button
                  className={`db-view-btn${viewMode === "grid" ? " active" : ""}`}
                  onClick={() => setViewMode("grid")}
                >
                  ■
                </button>
              </div>
            </div>
          )}
          {isLandscape && deckFooter}
        </div>
        <div className="db-workspace-cards" ref={deckCardsRef}>
          {!hasAnyCards && <div className="db-empty">デッキが空です。</div>}

          {viewMode === "list" && hasAnyCards && (
            <div
              className="db-virtual-list-wrap"
              style={{ width: safeWidth, touchAction: "pan-y" }}
            >
              <FixedSizeList
                height={Math.min(deckListTotalCount * 80, safeHeight)}
                itemCount={deckListTotalCount}
                itemSize={80}
                width={safeWidth}
                itemData={deckListData}
              >
                {DeckListRow}
              </FixedSizeList>
            </div>
          )}

          {viewMode === "grid" && hasAnyCards && (
            <>
              {deckEntries.length > 0 && (
                <div
                  className="db-virtual-grid-wrap"
                  style={{ width: safeWidth, touchAction: "pan-y" }}
                >
                  <FixedSizeGrid
                    height={Math.min(
                      Math.ceil(deckEntries.length / gridColumns) *
                        gridRowHeight,
                      safeHeight
                    )}
                    columnCount={gridColumns}
                    columnWidth={gridColWidth}
                    rowCount={Math.ceil(deckEntries.length / gridColumns)}
                    rowHeight={gridRowHeight}
                    width={safeWidth}
                    itemData={deckGridData}
                  >
                    {CardGridCell}
                  </FixedSizeGrid>
                </div>
              )}
              {tokenCardsInDeck.length > 0 && (
                <div style={{ marginTop: "0.8em" }}>
                  <h3
                    className="db-token-heading"
                    style={{
                      fontSize: "1.05em",
                      margin: "0.2em 0 0.5em 0",
                    }}
                  >
                    トークンデッキ: {tokenTotal}枚
                  </h3>
                  <div
                    className="db-virtual-grid-wrap"
                    style={{ width: safeWidth, touchAction: "pan-y" }}
                  >
                    <FixedSizeGrid
                      height={Math.min(
                        Math.ceil(tokenCardsInDeck.length / gridColumns) *
                          gridRowHeight,
                        safeHeight
                      )}
                      columnCount={gridColumns}
                      columnWidth={gridColWidth}
                      rowCount={Math.ceil(
                        tokenCardsInDeck.length / gridColumns
                      )}
                      rowHeight={gridRowHeight}
                      width={safeWidth}
                      itemData={tokenGridData}
                    >
                      {CardGridCell}
                    </FixedSizeGrid>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {!isLandscape && deckFooter}
      </div>

      {/* ====== 保存デッキ tab ====== */}
      <div
        ref={savedContainerRef}
        className="db-tab-content db-workspace db-saved-workspace"
        style={{ display: activeTab === "saved" ? undefined : "none" }}
      >
        <SavedDeckBrowser
          decks={savedDecks}
          allCards={allCards}
          getKey={(deck) => deck.name}
          onPreview={setViewDeck}
          header={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.7em",
                flexWrap: "wrap",
                marginBottom: "0.7em",
              }}
            >
              <h2 style={{ margin: 0 }}>保存デッキ</h2>
              <button
                type="button"
                onClick={() => setShowDeckInfoModal(true)}
                style={{
                  marginLeft: "auto",
                  background: "var(--lobby-surface, #455a64)",
                  color: "#fff",
                  border: "1px solid var(--lobby-border, #455a64)",
                  borderRadius: 6,
                  padding: "0.4em 0.7em",
                  fontSize: "0.9em",
                  whiteSpace: "nowrap",
                  margin: "0.2em 0 0.2em auto",
                  transition: "background 0.15s, color 0.15s",
                  cursor: "pointer",
                }}
              >
                {isLandscape ? "総デッキ情報" : "あなたのデッキ情報"}
              </button>
            </div>
          }
          toolbar={
            <label
              className="db-import-label"
              style={{
                background: "var(--lobby-primary, #e94560)",
                color: "#fff",
                borderRadius: 6,
                padding: "0.4em 1em",
                cursor: "pointer",
                fontSize: "1em",
              }}
            >
              デッキ読込
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={handleJsonImport}
              />
            </label>
          }
          notice={
            <>
              {message && <div className="db-message">{message}</div>}
              {(cloudError || !decksShared) && (
                <div
                  role="status"
                  className={
                    cloudError ? "db-library-error" : "db-library-status"
                  }
                >
                  {cloudError ||
                    (userId ? "このアカウントのデッキ" : "この端末のデッキ")}
                </div>
              )}
            </>
          }
          renderActions={(deck) => (
            <>
              <button
                className="ui-primary"
                style={{
                  background: "var(--lobby-primary, #e94560)",
                  color: "#fff",
                  border: "1px solid var(--lobby-border, #e94560)",
                  borderRadius: 6,
                  padding: "0.5em 1em",
                  fontSize: "1em",
                  margin: "0.2em 0",
                  transition: "background 0.15s, color 0.15s",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  loadSavedDeckData(deck);
                }}
              >
                編集
              </button>
              <button
                className="ui-danger"
                style={{
                  background: "#d32f2f",
                  color: "#fff",
                  border: "1px solid #d32f2f",
                  borderRadius: 6,
                  padding: "0.5em 1em",
                  fontSize: "1em",
                  margin: "0.2em 0",
                  transition: "background 0.15s, color 0.15s",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteDeck(deck.name);
                }}
              >
                削除
              </button>
            </>
          )}
        />
      </div>

      <div
        ref={qaContainerRef}
        className="db-tab-content db-workspace db-qa-workspace"
        style={{ display: activeTab === "qa" ? undefined : "none" }}
      >
        <QaTab />
      </div>

      {showDeckInfoModal && (
        <div
          className="db-info-overlay"
          onClick={() => setShowDeckInfoModal(false)}
        >
          <div className="db-info-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="閉じる"
              className="db-info-close"
              onClick={() => setShowDeckInfoModal(false)}
            >
              ×
            </button>
            <h2>{isLandscape ? "総デッキ情報" : "あなたのデッキ情報"}</h2>

            <div className="db-info-stats">
              <div className="db-info-stat">
                <div className="db-info-stat-label">総デッキ数</div>
                <div className="db-info-stat-value blue">
                  {deckInfo.totalDecks}
                </div>
              </div>
              <div className="db-info-stat">
                <div className="db-info-stat-label">
                  デザイナーズアーキタイプ網羅数
                </div>
                <div className="db-info-stat-value green">
                  {deckInfo.coveredArchetypes.length}
                  <span> / {deckInfo.totalArchetypes}</span>
                </div>
              </div>
            </div>

            <div>
              <h3>作っていないアーキタイプ一覧</h3>
              {deckInfo.missingArchetypes.length === 0 ? (
                <div className="db-info-complete">すべて作成済み</div>
              ) : (
                <div className="db-info-chip-list">
                  {deckInfo.missingArchetypes.map((archetype) => (
                    <span
                      key={archetype.key}
                      className="db-info-chip"
                      title={`${archetype.packTitle || archetype.name} (${archetype.cardTypeCount}種)`}
                    >
                      {archetype.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Card detail modal */}
      <CardDetailModal
        card={detailCard}
        show={!!detailCard}
        onClose={() => setDetailCard(null)}
        inDeck={detailCard ? (deckMap.get(detailCard.cardNo) ?? 0) > 0 : false}
        countInDeck={detailCard ? (deckMap.get(detailCard.cardNo) ?? 0) : 0}
        onIncrease={addCard}
        onDecrease={removeCard}
        getTokenCount={getTokenCount}
        onTokenIncrease={increaseTokenCount}
        onTokenDecrease={decreaseTokenCount}
        onSetDeckThumbnail={(cardNo) => {
          setDeckThumbnailCardNo(cardNo);
          persistThumbnail(cardNo);
        }}
        allCards={allCards}
      />

      {/* Deck view modal */}
      {viewDeck && (
        <DeckViewModal
          deckName={viewDeck.name}
          cardNos={viewDeck.cardNos}
          {...(viewDeck.tokenDeck != null
            ? { tokenDeck: viewDeck.tokenDeck }
            : {})}
          {...(viewDeck.thumbnailCardNo != null
            ? { thumbnailCardNo: viewDeck.thumbnailCardNo }
            : {})}
          allCards={allCards}
          onClose={() => setViewDeck(null)}
        />
      )}
    </div>
  );
}
