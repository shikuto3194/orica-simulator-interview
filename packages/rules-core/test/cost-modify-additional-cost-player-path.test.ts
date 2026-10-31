/**
 * ENGINE-cost-modify-additional-cost-value-player-path-dead の回帰テスト。
 * cost_modify action (player+cardFilter 版、modifier:{additionalCostValue:N}) は
 * native-action-registry.ts で無条件 null return (silent no-op) だったが、
 * additional_cost CE (targetFilter 版) を登録し calculateReduction が全コスト計算経路
 * (getAvailableMagicPaymentSources 等) へ自動合流するよう修正した。
 * BSLH01-C08「自分の導力器トークンマジックの使用コストを-1する」を題材に検証する。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getApplicableAdditionalCostDeltaCEs,
  getApplicableAdditionalCostDelta,
  getAvailableMagicPaymentSources,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { playMagicCardAsAction } from "../src/mechanics/magic-system";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  ContinuousEffect,
  Effect,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function magicDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "導力器",
    ...overrides,
  };
}

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "紅魔",
  };
}

function ultimateDef(cardNo: string): CardDefinition {
  return {
    ...spiritDef(cardNo),
    printedCategory: "ultimate",
  };
}

function additionalCostDeltaCE(
  sourceInstanceId: string,
  actingPlayerId: string,
  amount: number,
  filter: NonNullable<ContinuousEffect["targetFilter"]>
): ContinuousEffect {
  return {
    effectId: `ce-additional-cost-${sourceInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId: "BSLH01-C08",
    actingPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: filter,
  };
}

function excludeCategoryCE(
  targetInstanceId: string,
  category: CardDefinition["printedCategory"]
): ContinuousEffect {
  return {
    effectId: `ce-exclude-category-${targetInstanceId}`,
    sourceInstanceId: "source-exclude",
    sourceDefinitionId: "SOURCE-EXCLUDE",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetInstanceId,
    metadata: { properties: { excludeCategory: category } },
  };
}

const ALICE = "alice";
const BOB = "bob";

describe("getApplicableAdditionalCostDeltaCEs", () => {
  it("matches player+tribe filter", () => {
    const def = magicDef("MAGIC-1");
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["magic"],
        tribes: ["導力器"],
      }),
    ];
    const matches = getApplicableAdditionalCostDeltaCEs(state, ALICE, def);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.modifierAmount).toBe(-1);
  });

  it("matches magic_compatible brave as magic when card instance is provided", () => {
    const def = magicDef("KEY-BRAVE-MAGIC", {
      printedCategory: "brave",
      keywordTags: ["magic_compatible"],
    });
    const card = createCardInstance(def, {
      instanceId: "key-brave-magic",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["magic"],
        tribes: ["導力器"],
      }),
    ];

    const matches = getApplicableAdditionalCostDeltaCEs(state, ALICE, def, {
      card,
    });
    expect(matches).toHaveLength(1);
    expect(getApplicableAdditionalCostDelta(state, ALICE, def, { card })).toBe(
      -1
    );
  });

  it("does not add secondary magic when magic_compatible brave has no effective category", () => {
    const def = magicDef("KEY-BRAVE-MAGIC-EXCLUDED", {
      printedCategory: "brave",
      keywordTags: ["magic_compatible"],
    });
    const card = createCardInstance(def, {
      instanceId: "key-brave-magic-excluded",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [card],
    });
    state.activeContinuousEffects = [
      excludeCategoryCE("key-brave-magic-excluded", "brave"),
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["magic"],
        tribes: ["導力器"],
      }),
    ];

    expect(
      getApplicableAdditionalCostDeltaCEs(state, ALICE, def, { card })
    ).toHaveLength(0);
    expect(getApplicableAdditionalCostDelta(state, ALICE, def, { card })).toBe(
      0
    );
  });

  it("does not match when tribe mismatches", () => {
    const def = magicDef("MAGIC-1", { tribe: "妖精" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["magic"],
        tribes: ["導力器"],
      }),
    ];
    expect(getApplicableAdditionalCostDeltaCEs(state, ALICE, def)).toHaveLength(
      0
    );
  });

  it("ignores targetInstanceId-scoped additional_cost CE (single-card variant stays with getAdditionalCosts)", () => {
    const def = magicDef("MAGIC-1");
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      {
        effectId: "ce-single-card",
        sourceInstanceId: "source-1",
        sourceDefinitionId: "OTHER",
        actingPlayerId: ALICE,
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "additional_cost",
        modifierAmount: -1,
        targetInstanceId: "some-card",
      },
    ];
    expect(getApplicableAdditionalCostDeltaCEs(state, ALICE, def)).toHaveLength(
      0
    );
  });

  it("getApplicableAdditionalCostDelta sums multiple matching CEs", () => {
    const def = magicDef("MAGIC-1");
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["magic"],
        tribes: ["導力器"],
      }),
      additionalCostDeltaCE("source-2", ALICE, -2, {
        player: "self",
        category: ["magic"],
        tribes: ["導力器"],
      }),
    ];
    expect(getApplicableAdditionalCostDelta(state, ALICE, def)).toBe(-3);
  });

  it("targetFilter.category uses effective category and ignores an excludeCategory card", () => {
    const def = ultimateDef("ULTIMATE-EXCLUDED");
    const card = createCardInstance(def, {
      instanceId: "ultimate-excluded-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [card],
    });
    state.activeContinuousEffects = [
      excludeCategoryCE("ultimate-excluded-1", "ultimate"),
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["ultimate"],
      }),
    ];

    expect(
      getApplicableAdditionalCostDeltaCEs(state, ALICE, def, { card })
    ).toHaveLength(0);
    expect(getApplicableAdditionalCostDelta(state, ALICE, def, { card })).toBe(
      0
    );
  });

  it("targetFilter.category still matches printed category when no excludeCategory applies", () => {
    const def = ultimateDef("ULTIMATE-NORMAL");
    const card = createCardInstance(def, {
      instanceId: "ultimate-normal-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [card],
    });
    state.activeContinuousEffects = [
      additionalCostDeltaCE("source-1", ALICE, -1, {
        player: "self",
        category: ["ultimate"],
      }),
    ];

    expect(
      getApplicableAdditionalCostDeltaCEs(state, ALICE, def, { card })
    ).toHaveLength(1);
    expect(getApplicableAdditionalCostDelta(state, ALICE, def, { card })).toBe(
      -1
    );
  });
});

describe("cost_modify (player+cardFilter, additionalCostValue) 実行", () => {
  it("registers an additional_cost CE with targetFilter instead of silently no-oping", () => {
    const source = spiritDef("SOURCE-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"], tribes: ["導力器"] },
            modifier: { additionalCostValue: -1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-player-path:332",
      state,
      effect,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.activeContinuousEffects).toHaveLength(1);
    const ce = next.activeContinuousEffects[0]!;
    expect(ce.modifierTag).toBe("additional_cost");
    expect(ce.modifierAmount).toBe(-1);
    expect(ce.targetFilter).toMatchObject({
      player: "self",
      category: ["magic"],
      tribes: ["導力器"],
    });
    expect(ce.targetInstanceId).toBeUndefined();
  });

  it("preserves cardName filter on targetFilter", () => {
    const source = spiritDef("SOURCE-CARDNAME-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-cardname",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: {
              category: ["magic"],
              cardName: { exact: "指定マジック" },
            },
            modifier: { additionalCostValue: 1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-player-path:385",
      state,
      effect,
      sourceInstanceId: "source-cardname",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.activeContinuousEffects[0]?.targetFilter).toMatchObject({
      player: "self",
      category: ["magic"],
      cardName: { exact: "指定マジック" },
    });
  });

  it("preserves hasBurstEffect filter on additional_cost targetFilter", () => {
    const source = spiritDef("SOURCE-BURST-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-burst-cost",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { hasBurstEffect: true },
            modifier: { additionalCostValue: 1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-player-path:430",
      state,
      effect,
      sourceInstanceId: "source-burst-cost",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.activeContinuousEffects[0]?.targetFilter).toMatchObject({
      player: "self",
      hasBurstEffect: true,
    });
  });

  // guard-audit-card-filter-projection (2026-08-05): native-action-registry.ts の
  // player+cardFilter allowlist コピーと structured-cost-gate.ts の executeAdditionalCost
  // targetFilter 構築を CardFilter 全体の素のスプレッドへ統合した。requiredKeywordTags は
  // 旧 allowlist に無く、両経路のどちらかが field-by-field コピーへ戻ると再び黙って脱落する
  // (matchesCostCEFilterClause は requiredKeywordTags を実際に判定に使う、card-filter.ts)。
  it("preserves requiredKeywordTags filter on additional_cost targetFilter (previously dropped by the allowlist copy)", () => {
    const source = spiritDef("SOURCE-KEYWORDTAG-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-keywordtag",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: {
              category: ["magic"],
              requiredKeywordTags: ["accel"],
            },
            modifier: { additionalCostValue: -1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-player-path:482",
      state,
      effect,
      sourceInstanceId: "source-keywordtag",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.activeContinuousEffects[0]?.targetFilter).toMatchObject({
      player: "self",
      category: ["magic"],
      requiredKeywordTags: ["accel"],
    });
  });

  // 敵対的検証 2026-08-05 Lens 2 refute: CostOverrideAction.filter /
  // executeAdditionalCost targetFilter を CardFilter 全体へ型統合しただけだと、
  // matchesCostCEFilterClause (card-filter.ts) が実際には解釈しない maxCost 等の
  // フィールドを、型チェックが通る形でカード定義に書けてしまう新規の silent no-op
  // 経路が生まれる。native-action-registry.ts は pickCostCEFilterFields
  // (card-filter.ts SSOT) で対応フィールドだけを抽出するため、maxCost は
  // targetFilter に伝播しない (書いても無視されることを明示するテスト)。
  it("drops maxCost from targetFilter (unsupported by matchesCostCEFilterClause, would otherwise silently no-op)", () => {
    const source = spiritDef("SOURCE-MAXCOST-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-maxcost",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"], maxCost: 3 },
            modifier: { additionalCostValue: -1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-modify-additional-cost-player-path:534",
      state,
      effect,
      sourceInstanceId: "source-maxcost",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const targetFilter = next.activeContinuousEffects[0]?.targetFilter as
      | (Record<string, unknown> | undefined)
      | undefined;
    expect(targetFilter).toMatchObject({ player: "self", category: ["magic"] });
    expect(targetFilter).not.toHaveProperty("maxCost");
  });
});

describe("guard-audit-card-filter-projection: requiredKeywordTags 意味差分 (盤面コスト計算)", () => {
  it("discounts only the magic carrying the required keyword tag, not a same-category magic without it", () => {
    const taggedMagic = magicDef("KEYWORDTAG-MAGIC-WITH-TAG", {
      keywordTags: ["accel"],
    });
    const untaggedMagic = magicDef("KEYWORDTAG-MAGIC-WITHOUT-TAG");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(taggedMagic, {
          instanceId: "tagged-magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(untaggedMagic, {
          instanceId: "untagged-magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("ce-keywordtag-discount", ALICE, -1, {
          player: "self",
          category: ["magic"],
          requiredKeywordTags: ["accel"],
        }),
      ],
    };
    const getDef = (id: string) => {
      if (id === taggedMagic.cardNo) return taggedMagic;
      if (id === untaggedMagic.cardNo) return untaggedMagic;
      return undefined;
    };

    const taggedResult = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "tagged-magic-1",
      getCardDefinitionById: getDef,
    });
    expect(taggedResult.reduction.finalCost).toBe(2);

    const untaggedResult = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "untagged-magic-1",
      getCardDefinitionById: getDef,
    });
    expect(untaggedResult.reduction.finalCost).toBe(3);
  });
});

describe("BSLH01-C08 導力器トークンマジックコスト-1: 盤面コスト計算への反映", () => {
  it("getAvailableMagicPaymentSources reflects the -1 delta (3 -> 2)", () => {
    const magic = magicDef("BSLH01-TOKEN-M");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("bslh01-c08-1", ALICE, -1, {
          player: "self",
          category: ["magic"],
          tribes: ["導力器"],
        }),
      ],
    };
    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.reduction.finalCost).toBe(2);
  });

  it("does not affect magic outside the filtered tribe", () => {
    const magic = magicDef("BSLH01-OTHER-M", { tribe: "妖精" });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("bslh01-c08-1", ALICE, -1, {
          player: "self",
          category: ["magic"],
          tribes: ["導力器"],
        }),
      ],
    };
    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.reduction.finalCost).toBe(3);
  });

  it("matches by effective color (treat_as), not just printed color (SSOT with getApplicableCostOverrideCEs)", () => {
    // 印字は purple だが「このカードの色は赤としても扱う」を持つマジック。
    // additional_cost CE の colors:["red"] フィルタは printed color では絶対にマッチしない。
    const magic: CardDefinition = {
      ...magicDef("BSLH01-TREAT-AS-RED-M", { colors: ["purple"] }),
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "treat_as",
                aspects: ["color"],
                asColor: "red",
                appliesToCard: true,
              },
            },
          ],
        },
      ],
    } as CardDefinition;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("ce-red-discount", ALICE, -1, {
          player: "self",
          category: ["magic"],
          colors: ["red"],
        }),
      ],
    };
    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.reduction.finalCost).toBe(2);
  });

  it("floors at 0 when the delta exceeds the printed cost (BSLH01-4908, -2 discount)", () => {
    const magic = magicDef("BSLH01-CHEAP-M", { cost: 1 });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("bslh01-4908-1", ALICE, -2, {
          player: "self",
          category: ["magic"],
          tribes: ["導力器"],
        }),
      ],
    };
    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.reduction.finalCost).toBe(0);
  });

  it("withoutCost magic still pays applicable additional_cost", () => {
    const magic = magicDef("BSLH01-FREE-BUT-TAXED-M", { cost: 4 });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-taxed",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("ce-free-use-tax", ALICE, 2, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-taxed",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (current) => current,
      withoutCost: true,
    });

    expect(result.reduction.reducedCost).toBe(0);
    expect(result.reduction.additionalCost).toBe(2);
    expect(result.reduction.finalCost).toBe(2);
    expect(
      result.state.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(3);
  });

  it("withoutCost magic clamps negative additional_cost at 0", () => {
    const magic = magicDef("BSLH01-FREE-DISCOUNTED-M", { cost: 4 });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
      }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-free-discounted",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("ce-free-use-discount", ALICE, -1, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-free-discounted",
      paymentSources: [],
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (current) => current,
      withoutCost: true,
    });

    expect(result.reduction.additionalCost).toBe(-1);
    expect(result.reduction.finalCost).toBe(0);
    expect(
      result.state.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);
  });
});

describe("BSLH01-X06 導力器トークンマジックコスト-2: isToken 絞り込み", () => {
  it("getAvailableMagicPaymentSources reflects the -2 delta only for token magic (3 -> 1)", () => {
    const tokenMagic = magicDef("BSLH01-T13", { maxTokenDeckCount: 1 });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(tokenMagic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("bslh01-x06-1", ALICE, -2, {
          player: "self",
          category: ["magic"],
          tribes: ["導力器"],
          isToken: true,
        }),
      ],
    };
    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) =>
        id === tokenMagic.cardNo ? tokenMagic : undefined,
    });
    expect(result.reduction.finalCost).toBe(1);
  });

  it("does not discount a non-token 導力器 magic (BSLH01-C08 tribe overlap, no maxTokenDeckCount)", () => {
    const nonTokenMagic = magicDef("BSLH01-NON-TOKEN-M");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(nonTokenMagic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        additionalCostDeltaCE("bslh01-x06-1", ALICE, -2, {
          player: "self",
          category: ["magic"],
          tribes: ["導力器"],
          isToken: true,
        }),
      ],
    };
    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) =>
        id === nonTokenMagic.cardNo ? nonTokenMagic : undefined,
    });
    expect(result.reduction.finalCost).toBe(3);
  });

  // adversarial verifier 2026-07-13 round3 refute: 上記2ケースは additionalCostDeltaCE
  // ヘルパーで CE.targetFilter.isToken を手動構築しており、native-action-registry.ts の
  // cost_modify(player+cardFilter版) 実行経路 (action.cardFilter → filter allowlist 構築)
  // を一度も通していない。実カード BSLH01-X06 effects[1] を executeEffect で発揮させ、
  // 登録される CE.targetFilter.isToken が実際に伝搬することを確認する。
  it("[e2e] executeEffect で BSLH01-X06 effects[1] を発揮すると、登録CEのtargetFilter.isTokenがtrueになり、トークン導力器マジックのみコスト-2される", () => {
    const x06 = cardNoMap.get("BSLH01-X06")!;
    const effect = x06.effects![1]!;
    expect(effect.textRef).toEqual([3, 4]);
    const source = createCardInstance(x06, {
      instanceId: "x06-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });
    const getDef = (id: string) => (id === x06.cardNo ? x06 : undefined);

    const after = executeEffect({
      chainId: "test:cost-modify-additional-cost-player-path:904",
      state: before,
      effect,
      sourceInstanceId: "x06-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const registered = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "additional_cost" &&
        ce.sourceInstanceId === "x06-source"
    );
    expect(registered).toBeDefined();
    // native-action-registry.ts の filter allowlist に isToken が抜けていると、ここが
    // undefined のまま登録され、下流の matchesCostCETargetFilter が isToken ガードを
    // 素通りして非トークンマジックにも discount が漏れる (round3 refute の核心)。
    expect(registered!.targetFilter?.isToken).toBe(true);

    const tokenMagic = magicDef("BSLH01-T13-E2E", { maxTokenDeckCount: 1 });
    const nonTokenMagic = magicDef("BSLH01-NON-TOKEN-E2E");
    const stateWithMagics: GameState = {
      ...after,
      cardInstances: [
        ...after.cardInstances,
        createCardInstance(tokenMagic, {
          instanceId: "token-magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(nonTokenMagic, {
          instanceId: "non-token-magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    const getDefForMagics = (id: string) => {
      if (id === x06.cardNo) return x06;
      if (id === tokenMagic.cardNo) return tokenMagic;
      if (id === nonTokenMagic.cardNo) return nonTokenMagic;
      return undefined;
    };

    const tokenResult = getAvailableMagicPaymentSources({
      state: stateWithMagics,
      actingPlayerId: ALICE,
      magicInstanceId: "token-magic-1",
      getCardDefinitionById: getDefForMagics,
    });
    expect(tokenResult.reduction.finalCost).toBe(1);

    const nonTokenResult = getAvailableMagicPaymentSources({
      state: stateWithMagics,
      actingPlayerId: ALICE,
      magicInstanceId: "non-token-magic-1",
      getCardDefinitionById: getDefForMagics,
    });
    expect(nonTokenResult.reduction.finalCost).toBe(3);
  });
});
