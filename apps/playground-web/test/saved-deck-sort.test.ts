import { test } from "vitest";
import assert from "node:assert/strict";
import {
  dominantPack,
  sortSavedDecks,
  withDeckSaveTimes,
} from "../src/utils/saved-deck-sort";

test("収録弾は種類数ではなく採用枚数で決まり、同数なら先の弾を使う", () => {
  assert.equal(
    dominantPack([
      { pack: "BSTH02 妖々夢", count: 3 },
      { pack: "BSTH01 紅魔郷", count: 1 },
      { pack: "BSTH01 紅魔郷", count: 1 },
      { pack: "BSTH001 靈異伝", count: 0 },
    ]),
    "BSTH02"
  );
  assert.equal(
    dominantPack([
      { pack: "BSTH02", count: 2 },
      { pack: "BSTH01", count: 2 },
    ]),
    "BSTH01"
  );
  assert.equal(dominantPack([]), null);
});

test("4種類の並び順と昇順・降順を切り替え、元配列は変更しない", () => {
  const decks = [
    {
      name: "デッキ10",
      createdAt: "2026-01-03",
      updatedAt: "2026-01-04",
      pack: "BSTH01",
    },
    {
      name: "デッキ2",
      createdAt: "2026-01-02",
      updatedAt: "2026-01-06",
      pack: "BSTH02",
    },
    {
      name: "デッキ1",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-05",
      pack: "BSTH001",
    },
  ];
  const original = [...decks];
  const expected = {
    name: [2, 1, 0],
    created: [2, 1, 0],
    updated: [0, 2, 1],
    pack: [2, 0, 1],
  };
  for (const [key, order] of Object.entries(expected)) {
    for (const direction of ["asc", "desc"]) {
      assert.deepEqual(
        sortSavedDecks(
          decks,
          key as "pack" | "name" | "created" | "updated",
          direction as "asc" | "desc",
          (d) => [{ pack: d.pack, count: 1 }]
        ),
        (direction === "asc" ? order : [...order].reverse()).map(
          (i) => decks[i]
        )
      );
    }
  }
  assert.deepEqual(decks, original);
});

test("空デッキは収録順の末尾、古い日時なしデッキは保存順を維持", () => {
  const decks = [
    { name: "古い1" },
    { name: "古い2" },
    { name: "新規", createdAt: "2026-01-01", pack: "BSTH01" },
  ];
  assert.deepEqual(
    sortSavedDecks(decks, "created", "asc", () => []),
    decks
  );
  assert.deepEqual(
    sortSavedDecks(decks, "updated", "asc", () => []),
    decks
  );
  for (const direction of ["asc", "desc"]) {
    assert.equal(
      sortSavedDecks(decks, "pack", direction as "asc" | "desc", (d) => [
        { pack: d.pack, count: 1 },
      ])[0]!.name,
      "新規"
    );
  }
});

test("新規・上書き・JSON読込で作成日時を維持し更新日時を進める", () => {
  const created = withDeckSaveTimes(
    { name: "デッキ" },
    undefined,
    "2026-01-01"
  );
  assert.equal(created.createdAt, "2026-01-01");
  const updated = withDeckSaveTimes(
    { name: "デッキ", createdAt: "1999-01-01" },
    created,
    "2026-02-01"
  );
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-02-01");
  assert.equal(
    withDeckSaveTimes({ name: "古い" }, { name: "古い" }, "2026-02-01")
      .createdAt,
    undefined
  );
});

import { parseStoredDeck } from "../src/input-validation";
import { normalizeCloudRows } from "../src/hooks/useCloudDecks";
test("保存日時が端末読込・クラウド正規化で失われない", () => {
  const saved = {
    name: "日時",
    cardNos: ["BSTH01-C01"],
    createdAt: "2026-01-01",
    updatedAt: "2026-02-01",
  };
  assert.deepEqual(parseStoredDeck(JSON.parse(JSON.stringify(saved))), saved);
  const { rows, error } = normalizeCloudRows([
    {
      id: "deck",
      name: "日時",
      cards: [],
      created_at: saved.createdAt,
      updated_at: saved.updatedAt,
    },
  ]);
  assert.equal(error, "");
  assert.equal(rows[0]?.created_at, saved.createdAt);
  assert.equal(rows[0]?.updated_at, saved.updatedAt);
});
