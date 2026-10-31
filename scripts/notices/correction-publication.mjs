import { dayBounds } from "./digest.mjs";

/** Reviewable, compare-and-set correction; never republishes or advances the digest. */
export function buildNoticeCorrectionSql(correction) {
  dayBounds(correction.day);
  const bounded = (value, max) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const itemValid = (item) =>
    item && bounded(item.title, 100) && bounded(item.body, 600);
  const indices = new Set();
  if (
    !bounded(correction.title, 100) ||
    !bounded(correction.introduction?.before, 400) ||
    !bounded(correction.introduction?.after, 400) ||
    !Array.isArray(correction.items) ||
    !correction.items.length ||
    correction.items.length > 20
  )
    throw new Error("Invalid notice correction");
  for (const item of correction.items) {
    if (
      !Number.isInteger(item.index) ||
      item.index < 0 ||
      item.index >= 20 ||
      indices.has(item.index) ||
      !itemValid(item.before) ||
      !itemValid(item.after)
    )
      throw new Error("Invalid correction item");
    indices.add(item.index);
  }
  const payload = `'${JSON.stringify(correction).replaceAll("'", "''")}'`;
  let delimiter = "$notice_correction$";
  for (let n = 1; payload.includes(delimiter); n++)
    delimiter = `$notice_correction_${n}$`;
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO ${delimiter}
DECLARE
  edit jsonb := ${payload}::jsonb;
  saved public.operation_notices%ROWTYPE;
  item jsonb;
  revised jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('orica.operation-notices', 0)) THEN
    RAISE EXCEPTION 'notice publication is already running';
  END IF;
  SELECT * INTO STRICT saved FROM public.operation_notices WHERE day = (edit->>'day')::date FOR UPDATE NOWAIT;
  IF saved.title IS DISTINCT FROM edit->>'title' THEN
    RAISE EXCEPTION 'notice title changed; review before retry';
  END IF;
  IF saved.introduction = edit->'introduction'->>'after' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(edit->'items') patch
    WHERE saved.items->(patch->>'index')::integer IS DISTINCT FROM patch->'after'
  ) THEN RETURN; END IF;
  IF saved.introduction IS DISTINCT FROM edit->'introduction'->>'before' THEN
    RAISE EXCEPTION 'notice introduction changed; review before retry';
  END IF;
  revised := saved.items;
  FOR item IN SELECT * FROM jsonb_array_elements(edit->'items') LOOP
    IF saved.items->(item->>'index')::integer IS DISTINCT FROM item->'before' THEN
      RAISE EXCEPTION 'notice item changed; review before retry';
    END IF;
    revised := jsonb_set(revised, ARRAY[item->>'index'], item->'after', false);
  END LOOP;
  UPDATE public.operation_notices SET introduction = edit->'introduction'->>'after', items = revised WHERE day = saved.day;
END;
${delimiter};
COMMIT;
SELECT day,title,introduction,items,published_at FROM public.operation_notices WHERE day = '${correction.day}'::date;
`;
}
