-- Interview-only room RPCs copied from the current simulator schema after source review.
-- Tenant assignment triggers fill interview_id for service-role writes using room membership.
CREATE OR REPLACE FUNCTION public.check_room_mutation_identity(p_room_id text, p_id text, p_actor text, p_endpoint text, p_fingerprint text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.commit_room_state(p_room_id text, p_expected_version integer, p_state jsonb, p_acting_player_id text, p_endpoint text, p_payload jsonb, p_client_mutation_id text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, new_version integer, current_version integer, duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_room(p_room_id text, p_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 UPDATE public.rooms SET
   connected = COALESCE(connected, '{}'::jsonb) || jsonb_build_object(p_user_id, true),
   last_heartbeat = COALESCE(last_heartbeat, '{}'::jsonb) || jsonb_build_object(p_user_id, now()),
   all_disconnected_at = NULL
 WHERE id = p_room_id AND players @> jsonb_build_array(jsonb_build_object('supabaseUserId', p_user_id));
 RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.initialize_room_state(p_room_id text, p_expected_players jsonb, p_state jsonb, p_acting_player_id text, p_payload jsonb, p_client_mutation_id text)
 RETURNS TABLE(ok boolean, new_version integer, current_version integer, duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.join_room(p_room_id text, p_user_id uuid, p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.rooms%ROWTYPE; inv public.room_invitations%ROWTYPE; player_role text; reconnected boolean;
BEGIN
  IF p_invitation_id IS NOT NULL THEN
    SELECT * INTO inv FROM public.room_invitations WHERE id = p_invitation_id AND recipient_id = p_user_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', '招待が見つかりません', 'status', 404); END IF;
    IF inv.room_id <> p_room_id THEN RETURN jsonb_build_object('error', '招待先が一致しません', 'status', 400); END IF;
    IF inv.accepted_at IS NULL AND inv.expires_at <= now() THEN
      RETURN jsonb_build_object('error', '招待の有効期限が切れています', 'status', 410);
    END IF;
  END IF;
  SELECT * INTO r FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ルームは削除されています', 'status', 404); END IF;
  SELECT p->>'role' INTO player_role FROM jsonb_array_elements(r.players) p WHERE p->>'supabaseUserId' = p_user_id::text;
  reconnected := player_role IS NOT NULL;
  IF NOT reconnected THEN
    IF r.state IS NOT NULL OR jsonb_array_length(r.players) >= 2 THEN
      RETURN jsonb_build_object('error', 'このルームは参加を締め切りました', 'status', 409);
    END IF;
    player_role := CASE WHEN r.players->0->>'role' = 'alice' THEN 'bob' ELSE 'alice' END;
    r.players := r.players || jsonb_build_array(jsonb_build_object('supabaseUserId', p_user_id::text, 'role', player_role, 'deckCardNos', NULL));
  END IF;
  UPDATE public.rooms SET players = r.players,
    connected = coalesce(r.connected, '{}'::jsonb) || jsonb_build_object(p_user_id::text, true),
    last_heartbeat = coalesce(r.last_heartbeat, '{}'::jsonb) || jsonb_build_object(p_user_id::text, now()),
    all_disconnected_at = NULL WHERE id = p_room_id;
  IF p_invitation_id IS NOT NULL THEN
    UPDATE public.room_invitations SET read_at = coalesce(read_at, now()), accepted_at = coalesce(accepted_at, now()) WHERE id = p_invitation_id;
  END IF;
  RETURN jsonb_build_object('roomId', p_room_id, 'role', player_role, 'reconnected', reconnected);
END;
$function$;

CREATE OR REPLACE FUNCTION public.lookup_room_mutation(p_room_id text, p_id text, p_actor text, p_endpoint text, p_fingerprint text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.room_network_readiness_v2() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Room schema unavailable' USING ERRCODE = '55000'; END IF;
  IF p_endpoint IS NULL OR p_endpoint NOT IN ('action','step','claim-victory','core-move','brave-separation','pregame-update','replay-restore') THEN
    RAISE EXCEPTION 'Invalid mutation endpoint' USING ERRCODE = '22023';
  END IF;
  RETURN public.check_room_mutation_identity(p_room_id,p_id,p_actor,p_endpoint,p_fingerprint);
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_room_state_from_replay(p_room_id text, p_expected_room_version integer, p_replayed_to_version integer, p_state jsonb, p_acting_player_id text, p_payload jsonb)
 RETURNS TABLE(ok boolean, new_version integer, current_version integer, event_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.send_room_invitation(p_room_id text, p_sender_id uuid, p_recipient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.rooms%ROWTYPE; invitation_id uuid;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ルームは削除されています', 'status', 404); END IF;
  IF NOT r.players @> jsonb_build_array(jsonb_build_object('supabaseUserId', p_sender_id::text, 'role', 'alice')) THEN
    RETURN jsonb_build_object('error', '招待できるのはルーム作成者だけです', 'status', 403);
  END IF;
  IF r.state IS NOT NULL OR jsonb_array_length(r.players) >= 2 THEN
    RETURN jsonb_build_object('error', 'このルームは参加を締め切りました', 'status', 409);
  END IF;
  IF p_sender_id = p_recipient_id OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_recipient_id) THEN
    RETURN jsonb_build_object('error', '招待先のユーザーを確認してください', 'status', 400);
  END IF;
  INSERT INTO public.room_invitations(room_id, sender_id, recipient_id)
    VALUES (p_room_id, p_sender_id, p_recipient_id)
    ON CONFLICT (room_id, recipient_id) DO UPDATE
      SET created_at = now(), expires_at = now() + interval '24 hours', read_at = NULL,
          push_processed_at = NULL, push_attempts = 0, next_push_attempt_at = now()
      WHERE room_invitations.expires_at <= now() AND room_invitations.accepted_at IS NULL
    RETURNING id INTO invitation_id;
  IF invitation_id IS NULL THEN
    SELECT id INTO invitation_id FROM public.room_invitations WHERE room_id = p_room_id AND recipient_id = p_recipient_id;
  END IF;
  RETURN jsonb_build_object('id', invitation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_room_deck(p_room_id text, p_user_id uuid, p_deck jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.rooms%ROWTYPE; updated_players jsonb;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ルームは削除されています', 'status', 404); END IF;
  IF NOT r.players @> jsonb_build_array(jsonb_build_object('supabaseUserId', p_user_id::text)) THEN
    RETURN jsonb_build_object('error', 'ルームの参加者ではありません', 'status', 403);
  END IF;
  IF r.state IS NOT NULL THEN RETURN jsonb_build_object('error', '対戦は開始済みです', 'status', 409); END IF;
  SELECT jsonb_agg(CASE WHEN p->>'supabaseUserId' = p_user_id::text THEN p || jsonb_build_object('deckCardNos', p_deck) ELSE p END ORDER BY ord)
    INTO updated_players FROM jsonb_array_elements(r.players) WITH ORDINALITY AS elements(p, ord);
  UPDATE public.rooms SET players = updated_players WHERE id = p_room_id;
  RETURN jsonb_build_object('ok', true, 'allReady', jsonb_array_length(updated_players) = 2 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(updated_players) p WHERE p->>'deckCardNos' IS NULL
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_room_mutation(p_room_id text, p_client_mutation_id text, p_acting_player_id text, p_fingerprint text)
 RETURNS TABLE(outcome text, applied_version integer, room_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function private.assign_room_interview_id()
returns trigger language plpgsql set search_path = '' as $$
declare tenant uuid;
begin
 if tg_op='UPDATE' then
   if new.interview_id is distinct from old.interview_id then raise exception 'interview_id cannot be changed' using errcode='42501'; end if;
   return new;
 end if;
 if auth.uid() is not null then tenant:=private.active_interview_id();
 else
   select m.interview_id into tenant
   from private.interview_memberships m join private.interviews i on i.id=m.interview_id
   where m.user_id=(new.players->0->>'supabaseUserId')::uuid and m.state='active' and i.state='active' and not i.is_seed
   limit 1;
 end if;
 if tenant is null then raise exception 'active interview membership required' using errcode='42501'; end if;
 new.interview_id:=tenant;
 return new;
end; $$;

create or replace function private.assign_room_child_interview_id()
returns trigger language plpgsql set search_path = '' as $$
declare tenant uuid;
begin
 if tg_op='UPDATE' then
   if new.interview_id is distinct from old.interview_id then raise exception 'interview_id cannot be changed' using errcode='42501'; end if;
   return new;
 end if;
 if auth.uid() is not null then tenant:=private.active_interview_id();
 else select r.interview_id into tenant from public.rooms r where r.id=new.room_id limit 1;
 end if;
 if tenant is null then raise exception 'active room tenant required' using errcode='42501'; end if;
 new.interview_id:=tenant;
 return new;
end; $$;

create or replace function private.assign_push_interview_id()
returns trigger language plpgsql set search_path = '' as $$
declare tenant uuid;
begin
 if tg_op='UPDATE' then
   if new.interview_id is distinct from old.interview_id then raise exception 'interview_id cannot be changed' using errcode='42501'; end if;
   return new;
 end if;
 if auth.uid() is not null then tenant:=private.active_interview_id();
 else
   select m.interview_id into tenant from private.interview_memberships m
   join private.interviews i on i.id=m.interview_id
   where m.user_id=new.user_id and m.state='active' and i.state='active' and not i.is_seed limit 1;
 end if;
 if tenant is null then raise exception 'active interview membership required' using errcode='42501'; end if;
 new.interview_id:=tenant;
 return new;
end; $$;

create trigger rooms_assign_interview_id before insert or update on public.rooms
for each row execute function private.assign_room_interview_id();
create trigger replay_events_assign_interview_id before insert or update on public.replay_events
for each row execute function private.assign_room_child_interview_id();
create trigger invitations_assign_interview_id before insert or update on public.room_invitations
for each row execute function private.assign_room_child_interview_id();
create trigger cancellations_assign_interview_id before insert or update on public.room_mutation_cancellations
for each row execute function private.assign_room_child_interview_id();
create trigger push_assign_interview_id before insert or update on public.room_push_subscriptions
for each row execute function private.assign_push_interview_id();

create or replace function public.require_atomic_room_state()
returns trigger language plpgsql set search_path = '' as $$
begin
 if (new.state is distinct from old.state or new.state_version is distinct from old.state_version)
    and current_setting('orica.atomic_room_commit',true) is distinct from 'on' then
   raise exception 'Room state requires atomic commit' using errcode='55000';
 end if;
 return new;
end; $$;

create trigger require_atomic_room_state before update of state,state_version on public.rooms
for each row execute function public.require_atomic_room_state();

alter table public.room_invitations add constraint room_invitations_room_recipient_global_unique unique(room_id,recipient_id);
create unique index replay_events_room_version_global_uq on public.replay_events(room_id,state_version);
create unique index replay_events_room_mutation_global_uq on public.replay_events(room_id,client_mutation_id) where client_mutation_id is not null;
create unique index room_mutation_cancellations_global_uq on public.room_mutation_cancellations(room_id,client_mutation_id,acting_player_id);

create trigger assign_interview_id_decks before insert or update on public.decks for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_events before insert or update on public.events for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_participants before insert or update on public.event_participants for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_rounds before insert or update on public.event_rounds for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_matches before insert or update on public.round_matches for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_preview_cards before insert or update on public.preview_cards for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_snapshots before insert or update on public.snapshots for each row execute function private.assign_active_interview_id();
create trigger assign_interview_id_notice_reads before insert or update on public.operation_notice_reads for each row execute function private.assign_active_interview_id();

create or replace function public.room_network_readiness()
returns boolean language sql stable security definer set search_path = '' as $$
 select pg_catalog.to_regprocedure('public.commit_room_state(text,integer,jsonb,text,text,jsonb,text)') is not null
 and pg_catalog.to_regprocedure('public.repair_room_state_from_replay(text,integer,integer,jsonb,text,jsonb)') is not null
 and pg_catalog.to_regprocedure('public.heartbeat_room(text,text)') is not null
 and pg_catalog.to_regprocedure('public.settle_room_mutation(text,text,text,text)') is not null;
$$;
create or replace function public.room_network_readiness_v2()
returns boolean language sql stable security definer set search_path = '' as $$
 select public.room_network_readiness()
 and exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.rooms'::regclass and tgname='require_atomic_room_state' and tgenabled='O')
 and exists(select 1 from pg_catalog.pg_index where indexrelid=pg_catalog.to_regclass('public.replay_events_room_version_global_uq') and indisvalid and indisunique)
 and exists(select 1 from pg_catalog.pg_attribute where attrelid='public.snapshots'::regclass and attname='is_server_checkpoint' and not attisdropped);
$$;

revoke all on function public.check_room_mutation_identity(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.commit_room_state(text,integer,jsonb,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.heartbeat_room(text,text) from public,anon,authenticated;
revoke all on function public.initialize_room_state(text,jsonb,jsonb,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.join_room(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.lookup_room_mutation(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.repair_room_state_from_replay(text,integer,integer,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.send_room_invitation(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_room_deck(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.settle_room_mutation(text,text,text,text) from public,anon,authenticated;
revoke all on function public.room_network_readiness() from public,anon,authenticated;
revoke all on function public.room_network_readiness_v2() from public,anon,authenticated;
grant execute on function public.check_room_mutation_identity(text,text,text,text,text) to service_role;
grant execute on function public.commit_room_state(text,integer,jsonb,text,text,jsonb,text) to service_role;
grant execute on function public.heartbeat_room(text,text) to service_role;
grant execute on function public.initialize_room_state(text,jsonb,jsonb,text,jsonb,text) to service_role;
grant execute on function public.join_room(text,uuid,uuid) to service_role;
grant execute on function public.lookup_room_mutation(text,text,text,text,text) to service_role;
grant execute on function public.repair_room_state_from_replay(text,integer,integer,jsonb,text,jsonb) to service_role;
grant execute on function public.send_room_invitation(text,uuid,uuid) to service_role;
grant execute on function public.set_room_deck(text,uuid,jsonb) to service_role;
grant execute on function public.settle_room_mutation(text,text,text,text) to service_role;
grant execute on function public.room_network_readiness() to service_role;
grant execute on function public.room_network_readiness_v2() to service_role;

