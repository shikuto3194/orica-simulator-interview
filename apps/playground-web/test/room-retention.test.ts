import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanupExpiredRooms,
  roomExpiresAt,
  startRoomCleanup,
  type RoomPresenceRow,
} from "../server/room-retention";

const now = Date.parse("2026-09-20T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
function room(overrides: Partial<RoomPresenceRow> = {}): RoomPresenceRow {
  return {
    id: "oldroom",
    created_at: ago(86_400_000),
    state_version: 0,
    connected: { alice: true },
    last_heartbeat: {},
    all_disconnected_at: null,
    ...overrides,
  };
}
afterEach(() => vi.useRealTimers());

it("expires silent/crashed rooms, including legacy rooms that never sent heartbeat", () => {
  expect(roomExpiresAt(room())).toBeLessThan(now);
  expect(roomExpiresAt(room({ last_heartbeat: { alice: ago(645_000) } }))).toBe(
    now
  );
  expect(
    roomExpiresAt(room({ last_heartbeat: { alice: ago(644_999) } }))
  ).toBeGreaterThan(now);
  expect(roomExpiresAt(room({ created_at: ago(1_000) }))).toBeGreaterThan(now);
});

it("retains a room while either player is active and grants ten minutes after explicit leave", () => {
  expect(
    roomExpiresAt(
      room({ last_heartbeat: { alice: ago(3_600_000), bob: ago(10_000) } })
    )
  ).toBeGreaterThan(now);
  expect(roomExpiresAt(room({ all_disconnected_at: ago(600_000) }))).toBe(now);
  expect(
    roomExpiresAt(room({ all_disconnected_at: ago(599_999) }))
  ).toBeGreaterThan(now);
  expect(
    roomExpiresAt(room({ last_heartbeat: { alice: "invalid" } }))
  ).toBeNull();
});

it("pages past the API row limit and conditionally deletes only unchanged expired rows", async () => {
  const rows = Array.from({ length: 101 }, (_, i) =>
    room({ id: `room${String(i).padStart(3, "0")}` })
  );
  rows[0]!.last_heartbeat = { alice: ago(1_000) };
  const deleted: string[] = [];
  const pages: string[] = [];
  const client = createClient("https://example.supabase.co", "test-key", {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === "DELETE") {
          const id = url.searchParams.get("id")!.slice(3);
          // A heartbeat/rejoin racing the sweep changes the JSON value in the DB.
          const row = rows.find((r) => r.id === id)!;
          if (id === "room001") row.last_heartbeat = { alice: ago(0) };
          expect(url.searchParams.get("created_at")).toBe(
            `eq.${row.created_at}`
          );
          expect(url.searchParams.get("state_version")).toBe("eq.0");
          expect(url.searchParams.get("connected")).toBe(
            `eq.${JSON.stringify(row.connected)}`
          );
          expect(url.searchParams.get("all_disconnected_at")).toBe("is.null");
          if (
            url.searchParams.get("last_heartbeat") ===
            `eq.${JSON.stringify(row.last_heartbeat)}`
          )
            deleted.push(id);
          return new Response(null, { status: 204 });
        }
        expect(url.searchParams.get("select")).not.toContain("state,");
        expect(url.searchParams.get("order")).toBe("id.asc");
        const after = url.searchParams.get("id")?.slice(3) ?? "";
        pages.push(after);
        return Response.json(
          rows
            .filter((r) => r.id > after)
            .slice(0, Number(url.searchParams.get("limit")))
        );
      },
    },
  });
  await cleanupExpiredRooms(client, now);
  expect(pages).toEqual(["", "room099"]);
  expect(deleted).toHaveLength(99);
  expect(deleted).not.toContain("room000");
  expect(deleted).not.toContain("room001");
  expect(deleted).toContain("room100");
});

it("runs without incoming requests, avoids overlapping sweeps, reports errors and stops", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const run = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
    .mockRejectedValueOnce(new Error("database unavailable"))
    .mockResolvedValue(undefined);
  const report = vi.fn();
  const stop = startRoomCleanup(run, report);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(report).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run).toHaveBeenCalledTimes(3);
});
