import { useLayoutEffect, useState } from "react";
import type { ReplayFocus, ReplayPresentation } from "../replayPresentation";

export function ReplayGestureOverlay({
  presentation,
  phase,
  viewer,
  duration,
}: {
  presentation: ReplayPresentation;
  phase: number;
  viewer: string;
  duration: number;
}) {
  const [boxes, setBoxes] = useState<
    Array<{
      actor: string;
      left: number;
      top: number;
      width: number;
      height: number;
    }>
  >([]);
  useLayoutEffect(() => {
    const locate = (focus: ReplayFocus) => {
      const card =
        focus.cardId &&
        [
          ...document.querySelectorAll<HTMLElement>(
            `[data-replay-card="${CSS.escape(focus.cardId)}"], [data-testid="card-${CSS.escape(focus.cardId)}"]`
          ),
        ].find((element) => element.getBoundingClientRect().width > 0);
      if (card && card.getBoundingClientRect().width) return card;
      const field = document.querySelector<HTMLElement>(
        `[data-testid="field-${focus.playerId === viewer ? "self" : "opponent"}"]`
      );
      if (focus.zone === "hand")
        return document.querySelector<HTMLElement>(
          focus.playerId === viewer
            ? '[data-testid="self-mini-hand-area"]'
            : '[data-testid="opponent-hand-area"]'
        );
      return (
        field?.querySelector<HTMLElement>(
          `[data-replay-zone="${CSS.escape(focus.zone)}"]`
        ) ?? field
      );
    };
    const update = () => {
      const targets =
        phase < 2 && presentation.source
          ? [presentation.source]
          : presentation.selections;
      const control = (id: string | undefined) =>
        id
          ? document.querySelector<HTMLElement>(
              `[data-testid="${CSS.escape(id)}"]`
            )
          : null;
      const actionButton =
        phase < 3 ? control(presentation.controlTestId) : null;
      const elements =
        presentation.preGameInputs.length > 0 && phase < 3
          ? presentation.preGameInputs.map((input) => ({
              actor: input.actor,
              element: control(input.controlTestId),
            }))
          : [
              {
                actor: presentation.actor,
                element:
                  (phase === 1 || !presentation.source ? actionButton : null) ??
                  targets.map(locate).find(Boolean),
              },
            ];
      setBoxes(
        elements
          .flatMap(({ actor, element }) => {
            if (!element) return [];
            const rect = element.getBoundingClientRect();
            return {
              actor,
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
          })
          .filter((rect) => rect.width > 0 && rect.height > 0)
      );
    };
    update();
    const pressedIds =
      phase === 1
        ? [
            ...presentation.preGameInputs.map((input) => input.controlTestId),
            presentation.controlTestId,
          ].filter((id): id is string => !!id)
        : [];
    const pressed = pressedIds
      .map((id) =>
        document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(id)}"]`)
      )
      .filter((element): element is HTMLElement => !!element);
    for (const element of pressed) element.dataset.replayPressed = "true";
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      for (const element of pressed) delete element.dataset.replayPressed;
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [presentation, phase, viewer]);
  // The board already owns battle motions and public-disclosure notices.
  // Playback only adds the inferred cursor; no separate explanation UI.
  return (
    <div
      className="replay-gesture"
      data-testid="replay-gesture"
      data-phase={phase}
      aria-hidden="true"
    >
      {boxes.map((point) => (
        <div
          key={point.actor}
          data-actor={point.actor}
          data-side={point.actor === viewer ? "self" : "opponent"}
          className={`replay-cursor${phase === 1 || phase === 2 ? " replay-cursor-click" : ""}`}
          style={{
            left:
              point.left +
              point.width / 2 +
              (boxes.length > 1 ? (point.actor === viewer ? -12 : 12) : 0),
            top: point.top + point.height / 2,
            transitionDuration: `${duration * 0.7}ms`,
          }}
        >
          <svg width="40" height="48" viewBox="0 0 40 48" aria-hidden="true">
            <path
              d="M3 2L25 20L18 22L30 32L20 43L10 28L5 32Z"
              fill="currentColor"
              stroke="white"
              strokeWidth="2"
            />
            <text
              x="20"
              y="35"
              textAnchor="middle"
              fontSize="12"
              fontWeight="bold"
              fill="white"
            >
              {point.actor === viewer ? "自" : "相"}
            </text>
          </svg>
        </div>
      ))}
    </div>
  );
}
