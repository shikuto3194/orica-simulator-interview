import { describe, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { cleanupInvitationTestResources } from "../../../e2e/room-invitations-cleanup";

function fixture(failures: string[] = []) {
  const calls: string[] = [];
  const users = new Set(["alice", "bob"]);
  // profiles has no foreign key to auth.users: deleting Auth alone leaves it.
  const profiles = new Set(users);
  const rooms = new Set(["room"]);
  const perform = (key: string, effect: () => void) => {
    calls.push(key);
    if (failures.includes(key)) return { error: new Error(key) };
    effect();
    return { error: null };
  };
  const admin = {
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, id: string) => {
          expect(column).toBe(table === "profiles" ? "user_id" : "id");
          return perform(`${table}:${id}`, () =>
            (table === "profiles" ? profiles : rooms).delete(id)
          );
        },
      }),
    }),
    auth: {
      admin: {
        signOut: async (token: string) => perform(`signOut:${token}`, () => {}),
        deleteUser: async (id: string) =>
          perform(`auth:${id}`, () => users.delete(id)),
      },
    },
  } as unknown as SupabaseClient;
  const contexts = [0, 1].map((id) => ({
    close: vi.fn(async () => {
      const { error } = perform(`context:${id}`, () => {});
      if (error) throw error;
    }),
  }));
  const resources = {
    admin,
    contexts: contexts as unknown as BrowserContext[],
    roomIds: ["room"],
    sessions: [...users].map(
      (id) => ({ user: { id }, access_token: `${id}-token` }) as Session
    ),
  };
  return { resources, calls, users, profiles, rooms };
}

describe("live invitation test cleanup", () => {
  it("deletes profiles as well as Auth users, scoped to this run", async () => {
    const state = fixture();
    state.users.add("real-user");
    state.profiles.add("real-user");
    state.rooms.add("real-room");
    await cleanupInvitationTestResources(state.resources);
    expect([...state.profiles]).toEqual(["real-user"]);
    expect([...state.users]).toEqual(["real-user"]);
    expect([...state.rooms]).toEqual(["real-room"]);
    for (const context of state.resources.contexts)
      expect(context.close).toHaveBeenCalledOnce();
    expect(state.calls.indexOf("signOut:alice-token")).toBeLessThan(
      state.calls.indexOf("auth:alice")
    );
  });

  it.each([
    "context:0",
    "rooms:room",
    "signOut:alice-token",
    "profiles:alice",
    "auth:alice",
  ])(
    "continues the remaining cleanup and reports a failure at %s",
    async (failure) => {
      const state = fixture([failure]);
      await expect(
        cleanupInvitationTestResources(state.resources)
      ).rejects.toThrow(/cleanup failed/i);
      expect(state.calls).toEqual(
        expect.arrayContaining([
          "context:1",
          "rooms:room",
          "profiles:alice",
          "profiles:bob",
          "auth:alice",
          "auth:bob",
        ])
      );
      expect(state.profiles.has("bob")).toBe(false);
      expect(state.users.has("bob")).toBe(false);
      if (failure !== "profiles:alice")
        expect(state.profiles.has("alice")).toBe(false);
      if (failure !== "auth:alice")
        expect(state.users.has("alice")).toBe(false);
    }
  );

  it("cleans up a partially initialized run", async () => {
    const state = fixture();
    state.resources.contexts.length = 0;
    state.resources.roomIds.length = 0;
    state.resources.sessions.length = 1;
    await cleanupInvitationTestResources(state.resources);
    expect([...state.profiles]).toEqual(["bob"]);
    expect([...state.users]).toEqual(["bob"]);
  });
});
