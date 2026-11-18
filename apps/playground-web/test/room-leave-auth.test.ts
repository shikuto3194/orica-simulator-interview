import type { Server } from "node:http";
import type { Connect } from "vite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApiServer } from "../server/http-server";
import {
  registerGameApiMiddlewares,
  __setAuthVerifierForTest,
  __resetSSEConnectionsForTest,
} from "../server/game-api";

const db = vi.hoisted(() => ({
  room: {
    id: "room1",
    created_at: "2026-09-21T00:00:00Z",
    state: null,
    state_version: 0,
    last_heartbeat: {} as Record<string, string>,
    spectator_mode: "private",
    players: [
      { supabaseUserId: "alice", role: "alice" },
      { supabaseUserId: "bob", role: "bob" },
    ],
    connected: { alice: true, bob: true },
    all_disconnected_at: null as string | null,
  },
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        contains: () => ({
          is: () => ({
            order: () => ({ limit: async () => ({ data: [db.room] }) }),
          }),
        }),
        eq: () => ({
          single: async () => {
            await db.read();
            return { data: db.room };
          },
        }),
      }),
      update: (updates: object) => ({
        eq: async () => {
          db.write(updates);
          Object.assign(db.room, updates);
          return { error: null };
        },
      }),
      delete: () => ({
        not: () => ({ lt: async () => ({ error: null }) }),
        eq: async (_column: string, roomId: string) => {
          db.remove(roomId);
          return { error: null };
        },
      }),
    }),
  }),
}));
let server: Server;
let base: string;
beforeEach(async () => {
  __resetSSEConnectionsForTest();
  db.room.connected = { alice: true, bob: true };
  db.room.all_disconnected_at = null;
  db.room.last_heartbeat = {};
  db.room.spectator_mode = "private";
  db.read.mockClear();
  db.write.mockClear();
  db.remove.mockClear();
  __setAuthVerifierForTest(async (token) => {
    if (token === "invalid") return null;
    return {
      userId: token,
      tokenExpiresAtMs: token === "expired" ? 1 : Date.now() + 60_000,
    };
  });
  const stack: Connect.NextHandleFunction[] = [];
  registerGameApiMiddlewares((middleware) => stack.push(middleware));
  server = createApiServer(new Set(["https://site.netlify.app"]), stack);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  __resetSSEConnectionsForTest();
  __setAuthVerifierForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function leave(userId: string, token?: string) {
  return fetch(`${base}/api/room/room1/leave`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ userId }),
  });
}
function deleteRoom(token?: string) {
  return fetch(`${base}/api/room/room1`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
it("does not register an SSE transport closed while the room read was pending", async () => {
  db.room.connected = { alice: false, bob: false };
  let releaseRead!: () => void;
  let readStarted!: () => void;
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const started = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  db.read.mockImplementationOnce(async () => {
    readStarted();
    await heldRead;
  });
  const closed = new Promise<void>((resolve) => {
    server.once("request", (_req, res) => res.once("close", resolve));
  });
  const controller = new AbortController();
  const stream = fetch(`${base}/api/room/room1/events`, {
    headers: { Authorization: "Bearer alice" },
    signal: controller.signal,
  }).catch(() => null);
  try {
    await started;
    controller.abort();
    await closed;
  } finally {
    releaseRead();
  }
  await stream;
  expect((await deleteRoom("alice")).status).toBe(200);
});

it("releases an established SSE transport when its response closes", async () => {
  db.room.connected = { alice: false, bob: false };
  const closed = new Promise<void>((resolve) => {
    server.once("request", (_req, res) => res.once("close", resolve));
  });
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/room/room1/events`, {
    headers: { Authorization: "Bearer alice" },
    signal: controller.signal,
  });
  expect(stream.status).toBe(200);
  expect((await deleteRoom("alice")).status).toBe(409);
  controller.abort();
  await closed;
  expect((await deleteRoom("alice")).status).toBe(200);
});
it("requires authentication for discovery and repeated discovery never connects or renews a room", async () => {
  const list = (token?: string) =>
    fetch(`${base}/api/room`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  for (const token of [undefined, "invalid", "expired"])
    expect((await list(token)).status).toBe(401);
  db.room.connected = { alice: false, bob: false };
  db.room.all_disconnected_at = "2026-09-21T00:01:00Z";
  const before = structuredClone(db.room);
  for (const token of ["alice", "alice", "bob"]) {
    const response = await list(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      rooms: [
        {
          roomId: "room1",
          role: token,
          createdAt: db.room.created_at,
          gameStarted: false,
          playerCount: 2,
          isVacant: true,
        },
      ],
    });
  }
  expect(await (await list("outsider")).json()).toEqual({ rooms: [] });
  expect(db.room).toEqual(before);
  expect(db.read).not.toHaveBeenCalled();
  expect(db.write).not.toHaveBeenCalled();
});
it("rejects absent, forged and expired tokens before reading or modifying the room", async () => {
  for (const token of [undefined, "invalid", "expired"])
    expect((await leave("alice", token)).status).toBe(401);
  expect(db.read).not.toHaveBeenCalled();
  expect(db.write).not.toHaveBeenCalled();
});
it("lets only the room creator delete a vacant unfinished room", async () => {
  expect((await deleteRoom("bob")).status).toBe(403);
  expect(db.remove).not.toHaveBeenCalled();
  expect((await deleteRoom("alice")).status).toBe(409);
  db.room.connected = { alice: false, bob: false };
  expect((await deleteRoom("alice")).status).toBe(200);
  expect(db.remove).toHaveBeenCalledWith("room1");
});
it("rejects another participant's identity and non-members without mutating connectivity", async () => {
  expect((await leave("alice", "bob")).status).toBe(403);
  expect((await leave("outsider", "outsider")).status).toBe(403);
  expect(db.write).not.toHaveBeenCalled();
  expect(db.room.connected).toEqual({ alice: true, bob: true });
});
it("allows only the token owner to leave, remains idempotent, and marks the last disconnect", async () => {
  expect((await leave("alice", "alice")).status).toBe(200);
  expect(db.room.connected).toEqual({ alice: false, bob: true });
  expect(db.room.all_disconnected_at).toBeNull();
  expect((await leave("alice", "alice")).status).toBe(200);
  expect((await leave("bob", "bob")).status).toBe(200);
  expect(db.room.connected).toEqual({ alice: false, bob: false });
  expect(db.room.all_disconnected_at).toEqual(expect.any(String));
  const firstDisconnect = db.room.all_disconnected_at;
  await leave("bob", "bob");
  expect(db.room.all_disconnected_at).toBe(firstDisconnect);
});

it("lobby polling renews only a connected authenticated member and throttles writes", async () => {
  const read = (token?: string) =>
    fetch(`${base}/api/room/room1`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  expect((await read("alice")).status).toBe(200);
  expect(Date.parse(db.room.last_heartbeat.alice!)).toBeGreaterThan(
    Date.now() - 10_000
  );
  expect(db.room.last_heartbeat.bob).toBeUndefined();
  db.write.mockClear();
  await read("alice");
  expect(db.write).not.toHaveBeenCalled();
  await leave("alice", "alice");
  db.write.mockClear();
  db.room.last_heartbeat = {};
  await read("alice");
  expect(db.write).not.toHaveBeenCalled();
  db.room.spectator_mode = "public_link";
  await read();
  await read("outsider");
  expect(db.write).not.toHaveBeenCalled();
});
