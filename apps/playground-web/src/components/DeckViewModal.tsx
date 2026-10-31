import { cardCategoryLabel } from "@orica/rules-core";
/**
 * DeckViewModal — デッキ内容の閲覧モーダル（list / grid）。
 *
 * クリック対話パターンの統一方針対象外:
 *   バトル中モーダルでは「クリック=アクション、長押し/右クリック=詳細」で統一しているが、
 *   このモーダルはプライマリアクションが「カード詳細を見る」しかないため、クリック=詳細を維持する。
 *   デッキ枚数の +/- は inline ボタンで操作する別パスに分離されている。
 */
import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import type { CardDefinition } from "@orica/rules-core";
import { CardDetailModal } from "./CardDetailModal";

function getCategoryLabel(card: CardDefinition): string {
  const base = cardCategoryLabel(card.printedCategory);
  if (card.keywordTags.includes("contract")) return `契約${base}`;
  if (card.keywordTags.includes("token")) return `トークン${base}`;
  return base;
}

function getTypeRank(card: CardDefinition): number {
  const tags = card.keywordTags;
  const cat = card.printedCategory;
  if (tags.includes("contract")) return 0;
  if (cat === "spirit") return 1;
  if (cat === "ultimate") return 2;
  if (cat === "brave") return 3;
  if (cat === "nexus") return 6;
  if (cat === "magic") return 7;
  return 99;
}

