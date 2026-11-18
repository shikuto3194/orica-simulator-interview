import { describe, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import {
  cleanupInvitationTestResources,
  createTemporaryRoomTestSession,
  type InvitationTestResources,
} from "../../../e2e/room-invitations-cleanup";

function fixture(failures: string[] = [], ignoreAuthDelete = false) {
  const calls: string[] = [];
  const users = new Set(["alice", "bob"]);
  // profiles has no foreign key to auth.users: deleting Auth alone leaves it.
  const profiles = new Set(users);
  const rooms = new Set(["room"]);
  const createUser = vi.fn();
  const accountDetails = new Map<
    string,
    { email: string; app_metadata: Record<string, unknown> }
  >();
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
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({
            data: profiles.has(id) ? { user_id: id } : null,
            error: null,
          }),
        }),
      }),
    }),
    auth: {
      admin: {
        createUser,
        signOut: async (token: string) => perform(`signOut:${token}`, () => {}),
        deleteUser: async (id: string) =>
          perform(`auth:${id}`, () => {
            if (!ignoreAuthDelete) users.delete(id);
          }),
        getUserById: async (id: string) =>
          users.has(id)
            ? { data: { user: { id, ...accountDetails.get(id) } }, error: null }
            : { data: { user: null }, error: { code: "user_not_found" } },
      },
    },
  } as unknown as SupabaseClient;
  const contexts = [0, 1].map((id) => ({
    close: vi.fn(async () => {
      const { error } = perform(`context:${id}`, () => {});
      if (error) throw error;
    }),
  }));
  const resources: InvitationTestResources = {
    admin,
    contexts: contexts as unknown as BrowserContext[],
    roomIds: ["room"],
    sessions: [...users].map(
      (id) => ({ user: { id }, access_token: `${id}-token` }) as Session
    ),
  };
  return {
    resources,
    calls,
    users,
    profiles,
    rooms,
    createUser,
    accountDetails,
  };
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

  it("fails when a successful delete response leaves the Auth user behind", async () => {
    const state = fixture([], true);
    await expect(
      cleanupInvitationTestResources(state.resources)
    ).rejects.toThrow(/verify Auth user deletion/);
    expect(state.profiles.size).toBe(0);
  });

  it.each([true, false])(
    "checks ownership after a lost signup response (owned: %s)",
    async (owned) => {
      const state = fixture();
      state.resources.sessions.length = 0;
      let allocatedId = "";
      state.createUser.mockImplementation(
        async ({ id, email, app_metadata }) => {
          allocatedId = id;
          expect(state.resources.temporaryUsers?.planned.get(id)).toBe(email);
          state.users.add(id);
          state.accountDetails.set(id, {
            email,
            app_metadata: owned ? app_metadata : {},
          });
          throw new Error("connection reset after creation");
        }
      );
      await expect(
        createTemporaryRoomTestSession(state.resources, state.resources.admin)
      ).rejects.toThrow("connection reset after creation");
      const cleanup = cleanupInvitationTestResources(state.resources);
      if (owned) await expect(cleanup).resolves.toBeUndefined();
      else
        await expect(cleanup).rejects.toThrow(
          /verify temporary user ownership/
        );
      expect(state.users.has(allocatedId)).toBe(!owned);
      expect(state.users.has("alice")).toBe(true);
      expect(state.users.has("bob")).toBe(true);
    }
  );
});
