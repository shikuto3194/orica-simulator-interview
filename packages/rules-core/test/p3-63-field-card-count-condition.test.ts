/**
 * P3-63 step 2: `field_card_count` 条件 primitive のユニット検証。
 *
 * BSTH02-M01「自分のフィールドにカードが3枚以上あれば発揮できず」のように、
 * カテゴリ/色/系統フィルタなしでフィールド上のカード総数だけを判定する用途。
 * filter 必須の `field_has` と意図を区別するため discrete に新設した。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const dummySpirit: CardDefinition = {
  cardNo: "P3-63-FIELD-COUNT-SPIRIT",
  name: "field_card_count テスト用",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const dummyNexus: CardDefinition = {
  cardNo: "P3-63-FIELD-COUNT-NEXUS",
  name: "field_card_count テスト用 nexus",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const cardNoMap = new Map<string, CardDefinition>([
  [dummySpirit.cardNo, dummySpirit],
  [dummyNexus.cardNo, dummyNexus],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function buildState(aliceFieldCount: number, bobFieldCount = 0): GameState {
  const aliceCards = Array.from({ length: aliceFieldCount }, (_, i) =>
    createCardInstance(i % 2 === 0 ? dummySpirit : dummyNexus, {
      instanceId: `alice-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const bobCards = Array.from({ length: bobFieldCount }, (_, i) =>
    createCardInstance(dummySpirit, {
      instanceId: `bob-${i}`,
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [...aliceCards, ...bobCards],
  };
}

describe("P3-63 step 2: field_card_count condition primitive", () => {
  it("self.field 3 枚 + max:2 → 不成立 (3 > 2)", () => {
    const state = buildState(3);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_card_count", player: "self", max: 2 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("self.field 2 枚 + max:2 → 成立", () => {
    const state = buildState(2);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_card_count", player: "self", max: 2 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("self.field 0 枚 + max:2 → 成立 (min default = 不問)", () => {
    const state = buildState(0);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_card_count", player: "self", max: 2 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("opponent.field 3 枚 + min:3 → 成立 (相手側集計)", () => {
    const state = buildState(0, 3);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_card_count", player: "opponent", min: 3 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("excludeSelf: sourceInstance が self.field にあるとき除外", () => {
    const state = buildState(3); // alice-0, alice-1, alice-2 (3 枚)
    // sourceInstance = alice-0 を除外 → 残り 2 枚
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_card_count",
            player: "self",
            max: 2,
            excludeSelf: true,
          },
        ],
        "alice-0",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("カード種別 (spirit / nexus) を問わず純カウントで集計", () => {
    // 偶数 index = spirit、奇数 = nexus でビルドされる buildState で
    // 2 枚 (spirit + nexus) を集計 → max:2 成立
    const state = buildState(2);
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_card_count", player: "self", max: 2 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });
});
