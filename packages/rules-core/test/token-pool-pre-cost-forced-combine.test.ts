/**
 * P3-138 (BSES01-T01「M1A4 ジャガーノート」) deep-mode approach(c) 検出 primitive
 * (`findTokenPoolPreCostForcedCombineTrigger`) のテスト。
 *
 * この primitive は「召喚コスト支払い前トークン強制合体」トリガーの対象カード判定を行う。
 * intercept 本体・stack-resolution-core 側の強制上書きの盤面レベルの検証は
 * `bses01-t01-forced-token-combine.test.ts` を参照 (iteration4 で配線完了、
 * `BSES01-T01.effects` で実行)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { findTokenPoolPreCostForcedCombineTrigger } from "../src/legal/token-pool-pre-cost-forced-combine";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, ContinuousEffect, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const realCard = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

function testBraveDef(): CardDefinition {
  return {
    cardNo: "TEST-BRAVE-T01LINK",
    name: "Test Brave (token-linked)",
    printedCategory: "brave",
    colors: ["white"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    tribe: "８６",
    relatedTokenCardNos: ["TEST-TOKEN-T01"],
  };
}

function testTokenDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-TOKEN-T01",
    name: "Test Token",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: ["token"],
    maxTokenDeckCount: 9,
    effects: realCard("BSES01-T01").effects,
    ...overrides,
  };
}

function categoryOverride(
  targetInstanceId: string,
  treatAsCategory: CardDefinition["printedCategory"]
): ContinuousEffect {
  return {
    effectId: `test-category-override-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "TEST-SOURCE",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetInstanceId,
    metadata: { properties: { treatAsCategory } },
  };
}

function stateWithHandCard(
  def: CardDefinition,
  extraDefs: CardDefinition[] = [],
  extraTokenInstances: CardDefinition | null = null
): { state: GameState; getDef: (id: string) => CardDefinition | undefined } {
  const localMap = new Map<string, CardDefinition>([
    ...cardNoMap,
    ...[def, ...extraDefs].map((d) => [d.cardNo, d] as const),
  ]);
  const braveInHand = createCardInstance(def, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const existingTokens = extraTokenInstances
    ? [
        createCardInstance(extraTokenInstances, {
          instanceId: "existing-token",
          ownerPlayerId: ALICE,
          zone: "field",
        }),
      ]
    : [];
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return {
    state: {
      ...base,
      cardInstances: [braveInHand, ...existingTokens],
    },
    getDef: (id: string) => localMap.get(id),
  };
}

describe("findTokenPoolPreCostForcedCombineTrigger (P3-138 検出 primitive)", () => {
  it("relatedTokenCardNos が無いカードは null", () => {
    const def: CardDefinition = {
      ...testBraveDef(),
      relatedTokenCardNos: undefined,
    };
    const { state, getDef: lookup } = stateWithHandCard(def);
    expect(
      findTokenPoolPreCostForcedCombineTrigger(state, ALICE, "brave-1", lookup)
    ).toBeNull();
  });

  it("関連トークンが 支払い前のeffectsを宣言していないと null", () => {
    const token = testTokenDef({ effects: [] });
    const { state, getDef: lookup } = stateWithHandCard(testBraveDef(), [
      token,
    ]);
    expect(
      findTokenPoolPreCostForcedCombineTrigger(state, ALICE, "brave-1", lookup)
    ).toBeNull();
  });

  it("宣言があり、トークンプールに残数があればトリガーを返す", () => {
    const token = testTokenDef();
    const { state, getDef: lookup } = stateWithHandCard(testBraveDef(), [
      token,
    ]);
    const result = findTokenPoolPreCostForcedCombineTrigger(
      state,
      ALICE,
      "brave-1",
      lookup
    );
    expect(result).not.toBeNull();
    expect(result!.tokenCardNo).toBe("TEST-TOKEN-T01");
    expect(result!.tokenDefinition.cardNo).toBe("TEST-TOKEN-T01");
    expect(result!.effect).toEqual(token.effects![0]);
  });

  it("トークンプールが maxTokenDeckCount まで到達していれば null (枯渇)", () => {
    const token = testTokenDef({ maxTokenDeckCount: 1 });
    const { state, getDef: lookup } = stateWithHandCard(
      testBraveDef(),
      [token],
      token
    );
    expect(
      findTokenPoolPreCostForcedCombineTrigger(state, ALICE, "brave-1", lookup)
    ).toBeNull();
  });

  it("関連リンクがあっても召喚元の印字カテゴリ/系統が一致しなければ null", () => {
    const token = testTokenDef();
    const { state, getDef: lookup } = stateWithHandCard(
      { ...testBraveDef(), tribe: "別系統" },
      [token]
    );
    expect(
      findTokenPoolPreCostForcedCombineTrigger(state, ALICE, "brave-1", lookup)
    ).toBeNull();
  });

  it("カテゴリ置換中でも召喚イベントは印字ブレイヴとしてトリガーする", () => {
    const token = testTokenDef();
    const { state, getDef: lookup } = stateWithHandCard(testBraveDef(), [
      token,
    ]);
    const overridden = {
      ...state,
      activeContinuousEffects: [categoryOverride("brave-1", "spirit")],
    };
    expect(
      findTokenPoolPreCostForcedCombineTrigger(
        overridden,
        ALICE,
        "brave-1",
        lookup
      )
    ).not.toBeNull();
  });

  it("非ブレイヴをブレイヴ扱いにしても印字カテゴリ条件は満たさない", () => {
    const token = testTokenDef();
    const { state, getDef: lookup } = stateWithHandCard(
      { ...testBraveDef(), printedCategory: "spirit" },
      [token]
    );
    const overridden = {
      ...state,
      activeContinuousEffects: [categoryOverride("brave-1", "brave")],
    };
    expect(
      findTokenPoolPreCostForcedCombineTrigger(
        overridden,
        ALICE,
        "brave-1",
        lookup
      )
    ).toBeNull();
  });

  it("実データ BSES01-C02/T01: T01 は 支払い前のeffectsを宣言しており、場に空きがあればトリガーする", () => {
    const c02 = realCard("BSES01-C02");
    const t01 = realCard("BSES01-T01");
    expect(t01.effects![0]!.steps[0]!.action.kind).toBe("put");
    const braveInHand = createCardInstance(c02, {
      instanceId: "c02-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = { ...base, cardInstances: [braveInHand] };
    const result = findTokenPoolPreCostForcedCombineTrigger(
      state,
      ALICE,
      "c02-hand-1",
      getDef
    );
    expect(result).not.toBeNull();
    expect(result!.tokenCardNo).toBe("BSES01-T01");
  });
});
