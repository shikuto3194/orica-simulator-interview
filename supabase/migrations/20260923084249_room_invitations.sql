-- 適用日: 2026-09-23
-- JWT is verified by the Game API. Clients cannot call these RPCs or access invitations directly.
CREATE TABLE public.room_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  read_at timestamptz,
  accepted_at timestamptz,
  push_processed_at timestamptz,
  push_attempts integer NOT NULL DEFAULT 0,
  next_push_attempt_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id),
  UNIQUE (room_id, recipient_id)
);
CREATE INDEX room_invitations_inbox ON public.room_invitations(recipient_id, created_at DESC);
CREATE INDEX room_invitations_sender ON public.room_invitations(sender_id);
CREATE INDEX room_invitations_push_pending ON public.room_invitations(next_push_attempt_at)
  WHERE push_processed_at IS NULL AND push_attempts < 5;
ALTER TABLE public.room_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_invitations TO service_role;

CREATE FUNCTION public.send_room_invitation(p_room_id text, p_sender_id uuid, p_recipient_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;

-- Both ID/QR joins and invitation acceptance serialize on the same room row.
-- Acceptance, read receipt and seat assignment commit together, and retries reconnect the same seat.
CREATE FUNCTION public.join_room(p_room_id text, p_user_id uuid, p_invitation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;
REVOKE ALL ON FUNCTION public.send_room_invitation(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_room(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_room_invitation(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_room(text, uuid, uuid) TO service_role;

-- Deck selection can overlap an invitation acceptance. Never write a stale players array.
CREATE FUNCTION public.set_room_deck(p_room_id text, p_user_id uuid, p_deck jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;
REVOKE ALL ON FUNCTION public.set_room_deck(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_deck(text, uuid, jsonb) TO service_role;

CREATE TABLE public.room_push_subscriptions (
  endpoint text PRIMARY KEY CHECK (length(endpoint) <= 2048),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_push_subscriptions_user ON public.room_push_subscriptions(user_id);
ALTER TABLE public.room_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_push_subscriptions TO service_role;
