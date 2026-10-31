import "../room-reset.css";

export function RoomResetNotice({
  requestedBy,
  viewingPlayerId,
  busy,
  error,
  onRespond,
}: {
  requestedBy: string | null;
  viewingPlayerId: string;
  busy: boolean;
  error: string | null;
  onRespond: (approve: boolean) => void;
}) {
  if (!requestedBy && !error) return null;
  const incoming = requestedBy && requestedBy !== viewingPlayerId;
  return (
    <section
      className="room-reset-notice"
      role={incoming ? "dialog" : "status"}
      aria-label="リセットの申請"
    >
      {requestedBy && (
        <p>
          {incoming
            ? "相手がリセットを申請しました。承認すると、選択済みデッキで対戦準備から再開します。"
            : "リセットを申請しました。相手の承認を待っています。"}
        </p>
      )}
      {incoming && (
        <div className="room-reset-actions">
          <button
            className="game-result-btn"
            disabled={busy}
            onClick={() => onRespond(true)}
          >
            承認
          </button>
          <button
            className="game-result-btn game-result-btn-secondary"
            disabled={busy}
            onClick={() => onRespond(false)}
          >
            承認しない
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
