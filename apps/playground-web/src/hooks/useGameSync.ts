import { useCallback, useRef } from "react";
import type { GameState } from "@orica/rules-core";

/**
 * GUI ↔ API 状態同期フック。
 * - pushState: GUI が action 実行後に API に state を push
 * - pollForChanges: API 側の state 変更を検出して新 state を返す（bob が API 経由で操作した場合）
 */
export function useGameSync(enabled: boolean) {
  const lastKnownVersion = useRef(0);

  const pushState = useCallback(
    async (state: GameState) => {
      if (!enabled) return;
      try {
        const res = await fetch("/api/game/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
        });
        if (res.ok) {
          const data = await res.json();
          lastKnownVersion.current = data.version;
        }
      } catch {
        /* API unavailable (e.g. vite preview) — silently ignore */
      }
    },
    [enabled]
  );

  const pollForChanges = useCallback(async (): Promise<GameState | null> => {
    if (!enabled) return null;
    try {
      const res = await fetch("/api/game/state/version");
      if (!res.ok) return null;
      const data = await res.json();
      if (data.version > lastKnownVersion.current) {
        const fullRes = await fetch("/api/game/state/full");
        if (!fullRes.ok) return null;
        const fullData = await fullRes.json();
        lastKnownVersion.current = fullData.version;
        return fullData.state as GameState;
      }
    } catch {
      /* API unavailable */
    }
    return null;
  }, [enabled]);

  return { pushState, pollForChanges };
}
