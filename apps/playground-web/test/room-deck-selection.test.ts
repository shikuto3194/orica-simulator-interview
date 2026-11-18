import type { Server } from "node:http";
import type { Connect } from "vite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApiServer } from "../server/http-server";
import {
  registerGameApiMiddlewares,
  __setAuthVerifierForTest,
} from "../server/game-api";
import { createLegalMainDeckCardNos } from "../../../e2e/legal-main-deck";

const fixture = vi.hoisted(() => ({
  room: {} as Record<string, unknown>,
  rpc: vi.fn(),
  staleStart: false,
  startFilters: [] as unknown[],
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: fixture.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: structuredClone(fixture.room) }),
        }),
      }),
      update: (updates: object) => {
        const chain = {
          eq: (...args: unknown[]) => {
            fixture.startFilters.push(args);
            return chain;
          },
          is: (...args: unknown[]) => {
            fixture.startFilters.push(args);
            return chain;
          },
          select: async () => {
            if (fixture.staleStart) return { data: [], error: null };
            Object.assign(fixture.room, updates);
            return { data: [{ id: "pick01" }], error: null };
          },
          then: (resolve: (value: unknown) => void) => {
            Object.assign(fixture.room, updates);
            resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  }),
}));

let server: Server;
let base: string;
const deck = createLegalMainDeckCardNos();
beforeEach(async () => {
  fixture.room = {
    id: "pick01",
    state: null,
    state_version: 0,
    spectator_mode: "public_link",
    players: [
      { role: "alice", supabaseUserId: "alice", deckCardNos: deck },
      { role: "bob", supabaseUserId: "bob", deckCardNos: [...deck].reverse() },
    ],
    connected: {},
    last_heartbeat: {},
  };
  fixture.staleStart = false;
  fixture.startFilters = [];
  fixture.rpc
    .mockReset()
    .mockResolvedValue({ data: { ok: true, allReady: false }, error: null });
  __setAuthVerifierForTest(async (token) =>
    token === "invalid"
      ? null
      : { userId: token, tokenExpiresAtMs: Date.now() + 60000 }
  );
  const stack: Connect.NextHandleFunction[] = [];
  registerGameApiMiddlewares((middleware) => stack.push(middleware));
  server = createApiServer(new Set(), stack);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/room/pick01`;
});
afterEach(async () => {
  __setAuthVerifierForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const unready = (token = "alice", userId = token) =>
  fetch(`${base}/deck`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
  });
it("clears only the authenticated member through the existing atomic RPC", async () => {
  expect((await unready("invalid")).status).toBe(401);
  expect((await unready("alice", "bob")).status).toBe(403);
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect((await unready()).status).toBe(200);
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("set_room_deck", {
    p_room_id: "pick01",
    p_user_id: "alice",
    p_deck: null,
  });
  fixture.rpc.mockResolvedValueOnce({
    data: { status: 409, error: "対戦は開始済みです" },
    error: null,
  });
  expect((await unready()).status).toBe(409);
  fixture.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "offline" },
  });
  expect((await unready()).status).toBe(500);
});
it("returns only the viewer's registered deck, including no cards for spectators", async () => {
  for (const user of ["alice", "bob", "spectator"]) {
    const response = await fetch(base, {
      headers: { Authorization: `Bearer ${user}` },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ownDeckCardNos).toEqual(
      user === "alice" ? deck : user === "bob" ? [...deck].reverse() : null
    );
    expect(
      data.players.every(
        (player: object) => !Object.hasOwn(player, "deckCardNos")
      )
    ).toBe(true);
  }
});
it("requires unchanged players and an unstarted room to commit the initial game", async () => {
  fixture.staleStart = true;
  fixture.rpc.mockImplementation((name, args) => {
    expect(name).toBe("initialize_room_state");
    fixture.startFilters.push(args.p_expected_players);
    return {
      single: async () => {
        if (fixture.staleStart)
          return { data: { ok: false, current_version: 0 }, error: null };
        fixture.room.state = args.p_state;
        return { data: { ok: true, new_version: 1 }, error: null };
      },
    };
  });
  const start = () =>
    fetch(`${base}/start`, {
      method: "POST",
      headers: { Authorization: "Bearer alice" },
      body: JSON.stringify({
        expectedVersion: 0,
        clientMutationId: "start-one",
      }),
    });
  expect((await start()).status).toBe(409);
  expect(fixture.room.state).toBeNull();
  expect(fixture.startFilters).toContainEqual(fixture.room.players);
  fixture.staleStart = false;
  expect((await start()).status).toBe(200);
  expect(fixture.room.state).not.toBeNull();
});
