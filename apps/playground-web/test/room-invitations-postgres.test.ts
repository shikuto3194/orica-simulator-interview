import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const charlie = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
async function rpc(sql: string, params: Array<string | null>) {
  const result = await db.query<{ result: Record<string, unknown> }>(
    `SELECT ${sql} AS result`,
    params
  );
  return result.rows[0]!.result;
}
const send = (recipient = bob, sender = alice) =>
  rpc("public.send_room_invitation('room01', $1::uuid, $2::uuid)", [
    sender,
    recipient,
  ]);
const join = (user = bob, invitation?: string) =>
  rpc("public.join_room('room01', $1::uuid, $2::uuid)", [
    user,
    invitation ?? null,
  ]);
const deck = (user: string) =>
  rpc("public.set_room_deck('room01', $1::uuid, '[\"new-deck\"]'::jsonb)", [
    user,
  ]);
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY, display_name text, avatar_id text);
    INSERT INTO auth.users VALUES ('${alice}'), ('${bob}'), ('${charlie}');
    INSERT INTO public.profiles SELECT id, 'player', 'reimu' FROM auth.users;`);
  for (const file of [
    "002_create_rooms.sql",
    "004_enforce_rooms_rls.sql",
    "008_add_last_heartbeat_to_rooms.sql",
    "20260923084249_room_invitations.sql",
    "20260923085345_room_push_priority.sql",
  ]) {
    await db.exec(
      readFileSync(
        new URL(`../../../supabase/migrations/${file}`, import.meta.url),
        "utf8"
      )
    );
  }
  await db.exec(
    "GRANT SELECT, UPDATE ON public.rooms TO service_role; GRANT SELECT ON public.profiles TO service_role;"
  );
}, 30_000);
beforeEach(async () => {
  await db.exec("RESET ROLE; DELETE FROM public.rooms;");
  await db.query(
    "INSERT INTO public.rooms(id, players) VALUES ('room01', $1::jsonb)",
    [
      JSON.stringify([
        { supabaseUserId: alice, role: "alice", deckCardNos: ["saved-deck"] },
      ]),
    ]
  );
  await db.exec("SET ROLE service_role;");
});
afterAll(async () => {
  await db.close();
});

it("sends once, preserves read state on resend, and atomically accepts without losing the host deck", async () => {
  const first = await send();
  expect(first.id).toBeTypeOf("string");
  expect(await send()).toEqual(first);
  expect((await db.query("SELECT * FROM room_invitations")).rows).toHaveLength(
    1
  );
  const result = await join(bob, first.id as string);
  expect(result).toEqual({ roomId: "room01", role: "bob", reconnected: false });
  expect(await join(bob, first.id as string)).toEqual({
    ...result,
    reconnected: true,
  });
  const room = (
    await db.query<{ players: Array<{ deckCardNos: string[] }> }>(
      "SELECT players FROM rooms"
    )
  ).rows[0]!;
  expect(room.players).toHaveLength(2);
  expect(room.players[0]!.deckCardNos).toEqual(["saved-deck"]);
  const invitation = (
    await db.query("SELECT read_at, accepted_at FROM room_invitations")
  ).rows[0]!;
  expect(invitation.read_at).not.toBeNull();
  expect(invitation.accepted_at).not.toBeNull();
});
it("rejects outsiders, self invitations, and missing recipients without creating messages", async () => {
  expect((await send(bob, charlie)).status).toBe(403);
  expect((await send(alice)).status).toBe(400);
  expect((await send("00000000-0000-4000-8000-999999999999")).status).toBe(400);
  expect((await db.query("SELECT * FROM room_invitations")).rows).toHaveLength(
    0
  );
});
it("expired invites can be renewed without multiplying inbox entries", async () => {
  const first = await send();
  await db.exec(
    "UPDATE room_invitations SET read_at = now(), expires_at = now() - interval '1 second'"
  );
  expect(await send()).toEqual(first);
  const row = (
    await db.query(
      "SELECT read_at, expires_at > now() AS valid FROM room_invitations"
    )
  ).rows[0]!;
  expect(row).toEqual({ read_at: null, valid: true });
});
it("deck registration preserves joined seats and the other player's deck", async () => {
  expect((await deck(charlie)).status).toBe(403);
  expect((await deck(alice)).allReady).toBe(false);
  await join();
  expect((await deck(bob)).allReady).toBe(true);
  expect((await deck(alice)).allReady).toBe(true);
  expect(
    (await db.query<{ players: unknown[] }>("SELECT players FROM rooms"))
      .rows[0]!.players
  ).toHaveLength(2);
  await db.exec("UPDATE rooms SET state = '{}'::jsonb");
  expect((await deck(alice)).status).toBe(409);
});
it("unready preserves the opponent deck and prevents a start based on stale players", async () => {
  await join();
  await deck(bob);
  const before = (
    await db.query<{ players: unknown[] }>("SELECT players FROM rooms")
  ).rows[0]!.players;
  const unready = (user: string) =>
    rpc("public.set_room_deck('room01', $1::uuid, NULL::jsonb)", [user]);
  expect((await unready(charlie)).status).toBe(403);
  expect(await unready(alice)).toEqual({ ok: true, allReady: false });
  expect(await unready(alice)).toEqual({ ok: true, allReady: false });
  const after = (
    await db.query<{ players: Array<{ deckCardNos: string[] | null }> }>(
      "SELECT players FROM rooms"
    )
  ).rows[0]!.players;
  expect(after[0]!.deckCardNos).toBeNull();
  expect(after[1]!.deckCardNos).toEqual(["new-deck"]);
  const start = (players: unknown[]) =>
    db.query(
      "UPDATE rooms SET state = '{}'::jsonb, state_version = 1 WHERE id = 'room01' AND state IS NULL AND players = $1::jsonb RETURNING id",
      [JSON.stringify(players)]
    );
  expect((await start(before)).rows).toHaveLength(0);
  await deck(alice);
  const ready = (
    await db.query<{ players: unknown[] }>("SELECT players FROM rooms")
  ).rows[0]!.players;
  expect((await start(ready)).rows).toHaveLength(1);
  expect((await unready(alice)).status).toBe(409);
  expect((await start(ready)).rows).toHaveLength(0);
});
it("recipient identity and expiration are enforced without joining", async () => {
  const { id } = await send();
  expect((await join(charlie, id as string)).status).toBe(404);
  await db.exec(
    "UPDATE room_invitations SET expires_at = now() - interval '1 second'"
  );
  expect((await join(bob, id as string)).status).toBe(410);
  expect(
    (
      await db.query<{ count: number }>(
        "SELECT jsonb_array_length(players) AS count FROM rooms"
      )
    ).rows[0]!.count
  ).toBe(1);
});
it("normal join and invitation acceptance share the single available seat", async () => {
  const { id } = await send();
  expect((await join(charlie)).role).toBe("bob");
  expect((await join(bob, id as string)).status).toBe(409);
  expect((await send()).status).toBe(409);
  expect(
    (await db.query("SELECT accepted_at FROM room_invitations")).rows[0]!
      .accepted_at
  ).toBeNull();
});
it("started games reject new players but allow existing members to reconnect", async () => {
  const { id } = await send();
  await db.exec("UPDATE rooms SET state = '{}'::jsonb, state_version = 1");
  expect((await join(bob, id as string)).status).toBe(409);
  expect((await join(alice)).reconnected).toBe(true);
});
it("deleting a room also deletes its invitations", async () => {
  await send();
  await db.exec("RESET ROLE; DELETE FROM rooms; SET ROLE service_role;");
  expect((await db.query("SELECT * FROM room_invitations")).rows).toHaveLength(
    0
  );
  expect((await join()).status).toBe(404);
});
it.each(["anon", "authenticated"])(
  "%s cannot read, modify, or call invitation/seat RPCs directly",
  async (role) => {
    await send();
    await db.exec(`SET ROLE ${role}`);
    for (const sql of [
      "SELECT * FROM room_invitations",
      "UPDATE room_invitations SET accepted_at = now()",
      "DELETE FROM room_invitations",
      `INSERT INTO room_invitations(room_id, sender_id, recipient_id) VALUES ('room01', '${alice}', '${bob}')`,
    ]) {
      await expect(db.exec(sql)).rejects.toThrow(/permission denied/);
    }
    await expect(send()).rejects.toThrow(/permission denied/);
    await expect(join()).rejects.toThrow(/permission denied/);
    await expect(deck(alice)).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("SELECT * FROM room_push_subscriptions")
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("DELETE FROM room_push_subscriptions")
    ).rejects.toThrow(/permission denied/);
  }
);
