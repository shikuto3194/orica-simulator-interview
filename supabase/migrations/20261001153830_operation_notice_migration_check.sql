-- Only the publisher may check application migration history; no SQL text is exposed.
CREATE FUNCTION public.operation_notice_migrations_applied(p_versions text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_versions IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest(p_versions) AS required(version)
    WHERE required.version IS NULL OR NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations AS applied
      WHERE applied.version = required.version
    )
  );
$$;
REVOKE ALL ON FUNCTION public.operation_notice_migrations_applied(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operation_notice_migrations_applied(text[]) TO service_role;
