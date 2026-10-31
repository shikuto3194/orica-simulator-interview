import { useMemo, useState } from "react";
import { DeckThumbnail } from "./DeckThumbnail";
import { RoomDeckPicker } from "./RoomDeckPicker";
import type { BrowsableDeck } from "./SavedDeckBrowser";
import { deckSelectionIssue } from "../utils/deck-selection";
import {
  isCardDefinitionMainDeckAllowed,
  MIN_DECK_SIZE,
  randomDeck,
  type CardDefinition,
} from "@orica/rules-core";
import "../battle-setup.css";

export interface SavedDeckInfo extends Omit<BrowsableDeck, "cardNos"> {
  cards: CardDefinition[];
}

interface BattleSetupProps {
  allCards: CardDefinition[];
  savedDecks: SavedDeckInfo[];
  onStart: (aliceDeck: CardDefinition[], bobDeck: CardDefinition[]) => void;
  onBack: () => void;
}

const PLAYERS = [
  { id: "alice", label: "あなた" },
  { id: "bob", label: "相手" },
] as const;
type Player = (typeof PLAYERS)[number]["id"];

function makeRandomDeck(allCards: CardDefinition[]): CardDefinition[] {
  const usable = allCards.filter(
    (d) =>
      isCardDefinitionMainDeckAllowed(d) &&
      ((d.printedCategory === "spirit" && d.levelDefs.length > 0) ||
        d.printedCategory === "magic" ||
        d.printedCategory === "nexus" ||
        d.printedCategory === "brave")
  );
  return randomDeck(usable, MIN_DECK_SIZE);
}

export function BattleSetup({
  allCards,
  savedDecks,
  onStart,
  onBack,
}: BattleSetupProps) {
  const cards = useMemo(
    () => new Map(allCards.map((card) => [card.cardNo, card])),
    [allCards]
  );
  const decks = useMemo(
    () =>
      savedDecks.map((deck) => ({
        ...deck,
        id: deck.name,
        cardNos: deck.cards.map((card) => card.cardNo),
      })),
    [savedDecks]
  );
  const [sources, setSources] = useState<Record<Player, string | null>>(() => ({
    alice:
      decks.find((deck) => !deckSelectionIssue(deck.cardNos, cards))?.id ??
      null,
    bob: null,
  }));
  const [target, setTarget] = useState<Player>("alice");
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = (player: Player) =>
    decks.find((deck) => deck.id === sources[player]) ?? null;
  const selectionIssue = (player: Player) => {
    if (sources[player] === null) return null;
    const deck = selected(player);
    return deck
      ? deckSelectionIssue(deck.cardNos, cards)
      : "選択したデッキが見つかりません";
  };
  const canStart = PLAYERS.every(({ id }) => !selectionIssue(id));
  const choose = (source: string | null) => {
    setSources((current) => ({ ...current, [target]: source }));
    setPickerOpen(false);
  };
  const handleStart = () => {
    if (!canStart) return;
    const getDeck = (player: Player) =>
      sources[player] === null
        ? makeRandomDeck(allCards)
        : selected(player)!.cards;
    onStart(getDeck("alice"), getDeck("bob"));
  };

  return (
    <div className="battle-setup">
      <div className="setup-card solo-setup-card">
        <h1 className="setup-title">1人バトル</h1>
        <div className="solo-deck-selections">
          {PLAYERS.map(({ id, label }) => {
            const deck = selected(id);
            const issue = selectionIssue(id);
            return (
              <section className="setup-section" key={id} aria-label={label}>
                <h2>{label}</h2>
                <button
                  type="button"
                  className="room-selected-deck solo-selected-deck"
                  aria-label={`${label}のデッキを変更：${deck?.name ?? "ランダムデッキ"}`}
                  onClick={() => {
                    setTarget(id);
                    setPickerOpen(true);
                  }}
                >
                  <DeckThumbnail
                    allCards={allCards}
                    cardNos={deck?.cardNos ?? []}
                    thumbnailCardNo={deck?.thumbnailCardNo ?? undefined}
                    random={sources[id] === null}
                  />
                  <span className="solo-selected-label">
                    <strong>{deck?.name ?? "ランダムデッキ"}</strong>
                    <small>
                      {deck
                        ? `メイン${deck.cardNos.length}枚`
                        : `${MIN_DECK_SIZE}枚`}
                    </small>
                  </span>
                  <span className="solo-deck-change" aria-hidden="true">
                    変更
                  </span>
                </button>
                {issue && (
                  <p className="saved-deck-issue" role="alert">
                    {issue}
                  </p>
                )}
              </section>
            );
          })}
        </div>
        <div className="setup-actions">
          <button
            type="button"
            className="setup-btn setup-btn-start"
            disabled={!canStart}
            onClick={handleStart}
          >
            バトル開始
          </button>
          <button type="button" className="setup-btn" onClick={onBack}>
            ホームに戻る
          </button>
        </div>
      </div>
      <RoomDeckPicker
        open={pickerOpen}
        decks={decks}
        allCards={allCards}
        selectedDeck={selected(target)}
        onClose={() => setPickerOpen(false)}
        onSelect={(deck) => choose(deck.id)}
        confirmLabel={`${target === "alice" ? "あなた" : "相手"}のデッキにする`}
        selectionControls={
          <div
            className="solo-deck-targets"
            role="group"
            aria-label="デッキの選択先"
          >
            {PLAYERS.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                aria-pressed={target === id}
                onClick={() => setTarget(id)}
              >
                {label}
              </button>
            ))}
          </div>
        }
        toolbar={
          <button
            type="button"
            className="saved-deck-action"
            aria-pressed={sources[target] === null}
            onClick={() => choose(null)}
          >
            ランダムを使う
          </button>
        }
      />
    </div>
  );
}
