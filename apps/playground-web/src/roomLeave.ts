import { apiUrl } from "./apiUrl";

/** Start synchronously so pagehide needs no token-refresh promise before sending. */
export function notifyRoomLeave(
  roomId: string,
  userId: string,
  token: string | null
): Promise<boolean> {
  if (!token) return Promise.resolve(false);
  return fetch(apiUrl(`/api/room/${roomId}/leave`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
    keepalive: true,
    credentials: "omit",
  })
    .then((response) => response.ok)
    .catch(() => false);
}
