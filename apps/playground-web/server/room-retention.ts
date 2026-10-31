import type { SupabaseClient } from "@supabase/supabase-js";

export const ROOM_RETENTION_MS = 10 * 60_000;
export const ROOM_DISCONNECT_TIMEOUT_MS = 45_000;
const CLEANUP_INTERVAL_MS = 60_000;
const PAGE_SIZE = 100;

export interface RoomPresenceRow {
  id: string;
  created_at: string;
  state_version: number;
  connected: Record<string, boolean>;
  last_heartbeat: Record<string, string>;
  all_disconnected_at: string | null;
}

/** Missing heartbeat on legacy/never-entered rooms falls back to creation time. */
export function roomExpiresAt(room: RoomPresenceRow): number | null {
  const activity = [
    room.created_at,
    ...Object.values(room.last_heartbeat ?? {}),
  ].map(Date.parse);
  if (activity.some((time) => !Number.isFinite(time))) return null;
  const lastActivity = Math.max(...activity);
  if (room.all_disconnected_at !== null) {
    const disconnected = Date.parse(room.all_disconnected_at);
    if (!Number.isFinite(disconnected)) return null;
    // A newer heartbeat must win over an older disconnect record.
    if (disconnected >= lastActivity) return disconnected + ROOM_RETENTION_MS;
  }
  return lastActivity + ROOM_DISCONNECT_TIMEOUT_MS + ROOM_RETENTION_MS;
}

/** Metadata only, keyset pagination, and compare-and-delete against reconnect races. */
export async function cleanupExpiredRooms(
  db: SupabaseClient,
  now = Date.now()
): Promise<void> {
  let after = "";
  for (;;) {
    let query = db
      .from("rooms")
      .select(
        "id,created_at,state_version,connected,last_heartbeat,all_disconnected_at"
      )
      .order("id")
      .limit(PAGE_SIZE);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`Room cleanup read failed: ${error.message}`);
    const rows = (data ?? []) as RoomPresenceRow[];
    for (const room of rows) {
      const expiresAt = roomExpiresAt(room);
      if (expiresAt === null || expiresAt > now) continue;
      let deletion = db
        .from("rooms")
        .delete()
        .eq("id", room.id)
        .eq("created_at", room.created_at)
        .eq("state_version", room.state_version)
        .eq("connected", JSON.stringify(room.connected))
        .eq("last_heartbeat", JSON.stringify(room.last_heartbeat));
      deletion =
        room.all_disconnected_at === null
          ? deletion.is("all_disconnected_at", null)
          : deletion.eq("all_disconnected_at", room.all_disconnected_at);
      const { error: deleteError } = await deletion;
      if (deleteError)
        throw new Error(`Room cleanup delete failed: ${deleteError.message}`);
    }
    if (rows.length < PAGE_SIZE) return;
    after = rows.at(-1)!.id;
  }
}

/** The first minute lets pre-upgrade lobbies renew before the first sweep. */
export function startRoomCleanup(
  run: () => Promise<void>,
  report: (error: unknown) => void = (error) =>
    console.error("[room-cleanup]", error)
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (error) {
      report(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
