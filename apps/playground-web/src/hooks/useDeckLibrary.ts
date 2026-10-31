import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

export interface DeckLibrary {
  user_id: string;
  owner_id: string;
  scope_key: string;
  shared: boolean;
  decks: unknown[];
}

const CHANGE_EVENT = "bs-deck-library-changed";
export function notifyDeckLibraryChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
  try {
    localStorage.setItem(CHANGE_EVENT, String(Date.now()));
  } catch {
    // Storage restrictions must not turn a committed cloud save into a failure.
  }
}

/** The server resolves ownership and rejects mutations against an old scope. */
export async function mutateDeckLibrary(
  action: "save" | "delete",
  scope: string | null,
  deck: object
) {
  if (!scope) throw new Error("デッキを読み込んでから操作してください");
  const { error } = await supabase.rpc("bs_deck_library", {
    p_action: action,
    p_scope: scope,
    p_deck: deck,
  });
  if (error) throw new Error(error.message);
  notifyDeckLibraryChanged();
}

export function useDeckLibrary(userId: string | null | undefined) {
  const [library, setLibrary] = useState<DeckLibrary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const reload = useCallback(async () => {
    const serial = ++request.current;
    if (!userId) {
      setLibrary(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    try {
      const { data, error: failure } = await supabase.rpc("bs_deck_library", {
        p_action: "list",
      });
      if (failure) throw new Error(failure.message);
      if (!data || data.user_id !== userId || !Array.isArray(data.decks))
        throw new Error("デッキの取得に失敗しました");
      if (serial !== request.current) return;
      setLibrary(data as DeckLibrary);
      setError("");
    } catch (failure) {
      if (serial !== request.current) return;
      setLibrary(null);
      setError(
        failure instanceof Error
          ? failure.message
          : "デッキの取得に失敗しました"
      );
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    void reload();
    const invalidate = () => {
      request.current++;
    };
    const refresh = () => void reload();
    const storage = (event: StorageEvent) => {
      if (event.key === CHANGE_EVENT) refresh();
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    return () => {
      invalidate();
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
    };
  }, [reload]);
  return {
    library: library?.user_id === userId ? library : null,
    loading,
    error,
    reload,
  };
}
