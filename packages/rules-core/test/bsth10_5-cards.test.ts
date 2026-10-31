/**
 * BSTH10.5 (東方憑依花) カードの effects 検証テスト。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  checkAndQueueOracleChoices,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getAvailableMagicPaymentSources,
  getLegalActions,
  getNormalCoreCountAtLocation,
  matchesAnyOracleCondition,
  playMagicCardAsAction,
  resolveDeferredMagicStack,
  resolveMagicStackDomainMechanic,
  resolvePlacementOracleMechanic,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";
import type { MagicActionContext } from "../src/mechanics/magic-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredFieldCardEffectActions =
  buildFieldCardEffectLookup(ALL_CARDS);
const getRegisteredMagicActions = buildMagicLookup(ALL_CARDS);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const nonStackMagic: CardDefinition = {
  cardNo: "NONSTACK-MAGIC",
  name: "通常マジック",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["メイン", "何もしない。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [{ timing: { kind: "activated", mode: "main" }, steps: [] }],
};
const accelMagic: CardDefinition = {
  ...nonStackMagic,
  cardNo: "ACCEL-MAGIC",
  name: "アクセルマジック",
  accelData: { timing: "main", cost: 1, reduction: [], effects: [] },
};
const effectiveBlueStackMagic: CardDefinition = {
  cardNo: "EFFECTIVE-BLUE-STACK-MAGIC",
  name: "実効青スタックマジック",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["スタック", "このカードは青としても扱う。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "treat_as",
            aspects: ["color"],
            asColor: "blue",
            appliesToCard: true,
          },
        },
      ],
    },
    { timing: { kind: "activated", mode: "stack" }, steps: [] },
  ],
};
const multiPlacementResumeMagic: CardDefinition = {
  cardNo: "MULTI-PLACEMENT-RESUME",
  name: "複数配置継続テスト",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["メイン", "手札1枚を破棄する。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "discard",
            count: 1,
            player: "self",
          },
        },
      ],
    },
  ],
};
const postResolutionSpirit: CardDefinition = {
  cardNo: "POST-RESOLUTION-SPIRIT",
  name: "後処理テストスピリット",
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
};
const postResolutionBrave: CardDefinition = {
  cardNo: "POST-RESOLUTION-BRAVE",
  name: "後処理テストブレイヴ",
  printedCategory: "brave",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const postResolutionHost: CardDefinition = {
  cardNo: "POST-RESOLUTION-HOST",
  name: "後処理テスト合体先",
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
};
const getCardDefinitionByIdWithNonStack = (id: string) =>
  id === nonStackMagic.cardNo
    ? nonStackMagic
    : id === accelMagic.cardNo
      ? accelMagic
      : id === effectiveBlueStackMagic.cardNo
        ? effectiveBlueStackMagic
        : id === multiPlacementResumeMagic.cardNo
          ? multiPlacementResumeMagic
          : id === postResolutionSpirit.cardNo
            ? postResolutionSpirit
            : id === postResolutionBrave.cardNo
              ? postResolutionBrave
              : id === postResolutionHost.cardNo
                ? postResolutionHost
                : getCardDefinitionById(id);

function legalActionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions,
    getRegisteredMagicActions,
    getRegisteredTriggeredEffectActions,
  });
}

function passUntilStackClosed(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 12 && current.stackWindow !== null; i++) {
    const priorityPlayerId = current.stackWindow.priorityPlayerId;
    const pass = legalActionsFor(current, priorityPlayerId).find(
      (action) => action.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

describe.each([
  ["BSTH10.5-R21", 3],
  ["BSTH10.5-R22", 2],
])("%s マジック", (cardNo, drawCount) => {
  const card = cardNoMap.get(cardNo)!;
  it("系統付与(幻想) + メイン(Nドロー+破棄) + スタック negate", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["幻想"]);
    }
    const main = card.effects![1]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    const draw = main.steps[0]!.action;
    if (draw.kind === "draw") expect(draw.count).toBe(drawCount);
    const stack = card.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.steps[0]!.action.kind).toBe("negate");
    expect(stack.stub).toBeUndefined();
    if (cardNo === "BSTH10.5-R21") {
      expect(stack.steps.map((s) => s.action.kind)).toEqual([
        "negate",
        "negate",
      ]);
      expect(stack.steps[0]!.action).toMatchObject({
        kind: "negate",
        negateTarget: "summon",
        targetFilter: { category: ["spirit"], maxCost: 4 },
      });
      expect(stack.steps[1]!.action).toMatchObject({
        kind: "negate",
        negateTarget: "place",
        targetFilter: { category: ["nexus"], maxCost: 4 },
      });
    } else {
      expect(stack.condition).toEqual([
        { kind: "life_value", player: "self", max: 4 },
      ]);
    }
  });

  it("メイン実行: Nドローで手札+N (破棄は pending)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `d${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: deck,
    };
    const result = executeEffect({
      chainId: "test:bsth10_5-cards:267",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "x",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    expect(hand.length).toBe(drawCount);
  });
});

describe("BSTH10.5-X01 [創界神]依神 紫苑", () => {
  const card = cardNoMap.get("BSTH10.5-X01")!;
  it("grandwalkerData(grandwalker): 依神&ネクサス + 配置時コア配置禁止タグ", () => {
    expect(card.grandwalkerData?.kind).toBe("grandwalker");
    expect(card.grandwalkerData?.oracleConditions).toEqual([
      { tribes: ["依神"], categories: ["nexus"] },
      { categories: ["magic"], hasMechanic: ["stack_effect"] },
    ]);
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
  });

  it("神託対象マッチ: 依神ネクサスとBSTH10.5-R21/R22のスタック効果マジックが対象", () => {
    const gw = card.grandwalkerData!;
    // 紫苑自身の定義 = 依神＆ネクサス → 第1条件マッチ（配置時の自己除外は engine 側）
    expect(matchesAnyOracleCondition(card, gw)).toBe(true);
    // R21/R22 マジック（依神なし）: 〔スタック効果＆マジック〕条件にマッチ。
    expect(matchesAnyOracleCondition(cardNoMap.get("BSTH10.5-R21")!, gw)).toBe(
      true
    );
    expect(matchesAnyOracleCondition(cardNoMap.get("BSTH10.5-R22")!, gw)).toBe(
      true
    );
    expect(matchesAnyOracleCondition(nonStackMagic, gw)).toBe(false);
  });

  it("神託の hasMechanic OR は stack_effect 混在時も非stack mechanicで main 使用にマッチする", () => {
    const mixedGwDef: CardDefinition = {
      ...card,
      cardNo: "MIXED-ORACLE-GW",
      name: "混在神託テスト",
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [
          { categories: ["magic"], hasMechanic: ["accel", "stack_effect"] },
        ],
      },
    };
    const gwInstance = createCardInstance(mixedGwDef, {
      instanceId: "mixed-gw-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const trigger = createCardInstance(accelMagic, {
      instanceId: "accel-magic-used",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, trigger],
    });
    const lookup = (id: string) =>
      id === mixedGwDef.cardNo
        ? mixedGwDef
        : getCardDefinitionByIdWithNonStack(id);

    const result = checkAndQueueOracleChoices(
      state,
      "accel-magic-used",
      "use_magic",
      lookup,
      "test:bsth10_5-cards:340",
      { magicTiming: "main" }
    );

    expect(
      result.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "mixed-gw-field" &&
          pending.mechanic.triggerCardInstanceId === "accel-magic-used"
      )
    ).toBe(true);
  });

  it("BSTH10.5-R21 の main効果使用後は、スタック効果使用ではないためBSTH10.5-X01の神託pendingを生成しない", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deck = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(nonStackMagic, {
        instanceId: `BSTH10.5-R21-draw-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, ...deck],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 3 }
          : player
      ),
    };
    const useR21 = legalActionsFor(state, "alice").find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "BSTH10.5-R21-hand" &&
        action.timing === "main" &&
        action.costMode === "paid"
    );
    expect(useR21).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: useR21!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(declared.stackWindow).not.toBeNull();

    const afterUse = passUntilStackClosed(declared);
    expect(
      afterUse.cardInstances.find((c) => c.instanceId === "BSTH10.5-R21-hand")
        ?.zone
    ).toBe("in_use");
    expect(afterUse.pendingZoneSelection?.actionKind).toBe("discard_hand");
    expect(
      afterUse.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field"
      )
    ).toBe(false);

    const discardChoice = legalActionsFor(afterUse, "alice").find(
      (action) => action.kind === "resolve_pending_zone_selection"
    );
    expect(discardChoice).toBeDefined();
    const discardedId =
      afterUse.pendingZoneSelection!.candidateCardInstanceIds.find((id) =>
        id.startsWith("BSTH10.5-R21-draw-")
      )!;
    const afterDiscard = applyLegalAction({
      state: afterUse,
      action: discardChoice!,
      selectedZoneCardIds: [discardedId],
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(afterDiscard.pendingZoneSelection).toBeNull();
    expect(
      afterDiscard.cardInstances.find((c) => c.instanceId === discardedId)?.zone
    ).toBe("trash");
    expect(
      afterDiscard.cardInstances.find(
        (c) => c.instanceId === "BSTH10.5-R21-hand"
      )?.zone
    ).toBe("trash");

    expect(
      afterDiscard.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-hand"
      )
    ).toBe(false);
  });

  it("BSTH10.5-R21 の stack use_magic 解決後、BSTH10.5-X01 の神託 pending が生成される", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              lifeCoreCount: 4,
              reserveNormalCoreCount: 3,
            }
          : player
      ),
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(
      result.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-hand"
      )
    ).toBe(true);
  });

  it("導域: 青マジックの使用コストをBSTH10.5-X01からボイドに支払える", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };

    const sources = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      getCardDefinitionById,
    });
    expect(
      sources.onBoardCoreSources.some(
        (source) =>
          source.instanceId === "BSTH10.5-X01-field" &&
          source.destination === "void" &&
          source.availableCoreAmount === 3
      )
    ).toBe(true);
    expect(sources.canFullyPay).toBe(true);

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      paymentSources: [
        {
          kind: "card",
          instanceId: "BSTH10.5-X01-field",
          amount: 3,
          destination: "void",
        },
      ],
      chosenTiming: "main",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(
      result.cardInstances.find((c) => c.instanceId === "BSTH10.5-X01-field")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      result.players.find((player) => player.id === "alice")
        ?.voidNormalCoreCount
    ).toBe(4);
  });

  it("導域: 手札で実効青になるマジックもX01からボイドに支払える", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const magic = createCardInstance(effectiveBlueStackMagic, {
      instanceId: "effective-blue-stack-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [gwInstance, magic],
    });

    const sources = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "effective-blue-stack-hand",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
    });

    expect(
      sources.onBoardCoreSources.some(
        (source) =>
          source.instanceId === "BSTH10.5-X01-field" &&
          source.destination === "void"
      )
    ).toBe(true);
  });

  it("導域: forged paymentSources で非導域カードからボイド支払いできない", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const normalSource = createCardInstance(postResolutionSpirit, {
      instanceId: "normal-source-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, normalSource, r21],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "BSTH10.5-R21-hand" &&
        a.timing === "main"
    );
    expect(action).toBeDefined();
    expect(
      action!.availableOnBoardCoreSources.some(
        (source) =>
          source.instanceId === "normal-source-field" &&
          source.destination === undefined
      )
    ).toBe(true);
    expect(
      action!.availableOnBoardCoreSources.some(
        (source) =>
          source.instanceId === "normal-source-field" &&
          source.destination === "void"
      )
    ).toBe(false);

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        paymentSources: [
          {
            kind: "card",
            instanceId: "normal-source-field",
            amount: 3,
            destination: "void",
          },
        ],
        getCardDefinitionById: getCardDefinitionByIdWithNonStack,
        getRegisteredFieldCardEffectActions,
        getRegisteredMagicActions,
        getRegisteredTriggeredEffectActions,
      })
    ).toThrow(/Card payment source is not legal/);
  });

  it("導域: 青マジックのスタック効果発揮時に相手デッキ4枚破棄しコア+1する", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const bobDeck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(nonStackMagic, {
        instanceId: `bob-domain-deck-${i}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, ...bobDeck],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              lifeCoreCount: 4,
              reserveNormalCoreCount: 3,
            }
          : { ...player, deckCount: 4 }
      ),
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    const domain = result.pendingTriggeredEffects.find(
      (pending) =>
        pending.mechanic?.kind === "magic_stack_domain" &&
        pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field"
    );
    expect(domain?.mechanic).toBeDefined();

    const resolved = resolveMagicStackDomainMechanic(
      result,
      domain!.mechanic as Extract<
        NonNullable<typeof domain.mechanic>,
        { kind: "magic_stack_domain" }
      >,
      "alice",
      true,
      getCardDefinitionById
    );
    for (let i = 0; i < 4; i++) {
      expect(
        resolved.cardInstances.find(
          (c) => c.instanceId === `bob-domain-deck-${i}`
        )?.zone
      ).toBe("trash");
    }
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "BSTH10.5-X01-field")
        ?.normalCoreCount
    ).toBe(4);
  });

  it("導域: 宣言時に実効青だったスタックマジックは解決後も導域pendingを生成する", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const magic = createCardInstance(effectiveBlueStackMagic, {
      instanceId: "effective-blue-stack-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [gwInstance, magic],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, lifeCoreCount: 4, reserveNormalCoreCount: 3 }
          : { ...player, deckCount: 4 }
      ),
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "effective-blue-stack-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(
      result.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "magic_stack_domain" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field"
      )
    ).toBe(true);
  });

  it("導域: deckCountのみの相手デッキも4枚破棄として減らしコア+1する", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "bob" ? { ...player, deckCount: 4 } : player
      ),
    };

    const resolved = resolveMagicStackDomainMechanic(
      state,
      {
        kind: "magic_stack_domain",
        grandwalkerInstanceId: "BSTH10.5-X01-field",
        triggerCardInstanceId: "dummy-magic",
      },
      "alice",
      true,
      getCardDefinitionById
    );

    expect(resolved.players.find((p) => p.id === "bob")?.deckCount).toBe(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "BSTH10.5-X01-field")
        ?.normalCoreCount
    ).toBe(4);
  });

  it("導域: prevent_deck_discard中は相手デッキ破棄を行わずコア+1する", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const preventDeckDiscard: ContinuousEffect = {
      effectId: "test-prevent-deck-discard",
      sourceInstanceId: "prevent-source",
      sourceDefinitionId: "TEST-PREVENT",
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "prevent_deck_discard",
      targetInstanceId: "bob",
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance],
    });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [preventDeckDiscard],
      players: base.players.map((player) =>
        player.id === "bob" ? { ...player, deckCount: 4 } : player
      ),
    };

    const resolved = resolveMagicStackDomainMechanic(
      state,
      {
        kind: "magic_stack_domain",
        grandwalkerInstanceId: "BSTH10.5-X01-field",
        triggerCardInstanceId: "dummy-magic",
      },
      "alice",
      true,
      getCardDefinitionById
    );

    expect(resolved.players.find((p) => p.id === "bob")?.deckCount).toBe(4);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "BSTH10.5-X01-field")
        ?.normalCoreCount
    ).toBe(4);
  });

  it("導域: Lv2未満では青マジックのスタック効果発揮時でも導域 pending を生成しない", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21],
    });
    const result = playMagicCardAsAction({
      state: {
        ...state,
        activePlayerId: "alice",
        step: "attack",
        players: state.players.map((player) =>
          player.id === "alice"
            ? { ...player, lifeCoreCount: 4, reserveNormalCoreCount: 3 }
            : player
        ),
      },
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(
      result.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field"
      )
    ).toBe(true);
    expect(
      result.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "magic_stack_domain" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field"
      )
    ).toBe(false);
  });

  it("導域: スタック効果発揮時の導域 pending は mandatory で、辞退指定ではスキップされない", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const bobDeck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(nonStackMagic, {
        instanceId: `bob-mandatory-domain-deck-${i}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, ...bobDeck],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, lifeCoreCount: 4, reserveNormalCoreCount: 3 }
          : { ...player, deckCount: 4 }
      ),
    };
    const afterStackMagic = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    const domain = afterStackMagic.pendingTriggeredEffects.find(
      (pending) =>
        pending.mechanic?.kind === "magic_stack_domain" &&
        pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field"
    );
    expect(domain).toBeDefined();
    const onlyDomainState: GameState = {
      ...afterStackMagic,
      pendingTriggeredEffects: [domain!],
    };

    const action = legalActionsFor(onlyDomainState, "alice").find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === domain!.pendingId
    );
    expect(action).toMatchObject({ executionMode: "mandatory" });
    const declared = applyLegalAction({
      state: onlyDomainState,
      action: action!,
      skipOptionalEffect: true,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(declared.stackWindow).not.toBeNull();

    const resolved = passUntilStackClosed(declared);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "BSTH10.5-X01-field")
        ?.normalCoreCount
    ).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(
        resolved.cardInstances.find(
          (c) => c.instanceId === `bob-mandatory-domain-deck-${i}`
        )?.zone
      ).toBe("trash");
    }
  });

  it("導域: スタックマジックが無効化/不発なら use_magic 神託のみで導域はキューしない", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const makeStateWithMagic = (instanceId: string) =>
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 1,
        cardInstances: [
          gwInstance,
          createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
            instanceId,
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "in_use",
          }),
        ],
      });
    const makeStack = (
      instanceId: string,
      patch: Partial<ActiveStack> = {}
    ): ActiveStack => ({
      stackId: `stack:${instanceId}`,
      actionKind: "magic",
      chainId: `chain:${instanceId}`,
      actingPlayerId: "alice",
      cardInstanceId: instanceId,
      cardDefinitionId: "BSTH10.5-R21",
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      chosenTiming: "stack",
      reducedCost: 0,
      totalReduction: 0,
      ...patch,
    });

    const nullified = resolveDeferredMagicStack({
      state: makeStateWithMagic("nullified-r21"),
      activeStack: makeStack("nullified-r21", { isNullified: true }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    expect(
      nullified.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(true);
    expect(
      nullified.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "magic_stack_domain"
      )
    ).toBe(false);

    const fizzled = resolveDeferredMagicStack({
      state: makeStateWithMagic("fizzled-r21"),
      activeStack: makeStack("fizzled-r21", {
        targetInstanceIds: ["missing-target"],
      }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    expect(
      fizzled.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(true);
    expect(
      fizzled.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "magic_stack_domain"
      )
    ).toBe(false);
  });

  it("post-resolution 神託は target redirect pending 解決後にキューされる", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const source = createCardInstance(nonStackMagic, {
      instanceId: "redirect-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const protectedTarget = createCardInstance(nonStackMagic, {
      instanceId: "protected-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const redirectToken = createCardInstance(nonStackMagic, {
      instanceId: "redirect-token",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobDeck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(nonStackMagic, {
        instanceId: `bob-delayed-domain-deck-${i}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [
        gwInstance,
        r21,
        source,
        protectedTarget,
        redirectToken,
        ...bobDeck,
      ],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "bob" ? { ...player, deckCount: 4 } : player
      ),
      pendingTargetRedirects: [
        {
          pendingId: "redirect-1",
          redirectEffectId: "redirect-effect-1",
          promptedPlayerId: "bob",
          sourceEffectInstanceId: "redirect-source",
          sourceEffectDefinitionId: nonStackMagic.cardNo,
          originalResolvedInstanceIds: ["protected-target"],
          redirectableInstanceId: "protected-target",
          candidateTokenInstanceIds: ["redirect-token"],
          continuation: {
            chainId: "test:bsth10_5-cards:1207",
            sourceDefinitionId: nonStackMagic.cardNo,
            effectIndex: 0,
            sourceInstanceId: "redirect-source",
            actingPlayerId: "alice",
            resumeStepIndex: 0,
            stepContext: { results: {} },
            postResolutionOracle: {
              chainId: "test:bsth10_5-cards:1214",
              triggerCardInstanceId: "BSTH10.5-R21-trash",
              triggerKind: "use_magic",
              magicTiming: "stack",
            },
          },
        },
      ],
    };

    const decline = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "decline_target_redirect");
    expect(decline).toBeDefined();

    const resolved = applyLegalAction({
      state,
      action: decline!,
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(resolved.pendingTargetRedirects).toHaveLength(0);
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
    const domain = resolved.pendingTriggeredEffects.find(
      (pending) =>
        pending.mechanic?.kind === "magic_stack_domain" &&
        pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
        pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
    );
    expect(domain?.mechanic).toBeDefined();

    const afterDomain = resolveMagicStackDomainMechanic(
      resolved,
      domain!.mechanic as Extract<
        NonNullable<typeof domain.mechanic>,
        { kind: "magic_stack_domain" }
      >,
      "alice",
      true,
      getCardDefinitionById
    );
    for (let i = 0; i < 4; i++) {
      expect(
        afterDomain.cardInstances.find(
          (c) => c.instanceId === `bob-delayed-domain-deck-${i}`
        )?.zone
      ).toBe("trash");
    }
    expect(
      afterDomain.cardInstances.find(
        (c) => c.instanceId === "BSTH10.5-X01-field"
      )?.normalCoreCount
    ).toBe(4);
  });

  it("post-resolution 神託は multi-placement resume 後の zone selection に継承される", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const source = createCardInstance(multiPlacementResumeMagic, {
      instanceId: "multi-placement-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const handA = createCardInstance(nonStackMagic, {
      instanceId: "hand-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handB = createCardInstance(nonStackMagic, {
      instanceId: "hand-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, source, handA, handB],
    });
    const state: GameState = {
      ...base,
      pendingMultiPlacement: {
        pendingId: "multi-placement-1",
        actingPlayerId: "alice",
        sourceInstanceId: "multi-placement-source",
        sourceDefinitionId: multiPlacementResumeMagic.cardNo,
        targets: [],
        effectTiming: { kind: "activated", mode: "main" },
        continuation: {
          chainId: "test:bsth10_5-cards:1329",
          sourceDefinitionId: multiPlacementResumeMagic.cardNo,
          effectIndex: 0,
          sourceInstanceId: "multi-placement-source",
          actingPlayerId: "alice",
          resumeStepIndex: 0,
          stepContext: { results: {} },
          postResolutionOracle: {
            chainId: "test:bsth10_5-cards:1336",
            triggerCardInstanceId: "BSTH10.5-R21-trash",
            triggerKind: "use_magic",
            magicTiming: "stack",
          },
        },
      },
    };

    const resolveMultiPlacement = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(resolveMultiPlacement).toBeDefined();

    const afterMultiPlacement = applyLegalAction({
      state,
      action: resolveMultiPlacement!,
      multiPlacementAllocations: [],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(afterMultiPlacement.pendingMultiPlacement).toBeNull();
    expect(afterMultiPlacement.pendingZoneSelection?.actionKind).toBe(
      "discard_hand"
    );
    expect(
      afterMultiPlacement.pendingZoneSelection?.continuation
        ?.postResolutionOracle
    ).toEqual({
      chainId: "test:bsth10_5-cards:1336",
      triggerCardInstanceId: "BSTH10.5-R21-trash",
      triggerKind: "use_magic",
      magicTiming: "stack",
    });
    expect(
      afterMultiPlacement.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(false);

    const discard = getLegalActions({
      state: afterMultiPlacement,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(discard).toBeDefined();

    const resolved = applyLegalAction({
      state: afterMultiPlacement,
      action: discard!,
      selectedZoneCardIds: ["hand-a"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(resolved.pendingZoneSelection).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は deck reveal swap-out の zone selection に継承される", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const revealed = createCardInstance(nonStackMagic, {
      instanceId: "revealed-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const hand = createCardInstance(nonStackMagic, {
      instanceId: "swap-out-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, revealed, hand],
    });
    const state: GameState = {
      ...base,
      pendingDeckReveal: {
        pendingId: "deck-reveal-swap-1",
        actingPlayerId: "alice",
        sourceInstanceId: "BSTH10.5-R21-trash",
        sourceDefinitionId: "BSTH10.5-R21",
        revealedCardInstanceIds: ["revealed-card"],
        picks: [],
        remainder: "trash",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: ["revealed-card"],
        revealedDispositionMap: { "revealed-card": { kind: "swap" } },
        postResolutionOracle: {
          chainId: "test:bsth10_5-cards:1458",
          triggerCardInstanceId: "BSTH10.5-R21-trash",
          triggerKind: "use_magic",
          magicTiming: "stack",
        },
      },
    };
    const acceptSwap = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(acceptSwap).toBeDefined();

    const afterReveal = applyLegalAction({
      state,
      action: acceptSwap!,
      selectedDeckRevealCardIds: ["revealed-card"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(afterReveal.pendingDeckReveal).toBeNull();
    expect(afterReveal.pendingZoneSelection?.postResolutionOracle).toEqual({
      chainId: "test:bsth10_5-cards:1458",
      triggerCardInstanceId: "BSTH10.5-R21-trash",
      triggerKind: "use_magic",
      magicTiming: "stack",
    });
    expect(
      afterReveal.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(false);

    const resolveSwapOut = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveSwapOut).toBeDefined();

    const resolved = applyLegalAction({
      state: afterReveal,
      action: resolveSwapOut!,
      selectedZoneCardIds: ["swap-out-hand"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(resolved.pendingZoneSelection).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は hand_or_set_aside_swap の最終 swap 解決後にキューされる", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const picked = createCardInstance(nonStackMagic, {
      instanceId: "swap-picked-revealed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const hand = createCardInstance(nonStackMagic, {
      instanceId: "swap-hand-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, picked, hand],
    });
    const state: GameState = {
      ...base,
      pendingZoneSelection: {
        pendingId: "hand-or-set-aside-swap-1",
        actingPlayerId: "alice",
        sourceInstanceId: "BSTH10.5-R21-trash",
        sourceDefinitionId: "BSTH10.5-R21",
        actionKind: "discard_hand",
        sourceZone: "hand",
        candidateCardInstanceIds: ["swap-hand-card"],
        maxCount: 1,
        destination: "deck_bottom",
        remainingActions: [],
        effectTiming: { kind: "continuous" },
        canSkip: true,
        swapPickedInstanceId: "swap-picked-revealed",
        swapPickedFallbackRemainder: "bottom",
        postResolutionOracle: {
          chainId: "test:bsth10_5-cards:1573",
          triggerCardInstanceId: "BSTH10.5-R21-trash",
          triggerKind: "use_magic",
          magicTiming: "stack",
        },
      },
    };
    const resolveSwap = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveSwap).toBeDefined();

    const resolved = applyLegalAction({
      state,
      action: resolveSwap!,
      selectedZoneCardIds: ["swap-hand-card"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(resolved.pendingZoneSelection).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は revealed_choice swap-out と swap chain が両方閉じてからキューされる", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const picked = createCardInstance(nonStackMagic, {
      instanceId: "chain-picked-revealed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const handA = createCardInstance(nonStackMagic, {
      instanceId: "normal-swap-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handB = createCardInstance(nonStackMagic, {
      instanceId: "chain-swap-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, picked, handA, handB],
    });
    const postResolutionOracle = {
      chainId: "test:bsth10_5-cards:1646",
      triggerCardInstanceId: "BSTH10.5-R21-trash",
      triggerKind: "use_magic" as const,
      magicTiming: "stack" as const,
    };
    const state: GameState = {
      ...base,
      pendingZoneSelection: {
        pendingId: "normal-swap-out-1",
        actingPlayerId: "alice",
        sourceInstanceId: "BSTH10.5-R21-trash",
        sourceDefinitionId: "BSTH10.5-R21",
        actionKind: "discard_hand",
        sourceZone: "hand",
        candidateCardInstanceIds: ["normal-swap-hand"],
        maxCount: 1,
        destination: "deck_bottom",
        remainingActions: [],
        effectTiming: { kind: "continuous" },
        canSkip: false,
        postResolutionOracle,
      },
      pendingDeckRevealSwapChain: [
        {
          pendingId: "chain-swap-1",
          actingPlayerId: "alice",
          sourceInstanceId: "BSTH10.5-R21-trash",
          sourceDefinitionId: "BSTH10.5-R21",
          actionKind: "discard_hand",
          sourceZone: "hand",
          candidateCardInstanceIds: ["chain-swap-hand"],
          maxCount: 1,
          destination: "deck_bottom",
          remainingActions: [],
          effectTiming: { kind: "continuous" },
          canSkip: true,
          swapPickedInstanceId: "chain-picked-revealed",
          swapPickedFallbackRemainder: "bottom",
          postResolutionOracle,
        },
      ],
    };

    const resolveNormal = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveNormal).toBeDefined();
    const afterNormal = applyLegalAction({
      state,
      action: resolveNormal!,
      selectedZoneCardIds: ["normal-swap-hand"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(afterNormal.pendingZoneSelection?.pendingId).toBe("chain-swap-1");
    expect(afterNormal.pendingDeckRevealSwapChain).toHaveLength(0);
    expect(
      afterNormal.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(false);

    const resolveChain = getLegalActions({
      state: afterNormal,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveChain).toBeDefined();
    const resolved = applyLegalAction({
      state: afterNormal,
      action: resolveChain!,
      selectedZoneCardIds: ["chain-swap-hand"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(resolved.pendingZoneSelection).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は MagicEffectResolver が生成した pending に継承される", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const hand = createCardInstance(nonStackMagic, {
      instanceId: "resolver-discard-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const hand2 = createCardInstance(nonStackMagic, {
      instanceId: "resolver-discard-hand-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, hand, hand2],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              lifeCoreCount: 4,
              reserveNormalCoreCount: 3,
            }
          : player
      ),
    };

    const afterResolveEffect = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "BSTH10.5-R21-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      resolveEffect: (currentState, context: MagicActionContext) =>
        executeEffect({
          chainId: "test:bsth10_5-cards:1798",
          state: currentState,
          effect: {
            timing: { kind: "activated", mode: "stack" },
            steps: [
              {
                action: {
                  kind: "discard",
                  count: 1,
                  player: "self",
                },
              },
            ],
          },
          sourceInstanceId: context.magicCard.instanceId,
          actingPlayerId: context.actingPlayerId,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          ...(context.postResolutionOracle
            ? { postResolutionOracle: context.postResolutionOracle }
            : {}),
        }),
    }).state;

    expect(afterResolveEffect.pendingZoneSelection?.actionKind).toBe(
      "discard_hand"
    );
    expect(afterResolveEffect.pendingZoneSelection?.postResolutionOracle).toBe(
      undefined
    );
    expect(
      afterResolveEffect.pendingZoneSelection?.continuation
        ?.postResolutionOracle
    ).toEqual({
      triggerCardInstanceId: "BSTH10.5-R21-hand",
      triggerKind: "use_magic",
      chainId: expect.any(String),
      magicTiming: "stack",
      magicEffectiveColors: ["blue"],
      effectActivatedActivatorPlayerId: "alice",
      effectActivationLogStart: expect.any(Number),
      effectSourceTotalReduction: 1,
      effectSourceSatisfiedReductionSymbolCount: 1,
      effectSourceRequiredReductionSymbolCount: 2,
      eligibleSourceInstanceIds: [],
    });
    expect(
      afterResolveEffect.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(false);

    const discard = getLegalActions({
      state: afterResolveEffect,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(discard).toBeDefined();
    const resolved = applyLegalAction({
      state: afterResolveEffect,
      action: discard!,
      selectedZoneCardIds: ["resolver-discard-hand"],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(resolved.pendingZoneSelection).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-hand"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は enter-field placement pending 解決後にキューされる", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const entering = createCardInstance(postResolutionSpirit, {
      instanceId: "post-resolution-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, entering],
    });
    const postResolutionOracle = {
      chainId: "test:bsth10_5-cards:1904",
      triggerCardInstanceId: "BSTH10.5-R21-trash",
      triggerKind: "use_magic" as const,
      magicTiming: "stack" as const,
    };
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 1 }
          : player
      ),
      pendingEnterFieldPlacement: {
        pendingId: "enter-field-post-oracle",
        actingPlayerId: "alice",
        sourceInstanceId: "post-resolution-spirit",
        sourceDefinitionId: postResolutionSpirit.cardNo,
        deferredStack: {
          stackId: "stack:post-resolution-spirit",
          actionKind: "summon",
          chainId: "chain:post-resolution-spirit",
          actingPlayerId: "alice",
          cardInstanceId: "post-resolution-spirit",
          cardDefinitionId: postResolutionSpirit.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          postResolutionOracle,
        },
        remainingStacks: [],
        minimumCoreCount: 1,
        maximumCoreCount: null,
        postResolutionOracle,
      },
    };

    const resolvePlacement = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();

    const resolved = applyLegalAction({
      state,
      action: resolvePlacement!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は brave combine choice から enter-field placement へ継承される", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const brave = createCardInstance(postResolutionBrave, {
      instanceId: "post-resolution-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const host = createCardInstance(postResolutionHost, {
      instanceId: "post-resolution-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, brave, host],
    });
    const postResolutionOracle = {
      chainId: "test:bsth10_5-cards:2004",
      triggerCardInstanceId: "BSTH10.5-R21-trash",
      triggerKind: "use_magic" as const,
      magicTiming: "stack" as const,
    };
    const state: GameState = {
      ...base,
      pendingBraveCombineChoice: {
        pendingId: "brave-combine-post-oracle",
        actingPlayerId: "alice",
        braveInstanceId: "post-resolution-brave",
        braveDefinitionId: postResolutionBrave.cardNo,
        deferredStack: {
          stackId: "stack:post-resolution-brave",
          actionKind: "summon",
          chainId: "chain:post-resolution-brave",
          actingPlayerId: "alice",
          cardInstanceId: "post-resolution-brave",
          cardDefinitionId: postResolutionBrave.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          postResolutionOracle,
        },
        remainingStacks: [],
        postResolutionOracle,
        hostCandidateInstanceIds: ["post-resolution-host"],
        spiritStateAffordable: true,
      },
    };

    const combine = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === "post-resolution-host"
    );
    expect(combine).toBeDefined();

    const afterCombine = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(afterCombine.pendingBraveCombineChoice).toBeNull();
    expect(
      afterCombine.pendingEnterFieldPlacement?.postResolutionOracle
    ).toEqual(postResolutionOracle);
    expect(
      afterCombine.pendingEnterFieldPlacement?.deferredStack
        .postResolutionOracle
    ).toEqual(postResolutionOracle);
    expect(
      afterCombine.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(false);

    const resolvePlacement = getLegalActions({
      state: afterCombine,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();

    const resolved = applyLegalAction({
      state: afterCombine,
      action: resolvePlacement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("post-resolution 神託は core count 由来の core distribution に継承される", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const targetA = createCardInstance(nonStackMagic, {
      instanceId: "core-target-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const targetB = createCardInstance(nonStackMagic, {
      instanceId: "core-target-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 1,
      cardInstances: [gwInstance, r21, targetA, targetB],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, trashNormalCoreCount: 1 } : player
      ),
      pendingCoreCountSelection: {
        pendingId: "core-count-1",
        actingPlayerId: "alice",
        sourceInstanceId: "BSTH10.5-R21-trash",
        sourceDefinitionId: "BSTH10.5-R21",
        fromLocation: { kind: "trash", player: "self" },
        toLocation: { kind: "field", player: "self" },
        min: 0,
        max: 1,
        effectTiming: { kind: "activated", mode: "stack" },
        postResolutionOracle: {
          chainId: "test:bsth10_5-cards:2149",
          triggerCardInstanceId: "BSTH10.5-R21-trash",
          triggerKind: "use_magic",
          magicTiming: "stack",
        },
      },
    };
    const chooseCount = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_core_count");
    expect(chooseCount).toBeDefined();

    const afterCount = applyLegalAction({
      state,
      action: chooseCount!,
      coreCountSelection: 1,
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(afterCount.pendingCoreCountSelection).toBeNull();
    expect(afterCount.pendingCoreDistribution?.postResolutionOracle).toEqual({
      chainId: "test:bsth10_5-cards:2149",
      triggerCardInstanceId: "BSTH10.5-R21-trash",
      triggerKind: "use_magic",
      magicTiming: "stack",
    });
    expect(
      afterCount.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(false);

    const distribute = getLegalActions({
      state: afterCount,
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(distribute).toBeDefined();

    const resolved = applyLegalAction({
      state: afterCount,
      action: distribute!,
      coreDistributionAllocations: { "core-target-a": 1 },
      getCardDefinitionById: getCardDefinitionByIdWithNonStack,
      getRegisteredFieldCardEffectActions,
      getRegisteredMagicActions,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "BSTH10.5-X01-field" &&
          pending.mechanic.triggerCardInstanceId === "BSTH10.5-R21-trash"
      )
    ).toBe(true);
  });

  it("BSTH10.5-X01 配置時神託はデッキ上のBSTH10.5-R21/R22を対象カードとして数える", () => {
    const gwInstance = createCardInstance(card, {
      instanceId: "BSTH10.5-X01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const deckR21 = createCardInstance(cardNoMap.get("BSTH10.5-R21")!, {
      instanceId: "BSTH10.5-R21-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deckR22 = createCardInstance(cardNoMap.get("BSTH10.5-R22")!, {
      instanceId: "BSTH10.5-R22-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deckNonMatch = createCardInstance(nonStackMagic, {
      instanceId: "NONSTACK-MAGIC-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 3,
      startingVoidNormalCoreCount: 5,
      cardInstances: [gwInstance, deckR21, deckR22, deckNonMatch],
    });
    const resolved = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "BSTH10.5-X01-field" },
      getCardDefinitionByIdWithNonStack
    );
    expect(
      getNormalCoreCountAtLocation(resolved, {
        kind: "card",
        instanceId: "BSTH10.5-X01-field",
      })
    ).toBe(2);
    expect(
      resolved.cardInstances
        .filter((c) => c.zone === "trash")
        .map((c) => c.instanceId)
    ).toEqual([
      "BSTH10.5-R21-deck",
      "BSTH10.5-R22-deck",
      "NONSTACK-MAGIC-deck",
    ]);
  });

  it("BSTH10.5-X01 は創界神として青としても扱う", () => {
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe("blue");
  });
});
