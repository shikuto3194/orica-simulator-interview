import { isRoomVersion, parseRoomMutationId } from "../shared/room-protocol";
export interface PendingRoomMutation {
  path: string;
  payload: Record<string, unknown>;
  id: string;
  version: number;
  retryAt: number;
  uncertain?: boolean;
}
const paths = new Set([
  "action",
  "step",
  "claim-victory",
  "core-move",
  "brave-separation",
  "pregame-update",
  "rematch",
  "reset-request",
  "reset-response",
]);
export function readPendingMutation(
  key: string | null
): PendingRoomMutation | null {
  if (!key) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      !value ||
      !paths.has(value.path) ||
      typeof value.id !== "string" ||
      parseRoomMutationId(value.id) !== value.id ||
      !isRoomVersion(value.version) ||
      !value.payload ||
      typeof value.payload !== "object" ||
      Array.isArray(value.payload) ||
      !Number.isFinite(value.retryAt)
    )
      return null;
    return { ...value, uncertain: true };
  } catch {
    return null;
  }
}
export function writePendingMutation(
  key: string | null,
  value: PendingRoomMutation | null
): void {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* Memory still protects the active tab when storage is unavailable. */
  }
}
