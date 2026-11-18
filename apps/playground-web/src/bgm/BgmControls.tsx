import { useLayoutEffect, useRef, useState } from "react";
import { useBgm } from "./BgmContext";

const EDGE_GAP = 12;

/**
 * 右下フローティングの BGM コントロール。
 * 非展開時でも `📢 / 作品名・曲名 ♪` を常時表示する。
 * 展開時はミュート切替・音量スライダ・曲送りが追加で出る。
 * ゲーム画面では BattleScreen の「・・・」メニュー側に統合するため表示しない (App.tsx で制御)。
 */
export function BgmControls({ themed = false }: { themed?: boolean }) {
  const {
    works,
    currentWorkIndex,
    currentSongName,
    volume,
    muted,
    setVolume,
    toggleMute,
    skipTrack,
  } = useBgm();
  const [open, setOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const rootStyle = document.documentElement.style;
    const measure = () => {
      rootStyle.setProperty(
        "--bgm-controls-clearance",
        `${controls.getBoundingClientRect().height + EDGE_GAP * 2}px`
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    measure();
    return () => {
      observer.disconnect();
      rootStyle.removeProperty("--bgm-controls-clearance");
    };
  }, []);
  const work = works[currentWorkIndex];
  const workLabel = work?.work.label ?? "—";
  const songLabel = currentSongName ?? "—";
  const nowPlaying = `${workLabel}・${songLabel}`;

  return (
    <div
      ref={controlsRef}
      data-testid="bgm-controls"
      className={themed ? "gensou-bgm" : undefined}
      style={{
        position: "fixed",
        right: EDGE_GAP,
        bottom: EDGE_GAP,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: themed ? "rgba(20, 23, 34, 0.88)" : "rgba(0,0,0,0.5)",
        color: "#fff",
        borderRadius: 999,
        padding: "6px 12px",
        backdropFilter: "blur(6px)",
        fontSize: "0.85em",
        userSelect: "none",
        maxWidth: "min(80vw, 520px)",
      }}
    >
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "ミュート解除" : "ミュート"}
        title={muted ? "ミュート解除" : "ミュート"}
        style={btnStyle}
      >
        {muted || volume === 0 ? "🔇" : "📢"}
      </button>
      <span aria-hidden="true" style={{ opacity: 0.6 }}>
        /
      </span>
      {open && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: 80, accentColor: "#e94560" }}
          aria-label="音量"
        />
      )}
      <span
        data-testid="bgm-now-playing"
        style={{
          fontSize: "0.78em",
          opacity: 0.85,
          maxWidth: open ? 220 : 260,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={nowPlaying}
      >
        {themed ? (
          <>
            <span className="gensou-bgm-work">{workLabel}</span>
            <span className="gensou-bgm-song">{songLabel}</span>
          </>
        ) : (
          nowPlaying
        )}
      </span>
      {open && (
        <button
          type="button"
          onClick={skipTrack}
          aria-label="次の曲へ"
          title="次の曲 / 作品へ"
          style={btnStyle}
        >
          ⏭
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          open ? "BGM コントロールを閉じる" : "BGM コントロールを開く"
        }
        title={open ? "閉じる" : "BGM コントロール"}
        style={btnStyle}
      >
        {open ? "×" : "♪"}
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#fff",
  cursor: "pointer",
  fontSize: "1em",
  padding: "2px 6px",
  lineHeight: 1,
};
