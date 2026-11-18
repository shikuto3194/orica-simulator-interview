import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
const fingerprint = "a".repeat(64);
const players = [
  { role: "alice", deckCardNos: ["a"] },
  { role: "bob", deckCardNos: ["b"] },
];
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(
    readFileSync(
      new URL("./fixtures/room-network-schema.sql", import.meta.url),
      "utf8"
    )
  );
  for (const migration of [
    "20261026181917_room_network_atomic_readiness.sql",
    "20261029070703_room_network_strict_commit.sql",
  ])
    await db.exec(
      readFileSync(
        new URL(`../../../supabase/migrations/${migration}`, import.meta.url),
        "utf8"
      )
    );
}, 30_000);
afterAll(async () => db.close());
async function room(id: string) {
  await db.query("INSERT INTO rooms(id,players) VALUES($1,$2)", [
    id,
    JSON.stringify(players),
  ]);
}
async function start(
  id: string,
  operation = "start",
  expectedPlayers = players
) {
  return (
    await db.query(
      "SELECT * FROM initialize_room_state($1,$2,'{\"initial\":true}','alice',$3,$4)",
      [
        id,
        JSON.stringify(expectedPlayers),
        JSON.stringify({
          state: { initial: true },
          requestFingerprint: fingerprint,
        }),
        operation,
      ]
    )
  ).rows[0];
}
async function commit(
  id: string,
  operation = "move",
  actor = "alice",
  fp: string | null = fingerprint,
  version = 1
) {
  return (
    await db.query(
      "SELECT * FROM commit_room_state($1,$2,'{\"moved\":true}',$3,'step',$4,$5)",
      [
        id,
        version,
        actor,
        JSON.stringify({ requestFingerprint: fp }),
        operation,
      ]
    )
  ).rows[0];
}
async function settle(
  id: string,
  operation: string,
  actor = "alice",
  fp = fingerprint
) {
  return (
    await db.query("SELECT * FROM settle_room_mutation($1,$2,$3,$4)", [
      id,
      operation,
      actor,
      fp,
    ])
  ).rows[0];
}
it("starts with a checkpoint, preserves lost ACK identity, and refuses changed preparation", async () => {
  await room("initial");
  expect(await start("initial", "start", [...players].reverse())).toMatchObject(
    { ok: false }
  );
  expect(await start("initial")).toMatchObject({ ok: true, new_version: 1 });
  expect(await start("initial")).toMatchObject({
    ok: true,
    duplicate: true,
    new_version: 1,
  });
  expect(await settle("initial", "start")).toMatchObject({
    outcome: "applied",
    applied_version: 1,
  });
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM replay_events WHERE room_id='initial'"
      )
    ).rows
  ).toEqual([{ n: 1 }]);
});
it("blocks all-version fallback and restores the guard within the transaction", async () => {
  await room("guard");
  await expect(
    db.exec("UPDATE rooms SET state='{}',state_version=1 WHERE id='guard'")
  ).rejects.toThrow("atomic commit");
  await expect(
    commit("guard", "bypass", "alice", fingerprint, 0)
  ).rejects.toThrow("Invalid room transition");
  await db.exec("BEGIN");
  await start("guard");
  await expect(
    db.exec("UPDATE rooms SET state_version=2 WHERE id='guard'")
  ).rejects.toThrow("atomic commit");
  await db.exec("ROLLBACK");
  expect(await start("guard")).toMatchObject({ ok: true });
});
it("fences a delayed initialization and fences the ID across actors", async () => {
  await room("fence");
  expect(await settle("fence", "cancelled")).toMatchObject({
    outcome: "cancelled",
  });
  await expect(start("fence", "cancelled")).rejects.toThrow(
    "settled without application"
  );
  await start("fence");
  await expect(commit("fence", "cancelled", "bob")).rejects.toThrow(
    "settled without application"
  );
  await expect(settle("fence", "cancelled", "bob")).rejects.toThrow(
    "Mutation ID"
  );
});
it("refuses missing identities, altered payloads, actors, and unverifiable legacy events", async () => {
  await room("identity");
  await start("identity");
  await commit("identity");
  for (const args of [
    ["move", "bob", fingerprint],
    ["move", "alice", "b".repeat(64)],
    ["move", "alice", null],
  ] as const)
    await expect(commit("identity", ...args)).rejects.toThrow();
  await db.exec(
    "UPDATE replay_events SET payload='{}' WHERE room_id='identity' AND client_mutation_id='move'"
  );
  await expect(commit("identity")).rejects.toThrow("unverifiable legacy");
  await expect(settle("identity", "move")).rejects.toThrow(
    "unverifiable legacy"
  );
  await expect(commit("identity", "")).rejects.toThrow(
    "Invalid mutation identity"
  );
});
it("detects schema/permission/definition loss and rejects writes, then recovers", async () => {
  await room("readiness");
  await start("readiness");
  expect(
    (await db.query("SELECT room_network_readiness_v2() ok")).rows[0]
  ).toEqual({ ok: true });
  for (const damage of [
    "ALTER TABLE rooms DISABLE TRIGGER require_atomic_room_state",
    "GRANT EXECUTE ON FUNCTION settle_room_mutation(TEXT,TEXT,TEXT,TEXT) TO anon",
    "REVOKE EXECUTE ON FUNCTION initialize_room_state(TEXT,JSONB,JSONB,TEXT,JSONB,TEXT) FROM service_role",
    "ALTER FUNCTION commit_room_state(TEXT,INTEGER,JSONB,TEXT,TEXT,JSONB,TEXT) SET search_path=public",
    "ALTER TABLE replay_events DISABLE ROW LEVEL SECURITY",
    "GRANT INSERT ON room_mutation_cancellations TO service_role",
    "GRANT INSERT ON replay_events TO service_role",
    "GRANT UPDATE ON room_network_contract TO service_role",
    "ALTER TABLE room_network_contract OWNER TO service_role",
    "ALTER TABLE room_mutation_cancellations DROP COLUMN request_fingerprint",
    "DROP TRIGGER require_atomic_room_state ON rooms; CREATE TRIGGER require_atomic_room_state BEFORE UPDATE OF players ON rooms FOR EACH ROW EXECUTE FUNCTION require_atomic_room_state()",
  ]) {
    await db.exec("BEGIN");
    await db.exec(damage);
    expect(
      (await db.query("SELECT room_network_readiness_v2() ok")).rows[0]
    ).toEqual({ ok: false });
    await expect(commit("readiness")).rejects.toThrow("schema unavailable");
    await db.exec("ROLLBACK");
  }
  expect(await commit("readiness")).toMatchObject({ ok: true, new_version: 2 });
});

it("rejects conflicting legacy evidence and cannot initialize through repair", async () => {
  await room("legacyconflict");
  await start("legacyconflict");
  await commit("legacyconflict");
  await db.query(
    "INSERT INTO room_mutation_cancellations(room_id,client_mutation_id,acting_player_id) VALUES('legacyconflict','move','bob')"
  );
  await expect(commit("legacyconflict")).rejects.toThrow("Conflicting legacy");
  await expect(settle("legacyconflict", "move")).rejects.toThrow(
    "Conflicting legacy"
  );
  await expect(
    db.query(
      "SELECT lookup_room_mutation('legacyconflict','move','alice','step',$1)",
      [fingerprint]
    )
  ).rejects.toThrow("Conflicting legacy");
  await room("repairzero");
  expect(
    (
      await db.query(
        "SELECT * FROM repair_room_state_from_replay('repairzero',0,0,'{}','alice','{}')"
      )
    ).rows[0]
  ).toMatchObject({ ok: false });
  expect(
    (await db.query("SELECT state_version FROM rooms WHERE id='repairzero'"))
      .rows[0]
  ).toEqual({ state_version: 0 });
});
