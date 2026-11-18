import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Connect } from "vite";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { initializeGame, randomDeck, type GameState } from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { createApiServer } from "../server/http-server";
import {
  registerGameApiMiddlewares,
  __setAuthVerifierForTest,
  mutationFingerprint,
} from "../server/game-api";

const db = vi.hoisted(() => ({
  room: {} as Record<string, unknown>,
  readSnapshots: [] as Record<string, unknown>[],
  commits: [] as Record<string, unknown>[],
  readError: null as { code: string } | null,
  commitError: null as { code: string } | null,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: db.readError
              ? null
              : structuredClone(db.readSnapshots.shift() ?? db.room),
            error: db.readError,
          }),
          eq: (_field: string, mutationId: string) => ({
            limit: () => ({
              maybeSingle: async () => ({
                data:
                  table === "replay_events"
                    ? (() => {
                        const index = db.commits.findIndex(
                          (entry) => entry.p_client_mutation_id === mutationId
                        );
                        return index < 0
                          ? null
                          : {
                              state_version: 6 + index,
                              acting_player_id:
                                db.commits[index].p_acting_player_id,
                              payload: db.commits[index].p_payload,
                            };
                      })()
                    : null,
              }),
            }),
          }),
        }),
      }),
      delete: () => ({ not: () => ({ lt: async () => ({ error: null }) }) }),
      insert: async () => ({ error: null }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "lookup_room_mutation") {
        const index = db.commits.findIndex(
          (entry) => entry.p_client_mutation_id === args.p_id
        );
        const entry = db.commits[index];
        return Promise.resolve({
          data: index < 0 ? null : index + 6,
          error:
            entry &&
            (entry.p_acting_player_id !== args.p_actor ||
              entry.p_endpoint !== args.p_endpoint ||
              (entry.p_payload as Record<string, unknown>)
                .requestFingerprint !== args.p_fingerprint)
              ? { code: "22023" }
              : null,
        });
      }
      return {
        single: async () => {
          if (db.commitError) return { data: null, error: db.commitError };
          const prior = db.commits.findIndex(
            (entry) => entry.p_client_mutation_id === args.p_client_mutation_id
          );
          if (prior >= 0)
            return {
              data: { ok: true, new_version: prior + 6, duplicate: true },
              error: null,
            };
          if (db.room.state_version !== args.p_expected_version)
            return {
              data: { ok: false, current_version: db.room.state_version },
            };
          db.commits.push(args);
          db.room.state = args.p_state;
          db.room.state_version = Number(db.room.state_version) + 1;
          return {
            data: {
              ok: true,
              new_version: db.room.state_version,
              duplicate: false,
            },
            error: null,
          };
        },
      };
    },
  }),
}));
let server: Server;
let base: string;
let aliceCards: string[];
let bobCards: string[];
beforeEach(async () => {
  const aliceDeck = randomDeck(ALL_CARDS, 44);
  const bobDeck = randomDeck(ALL_CARDS, 40);
  aliceCards = aliceDeck.map((card) => card.cardNo).sort();
  bobCards = bobDeck.map((card) => card.cardNo).sort();
  const state = initializeGame({
    decks: [aliceDeck, bobDeck],
    skipPreGame: true,
  });
  state.gameResult = {
    kind: "player_loss",
    losingPlayerId: "bob",
    reason: "life_zero",
  };
  db.room = {
    id: "rematch",
    created_at: new Date().toISOString(),
    state,
    state_version: 5,
    players: [
      { role: "alice", supabaseUserId: "user-alice", deckCardNos: aliceCards },
      { role: "bob", supabaseUserId: "user-bob", deckCardNos: bobCards },
    ],
    connected: { "user-alice": true, "user-bob": true },
    last_heartbeat: {},
    all_disconnected_at: null,
    spectator_mode: "public_link",
  };
  db.commits = [];
  db.readSnapshots = [];
  db.readError = null;
  db.commitError = null;
  __setAuthVerifierForTest(async (token) => ({
    userId: token,
    tokenExpiresAtMs: Date.now() + 60_000,
  }));
  const stack: Connect.NextHandleFunction[] = [];
  registerGameApiMiddlewares((middleware) => stack.push(middleware));
  server = createApiServer(new Set(["https://site.netlify.app"]), stack);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  __setAuthVerifierForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const rematch = (token = "user-alice", expectedVersion = 5) =>
  fetch(`${base}/api/room/rematch/rematch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientMutationId: randomUUID(),
      expectedVersion,
      deckCardNos: ["untrusted"],
    }),
  });
it.each([
  "action",
  "step",
  "claim-victory",
  "core-move",
  "brave-separation",
  "pregame-update",
  "rematch",
  "reset-request",
  "reset-response",
])("%s rejects malformed wire metadata before any commit", async (path) => {
  for (const payload of [
    null,
    { expectedVersion: "5" },
    { expectedVersion: 5, clientMutationId: 123 },
  ]) {
    const response = await fetch(`${base}/api/room/rematch/${path}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer user-alice",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(400);
    expect(db.commits).toHaveLength(0);
  }
});
it("restarts both players with their exact registered decks and a replayable checkpoint", async () => {
  expect((await rematch()).status).toBe(200);
  const state = db.room.state as GameState;
  expect(state.gameResult).toBeNull();
  expect(state.preGame).not.toBeNull();
  expect(
    state.cardInstances
      .filter((card) => card.ownerPlayerId === "alice")
      .map((card) => card.definitionId)
      .sort()
  ).toEqual(aliceCards);
  expect(
    state.cardInstances
      .filter((card) => card.ownerPlayerId === "bob")
      .map((card) => card.definitionId)
      .sort()
  ).toEqual(bobCards);
  expect(db.commits).toHaveLength(1);
  expect(db.commits[0]?.p_endpoint).toBe("replay-restore");
  expect((db.commits[0]?.p_payload as { state: GameState }).state).toEqual(
    state
  );
  expect((await rematch("user-bob")).status).toBe(409);
  expect(db.commits).toHaveLength(1);
});
it("rejects outsiders, active games and stale requests without mutating the game", async () => {
  expect((await rematch("outsider")).status).toBe(403);
  expect((await rematch("user-alice", 4)).status).toBe(409);
  (db.room.state as GameState).gameResult = null;
  expect((await rematch()).status).toBe(409);
  expect(db.commits).toHaveLength(0);
});

