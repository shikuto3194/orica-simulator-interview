import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE TABLE rooms (id TEXT PRIMARY KEY, state JSONB, state_version INTEGER NOT NULL DEFAULT 0,
      players JSONB NOT NULL DEFAULT '[]', connected JSONB NOT NULL DEFAULT '{}', last_heartbeat JSONB NOT NULL DEFAULT '{}', all_disconnected_at TIMESTAMPTZ);
    CREATE TABLE replay_events (id BIGSERIAL PRIMARY KEY, room_id TEXT REFERENCES rooms(id), state_version INTEGER NOT NULL,
      acting_player_id TEXT NOT NULL, endpoint TEXT NOT NULL CHECK (endpoint IN ('action', 'step')), payload JSONB NOT NULL, UNIQUE(room_id, state_version));
    CREATE TABLE snapshots (id TEXT PRIMARY KEY, state JSONB);
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261026181917_room_network_atomic_readiness.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
}, 30_000);
afterAll(async () => db.close());
async function commit(
  room: string,
  id: string,
  version = 0,
  actor = "alice",
  fingerprint = "one",
  endpoint = "step"
) {
  return (
    await db.query(
      `SELECT * FROM commit_room_state($1, $2, '{"marker":"committed"}', $3, $4, jsonb_build_object('requestFingerprint', $5::text), $6)`,
      [room, version, actor, endpoint, fingerprint, id]
    )
  ).rows[0];
}
it("lost ACK and concurrent retries preserve one state generation and one event", async () => {
  await db.exec(
    `INSERT INTO rooms (id, state) VALUES ('lost', '{"marker":"initial"}');`
  );
  await commit("lost", "operation"); // drop the result, as if the network lost the ACK
  const retries = await Promise.all(
    Array.from({ length: 20 }, () => commit("lost", "operation"))
  );
  expect(
    retries.every(
      (row) =>
        row.ok === true && row.duplicate === true && row.new_version === 1
    )
  ).toBe(true);
  expect(
    (
      await db.query(
        `SELECT state_version, state->>'marker' AS marker FROM rooms WHERE id='lost'`
      )
    ).rows
  ).toEqual([{ state_version: 1, marker: "committed" }]);
  expect(
    (
      await db.query(
        `SELECT count(*)::integer AS count FROM replay_events WHERE room_id='lost'`
      )
    ).rows
  ).toEqual([{ count: 1 }]);
  expect(await commit("lost", "successor", 0)).toMatchObject({
    ok: false,
    current_version: 1,
  });
});
it("reused IDs cannot change actor, endpoint or input", async () => {
  await db.exec(`INSERT INTO rooms (id) VALUES ('binding');`);
  await commit("binding", "bound");
  for (const [actor, fingerprint, endpoint] of [
    ["bob", "one", "step"],
    ["alice", "two", "step"],
    ["alice", "one", "action"],
  ]) {
    await expect(
      commit("binding", "bound", 0, actor, fingerprint, endpoint)
    ).rejects.toThrow("Mutation ID");
  }
});
it("event insertion failure rolls back the state write", async () => {
  await db.exec(
    `INSERT INTO rooms (id, state) VALUES ('rollback', '{"marker":"initial"}');`
  );
  await expect(
    commit("rollback", "bad", 0, "alice", "one", "invalid")
  ).rejects.toThrow();
  expect(
    (
      await db.query(
        `SELECT state_version, state->>'marker' AS marker FROM rooms WHERE id='rollback'`
      )
    ).rows
  ).toEqual([{ state_version: 0, marker: "initial" }]);
});
it("heartbeat merges member keys and refuses non-members", async () => {
  await db.exec(
    `INSERT INTO rooms(id, players) VALUES ('beats', '[{"supabaseUserId":"a"},{"supabaseUserId":"b"}]');`
  );
  for (const user of ["a", "b"])
    expect(
      (await db.query(`SELECT heartbeat_room('beats', $1) AS ok`, [user]))
        .rows[0]
    ).toEqual({ ok: true });
  expect(
    (await db.query(`SELECT heartbeat_room('beats', 'outsider') AS ok`)).rows[0]
  ).toEqual({ ok: false });
  expect(
    (
      await db.query(
        `SELECT connected, last_heartbeat ?& array['a','b'] AS both FROM rooms WHERE id='beats'`
      )
    ).rows[0]
  ).toEqual({ connected: { a: true, b: true }, both: true });
});
it("settling an unknown command distinguishes committed results and fences delayed originals", async () => {
  await db.exec(
    `INSERT INTO rooms (id) VALUES ('settle-applied'), ('settle-delayed');`
  );
  await commit("settle-applied", "first");
  expect(
    (
      await db.query(
        `SELECT * FROM settle_room_mutation('settle-applied', 'first', 'alice', 'one')`
      )
    ).rows[0]
  ).toEqual({ outcome: "applied", applied_version: 1, room_version: 1 });
  expect(
    (
      await db.query(
        `SELECT * FROM settle_room_mutation('settle-delayed', 'late', 'alice', 'one')`
      )
    ).rows[0]
  ).toEqual({ outcome: "cancelled", applied_version: null, room_version: 0 });
  await expect(commit("settle-delayed", "late")).rejects.toThrow(
    "settled without application"
  );
  expect(
    (
      await db.query(
        `SELECT state_version FROM rooms WHERE id='settle-delayed'`
      )
    ).rows[0]
  ).toEqual({ state_version: 0 });
  // Another member cannot fence Alice by submitting the same ID in their own scope.
  await db.query(
    `SELECT * FROM settle_room_mutation('settle-delayed', 'other', 'bob', 'one')`
  );
  expect(await commit("settle-delayed", "other")).toMatchObject({
    ok: true,
    new_version: 1,
  });
});
it("old non-atomic fallback cannot bypass the RPC after a deployment rollback", async () => {
  await db.exec(`INSERT INTO rooms (id) VALUES ('old-api');`);
  await commit("old-api", "one");
  await expect(
    db.exec(`UPDATE rooms SET state_version=2 WHERE id='old-api'`)
  ).rejects.toThrow("requires atomic commit");
  expect(await commit("old-api", "two", 1)).toMatchObject({
    ok: true,
    new_version: 2,
  });
});
it("readiness checks capabilities and sensitive RPCs are service-role only", async () => {
  expect(
    (await db.query(`SELECT room_network_readiness() AS ok`)).rows[0]
  ).toEqual({ ok: true });
  for (const role of ["anon", "authenticated"]) {
    expect(
      (
        await db.query(
          `SELECT has_function_privilege($1, 'public.commit_room_state(text,integer,jsonb,text,text,jsonb,text)', 'execute') AS allowed`,
          [role]
        )
      ).rows[0]
    ).toEqual({ allowed: false });
  }
  await db.exec(`DROP INDEX uq_replay_events_room_client_mutation;`);
  expect(
    (await db.query(`SELECT room_network_readiness() AS ok`)).rows[0]
  ).toEqual({ ok: false });
});
