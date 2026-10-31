/**
 * 【煌臨中】条件 primitive のユニット検証（field_has の adventState フィルタ）。
 *
 * 「煌臨中の自分のスピリットがいるとき」(BSKB01-R03 宝剣ギャラクシア) のように、
 * 表向き煌臨元≧1 = 【煌臨中】(10_rules/08a L34、adventSourceIdsOf を正源 helper) の
 * 個体がフィールドに存在するかを判定する。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src";

const dummySpirit: CardDefinition = {
  cardNo: "ADVENT-STATE-SPIRIT",
  name: "煌臨中条件テスト用",
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
  [dummySpirit.cardNo, dummySpirit],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

/** 指定プレイヤーの場に通常スピリット 1 体を置く。advented=true なら煌臨元を1枚下に重ねる。 */
function buildState(options: {
  aliceAdvented?: boolean;
  bobAdvented?: boolean;
  alicePlain?: boolean;
}): GameState {
  const cards: CardInstance[] = [];
  if (options.alicePlain) {
    cards.push(
      createCardInstance(dummySpirit, {
        instanceId: "alice-plain",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
  }
  if (options.aliceAdvented) {
    cards.push({
      ...createCardInstance(dummySpirit, {
        instanceId: "alice-advented",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [{ cardInstanceId: "alice-src", role: "advent_source" }],
    });
  }
  if (options.bobAdvented) {
    cards.push({
      ...createCardInstance(dummySpirit, {
        instanceId: "bob-advented",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [{ cardInstanceId: "bob-src", role: "advent_source" }],
    });
  }
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: cards,
  };
}

const advented = (player: "self" | "opponent") => [
  { kind: "field_has" as const, player, adventState: "advented" as const },
];

describe("field_has adventState (【煌臨中】 condition)", () => {
  it("自分の煌臨中スピリットがいる → 成立", () => {
    const state = buildState({ aliceAdvented: true });
    expect(
      evaluateCondition(
        state,
        advented("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("自分のスピリットはいるが煌臨元なし（非煌臨中）→ 不成立", () => {
    const state = buildState({ alicePlain: true });
    expect(
      evaluateCondition(
        state,
        advented("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("相手だけが煌臨中、self 視点 → 不成立（プレイヤースコープ）", () => {
    const state = buildState({ bobAdvented: true });
    expect(
      evaluateCondition(
        state,
        advented("self"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("相手だけが煌臨中、opponent 指定 → 成立", () => {
    const state = buildState({ bobAdvented: true });
    expect(
      evaluateCondition(
        state,
        advented("opponent"),
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });
});

describe("self_state advented (自身が【煌臨中】の継続ゲート)", () => {
  const selfAdvented = [
    { kind: "self_state" as const, state: "advented" as const },
  ];

  it("効果発生源 自身が煌臨元を持つ（煌臨中）→ 成立", () => {
    const state = buildState({ aliceAdvented: true });
    expect(
      evaluateCondition(
        state,
        selfAdvented,
        "alice-advented",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("効果発生源 自身に煌臨元が無い（非煌臨中）→ 不成立", () => {
    const state = buildState({ alicePlain: true });
    expect(
      evaluateCondition(
        state,
        selfAdvented,
        "alice-plain",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("他の個体が煌臨中でも 自身が非煌臨中なら不成立（self スコープ）", () => {
    const state = buildState({ alicePlain: true, bobAdvented: true });
    expect(
      evaluateCondition(
        state,
        selfAdvented,
        "alice-plain",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("self_state in_advent_source (【契約煌臨元】継続ゲート)", () => {
  const selfInAdventSource = [
    { kind: "self_state" as const, state: "in_advent_source" as const },
  ];

  /** ホスト 1 体を場に置き、`sourceId` を煌臨元として `underCards` に積んだ state を返す。
   *  煌臨元のカード自身も `cardInstances` に残す（model.ts: アンダーカードはホストの離脱まで
   *  zone="field" を保持）— evaluateCondition は sourceCard を state.cardInstances から
   *  引き当てるため、source instance も登録しておく必要がある。 */
  function buildAdventSourceState(sourceId: string): GameState {
    const host = {
      ...createCardInstance(dummySpirit, {
        instanceId: "host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        { cardInstanceId: sourceId, role: "advent_source" as const },
      ],
    };
    const sourceCard = createCardInstance(dummySpirit, {
      instanceId: sourceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, sourceCard],
    };
  }

  it("自身が他カードの煌臨元として下に置かれている → 成立", () => {
    const state = buildAdventSourceState("contract-card");
    expect(
      evaluateCondition(
        state,
        selfInAdventSource,
        "contract-card",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("自身が煌臨元位置にいない（通常 field 上）→ 不成立", () => {
    const state = buildState({ alicePlain: true });
    expect(
      evaluateCondition(
        state,
        selfInAdventSource,
        "alice-plain",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("他カードが煌臨元位置にいても 自身が違うなら不成立", () => {
    // contract-card 自身は cardInstances に登録し（zone=field, host.underCards に含めない）、
    // 別の other-card だけが host の煌臨元に置かれている状態を作る。これにより evaluateCondition の
    // sourceCard ガードを通過してから adventSource.has(sourceInstanceId) を実際に評価させる
    // （sourceCard 未登録だと `!sourceCard` で短絡し、この分岐の検証にならない）。
    const baseState = buildAdventSourceState("other-card");
    const contractCard = createCardInstance(dummySpirit, {
      instanceId: "contract-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [...baseState.cardInstances, contractCard],
    };
    expect(
      evaluateCondition(
        state,
        selfInAdventSource,
        "contract-card",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("text_role アンダーカード（星霊衣等）は対象外 → 不成立", () => {
    const host = {
      ...createCardInstance(dummySpirit, {
        instanceId: "host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "garment-card",
          role: "text_role" as const,
          roleTag: "星霊衣",
        },
      ],
    };
    const garmentCard = createCardInstance(dummySpirit, {
      instanceId: "garment-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, garmentCard],
    };
    expect(
      evaluateCondition(
        state,
        selfInAdventSource,
        "garment-card",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });
});
