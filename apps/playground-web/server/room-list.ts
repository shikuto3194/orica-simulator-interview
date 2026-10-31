import type { SupabaseClient } from "@supabase/supabase-js";

export interface UnfinishedRoomSummary {
  roomId: string;
  role: "alice" | "bob";
  createdAt: string;
  gameStarted: boolean;
  playerCount: number;
  /** プレイヤー・観戦者ともに接続していない場合だけ true。 */
  isVacant: boolean;
}

interface ListRow {
  id: string;
  created_at: string;
  state_version: number;
  players: Array<{ supabaseUserId: string; role: "alice" | "bob" }>;
  connected: Record<string, boolean>;
}

/** Discovery is read-only: never renew presence or fetch each room's lobby API. */
export async function listUnfinishedRooms(
  db: SupabaseClient,
  userId: string,
  hasLiveSSEConnection: (roomId: string) => boolean = () => false
): Promise<UnfinishedRoomSummary[]> {
  const rooms: UnfinishedRoomSummary[] = [];
  let cursor: string | null = null;
  const pageSize = 100;
  for (;;) {
    let query = db
      .from("rooms")
      .select("id, created_at, state_version, players, connected")
      .contains("players", JSON.stringify([{ supabaseUserId: userId }]))
      // ->> maps both JSON null and an absent key/state to SQL NULL.
      .is("state->>gameResult", null)
      .order("id")
      .limit(pageSize);
    if (cursor !== null) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("ルーム一覧の取得に失敗しました");
    const rows = (data ?? []) as ListRow[];
    for (const row of rows) {
      const member = row.players.find((p) => p.supabaseUserId === userId);
      if (!member) continue;
      rooms.push({
        roomId: row.id,
        role: member.role,
        createdAt: row.created_at,
        gameStarted: row.state_version > 0,
        playerCount: row.players.length,
        isVacant:
          row.players.every(
            (player) => !row.connected?.[player.supabaseUserId]
          ) && !hasLiveSSEConnection(row.id),
      });
    }
    if (rows.length < pageSize) break;
    cursor = rows.at(-1)!.id;
  }
  return rooms.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.roomId.localeCompare(b.roomId)
  );
}
