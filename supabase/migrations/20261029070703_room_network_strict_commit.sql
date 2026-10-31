-- Strict room protocol v2. Apply atomically with old mutation ingress drained.
-- Preserve legacy cancellation rows: a fence is global to (room, operation ID),
-- including rows whose original fingerprint cannot be recovered.
ALTER TABLE public.room_mutation_cancellations ADD COLUMN request_fingerprint TEXT;
REVOKE ALL ON public.rooms, public.replay_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.room_mutation_cancellations FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.replay_events FROM service_role;

CREATE FUNCTION public.check_room_mutation_identity(
  p_room_id TEXT, p_id TEXT, p_actor TEXT, p_endpoint TEXT, p_fingerprint TEXT
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.replay_events%ROWTYPE;
BEGIN
  IF p_id IS NULL OR length(p_id) NOT BETWEEN 1 AND 160 OR btrim(p_id) <> p_id
     OR p_actor IS NULL OR p_actor NOT IN ('alice', 'bob')
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid mutation identity' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_event FROM public.replay_events
    WHERE room_id = p_room_id AND client_mutation_id = p_id;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.room_mutation_cancellations WHERE room_id=p_room_id AND client_mutation_id=p_id) THEN
      RAISE EXCEPTION 'Conflicting legacy mutation outcome' USING ERRCODE = '22023';
    END IF;
    IF v_event.acting_player_id IS DISTINCT FROM p_actor
       OR (p_endpoint IS NOT NULL AND v_event.endpoint IS DISTINCT FROM p_endpoint)
       OR v_event.payload->>'requestFingerprint' IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION 'Mutation ID mismatch or unverifiable legacy event' USING ERRCODE = '22023';
    END IF;
    RETURN v_event.state_version;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.check_room_mutation_identity(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_room_state(
  p_room_id TEXT, p_expected_version INTEGER, p_state JSONB,
  p_acting_player_id TEXT, p_endpoint TEXT, p_payload JSONB,
  p_client_mutation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, new_version INTEGER, current_version INTEGER, duplicate BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_room public.rooms%ROWTYPE; v_duplicate INTEGER; v_guard TEXT;
BEGIN
  IF public.room_network_readiness_v2() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Room schema unavailable' USING ERRCODE = '55000'; END IF;
  IF p_endpoint IS NULL OR p_endpoint NOT IN ('action','step','claim-victory','core-move','brave-separation','pregame-update','replay-restore') THEN
    RAISE EXCEPTION 'Invalid mutation endpoint' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, NULL::INTEGER, p_expected_version, FALSE; RETURN; END IF;
  v_duplicate := public.check_room_mutation_identity(p_room_id, p_client_mutation_id, p_acting_player_id, p_endpoint, p_payload->>'requestFingerprint');
  IF v_duplicate IS NOT NULL THEN RETURN QUERY SELECT TRUE, v_duplicate, v_room.state_version, TRUE; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.room_mutation_cancellations WHERE room_id = p_room_id AND client_mutation_id = p_client_mutation_id) THEN
    RAISE EXCEPTION 'Mutation was settled without application' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_expected_version <> v_room.state_version THEN
    RETURN QUERY SELECT FALSE, NULL::INTEGER, v_room.state_version, FALSE; RETURN;
  END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' OR p_endpoint IS NULL OR
     (v_room.state_version = 0 AND current_setting('orica.room_initialize', true) IS DISTINCT FROM 'on') THEN
    RAISE EXCEPTION 'Invalid room transition' USING ERRCODE = '22023';
  END IF;
  v_guard := current_setting('orica.atomic_room_commit', true);
  PERFORM set_config('orica.atomic_room_commit', 'on', true);
  UPDATE public.rooms SET state = p_state, state_version = p_expected_version + 1 WHERE id = p_room_id;
  INSERT INTO public.replay_events(room_id,state_version,acting_player_id,endpoint,payload,client_mutation_id)
    VALUES(p_room_id,p_expected_version+1,p_acting_player_id,p_endpoint,p_payload,p_client_mutation_id);
  PERFORM set_config('orica.atomic_room_commit', coalesce(v_guard, ''), true);
  RETURN QUERY SELECT TRUE, p_expected_version + 1, p_expected_version + 1, FALSE;
END;
$$;

CREATE FUNCTION public.initialize_room_state(
  p_room_id TEXT, p_expected_players JSONB, p_state JSONB,
  p_acting_player_id TEXT, p_payload JSONB, p_client_mutation_id TEXT
) RETURNS TABLE(ok BOOLEAN, new_version INTEGER, current_version INTEGER, duplicate BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_room public.rooms%ROWTYPE; v_duplicate INTEGER; v_guard TEXT;
BEGIN
  IF public.room_network_readiness_v2() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Room schema unavailable' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE,NULL::INTEGER,0,FALSE; RETURN; END IF;
  v_duplicate := public.check_room_mutation_identity(p_room_id,p_client_mutation_id,p_acting_player_id,'replay-restore',p_payload->>'requestFingerprint');
  IF v_duplicate IS NOT NULL THEN RETURN QUERY SELECT TRUE,v_duplicate,v_room.state_version,TRUE; RETURN; END IF;
  IF v_room.state IS NOT NULL OR v_room.state_version <> 0 OR v_room.players IS DISTINCT FROM p_expected_players
     OR jsonb_array_length(v_room.players) <> 2
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_room.players) p WHERE jsonb_typeof(p->'deckCardNos') IS DISTINCT FROM 'array') THEN
    RETURN QUERY SELECT FALSE,NULL::INTEGER,v_room.state_version,FALSE; RETURN;
  END IF;
  IF p_payload->'state' IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'Invalid initial checkpoint' USING ERRCODE = '22023'; END IF;
  v_guard := current_setting('orica.room_initialize', true);
  PERFORM set_config('orica.room_initialize','on',true);
  RETURN QUERY SELECT * FROM public.commit_room_state(p_room_id,0,p_state,p_acting_player_id,'replay-restore',p_payload,p_client_mutation_id);
  PERFORM set_config('orica.room_initialize',coalesce(v_guard,''),true);
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_room_state(TEXT,JSONB,JSONB,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_room_state(TEXT,JSONB,JSONB,TEXT,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_room_mutation(
  p_room_id TEXT, p_client_mutation_id TEXT, p_acting_player_id TEXT, p_fingerprint TEXT
) RETURNS TABLE(outcome TEXT, applied_version INTEGER, room_version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_version INTEGER; v_duplicate INTEGER; v_fence public.room_mutation_cancellations%ROWTYPE;
BEGIN
  IF public.room_network_readiness_v2() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Room schema unavailable' USING ERRCODE = '55000'; END IF;
  SELECT state_version INTO v_version FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room unavailable'; END IF;
  -- The SHA256 fingerprint includes the HTTP route; rematch/reset share an event label.
  v_duplicate := public.check_room_mutation_identity(p_room_id,p_client_mutation_id,p_acting_player_id,NULL,p_fingerprint);
  IF v_duplicate IS NOT NULL THEN RETURN QUERY SELECT 'applied'::TEXT,v_duplicate,v_version; RETURN; END IF;
  SELECT * INTO v_fence FROM public.room_mutation_cancellations WHERE room_id=p_room_id AND client_mutation_id=p_client_mutation_id LIMIT 1;
  IF FOUND THEN
    IF v_fence.acting_player_id IS DISTINCT FROM p_acting_player_id OR v_fence.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION 'Mutation ID mismatch or unverifiable legacy fence' USING ERRCODE = '22023';
    END IF;
  ELSE
    INSERT INTO public.room_mutation_cancellations(room_id,client_mutation_id,acting_player_id,request_fingerprint)
      VALUES(p_room_id,p_client_mutation_id,p_acting_player_id,p_fingerprint);
  END IF;
  RETURN QUERY SELECT 'cancelled'::TEXT,NULL::INTEGER,v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_atomic_room_state()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.state IS DISTINCT FROM OLD.state OR NEW.state_version IS DISTINCT FROM OLD.state_version)
     AND current_setting('orica.atomic_room_commit',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Room state requires atomic commit' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
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
SET search_path = ''
AS $$
DECLARE
  v_current_version INTEGER;
  v_event_version INTEGER;
  v_new_version INTEGER := p_replayed_to_version + 1;
  v_guard TEXT;
BEGIN
  IF public.room_network_readiness_v2() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Room schema unavailable' USING ERRCODE = '55000'; END IF;
  SELECT r.state_version
    INTO v_current_version
    FROM public.rooms r
   WHERE r.id = p_room_id
   FOR UPDATE;

  IF NOT FOUND OR v_current_version = 0 OR v_current_version <> p_expected_room_version THEN
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

  v_guard := current_setting('orica.atomic_room_commit', true);
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

  PERFORM set_config('orica.atomic_room_commit', coalesce(v_guard,''), true);
  RETURN QUERY SELECT TRUE, v_new_version, v_new_version, v_new_version;
END;
$$;



-- A service-role read cannot silently bless a replaced function or disabled guard.
-- Only the migration owner can modify this manifest. No payloads or secrets.
CREATE TABLE public.room_network_contract (signature TEXT PRIMARY KEY, source_hash TEXT NOT NULL);
ALTER TABLE public.room_network_contract ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_network_contract FROM PUBLIC, anon, authenticated, service_role;

-- Read-only duplicate lookup shares strict identity/fence handling with commits.
CREATE FUNCTION public.lookup_room_mutation(p_room_id TEXT,p_id TEXT,p_actor TEXT,p_endpoint TEXT,p_fingerprint TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.room_network_readiness_v2() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Room schema unavailable' USING ERRCODE = '55000'; END IF;
  IF p_endpoint IS NULL OR p_endpoint NOT IN ('action','step','claim-victory','core-move','brave-separation','pregame-update','replay-restore') THEN
    RAISE EXCEPTION 'Invalid mutation endpoint' USING ERRCODE = '22023';
  END IF;
  RETURN public.check_room_mutation_identity(p_room_id,p_id,p_actor,p_endpoint,p_fingerprint);
END;
$$;
REVOKE ALL ON FUNCTION public.lookup_room_mutation(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_room_mutation(TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE FUNCTION public.room_network_readiness_v2() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.room_network_readiness()
    AND (SELECT count(*) = 9 AND bool_and(p.oid IS NOT NULL AND md5(p.prosrc || coalesce(p.proconfig::text,'') || p.prosecdef::text || p.proowner::text) = c.source_hash
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
      FROM public.room_network_contract c LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(c.signature))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.room_mutation_cancellations'::regclass AND attname='request_fingerprint' AND atttypid='text'::regtype AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.rooms'::regclass AND tgname='require_atomic_room_state'
      AND tgfoid='public.require_atomic_room_state()'::regprocedure AND tgtype=19 AND tgenabled='O'
      AND tgqual IS NULL AND tgnargs=0
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid=tgrelid AND a.attnum=ANY(tgattr::smallint[]))=ARRAY['state','state_version'])
    AND NOT has_table_privilege('service_role','public.room_mutation_cancellations','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('service_role','public.replay_events','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('service_role','public.room_network_contract','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('anon','public.room_network_contract','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('authenticated','public.room_network_contract','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.rooms'::regclass,'public.replay_events'::regclass,'public.room_mutation_cancellations'::regclass,'public.room_network_contract'::regclass)
      AND (relowner IN ('service_role'::regrole,'anon'::regrole,'authenticated'::regrole)
        OR relowner <> (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='public.room_network_readiness_v2()'::regprocedure)))
    AND NOT has_table_privilege('anon','public.rooms','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('authenticated','public.rooms','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('anon','public.replay_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('authenticated','public.replay_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=to_regclass('public.uq_replay_events_room_client_mutation')
      AND indrelid='public.replay_events'::regclass AND indnkeyatts=2 AND indisunique AND indisvalid
      AND pg_get_indexdef(indexrelid,1,true)='room_id' AND pg_get_indexdef(indexrelid,2,true)='client_mutation_id'
      AND pg_get_expr(indpred,indrelid)='(client_mutation_id IS NOT NULL)')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.rooms'::regclass,'public.replay_events'::regclass,'public.room_mutation_cancellations'::regclass,'public.room_network_contract'::regclass) AND NOT relrowsecurity)
    AND has_function_privilege('service_role','public.commit_room_state(text,integer,jsonb,text,text,jsonb,text)','EXECUTE')
    AND has_function_privilege('service_role','public.initialize_room_state(text,jsonb,jsonb,text,jsonb,text)','EXECUTE')
    AND has_function_privilege('service_role','public.lookup_room_mutation(text,text,text,text,text)','EXECUTE')
    AND has_function_privilege('service_role','public.repair_room_state_from_replay(text,integer,integer,jsonb,text,jsonb)','EXECUTE')
    AND has_function_privilege('service_role','public.settle_room_mutation(text,text,text,text)','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.room_network_readiness_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_network_readiness_v2() TO service_role;
INSERT INTO public.room_network_contract SELECT signature,md5(p.prosrc || coalesce(p.proconfig::text,'') || p.prosecdef::text || p.proowner::text) FROM unnest(ARRAY[
  'public.commit_room_state(text,integer,jsonb,text,text,jsonb,text)',
  'public.initialize_room_state(text,jsonb,jsonb,text,jsonb,text)',
  'public.settle_room_mutation(text,text,text,text)',
  'public.check_room_mutation_identity(text,text,text,text,text)',
  'public.require_atomic_room_state()',
  'public.repair_room_state_from_replay(text,integer,integer,jsonb,text,jsonb)',
  'public.room_network_readiness()',
  'public.room_network_readiness_v2()',
  'public.lookup_room_mutation(text,text,text,text,text)'
]) signature JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(signature);
NOTIFY pgrst,'reload schema';
