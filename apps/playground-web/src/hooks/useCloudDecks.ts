import { useMemo } from "react";
import {
  isCardDefinitionMainDeckAllowed,
  sanitizeMainDeckDefinitions,
  type CardDefinition,
} from "@orica/rules-core";
import { useDeckLibrary, mutateDeckLibrary } from "./useDeckLibrary";
import {
  parseIdCounts,
  parseStoredDeck,
  validateDeckName,
} from "../input-validation";

const APP_GAME_ID = "bs";

/** Supabase に保存されているデッキのカードエントリ（orika-react 形式: {id: number, count: number}） */
interface CloudCardEntry {
  id: number;
  count: number;
  isDeckThumbnail?: boolean;
}

interface CloudTokenEntry {
  id: number;
  count: number;
}

interface CloudDeckRow {
  created_at?: string;
  updated_at?: string;
  id: string;
  name: string;
  cards: CloudCardEntry[];
  thumbnail_card_id: number | null;
  token_deck: CloudTokenEntry[] | null;
}

export interface EditableCloudDeck {
  name: string;
  cardNos: string[];
  tokenDeck?: Array<{ cardNo: string; count: number }>;
  thumbnailCardNo?: string;
}

export interface CloudDeck {
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  id: string;
  name: string;
  /** cardNo の配列（count 分展開済み） */
  cardNos: string[];
  totalCards: number;
  /** サムネイルカードの cardNo */
  thumbnailCardNo: string | null;
  /** トークンデッキ */
  tokenDeck: Array<{ cardNo: string; count: number }>;
}

function cardIdMaps(allCards: readonly CardDefinition[]) {
  const idToCard = new Map<number, CardDefinition>();
  const cardNoToId = new Map<string, number>();
  for (const card of allCards) {
    if (card.orikaId == null) continue;
    idToCard.set(card.orikaId, card);
    cardNoToId.set(card.cardNo, card.orikaId);
  }
  return { idToCard, cardNoToId };
}

export function normalizeCloudRows(data: unknown) {
  let invalid = false;
  const rows = (Array.isArray(data) ? data : [])
    .map((row): CloudDeckRow | null => {
      if (!row || typeof row !== "object") {
        invalid = true;
        return null;
      }
      const r = row as {
        created_at?: unknown;
        updated_at?: unknown;
        id?: unknown;
        name?: unknown;
        cards?: unknown;
        thumbnail_card_id?: unknown;
        token_deck?: unknown;
      };
      if (typeof r.id !== "string" || typeof r.name !== "string") {
        invalid = true;
        return null;
      }
      const thumbnailCardId =
        r.thumbnail_card_id == null ? null : Number(r.thumbnail_card_id);
      try {
        validateDeckName(r.name);
        return {
          id: r.id,
          ...(typeof r.created_at === "string"
            ? { created_at: r.created_at }
            : {}),
          ...(typeof r.updated_at === "string"
            ? { updated_at: r.updated_at }
            : {}),
          name: r.name,
          cards: parseIdCounts(r.cards),
          thumbnail_card_id:
            thumbnailCardId != null && Number.isFinite(thumbnailCardId)
              ? thumbnailCardId
              : null,
          token_deck: parseIdCounts(r.token_deck ?? []),
        };
      } catch {
        invalid = true;
        return null;
      }
    })
    .filter((row): row is CloudDeckRow => row !== null);
  return {
    rows,
    error: invalid ? "形式または上限が不正なデッキを読み込めませんでした" : "",
  };
}

function toEditableDeck(
  raw: CloudDeckRow,
  idToCard: ReadonlyMap<number, CardDefinition>
): EditableCloudDeck {
  const expandedCards: CardDefinition[] = [];
  for (const entry of raw.cards) {
    const card = idToCard.get(entry.id);
    if (!card) continue;
    for (let i = 0; i < (entry.count ?? 1); i++) {
      expandedCards.push(card);
    }
  }
  const cardNos = sanitizeMainDeckDefinitions(expandedCards).map(
    (card) => card.cardNo
  );

  let thumbnailCardNo: string | null = null;
  if (raw.thumbnail_card_id != null) {
    const thumbnailCard = idToCard.get(raw.thumbnail_card_id);
    thumbnailCardNo =
      thumbnailCard && isCardDefinitionMainDeckAllowed(thumbnailCard)
        ? thumbnailCard.cardNo
        : null;
  }
  if (!thumbnailCardNo) {
    const thumbEntry = raw.cards.find((c) => c.isDeckThumbnail);
    const thumbnailCard = thumbEntry ? idToCard.get(thumbEntry.id) : null;
    if (thumbnailCard && isCardDefinitionMainDeckAllowed(thumbnailCard)) {
      thumbnailCardNo = thumbnailCard.cardNo;
    }
  }
  if (!thumbnailCardNo && cardNos.length > 0) {
    thumbnailCardNo = cardNos[0]!;
  }

  const tokenDeck: Array<{ cardNo: string; count: number }> = [];
  for (const token of raw.token_deck ?? []) {
    const card = idToCard.get(token.id);
    if (card) tokenDeck.push({ cardNo: card.cardNo, count: token.count });
  }

  return {
    name: raw.name,
    cardNos,
    ...(tokenDeck.length > 0 ? { tokenDeck } : {}),
    ...(thumbnailCardNo != null ? { thumbnailCardNo } : {}),
  };
}

