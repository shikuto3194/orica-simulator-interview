import { useLayoutEffect } from "react";
import { allowAppReload } from "../app-updates";

export function useAppReloadBoundary(allowed: boolean) {
  useLayoutEffect(() => {
    if (allowed) return allowAppReload();
  }, [allowed]);
}
