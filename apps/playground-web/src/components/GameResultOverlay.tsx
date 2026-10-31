import { gameResultReasonLabel } from "../utils/game-result-label";
import type { GameResult } from "@orica/rules-core";

interface GameResultOverlayProps {
  result: GameResult;
  viewingPlayerId: string;
  onReset?: (() => void) | undefined;
  onSaveReplay?: (() => void) | undefined;
  busy?: boolean;
  error?: string | null;
  /** タイトル画面へ戻る。渡されたときだけ「ホームに戻る」ボタンを表示する。 */
  onHome?: (() => void) | undefined;
}

export function GameResultOverlay({
  result,
  viewingPlayerId,
  onReset,
  onHome,
  onSaveReplay,
  busy,
  error,
}: GameResultOverlayProps) {
  const isLoss =
    result.kind === "player_loss" && result.losingPlayerId === viewingPlayerId;
  const isWin =
    result.kind === "player_loss" && result.losingPlayerId !== viewingPlayerId;
  const _isDraw = result.kind === "draw";

  return (
    <div className="game-result-overlay">
      <div className="game-result-card">
        <div
          className={`game-result-banner ${
            isWin ? "result-win" : isLoss ? "result-lose" : "result-draw"
          }`}
        >
          {isWin ? "勝利" : isLoss ? "敗北" : "引き分け"}
        </div>
        <p className="game-result-reason">
          {gameResultReasonLabel(result.reason)}
        </p>
        <div className="game-result-actions">
          {onReset && (
            <button
              className="game-result-btn"
              onClick={onReset}
              disabled={busy}
            >
              選択済みデッキでもう一度
            </button>
          )}
          {onSaveReplay && (
            <button
              className="game-result-btn game-result-btn-secondary"
              onClick={onSaveReplay}
              disabled={busy}
            >
              棋譜保存
            </button>
          )}
          {onHome && (
            <button
              className="game-result-btn game-result-btn-secondary"
              onClick={onHome}
            >
              ホームに戻る
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
