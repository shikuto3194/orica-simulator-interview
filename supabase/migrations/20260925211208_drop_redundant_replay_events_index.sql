-- 適用日: 2026-09-26 (JST), Supabase MCP migration 20260925211208.
-- Remove only the redundant non-unique index from migration 005.
-- Keep uq_replay_events_room_version for lookups and uniqueness.
-- Use a guarded transaction for MCP migration history. A brief table lock
-- prevents concurrent index changes; NOWAIT aborts instead of queuing behind
-- application traffic. This is not DROP INDEX CONCURRENTLY.
DO $migration$
BEGIN
  IF to_regclass('public.idx_replay_events_room_version') IS NULL THEN
    RETURN;
  END IF;

  LOCK TABLE public.replay_events IN ACCESS EXCLUSIVE MODE NOWAIT;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index redundant
    JOIN pg_class redundant_class ON redundant_class.oid = redundant.indexrelid
    JOIN pg_index retained
      ON retained.indexrelid = to_regclass('public.uq_replay_events_room_version')
    JOIN pg_class retained_class ON retained_class.oid = retained.indexrelid
    WHERE redundant.indexrelid = to_regclass('public.idx_replay_events_room_version')
      AND redundant.indrelid = 'public.replay_events'::regclass
      AND retained.indrelid = redundant.indrelid
      AND retained.indisunique
      AND retained.indisvalid
      AND retained.indisready
      AND retained.indislive
      AND NOT redundant.indisunique
      AND NOT redundant.indisprimary
      AND NOT redundant.indisreplident
      AND redundant_class.relam = retained_class.relam
      AND redundant.indkey = retained.indkey
      AND redundant.indclass = retained.indclass
      AND redundant.indcollation = retained.indcollation
      AND redundant.indoption = retained.indoption
      AND redundant.indnatts = retained.indnatts
      AND redundant.indnkeyatts = retained.indnkeyatts
      AND redundant.indexprs IS NULL
      AND retained.indexprs IS NULL
      AND redundant.indpred IS NULL
      AND retained.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'Refusing to drop replay index: valid equivalent unique index is required';
  END IF;

  -- No CASCADE: PostgreSQL must reject any unexpected dependent objects.
  DROP INDEX public.idx_replay_events_room_version;
END
$migration$;
