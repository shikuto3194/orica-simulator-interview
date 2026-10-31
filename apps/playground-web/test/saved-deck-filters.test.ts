import { test } from "vitest";
import assert from "node:assert/strict";
import { ALL_CARDS } from "@orica/card-data";
import {
  createDeckProfile,
  getDeckFilterOptions,
  matchDeckProfile,
  EMPTY_DECK_FILTERS,
  profileFromCardNos,
  type DeckProfile,
  type DeckFilters,
} from "../src/utils/saved-deck-filters";
import { sortSavedDecks } from "../src/utils/saved-deck-sort";
import { PACK_OPTIONS } from "../src/utils/deck-packs";

test("実カードの全表裏で収録パックがカード番号と一致し、地霊殿が誤った候補に分かれない", () => {
  const packs = new Map(PACK_OPTIONS.map((pack) => [pack.split(" ")[0], pack]));
  for (const card of ALL_CARDS) {
    for (const face of [card, card.backFace].filter(Boolean)) {
      assert.equal(
        face!.pack,
        packs.get(face!.cardNo!.split("-")[0]!),
        face!.cardNo
      );
    }
  }
  const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
  const profile = profileFromCardNos(["BSTH06-転醒X01(A)"], cards);
  assert.deepEqual(getDeckFilterOptions([profile]).pack, [
    { value: "BSTH06 東方地霊殿", count: 1 },
  ]);
});

test("カード番号の重複・不明カード・裏面を採用枚数として集計する", () => {
  const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
  const profile = profileFromCardNos(
    ["BSTH01-XX02", "BSTH01-XX02", "BSFT01-CX01", "unknown"],
    cards
  );
  assert.equal(
    matchDeckProfile(profile, { ...EMPTY_DECK_FILTERS, color: "赤" }).score,
    0.5
  );
  assert.equal(
    matchDeckProfile(profile, { ...EMPTY_DECK_FILTERS, contract: "ルーシィ" })
      .score,
    0.25
  );
  const double = ALL_CARDS.find((card) => card.backFace?.tribe)!;
  const backTribe = double.backFace!.tribe!.split(/[・/／]/)[0]!;
  assert.equal(
    matchDeckProfile(
      profileFromCardNos([double.cardNo, double.cardNo], cards),
      { ...EMPTY_DECK_FILTERS, tribe: backTribe }
    ).score,
    1
  );
});

const red = { colors: ["赤"], tribe: "幻想・博麗", pack: "BSTH01 東方紅魔郷" };
const blue = {
  colors: ["青"],
  tribe: "星霊魔導士／FT",
  pack: "BSFT01 フェアリーテイル",
  contract: "ルーシィ",
};
const match = (profile: DeckProfile, filters: Partial<DeckFilters>) =>
  matchDeckProfile(profile, { ...EMPTY_DECK_FILTERS, ...filters });

test("候補件数はデッキ単位。0枚・無効枚数を除外し、系統を分割する", () => {
  const first = createDeckProfile([
    { count: 30, faces: [red] },
    { count: 10, faces: [blue] },
    { count: 0, faces: [{ colors: ["緑"] }] },
  ]);
  const second = createDeckProfile([
    { count: 3, faces: [red] },
    { count: NaN, faces: [blue] },
    { count: -1, faces: [blue] },
  ]);
  const options = getDeckFilterOptions([first, second]);
  assert.deepEqual(options.color, [
    { value: "赤", count: 2 },
    { value: "青", count: 1 },
  ]);
  assert.equal(options.tribe.find((option) => option.value === "FT").count, 1);
  assert.equal(
    options.contract.find((option) => option.value === "契約なし").count,
    1
  );
  assert.deepEqual(getDeckFilterOptions([]).pack, []);
});

test("ヒット度は採用枚数の割合。複数条件はデッキ単位のANDと割合の平均", () => {
  const profile = createDeckProfile([
    { count: 30, faces: [red] },
    { count: 10, faces: [blue] },
  ]);
  assert.deepEqual(match(profile, { color: "赤" }), {
    matches: true,
    score: 0.75,
  });
  assert.deepEqual(match(profile, { color: "赤", tribe: "FT" }), {
    matches: true,
    score: 0.5,
  });
  assert.equal(match(profile, { tribe: "存在しない" }).matches, false);
  assert.equal(match(profile, { contract: "契約なし" }).matches, false);
  assert.equal(match(profile, { contract: " ルーシィ " }).score, 0.25);
  assert.deepEqual(match(profile, {}), { matches: true, score: null });
});

test("両面・複数系統が一致しても同じカードは一度だけ数え、不明カードは分母に含める", () => {
  const profile = createDeckProfile([
    { count: 3, faces: [red, { ...blue, tribe: "幻想／幻想竜" }] },
    { count: 1, faces: [] },
  ]);
  assert.equal(profile.total, 4);
  assert.equal(match(profile, { tribe: "幻想" }).score, 0.75);
  assert.equal(match(profile, { color: "多色" }).score, 0.75);
  assert.equal(match(profile, { pack: blue.pack }).score, 0.75);
  assert.equal(match(createDeckProfile([]), { color: "赤" }).matches, false);
  assert.deepEqual(match(createDeckProfile([]), {}), {
    matches: true,
    score: null,
  });
});

test("ヒット度で中心デッキを優先し、昇順も選べ、同点・条件なしは保存順を保つ", () => {
  const decks = [
    { name: "1枚採用", score: 1 / 40 },
    { name: "中心", score: 30 / 40 },
    { name: "同点", score: 30 / 40 },
  ];
  assert.deepEqual(
    sortSavedDecks(
      decks,
      "hit",
      "desc",
      () => [],
      (d) => d.score
    ).map((d) => d.name),
    ["中心", "同点", "1枚採用"]
  );
  assert.deepEqual(
    sortSavedDecks(
      decks,
      "hit",
      "asc",
      () => [],
      (d) => d.score
    ),
    decks
  );
  assert.deepEqual(
    sortSavedDecks(decks, "hit", "desc", () => []),
    decks
  );
});
