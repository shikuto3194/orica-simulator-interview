import { useEffect, useSyncExternalStore } from "react";

/**
 * モーダルが自前の「盤面確認」ボタンを出している間は、そちらが主役。
 * 画面右上の共通ボタンは同時に出さない (盤面確認が2つ並ばないようにする)。
 * モーダル側は useInlineBoardPeek(true) で「自前のボタンを出している」と登録する。
 */
let inlineCount = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 自前の盤面確認ボタンを出している間 true を渡す。アンマウントや false で自動解除。 */
export function useInlineBoardPeek(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    inlineCount += 1;
    notify();
    return () => {
      inlineCount -= 1;
      notify();
    };
  }, [active]);
}

/** 自前の盤面確認ボタンを出しているモーダルがあるか。 */
export function useHasInlineBoardPeek(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => inlineCount > 0,
    () => false
  );
}
