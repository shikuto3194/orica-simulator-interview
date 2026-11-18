import { gameResultReasonLabel } from "../utils/game-result-label";
import type { GameState, Step } from "@orica/rules-core";
import { STEP_LABELS } from "@orica/rules-core";
import { useBgm } from "../bgm/BgmContext";
import { BgmMarquee } from "./BgmMarquee";

interface GameHudProps {
  state: GameState;
  viewingPlayerId: string;
  /** ボイドゾーン（除外カード）クリック時のコールバック。playerId を引数に渡す */
  onVoidClick?: ((playerId: string) => void) | undefined;
  /** ボイド通常コアを core selection source として掴めるとき true。 */
  voidCoreTapActive?: boolean | undefined;
  onVoidCoreTapClick?: (() => void) | undefined;
  /**
   * pre-game 中に janken が確定した瞬間に HUD だけを即時更新するための override。
   * state.preGame.firstPlayerId が親 state に伝播していない場合に使用する。
   */
  firstPlayerOverride?: string | null;
}

// 長いステップ名を横圧縮する比率（5文字以上）
const STEP_SCALE: Partial<Record<Step, number>> = {
  start: 0.8,
  refresh: 0.7,
  attack: 0.85,
};

export function GameHud({
  state,
  viewingPlayerId,
  onVoidClick,
  voidCoreTapActive,
  onVoidCoreTapClick,
  firstPlayerOverride,
}: GameHudProps) {
  const player = state.players.find((p) => p.id === viewingPlayerId);
  const opponent = state.players.find((p) => p.id !== viewingPlayerId);
  const scale = STEP_SCALE[state.step];

  // 先攻プレイヤー: pre-game 中は override を優先 (HUD 即時反映用)、
  // 次に preGame.firstPlayerId、確定後は playerOrder[0]。
  // janken 未確定時は null。
  const firstPlayerId =
    firstPlayerOverride ??
    (state.preGame
      ? state.preGame.firstPlayerId
      : (state.playerOrder[0] ?? null));
  const firstIsMe =
    firstPlayerId == null ? null : firstPlayerId === viewingPlayerId;

  // 「○○のターン」表示: pre-game 中は activePlayerId が janken 結果へ
  // まだ反映されていない (state は親へ伝播させていない) ため、
  // override から先攻 = 最初のアクティブプレイヤーを推定する。
  const isMyTurn =
    firstPlayerOverride != null
      ? firstPlayerOverride === viewingPlayerId
      : state.activePlayerId === viewingPlayerId;

  // ボイドゾーン（除外）のカード枚数
  const myVoidCards = state.cardInstances.filter(
    (c) => c.controllerPlayerId === viewingPlayerId && c.zone === "void"
  ).length;
  const oppVoidCards = state.cardInstances.filter(
    (c) => c.controllerPlayerId !== viewingPlayerId && c.zone === "void"
  ).length;
  const hasVoidCards = myVoidCards > 0 || oppVoidCards > 0;

  // 現在再生中の作品名・曲名 (ステップ名の右に並べる小さな HUD)
  const {
    works: bgmWorks,
    currentWorkIndex: bgmWorkIndex,
    currentSongName,
  } = useBgm();
  const bgmWorkLabel = bgmWorks[bgmWorkIndex]?.work.label ?? null;
  const bgmHudLabel =
    bgmWorkLabel && currentSongName
      ? `${bgmWorkLabel}・${currentSongName}`
      : (bgmWorkLabel ?? currentSongName ?? null);

  return (
    <div className="game-hud" data-testid="game-hud">
      <span
        className={`hud-turn-indicator ${isMyTurn ? "my-turn" : "opp-turn"}`}
        data-testid="turn-indicator"
      >
        {isMyTurn ? "自分のターン" : "相手のターン"}
      </span>

      <span className="hud-turn-number" data-testid="turn-number">
        T{state.turnNumber}
      </span>

      {state.extraTurnState ? (
        <span
          className="hud-extra-turn-badge"
          data-testid="extra-turn-badge"
          title={
            state.extraTurnState.returnContext
              ? `追加ターン中: 終了時 T${state.extraTurnState.returnContext.turnNumber} ${state.extraTurnState.returnContext.activePlayerId}'s ${state.extraTurnState.returnContext.step} に復帰`
              : "追加ターン中"
          }
        >
          ＋追加ターン
        </span>
      ) : null}

      <span
        className="hud-step"
        data-testid="step-label"
        style={
          scale
            ? { transform: `scaleX(${scale})`, transformOrigin: "left" }
            : undefined
        }
      >
        {STEP_LABELS[state.step]}
      </span>

      {bgmHudLabel && <BgmMarquee label={bgmHudLabel} />}

      <span className="hud-void-block-wrapper">
        <span className="hud-first-second" data-testid="first-second-indicator">
          <span className="hud-fs-label">先攻:</span>
          <span
            className={`hud-fs-marker ${
              firstIsMe == null
                ? "hud-fs-pending"
                : firstIsMe
                  ? "my-turn"
                  : "opp-turn"
            }`}
            data-testid="first-player-marker"
          >
            {firstIsMe == null ? "?" : firstIsMe ? "自" : "相"}
          </span>
          <span className="hud-fs-label">後攻:</span>
          <span
            className={`hud-fs-marker ${
              firstIsMe == null
                ? "hud-fs-pending"
                : firstIsMe
                  ? "opp-turn"
                  : "my-turn"
            }`}
            data-testid="second-player-marker"
          >
            {firstIsMe == null ? "?" : firstIsMe ? "相" : "自"}
          </span>
        </span>
        <span
          className={`hud-void-block${voidCoreTapActive ? " ac-selectable" : ""}`}
          onClick={voidCoreTapActive ? onVoidCoreTapClick : undefined}
          title={voidCoreTapActive ? "ボイドのコアを掴む" : undefined}
        >
          ボイド 自:{player?.voidNormalCoreCount ?? 0}/相:
          {opponent?.voidNormalCoreCount ?? 0}
        </span>
        {hasVoidCards && (
          <span className="hud-void-cards">
            除外
            <span
              className="hud-void-card-link"
              onClick={() => onVoidClick?.(viewingPlayerId)}
              title="自分の除外カードを閲覧"
            >
              自:{myVoidCards}
            </span>
            /
            <span
              className="hud-void-card-link"
              onClick={() => {
                const oppId = state.players.find(
                  (p) => p.id !== viewingPlayerId
                )?.id;
                if (oppId) onVoidClick?.(oppId);
              }}
              title="相手の除外カードを閲覧"
            >
              相:{oppVoidCards}
            </span>
          </span>
        )}
      </span>

      {state.gameResult && (
        <div className="hud-game-result">
          ゲーム終了 — {gameResultReasonLabel(state.gameResult.reason)}
          {state.gameResult.losingPlayerId && (
            <span>
              {" "}
              (
              {state.gameResult.losingPlayerId === viewingPlayerId
                ? "敗北"
                : "勝利"}
              )
            </span>
          )}
        </div>
      )}
    </div>
  );
}