function toCloudRow(
  userId: string,
  deck: EditableCloudDeck,
  allCards: readonly CardDefinition[]
) {
  const { cardNoToId } = cardIdMaps(allCards);
  const counts = new Map<
    number,
    { count: number; isDeckThumbnail?: boolean }
  >();
  for (const cardNo of deck.cardNos) {
    const id = cardNoToId.get(cardNo);
    if (id == null) continue;
    const current = counts.get(id);
    counts.set(id, {
      count: (current?.count ?? 0) + 1,
      ...(current?.isDeckThumbnail ? { isDeckThumbnail: true } : {}),
    });
  }

  const thumbnailId =
    (deck.thumbnailCardNo ? cardNoToId.get(deck.thumbnailCardNo) : undefined) ??
    (deck.cardNos.length > 0 ? cardNoToId.get(deck.cardNos[0]!) : undefined) ??
    (deck.tokenDeck && deck.tokenDeck.length > 0
      ? cardNoToId.get(deck.tokenDeck[0]!.cardNo)
      : undefined) ??
    null;

  const cards = [...counts.entries()].map(([id, entry]) => ({
    id,
    count: entry.count,
    ...(thumbnailId === id ? { isDeckThumbnail: true } : {}),
  }));

  const token_deck = (deck.tokenDeck ?? [])
    .map((entry) => {
      const id = cardNoToId.get(entry.cardNo);
      const count = Number(entry.count) || 0;
      return id != null && count > 0 ? { id, count } : null;
    })
    .filter((entry): entry is CloudTokenEntry => entry !== null);

  return {
    user_id: userId,
    game: APP_GAME_ID,
    name: deck.name,
    cards,
    token_deck,
    thumbnail_card_id: thumbnailId,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertCloudDeck(
  userId: string | null | undefined,
  deck: EditableCloudDeck,
  allCards: readonly CardDefinition[],
  scope: string | null
): Promise<boolean> {
  if (!userId) return false;
  try {
    await mutateDeckLibrary(
      "save",
      scope,
      toCloudRow(userId, parseStoredDeck(deck), allCards)
    );
    return true;
  } catch (error) {
    console.error("デッキ保存エラー:", error);
    return false;
  }
}
export async function deleteCloudDeck(
  userId: string | null | undefined,
  deckName: string,
  scope: string | null
): Promise<boolean> {
  if (!userId) return false;
  try {
    await mutateDeckLibrary("delete", scope, { name: deckName });
    return true;
  } catch (error) {
    console.error("デッキ削除エラー:", error);
    return false;
  }
}

/**
 * Supabase からログインユーザーのデッキ一覧を取得するフック。
 * orika-react の {id, count} 形式を cardNo[] に展開する。
 * allCards の orikaId フィールドで変換。
 */
export function useCloudDecks(
  userId: string | undefined,
  allCards?: readonly CardDefinition[]
) {
  const { library, loading, error, reload } = useDeckLibrary(userId);
  const normalized = useMemo(
    () => normalizeCloudRows(library?.decks),
    [library]
  );
  const rawDecks = normalized.rows;

  // orikaId → CardDefinition マッピング
  const idToCard = useMemo(() => {
    const map = new Map<number, CardDefinition>();
    if (allCards) {
      for (const card of allCards) {
        if (card.orikaId != null) map.set(card.orikaId, card);
      }
    }
    return map;
  }, [allCards]);

  const decks: CloudDeck[] = useMemo(() => {
    // 同名のクラウドデッキを dedupe (created_at ascending なので後勝ち = 最新を採用)
    const dedupedByName = new Map<string, (typeof rawDecks)[number]>();
    const duplicateNames: string[] = [];
    for (const raw of rawDecks) {
      if (dedupedByName.has(raw.name)) duplicateNames.push(raw.name);
      dedupedByName.set(raw.name, raw);
    }
    if (duplicateNames.length > 0) {
      console.warn(
        "[useCloudDecks] 同名のクラウドデッキが複数検出されました。最新のみ表示します:",
        Array.from(new Set(duplicateNames))
      );
    }

    return Array.from(dedupedByName.values()).map((raw) => {
      const deck = toEditableDeck(raw, idToCard);

      return {
        id: raw.id,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
        name: deck.name,
        cardNos: deck.cardNos,
        totalCards: deck.cardNos.length,
        thumbnailCardNo: deck.thumbnailCardNo ?? null,
        tokenDeck: deck.tokenDeck ?? [],
      };
    });
  }, [rawDecks, idToCard]);

  return {
    decks,
    loading,
    error: error || normalized.error,
    reload,
    scope: library?.scope_key ?? null,
    shared: library?.shared ?? false,
  };
}
