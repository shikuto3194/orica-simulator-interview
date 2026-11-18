import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { coreShootCardMatchesFilter } from "../src/effect/structured-core-shoot";
import {
  convertTargetSpecToEffectTarget,
  resolveTargets,
} from "../src/effect/native-target-resolution";
import { resolveCardImmunityAffect } from "../src/effect/effect-affect-adapter";
import { collectFieldCardDestinationCandidates } from "../src/effect/structured-core-move";
import { dynamicTargetFilterFromEffectTarget } from "../src/effect/structured-effect-interpreter";
import { executeExhaust } from "../src/effect/structured-state-grants";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import {
  executeReevaluationCheck,
  getCandidateTargetInstanceIds,
  matchesGlobalCETargetFilter,
} from "../src/legal/legal-actions-shared";
import { isGateCandidateProtected } from "../src/legal/pay-to-act-core-gate";
import { createStepExecutionContext } from "../src/step-execution-context";
import { stackMatchesNegateAction } from "../src/stack/stack-negate";
import type {
  Action,
  ActiveStack,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(cardNo: string, cost: number): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    printedColors: ["red"],
    colors: ["red"],
    cost,
    printedCost: cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const SOURCE_DEF = spiritDef("TARGET-RESOLUTION-SOURCE", 3);
const COST_THREE_SPIRIT_DEF = spiritDef("TARGET-RESOLUTION-COST3", 3);
const COST_FIVE_SPIRIT_DEF = spiritDef("TARGET-RESOLUTION-COST5", 5);
const COST_TWO_BRAVE_DEF: CardDefinition = {
  ...spiritDef("TARGET-RESOLUTION-BRAVE2", 2),
  printedCategory: "brave",
  braveCondition: { categories: ["spirit"] },
};
const TRIBE_FANTASY_MYOSHU_DEF: CardDefinition = {
  ...spiritDef("TARGET-RESOLUTION-TRIBE-FANTASY-MYOSHU", 3),
  tribe: "幻想・冥主",
};
const TRIBE_FANTASY_ONLY_DEF: CardDefinition = {
  ...spiritDef("TARGET-RESOLUTION-TRIBE-FANTASY-ONLY", 3),
  tribe: "幻想",
};

const DEFS: Record<string, CardDefinition> = {
  [SOURCE_DEF.cardNo]: SOURCE_DEF,
  [COST_THREE_SPIRIT_DEF.cardNo]: COST_THREE_SPIRIT_DEF,
  [COST_FIVE_SPIRIT_DEF.cardNo]: COST_FIVE_SPIRIT_DEF,
  [COST_TWO_BRAVE_DEF.cardNo]: COST_TWO_BRAVE_DEF,
  [TRIBE_FANTASY_MYOSHU_DEF.cardNo]: TRIBE_FANTASY_MYOSHU_DEF,
  [TRIBE_FANTASY_ONLY_DEF.cardNo]: TRIBE_FANTASY_ONLY_DEF,
};

const getDef = (id: string): CardDefinition | undefined => DEFS[id];

function stateWith(
  cardInstances: CardInstance[],
  activeContinuousEffects: ContinuousEffect[] = []
): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    activePlayerId: ALICE,
    cardInstances,
    activeContinuousEffects,
  };
}

function resolveOpponentSpiritIds(state: GameState) {
  return resolveTargetSpec({
    state,
    targetSpec: {
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit"], minCost: 5 },
      count: "all",
    },
    actingPlayerId: ALICE,
    sourceInstanceId: "source",
    getCardDefinitionById: getDef,
    stepContext: createStepExecutionContext(),
  }).map((card) => card.instanceId);
}

