import { useCallback } from "react";
import { useAuth } from "../AuthContext";
import { apiUrl } from "../apiUrl";
import { AuthSessionUnavailableError, fetchWithAuthRetry } from "../authFetch";
import { userFacingError } from "../utils/user-facing-error";

export function useInvitationRequest() {
  const { getAccessToken, refreshAccessToken } = useAuth();
  return useCallback(
    async <T>(path = "", init?: RequestInit): Promise<T> => {
      try {
        const response = await fetchWithAuthRetry(
          apiUrl(`/api/room-invitations${path}`),
          init,
          { getAccessToken, refreshAccessToken }
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            userFacingError(data.error, "招待の処理に失敗しました")
          );
        return data as T;
      } catch (error) {
        if (error instanceof AuthSessionUnavailableError)
          throw new Error("ログインし直してから再試行してください", {
            cause: error,
          });
        throw error;
      }
    },
    [getAccessToken, refreshAccessToken]
  );
}
