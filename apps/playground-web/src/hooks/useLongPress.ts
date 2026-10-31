/**
 * useLongPress — カードクリック UI の統一パターン用フック。
 *
 * クリック/タップ = プライマリアクション、長押し / 右クリック = カード詳細
 * という対話モデルを共通化する。CardView, ZoneBrowseModal, ZoneSelectionModal,
 * DeckRevealModal, EffectQueueOverlay などで利用。
 *
 * 使い方:
 *   const lp = useLongPress(() => setDetailCard(def));
 *   <div
 *     {...lp.handlers}
 *     onClick={() => { if (lp.consumeFired()) return; doPrimaryAction(); }}
 *   />
 *
 * `consumeFired` は long-press が発火していたら true を返し、ref を消費する。
 * onClick 側で呼ばないと「長押しで詳細が開きつつクリックも発火」する重複バグになる。
 */
import { useCallback, useRef } from "react";

export interface UseLongPressHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export interface UseLongPressReturn {
  handlers: UseLongPressHandlers;
  /**
   * onClick の冒頭で呼ぶ。直前に long-press が発火していたら true を返し、ref を消費する。
   * 呼び出し側は true なら primary action をスキップする。
   */
  consumeFired: () => boolean;
  /**
   * 外部から強制的にタイマーをキャンセル（ドラッグ開始時など）。
   */
  cancel: () => void;
}

const DEFAULT_DELAY_MS = 500;

export function useLongPress(
  onLongPress: () => void,
  delay: number = DEFAULT_DELAY_MS
): UseLongPressReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  // onLongPress を ref 化して setTimeout クロージャの古参照問題を回避
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    firedRef.current = false;
    cancel();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      timerRef.current = null;
      onLongPressRef.current();
    }, delay);
  }, [cancel, delay]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      onLongPressRef.current();
    },
    [cancel]
  );

  const consumeFired = useCallback(() => {
    cancel();
    if (firedRef.current) {
      firedRef.current = false;
      return true;
    }
    return false;
  }, [cancel]);

  return {
    handlers: {
      onPointerDown,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onContextMenu,
    },
    consumeFired,
    cancel,
  };
}
