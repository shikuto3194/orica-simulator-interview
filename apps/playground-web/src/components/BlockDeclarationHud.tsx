import { useLayoutEffect, useRef, useState } from "react";
import { TargetFooterActions } from "./TargetSelectionController";
import "./block-declaration-hud.css";

export interface BlockArrow {
  blockerId: string;
  attackerId?: string;
}

type Point = { x: number; y: number };

export function BlockDeclarationHud({
  arrows,
  message,
  canConfirm,
  onCancel,
  onConfirm,
  onReset,
}: {
  arrows: readonly BlockArrow[];
  message: string;
  canConfirm: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<Point | null>(null);
  const [lines, setLines] = useState<{ from: Point; to: Point }[]>([]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const field = overlay?.closest(".battle-field");
    if (!overlay || !field) return;
    const findCard = (id: string) =>
      field.querySelector('[data-testid="card-' + CSS.escape(id) + '"]');
    const measure = () => {
      const bounds = overlay.getBoundingClientRect();
      const center = (id: string): Point | null => {
        const card = findCard(id)?.getBoundingClientRect();
        return card
          ? {
              x: card.left + card.width / 2 - bounds.left,
              y: card.top + card.height / 2 - bounds.top,
            }
          : null;
      };
      setLines(
        arrows.flatMap(({ blockerId, attackerId }) => {
          const from = center(blockerId);
          const mouse = pointer.current;
          const to = attackerId
            ? center(attackerId)
            : mouse && { x: mouse.x - bounds.left, y: mouse.y - bounds.top };
          return from && to ? [{ from, to }] : [];
        })
      );
    };
    const trackPointer = (event: PointerEvent) => {
      pointer.current =
        event.pointerType === "mouse"
          ? { x: event.clientX, y: event.clientY }
          : null;
      if (arrows.some((arrow) => !arrow.attackerId)) measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    for (const arrow of arrows) {
      for (const id of [arrow.blockerId, arrow.attackerId]) {
        const card = id && findCard(id);
        if (card) observer.observe(card);
      }
    }
    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [arrows]);

  return (
    <>
      <div
        ref={overlayRef}
        className="block-declaration-arrows"
        aria-hidden="true"
      >
        {lines.map(({ from, to }, index) => (
          <div
            key={index}
            className="block-declaration-arrow"
            style={{
              left: from.x,
              top: from.y,
              width: Math.hypot(to.x - from.x, to.y - from.y),
              transform:
                "rotate(" + Math.atan2(to.y - from.y, to.x - from.x) + "rad)",
            }}
          />
        ))}
      </div>
      <div className="block-declaration-controls">
        <div role="status">{message}</div>
        <TargetFooterActions
          actions={[
            { label: "キャンセル", variant: "cancel", onClick: onCancel },
            {
              label: "完了",
              variant: "ok",
              onClick: onConfirm,
              disabled: !canConfirm,
            },
            { label: "リセット", variant: "warn", onClick: onReset },
          ]}
        />
      </div>
    </>
  );
}
