/**
 * `cards_in_zone` 条件 primitive のユニット検証。
 *
 * BSES01-X01「行きつく果てまで」自分のトラッシュにあるブレイヴカードの数で
 * 段階効果を発揮する用途。field 限定の `field_card_count` と異なり trash 等の
 * 任意ゾーンを CardFilter 一致で数える。集計ロジックは value source
 * `cards_in_zone` (target-resolution.ts) と同一。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const dummyBrave: CardDefinition = {
  cardNo: "CARDS-IN-ZONE-BRAVE",
  name: "cards_in_zone テスト用ブレイヴ",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const dummySpirit: CardDefinition = {
  cardNo: "CARDS-IN-ZONE-SPIRIT",
  name: "cards_in_zone テスト用スピリット",
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

const cardNoMap = new Map<string, CardDefinition>([
  [dummyBrave.cardNo, dummyBrave],
  [dummySpirit.cardNo, dummySpirit],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

/**
 * alice のトラッシュに brave を `braveInTrash` 枚、spirit を `spiritInTrash` 枚、
 * さらに bob のトラッシュに brave を `bobBraveInTrash` 枚置いた state を作る。
 */
function buildState(
  braveInTrash: number,
  spiritInTrash = 0,
  bobBraveInTrash = 0
): GameState {
  const aliceBraves = Array.from({ length: braveInTrash }, (_, i) =>
    createCardInstance(dummyBrave, {
      instanceId: `alice-brave-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    })
  );
  const aliceSpirits = Array.from({ length: spiritInTrash }, (_, i) =>
    createCardInstance(dummySpirit, {
      instanceId: `alice-spirit-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    })
  );
  const bobBraves = Array.from({ length: bobBraveInTrash }, (_, i) =>
    createCardInstance(dummyBrave, {
      instanceId: `bob-brave-${i}`,
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    })
  );
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [...aliceBraves, ...aliceSpirits, ...bobBraves],
  };
}

const braveMin8 = (player: "self" | "opponent") => [
  {
    kind: "cards_in_zone" as const,
    player,
    zone: "trash" as const,
    filter: { category: ["brave"] as "brave"[] },
    min: 8,
  },
];

describe("cards_in_zone condition primitive", () => {
  it("自分のトラッシュ brave 8 枚 + min:8 → 成立", () => {
    expect(
      evaluateCondition(
        buildState(8),
        braveMin8("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("自分のトラッシュ brave 7 枚 + min:8 → 不成立", () => {
    expect(
      evaluateCondition(
        buildState(7),
        braveMin8("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("filter: trash の spirit はカウントせず brave のみ集計", () => {
    // brave 4 + spirit 10 = trash 計 14 枚だが brave のみ 4 枚 → min:8 不成立
    expect(
      evaluateCondition(
        buildState(4, 10),
        braveMin8("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("相手のトラッシュ brave は self 集計に含めない", () => {
    // alice brave 3 + bob brave 8 → self 視点では 3 枚 → min:8 不成立
    expect(
      evaluateCondition(
        buildState(3, 0, 8),
        braveMin8("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("player:opponent 指定で相手トラッシュを集計", () => {
    // bob brave 8 → opponent 視点で 8 枚 → min:8 成立
    expect(
      evaluateCondition(
        buildState(0, 0, 8),
        braveMin8("opponent"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("max 指定: brave 2 枚 + max:2 → 成立 / 3 枚 → 不成立", () => {
    const maxClause = [
      {
        kind: "cards_in_zone" as const,
        player: "self" as const,
        zone: "trash" as const,
        filter: { category: ["brave"] as "brave"[] },
        max: 2,
      },
    ];
    expect(
      evaluateCondition(
        buildState(2),
        maxClause,
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        buildState(3),
        maxClause,
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("filter 省略時はゾーン内の全カードを純カウント", () => {
    // brave 4 + spirit 6 = 10 枚 → min:8 (filter なし) 成立
    expect(
      evaluateCondition(
        buildState(4, 6),
        [
          {
            kind: "cards_in_zone" as const,
            player: "self" as const,
            zone: "trash" as const,
            min: 8,
          },
        ],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });
});