function activeStackFor(
  card: CardInstance,
  actionKind: ActiveStack["actionKind"] = "field_card_effect"
): ActiveStack {
  return {
    stackId: `stack:${card.instanceId}`,
    actionKind,
    chainId: `chain:${card.instanceId}`,
    actingPlayerId: card.controllerPlayerId ?? card.ownerPlayerId,
    cardInstanceId: card.instanceId,
    cardDefinitionId: card.definitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

describe("target-resolution cost filter SSOT", () => {
  it("通常 target filter の minCost は合体ユニットの host+brave cost 候補を見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "combined-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });

    expect(resolveOpponentSpiritIds(stateWith([source, host, brave]))).toEqual([
      host.instanceId,
    ]);
  });

  it("通常 target filter の minCost は override_properties.cost の実効コストを見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "cost-overridden-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const costOverrideCe: ContinuousEffect = {
      effectId: "override-target-cost-five",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: target.instanceId,
      metadata: { properties: { cost: 5 } },
    };

    expect(
      resolveOpponentSpiritIds(stateWith([source, target], [costOverrideCe]))
    ).toEqual([target.instanceId]);
  });

  it("maxCostSource:self_effective_cost は source の合体ユニット cost を閾値にする", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["source-brave"],
    });
    const sourceBrave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "source-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: source.instanceId,
      normalCoreCount: 1,
    });
    const target = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "cost-five-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = stateWith([source, sourceBrave, target]);

    const resolved = resolveTargetSpec({
      state,
      targetSpec: {
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit"],
          maxCostSource: "self_effective_cost",
        },
        count: "all",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: source.instanceId,
      getCardDefinitionById: getDef,
      stepContext: createStepExecutionContext(),
    });

    expect(resolved.map((card) => card.instanceId)).toEqual([
      target.instanceId,
    ]);
  });

  it("core_move from.filter の minCost は合体ユニットの host+brave cost 候補を見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "core-move-combined-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["core-move-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "core-move-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });
    const action: Action = {
      kind: "core_move",
      from: {
        kind: "field_card",
        player: "opponent",
        filter: { category: ["spirit"], minCost: 5 },
      },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    };

    expect(
      resolveTargets(
        action,
        stateWith([source, host, brave]),
        ALICE,
        source.instanceId,
        getDef,
        createStepExecutionContext()
      )
    ).toEqual([host.instanceId]);
  });

  it("core_move from.filter の maxBp は合体ユニットの host+brave BP 候補を見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "bp-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "core-move-bp-combined-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["core-move-bp-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "core-move-bp-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 0,
    });
    const action: Action = {
      kind: "core_move",
      from: {
        kind: "field_card",
        player: "opponent",
        filter: { category: ["spirit"], maxBp: 4000 },
      },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    };

    expect(
      resolveTargets(
        action,
        stateWith([source, host, brave]),
        ALICE,
        source.instanceId,
        getDef,
        createStepExecutionContext()
      )
    ).toEqual([]);
  });

  it("coreShootCardMatchesFilter は合体コストを見つつ costBasis:printed では印字コストに限定する", () => {
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "core-shoot-combined-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["core-shoot-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "core-shoot-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });
    const state = stateWith([host, brave]);

    expect(
      coreShootCardMatchesFilter(
        state,
        host,
        { category: ["spirit"], minCost: 5 },
        getDef
      )
    ).toBe(true);
    expect(
      coreShootCardMatchesFilter(
        state,
        host,
        { category: ["spirit"], minCost: 5, costBasis: "printed" },
        getDef
      )
    ).toBe(false);
  });

  it("EffectTarget 変換の maxCostSource:self_effective_cost は actionKind 無しでも source の合体ユニット cost を閾値にする", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "effect-target-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["effect-target-source-brave"],
    });
    const sourceBrave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "effect-target-source-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: source.instanceId,
      normalCoreCount: 1,
    });
    const target = convertTargetSpecToEffectTarget(
      {
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit"],
          maxCostSource: "self_effective_cost",
        },
        count: 1,
      },
      {
        state: stateWith([source, sourceBrave]),
        sourceInstanceId: source.instanceId,
        getCardDefinitionById: getDef,
      }
    );

    expect(target.filter?.maxCost).toBe(5);
    expect(target.filter?.maxCostSource).toBeUndefined();
  });

  it("core_move field_card destination filter の minCost は合体ユニットの host+brave cost 候補を見る", () => {
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "field-card-destination-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["field-card-destination-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "field-card-destination-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });

    expect(
      collectFieldCardDestinationCandidates({
        state: stateWith([host, brave]),
        to: {
          kind: "field_card",
          player: "opponent",
          filter: { category: ["spirit"], minCost: 5 },
        },
        toPlayerId: BOB,
        getCardDefinitionById: getDef,
        coreMoveDestinationTargetIds: undefined,
      }).map((card) => card.instanceId)
    ).toEqual([host.instanceId]);
  });

  it("core_move field_card destination filter の maxBp は合体ユニットの host+brave BP 候補を見る", () => {
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "field-card-destination-bp-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["field-card-destination-bp-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "field-card-destination-bp-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 0,
    });

    expect(
      collectFieldCardDestinationCandidates({
        state: stateWith([host, brave]),
        to: {
          kind: "field_card",
          player: "opponent",
          filter: { category: ["spirit"], maxBp: 4000 },
        },
        toPlayerId: BOB,
        getCardDefinitionById: getDef,
        coreMoveDestinationTargetIds: undefined,
      }).map((card) => card.instanceId)
    ).toEqual([]);
  });

  it("legal action 候補列挙の targetCardFilter minCost は合体ユニットの host+brave cost 候補を見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "candidate-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "candidate-combined-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["candidate-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "candidate-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });

    expect(
      getCandidateTargetInstanceIds(
        stateWith([source, host, brave]),
        ALICE,
        {
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: { category: ["spirit"], minCost: 5 },
          requiredTargetCount: 1,
        },
        {
          getCardDefinitionById: getDef,
          sourceInstanceId: source.instanceId,
          sourceDefinition: SOURCE_DEF,
        }
      )
    ).toEqual([host.instanceId]);
  });

  it("EffectTarget 自動解決の minCost は target.filter と flat 経路の両方で合体コストを見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "effect-target-auto-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "effect-target-auto-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["effect-target-auto-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "effect-target-auto-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });

    const viaFilter = executeExhaust(
      stateWith([source, host, brave]),
      ALICE,
      {
        player: "opponent",
        count: 1,
        filter: { category: ["spirit"], minCost: 5 },
      },
      getDef,
      undefined,
      source.instanceId
    );
    expect(
      viaFilter.cardInstances.find(
        (card) => card.instanceId === host.instanceId
      )?.exhaustState
    ).toBe("exhausted");

    const viaFlat = executeExhaust(
      stateWith([source, host, brave]),
      ALICE,
      {
        player: "opponent",
        count: 1,
        category: ["spirit"],
        minCost: 5,
      },
      getDef,
      undefined,
      source.instanceId
    );
    expect(
      viaFlat.cardInstances.find((card) => card.instanceId === host.instanceId)
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("dynamic CE targetFilter の cost 判定は合体コスト/override/additional cost 候補を見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "dynamic-ce-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "dynamic-ce-combined-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["dynamic-ce-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "dynamic-ce-combined-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });
    const overridden = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "dynamic-ce-overridden-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const additional = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "dynamic-ce-additional-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const minCostFilterCe: ContinuousEffect = {
      effectId: "dynamic-ce-min-cost-filter",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_resistance",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        minCost: 5,
      },
    };
    const maxCostFilterCe: ContinuousEffect = {
      ...minCostFilterCe,
      effectId: "dynamic-ce-max-cost-filter",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        maxCost: 3,
      },
    };
    const overrideCostCe: ContinuousEffect = {
      effectId: "dynamic-ce-override-cost-five",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: overridden.instanceId,
      metadata: { properties: { cost: 5 } },
    };
    const additionalCostCe: ContinuousEffect = {
      effectId: "dynamic-ce-additional-cost-three",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "additional_cost",
      modifierAmount: 3,
      targetInstanceId: additional.instanceId,
    };
    const state = stateWith(
      [source, host, brave, overridden, additional],
      [minCostFilterCe, maxCostFilterCe, overrideCostCe, additionalCostCe]
    );

    expect(
      matchesGlobalCETargetFilter(state, minCostFilterCe, host, getDef)
    ).toBe(true);
    expect(
      matchesGlobalCETargetFilter(state, minCostFilterCe, overridden, getDef)
    ).toBe(true);
    expect(
      matchesGlobalCETargetFilter(state, maxCostFilterCe, additional, getDef)
    ).toBe(true);
  });

  it("matchesGlobalCETargetFilter の !actualCard フォールバックは tribesRequired(AND) を反映する (SSOT: matchesTribes)", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "tribe-required-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const tribesRequiredFilterCe: ContinuousEffect = {
      effectId: "tribe-required-filter",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_resistance",
      targetFilter: {
        player: "self",
        tribesRequired: ["幻想", "冥主"],
      },
    };
    const state = stateWith([source], [tribesRequiredFilterCe]);

    // instanceId 未設定 = actualCard 無しのフォールバック経路。
    // 系統「幻想」「冥主」を両方持つ定義は一致。
    expect(
      matchesGlobalCETargetFilter(
        state,
        tribesRequiredFilterCe,
        {
          controllerPlayerId: ALICE,
          definitionId: TRIBE_FANTASY_MYOSHU_DEF.cardNo,
        },
        getDef
      )
    ).toBe(true);
    // 「幻想」のみ (「冥主」を欠く) 定義は tribesRequired の AND を満たさず不一致。
    expect(
      matchesGlobalCETargetFilter(
        state,
        tribesRequiredFilterCe,
        {
          controllerPlayerId: ALICE,
          definitionId: TRIBE_FANTASY_ONLY_DEF.cardNo,
        },
        getDef
      )
    ).toBe(false);
  });

  it("dynamic suppress_effect の suppressTargetFilter maxCost は合体/override cost 候補を見る", () => {
    const suppressor = createCardInstance(SOURCE_DEF, {
      instanceId: "dynamic-suppress-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const eligible = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "dynamic-suppress-eligible-cost-five",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedHost = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "dynamic-suppress-combined-cost-seven",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["dynamic-suppress-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "dynamic-suppress-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: combinedHost.instanceId,
      normalCoreCount: 1,
    });
    const overridden = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "dynamic-suppress-overridden-cost-seven",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const suppressCe: ContinuousEffect = {
      effectId: "dynamic-suppress-max-cost-six",
      sourceInstanceId: suppressor.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      metadata: {
        suppressTargetFilter: {
          category: ["spirit", "ultimate"],
          maxCost: 6,
        },
        suppressTargetPlayer: "opponent",
      },
    };
    const overrideCostCe: ContinuousEffect = {
      effectId: "dynamic-suppress-override-cost-seven",
      sourceInstanceId: suppressor.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: overridden.instanceId,
      metadata: { properties: { cost: 7 } },
    };
    const state = stateWith(
      [suppressor, eligible, combinedHost, brave, overridden],
      [suppressCe, overrideCostCe]
    );
    const isSuppressed = (sourceInstanceId: string) =>
      !executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          triggerPhrases: ["召喚時"],
        },
        getCardDefinitionById: getDef,
      });

    expect(isSuppressed(eligible.instanceId)).toBe(true);
    expect(isSuppressed(combinedHost.instanceId)).toBe(false);
    expect(isSuppressed(overridden.instanceId)).toBe(false);
  });

  it("TargetSpec.filter 由来 dynamic effect_immunity の maxCost は implicit field zone でも登録される", () => {
    const protector = createCardInstance(SOURCE_DEF, {
      instanceId: "dynamic-immunity-filter-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = convertTargetSpecToEffectTarget(
      {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], maxCost: 6 },
        count: "all",
      },
      {
        state: stateWith([protector]),
        sourceInstanceId: protector.instanceId,
        getCardDefinitionById: getDef,
      }
    );

    expect(dynamicTargetFilterFromEffectTarget(target)).toMatchObject({
      player: "self",
      category: ["spirit"],
      maxCost: 6,
      zone: ["field"],
    });
  });

  it("flat EffectTarget 由来 dynamic effect_immunity の maxCost は登録/消費とも合体/override costを見る", () => {
    const protector = createCardInstance(SOURCE_DEF, {
      instanceId: "dynamic-immunity-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentSource = createCardInstance(SOURCE_DEF, {
      instanceId: "dynamic-immunity-opponent-effect-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const eligible = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "dynamic-immunity-eligible-cost-five",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedHost = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "dynamic-immunity-combined-cost-seven",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["dynamic-immunity-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "dynamic-immunity-combined-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: combinedHost.instanceId,
      normalCoreCount: 1,
    });
    const overridden = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "dynamic-immunity-overridden-cost-seven",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetFilter = dynamicTargetFilterFromEffectTarget({
      player: "self",
      count: -1,
      category: ["spirit"],
      maxCost: 6,
      zone: ["field"],
    });
    expect(targetFilter).toMatchObject({
      player: "self",
      category: ["spirit"],
      maxCost: 6,
      zone: ["field"],
    });
    const defenseCe: ContinuousEffect = {
      effectId: "dynamic-immunity-max-cost-six",
      sourceInstanceId: protector.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetFilter: targetFilter!,
    };
    const overrideCostCe: ContinuousEffect = {
      effectId: "dynamic-immunity-override-cost-seven",
      sourceInstanceId: protector.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: overridden.instanceId,
      metadata: { properties: { cost: 7 } },
    };
    const state = stateWith(
      [protector, opponentSource, eligible, combinedHost, brave, overridden],
      [defenseCe, overrideCostCe]
    );
    const immunityKind = (card: CardInstance) =>
      resolveCardImmunityAffect(
        state,
        card,
        BOB,
        "none",
        { instance: opponentSource, definition: SOURCE_DEF },
        getDef
      ).kind;

    expect(immunityKind(eligible)).toBe("blocked");
    expect(immunityKind(combinedHost)).toBe("allowed");
    expect(immunityKind(overridden)).toBe("allowed");
  });

  it("stack negate の target gate は dynamic effect_immunity の cost filter を消費する", () => {
    const negateSource = createCardInstance(SOURCE_DEF, {
      instanceId: "stack-negate-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const protector = createCardInstance(SOURCE_DEF, {
      instanceId: "stack-negate-protector",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const eligible = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "stack-negate-eligible-cost-five",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedHost = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "stack-negate-combined-cost-seven",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["stack-negate-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "stack-negate-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: combinedHost.instanceId,
      normalCoreCount: 1,
    });
    const defenseCe: ContinuousEffect = {
      effectId: "stack-negate-dynamic-immunity",
      sourceInstanceId: protector.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetFilter: { player: "self", maxCost: 6 },
    };
    const state = stateWith(
      [negateSource, protector, eligible, combinedHost, brave],
      [defenseCe]
    );
    const matchesNegate = (
      card: CardInstance,
      actionKind: ActiveStack["actionKind"] = "field_card_effect"
    ) =>
      stackMatchesNegateAction({
        state,
        stack: activeStackFor(card, actionKind),
        request: {
          negateTarget: "effect",
          sourceInstanceId: negateSource.instanceId,
        },
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });

    expect(matchesNegate(eligible)).toBe(false);
    expect(matchesNegate(combinedHost)).toBe(true);
    expect(matchesNegate(brave, "field_card_effect")).toBe(true);
    expect(matchesNegate(brave, "triggered_effect")).toBe(true);
    expect(matchesNegate(brave, "battle_immediate_effect")).toBe(true);
  });

  it("stack negate の targetFilter minCost は field stack の合体ユニット cost を見る", () => {
    const negateSource = createCardInstance(SOURCE_DEF, {
      instanceId: "stack-filter-negate-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const eligible = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "stack-filter-eligible-cost-five",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedHost = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "stack-filter-combined-cost-seven",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["stack-filter-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "stack-filter-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: combinedHost.instanceId,
      normalCoreCount: 1,
    });
    const state = stateWith([negateSource, eligible, combinedHost, brave]);
    const matchesNegate = (
      card: CardInstance,
      actionKind: ActiveStack["actionKind"] = "field_card_effect",
      stackCost?: number
    ) =>
      stackMatchesNegateAction({
        state,
        stack: {
          ...activeStackFor(card, actionKind),
          ...(stackCost !== undefined ? { costForFilter: stackCost } : {}),
        },
        request: {
          negateTarget: "effect",
          sourceInstanceId: negateSource.instanceId,
          targetFilter: { category: ["spirit"], minCost: 7 },
        },
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });

    expect(matchesNegate(eligible)).toBe(false);
    expect(matchesNegate(combinedHost)).toBe(true);
    expect(matchesNegate(brave, "field_card_effect")).toBe(true);
    expect(matchesNegate(brave, "triggered_effect")).toBe(true);
    expect(matchesNegate(brave, "battle_immediate_effect")).toBe(true);
    expect(matchesNegate(eligible, "field_card_effect", 7)).toBe(true);
  });

  it("stack negate の targetFilter maxBp は field stack の合体ユニット BP を見る", () => {
    const negateSource = createCardInstance(SOURCE_DEF, {
      instanceId: "stack-bp-negate-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const eligible = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "stack-bp-eligible",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedHost = createCardInstance(COST_THREE_SPIRIT_DEF, {
      instanceId: "stack-bp-combined-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["stack-bp-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "stack-bp-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: combinedHost.instanceId,
      normalCoreCount: 0,
    });
    const state = stateWith([negateSource, eligible, combinedHost, brave]);
    const matchesNegate = (card: CardInstance) =>
      stackMatchesNegateAction({
        state,
        stack: activeStackFor(card),
        request: {
          negateTarget: "effect",
          sourceInstanceId: negateSource.instanceId,
          targetFilter: { category: ["spirit"], maxBp: 4000 },
        },
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });

    expect(matchesNegate(eligible)).toBe(true);
    expect(matchesNegate(combinedHost)).toBe(false);
  });

  it("pay-to-act core gate 候補保護は dynamic effect_immunity の cost filter を消費する", () => {
    const gateSource = createCardInstance(SOURCE_DEF, {
      instanceId: "pay-to-act-gate-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const protector = createCardInstance(SOURCE_DEF, {
      instanceId: "pay-to-act-protector",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const eligible = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "pay-to-act-eligible-cost-five",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedHost = createCardInstance(COST_FIVE_SPIRIT_DEF, {
      instanceId: "pay-to-act-combined-cost-seven",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["pay-to-act-combined-brave"],
    });
    const brave = createCardInstance(COST_TWO_BRAVE_DEF, {
      instanceId: "pay-to-act-combined-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: combinedHost.instanceId,
      normalCoreCount: 1,
    });
    const defenseCe: ContinuousEffect = {
      effectId: "pay-to-act-dynamic-immunity",
      sourceInstanceId: protector.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetFilter: { player: "self", category: ["spirit"], maxCost: 6 },
    };
    const gateCe: ContinuousEffect = {
      effectId: "pay-to-act-core-gate",
      sourceInstanceId: gateSource.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "gate_flash_stack_core",
      targetInstanceId: BOB,
    };
    const state = stateWith(
      [gateSource, protector, eligible, combinedHost, brave],
      [defenseCe, gateCe]
    );

    expect(isGateCandidateProtected(state, eligible, [gateCe], getDef)).toBe(
      true
    );
    expect(
      isGateCandidateProtected(state, combinedHost, [gateCe], getDef)
    ).toBe(false);
  });
});
