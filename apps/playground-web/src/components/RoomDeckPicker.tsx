import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CardDefinition } from "@orica/rules-core";
import { deckSelectionIssue } from "../utils/deck-selection";
import { SavedDeckBrowser, type BrowsableDeck } from "./SavedDeckBrowser";
import { DeckViewModal } from "./DeckViewModal";

/** ルームと一人バトルで共通のデッキ選択・詳細確認。 */
export function RoomDeckPicker<T extends BrowsableDeck & { id: string }>({
  open,
  decks,
  allCards,
  selectedDeck,
  busy = false,
  error = "",
  selectionControls,
  toolbar,
  confirmLabel = "このデッキを使う",
  onClose,
  onSelect,
}: {
  open: boolean;
  decks: T[];
  allCards: CardDefinition[];
  selectedDeck: T | null;
  busy?: boolean;
  error?: string;
  selectionControls?: ReactNode;
  toolbar?: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
  onSelect: (deck: T) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const cards = useMemo(
    () => new Map(allCards.map((card) => [card.cardNo, card])),
    [allCards]
  );
  const previewIssue = preview
    ? deckSelectionIssue(preview.cardNos, cards)
    : null;
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      dialog.current
        ?.querySelector(".is-selected")
        ?.scrollIntoView({ block: "nearest" });
    } else {
      dialog.current?.close();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="room-deck-picker"
      aria-label="デッキを選ぶ"
      onClose={() => setPreview(null)}
      onCancel={(event) => {
        event.preventDefault();
        if (busy) return;
        if (preview) setPreview(null);
        else onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !busy) onClose();
      }}
    >
      <div className="room-deck-picker-body" inert={!!preview}>
        <div className="room-deck-picker-heading">
          <h2>デッキを選ぶ</h2>
          <button
            type="button"
            aria-label="デッキ選択を閉じる"
            disabled={busy}
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {selectionControls}
        <div className="db-saved-workspace room-deck-picker-workspace">
          <SavedDeckBrowser
            decks={decks}
            allCards={allCards}
            getKey={(deck) => deck.id}
            selectedKey={selectedDeck?.id ?? ""}
            onPreview={setPreview}
            toolbar={toolbar}
            getIssue={(deck) => deckSelectionIssue(deck.cardNos, cards)}
          />
        </div>
        {error && !preview && <p role="alert">{error}</p>}
      </div>
      {preview && (
        <DeckViewModal
          deckName={preview.name}
          cardNos={preview.cardNos}
          tokenDeck={preview.tokenDeck ?? []}
          {...(preview.thumbnailCardNo
            ? { thumbnailCardNo: preview.thumbnailCardNo }
            : {})}
          allCards={allCards}
          onClose={() => {
            if (!busy) setPreview(null);
          }}
          action={
            <div className="room-deck-confirm">
              {previewIssue && (
                <p className="saved-deck-issue">{previewIssue}</p>
              )}
              {error && <p role="alert">{error}</p>}
              <button
                type="button"
                className="ui-primary"
                disabled={busy || !!previewIssue}
                onClick={() => onSelect(preview)}
              >
                {busy ? "変更中…" : confirmLabel}
              </button>
            </div>
          }
        />
      )}
    </dialog>
  );
}
