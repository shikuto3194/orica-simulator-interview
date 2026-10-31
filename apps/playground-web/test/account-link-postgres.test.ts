import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

const MAIN = "00000000-0000-4000-8000-000000000001";
const SUB = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
async function asUser<T>(id: string, action: () => Promise<T>): Promise<T> {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
  try {
    const result = await action();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function rpc(name: string, args: string, params: unknown[] = []) {
  const result = await db.query<{
    value: {
      owner_id: string;
      scope_key: string;
      revision: string | null;
      decks: Array<{
        id: string;
        name: string;
        token_deck: unknown[];
        thumbnail_card_id: number | null;
      }>;
    };
  }>(`select public.${name}(${args}) as value`, params);
  return result.rows[0].value;
}
async function list(id: string) {
  return asUser(id, () => rpc("bs_deck_library", "'list'"));
}
async function configure(account = true, deck = true, swap = false) {
  return asUser(MAIN, async () => {
    const old = await rpc("bs_admin_account_link", "");
    return rpc("bs_admin_account_link", "$1::jsonb", [
      JSON.stringify({
        revision: old.revision,
        main_email: swap ? "sub@example.test" : "main@example.test",
        sub_email: swap ? "main@example.test" : "sub@example.test",
        account_enabled: account,
        deck_enabled: deck,
      }),
    ]);
  });
}
async function save(id: string, scope: string, name: string) {
  return asUser(id, () =>
    rpc("bs_deck_library", "'save', $1, $2::jsonb", [
      scope,
      JSON.stringify({ name, cards: [{ id: 7, count: 3 }], token_deck: [] }),
    ])
  );
}
describe("BS account linking PostgreSQL authorization and transitions", () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(
      readFileSync("supabase/tests/fixtures/bs-account-links.sql", "utf8")
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20260917073409_bs_account_linking.sql",
        "utf8"
      )
    );
  });
  beforeEach(async () => {
    await db.exec(`truncate private.bs_account_links, private.bs_deck_epochs, public.decks;
      insert into public.decks (user_id, game, name, cards, token_deck, thumbnail_card_id)
      values ('${MAIN}', 'bs', 'main original', '[{"id":1,"count":3}]', '[{"id":2,"count":1}]', 1),
             ('${SUB}', 'bs', 'sub original', '[]', '[]', null), ('${SUB}', 'acg', 'acg untouched', '[]', '[]', null);`);
  });
  afterAll(async () => {
    await db.close();
  });
  it("ON deletes old sub data, shares edits and deletes; OFF forks current data with no resurrection", async () => {
    await configure();
    const shared = await list(SUB);
    expect(shared.owner_id).toBe(MAIN);
    expect(shared.decks.map((d) => d.name)).toEqual(["main original"]);
    expect(
      (await db.query("select id from public.decks where name='sub original'"))
        .rows
    ).toHaveLength(0);
    await save(SUB, shared.scope_key, "shared addition");
    await asUser(SUB, () =>
      rpc("bs_deck_library", "'delete', $1, $2::jsonb", [
        shared.scope_key,
        '{"name":"main original"}',
      ])
    );
    await configure(true, false);
    const independent = await list(SUB);
    expect(independent.owner_id).toBe(SUB);
    expect(independent.decks.map((d) => d.name)).toEqual(["shared addition"]);
    await save(SUB, independent.scope_key, "sub only now");
    expect((await list(MAIN)).decks.map((d) => d.name)).toEqual([
      "shared addition",
    ]);
    expect(
      (await db.query("select name from public.decks where game='acg'")).rows
    ).toEqual([{ name: "acg untouched" }]);
  });
  it("account link OFF splits too; enabling account link alone preserves independent decks", async () => {
    await configure(true, false);
    expect((await list(SUB)).decks[0].name).toBe("sub original");
    await configure();
    await configure(false, true);
    expect((await list(SUB)).decks[0].name).toBe("main original");
  });
  it("changing main during sharing transfers IDs, tokens and thumbnails", async () => {
    await configure();
    const previous = await list(MAIN);
    await configure(true, true, true);
    const next = await list(MAIN);
    expect(next.owner_id).toBe(SUB);
    expect(next.decks[0].id).toBe(previous.decks[0].id);
    expect(next.decks[0].token_deck).toEqual([{ id: 2, count: 1 }]);
    expect(next.decks[0].thumbnail_card_id).toBe(1);
  });
  it("stale screens cannot save or delete after transitions, including ON/OFF cycles", async () => {
    const old = await list(SUB);
    await configure();
    await configure(true, false);
    await expect(save(SUB, old.scope_key, "sub original")).rejects.toThrow(
      "設定が変更"
    );
    await expect(
      asUser(SUB, () =>
        rpc("bs_deck_library", "'delete', $1, $2::jsonb", [
          old.scope_key,
          '{"name":"main original"}',
        ])
      )
    ).rejects.toThrow("設定が変更");
  });
  it("denies non-admin configuration and self-promotion", async () => {
    await expect(
      asUser(SUB, () => rpc("bs_admin_account_link", ""))
    ).rejects.toThrow("管理者権限");
    await expect(
      asUser(SUB, () =>
        db.query("update public.profiles set role='admin' where user_id=$1", [
          SUB,
        ])
      )
    ).rejects.toThrow("変更できません");
    await asUser(SUB, () =>
      db.query(
        "update public.profiles set display_name='Updated' where user_id=$1",
        [SUB]
      )
    );
  });
  it("denies anonymous requests and cross-account scope forgery", async () => {
    await configure();
    const main = await list(MAIN);
    await expect(save(OTHER, main.scope_key, "forged")).rejects.toThrow(
      "設定が変更"
    );
    expect((await list(OTHER)).decks).toEqual([]);
    await db.exec("set role anon");
    try {
      await expect(rpc("bs_deck_library", "'list'")).rejects.toThrow(
        "permission denied"
      );
    } finally {
      await db.exec("reset role");
    }
  });
  it("rejects unknown/self pairs and stale admin settings atomically", async () => {
    await configure();
    const before = await list(MAIN);
    await expect(
      asUser(MAIN, () =>
        rpc("bs_admin_account_link", "$1::jsonb", [
          JSON.stringify({
            revision: null,
            main_email: "main@example.test",
            sub_email: "sub@example.test",
          }),
        ])
      )
    ).rejects.toThrow("再読み込み");
    expect((await list(MAIN)).decks).toEqual(before.decks);
  });
  it("old direct clients cannot recreate sub rows when linked", async () => {
    await configure();
    await expect(
      asUser(SUB, () =>
        db.query(
          "insert into public.decks(user_id,game,name) values ($1,'bs','resurrected')",
          [SUB]
        )
      )
    ).rejects.toThrow("row-level security");
    await asUser(SUB, () =>
      db.query(
        "insert into public.decks(user_id,game,name) values ($1,'acg','allowed')",
        [SUB]
      )
    );
  });
});
