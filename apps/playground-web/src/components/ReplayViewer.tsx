import { useState, useMemo, useEffect, useRef } from "react";
import { ACTION_LABELS } from "./action-ui";
import {
  EFFECT_ACTION_LABELS,
  localizeEffectLabel,
  buildTriggeredEffectLookup,
  getLegalActions,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildBurstEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "@orica/rules-core";
import { buildReplayPresentation, replayActor } from "../replayPresentation";
import { replayPreGameUiPhase } from "../preGamePresentation";
import { ReplayGestureOverlay } from "./ReplayGestureOverlay";
import { BattleScreen, type PlayerController } from "./BattleScreen";
import { ALL_CARDS } from "../../../../packages/card-data/src/generated-index";
import { resolveReplayFrameState, type ParsedReplay } from "../replayViewer";
const noOpController: PlayerController = () => null;

function frameSummary(frame: ParsedReplay["frames"][number]): string {
  const label = frame.label ?? frame.systemActionKind ?? frame.actionKind;
  if (label && Object.hasOwn(ACTION_LABELS, label)) {
    return ACTION_LABELS[label as keyof typeof ACTION_LABELS];
  }
  if (
    label &&
    (Object.hasOwn(EFFECT_ACTION_LABELS, label) ||
      /[ぁ-んァ-ヶ一-龠]/.test(label))
  ) {
    return localizeEffectLabel(label);
  }
  return `手順 ${frame.step ?? 0}`;
}

export function ReplayViewer({
  replay,
  viewingPlayerId,
  onExit,
  onHome,
}: {
  replay: ParsedReplay;
  viewingPlayerId: "alice" | "bob";
  onExit: () => void;
  onHome: () => void;
}) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [viewer, setViewer] = useState<string>(viewingPlayerId);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState(0);
  const [seekIndex, setSeekIndex] = useState<number | null>(null);
  const [intervalMs, setIntervalMs] = useState(850);
  // Playback menus belong to the viewer and persist while the board advances.
  const speedMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeSpeedMenu = () => speedMenuRef.current?.hidePopover();
    window.addEventListener("resize", closeSpeedMenu);
    return () => window.removeEventListener("resize", closeSpeedMenu);
  }, []);
  const [speedMenuPosition, setSpeedMenuPosition] = useState({
    left: 8,
    bottom: 48,
  });
  const openSpeedMenu = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setSpeedMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 176)),
      bottom: window.innerHeight - rect.top + 6,
    });
    speedMenuRef.current?.showPopover();
    speedMenuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
  };
  const expandedDefs = useMemo(
    () => expandCardDefinitionsWithBackFaces(ALL_CARDS),
    []
  );
  const cardNoMap = useMemo(
    () => new Map(expandedDefs.map((card) => [card.cardNo, card])),
    [expandedDefs]
  );
  const replayFrameOptions = useMemo(
    () => ({
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(expandedDefs),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(expandedDefs),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(expandedDefs),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(expandedDefs),
      getRegisteredMagicActions: buildMagicLookup(expandedDefs),
      getRegisteredBurstActions: buildBurstEffectLookup(expandedDefs),
    }),
    [cardNoMap, expandedDefs]
  );
  const lastIndex = replay.frames.length - 1;
  const frame = replay.frames[frameIndex] ?? replay.frames[0]!;
  const frameState = useMemo(() => {
    const resolved = resolveReplayFrameState(frame, replayFrameOptions);
    if (resolved.warnings.length > 0) {
      console.warn("[replay] frame restore warnings:", resolved.warnings);
    }
    return resolved.state;
  }, [frame, replayFrameOptions]);
  const nextState = useMemo(
    () =>
      resolveReplayFrameState(
        replay.frames[Math.min(lastIndex, frameIndex + 1)]!,
        replayFrameOptions
      ).state,
    [replay, frameIndex, lastIndex, replayFrameOptions]
  );
  const presentation = useMemo(() => {
    const actions =
      frame.actionId || frame.actionKind
        ? getLegalActions({
            state: frameState,
            actingPlayerId: replayActor(frameState, nextState, frame),
            ...replayFrameOptions,
          })
        : [];
    return buildReplayPresentation(
      frameState,
      nextState,
      frame,
      replayFrameOptions.getCardDefinitionById,
      actions
    );
  }, [frameState, nextState, frame, replayFrameOptions]);
  const displayedState = phase === 3 ? nextState : frameState;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (phase < 3) {
        setPhase((value) => value + 1);
        return;
      }
      const next = Math.min(lastIndex, frameIndex + 1);
      setFrameIndex(next);
      setPhase(0);
      if (next === lastIndex) setPlaying(false);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [playing, intervalMs, frameIndex, lastIndex, phase]);

  const moveTo = (next: number) => {
    setPlaying(false);
    setSeekIndex(null);
    setPhase(0);
    setFrameIndex(Math.max(0, Math.min(lastIndex, next)));
  };
  const currentViewer =
    frameState.players.find((p) => p.id === viewer)?.id ??
    frameState.players[0]!.id;

  return (
    <div className="replay-viewer" data-testid="replay-viewer">
      <BattleScreen
        key={"replay-" + currentViewer}
        cardDefs={ALL_CARDS}
        initialState={frameState}
        replayState={displayedState}
        replayPresentation={{
          action: phase < 3 ? presentation.legalAction : undefined,
          preGamePhase: replayPreGameUiPhase(
            frameState,
            nextState,
            currentViewer,
            phase
          ),
        }}
        viewingPlayerId={currentViewer}
        readOnly
        revealHiddenInfo
        allowReadOnlyInspection
        opponentController={noOpController}
        onExit={onExit}
        onHome={onHome}
        replayControls={{
          onOpenMenu: () => {
            setPlaying(false);
            setSeekIndex(null);
          },
          controls: (
            <div
              className="replay-controls"
              role="group"
              aria-label="棋譜再生操作"
            >
              <button
                type="button"
                className="replay-control-btn"
                onClick={() => moveTo(frameIndex - 1)}
                disabled={frameIndex <= 0}
              >
                ◀前
              </button>
              <button
                type="button"
                className="replay-control-btn replay-control-play"
                data-testid="replay-play"
                aria-pressed={playing}
                aria-haspopup="menu"
                aria-controls="replay-speed-menu"
                title="再生 / 停止（右クリック、または Alt+↓ で速度変更）"
                onClick={() => {
                  if (!playing && frameIndex >= lastIndex) {
                    setFrameIndex(0);
                    setPhase(0);
                  }
                  setPlaying((value) => !value);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openSpeedMenu(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.altKey && event.key === "ArrowDown") {
                    event.preventDefault();
                    openSpeedMenu(event.currentTarget);
                  }
                }}
                disabled={lastIndex <= 0}
              >
                {playing ? "停止" : "再生"}
              </button>
              <button
                type="button"
                className="replay-control-btn"
                onClick={() => moveTo(frameIndex + 1)}
                disabled={frameIndex >= lastIndex}
              >
                次▶
              </button>
              <button
                type="button"
                className="replay-control-btn replay-control-viewer"
                title={"視: " + currentViewer + "（押すと切り替え）"}
                onClick={() => {
                  setPlaying(false);
                  setPhase(0);
                  setViewer(
                    frameState.players.find((p) => p.id !== currentViewer)
                      ?.id ?? currentViewer
                  );
                }}
              >
                視: {currentViewer}
              </button>
            </div>
          ),
          details: (
            <div
              className="replay-menu-details"
              role="group"
              aria-label="棋譜情報"
            >
              <div className="replay-menu-title" title={replay.title}>
                {replay.title}
              </div>
              <div className="replay-menu-frame">
                {frameIndex + 1}/{replay.frames.length} · {frameSummary(frame)}
              </div>
              <input
                className="replay-menu-range"
                aria-label="棋譜の再生位置"
                type="range"
                min={0}
                max={lastIndex}
                value={seekIndex ?? frameIndex}
                // ドラッグ中のフレーム差し替えでメニューが消えないよう、離した時に移動する。
                onChange={(event) =>
                  setSeekIndex(Number(event.currentTarget.value))
                }
                onPointerUp={(event) =>
                  moveTo(Number(event.currentTarget.value))
                }
                onKeyUp={(event) => moveTo(Number(event.currentTarget.value))}
                onBlur={(event) => {
                  if (seekIndex !== null)
                    moveTo(Number(event.currentTarget.value));
                }}
              />
            </div>
          ),
        }}
      />
      {frameIndex < lastIndex && (playing || phase > 0) && (
        <ReplayGestureOverlay
          presentation={presentation}
          phase={phase}
          viewer={currentViewer}
          duration={intervalMs}
        />
      )}
      <div
        ref={speedMenuRef}
        id="replay-speed-menu"
        popover="auto"
        className="more-menu-panel more-menu-panel-portal replay-speed-menu"
        role="menu"
        aria-label="再生速度"
        style={speedMenuPosition}
      >
        <span className="replay-speed-heading">再生速度</span>
        {[
          { ms: 1200, label: "ゆっくり" },
          { ms: 850, label: "標準" },
          { ms: 450, label: "速い" },
        ].map(({ ms, label }) => (
          <button
            key={ms}
            type="button"
            className="more-menu-item"
            role="menuitemradio"
            aria-checked={intervalMs === ms}
            onClick={() => {
              setIntervalMs(ms);
              speedMenuRef.current?.hidePopover();
            }}
          >
            {label}
            {intervalMs === ms ? " ✓" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
