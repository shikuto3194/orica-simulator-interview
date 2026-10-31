import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
// @ts-expect-error Operational Node module is exercised against real Postgres.
import { buildBackfillPublicationSql } from "../../../scripts/notices/backfill-publication.mjs";
// @ts-expect-error Operational Node module is exercised against real Postgres.
import { buildNoticeCorrectionSql } from "../../../scripts/notices/correction-publication.mjs";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
const notice = {
  title: "更新のお知らせ",
  introduction: "操作を改善しました。",
  items: [{ title: "デッキ選択", body: "色で絞り込めます。" }],
};
const sha = (n: number) => n.toString(16).padStart(40, "0");
async function complete(
  day: string,
  previousDay: string | null,
  previousRevision: string | null,
  revision: string,
  body: unknown = notice
) {
  return (
    await db.query<{ result: boolean }>(
      "SELECT public.complete_operation_notice_digest($1::date,$2,$3::date,$4,$5::jsonb,'{}'::jsonb) AS result",
      [
        previousDay,
        previousRevision,
        day,
        revision,
        body === null ? null : JSON.stringify(body),
      ]
    )
  ).rows[0]!.result;
}
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    INSERT INTO auth.users VALUES ('${alice}'), ('${bob}');`);
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261001150811_operation_notices.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  await db.exec(
    "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY); INSERT INTO supabase_migrations.schema_migrations VALUES ('20261001150811');"
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261001153830_operation_notice_migration_check.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
}, 30_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    "RESET ROLE; DELETE FROM public.operation_notices; UPDATE public.operation_notice_digest_state SET last_day=null,through_revision=null;"
  );
});
it("corrects text atomically and preserves publication time, reads and the digest cursor on retry", async () => {
  await complete("2020-01-01", null, null, sha(1));
  await db.query(
    "INSERT INTO public.operation_notice_reads VALUES ($1, '2020-01-01')",
    [alice]
  );
  const correction = {
    day: "2020-01-01",
    title: notice.title,
    introduction: {
      before: notice.introduction,
      after: "説明を訂正しました。' $notice_correction$",
    },
    items: [
      {
        index: 0,
        before: notice.items[0],
        after: { title: "対象を明記", body: "このカードが対象です。" },
      },
    ],
  };
  const published = (
    await db.query("SELECT published_at FROM public.operation_notices")
  ).rows;
  const reads = (await db.query("SELECT * FROM public.operation_notice_reads"))
    .rows;
  const cursor = (
    await db.query("SELECT * FROM public.operation_notice_digest_state")
  ).rows;
  const sql = buildNoticeCorrectionSql(correction);
  await db.exec(sql);
  await db.exec(sql);
  expect(
    (
      await db.query(
        "SELECT title,introduction,items FROM public.operation_notices"
      )
    ).rows
  ).toEqual([
    {
      title: notice.title,
      introduction: correction.introduction.after,
      items: [correction.items[0].after],
    },
  ]);
  expect(
    (await db.query("SELECT published_at FROM public.operation_notices")).rows
  ).toEqual(published);
  expect(
    (await db.query("SELECT * FROM public.operation_notice_reads")).rows
  ).toEqual(reads);
  expect(
    (await db.query("SELECT * FROM public.operation_notice_digest_state")).rows
  ).toEqual(cursor);
});
it("rejects stale corrections without overwriting an intervening edit", async () => {
  await complete("2020-01-01", null, null, sha(1));
  const correction = {
    day: "2020-01-01",
    title: notice.title,
    introduction: { before: notice.introduction, after: "訂正しました。" },
    items: [
      {
        index: 0,
        before: { ...notice.items[0], body: "古い内容" },
        after: { title: "訂正", body: "新しい内容" },
      },
    ],
  };
  await expect(db.exec(buildNoticeCorrectionSql(correction))).rejects.toThrow(
    "notice item changed"
  );
  await db.exec("ROLLBACK");
  expect(
    (
      await db.query(
        "SELECT title,introduction,items FROM public.operation_notices"
      )
    ).rows
  ).toEqual([notice]);
});
it("publishes one notice per day and prunes exactly the oldest with its reads", async () => {
  for (let day = 1; day <= 11; day++) {
    const date = `2020-01-${String(day).padStart(2, "0")}`;
    await complete(
      date,
      day === 1 ? null : `2020-01-${String(day - 1).padStart(2, "0")}`,
      day === 1 ? null : sha(day - 1),
      sha(day)
    );
    if (day === 1)
      await db.query(
        "INSERT INTO public.operation_notice_reads VALUES ($1, $2)",
        [alice, date]
      );
  }
  expect(
    (
      await db.query(
        "SELECT day::text FROM public.operation_notices ORDER BY day"
      )
    ).rows
  ).toEqual(
    Array.from({ length: 10 }, (_, i) => ({
      day: `2020-01-${String(i + 2).padStart(2, "0")}`,
    }))
  );
  expect(
    (await db.query("SELECT * FROM public.operation_notice_reads")).rows
  ).toHaveLength(0);
  expect(await complete("2020-01-01", null, null, sha(1))).toBe(false);
  expect(await complete("2020-01-11", "2020-01-10", sha(10), sha(11))).toBe(
    false
  );
});
it("empty days consume no notice slot; stale writers and malformed notices cannot advance the cursor", async () => {
  expect(await complete("2020-01-01", null, null, sha(1), null)).toBe(true);
  expect(
    (await db.query("SELECT * FROM public.operation_notices")).rows
  ).toHaveLength(0);
  await expect(complete("2020-01-02", null, null, sha(2))).rejects.toThrow(
    "state changed"
  );
  await expect(
    complete("2020-01-02", "2020-01-01", sha(1), sha(2), {
      ...notice,
      items: [{ title: "bad" }],
    })
  ).rejects.toThrow("invalid notice item");
  await expect(
    complete("2099-01-01", "2020-01-01", sha(1), sha(2))
  ).rejects.toThrow("invalid digest boundary");
  expect(
    (
      await db.query(
        "SELECT last_day::text FROM public.operation_notice_digest_state"
      )
    ).rows
  ).toEqual([{ last_day: "2020-01-01" }]);
});
it("only the publisher writes notices; authenticated readers can mark only their own reads", async () => {
  await db.exec("SET ROLE service_role");
  expect(
    (
      await db.query(
        "SELECT public.operation_notice_migrations_applied(ARRAY['20261001150811']) AS applied"
      )
    ).rows
  ).toEqual([{ applied: true }]);
  expect(
    (
      await db.query(
        "SELECT public.operation_notice_migrations_applied(ARRAY['20261001150811','not-applied']) AS applied"
      )
    ).rows
  ).toEqual([{ applied: false }]);
  await complete("2020-01-01", null, null, sha(1));
  await db.exec("RESET ROLE; SET ROLE anon");
  await expect(
    db.query("SELECT * FROM public.operation_notices")
  ).rejects.toThrow("permission denied");
  await db.exec(
    `RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='${alice}'`
  );
  expect(
    (await db.query("SELECT * FROM public.operation_notices")).rows
  ).toHaveLength(1);
  await expect(
    db.query("DELETE FROM public.operation_notices")
  ).rejects.toThrow("permission denied");
  await expect(
    complete("2020-01-02", "2020-01-01", sha(1), sha(2))
  ).rejects.toThrow("permission denied");
  await expect(
    db.query("SELECT * FROM public.operation_notice_digest_state")
  ).rejects.toThrow("permission denied");
  await expect(
    db.query(
      "SELECT public.operation_notice_migrations_applied(ARRAY['20261001150811'])"
    )
  ).rejects.toThrow("permission denied");
  await db.query(
    "INSERT INTO public.operation_notice_reads VALUES ($1, '2020-01-01') ON CONFLICT DO NOTHING",
    [alice]
  );
  await db.query(
    "INSERT INTO public.operation_notice_reads VALUES ($1, '2020-01-01') ON CONFLICT DO NOTHING",
    [alice]
  );
  await expect(
    db.query(
      "INSERT INTO public.operation_notice_reads VALUES ($1, '2020-01-01')",
      [bob]
    )
  ).rejects.toThrow("row-level security");
  await db.exec(`SET request.jwt.claim.sub='${bob}'`);
  expect(
    (await db.query("SELECT * FROM public.operation_notice_reads")).rows
  ).toHaveLength(0);
});

const backfill = {
  base: sha(1),
  throughRevision: sha(2),
  notices: ["2020-01-01", "2020-01-05", "2020-01-07"].map((day) => ({
    day,
    ...notice,
  })),
};
async function backfillSql(release = backfill) {
  const expected = (
    await db.query(
      "SELECT start_day::text,last_day::text,through_revision FROM public.operation_notice_digest_state WHERE singleton"
    )
  ).rows[0];
  return buildBackfillPublicationSql(release, expected, sha(3));
}
it("backfills three notices atomically, reserves the last notice day and preserves reads on retry", async () => {
  const sql = await backfillSql();
  await db.exec(sql);
  await db.query(
    "INSERT INTO public.operation_notice_reads VALUES ($1,'2020-01-07')",
    [alice]
  );
  const before = await db.query(
    "SELECT * FROM public.operation_notices ORDER BY day"
  );
  await db.exec(sql);
  expect(
    (await db.query("SELECT * FROM public.operation_notices ORDER BY day")).rows
  ).toEqual(before.rows);
  expect(
    (await db.query("SELECT * FROM public.operation_notice_reads")).rows
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "SELECT last_day::text,through_revision FROM public.operation_notice_digest_state"
      )
    ).rows
  ).toEqual([{ last_day: "2020-01-07", through_revision: sha(2) }]);
  // The next midnight cannot insert a second row for the reserved summary date.
  expect(await complete("2020-01-07", "2020-01-07", sha(2), sha(3))).toBe(
    false
  );
  expect(await complete("2020-01-08", "2020-01-07", sha(2), sha(3))).toBe(true);
  expect(
    (await db.query("SELECT * FROM public.operation_notices")).rows
  ).toHaveLength(4);
});
it("rejects stale, partial and different backfill publications without changing any rows", async () => {
  const sql = await backfillSql();
  await complete("2019-12-31", null, null, sha(1));
  await expect(db.exec(sql)).rejects.toThrow("changed");
  await db.exec("ROLLBACK");
  expect(
    (await db.query("SELECT day::text FROM public.operation_notices")).rows
  ).toEqual([{ day: "2019-12-31" }]);
  await db.exec(
    "DELETE FROM public.operation_notices; UPDATE public.operation_notice_digest_state SET last_day=null,through_revision=null"
  );
  await db.query(
    "INSERT INTO public.operation_notices(day,title,introduction,items) VALUES ('2020-01-01',$1,$2,$3::jsonb)",
    [notice.title, notice.introduction, JSON.stringify(notice.items)]
  );
  await expect(db.exec(sql)).rejects.toThrow("changed");
  await db.exec("ROLLBACK; DELETE FROM public.operation_notices");
  await db.exec(sql);
  const different = {
    ...backfill,
    notices: backfill.notices.map((entry, index) =>
      index === 0 ? { ...entry, title: "別の本文" } : entry
    ),
  };
  await expect(
    db.exec(
      buildBackfillPublicationSql(
        different,
        { start_day: "2026-10-01", last_day: null, through_revision: null },
        sha(3)
      )
    )
  ).rejects.toThrow("changed");
  await db.exec("ROLLBACK");
  expect(
    (
      await db.query(
        "SELECT title FROM public.operation_notices WHERE day='2020-01-01'"
      )
    ).rows
  ).toEqual([{ title: notice.title }]);
});
it("quotes publication text safely, including SQL dollar delimiters", async () => {
  const body =
    "記号 ' と $notice_publication$ と $notice_publication_1$ を表示します。";
  const quoted = {
    ...backfill,
    notices: backfill.notices.map((entry) => ({
      ...entry,
      items: [{ title: "引用", body }],
    })),
  };
  await db.exec(await backfillSql(quoted));
  expect(
    (
      await db.query<{ items: { body: string }[] }>(
        "SELECT items FROM public.operation_notices ORDER BY day"
      )
    ).rows.every((entry) => entry.items[0]?.body === body)
  ).toBe(true);
});
