import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../AuthContext";
import {
  INITIAL_IMAGE_PROGRESS,
  type ImageDownloadProgress,
} from "./download-images";
import { prepareAssets } from "./prepare-assets";
import type { StorageTier } from "./local-asset-store";
import { IS_INTERVIEW_BUILD } from "../interview-mode";

interface PreparationState {
  userId: string | undefined;
  progress: ImageDownloadProgress;
  tier: StorageTier | undefined;
  ready: boolean;
  catalogVersion: number;
}
const initial = (userId?: string): PreparationState => ({
  userId,
  progress: INITIAL_IMAGE_PROGRESS,
  tier: undefined,
  ready: false,
  catalogVersion: 0,
});
const AssetPreparationContext = createContext<
  (PreparationState & { retry: () => void }) | null
>(null);

/** Authentication, rather than the title's lifetime, owns asset installation. */
export function AssetPreparationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState(() => initial(userId));
  const [attempt, setAttempt] = useState(0);
  if (state.userId !== userId) setState(initial(userId));
  useEffect(() => {
    if (IS_INTERVIEW_BUILD) {
      setState({
        ...initial(userId),
        progress: { status: "unavailable", percent: 0, logs: [] },
        tier: "stream",
        ready: true,
      });
      return;
    }
    if (loading || !userId) return;
    const controller = new AbortController();
    let running = false;
    const check = () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      void prepareAssets({
        signal: controller.signal,
        onProgress: (progress) =>
          setState((previous) =>
            controller.signal.aborted
              ? previous
              : {
                  ...previous,
                  progress,
                  ready:
                    previous.ready ||
                    progress.status === "ready" ||
                    progress.status === "unavailable",
                }
          ),
        onTier: (tier) =>
          setState((previous) =>
            controller.signal.aborted ? previous : { ...previous, tier }
          ),
        onInstalled: () =>
          setState((previous) =>
            controller.signal.aborted
              ? previous
              : { ...previous, catalogVersion: previous.catalogVersion + 1 }
          ),
      })
        .catch(() => {
          // Sign-out/unmount aborts; verified files remain reusable.
        })
        .finally(() => {
          running = false;
        });
    };
    check();
    const interval = setInterval(check, 60_000);
    window.addEventListener("pageshow", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [loading, userId, attempt]);
  return (
    <AssetPreparationContext.Provider
      value={{
        ...state,
        retry: () => {
          if (!IS_INTERVIEW_BUILD) setAttempt((value) => value + 1);
        },
      }}
    >
      {children}
    </AssetPreparationContext.Provider>
  );
}

export function useAssetPreparation() {
  const state = useContext(AssetPreparationContext);
  if (!state) throw new Error("AssetPreparationProvider is required");
  return state;
}
