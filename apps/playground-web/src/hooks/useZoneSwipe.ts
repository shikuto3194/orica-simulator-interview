import { useEffect, useRef } from "react";
import type {
  DragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

/** ゾーン内から始まる横スワイプ。短いタップとキーボード操作は子へ渡す。 */
export function useZoneSwipe(
  direction: "left" | "right",
  onSwipe: (() => void) | undefined
) {
  const start = useRef<{
    pointerId: number;
    x: number;
    y: number;
    target: HTMLDivElement;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const cancel = () => {
      if (start.current) suppressClick.current = true;
      start.current = null;
    };
    const onAdditionalPointer = (event: PointerEvent) => {
      // 2本目の指がゾーン外に触れた場合もピンチ等と区別する。
      if (!event.isPrimary) cancel();
    };
    const onMove = (event: PointerEvent) => {
      const origin = start.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) {
        suppressClick.current = true;
        // documentで追跡し、最初の移動で行外へ出てもcaptureする。
        // 動くまではcaptureせず、通常タップの子要素へのclickを保つ。
        if (!origin.target.hasPointerCapture(event.pointerId))
          origin.target.setPointerCapture(event.pointerId);
      }
    };
    const onUp = (event: PointerEvent) => {
      const origin = start.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      start.current = null;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const inward = direction === "left" ? -dx : dx;
      if (inward >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        suppressClick.current = true;
        onSwipe?.();
      }
    };
    const onCancel = (event: PointerEvent) => {
      if (start.current?.pointerId === event.pointerId) cancel();
    };
    document.addEventListener("pointerdown", onAdditionalPointer, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", onAdditionalPointer, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [direction, onSwipe]);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (!event.isPrimary) return;
      start.current = null;
      suppressClick.current = false;
      if (!onSwipe || event.button !== 0) return;
      start.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.currentTarget,
      };
    },
    onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
      // 子画像のimplicit captureから行へ移った場合は継続する。
      if (
        event.target === event.currentTarget &&
        start.current?.pointerId === event.pointerId
      ) {
        start.current = null;
        suppressClick.current = true;
      }
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (event.detail === 0 || !suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart(event: DragEvent<HTMLDivElement>) {
      if (onSwipe) event.preventDefault();
    },
  };
}
