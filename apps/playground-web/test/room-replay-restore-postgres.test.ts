import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_009 = readFileSync(
  resolve(
    __dirname,
    "../../../supabase/migrations/009_commit_room_state_rpc.sql"
  ),
  "utf8"
);
const MIGRATION_010 = readFileSync(
  resolve(
    __dirname,
    "../../../supabase/migrations/010_add_replay_restore_checkpoint.sql"
  ),
  "utf8"
);

interface RestoreResult {
  ok: boolean;
  new_version: number | null;
  current_version: number;
  event_version: number | null;
}

let db: PGlite;

async function seedEventsLeadState(roomId: string): Promise<void> {
  await db.query(
    `INSERT INTO public.rooms (id, state, state_version)
     VALUES ($1, '{"marker":"stale"}'::jsonb, 2)`,
    [roomId]
  );

  for (let version = 1; version <= 4; version += 1) {
    await db.query(
      `INSERT INTO public.replay_events (
         room_id, state_version, acting_player_id, endpoint, payload
       ) VALUES (
         $1,
         $2::integer,
         'alice',
         'action',
         jsonb_build_object('version', $2::integer)
       )`,
      [roomId, version]
    );
  }
}

async function restore(
  roomId: string,
  marker: string,
  expectedRoomVersion = 2,
  replayedToVersion = 4
): Promise<RestoreResult> {
  const result = await db.query<RestoreResult>(
    `SELECT * FROM public.repair_room_state_from_replay(
       $1,
       $2,
       $3,
       jsonb_build_object('marker', $4::text),
       'alice',
       jsonb_build_object('state', jsonb_build_object('marker', $4::text))
     )`,
    [roomId, expectedRoomVersion, replayedToVersion, marker]
  );
  return result.rows[0];
}

describe("repair_room_state_from_replay PostgreSQL integration", () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;

      CREATE TABLE public.rooms (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        state_version INTEGER NOT NULL
      );

      CREATE TABLE public.replay_events (
        id BIGSERIAL PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
        state_version INTEGER NOT NULL,
        acting_player_id TEXT NOT NULL,
        endpoint TEXT NOT NULL CHECK (endpoint IN (
          'action', 'step', 'claim-victory',
          'core-move', 'brave-separation', 'pregame-update'
        )),
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (room_id, state_version)
      );

      CREATE TABLE public.snapshots (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL
      );
    `);
    await db.exec(MIGRATION_009);
    await db.exec(MIGRATION_010);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("repairs state=N and event head=M at checkpoint M+1", async () => {
    await seedEventsLeadState("room-success");

    await expect(restore("room-success", "restored")).resolves.toEqual({
      ok: true,
      new_version: 5,
      current_version: 5,
      event_version: 5,
    });

    const room = await db.query<{ marker: string; state_version: number }>(
      `SELECT state->>'marker' AS marker, state_version
         FROM public.rooms
        WHERE id = 'room-success'`
    );
    expect(room.rows).toEqual([{ marker: "restored", state_version: 5 }]);

    const checkpoint = await db.query<{
      endpoint: string;
      marker: string;
      state_version: number;
    }>(
      `SELECT
         endpoint,
         payload->'state'->>'marker' AS marker,
         state_version
       FROM public.replay_events
       WHERE room_id = 'room-success' AND state_version = 5`
    );
    expect(checkpoint.rows).toEqual([
      { endpoint: "replay-restore", marker: "restored", state_version: 5 },
    ]);
  });

  it("allows only one restore from the same CAS generation", async () => {
    await seedEventsLeadState("room-cas");

    expect(await restore("room-cas", "winner")).toMatchObject({
      ok: true,
      new_version: 5,
    });
    expect(await restore("room-cas", "loser")).toMatchObject({
      ok: false,
      new_version: null,
      current_version: 5,
    });

    const persisted = await db.query<{
      marker: string;
      checkpoint_count: number;
    }>(
      `SELECT
         r.state->>'marker' AS marker,
         COUNT(re.id)::integer AS checkpoint_count
       FROM public.rooms r
       LEFT JOIN public.replay_events re
         ON re.room_id = r.id AND re.endpoint = 'replay-restore'
       WHERE r.id = 'room-cas'
       GROUP BY r.id`
    );
    expect(persisted.rows).toEqual([{ marker: "winner", checkpoint_count: 1 }]);
  });

  it("rolls back the room update when checkpoint insertion fails", async () => {
    await seedEventsLeadState("room-rollback");
    await db.exec(`
      CREATE FUNCTION public.reject_restore_checkpoint()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.endpoint = 'replay-restore' THEN
          RAISE EXCEPTION 'checkpoint rejected for rollback test';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER reject_restore_checkpoint
      BEFORE INSERT ON public.replay_events
      FOR EACH ROW EXECUTE FUNCTION public.reject_restore_checkpoint();
    `);

    await expect(restore("room-rollback", "must-rollback")).rejects.toThrow(
      "checkpoint rejected for rollback test"
    );

    const room = await db.query<{ marker: string; state_version: number }>(
      `SELECT state->>'marker' AS marker, state_version
         FROM public.rooms
        WHERE id = 'room-rollback'`
    );
    expect(room.rows).toEqual([{ marker: "stale", state_version: 2 }]);

    const checkpoint = await db.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count
         FROM public.replay_events
        WHERE room_id = 'room-rollback' AND state_version = 5`
    );
    expect(checkpoint.rows).toEqual([{ count: 0 }]);
  });
});