interface DeckEntry {
  card: CardDefinition;
  count: number;
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

interface DeckViewModalProps {
  deckName: string;
  cardNos: string[];
  tokenDeck?: Array<{ cardNo: string; count: number }>;
  thumbnailCardNo?: string;
  allCards: CardDefinition[];
  onClose: () => void;
  action?: ReactNode;
}

export function DeckViewModal({
  deckName,
  cardNos,
  tokenDeck,
  thumbnailCardNo,
  allCards,
  onClose,
  action,
}: DeckViewModalProps) {
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");
  const [detailCard, setDetailCard] = useState<CardDefinition | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const cardNoMap = useMemo(
    () => new Map(allCards.map((c) => [c.cardNo, c])),
    [allCards]
  );

  // Build deck entries from cardNos
  const mainEntries = useMemo((): DeckEntry[] => {
    const counts = new Map<string, number>();
    for (const no of cardNos) counts.set(no, (counts.get(no) ?? 0) + 1);
    const entries: DeckEntry[] = [];
    for (const [cardNo, count] of counts) {
      const card = cardNoMap.get(cardNo);
      if (card) entries.push({ card, count });
    }
    return sortDeckEntries(entries);
  }, [cardNos, cardNoMap]);

  // Token entries
  const tokenEntries = useMemo((): Array<{
    card: CardDefinition;
    count: number;
    max: number;
  }> => {
    if (!tokenDeck) return [];
    return tokenDeck
      .filter((t) => t.count > 0)
      .map((t) => {
        const card = cardNoMap.get(t.cardNo);
        return card
          ? { card, count: t.count, max: card.maxTokenDeckCount ?? 9 }
          : null;
      })
      .filter(
        (t): t is { card: CardDefinition; count: number; max: number } =>
          t !== null
      );
  }, [tokenDeck, cardNoMap]);

  const totalMain = mainEntries.reduce((s, e) => s + e.count, 0);
  const totalToken = tokenEntries.reduce((s, e) => s + e.count, 0);

  // Thumbnail
  const thumbCard = useMemo(() => {
    if (thumbnailCardNo) {
      const c = cardNoMap.get(thumbnailCardNo);
      if (c) return c;
    }
    return mainEntries[0]?.card ?? null;
  }, [thumbnailCardNo, mainEntries, cardNoMap]);

  const thumbImg = thumbCard?.image ? `/${thumbCard.image}` : null;

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (detailCard) setDetailCard(null);
          else onClose();
        }
      }}
    >
      <div className="dvm-overlay" onClick={onClose}>
        <div
          className="dvm-content"
          role="dialog"
          aria-label={deckName}
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            ref={closeButton}
            className="dvm-close"
            aria-label="デッキ詳細を閉じる"
            onClick={onClose}
          >
            ×
          </button>
          <div className="dvm-sidebar">
            <h2 className="dvm-title">{deckName}</h2>

            {/* Header */}
            <div className="dvm-header">
              {thumbImg && (
                <img src={thumbImg} alt="サムネイル" className="dvm-thumb" />
              )}
              <span className="dvm-main-count">
                メインデッキ: {totalMain}枚
              </span>
              <div className="dvm-view-toggle">
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
            {action}
          </div>
          <div className="dvm-cards">
            {/* List view */}
            {viewMode === "list" ? (
              <div className="dvm-list-area">
                {mainEntries.map(({ card, count }) => {
                  const imgSrc = card.image ? `/${card.image}` : null;
                  return (
                    <div
                      key={card.cardNo}
                      className="dvm-list-row"
                      onClick={() => setDetailCard(card)}
                    >
                      {imgSrc && (
                        <img
                          src={imgSrc}
                          alt={card.name}
                          className="dvm-list-img"
                        />
                      )}
                      <span className="dvm-list-name">
                        <b>{card.name}</b>{" "}
                        <span className="dvm-list-type">
                          ({getCategoryLabel(card)})
                        </span>
                      </span>
                      <span className="dvm-list-count">{count}枚</span>
                    </div>
                  );
                })}

                {tokenEntries.length > 0 && (
                  <div style={{ marginTop: "0.8em" }}>
                    <div className="dvm-token-header">
                      トークンデッキ: {totalToken}枚
                    </div>
                    {tokenEntries.map(({ card, count, max }) => {
                      const imgSrc = card.image ? `/${card.image}` : null;
                      return (
                        <div
                          key={card.cardNo}
                          className="dvm-list-row"
                          onClick={() => setDetailCard(card)}
                        >
                          {imgSrc && (
                            <img
                              src={imgSrc}
                              alt={card.name}
                              className="dvm-list-img"
                            />
                          )}
                          <span className="dvm-list-name">
                            <b>{card.name}</b>{" "}
                            <span className="dvm-list-type">
                              ({getCategoryLabel(card)})
                            </span>
                          </span>
                          <span className="dvm-list-count-token">
                            {count} / {max}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Grid view */
              <>
                <div className="dvm-grid">
                  {mainEntries.map(({ card, count }) => {
                    const imgSrc = card.image ? `/${card.image}` : null;
                    return (
                      <div
                        key={card.cardNo}
                        className="dvm-grid-cell"
                        onClick={() => setDetailCard(card)}
                      >
                        {imgSrc && (
                          <img
                            src={imgSrc}
                            alt={card.name}
                            className="dvm-grid-img"
                          />
                        )}
                        <span className="dvm-grid-badge">{count}</span>
                      </div>
                    );
                  })}
                </div>

                {tokenEntries.length > 0 && (
                  <div style={{ marginTop: "1.5em" }}>
                    <h3 className="dvm-token-header">
                      トークンデッキ: {totalToken}枚
                    </h3>
                    <div className="dvm-grid">
                      {tokenEntries.map(({ card, count }) => {
                        const imgSrc = card.image ? `/${card.image}` : null;
                        return (
                          <div
                            key={card.cardNo}
                            className="dvm-grid-cell"
                            onClick={() => setDetailCard(card)}
                          >
                            {imgSrc && (
                              <img
                                src={imgSrc}
                                alt={card.name}
                                className="dvm-grid-img"
                              />
                            )}
                            <span className="dvm-grid-badge token">
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {detailCard && (
        <CardDetailModal
          card={detailCard}
          onClose={() => setDetailCard(null)}
          hideDeckActions
          allCards={allCards}
          zIndex={3000}
        />
      )}
    </div>
  );
}
