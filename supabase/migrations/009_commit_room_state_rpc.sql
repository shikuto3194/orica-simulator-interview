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
BEGIN
  IF p_client_mutation_id IS NOT NULL THEN
    SELECT re.state_version
      INTO v_duplicate_version
      FROM public.replay_events re
     WHERE re.room_id = p_room_id
       AND re.client_mutation_id = p_client_mutation_id
     LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT TRUE, v_duplicate_version, v_duplicate_version, TRUE;
      RETURN;
    END IF;
  END IF;

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
