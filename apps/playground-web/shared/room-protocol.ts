/** Wire metadata only. Legality, actors and game outcomes remain server-owned. */
export function isRoomVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Preserve the existing API normalization and 160-character ID limit. */
export function parseRoomMutationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 160 ? id : null;
}

/** Metadata schema. Missing fields remain compatible with existing API clients. */
export function isRoomMutationRequest(
  value: unknown
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    (data.expectedVersion === undefined ||
      isRoomVersion(data.expectedVersion)) &&
    (data.clientMutationId === undefined ||
      parseRoomMutationId(data.clientMutationId) !== null)
  );
}

/** Current mutation endpoints require durable identity and an explicit base. */
export function isStrictRoomMutationRequest(
  value: unknown
): value is Record<string, unknown> {
  return (
    isRoomMutationRequest(value) &&
    isRoomVersion(value.expectedVersion) &&
    parseRoomMutationId(value.clientMutationId) !== null
  );
}

export interface RoomMutationAcknowledgement {
  version: number;
  clientMutationId?: string;
  state?: unknown;
  patch?: unknown;
  baseVersion?: unknown;
}

/** Legacy API responses may omit the ID or state after a durable commit. */
export function isRoomMutationAcknowledgement(
  value: unknown,
  mutationId: string
): value is RoomMutationAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    isRoomVersion(data.version) &&
    (data.clientMutationId === undefined ||
      data.clientMutationId === mutationId)
  );
}

export function isSequentialRoomPatch(
  version: unknown,
  baseVersion: unknown,
  currentVersion: number
): boolean {
  return (
    isRoomVersion(version) &&
    baseVersion === currentVersion &&
    version === currentVersion + 1
  );
}
