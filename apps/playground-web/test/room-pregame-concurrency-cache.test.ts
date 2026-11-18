import type { Server } from "node:http";
import type { Connect } from "vite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GameState } from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { createApiServer } from "../server/http-server";
import {
  registerGameApiMiddlewares,
  __setAuthVerifierForTest,
  __initializeGameApiLookupsForTest,
  __roomRowCacheForTest,
} from "../server/game-api";
import { buildDormantTriggerActorScenario } from "../src/scenario-dormant-trigger-actor";

// 永続化境界だけをfixtureに置き換え、pregame-updateの版競合と部屋行キャッシュを実HTTP経由で検証する。
const db = vi.hoisted(() => ({
  room: {} as Record<string, unknown>,
  fullReads: 0,
  writes: 0,
  settleGate: null as Promise<void> | null,
  settleReached: false,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          single: async () => {
            if (columns === "*") db.fullReads++;
            return { data: structuredClone(db.room) };
          },
          eq: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
      }),
      delete: () => ({ not: () => ({ lt: async () => ({ error: null }) }) }),
      insert: async () => ({ error: null }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => ({
      single: async () => {
        if (name === "settle_room_mutation") {
          db.settleReached = true;
          await db.settleGate;
          return {
            data: {
              outcome: "applied",
              applied_version: 1,
              room_version: db.room.state_version,
            },
            error: null,
          };
        }
        if (db.room.state_version !== args.p_expected_version)
          return {
            data: { ok: false, current_version: db.room.state_version },
          };
        db.writes++;
        db.room.state = structuredClone(args.p_state);
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
    }),
  }),
}));
let server: Server;
let base: string;
function seedRoom(roomId: string) {
  const state = {
    ...buildDormantTriggerActorScenario([...ALL_CARDS], new URLSearchParams()),
    preGame: {
      phase: "waiting_janken",
      firstPlayerId: null,
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: null,
      mulliganDone: {},
    },
  } as unknown as GameState;
  db.room = {
    id: roomId,
    created_at: new Date().toISOString(),
    state,
    state_version: 1,
    players: ["alice", "bob"].map((role) => ({
      role,
      supabaseUserId: `user-${role}`,
      deckCardNos: [],
    })),
    connected: { "user-alice": true, "user-bob": true },
    last_heartbeat: {},
    all_disconnected_at: null,
    spectator_mode: "public_link",
  };
}
function pregame(
  roomId: string,
  role: "alice" | "bob",
  hand: string,
  expectedVersion: number,
  id: string
) {
  return fetch(`${base}/api/room/${roomId}/pregame-update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer user-${role}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      preGame: { jankenHands: { [role]: hand }, jankenRound: 0 },
      expectedVersion,
      clientMutationId: id,
    }),
  });
}
beforeEach(async () => {
  __roomRowCacheForTest.clear();
  db.fullReads = 0;
  db.writes = 0;
  __setAuthVerifierForTest(async (token) => ({
    userId: token,
    tokenExpiresAtMs: Date.now() + 60_000,
  }));
  await __initializeGameApiLookupsForTest(ALL_CARDS);
  const stack: Connect.NextHandleFunction[] = [];
  registerGameApiMiddlewares((middleware) => stack.push(middleware));
  server = createApiServer(new Set(["https://fixture.invalid"]), stack);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  __setAuthVerifierForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("同じ版を見た両者のじゃんけん送信は、後着も409にならず両方の手が記録される", async () => {
  seedRoom("pregameb1");
  const first = await pregame("pregameb1", "alice", "rock", 1, "b1-alice");
  expect(first.status, await first.text()).toBe(200);
  // bobは版1のまま送る（aliceのcommit後なので古い版）。以前は409だった。
  const second = await pregame("pregameb1", "bob", "scissors", 1, "b1-bob");
  expect(second.status, await second.text()).toBe(200);
  expect(db.writes).toBe(2);
  const preGame = (db.room.state as GameState).preGame as unknown as {
    jankenHands: Record<string, string>;
    jankenWinner: string | null;
  };
  expect(preGame.jankenWinner).toBe("alice");
});

it("操作POSTは部屋行を2回目以降キャッシュから読み、全列SELECTを繰り返さない", async () => {
  seedRoom("pregamed1");
  await pregame("pregamed1", "alice", "rock", 1, "d1-alice");
  const readsAfterFirst = db.fullReads;
  expect(readsAfterFirst).toBe(1);
  const second = await pregame("pregamed1", "bob", "scissors", 2, "d1-bob");
  expect(second.status, await second.text()).toBe(200);
  expect(db.fullReads).toBe(readsAfterFirst);
});

it("DBが別経路で進んでいたらcommitのCASが409にし、キャッシュを捨てて次は読み直す", async () => {
  seedRoom("pregamed2");
  await pregame("pregamed2", "alice", "rock", 1, "d2-alice");
  // キャッシュ(版2)の外でDBの版だけが進んだ状態を作る。
  db.room.state_version = 7;
  const stale = await pregame("pregamed2", "bob", "scissors", 2, "d2-bob-1");
  expect(stale.status).toBe(409);
  expect(db.writes).toBe(1);
  const readsBefore = db.fullReads;
  const retry = await pregame("pregamed2", "bob", "scissors", 7, "d2-bob-2");
  expect(retry.status, await retry.text()).toBe(200);
  expect(db.fullReads).toBe(readsBefore + 1);
  expect(db.room.state_version).toBe(8);
});

it("DB読取中に他リクエストが前進したら、古い行はキャッシュへ書き込まれない", async () => {
  seedRoom("cacheepoch");
  const row = structuredClone(db.room) as never;
  const epoch = __roomRowCacheForTest.epoch();
  // 読取中に別リクエストがcommitした（entryが無くても世代は進む）。
  __roomRowCacheForTest.advance(
    "cacheepoch",
    1,
    (row as { state: GameState }).state,
    2
  );
  __roomRowCacheForTest.write(row, epoch);
  expect(__roomRowCacheForTest.read("cacheepoch")).toBeNull();
  // 世代が変わっていなければ書き込まれる。
  __roomRowCacheForTest.write(row, __roomRowCacheForTest.epoch());
  expect(__roomRowCacheForTest.read("cacheepoch")).not.toBeNull();
});

it("キャッシュ由来の部屋で409を返したら、次のリクエストはDBから読み直す", async () => {
  seedRoom("cachefail");
  await pregame("cachefail", "alice", "rock", 1, "f-alice");
  db.room.state_version = 7; // キャッシュ(版2)の外でDBが進んだ
  const stepWith = (version: number, id: string) =>
    fetch(`${base}/api/room/cachefail/step`, {
      method: "POST",
      headers: {
        Authorization: "Bearer user-alice",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedVersion: version, clientMutationId: id }),
    });
  const stale = await stepWith(7, "f-step-1");
  expect(stale.status).toBe(409);
  const readsBefore = db.fullReads;
  await stepWith(7, "f-step-2");
  expect(db.fullReads).toBe(readsBefore + 1);
});

it("開始時だけでなく非キャッシュ書込の完了後も部屋行を破棄する", async () => {
  seedRoom("cacheclose");
  let release!: () => void;
  db.settleReached = false;
  db.settleGate = new Promise<void>((resolve) => (release = resolve));
  const settle = fetch(`${base}/api/room/cacheclose/mutation-settle`, {
    method: "POST",
    headers: {
      Authorization: "Bearer user-alice",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientMutationId: "close-settle",
      path: "pregame-update",
      payload: { preGame: {} },
    }),
  });
  await vi.waitFor(() => expect(db.settleReached).toBe(true));
  // 長い書込の最中に別の操作が部屋行を読み、キャッシュする。
  await pregame("cacheclose", "alice", "rock", 1, "close-alice");
  expect(db.fullReads).toBeGreaterThan(0);
  // 長い書込が完了した結果DBが進み、キャッシュは古くなる。
  db.room.state_version = 9;
  release();
  expect((await settle).status).toBe(200);
  const readsBefore = db.fullReads;
  await pregame("cacheclose", "bob", "scissors", 9, "close-bob");
  expect(db.fullReads).toBe(readsBefore + 1);
  db.settleGate = null;
});

it("部屋行キャッシュは件数上限と期限で掃除され、無制限に増えない", () => {
  const state = (db.room.state ?? {}) as GameState;
  for (let i = 0; i < 200; i++)
    __roomRowCacheForTest.write(
      { id: `bulk-${i}`, state, state_version: 1 } as never,
      __roomRowCacheForTest.epoch()
    );
  expect(__roomRowCacheForTest.size()).toBeLessThanOrEqual(64);
  expect(__roomRowCacheForTest.read("bulk-0")).toBeNull();
  expect(__roomRowCacheForTest.read("bulk-199")).not.toBeNull();
});
