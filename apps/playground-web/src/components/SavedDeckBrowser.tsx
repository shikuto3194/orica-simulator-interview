import { useId, useMemo, useState, type ReactNode } from "react";
import type { CardDefinition } from "@orica/rules-core";
import { DeckThumbnail } from "./DeckThumbnail";
import SavedDeckFilters from "./SavedDeckFilters";
import {
  EMPTY_DECK_FILTERS,
  profileFromCardNos,
  getDeckFilterOptions,
  matchDeckProfile,
} from "../utils/saved-deck-filters";
import SavedDeckSort from "./SavedDeckSort";
import {
  sortSavedDecks,
  type DeckSortKey,
  type DeckSortDirection,
} from "../utils/saved-deck-sort";
import "../saved-deck-browser.css";

export interface BrowsableDeck {
  name: string;
  cardNos: string[];
  tokenDeck?: Array<{ cardNo: string; count: number }>;
  thumbnailCardNo?: string | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

/** 保存デッキとルームで、検索・並び順・カード表示を共有する。 */
export function SavedDeckBrowser<T extends BrowsableDeck>({
  decks,
  allCards,
  onPreview,
  getKey,
  selectedKey,
  header,
  toolbar,
  notice,
  renderActions,
  getIssue,
}: {
  decks: T[];
  allCards: CardDefinition[];
  onPreview: (deck: T) => void;
  getKey: (deck: T) => string;
  selectedKey?: string | undefined;
  header?: ReactNode;
  toolbar?: ReactNode;
  notice?: ReactNode;
  renderActions?: (deck: T) => ReactNode;
  getIssue?: (deck: T) => string | null;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<DeckSortKey>("hit");
  const [direction, setDirection] = useState<DeckSortDirection>("desc");
  const [showOptions, setShowOptions] = useState(false);
  const optionsId = useId();
  const [filters, setFilters] = useState(EMPTY_DECK_FILTERS);
  const cards = useMemo(
    () => new Map(allCards.map((card) => [card.cardNo, card])),
    [allCards]
  );
  const profiles = useMemo(
    () =>
      new Map(
        decks.map((deck) => [deck, profileFromCardNos(deck.cardNos, cards)])
      ),
    [decks, cards]
  );
  const options = useMemo(
    () => getDeckFilterOptions([...profiles.values()]),
    [profiles]
  );
  const matches = useMemo(
    () =>
      new Map(
        decks.map((deck) => [
          deck,
          matchDeckProfile(profiles.get(deck)!, filters),
        ])
      ),
    [decks, profiles, filters]
  );
  const filtered = useMemo(
    () =>
      sortSavedDecks(
        decks.filter(
          (deck) =>
            deck.name.toLowerCase().includes(search.trim().toLowerCase()) &&
            matches.get(deck)!.matches
        ),
        sortKey,
        direction,
        (deck) =>
          deck.cardNos.map((cardNo) => ({
            pack: cards.get(cardNo)?.pack,
            count: 1,
          })),
        (deck) => matches.get(deck)!.score
      ),
    [decks, search, sortKey, direction, cards, matches]
  );
  return (
    <>
      <div className="db-workspace-controls">
        {header}
        <div className="saved-deck-toolbar">
          {toolbar}
          <button
            type="button"
            className="saved-deck-action"
            aria-expanded={showOptions}
            aria-controls={optionsId}
            onClick={() => setShowOptions((open) => !open)}
          >
            フィルター・並び替え
          </button>
          <input
            type="search"
            aria-label="保存デッキ検索"
            placeholder="デッキ名で検索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            className="saved-deck-action"
            disabled={!search && !Object.values(filters).some(Boolean)}
            onClick={() => {
              setSearch("");
              setFilters(EMPTY_DECK_FILTERS);
            }}
          >
            条件リセット
          </button>
        </div>
        {showOptions && (
          <div id={optionsId} className="saved-deck-options-panel">
            <SavedDeckFilters
              filters={filters}
              options={options}
              onChange={setFilters}
            >
              <SavedDeckSort
                sortKey={sortKey}
                direction={direction}
                onSortKeyChange={(key) => {
                  setSortKey(key);
                  if (key === "hit") setDirection("desc");
                }}
                onDirectionChange={setDirection}
              />
            </SavedDeckFilters>
          </div>
        )}
        <p className="saved-deck-results-count" role="status">
          全{decks.length}デッキ中 {filtered.length}件
        </p>
      </div>
      <div className="db-workspace-cards">
        {notice}
        <div className="saved-decks-grid">
          {decks.length === 0 && <div>保存デッキなし</div>}
          {decks.length > 0 && filtered.length === 0 && (
            <div>一致するデッキなし</div>
          )}
          {filtered.map((deck) => {
            const selected = getKey(deck) === selectedKey;
            const tokenCount =
              deck.tokenDeck?.reduce((sum, token) => sum + token.count, 0) ?? 0;
            const issue = getIssue?.(deck);
            return (
              <div
                className={`saved-deck-card${selected ? " is-selected" : ""}`}
                key={getKey(deck)}
              >
                <button
                  type="button"
                  className="saved-deck-open"
                  aria-pressed={
                    selectedKey === undefined ? undefined : selected
                  }
                  onClick={() => onPreview(deck)}
                >
                  <DeckThumbnail
                    allCards={allCards}
                    cardNos={deck.cardNos}
                    thumbnailCardNo={
                      deck.thumbnailCardNo ??
                      deck.cardNos[0] ??
                      deck.tokenDeck?.find((token) => token.count > 0)?.cardNo
                    }
                  />
                  <span className="deck-title">{deck.name}</span>
                  <span className="deck-count">
                    メイン{deck.cardNos.length}枚
                    {tokenCount > 0 ? ` トークン${tokenCount}枚` : ""}
                  </span>
                  {selected && (
                    <span className="saved-deck-selected">選択中</span>
                  )}
                  {issue && <span className="saved-deck-issue">{issue}</span>}
                </button>
                {renderActions && (
                  <div className="deck-actions">{renderActions(deck)}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
