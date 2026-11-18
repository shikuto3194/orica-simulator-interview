-- Durable fences for operations whose HTTP outcome could not be established.
-- Resolving an unknown operation serializes with commit on the same room row.
CREATE TABLE IF NOT EXISTS public.room_mutation_cancellations (
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  client_mutation_id TEXT NOT NULL,
  acting_player_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, client_mutation_id, acting_player_id)
);
ALTER TABLE public.room_mutation_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_mutation_cancellations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.room_mutation_cancellations TO service_role;

-- 009_commit_room_state_rpc.sql
--
-- Room mutation commit fast path:
-- - Add client_mutation_id for idempotent retries.
-- - Commit rooms.state/state_version and replay_events in one DB transaction.
-- - Keep direct table access denied by RLS; only the server's service_role calls this RPC.

ALTER TABLE replay_events
  ADD COLUMN IF NOT EXISTS client_mutation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_events_room_client_mutation
  ON replay_events (room_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.commit_room_state(
  p_room_id TEXT,
  p_expected_version INTEGER,
  p_state JSONB,
  p_acting_player_id TEXT,
  p_endpoint TEXT,
  p_payload JSONB,
  p_client_mutation_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  ok BOOLEAN,
  new_version INTEGER,
  current_version INTEGER,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_version INTEGER := p_expected_version + 1;
  v_current_version INTEGER;
  v_duplicate_version INTEGER;
  v_duplicate_actor TEXT;
  v_duplicate_endpoint TEXT;
  v_duplicate_fingerprint TEXT;
BEGIN
  -- Serialize duplicate lookup and CAS with every writer of this room row.
  SELECT r.state_version INTO v_current_version
    FROM public.rooms r WHERE r.id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::INTEGER, p_expected_version, FALSE;
    RETURN;
  END IF;
  IF p_client_mutation_id IS NOT NULL THEN
    SELECT re.state_version, re.acting_player_id, re.endpoint, re.payload->>'requestFingerprint'
      INTO v_duplicate_version, v_duplicate_actor, v_duplicate_endpoint, v_duplicate_fingerprint
      FROM public.replay_events re
     WHERE re.room_id = p_room_id
       AND re.client_mutation_id = p_client_mutation_id
     LIMIT 1;

    IF FOUND THEN
      IF v_duplicate_actor <> p_acting_player_id OR v_duplicate_endpoint <> p_endpoint OR (v_duplicate_fingerprint IS NOT NULL AND v_duplicate_fingerprint IS DISTINCT FROM (p_payload->>'requestFingerprint')) THEN
        RAISE EXCEPTION 'Mutation ID belongs to another operation' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY SELECT TRUE, v_duplicate_version, v_duplicate_version, TRUE;
      RETURN;
    END IF;
  END IF;

  IF p_client_mutation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.room_mutation_cancellations
     WHERE room_id = p_room_id AND client_mutation_id = p_client_mutation_id AND acting_player_id = p_acting_player_id
  ) THEN
    RAISE EXCEPTION 'Mutation was settled without application' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('orica.atomic_room_commit', 'on', true);
  UPDATE public.rooms
     SET state = p_state,
         state_version = v_new_version
   WHERE id = p_room_id
     AND state_version = p_expected_version
   RETURNING state_version INTO v_current_version;

  IF NOT FOUND THEN
    SELECT r.state_version
      INTO v_current_version
      FROM public.rooms r
     WHERE r.id = p_room_id;
    RETURN QUERY
      SELECT FALSE, NULL::INTEGER, COALESCE(v_current_version, p_expected_version), FALSE;
    RETURN;
  END IF;

  INSERT INTO public.replay_events (
    room_id,
    state_version,
    acting_player_id,
    endpoint,
    payload,
    client_mutation_id
  )
  VALUES (
    p_room_id,
    v_new_version,
    p_acting_player_id,
    p_endpoint,
    p_payload,
    p_client_mutation_id
  );

  RETURN QUERY SELECT TRUE, v_new_version, v_new_version, FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commit_room_state(
  TEXT, INTEGER, JSONB, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_room_state(
  TEXT, INTEGER, JSONB, TEXT, TEXT, JSONB, TEXT
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_room_state(
  TEXT, INTEGER, JSONB, TEXT, TEXT, JSONB, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_room_state(
  TEXT, INTEGER, JSONB, TEXT, TEXT, JSONB, TEXT
) TO service_role;

-- 010_add_replay_restore_checkpoint.sql
--
-- A committed replay restore is a state transition, not an in-place rewrite.
-- Recording it at the next state_version keeps room CAS generations monotonic
-- and makes the restored state reproducible from the append-only event log.

-- Only snapshots captured from rooms.state by the server may become committed
-- restore bases. Existing/client-authored snapshots remain read-only.
ALTER TABLE public.snapshots
  ADD COLUMN IF NOT EXISTS is_server_checkpoint BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.replay_events
  DROP CONSTRAINT IF EXISTS replay_events_endpoint_check;

ALTER TABLE public.replay_events
  ADD CONSTRAINT replay_events_endpoint_check
  CHECK (endpoint IN (
    'action', 'step', 'claim-victory',
    'core-move', 'brave-separation', 'pregame-update',
    'replay-restore'
  ));

-- Repair rooms.state when the append-only event log is ahead. Normal room
-- mutations and this repair both serialize on the rooms row; after the lock,
-- the event-log head is checked again before writing the checkpoint at M+1.
CREATE OR REPLACE FUNCTION public.repair_room_state_from_replay(
  p_room_id TEXT,
  p_expected_room_version INTEGER,
  p_replayed_to_version INTEGER,
  p_state JSONB,
  p_acting_player_id TEXT,
  p_payload JSONB
)
RETURNS TABLE (
  ok BOOLEAN,
  new_version INTEGER,
  current_version INTEGER,
  event_version INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_version INTEGER;
  v_event_version INTEGER;
  v_new_version INTEGER := p_replayed_to_version + 1;
BEGIN
  SELECT r.state_version
    INTO v_current_version
    FROM public.rooms r
   WHERE r.id = p_room_id
   FOR UPDATE;

  IF NOT FOUND OR v_current_version <> p_expected_room_version THEN
    RETURN QUERY SELECT
      FALSE,
      NULL::INTEGER,
      COALESCE(v_current_version, p_expected_room_version),
      NULL::INTEGER;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(re.state_version), 0)
    INTO v_event_version
    FROM public.replay_events re
   WHERE re.room_id = p_room_id;

  IF p_replayed_to_version < v_current_version
     OR v_event_version <> p_replayed_to_version THEN
    RETURN QUERY SELECT
      FALSE,
      NULL::INTEGER,
      v_current_version,
      v_event_version;
    RETURN;
  END IF;

  PERFORM set_config('orica.atomic_room_commit', 'on', true);
  UPDATE public.rooms
     SET state = p_state,
         state_version = v_new_version
   WHERE id = p_room_id;

  INSERT INTO public.replay_events (
    room_id,
    state_version,
    acting_player_id,
    endpoint,
    payload,
    client_mutation_id
  )
  VALUES (
    p_room_id,
    v_new_version,
    p_acting_player_id,
    'replay-restore',
    p_payload,
    NULL
  );

  RETURN QUERY SELECT TRUE, v_new_version, v_new_version, v_new_version;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repair_room_state_from_replay(
  TEXT, INTEGER, INTEGER, JSONB, TEXT, JSONB
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repair_room_state_from_replay(
  TEXT, INTEGER, INTEGER, JSONB, TEXT, JSONB
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.repair_room_state_from_replay(
  TEXT, INTEGER, INTEGER, JSONB, TEXT, JSONB
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_room_state_from_replay(
  TEXT, INTEGER, INTEGER, JSONB, TEXT, JSONB
) TO service_role;

-- Cheap, non-mutating deployment/runtime capability probe.
CREATE OR REPLACE FUNCTION public.room_network_readiness()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 SELECT to_regprocedure('public.commit_room_state(text,integer,jsonb,text,text,jsonb,text)') IS NOT NULL
 AND to_regprocedure('public.repair_room_state_from_replay(text,integer,integer,jsonb,text,jsonb)') IS NOT NULL
 AND to_regprocedure('public.heartbeat_room(text,text)') IS NOT NULL
 AND to_regprocedure('public.settle_room_mutation(text,text,text,text)') IS NOT NULL
 AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.rooms'::regclass AND tgname = 'require_atomic_room_state' AND tgenabled = 'O')
 AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.uq_replay_events_room_client_mutation') AND indisvalid AND indisunique)
 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'is_server_checkpoint');
$$;
REVOKE ALL ON FUNCTION public.room_network_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_network_readiness() TO service_role;

-- Concurrent heartbeats must not overwrite one another's keys.
CREATE OR REPLACE FUNCTION public.heartbeat_room(p_room_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.rooms SET
   connected = COALESCE(connected, '{}'::jsonb) || jsonb_build_object(p_user_id, true),
   last_heartbeat = COALESCE(last_heartbeat, '{}'::jsonb) || jsonb_build_object(p_user_id, now()),
   all_disconnected_at = NULL
 WHERE id = p_room_id AND players @> jsonb_build_array(jsonb_build_object('supabaseUserId', p_user_id));
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.heartbeat_room(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_room(TEXT, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Read the durable result or fence a not-yet-committed command. A late original
-- request cannot apply after this returns cancelled, even across API restarts.
CREATE OR REPLACE FUNCTION public.settle_room_mutation(
  p_room_id TEXT, p_client_mutation_id TEXT, p_acting_player_id TEXT, p_fingerprint TEXT
) RETURNS TABLE(outcome TEXT, applied_version INTEGER, room_version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.replay_events%ROWTYPE; v_room_version INTEGER;
BEGIN
 SELECT state_version INTO v_room_version FROM public.rooms WHERE id = p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room unavailable'; END IF;
 SELECT * INTO v_event FROM public.replay_events
  WHERE room_id = p_room_id AND client_mutation_id = p_client_mutation_id;
 IF FOUND THEN
   IF v_event.acting_player_id <> p_acting_player_id OR
      (v_event.payload->>'requestFingerprint' IS NOT NULL AND v_event.payload->>'requestFingerprint' IS DISTINCT FROM p_fingerprint) THEN
     RAISE EXCEPTION 'Mutation ID mismatch' USING ERRCODE = '22023';
   END IF;
   RETURN QUERY SELECT 'applied'::TEXT, v_event.state_version, v_room_version;
 ELSE
   INSERT INTO public.room_mutation_cancellations(room_id, client_mutation_id, acting_player_id)
    VALUES(p_room_id, p_client_mutation_id, p_acting_player_id) ON CONFLICT DO NOTHING;
   RETURN QUERY SELECT 'cancelled'::TEXT, NULL::INTEGER, v_room_version;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_room_mutation(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_room_mutation(TEXT, TEXT, TEXT, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Old API fallback must not bypass atomicity or settled-command fences during rollback.
CREATE OR REPLACE FUNCTION public.require_atomic_room_state()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.state_version > 0 AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.state_version IS DISTINCT FROM OLD.state_version)
    AND current_setting('orica.atomic_room_commit', true) IS DISTINCT FROM 'on' THEN
   RAISE EXCEPTION 'Room state requires atomic commit' USING ERRCODE = '55000';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_atomic_room_state ON public.rooms;
CREATE TRIGGER require_atomic_room_state BEFORE UPDATE OF state, state_version ON public.rooms
 FOR EACH ROW EXECUTE FUNCTION public.require_atomic_room_state();
REVOKE ALL ON FUNCTION public.require_atomic_room_state() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
