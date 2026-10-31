import type { Server } from "node:http";
import type { Connect } from "vite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLegalActions, type GameState } from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { createApiServer } from "../server/http-server";
import {
  registerGameApiMiddlewares,
  __setAuthVerifierForTest,
  __initializeGameApiLookupsForTest,
} from "../server/game-api";
import { buildDormantTriggerActorScenario } from "../src/scenario-dormant-trigger-actor";
import { buildEngine } from "./selfplay-driver";

// 永続化境界だけをローカルfixtureに置き換え、実ルーム/actionの認証・操作権gateを通す。
const db = vi.hoisted(() => ({
  room: {} as Record<string, unknown>,
  writes: 0,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: db.room }),
          eq: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
      }),
      delete: () => ({ not: () => ({ lt: async () => ({ error: null }) }) }),
      insert: async () => ({ error: null }),
    }),
    rpc: (_name: string, args: Record<string, unknown>) => ({
      single: async () => {
        if (db.room.state_version !== args.p_expected_version)
          return {
            data: { ok: false, current_version: db.room.state_version },
          };
        db.writes++;
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
    }),
  }),
}));
let server: Server;
let base: string;
beforeEach(async () => {
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
it.each(["alice", "bob"])(
  "%sの有効な非ターン側誘発をルームAPIが403拒否せず処理する",
  async (owner) => {
    const state = buildDormantTriggerActorScenario(
      [...ALL_CARDS],
      new URLSearchParams({ owner })
    );
    db.room = {
      id: "dormantactor",
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
    const engine = buildEngine();
    const action = getLegalActions({
      state,
      actingPlayerId: owner,
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }).find((a) => a.can)!;
    expect(action.kind).toBe("resolve_pending_triggered_effect");
    const response = await fetch(`${base}/api/room/dormantactor/action`, {
      method: "POST",
      headers: {
        Authorization: `Bearer user-${owner}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actionId: action.actionId,
        expectedVersion: 1,
        clientMutationId: `dormant-${owner}`,
        skipOptionalEffect: true,
      }),
    });
    expect(response.status, await response.text()).toBe(200);
    expect(db.writes).toBe(1);
    const done = db.room.state as GameState;
    expect(done.pendingTriggeredEffects).toEqual([]);
    expect(done.pendingAfterTriggersContinuations).toEqual([]);
    expect(done.cardInstances.every((c) => c.zone === "trash")).toBe(true);
  }
);