const reset = (
  endpoint: "reset-request" | "reset-response",
  token = "user-alice",
  extra: Record<string, unknown> = {}
) =>
  fetch(`${base}/api/room/rematch/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientMutationId: randomUUID(),
      expectedVersion: db.room.state_version,
      ...extra,
    }),
  });

it("consumes one request per player, persists rejection and resets both rights only on approval", async () => {
  (db.room.state as GameState).gameResult = null;
  const original = structuredClone(db.room.state as GameState);
  expect(
    (await reset("reset-request", "user-alice", { playerId: "bob" })).status
  ).toBe(200);
  expect(db.room.state).toMatchObject({
    ...original,
    roomReset: { gameNumber: 0, requestedBy: "alice", usedBy: ["alice"] },
  });
  expect((await reset("reset-request")).status).toBe(409);
  expect(
    (await reset("reset-response", "user-alice", { approve: true })).status
  ).toBe(403);
  expect(
    (await reset("reset-response", "user-bob", { approve: false })).status
  ).toBe(200);
  expect((await reset("reset-request")).status).toBe(409);
  expect((db.room.state as GameState).roomReset).toEqual({
    gameNumber: 0,
    requestedBy: null,
    usedBy: ["alice"],
  });
  expect((await reset("reset-request", "user-bob")).status).toBe(200);
  expect(
    (
      await reset("reset-response", "user-alice", {
        approve: true,
        deckCardNos: ["untrusted"],
      })
    ).status
  ).toBe(200);
  const next = db.room.state as GameState;
  expect(["waiting_janken", "waiting_contract"]).toContain(next.preGame?.phase);
  expect(next.roomReset).toEqual({
    gameNumber: 1,
    requestedBy: null,
    usedBy: [],
  });
  for (const [player, cards] of [
    ["alice", aliceCards],
    ["bob", bobCards],
  ] as const) {
    expect(
      next.cardInstances
        .filter((card) => card.ownerPlayerId === player)
        .map((card) => card.definitionId)
        .sort()
    ).toEqual(cards);
  }
  expect(db.commits).toHaveLength(4);
  expect(db.commits[3]?.p_endpoint).toBe("replay-restore");
  expect((await reset("reset-request")).status).toBe(200);
});

it("restores both reset rights on the existing result rematch path", async () => {
  (db.room.state as GameState).roomReset = {
    gameNumber: 3,
    requestedBy: "bob",
    usedBy: ["alice", "bob"],
  };
  expect((await rematch()).status).toBe(200);
  expect((db.room.state as GameState).roomReset).toEqual({
    gameNumber: 4,
    requestedBy: null,
    usedBy: [],
  });
  expect((await reset("reset-request", "user-bob")).status).toBe(200);
});

it("rejects outsiders, ended games, missing requests, invalid responses and stale approvals without a write", async () => {
  expect((await reset("reset-request", "outsider")).status).toBe(403);
  expect((await reset("reset-request")).status).toBe(409);
  (db.room.state as GameState).gameResult = null;
  expect(
    (await reset("reset-response", "user-bob", { approve: true })).status
  ).toBe(409);
  expect(
    (await reset("reset-request", "user-alice", { expectedVersion: 4 })).status
  ).toBe(409);
  expect(db.commits).toHaveLength(0);
  expect((await reset("reset-request")).status).toBe(200);
  expect(
    (await reset("reset-response", "user-bob", { approve: "true" })).status
  ).toBe(400);
  expect(
    (
      await reset("reset-response", "user-bob", {
        approve: true,
        expectedVersion: 5,
      })
    ).status
  ).toBe(409);
  expect(db.commits).toHaveLength(1);
});

it("retries the same request and approval without consuming twice or restarting twice", async () => {
  (db.room.state as GameState).gameResult = null;
  const request = { expectedVersion: 5, clientMutationId: "request-1" };
  expect((await reset("reset-request", "user-alice", request)).status).toBe(
    200
  );
  expect((await reset("reset-request", "user-alice", request)).status).toBe(
    200
  );
  const approve = {
    approve: true,
    expectedVersion: 6,
    clientMutationId: "approve-1",
  };
  expect((await reset("reset-response", "user-bob", approve)).status).toBe(200);
  expect((await reset("reset-response", "user-bob", approve)).status).toBe(200);
  expect(db.commits).toHaveLength(2);
  expect((db.room.state as GameState).roomReset?.gameNumber).toBe(1);
});

it("database outages return retryable 503 and request ID, while missing rooms remain 404", async () => {
  db.readError = { code: "08006" };
  const unavailable = await rematch();
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get("Retry-After")).toBe("1");
  expect(unavailable.headers.get("X-Request-ID")).toBeTruthy();
  expect(await unavailable.json()).toMatchObject({
    code: "ROOM_READ_UNAVAILABLE",
    requestId: unavailable.headers.get("X-Request-ID"),
  });
  expect(db.commits).toHaveLength(0);
  db.readError = { code: "PGRST116" };
  expect((await rematch()).status).toBe(404);
});

it("an unavailable atomic RPC fails closed without changing state or recording a separate event", async () => {
  db.commitError = { code: "PGRST202" };
  const before = structuredClone(db.room);
  const result = await rematch();
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({
    code: "ROOM_SCHEMA_UNAVAILABLE",
  });
  expect(db.room).toEqual(before);
  expect(db.commits).toHaveLength(0);
});

it("a duplicate lookup racing the original commit never acknowledges an older snapshot", async () => {
  (db.room.state as GameState).gameResult = null;
  const before = structuredClone(db.room);
  const operation = { expectedVersion: 5, clientMutationId: "race-ack" };
  expect((await reset("reset-request", "user-alice", operation)).status).toBe(
    200
  );
  db.readSnapshots.push(before);
  const duplicate = await reset("reset-request", "user-alice", operation);
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toMatchObject({
    duplicate: true,
    duplicateVersion: 6,
    version: 6,
  });
  expect(db.commits).toHaveLength(1);
});

// A committed action can become illegal in the new state. Recovery must use its
// recorded identity before attempting to execute it against that new state.
it.each(["action", "core-move"] as const)(
  "%s retry recovers a committed operation even when the current state rejects it",
  async (path) => {
    const state = db.room.state as GameState;
    state.gameResult = null;
    state.activePlayerId = "alice";
    state.step = "main";
    db.room.state_version = 6;
    const actor = path === "action" ? "bob" : "alice";
    const payload =
      path === "action"
        ? { actionId: "previously-legal-action" }
        : {
            coreMoveDrafts: [
              {
                kind: "normal",
                from: { kind: "card", instanceId: "previously-present-card" },
                to: { kind: "reserve", playerId: "alice" },
                amount: 1,
                purpose: "core_move",
              },
            ],
          };
    const body = {
      ...payload,
      expectedVersion: 5,
      clientMutationId: randomUUID(),
    };
    db.commits.push({
      p_client_mutation_id: body.clientMutationId,
      p_acting_player_id: actor,
      p_endpoint: path,
      p_payload: {
        requestFingerprint: mutationFingerprint(
          body,
          `/api/room/rematch/${path}`
        ),
      },
    });
    const before = structuredClone(state);
    const post = (input: Record<string, unknown>) =>
      fetch(`${base}/api/room/rematch/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer user-${actor}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
    const recovered = await post(body);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({
      duplicate: true,
      duplicateVersion: 6,
      version: 6,
    });
    expect(db.commits).toHaveLength(1);
    expect(db.room.state).toEqual(before);
    // A new operation with the same now-invalid payload must still be rejected.
    const fresh = await post({
      ...payload,
      expectedVersion: 6,
      clientMutationId: randomUUID(),
    });
    expect(fresh.status).toBe(path === "action" ? 403 : 400);
    expect(db.commits).toHaveLength(1);
    expect(db.room.state).toEqual(before);
  }
);
