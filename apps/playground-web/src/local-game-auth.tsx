import type { ReactNode } from "react";
import { AuthContext } from "./AuthContext";

// Imported through development.ts only. Tokens authorize local seats, never real accounts.
export function LocalGameAuthProvider({ children }: { children: ReactNode }) {
  const roomId = new URLSearchParams(window.location.search).get("localGame");
  const token = roomId
    ? sessionStorage.getItem(`orica.local-game.${roomId}`)
    : null;
  if (!import.meta.env.DEV || !roomId?.startsWith("local-") || !token)
    throw new Error("Local game seat token is missing.");
  return (
    <AuthContext.Provider
      value={{
        user: null,
        profile: null,
        loading: false,
        getAccessToken: async () => token,
        getCachedAccessToken: () => token,
        refreshAccessToken: async () => token,
        signIn: async () => ({ error: new Error("Local game only.") }),
        signOut: async () => {
          sessionStorage.removeItem(`orica.local-game.${roomId}`);
        },
        refreshProfile: async () => {},
        updateProfile: async () => {
          throw new Error("Local game only.");
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
