/**
 * P3-100 星霊衣 star_garment — S3 host 効果集約の battle-immediate slice。
 *
 * BSFT01-TR08(B) の「【星霊衣】でスピリット下にあるこのカード」のブロック時効果は、
 * under-card 自身ではなく host の「このスピリット」効果として発揮する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  queueRegisteredBattleImmediateEffects,
  useBattleImmediateEffectAsAction,
} from "../src/battle/battle-immediate-effect-system";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";
import {
  buildLegalActionTargetGroups,
  canUseEffectByUsageLimit,
  removeExpiredContinuousEffects,
} from "../src/legal/legal-actions-shared";
import { executeBattleResolution, getEffectiveBp } from "../src";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import {
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  generateBattleImmediateEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import type { EffectActionContext } from "../src/effect/effect-resolution";
import type { RegisteredTargetedEffectActionBase } from "../src/legal/legal-actions-types";

const ALICE = "player-1";
const BOB = "player-2";

function bpCompareDestroyImmunityCE(
  targetInstanceId: string,
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: `ce-bpc-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "test-def",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed_by_bp_compare",
    targetInstanceId,
    metadata: { source: "all" },
  };
}

const HOST_DEF = {
  underCardSlots: [
    { roleTag: "星霊衣", maxCount: 1 },
    { roleTag: "バレットエディット", maxCount: 1 },
  ],
  cardNo: "BSFT01-CX01",
  name: "ルーシィ・ハートフィリア",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 2,
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  textLines: [],
  images: {},
  tribe: "星霊魔導士",
  colors: ["blue"],
} as CardDefinition;

const UNDER_DEF = {
  cardNo: "BSFT01-TR08(B)",
  name: "アリエス",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 5,
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
    "“『このスピリットのブロック時』相手のスピリット/アルティメット1体を手札に戻す。”",
  ],
  images: {},
  tribe: "光導・星霊",
  colors: ["blue"],
  keywordTags: ["star_garment"],
  effects: [
    {
      timing: { kind: "card_event", event: "block" },
      steps: [
        {
          action: {
            kind: "bounce",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 1,
            },
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
} as CardDefinition;

const ATTACK_UNDER_DEF = {
  cardNo: "BSFT01-TR07(B)",
  name: "バルゴ",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 5,
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
    "“『このスピリットのアタック時』ボイドからコア1個を自分のフィールド/リザーブに置くことで、このバトルの間、このスピリットはブロックされない。”",
  ],
  images: {},
  tribe: "光導・星霊",
  colors: ["blue"],
  keywordTags: ["star_garment"],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      executionMode: "optional",
      steps: [
        {
          id: "place_core",
          action: {
            kind: "core_move",
            from: { kind: "void", player: "self" },
            amount: 1,
            splitDestinations: {
              destinations: [
                { location: { kind: "field", player: "self" } },
                { location: { kind: "reserve", player: "self" } },
              ],
            },
          },
        },
        {
          action: {
            kind: "unblockable",
            target: { kind: "self" },
            duration: { scope: "battle" },
          },
          connector: "conditional_cost",
        },
      ],
      textRef: [0, 1],
    },
  ],
} as CardDefinition;

const ORDINARY_UNDER_DEF = {
  cardNo: "BSFT01-TR03(B)",
  name: "通常B面効果を持つ星霊衣下カード",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 4,
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "『このスピリットのアタック時』相手のスピリット1体を手札に戻す。",
  ],
  images: {},
  tribe: "光導・星霊",
  colors: ["blue"],
  keywordTags: ["star_garment"],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bounce",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
      textRef: [0],
    },
  ],
} as CardDefinition;

const ULTIMATE_HOST_DEF = {
  cardNo: "SG-ULTIMATE-HOST",
  name: "非スピリットhost",
  printedCategory: "ultimate",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 4,
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 3, requiredCores: 1, bp: 5000 }],
  textLines: [],
  images: {},
  colors: ["blue"],
} as CardDefinition;

const TARGET_DEF = {
  cardNo: "SG-TARGET",
  name: "相手スピリット",
  printedCategory: "spirit",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [],
  images: {},
  colors: ["red"],
} as CardDefinition;

const TARGETED_RESPONDER_DEF = {
  cardNo: "SG-TARGETED-RESPONDER",
  name: "host source targeted responder",
  printedCategory: "spirit",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [],
  images: {},
  colors: ["red"],
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "targeted",
        triggerSourceFilter: { cardName: { exact: UNDER_DEF.name } },
      },
      executionMode: "optional",
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
} as CardDefinition;

const TOKEN_DEF = {
  cardNo: "SG-TOKEN",
  name: "差し替え先トークン",
  printedCategory: "spirit",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 0,
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  images: {},
  colors: ["red"],
} as CardDefinition;

const NEXUS_DEF = {
  cardNo: "SG-PREVENTION-NEXUS",
  name: "防止元ネクサス",
  printedCategory: "nexus",
  printedColors: ["blue"],
  symbolColors: ["blue"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  textLines: [],
  images: {},
  colors: ["blue"],
} as CardDefinition;

const defs = new Map<string, CardDefinition>([
  [HOST_DEF.cardNo, HOST_DEF],
  [UNDER_DEF.cardNo, UNDER_DEF],
  [ATTACK_UNDER_DEF.cardNo, ATTACK_UNDER_DEF],
  [ORDINARY_UNDER_DEF.cardNo, ORDINARY_UNDER_DEF],
  [ULTIMATE_HOST_DEF.cardNo, ULTIMATE_HOST_DEF],
  [TARGET_DEF.cardNo, TARGET_DEF],
  [TARGETED_RESPONDER_DEF.cardNo, TARGETED_RESPONDER_DEF],
  [TOKEN_DEF.cardNo, TOKEN_DEF],
  [NEXUS_DEF.cardNo, NEXUS_DEF],
]);

const getDef = (id: string): CardDefinition | undefined => defs.get(id);
const getBattleRegs = (cardNo: string) =>
  defs.has(cardNo)
    ? generateBattleImmediateEffectRegistrations(defs.get(cardNo)!)
    : [];
const getTriggeredRegs = buildTriggeredEffectLookup([TARGETED_RESPONDER_DEF]);
const noFieldEffectLookup = () => undefined;

function makeState(): GameState {
  const host = createCardInstance(HOST_DEF, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  host.underCards = [
    { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
  ];

  const under = createCardInstance(UNDER_DEF, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "host-1";
  under.zoneRoleName = "star-garment";

  const target = createCardInstance(TARGET_DEF, {
    instanceId: "target-1",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });

  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, under, target],
  });
}

function withActiveBlockBattle(state: GameState): GameState {
  return {
    ...state,
    step: "attack",
    window: "declare_attack",
    activePlayerId: ALICE,
    turnNumber: 2,
    battleEntities: [
      {
        entityId: "battle-entity:host-1",
        memberInstanceIds: ["host-1"],
        resolvedBp: 2000,
        resolvedSymbols: ["guide"],
        attackState: "blocking",
      },
    ],
    activeAttack: {
      attackId: "attack-1",
      primaryEntityId: "battle-entity:attacker",
      participantEntityIds: ["battle-entity:host-1"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:host-1",
          blockedByEntityIds: ["battle-entity:host-1"],
        },
      ],
      symbolResolutionOrder: ["battle-entity:host-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
  };
}

function withActiveAttackBattle(state: GameState): GameState {
  return {
    ...state,
    step: "attack",
    window: "declare_attack",
    activePlayerId: ALICE,
    turnNumber: 2,
    battleEntities: [
      {
        entityId: "battle-entity:host-1",
        memberInstanceIds: ["host-1"],
        resolvedBp: 2000,
        resolvedSymbols: ["guide"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-1",
      primaryEntityId: "battle-entity:host-1",
      participantEntityIds: ["battle-entity:host-1"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:host-1",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:host-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
  };
}

function redirectTargetCe(): ContinuousEffect {
  return {
    effectId: "ce-redirect-star-garment-target",
    sourceInstanceId: "target-1",
    sourceDefinitionId: TARGET_DEF.cardNo,
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    metadata: {
      triggerCondition: {
        sourcePlayerRef: "opponent",
        protectedTargetKind: "instances",
        protectedInstanceIds: ["target-1"],
      },
      redirectCandidateSource: {
        kind: "explicit",
        instanceIds: ["token-1"],
      },
      optional: true,
    } as unknown as Record<string, unknown>,
  };
}

function sourcePreventionGrantCE(state: GameState): ContinuousEffect {
  return {
    effectId: "ce-star-garment-battle-source-prevention",
    sourceInstanceId: "host-1",
    sourceDefinitionId: HOST_DEF.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "effect_source_prevention_immunity",
    targetInstanceId: ALICE,
    metadata: {
      tribes: ["星霊"],
      appliesTo: ["prevention"],
      preventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    },
  };
}

function defenseImmuneFromNexusCE(
  targetInstanceId: string,
  state: GameState
): ContinuousEffect {
  return {
    effectId: `ce-star-garment-battle-defense-immune-${targetInstanceId}`,
    sourceInstanceId: "nexus-preventer",
    sourceDefinitionId: NEXUS_DEF.cardNo,
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
  };
}

function defenseImmuneFromHostCostSourceCE(
  targetInstanceId: string,
  state: GameState
): ContinuousEffect {
  return {
    effectId: `ce-star-garment-battle-defense-immune-host-cost-${targetInstanceId}`,
    sourceInstanceId: "nexus-preventer",
    sourceDefinitionId: NEXUS_DEF.cardNo,
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
    immunitySourceScope: { maxCost: 4 },
  };
}

describe("P3-100 star_garment: battle immediate host aggregation", () => {
  it("BSFT01-TR08(B) under-card block effect queues and resolves from the host", () => {
    const state = makeState();
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "participant-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(queued.battleImmediateEffects).toHaveLength(1);
    const prompt = queued.battleImmediateEffects[0]!;
    expect(prompt.sourceInstanceId).toBe("host-1");
    expect(prompt.sourceDefinitionId).toBe("BSFT01-CX01");
    expect(prompt.sourceEffectDefinitionId).toBe("BSFT01-TR08(B)");
    expect(prompt.sourceEffectInstanceId).toBe("under-1");
    expect(prompt.sourceCardNo).toBe("BSFT01-TR08(B)");
    expect(
      collectGameStateInvariantIssues(queued).some(
        (issue) =>
          issue.code === "battle_immediate_effect_source_definition_mismatch"
      )
    ).toBe(false);

    let observedContext: EffectActionContext | null = null;
    useBattleImmediateEffectAsAction({
      state: queued,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      resolveEffect: (overrideState, context) => {
        observedContext = context;
        return overrideState;
      },
    });
    expect(observedContext?.sourceDefinition.cardNo).toBe("BSFT01-CX01");
    expect(observedContext?.effectSourceDefinition?.cardNo).toBe(
      "BSFT01-TR08(B)"
    );

    const result = useBattleImmediateEffectAsAction({
      state: queued,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    const target = result.state.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(target.zone).toBe("hand");
    expect(result.state.battleImmediateEffects).toHaveLength(0);
  });

  it("uses the provider under-card for source-prevention bypass in battle immediate candidates", () => {
    const base = withActiveBlockBattle(makeState());
    const host = base.cardInstances.find((c) => c.instanceId === "host-1")!;
    const protectedState: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        defenseImmuneFromNexusCE("target-1", base),
      ],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state: protectedState,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");

    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceEffectInstanceId: "under-1",
      candidateTargetInstanceIds: ["target-1"],
    });
  });

  it("does not let host-only sourceScope immunity block battle immediate provider candidates", () => {
    const base = withActiveBlockBattle(makeState());
    const host = base.cardInstances.find((c) => c.instanceId === "host-1")!;
    const protectedState: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        defenseImmuneFromHostCostSourceCE("target-1", base),
      ],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state: protectedState,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");

    expect(declaration).toMatchObject({
      kind: "resolve_battle_immediate_effect",
      sourceInstanceId: "host-1",
      sourceEffectInstanceId: "under-1",
      candidateTargetInstanceIds: ["target-1"],
    });
  });

  it("keeps provider identity through battle-immediate native target recheck", () => {
    const base = makeState();
    const host = base.cardInstances.find((c) => c.instanceId === "host-1")!;
    const protectedState: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        defenseImmuneFromHostCostSourceCE("target-1", base),
      ],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state: protectedState,
      attackId: "attack-1",
      participantEntityId: "participant-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const prompt = queued.battleImmediateEffects[0]!;

    const result = useBattleImmediateEffectAsAction({
      state: queued,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    const target = result.state.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(target.zone).toBe("hand");
  });

  it("BSFT01-TR07(B) under-card attack effect resumes splitDestinations through nested field distribution", () => {
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-attack",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-attack", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(ATTACK_UNDER_DEF, {
      instanceId: "under-attack",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-attack";
    under.zoneRoleName = "star-garment";
    const ally = createCardInstance(TOKEN_DEF, {
      instanceId: "ally-attack",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      startingVoidNormalCoreCount: 3,
      cardInstances: [host, under, ally],
    });
    const lookupOpts = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-tr07",
      participantEntityId: "battle-entity:host-attack",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...lookupOpts,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(declaration).toMatchObject({
      kind: "resolve_battle_immediate_effect",
      sourceInstanceId: "host-attack",
      sourceEffectInstanceId: "under-attack",
      sourceEffectDefinitionId: ATTACK_UNDER_DEF.cardNo,
    });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      ...lookupOpts,
    }).state;
    const opened = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      ...lookupOpts,
    }).state;
    expect(opened.pendingCoreSplitSelection).toMatchObject({
      sourceInstanceId: "host-attack",
      sourceDefinitionId: HOST_DEF.cardNo,
      continuation: {
        sourceInstanceId: "host-attack",
        sourceDefinitionId: ATTACK_UNDER_DEF.cardNo,
        effectSourceInstanceId: "under-attack",
        effectSourceDefinitionId: ATTACK_UNDER_DEF.cardNo,
      },
    });

    const splitAction = getLegalActions({
      state: opened,
      actingPlayerId: ALICE,
      ...lookupOpts,
    }).find((action) => action.kind === "resolve_pending_core_split");
    expect(splitAction).toBeDefined();
    const afterSplit = applyLegalAction({
      state: opened,
      action: splitAction!,
      coreSplitDistribution: [1, 0],
      ...lookupOpts,
    }).state;
    expect(afterSplit.pendingCoreDistribution).toMatchObject({
      sourceInstanceId: "host-attack",
      sourceDefinitionId: HOST_DEF.cardNo,
      continuation: {
        sourceInstanceId: "host-attack",
        sourceDefinitionId: ATTACK_UNDER_DEF.cardNo,
        effectSourceInstanceId: "under-attack",
        effectSourceDefinitionId: ATTACK_UNDER_DEF.cardNo,
      },
    });

    const distributionAction = getLegalActions({
      state: afterSplit,
      actingPlayerId: ALICE,
      ...lookupOpts,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(distributionAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterSplit,
      action: distributionAction!,
      coreDistributionAllocations: { "host-attack": 1 },
      ...lookupOpts,
    }).state;

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "host-attack")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "host-attack"
      )
    ).toBe(true);
  });

  it("BSFT01-TR07(B) under-card attack effect can be declined without consuming usage", () => {
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-attack-decline",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-attack-decline",
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    const under = createCardInstance(ATTACK_UNDER_DEF, {
      instanceId: "under-attack-decline",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-attack-decline";
    under.zoneRoleName = "star-garment";
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      startingVoidNormalCoreCount: 3,
      cardInstances: [host, under],
    });
    const lookupOpts = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-tr07-decline",
      participantEntityId: "battle-entity:host-attack-decline",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const reserveBefore = queued.players.find(
      (player) => player.id === ALICE
    )!.reserveNormalCoreCount;
    const decline = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...lookupOpts,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectInstanceId === "under-attack-decline" &&
        action.sourceEffectDefinitionId === ATTACK_UNDER_DEF.cardNo &&
        action.skipOnly === true
    );
    expect(decline).toMatchObject({
      kind: "resolve_battle_immediate_effect",
      executionMode: "optional",
      skipOnly: true,
    });

    const declined = applyLegalAction({
      state: queued,
      action: decline!,
      ...lookupOpts,
    }).state;

    expect(declined.pendingCoreSplitSelection).toBeNull();
    expect(declined.pendingCoreDistribution).toBeNull();
    expect(
      declined.cardInstances.find(
        (card) => card.instanceId === "host-attack-decline"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      declined.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(reserveBefore);
    expect(
      declined.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "host-attack-decline"
      )
    ).toBe(false);
    expect(
      declined.effectUsageRecords.some(
        (record) =>
          record.sourceDefinitionId === ATTACK_UNDER_DEF.cardNo ||
          record.sourceInstanceId === "under-attack-decline"
      )
    ).toBe(false);
  });

  it("BSFT01-TR07(B) under-card attack effect fails closed when void has no core", () => {
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-attack-no-void",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-attack-no-void",
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    const under = createCardInstance(ATTACK_UNDER_DEF, {
      instanceId: "under-attack-no-void",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-attack-no-void";
    under.zoneRoleName = "star-garment";
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      startingVoidNormalCoreCount: 0,
      cardInstances: [host, under],
    });
    const lookupOpts = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-tr07-no-void",
      participantEntityId: "battle-entity:host-attack-no-void",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...lookupOpts,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectInstanceId === "under-attack-no-void" &&
        action.sourceEffectDefinitionId === ATTACK_UNDER_DEF.cardNo &&
        action.skipOnly !== true
    );
    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      ...lookupOpts,
    }).state;
    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      ...lookupOpts,
    }).state;

    expect(resolved.pendingCoreSplitSelection).toBeNull();
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "host-attack-no-void"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "host-attack-no-void"
      )
    ).toBe(false);
    expect(
      resolved.effectUsageRecords.some(
        (record) =>
          record.sourceDefinitionId === ATTACK_UNDER_DEF.cardNo ||
          record.sourceInstanceId === "under-attack-no-void"
      )
    ).toBe(false);
  });

  it("does not queue star_garment_under effects from the B-face card itself", () => {
    const state = makeState();
    const under = state.cardInstances.find((c) => c.instanceId === "under-1")!;

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "participant-1",
      actingPlayerId: ALICE,
      sourceCard: under,
      sourceDefinition: UNDER_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(queued.battleImmediateEffects).toHaveLength(0);
  });

  it("does not resolve a queued star_garment_under effect after the host turns face-down", () => {
    const state = makeState();
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const prompt = queued.battleImmediateEffects[0]!;
    const faceDownAfterQueue: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((card) =>
        card.instanceId === "host-1" ? { ...card, faceDown: true } : card
      ),
    };

    const result = useBattleImmediateEffectAsAction({
      state: faceDownAfterQueue,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(result.state.battleImmediateEffects).toHaveLength(0);
    expect(result.state.log).toContainEqual(
      expect.stringContaining("effect-source-not-star-garment-under")
    );
    expect(
      result.state.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("field");
  });

  it("does not resolve a queued star_garment_under effect after the provider leaves the slot", () => {
    const state = makeState();
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const prompt = queued.battleImmediateEffects[0]!;
    const staleAfterQueue: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((card) =>
        card.instanceId === "host-1"
          ? { ...card, underCards: [] }
          : card.instanceId === "under-1"
            ? { ...card, zone: "trash", attachedToInstanceId: null }
            : card
      ),
    };

    const result = useBattleImmediateEffectAsAction({
      state: staleAfterQueue,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(result.state.battleImmediateEffects).toHaveLength(0);
    expect(result.state.log).toContainEqual(
      expect.stringContaining("effect-source-not-star-garment-under")
    );
    expect(
      result.state.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("field");
  });

  it("does not queue star_garment_under effects from a non-spirit host", () => {
    const ultimateHost = createCardInstance(ULTIMATE_HOST_DEF, {
      instanceId: "ultimate-host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    ultimateHost.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(UNDER_DEF, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "ultimate-host-1";
    under.zoneRoleName = "star-garment";

    const queued = queueRegisteredBattleImmediateEffects({
      state: createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [ultimateHost, under],
      }),
      attackId: "attack-1",
      participantEntityId: "participant-1",
      actingPlayerId: ALICE,
      sourceCard: ultimateHost,
      sourceDefinition: ULTIMATE_HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(queued.battleImmediateEffects).toHaveLength(0);
  });

  it("does not aggregate ordinary B-face battle-immediate effects from under-cards", () => {
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "ordinary-under-1",
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    const ordinaryUnder = createCardInstance(ORDINARY_UNDER_DEF, {
      instanceId: "ordinary-under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    ordinaryUnder.attachedToInstanceId = "host-1";
    ordinaryUnder.zoneRoleName = "star-garment";

    const queued = queueRegisteredBattleImmediateEffects({
      state: createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, ordinaryUnder],
      }),
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(queued.battleImmediateEffects).toHaveLength(0);
  });

  it("keeps duplicate under-card definitions as distinct prompts", () => {
    const state = makeState();
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const secondUnder = createCardInstance(UNDER_DEF, {
      instanceId: "under-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    secondUnder.attachedToInstanceId = "host-1";
    secondUnder.zoneRoleName = "star-garment";
    host.underCards.push({
      cardInstanceId: "under-2",
      role: "text_role",
      roleTag: "星霊衣",
    });

    const queued = queueRegisteredBattleImmediateEffects({
      state: {
        ...state,
        cardInstances: [...state.cardInstances, secondUnder],
      },
      attackId: "attack-1",
      participantEntityId: "participant-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });

    expect(queued.battleImmediateEffects).toHaveLength(2);
    expect(
      new Set(queued.battleImmediateEffects.map((p) => p.promptId)).size
    ).toBe(2);
    expect(
      queued.battleImmediateEffects.map((p) => p.sourceEffectInstanceId).sort()
    ).toEqual(["under-1", "under-2"]);
  });

  it("production legal-action path resolves real BSFT01-TR08(B) under-card bounce", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    const realHostDef = getProdDef("BSFT01-CX01")!;
    const realUnderDef = getProdDef("BSFT01-TR08(B)")!;

    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const target = createCardInstance(realHostDef, {
      instanceId: "target-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = withActiveBlockBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under, target],
      })
    );

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "block",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });

    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(declaration).toBeDefined();
    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      sourceEffectDefinitionId: "BSFT01-TR08(B)",
    });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    expect(declared.window).toBe("stack");
    expect(declared.stackWindow?.pendingStackAction).toMatchObject({
      actionKind: "battle_immediate_effect",
      cardInstanceId: "host-1",
      cardDefinitionId: "BSFT01-CX01",
      effectSourceDefinitionId: "BSFT01-TR08(B)",
      effectSourceInstanceId: "under-1",
    });
    expect(
      declared.stackWindow?.pendingStackAction?.effectSourceDefinitionId
    ).toBe("BSFT01-TR08(B)");
    expect(
      declared.stackWindow?.pendingStackAction?.effectSourceInstanceId
    ).toBe("under-1");

    const afterPass = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    expect(afterPass.pendingEffectTargetSelection).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      effectSourceDefinitionId: "BSFT01-TR08(B)",
      effectSourceInstanceId: "under-1",
      deferredStack: {
        cardInstanceId: "host-1",
        cardDefinitionId: "BSFT01-CX01",
        effectSourceDefinitionId: "BSFT01-TR08(B)",
        effectSourceInstanceId: "under-1",
      },
    });
    expect(
      afterPass.pendingEffectTargetSelection?.effectSourceDefinitionId
    ).toBe("BSFT01-TR08(B)");
    expect(afterPass.pendingEffectTargetSelection?.effectSourceInstanceId).toBe(
      "under-1"
    );
    expect(
      afterPass.pendingEffectTargetSelection?.deferredStack
        .effectSourceDefinitionId
    ).toBe("BSFT01-TR08(B)");
    expect(
      afterPass.pendingEffectTargetSelection?.deferredStack
        .effectSourceInstanceId
    ).toBe("under-1");
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetSelection).toBeDefined();

    const resolved = applyLegalAction({
      state: afterPass,
      action: targetSelection!,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("hand");
  });

  it("production target selection for BSFT01-TR09(B) exhaust excludes already exhausted targets", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    const realHostDef = getProdDef("BSFT01-CX01")!;
    const realUnderDef = getProdDef("BSFT01-TR09(B)")!;

    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const recoveredTarget1 = createCardInstance(realHostDef, {
      instanceId: "target-recovered-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const recoveredTarget2 = createCardInstance(realHostDef, {
      instanceId: "target-recovered-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const exhaustedTarget = createCardInstance(realHostDef, {
      instanceId: "target-exhausted",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state = withActiveBlockBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          host,
          under,
          recoveredTarget1,
          recoveredTarget2,
          exhaustedTarget,
        ],
      })
    );
    const hostBaseBp = getEffectiveBp(state, host, realHostDef, getProdDef);

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "block",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect")!;
    const declared = applyLegalAction({
      state: queued,
      action: declaration,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    const afterPass = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");

    expect(targetSelection).toBeDefined();
    expect(targetSelection?.candidateTargetInstanceIds).toEqual([
      "target-recovered-1",
      "target-recovered-2",
    ]);

    const resolved = applyLegalAction({
      state: afterPass,
      action: targetSelection!,
      targetInstanceIds: ["target-recovered-1", "target-recovered-2"],
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    const cardById = new Map(
      resolved.cardInstances.map((card) => [card.instanceId, card])
    );
    expect(cardById.get("target-recovered-1")?.exhaustState).toBe("exhausted");
    expect(cardById.get("target-recovered-2")?.exhaustState).toBe("exhausted");
    expect(cardById.get("target-exhausted")?.exhaustState).toBe("exhausted");
    expect(resolved.pendingEffectTargetSelection).toBeNull();
    expect(
      getEffectiveBp(resolved, cardById.get("host-1")!, realHostDef, getProdDef)
    ).toBe(hostBaseBp + 5000);
  });

  it("production BSFT01-TR10(B) star_garment attack effect prevents count/2 selected blockers", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    const realHostDef = getProdDef("BSFT01-CX01")!;
    const realUnderDef = getProdDef("BSFT01-TR10(B)")!;

    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";

    const blockers = ["blocker-1", "blocker-2", "blocker-3"].map((instanceId) =>
      createCardInstance(realHostDef, {
        instanceId,
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state = withActiveAttackBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ countValue: 5 }, {}],
        cardInstances: [host, under, ...blockers],
      })
    );

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "attack",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      sourceEffectDefinitionId: "BSFT01-TR10(B)",
    });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    const afterPass = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    expect(afterPass.pendingEffectTargetSelection).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      effectSourceDefinitionId: "BSFT01-TR10(B)",
      effectSourceInstanceId: "under-1",
      requiredTargetCount: 2,
      maxTargetCount: 2,
    });
    expect(
      afterPass.pendingEffectTargetSelection?.candidateInstanceIds
    ).toEqual(["blocker-1", "blocker-2", "blocker-3"]);

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetSelection).toBeDefined();

    const resolved = applyLegalAction({
      state: afterPass,
      action: targetSelection!,
      targetInstanceIds: ["blocker-1", "blocker-2"],
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    const blockState: GameState = { ...resolved, window: "declare_block" };
    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: BOB,
        sourceInstanceId: "blocker-1",
        participantEntityId: "battle-entity:host-1",
        getCardDefinitionById: getProdDef,
      })
    ).toBe("source_not_ready");
    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: BOB,
        sourceInstanceId: "blocker-2",
        participantEntityId: "battle-entity:host-1",
        getCardDefinitionById: getProdDef,
      })
    ).toBe("source_not_ready");
    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: BOB,
        sourceInstanceId: "blocker-3",
        participantEntityId: "battle-entity:host-1",
        getCardDefinitionById: getProdDef,
      })
    ).toBeNull();
  });

  it("production BSFT01-TR04(B) star_garment attack effect boosts host before BP-threshold destroy", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const makeTargetDef = (cardNo: string, bp: number): CardDefinition => ({
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp }],
      textLines: [],
      images: {},
      colors: ["red"],
    });
    prodDefs.set("SG-BAIT-1000", makeTargetDef("SG-BAIT-1000", 1000));
    prodDefs.set("SG-LOW-8000", makeTargetDef("SG-LOW-8000", 8000));
    prodDefs.set("SG-HIGH-9000", makeTargetDef("SG-HIGH-9000", 9000));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    const realHostDef = getProdDef("BSFT01-CX01")!;
    const realUnderDef = getProdDef("BSFT01-TR04(B)")!;

    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const bait1000 = createCardInstance(getProdDef("SG-BAIT-1000")!, {
      instanceId: "target-bait-1000",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const low8000 = createCardInstance(getProdDef("SG-LOW-8000")!, {
      instanceId: "target-low-8000",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const high9000 = createCardInstance(getProdDef("SG-HIGH-9000")!, {
      instanceId: "target-high-9000",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = withActiveAttackBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under, bait1000, low8000, high9000],
      })
    );
    const bobLifeBefore = state.players.find(
      (player) => player.id === BOB
    )!.lifeNormalCoreCount;

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "attack",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      sourceEffectDefinitionId: "BSFT01-TR04(B)",
    });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    const pendingTargetState = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    expect(
      getEffectiveBp(
        pendingTargetState,
        pendingTargetState.cardInstances.find(
          (card) => card.instanceId === "host-1"
        )!,
        realHostDef,
        getProdDef
      )
    ).toBe(8000);
    const targetPending = pendingTargetState.pendingStepOptionalTargetSelection;
    expect(targetPending).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-TR04(B)",
      targetStepId: "destroy_by_bp",
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(targetPending?.candidateInstanceIds.sort()).toEqual(
      ["target-bait-1000", "target-low-8000"].sort()
    );

    const resolved = applyLegalAction({
      state: pendingTargetState,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${targetPending!.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: targetPending!.actingPlayerId,
        pendingId: targetPending!.pendingId,
        sourceInstanceId: targetPending!.sourceInstanceId,
        sourceDefinitionId: targetPending!.sourceDefinitionId,
        effectIndex: targetPending!.effectIndex,
        stepIndex: targetPending!.stepIndex,
        requiredTargetCount: targetPending!.requiredTargetCount,
        maxTargetCount: targetPending!.maxTargetCount,
        candidateTargetInstanceIds: targetPending!.candidateInstanceIds,
      },
      targetInstanceIds: ["target-low-8000"],
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();

    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "target-bait-1000"
      )?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "target-low-8000"
      )?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "target-high-9000"
      )?.zone
    ).toBe("field");
    expect(
      resolved.players.find((player) => player.id === BOB)!.lifeNormalCoreCount
    ).toBe(bobLifeBefore - 1);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "host-1" &&
          ce.targetInstanceId === "host-1" &&
          ce.modifierTag === "symbol_addition" &&
          ce.provenance?.effectSourceDefinitionId === "BSFT01-TR04(B)"
      )
    ).toBe(true);
  });

  it("production BSFT01-TR01(B) star_garment attack effect sends opponents up to host cost total and then places a core", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const makeTargetDef = (
      cardNo: string,
      cost: number,
      printedCategory: CardDefinition["printedCategory"] = "spirit"
    ): CardDefinition => ({
      cardNo,
      name: cardNo,
      printedCategory,
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: cost,
      cost,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    });
    prodDefs.set("SG-COST-1", makeTargetDef("SG-COST-1", 1));
    prodDefs.set("SG-COST-2", makeTargetDef("SG-COST-2", 2));
    prodDefs.set("SG-COST-3", makeTargetDef("SG-COST-3", 3));
    prodDefs.set("SG-BRAVE-1", makeTargetDef("SG-BRAVE-1", 1, "brave"));
    prodDefs.set(
      "SG-IMAGIN-RIGHT-BRAVE-2",
      makeTargetDef("SG-IMAGIN-RIGHT-BRAVE-2", 2, "brave")
    );
    prodDefs.set("SG-NONBRAVE-5", makeTargetDef("SG-NONBRAVE-5", 5));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    // Keep this aggregation fixture legal with both left and right braves.
    // The production star-garment effect is unchanged; the host has a synthetic
    // unrestricted two-brave permission solely for this cost-consumer test.
    const realHostDef = {
      ...getProdDef("BSFT01-CX01")!,
      maxCombinedBraves: { count: 2 },
    };
    prodDefs.set(realHostDef.cardNo, realHostDef);
    const realUnderDef = getProdDef("BSFT01-TR01(B)")!;

    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    host.attachedChildrenIds = ["brave-1", "nonbrave-1"];
    const under = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const target1 = createCardInstance(getProdDef("SG-COST-1")!, {
      instanceId: "target-cost-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const target2 = createCardInstance(getProdDef("SG-COST-2")!, {
      instanceId: "target-cost-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const target3 = createCardInstance(getProdDef("SG-COST-3")!, {
      instanceId: "target-cost-3",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(getProdDef("SG-BRAVE-1")!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    brave.attachedToInstanceId = "host-1";
    const rightBrave = createCardInstance(
      getProdDef("SG-IMAGIN-RIGHT-BRAVE-2")!,
      {
        instanceId: "right-brave-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      }
    );
    rightBrave.imaginRightCombinedWith = "host-1";
    const nonBrave = createCardInstance(getProdDef("SG-NONBRAVE-5")!, {
      instanceId: "nonbrave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    nonBrave.attachedToInstanceId = "host-1";
    const state = withActiveAttackBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ voidNormalCoreCount: 20 }, {}],
        cardInstances: [
          host,
          under,
          brave,
          rightBrave,
          nonBrave,
          target1,
          target2,
          target3,
        ],
      })
    );

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "attack",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      sourceEffectDefinitionId: "BSFT01-TR01(B)",
    });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    const pendingTargetState = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    const targetPending = pendingTargetState.pendingStepOptionalTargetSelection;
    expect(targetPending).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-TR01(B)",
      targetStepId: "send_cost_budget",
      requiredTargetCount: 0,
      maxTargetCount: 3,
      costBudgetAmount: 5,
    });

    expect(() =>
      applyLegalAction({
        state: pendingTargetState,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${targetPending!.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: targetPending!.actingPlayerId,
          pendingId: targetPending!.pendingId,
          sourceInstanceId: targetPending!.sourceInstanceId,
          sourceDefinitionId: targetPending!.sourceDefinitionId,
          effectIndex: targetPending!.effectIndex,
          stepIndex: targetPending!.stepIndex,
          requiredTargetCount: targetPending!.requiredTargetCount,
          maxTargetCount: targetPending!.maxTargetCount,
          candidateTargetInstanceIds: targetPending!.candidateInstanceIds,
        },
        targetInstanceIds: ["target-cost-1", "target-cost-2", "target-cost-3"],
        getCardDefinitionById: getProdDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
        getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      })
    ).toThrow(/cost total 6 exceeds budget 5/);

    const resolved = applyLegalAction({
      state: pendingTargetState,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${targetPending!.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: targetPending!.actingPlayerId,
        pendingId: targetPending!.pendingId,
        sourceInstanceId: targetPending!.sourceInstanceId,
        sourceDefinitionId: targetPending!.sourceDefinitionId,
        effectIndex: targetPending!.effectIndex,
        stepIndex: targetPending!.stepIndex,
        requiredTargetCount: targetPending!.requiredTargetCount,
        maxTargetCount: targetPending!.maxTargetCount,
        candidateTargetInstanceIds: targetPending!.candidateInstanceIds,
      },
      targetInstanceIds: ["target-cost-2", "target-cost-3"],
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "target-cost-1")
        ?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "target-cost-2")
        ?.zone
    ).toBe("deck");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "target-cost-3")
        ?.zone
    ).toBe("deck");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "host-1")!
        .normalCoreCount
    ).toBe(2);
  });

  it("production BSFT01-TR01(B) no_duplicate is scoped to the attack event, not each prompt", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    const realHostDef = getProdDef("BSFT01-CX01")!;
    const realUnderDef = getProdDef("BSFT01-TR01(B)")!;
    prodDefs.set("SG-DUP-TARGET", {
      ...realHostDef,
      cardNo: "SG-DUP-TARGET",
      name: "SG-DUP-TARGET",
      cost: 1,
      printedCost: 1,
    });
    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
      { cardInstanceId: "under-2", role: "text_role", roleTag: "星霊衣" },
    ];
    const under1 = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under1.attachedToInstanceId = "host-1";
    under1.zoneRoleName = "star-garment";
    const under2 = createCardInstance(realUnderDef, {
      instanceId: "under-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under2.attachedToInstanceId = "host-1";
    under2.zoneRoleName = "star-garment";
    const target = createCardInstance(getProdDef("SG-DUP-TARGET")!, {
      instanceId: "target-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = withActiveAttackBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under1, under2, target],
      })
    );

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "attack",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });
    const firstAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(firstAction).toBeDefined();
    const declared = applyLegalAction({
      state: queued,
      action: firstAction!,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    // 必須誘発でも別個体の同じ効果を残すスキップを提示する。
    const mandatoryQueued: GameState = {
      ...queued,
      battleImmediateEffects: queued.battleImmediateEffects.map((prompt) => ({
        ...prompt,
        executionMode: "mandatory",
      })),
    };
    const mandatoryActions = getLegalActions({
      state: mandatoryQueued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR01(B)" &&
        !action.skipOnly
    );
    expect(mandatoryActions).toHaveLength(2);
    expect(mandatoryActions.every((action) => action.canSkipDuplicate)).toBe(
      true
    );
    const skipped = applyLegalAction({
      state: mandatoryQueued,
      action: mandatoryActions[0]!,
      skipOptionalEffect: true,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    expect(skipped.effectUsageRecords).toHaveLength(0);
    const remaining = getLegalActions({
      state: skipped,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR01(B)" &&
        !action.skipOnly
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toHaveProperty("canSkipDuplicate");

    const sameAttackActions = getLegalActions({
      state: {
        ...declared,
        activeStack: null,
        pendingEffectTargetSelection: null,
      },
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR01(B)"
    );
    expect(sameAttackActions).toHaveLength(0);

    expect(
      canUseEffectByUsageLimit({
        state: declared,
        sourceInstanceId: "under-2",
        sourceDefinitionId: "BSFT01-TR01(B)",
        effectLabel: "effect:0",
        usageLimit: { kind: "no_duplicate" },
        triggerEventScopeKey:
          "battle_immediate:attack-1:attack:BSFT01-TR01(B):0",
      })
    ).toBe(false);
    expect(
      canUseEffectByUsageLimit({
        state: declared,
        sourceInstanceId: "under-1",
        sourceDefinitionId: "BSFT01-TR01(B)",
        effectLabel: "effect:0",
        usageLimit: { kind: "no_duplicate" },
        triggerEventScopeKey:
          "battle_immediate:attack-2:attack:BSFT01-TR01(B):0",
      })
    ).toBe(true);
  });

  it("production deferred battle-immediate fizzles before target selection when the provider leaves the slot", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const realHostDef = getProdDef("BSFT01-CX01")!;
    const realUnderDef = getProdDef("BSFT01-TR08(B)")!;
    const prodBattleLookup = buildBattleImmediateEffectLookup(expanded);
    const host = createCardInstance(realHostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(realUnderDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const target = createCardInstance(realHostDef, {
      instanceId: "target-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = withActiveBlockBattle(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under, target],
      })
    );

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: realHostDef,
      timing: "block",
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect")!;

    const declared = applyLegalAction({
      state: queued,
      action: declaration,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;
    const staleBeforeWindowClose: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((card) =>
        card.instanceId === "host-1"
          ? { ...card, underCards: [] }
          : card.instanceId === "under-1"
            ? { ...card, zone: "trash", attachedToInstanceId: null }
            : card
      ),
    };
    const afterPass = applyLegalAction({
      state: staleBeforeWindowClose,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: prodBattleLookup,
    }).state;

    expect(afterPass.pendingEffectTargetSelection).toBeNull();
    expect(afterPass.log).toContainEqual(
      expect.stringContaining("effect-source-not-star-garment-under")
    );
    expect(
      afterPass.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("field");
  });

  it("P3-76 targeted responders see the provider as source and continuation resumes the under-card effect", () => {
    const state = makeState();
    const responder = createCardInstance(TARGETED_RESPONDER_DEF, {
      instanceId: "responder-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const queued = queueRegisteredBattleImmediateEffects({
      state: {
        ...state,
        cardInstances: [...state.cardInstances, responder],
      },
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect")!;

    const declared = applyLegalAction({
      state: queued,
      action: declaration,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    }).state;
    const afterPass = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target")!;

    const disclosed = applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    }).state;

    expect(disclosed.pendingTriggeredEffects).toHaveLength(1);
    expect(disclosed.pendingTriggeredEffects[0]).toMatchObject({
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: "BSFT01-TR08(B)",
    });
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: disclosed,
        pendingEffect: disclosed.pendingTriggeredEffects[0]!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: getTriggeredRegs,
      }).map((choice) => choice.sourceCard.instanceId)
    ).toEqual(["responder-1"]);
    expect(disclosed.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-TR08(B)",
      targetInstanceIds: ["target-1"],
      targetStepId: "__step_0",
    });
    expect(
      disclosed.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("field");

    let resumed = disclosed;
    for (let safety = 0; safety < 8; safety++) {
      const action = [BOB, ALICE]
        .flatMap((actingPlayerId) =>
          getLegalActions({
            state: resumed,
            actingPlayerId,
            getCardDefinitionById: getDef,
            getRegisteredTriggeredEffectActions: getTriggeredRegs,
            getRegisteredBurstActions: () => [],
            getRegisteredBattleImmediateEffectActions: getBattleRegs,
            getRegisteredFieldCardEffectActions: noFieldEffectLookup,
          })
        )
        .find(
          (candidate) =>
            candidate.kind === "resolve_pending_triggered_effect" ||
            candidate.kind === "pass_stack"
        );
      if (!action) break;
      resumed = applyLegalAction({
        state: resumed,
        action,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: getTriggeredRegs,
        getRegisteredBurstActions: () => [],
        getRegisteredBattleImmediateEffectActions: getBattleRegs,
        getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      }).state;
      if (resumed.pendingTargetedDisclosureContinuation === null) break;
    }

    expect(resumed.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      resumed.cardInstances.find((card) => card.instanceId === "target-1")?.zone
    ).toBe("hand");
  });

  it("direct battle-immediate resolution keeps P3-76 source as provider and resumes under-card text", () => {
    const state = makeState();
    const responder = createCardInstance(TARGETED_RESPONDER_DEF, {
      instanceId: "responder-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const queued = queueRegisteredBattleImmediateEffects({
      state: {
        ...state,
        cardInstances: [...state.cardInstances, responder],
      },
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const prompt = queued.battleImmediateEffects[0]!;

    const disclosed = useBattleImmediateEffectAsAction({
      state: queued,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    }).state;

    expect(disclosed.pendingTriggeredEffects).toHaveLength(1);
    expect(disclosed.pendingTriggeredEffects[0]).toMatchObject({
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: "BSFT01-TR08(B)",
    });
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: disclosed,
        pendingEffect: disclosed.pendingTriggeredEffects[0]!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: getTriggeredRegs,
      }).map((choice) => choice.sourceCard.instanceId)
    ).toEqual(["responder-1"]);
    expect(disclosed.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-TR08(B)",
      targetInstanceIds: ["target-1"],
    });
    expect(
      disclosed.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("field");
  });

  it("redirect continuation resumes the under-card text while pending source identity stays provider", () => {
    const state = makeState();
    const token = createCardInstance(TOKEN_DEF, {
      instanceId: "token-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const queued = queueRegisteredBattleImmediateEffects({
      state: {
        ...state,
        cardInstances: [...state.cardInstances, token],
        activeContinuousEffects: [
          ...(state.activeContinuousEffects ?? []),
          redirectTargetCe(),
        ],
      },
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: HOST_DEF,
      timing: "block",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    });
    const prompt = queued.battleImmediateEffects[0]!;

    const redirected = useBattleImmediateEffectAsAction({
      state: queued,
      actingPlayerId: ALICE,
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      targetInstanceIds: ["target-1"],
      targetEffectFilterTags: ["general"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    }).state;

    expect(redirected.pendingTargetRedirects).toHaveLength(1);
    const pending = redirected.pendingTargetRedirects[0]!;
    expect(pending).toMatchObject({
      sourceEffectInstanceId: "under-1",
      sourceEffectDefinitionId: "BSFT01-TR08(B)",
      redirectableInstanceId: "target-1",
    });
    expect(pending.continuation).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-TR08(B)",
      targetInstanceIds: ["target-1"],
    });

    const confirm = getLegalActions({
      state: redirected,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "confirm_target_redirect");
    expect(confirm).toBeDefined();

    const confirmed = applyLegalAction({
      state: redirected,
      action: confirm!,
      redirectTargetReplacementInstanceId: "token-1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: getTriggeredRegs,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: getBattleRegs,
    }).state;

    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("field");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "token-1")
        ?.zone
    ).toBe("hand");
  });

  it("keeps exhaust candidate filtering when targetGroups override the registration", () => {
    const baseState = makeState();
    const exhaustedTarget = createCardInstance(TARGET_DEF, {
      instanceId: "target-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [...baseState.cardInstances, exhaustedTarget],
    };
    const registration = {
      requiredTargetCount: 1,
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilter: { category: ["spirit"] },
      targetGroups: [
        {
          requiredTargetCount: 1,
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: { category: ["spirit"] },
          targetCardFilterActionKind: "exhaust",
          targetExhaustState: "exhausted",
        },
      ],
    } satisfies RegisteredTargetedEffectActionBase;

    const groups = buildLegalActionTargetGroups({
      state,
      actingPlayerId: ALICE,
      actionRegistration: registration,
      getCardDefinitionById: getDef,
      sourceInstanceId: "host-1",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.candidateTargetInstanceIds).toEqual(["target-1"]);
  });

  it("production BSFT01-TR05(B) keeps only the opponent destroyed by battle, recovers host, and adds guide symbol", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodTriggeredLookup = buildTriggeredEffectLookup(expanded);
    const hostDef = getProdDef("BSFT01-CX01")!;
    const underDef = getProdDef("BSFT01-TR05(B)")!;
    expect(underDef.cardNo).toBe("BSFT01-TR05(B)");
    expect(underDef.effects?.[0]?.steps?.[2]?.deferTo).toBe("battle_end");

    const blockerDef: CardDefinition = {
      cardNo: "BSFT01-TR05(B)-TEST-BLOCKER",
      name: "TR05 battle blocker",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    };
    prodDefs.set(blockerDef.cardNo, blockerDef);

    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const blocker = createCardInstance(blockerDef, {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });

    const battleState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under, blocker],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-tr05",
        primaryEntityId: "battle-entity:host-1",
        participantEntityIds: ["battle-entity:host-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:host-1",
            blockedByEntityIds: ["battle-entity:blocker-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:host-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:host-1",
          memberInstanceIds: ["host-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["guide"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:blocker-1",
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
    };

    let current = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: prodTriggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(current.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "host-1",
        relatedInstanceIds: ["blocker-1"],
      })
    );
    expect(
      current.cardInstances.find((card) => card.instanceId === "blocker-1")
    ).toMatchObject({
      zone: "field",
      pendingLeaveKind: "destroy",
      deferZoneMoveUntilChainEnd: true,
      exhaustState: "exhausted",
    });
    expect(
      current.cardInstances.find((card) => card.instanceId === "host-1")
    ).toMatchObject({
      zone: "field",
      pendingLeaveKind: null,
      deferZoneMoveUntilChainEnd: false,
    });

    for (let safety = 0; safety < 8; safety++) {
      const action = [ALICE, BOB]
        .flatMap((actingPlayerId) =>
          getLegalActions({
            state: current,
            actingPlayerId,
            getCardDefinitionById: getProdDef,
            getRegisteredTriggeredEffectActions: prodTriggeredLookup,
            getRegisteredBurstActions: () => [],
            getRegisteredFieldCardEffectActions: noFieldEffectLookup,
          })
        )
        .find(
          (candidate) =>
            candidate.kind === "resolve_pending_triggered_effect" ||
            candidate.kind === "pass_stack"
        );
      if (!action) break;
      current = applyLegalAction({
        state: current,
        action,
        getCardDefinitionById: getProdDef,
        getRegisteredTriggeredEffectActions: prodTriggeredLookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      }).state;
      if (
        current.pendingTriggeredEffects.length === 0 &&
        current.activeStack === null
      ) {
        break;
      }
    }

    expect(
      current.cardInstances.find((card) => card.instanceId === "blocker-1")
    ).toMatchObject({
      zone: "field",
      pendingLeaveKind: null,
      exhaustState: "exhausted",
    });
    expect(
      current.cardInstances.find((card) => card.instanceId === "host-1")
    ).toMatchObject({ zone: "field", exhaustState: "recovered" });
    const symbolGrant = current.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "host-1" &&
        ce.provenance?.effectSourceDefinitionId === "BSFT01-TR05(B)"
    );
    expect(symbolGrant).toBeDefined();
    expect(symbolGrant?.createdAtAttackId).toBe("attack-tr05");
    expect(
      removeExpiredContinuousEffects(current, {
        kind: "battle_end",
        attackId: "attack-tr05-next",
      }).some((ce) => ce.effectId === symbolGrant?.effectId)
    ).toBe(false);
  });

  it("production BSFT01-TR05(B) decline flushes the battle-destroyed opponent instead of stranding it", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodTriggeredLookup = buildTriggeredEffectLookup(expanded);
    const hostDef = getProdDef("BSFT01-CX01")!;
    const underDef = getProdDef("BSFT01-TR05(B)")!;
    const blockerDef: CardDefinition = {
      cardNo: "BSFT01-TR05(B)-DECLINE-BLOCKER",
      name: "TR05 decline blocker",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    };
    prodDefs.set(blockerDef.cardNo, blockerDef);

    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const blocker = createCardInstance(blockerDef, {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });

    const battleState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under, blocker],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-tr05-decline",
        primaryEntityId: "battle-entity:host-1",
        participantEntityIds: ["battle-entity:host-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:host-1",
            blockedByEntityIds: ["battle-entity:blocker-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:host-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:host-1",
          memberInstanceIds: ["host-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["guide"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:blocker-1",
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
    };

    let current = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: prodTriggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    const triggerAction = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: prodTriggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.executionMode === "optional" &&
        action.skipOnly !== true
    );
    expect(triggerAction).toBeDefined();

    current = applyLegalAction({
      state: current,
      action: triggerAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: prodTriggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).state;

    expect(current.pendingTriggeredEffects).toHaveLength(0);
    expect(current.pendingLeaveEntities).toHaveLength(0);
    expect(
      current.cardInstances.find((card) => card.instanceId === "blocker-1")
    ).toMatchObject({
      zone: "trash",
      pendingLeaveKind: null,
      deferZoneMoveUntilChainEnd: false,
    });
    expect(
      current.cardInstances.find((card) => card.instanceId === "host-1")
    ).toMatchObject({
      zone: "field",
      exhaustState: "exhausted",
      deferZoneMoveUntilChainEnd: false,
    });
  });

  it("production BSFT01-TR05(B) queues the battle-destroy trigger for the defending winner", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodTriggeredLookup = buildTriggeredEffectLookup(expanded);
    const attackerDef: CardDefinition = {
      cardNo: "BSFT01-TR05(B)-TEST-ATTACKER",
      name: "TR05 battle attacker",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    };
    prodDefs.set(attackerDef.cardNo, attackerDef);
    const hostDef = getProdDef("BSFT01-CX01")!;
    const underDef = getProdDef("BSFT01-TR05(B)")!;

    const attacker = createCardInstance(attackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";

    const battleState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker, host, under],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-tr05-defender",
        primaryEntityId: "battle-entity:attacker-1",
        participantEntityIds: ["battle-entity:attacker-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:attacker-1",
            blockedByEntityIds: ["battle-entity:host-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:attacker-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:attacker-1",
          memberInstanceIds: ["attacker-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:host-1",
          memberInstanceIds: ["host-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["guide"],
          attackState: "blocking",
        },
      ],
    };

    const current = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: prodTriggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(current.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        actingPlayerId: BOB,
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "host-1",
        relatedInstanceIds: ["attacker-1"],
      })
    );
    expect(
      getLegalActions({
        state: current,
        actingPlayerId: ALICE,
        getCardDefinitionById: getProdDef,
        getRegisteredTriggeredEffectActions: prodTriggeredLookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      }).some((action) => action.kind === "resolve_pending_triggered_effect")
    ).toBe(false);
    expect(
      getLegalActions({
        state: current,
        actingPlayerId: BOB,
        getCardDefinitionById: getProdDef,
        getRegisteredTriggeredEffectActions: prodTriggeredLookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      }).some((action) => action.kind === "resolve_pending_triggered_effect")
    ).toBe(true);
  });

  it("production BSFT01-TR05(B) triggers on equal BP when only the opponent is actually battle-destroyed", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const prodDefs = new Map(expanded.map((def) => [def.cardNo, def]));
    const getProdDef = (id: string): CardDefinition | undefined =>
      prodDefs.get(id);
    const prodTriggeredLookup = buildTriggeredEffectLookup(expanded);
    const hostDef = getProdDef("BSFT01-CX01")!;
    const underDef = getProdDef("BSFT01-TR05(B)")!;
    const blockerDef: CardDefinition = {
      cardNo: "BSFT01-TR05(B)-EQUAL-BLOCKER",
      name: "TR05 equal blocker",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    };
    prodDefs.set(blockerDef.cardNo, blockerDef);

    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "host-1";
    under.zoneRoleName = "star-garment";
    const blocker = createCardInstance(blockerDef, {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });

    const battleState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under, blocker],
      }),
      activeContinuousEffects: [bpCompareDestroyImmunityCE("host-1", ALICE)],
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-tr05-equal",
        primaryEntityId: "battle-entity:host-1",
        participantEntityIds: ["battle-entity:host-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:host-1",
            blockedByEntityIds: ["battle-entity:blocker-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:host-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:host-1",
          memberInstanceIds: ["host-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["guide"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:blocker-1",
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
    };

    const current = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getProdDef,
      getRegisteredTriggeredEffectActions: prodTriggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(
      current.pendingLeaveEntities.some(
        (pending) =>
          pending.instanceId === "host-1" &&
          pending.blockedByResistance !== true
      )
    ).toBe(false);
    expect(current.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "blocker-1",
        kind: "destroy",
        cause: "battle",
      })
    );
    expect(current.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        actingPlayerId: ALICE,
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "host-1",
        relatedInstanceIds: ["blocker-1"],
      })
    );
  });

  it("battle_destroy_opponent_only is generated for normal card_event listeners, not only star garments", () => {
    const winnerDef: CardDefinition = {
      cardNo: "BSFT01-TR05(B)-GENERIC-WINNER",
      name: "generic battle winner",
      printedCategory: "spirit",
      printedColors: ["blue"],
      symbolColors: ["guide"],
      printedCost: 4,
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      textLines: ["BSFT01-TR05(B) regression generic listener"],
      images: {},
      colors: ["blue"],
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "battle_destroy_opponent_only",
          },
          steps: [
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 1,
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const loserDef: CardDefinition = {
      cardNo: "BSFT01-TR05(B)-GENERIC-LOSER",
      name: "generic battle loser",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    };
    const defs = new Map([winnerDef, loserDef].map((def) => [def.cardNo, def]));
    const getDef = (id: string): CardDefinition | undefined => defs.get(id);
    const triggeredLookup = buildTriggeredEffectLookup([winnerDef, loserDef]);

    const winner = createCardInstance(winnerDef, {
      instanceId: "winner-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const loser = createCardInstance(loserDef, {
      instanceId: "loser-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });

    const battleState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [winner, loser],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-generic-battle-destroy",
        primaryEntityId: "battle-entity:winner-1",
        participantEntityIds: ["battle-entity:winner-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:winner-1",
            blockedByEntityIds: ["battle-entity:loser-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:winner-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:winner-1",
          memberInstanceIds: ["winner-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["guide"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:loser-1",
          memberInstanceIds: ["loser-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
    };

    const current = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(current.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        actingPlayerId: ALICE,
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "winner-1",
        relatedInstanceIds: ["loser-1"],
      })
    );

    const action = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_triggered_effect"
    );
    expect(action).toBeDefined();
  });
});
