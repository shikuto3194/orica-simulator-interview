import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
async function asUser(action: () => Promise<unknown>) {
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
    USER,
  ]);
  try {
    return await action();
  } finally {
    await db.exec("rollback");
  }
}
async function save(deck: unknown) {
  const result = await db.query<{ value: { scope_key: string } }>(
    "select public.bs_deck_library('list') as value"
  );
  return db.query("select public.bs_deck_library('save', $1, $2::jsonb)", [
    result.rows[0].value.scope_key,
    JSON.stringify(deck),
  ]);
}

describe("form input constraints on real PostgreSQL paths", () => {
  beforeAll(async () => {
    db = await PGlite.create();
    for (const file of [
      "supabase/tests/fixtures/bs-account-links.sql",
      "supabase/migrations/20260917073409_bs_account_linking.sql",
      "supabase/migrations/20260921121345_input_form_validation.sql",
    ])
      await db.exec(readFileSync(file, "utf8"));
  });
  afterAll(async () => {
    await db.close();
  });

  it.each([1e12, 1.5, 0, -1, "3", null])(
    "rejects count %s through RPC and direct writes",
    async (count) => {
      const cards = [{ id: 7, count }];
      await expect(
        asUser(() => save({ name: "test", cards }))
      ).rejects.toThrow();
      await expect(
        asUser(() =>
          db.query(
            "insert into public.decks(user_id,game,name,cards) values($1,'bs','test',$2::jsonb)",
            [USER, JSON.stringify(cards)]
          )
        )
      ).rejects.toThrow();
    }
  );
  it.each([
    { name: "a".repeat(101), cards: [] },
    { name: 123, cards: [] },
    { name: {}, cards: [] },
    { name: "test", cards: [{ id: 0, count: 1 }] },
    { name: "test", cards: [{ id: 7 }] },
    {
      name: "test",
      cards: Array.from({ length: 1001 }, () => ({ id: 7, count: 1 })),
    },
    {
      name: "test",
      cards: [
        { id: 7, count: 600 },
        { id: 7, count: 401 },
      ],
    },
    { name: "test", cards: [], token_deck: [{ id: 7, count: 1001 }] },
    { name: "test", cards: [], token_deck: {} },
  ])("rejects malformed or oversized deck $name", async (deck) => {
    await expect(asUser(() => save(deck))).rejects.toThrow();
  });
  it("protects direct UPDATE and display names without limiting ACG cards", async () => {
    await expect(
      asUser(async () => {
        await save({ name: "before", cards: [] });
        await db.query("update public.decks set name=$1 where user_id=$2", [
          "a".repeat(101),
          USER,
        ]);
      })
    ).rejects.toThrow();
    await expect(
      asUser(() =>
        db.query(
          "update public.profiles set display_name=$1 where user_id=$2",
          ["😀".repeat(31), USER]
        )
      )
    ).rejects.toThrow();
    await asUser(() =>
      db.query(
        "insert into public.decks(user_id,game,name,cards) values($1,'acg','unchanged',$2::jsonb)",
        [USER, '[{"id":7,"count":1001}]']
      )
    );
  });
  it("accepts boundary values and stores SQL/HTML as literal text", async () => {
    await asUser(async () => {
      const name = "'); SELECT 'literal'; -- <img src=x onerror=alert(1)>";
      await save({ name, cards: [{ id: 7, count: 1000 }], token_deck: [] });
      await save({
        name: "😀".repeat(100),
        cards: [],
        token_deck: [{ id: 8, count: 1000 }],
      });
      await db.query(
        "update public.profiles set display_name=$1 where user_id=$2",
        ["😀".repeat(30), USER]
      );
      const saved = await db.query<{ name: string }>(
        "select name from public.decks where name=$1",
        [name]
      );
      expect(saved.rows[0].name).toBe(name);
    });
  });
});
