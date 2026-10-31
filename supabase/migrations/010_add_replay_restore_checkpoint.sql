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
