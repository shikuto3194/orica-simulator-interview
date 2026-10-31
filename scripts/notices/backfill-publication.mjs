import { SHA, dayBounds } from "./digest.mjs";

const literal = (value) =>
  value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

/** Produce reviewable SQL only. The operator confirms both live releases first. */
export function buildBackfillPublicationSql(
  release,
  expectedState,
  publicationRevision,
  expectedNoticeCount = 0
) {
  if (
    !SHA.test(release.base) ||
    !SHA.test(release.throughRevision) ||
    !SHA.test(publicationRevision) ||
    !Array.isArray(release.notices) ||
    release.notices.length !== 3 ||
    !Number.isInteger(expectedNoticeCount) ||
    expectedNoticeCount < 0
  )
    throw new Error("Invalid backfill publication");
  const bounded = (value, max) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const days = new Set();
  for (const notice of release.notices) {
    dayBounds(notice.day);
    if (
      days.has(notice.day) ||
      !bounded(notice.title, 100) ||
      !bounded(notice.introduction, 400) ||
      !Array.isArray(notice.items) ||
      !notice.items.length ||
      notice.items.length > 20 ||
      notice.items.some(
        (item) => !bounded(item.title, 100) || !bounded(item.body, 600)
      )
    )
      throw new Error("Invalid backfill notice");
    days.add(notice.day);
  }
  dayBounds(expectedState.start_day);
  if (expectedState.last_day !== null) dayBounds(expectedState.last_day);
  if (
    expectedState.through_revision !== null &&
    !SHA.test(expectedState.through_revision)
  )
    throw new Error("Invalid expected digest state");
  const cursorDay = [...days].sort().at(-1);
  const payload = literal(JSON.stringify(release.notices));
  const evidence = literal(
    JSON.stringify({
      kind: "release-backfill-20261002",
      base: release.base,
      revision: release.throughRevision,
      publicationRevision,
      days: [...days].sort(),
    })
  );
  let delimiter = "$notice_publication$";
  for (
    let counter = 1;
    payload.includes(delimiter) || evidence.includes(delimiter);
    counter++
  ) {
    delimiter = `$notice_publication_${counter}$`;
  }
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO ${delimiter}
DECLARE
  saved public.operation_notice_digest_state%ROWTYPE;
  notices jsonb := ${payload}::jsonb;
  present integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('orica.operation-notices', 0)) THEN
    RAISE EXCEPTION 'notice publication is already running';
  END IF;
  SELECT * INTO STRICT saved FROM public.operation_notice_digest_state WHERE singleton FOR UPDATE NOWAIT;
  LOCK TABLE public.operation_notices IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  IF ${literal(cursorDay)}::date > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION 'backfill includes a future day';
  END IF;
  SELECT count(*) INTO present FROM public.operation_notices n
    JOIN jsonb_array_elements(notices) expected ON n.day = (expected->>'day')::date;
  IF present = 3 AND NOT EXISTS (
    SELECT 1 FROM public.operation_notices n
    JOIN jsonb_array_elements(notices) expected ON n.day = (expected->>'day')::date
    WHERE n.title IS DISTINCT FROM expected->>'title'
      OR n.introduction IS DISTINCT FROM expected->>'introduction'
      OR n.items IS DISTINCT FROM expected->'items'
  ) AND saved.last_day >= ${literal(cursorDay)}::date AND saved.through_revision IS NOT NULL THEN
    RETURN; -- preserve published_at and every existing read on an exact retry
  END IF;
  IF present <> 0 OR (SELECT count(*) FROM public.operation_notices) <> ${expectedNoticeCount}
    OR saved.start_day IS DISTINCT FROM ${literal(expectedState.start_day)}::date
    OR saved.last_day IS DISTINCT FROM ${literal(expectedState.last_day)}::date
    OR saved.through_revision IS DISTINCT FROM ${literal(expectedState.through_revision)} THEN
    RAISE EXCEPTION 'notice data or digest state changed; review before retry';
  END IF;
  INSERT INTO public.operation_notices(day,title,introduction,items)
    SELECT (notice->>'day')::date, notice->>'title', notice->>'introduction', notice->'items'
    FROM jsonb_array_elements(notices) notice;
  DELETE FROM public.operation_notices WHERE day IN (
    SELECT day FROM public.operation_notices ORDER BY day DESC OFFSET 10
  );
  UPDATE public.operation_notice_digest_state SET
    last_day = ${literal(cursorDay)}::date,
    through_revision = ${literal(release.throughRevision)},
    evidence = ${evidence}::jsonb WHERE singleton;
END;
${delimiter};
COMMIT;
SELECT day,title,published_at FROM public.operation_notices ORDER BY day DESC;
`;
}
