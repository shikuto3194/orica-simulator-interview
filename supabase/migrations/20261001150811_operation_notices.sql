-- Daily operation notices. Only the scheduled publisher may write notices/state.
-- 適用日: 2026-10-02 (JST), MCP history version 20261001150811.
CREATE TABLE public.operation_notices (
  day date PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  introduction text NOT NULL CHECK (char_length(introduction) BETWEEN 1 AND 400),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.operation_notice_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_day date NOT NULL REFERENCES public.operation_notices(day) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notice_day)
);
CREATE INDEX operation_notice_reads_notice_day_idx ON public.operation_notice_reads(notice_day);
CREATE TABLE public.operation_notice_digest_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  start_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo')::date - 1),
  last_day date,
  through_revision text CHECK (through_revision ~ '^[0-9a-f]{40}$'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO public.operation_notice_digest_state(singleton) VALUES (true);
ALTER TABLE public.operation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_notice_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_notice_digest_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_notices, public.operation_notice_reads, public.operation_notice_digest_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.operation_notices TO authenticated;
GRANT SELECT, INSERT ON public.operation_notice_reads TO authenticated;
GRANT ALL ON public.operation_notices, public.operation_notice_reads, public.operation_notice_digest_state TO service_role;
CREATE POLICY operation_notices_read ON public.operation_notices FOR SELECT TO authenticated USING (true);
CREATE POLICY operation_notice_reads_own ON public.operation_notice_reads FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY operation_notice_reads_insert ON public.operation_notice_reads FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

-- The cursor, publication and retention change atomically. Empty days advance only
-- the cursor; retries after success never recreate even a notice already pruned.
CREATE FUNCTION public.complete_operation_notice_digest(
  p_expected_day date, p_expected_revision text, p_day date,
  p_revision text, p_notice jsonb, p_evidence jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE current_state public.operation_notice_digest_state%ROWTYPE; item jsonb;
BEGIN
  SELECT * INTO STRICT current_state FROM public.operation_notice_digest_state WHERE singleton FOR UPDATE;
  IF current_state.last_day >= p_day THEN RETURN false; END IF;
  IF current_state.last_day IS DISTINCT FROM p_expected_day OR current_state.through_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'digest state changed; retry';
  END IF;
  IF p_day IS NULL OR p_day >= (now() AT TIME ZONE 'Asia/Tokyo')::date OR p_revision IS NULL OR p_revision !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'invalid digest boundary';
  END IF;
  IF p_notice IS NOT NULL THEN
    IF jsonb_typeof(p_notice) IS DISTINCT FROM 'object' OR
       jsonb_typeof(p_notice->'title') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_notice->'introduction') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_notice->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid notice';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_notice->'items') LOOP
      IF jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR
         jsonb_typeof(item->'body') IS DISTINCT FROM 'string' OR
         char_length(item->>'title') NOT BETWEEN 1 AND 100 OR
         char_length(item->>'body') NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'invalid notice item';
      END IF;
    END LOOP;
    INSERT INTO public.operation_notices(day, title, introduction, items)
      VALUES (p_day, p_notice->>'title', p_notice->>'introduction', p_notice->'items');
    DELETE FROM public.operation_notices WHERE day IN (
      SELECT day FROM public.operation_notices ORDER BY day DESC OFFSET 10
    );
  END IF;
  UPDATE public.operation_notice_digest_state SET last_day = p_day, through_revision = p_revision,
    evidence = coalesce(p_evidence, '{}'::jsonb) WHERE singleton;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_operation_notice_digest(date,text,date,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_operation_notice_digest(date,text,date,text,jsonb,jsonb) TO service_role;
