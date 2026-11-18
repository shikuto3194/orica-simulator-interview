import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { listUnfinishedRooms } from "../server/room-list";
import { cleanupExpiredRooms, roomExpiresAt } from "../server/room-retention";

it("pages through member-only unfinished metadata without renewing presence, then cleanup still deletes it", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    id: `room${String(i).padStart(3, "0")}`,
    created_at: "2026-09-21T00:00:00Z",
    state_version: i === 0 ? 0 : i,
    players: [
      {
        supabaseUserId: "alice",
        role: i === 0 ? "alice" : "bob",
        deckCardNos: ["secret-deck"],
      },
    ],
    connected: { alice: false },
    last_heartbeat: { alice: "2026-09-21T00:01:00Z" },
    all_disconnected_at: "2026-09-21T00:02:00Z",
  }));
  const before = structuredClone(rows);
  const cursors: Array<string | null> = [];
  const deleted: string[] = [];
  const db = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === "DELETE") {
          deleted.push(url.searchParams.get("id")!.slice(3));
          return new Response(null, { status: 204 });
        }
        expect(init?.method).toBe("GET");
        const isList = url.searchParams.has("players");
        if (isList) {
          expect(url.searchParams.get("players")).toBe(
            'cs.[{"supabaseUserId":"alice"}]'
          );
          expect(url.searchParams.get("state->>gameResult")).toBe("is.null");
          expect(url.searchParams.get("select")).toBe(
            "id,created_at,state_version,players,connected"
          );
          cursors.push(url.searchParams.get("id"));
        }
        const after = url.searchParams.get("id")?.slice(3) ?? "";
        return Response.json(
          rows
            .filter((r) => r.id > after)
            .slice(0, Number(url.searchParams.get("limit")))
        );
      },
    },
  });
  const rooms = await listUnfinishedRooms(
    db,
    "alice",
    (roomId) => roomId === "room000"
  );
  expect(rooms).toHaveLength(101);
  expect(rooms[0]).toEqual({
    roomId: "room000",
    role: "alice",
    createdAt: rows[0]!.created_at,
    gameStarted: false,
    playerCount: 1,
    isVacant: false,
  });
  expect(rooms[100]?.role).toBe("bob");
  expect(rooms[100]?.gameStarted).toBe(true);
  expect(JSON.stringify(rooms)).not.toContain("secret-deck");
  expect(JSON.stringify(rooms)).not.toContain("supabaseUserId");
  await listUnfinishedRooms(db, "alice");
  expect(cursors).toEqual([null, "gt.room099", null, "gt.room099"]);
  expect(rows).toEqual(before);
  expect(roomExpiresAt(rows[0]!)).toBe(Date.parse("2026-09-21T00:12:00Z"));
  await cleanupExpiredRooms(db, Date.parse("2026-09-21T00:12:00Z"));
  expect(deleted).toHaveLength(101);
});

it("does not report a database failure as an empty list or leak database details", async () => {
  const db = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async () =>
        Response.json({ message: "private database detail" }, { status: 403 }),
    },
  });
  await expect(listUnfinishedRooms(db, "alice")).rejects.toThrow(
    "ルーム一覧の取得に失敗しました"
  );
});
