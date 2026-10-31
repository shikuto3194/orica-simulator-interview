/**
 * BSTH02-C01 リリーホワイト effects[2] 『このスピリットのアタック時』(Lv2)
 * 手札の系統:「妖精」コスト3以下1枚をコストを支払わずに召喚。
 *
 * 原文 (textLines[6,7]):
 *   "Lv2『このスピリットのアタック時』"
 *   "手札にある系統：「妖精」を持つコスト3以下のカード1枚をコストを支払わずに召喚できる。"
 *
 * SSOT 流用: BSFT01-C04 effects[2]「手札の鍵ブレイヴ1枚コストなし召喚」と同型
 * (summon target:from_zone(hand) + filter + costModifier:"free")。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  applyLegalAction,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

/** リリーホワイトの系統 (幻想・妖精) にマッチする導託条件を持つ導界者ネクサス (テスト専用)。 */
function guidedNexusMatchingLilyDef(): CardDefinition {
  return {
    cardNo: "GN-LILY-TEST",
    name: "[導界者]テスト(妖精マッチ)",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["guide"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["guide"],
    textLines: [],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as const,
      oracleConditions: [{ tribes: ["妖精"] }],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/**
 * リリーホワイトの系統 (幻想・妖精) にマッチ**しない**導託条件を持つ導界者ネクサス (テスト専用)。
 * 「導託していないとき」= 神託不発かつ自分の導界者ネクサスがコア置き先として存在する
 * シナリオを検証するために、oracle 不一致 (=導託不発) だが core_move 先としては有効
 * (category:nexus + targetsGrandwalker) な導界者ネクサスを用意する。
 */
function guidedNexusNonMatchingDef(): CardDefinition {
  return {
    cardNo: "GN-NONMATCH-TEST",
    name: "[導界者]テスト(不一致)",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["guide"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["guide"],
    textLines: [],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as const,
      oracleConditions: [{ tribes: ["無関係系統"] }],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/**
 * 導界者ではない創界神ネクサス (テスト専用)。oracleConditions はリリーホワイト
 * (幻想・妖精) と不一致 (=神託不発、destination filter 単体の検証用)。
 * 「自分の導界者ネクサスに置ける」への core_move destination filter
 * (targetsGrandwalker + hasMechanic:["guided"]) が、targetsGrandwalker のみでは
 * 区別できない創界神ネクサスを正しく除外できるかを検証する対照フィクスチャ。
 */
function grandwalkerNexusNonGuidedDef(): CardDefinition {
  return {
    cardNo: "GW-NONGUIDED-TEST",
    name: "[創界神]テスト(導界者ではない)",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["god"],
    textLines: [],
    keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as const,
      oracleConditions: [{ tribes: ["無関係系統"] }],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

describe("BSTH02-C01 リリーホワイト effects[2] アタック時 妖精コスト3以下の無コスト召喚", () => {
  const c = cardNoMap.get("BSTH02-C01")!;
  const fairy = cardNoMap.get("BSTH07.8-C01")!; // 幻想・妖精 コスト2 spirit
  const expensiveFairy = cardNoMap.get("BSTH07.8-M01")!; // 幻想・妖精 コスト4 spirit (対象外)

  it("stub 解消: timing card_event:attack + condition min_level:2 + summon(from_zone) free", () => {
    const e = c.effects![2]!;
    expect(e.stub).toBeUndefined();
    expect(e.textRef).toEqual([6, 7]);
    expect(e.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(e.executionMode).toBe("optional");
    expect(e.steps).toHaveLength(1);
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.costModifier).toBe("free");
      if (action.target.kind === "from_zone") {
        expect(action.target.zone).toBe("hand");
        expect(action.target.count).toBe(1);
        expect(action.target.filter).toEqual({
          category: ["spirit", "ultimate", "brave"],
          tribes: ["妖精"],
          maxCost: 3,
        });
      } else {
        throw new Error("expected from_zone target");
      }
    }
  });

  function setup(handCards: CardDefinition[]) {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
    });
    const lily = createCardInstance(c, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv2 (requiredCores=3)
    });
    const hand = handCards.map((def, i) =>
      createCardInstance(def, {
        instanceId: `hand-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    return {
      ...base,
      cardInstances: [lily, ...hand],
    } as GameState;
  }

  it("手札にコスト3以下の妖精1枚: コストを支払わず field へ召喚される (reserveコア消費0で立証)", () => {
    const state = setup([fairy]);
    const reserveBefore = state.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;
    let result = executeEffect({
      chainId: "test:bsth02-c01-fairy-free-summon:167",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const placementAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: placementAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: "hand-0",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;
    const summoned = result.cardInstances.find(
      (x) => x.instanceId === "hand-0"
    )!;
    expect(summoned.zone).toBe("field");
    // costModifier:"free" が実際にコスト0 (withoutCost) で処理されたことを、
    // reserve コアの減少量が「Lv1維持コア(requiredCores=1)」のみで、fairy 本来の印字
    // コスト(2)分は追加消費されていないことで検証する (reserveBefore=4 → reserveAfter=3)。
    // costModifier が黙って通常課金にフォールバックすると reserveAfter は 1 (=4-2-1) になり、
    // zone==="field" だけの assert では検知できないためこの差分で立証する。
    const reserveAfter = result.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;
    expect(reserveAfter).toBe(reserveBefore - 1);
  });

  it("手札にコスト4の妖精のみ: maxCost:3 フィルタで対象外、召喚されない", () => {
    const state = setup([expensiveFairy]);
    const result = executeEffect({
      chainId: "test:bsth02-c01-fairy-free-summon:210",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const untouched = result.cardInstances.find(
      (x) => x.instanceId === "hand-0"
    )!;
    expect(untouched.zone).toBe("hand");
  });
});

describe("BSTH02-C01 リリーホワイト effects[0] 召喚時 導託していないときのボイド→導界者ネクサスコア+1", () => {
  const c = cardNoMap.get("BSTH02-C01")!;
  const matchingNexusDef = guidedNexusMatchingLilyDef();
  const nonMatchingNexusDef = guidedNexusNonMatchingDef();
  const grandwalkerOnlyNexusDef = grandwalkerNexusNonGuidedDef();
  const testDefMap = new Map<string, CardDefinition>([
    ...cardNoMap,
    [matchingNexusDef.cardNo, matchingNexusDef],
    [nonMatchingNexusDef.cardNo, nonMatchingNexusDef],
    [grandwalkerOnlyNexusDef.cardNo, grandwalkerOnlyNexusDef],
  ]);
  const getTestCardDefinitionById = (id: string) => testDefMap.get(id);

  it("stub 解消: condition:oracle_would_trigger(negate:true) + 導界者ネクサス限定 core_move が populate されている", () => {
    const e = c.effects![0]!;
    expect(e.stub).toBeUndefined();
    expect(e.condition).toEqual([
      { kind: "oracle_would_trigger", triggerKind: "summon", negate: true },
    ]);
    expect(e.usageLimit).toEqual({ kind: "per_card_name", duration: "turn" });
    expect(e.steps).toHaveLength(1);
    expect(e.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: {
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          targetsGrandwalker: true,
          hasMechanic: ["guided"],
        },
      },
      amount: 1,
    });
  });

  it("創界神ネクサスしか無い (導界者ではない): 条件は成立するがコア置き先が無いため不発 (grandwalkerKindMatches で除外)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
    });
    const lily = createCardInstance(c, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // grandwalkerOnlyNexusDef の oracleConditions (tribes:["無関係系統"]) はリリーホワイト
    // (幻想・妖精) と不一致 → oracle_would_trigger:false → negate:true で条件成立 → 効果発揮を
    // 試みる。しかし destination filter (targetsGrandwalker + hasMechanic:["guided"]) は
    // kind:"grandwalker" (導界者ではない) を除外するため、置き先が無く実質不発になるはず。
    const nexus = createCardInstance(grandwalkerOnlyNexusDef, {
      instanceId: "gw-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = { ...base, cardInstances: [lily, nexus] } as GameState;
    const voidBefore = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;

    const result = executeEffect({
      chainId: "test:bsth02-c01-fairy-free-summon:289",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getTestCardDefinitionById,
    });

    const voidAfter = result.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    expect(voidAfter).toBe(voidBefore);
    expect(
      result.cardInstances.find((x) => x.instanceId === "gw-1")!.normalCoreCount
    ).toBe(0);
  });

  it("導託対象の導界者ネクサスが場に無い: コア置き先が無いため不発 (void 不変)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
    });
    const lily = createCardInstance(c, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = { ...base, cardInstances: [lily] } as GameState;
    const voidBefore = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;

    const result = executeEffect({
      chainId: "test:bsth02-c01-fairy-free-summon:323",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getTestCardDefinitionById,
    });

    const voidAfter = result.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    expect(voidAfter).toBe(voidBefore);
  });

  it("導託不発だが導界者ネクサスが場にある: ボイド→導界者ネクサスにコア+1", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
    });
    const lily = createCardInstance(c, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // このネクサスの神託条件 (tribes:["無関係系統"]) はリリーホワイト (幻想・妖精) と
    // 不一致 → oracle_would_trigger:false → negate:true で条件成立 → 効果発揮。
    // ただし core_move の destination filter (category:nexus + targetsGrandwalker) には
    // このネクサス自身がマッチするため、コアの置き先として使える。
    const nexus = createCardInstance(nonMatchingNexusDef, {
      instanceId: "gn-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = { ...base, cardInstances: [lily, nexus] } as GameState;
    const voidBefore = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;

    const result = executeEffect({
      chainId: "test:bsth02-c01-fairy-free-summon:365",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getTestCardDefinitionById,
    });

    const voidAfter = result.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    expect(voidAfter).toBe(voidBefore - 1);
    expect(
      result.cardInstances.find((x) => x.instanceId === "gn-1")!.normalCoreCount
    ).toBe(1);
    // リリーホワイト自身はコアの置き先ではない (スピリットは filter:category["nexus"] に不一致)。
    expect(
      result.cardInstances.find((x) => x.instanceId === "lily-1")!
        .normalCoreCount
    ).toBe(1);
  });

  it("導託対象の導界者ネクサス+ボイドコアあり: 導託しているため本効果は不発", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
    });
    const lily = createCardInstance(c, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(matchingNexusDef, {
      instanceId: "gn-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = { ...base, cardInstances: [lily, nexus] } as GameState;
    const voidBefore = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;

    const result = executeEffect({
      chainId: "test:bsth02-c01-fairy-free-summon:411",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getTestCardDefinitionById,
    });

    const voidAfter = result.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    expect(voidAfter).toBe(voidBefore);
    expect(
      result.cardInstances.find((x) => x.instanceId === "lily-1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      result.cardInstances.find((x) => x.instanceId === "gn-1")!.normalCoreCount
    ).toBe(0);
  });
});
