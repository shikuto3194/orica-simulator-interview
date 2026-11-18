import type { ReactNode } from "react";
import "./public-disclosure-log.css";

interface PublicDisclosureLogViewProps {
  contracts: readonly {
    id: string;
    owner: string;
    cardLabel: string | null;
    onOpenDetail?: () => void;
  }[];
  history: ReactNode;
  details: ReactNode;
  onClose: () => void;
}

export function PublicDisclosureLogView({
  contracts,
  history,
  details,
  onClose,
}: PublicDisclosureLogViewProps) {
  return (
    <div
      className="zone-browse-overlay public-disclosure-log-overlay"
      onClick={onClose}
    >
      <section
        className="zone-browse-panel public-disclosure-log-panel"
        data-testid="public-disclosure-log-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="zone-browse-header">
          <h3 className="zone-browse-title">公開情報ログ</h3>
          <button
            className="zone-browse-close"
            onClick={onClose}
            aria-label="ログを閉じる"
          >
            ✕
          </button>
        </div>
        <div className="public-disclosure-log-list">
          <h4 className="public-disclosure-contract-heading">契約カード</h4>
          {contracts.map(({ id, owner, cardLabel, onOpenDetail }) => {
            const contents = (
              <>
                <span>{owner}</span>
                <span>{cardLabel ?? "提示なし"}</span>
              </>
            );
            return onOpenDetail ? (
              <button
                key={id}
                type="button"
                className="public-disclosure-entry public-disclosure-entry-clickable"
                onClick={onOpenDetail}
              >
                {contents}
              </button>
            ) : (
              <div key={id} className="public-disclosure-entry">
                {contents}
              </div>
            );
          })}
          {history ?? (
            <p className="zone-browse-empty">公開履歴はまだありません</p>
          )}
        </div>
        {details}
      </section>
    </div>
  );
}
