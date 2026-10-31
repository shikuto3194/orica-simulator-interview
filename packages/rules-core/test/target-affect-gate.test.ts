import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  applyLegalAction,
  executeBpModify,
  executeDestroy,
  executeEffect,
  executeEffectResistance,
  executeExhaust,
  findApplicableTargetRedirects,
  getLegalActions,
} from "../src";
import { executeSelectedBorrowedCardEventEffect } from "../src/effect/effect-borrowing";
import { resolveAffectSourceIdentity } from "../src/effect/effect-source-identity";
import { canSourceBypassResistanceCE } from "../src/effect/effect-resistance-check";
import { executeOverrideProperties } from "../src/effect/native-ce-registration-handlers";
import { canExecuteOptionalStep } from "../src/effect/native-effect-front-helpers";
import {
  resolveTargetCandidateIds,
  resolveTargets,
} from "../src/effect/native-target-resolution";
import { convertCoreLocation } from "../src/effect/native-action-shared";
import type { CoreLocation } from "../src/dsl-types";
import {
  getBpModifierTotal,
  getCandidateTargetInstanceIds,
  getEffectiveTribes,
  getTargetAcquisitionGatesForCard,
  executeReevaluationCheck,
} from "../src/legal/legal-actions-shared";
import type { Action } from "../src/dsl-types";
import type { RegisteredTargetedEffectActionBase } from "../src/legal/legal-actions-types";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
  ActiveStack,
} from "../src/model";
import { createStepExecutionContext } from "../src/step-execution-context";
import {
  allowAffect,
  allowCardAffect,
  blockAffect,
  blockCardAffect,
  canBypassTargetLock,
  cardTargetRef,
  mergeTargetLockBypassProfiles,
  normalizePreventionProfile,
  resolveTargetAcquisition,
  type EffectSourceContext,
  type PreventionProfile,
  type TargetAcquireContext,
  type TargetRef,
} from "../src/effect/target-affect-gate";
import {
  derivePreventionLevel,
  derivePreventionProfile,
} from "../src/legal/legal-actions-shared";

const CARD: TargetRef = { kind: "card", instanceId: "target-1" };
const ALICE = "alice";
const BOB = "bob";

const TEST_SPIRIT: CardDefinition = {
  cardNo: "P3-105-SPIRIT",
  name: "P3-105 Spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "A",
} as CardDefinition;

const TEST_GRANDWALKER: CardDefinition = {
  cardNo: "P3-105-GRANDWALKER",
  name: "P3-105 Grandwalker",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 4,
  reductionSymbols: ["yellow"],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "A",
  grandwalkerData: { kind: "grandwalker" },
} as CardDefinition;

const TEST_GRANDSTONE: CardDefinition = {
  cardNo: "P3-105-GRANDSTONE",
  name: "P3-105 Grandstone",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 4,
  reductionSymbols: ["yellow"],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "A",
  grandstoneData: { kind: "grandstone" },
} as CardDefinition;

const TEST_BRAVE: CardDefinition = {
  cardNo: "P3-105-BRAVE",
  name: "P3-105 Brave",
  printedCategory: "brave",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "鍵",
  sourceUrls: [],
  sourceConfidence: "A",
  braveCondition: { categories: ["spirit"] },
} as CardDefinition;

const TEST_MAGIC: CardDefinition = {
  cardNo: "P3-105-MAGIC",
  name: "P3-105 Magic",
  printedCategory: "magic",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "A",
} as CardDefinition;

const BORROW_DONOR_SPIRIT: CardDefinition = {
  ...TEST_SPIRIT,
  cardNo: "P3-105-BORROW-DONOR",
  name: "P3-105 Borrow Donor",
  textLines: ["Lv1『このスピリットの召喚時』"],
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      textRef: [0],
      steps: [{ action: { kind: "noop" } }],
    },
  ],
} as CardDefinition;

const BORROW_DESTROY_DONOR_SPIRIT: CardDefinition = {
  ...TEST_SPIRIT,
  cardNo: "P3-105-BORROW-DESTROY-DONOR",
  name: "P3-105 Borrow Destroy Donor",
  textLines: [
    "Lv1『このスピリットの召喚時』",
    "相手のスピリット1体を破壊する。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      textRef: [0, 1],
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    },
  ],
} as CardDefinition;

const BORROW_SOURCE_CARD_DESTROY_DONOR_SPIRIT: CardDefinition = {
  ...TEST_SPIRIT,
  cardNo: "P3-155-BORROW-SOURCE-CARD-DESTROY-DONOR",
  name: "P3-155 Borrow Source Card Destroy Donor",
  textLines: ["Lv1『このスピリットの召喚時』", "このスピリットを破壊する。"],
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      textRef: [0, 1],
      steps: [
        {
          action: {
            kind: "destroy",
            target: { kind: "source_card" },
          },
        },
      ],
    },
  ],
} as CardDefinition;

function getCardDef(id: string): CardDefinition | undefined {
  switch (id) {
    case TEST_SPIRIT.cardNo:
      return TEST_SPIRIT;
    case TEST_GRANDWALKER.cardNo:
      return TEST_GRANDWALKER;
    case TEST_GRANDSTONE.cardNo:
      return TEST_GRANDSTONE;
    case TEST_BRAVE.cardNo:
      return TEST_BRAVE;
    case TEST_MAGIC.cardNo:
      return TEST_MAGIC;
    case BORROW_DONOR_SPIRIT.cardNo:
      return BORROW_DONOR_SPIRIT;
    case BORROW_DESTROY_DONOR_SPIRIT.cardNo:
      return BORROW_DESTROY_DONOR_SPIRIT;
    case BORROW_SOURCE_CARD_DESTROY_DONOR_SPIRIT.cardNo:
      return BORROW_SOURCE_CARD_DESTROY_DONOR_SPIRIT;
    default:
      return undefined;
  }
}

function fieldSpirit(
  instanceId: string,
  controllerPlayerId: string
): CardInstance {
  return fieldCard(TEST_SPIRIT, instanceId, controllerPlayerId);
}

function fieldCard(
  def: CardDefinition,
  instanceId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

function makeState(cards: readonly CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [...cards],
  };
}

function summonTriggeredStack(card: CardInstance): ActiveStack {
  return {
    stackId: `stack:summon:${card.instanceId}`,
    actionKind: "triggered_effect",
    chainId: `trigger:summon:${card.instanceId}`,
    actingPlayerId: card.controllerPlayerId,
    cardInstanceId: card.instanceId,
    cardDefinitionId: card.definitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    triggeredRegistrationIndex: 0,
    triggeredSourceCardNo: card.definitionId,
    triggeredSourceKind: "spirit",
    suppressionEffectDescriptor: {
      sourceDefinitionId: card.definitionId,
      sourceKind: "spirit",
      effectIndex: 0,
      timingKind: "card_event",
      eventAction: "summon",
    },
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

function registerResistance(
  state: GameState,
  resistType: "cannot_be_targeted" | "cannot_be_exhausted"
): GameState {
  return executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: false, player: "self", count: 1 },
      resistType,
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    "alice-source",
    getCardDef
  );
}

function defenseImmuneFromNexusCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `test-defense_immune-${targetInstanceId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

function cannotBeDestroyedFromNexusCE(
  targetInstanceId: string
): ContinuousEffect {
  return {
    effectId: `test-cannot_be_destroyed-${targetInstanceId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

function defenseImmuneFromBraveSourceScopeCE(
  targetInstanceId: string
): ContinuousEffect {
  return {
    effectId: `test-defense_immune-brave-source-${targetInstanceId}`,
    sourceInstanceId: "immunity-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
    immunitySourceScope: { categories: ["brave"] },
  };
}

function preventHandDiscardFromNexusCE(playerId: string): ContinuousEffect {
  return {
    effectId: `test-prevent_hand_discard-${playerId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "prevent_hand_discard" as ContinuousEffectTag,
    targetInstanceId: playerId,
  };
}

function preventDeckDiscardFromNexusCE(playerId: string): ContinuousEffect {
  return {
    effectId: `test-prevent_deck_discard-${playerId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "prevent_deck_discard" as ContinuousEffectTag,
    targetInstanceId: playerId,
  };
}

function restrictCorePlacementLifeFromNexusCE(
  playerId: string
): ContinuousEffect {
  return {
    effectId: `test-restrict_core_placement_life-${playerId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "restrict_core_placement_life" as ContinuousEffectTag,
    targetInstanceId: playerId,
  };
}

function restrictCorePlacementVoidFromNexusCE(
  playerId: string
): ContinuousEffect {
  return {
    effectId: `test-restrict_core_placement_void-${playerId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "restrict_core_placement_void" as ContinuousEffectTag,
    targetInstanceId: playerId,
  };
}

function effectSuppressionFromNexusCE(
  targetInstanceId: string
): ContinuousEffect {
  return {
    effectId: `test-effect_suppression-${targetInstanceId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "effect_suppression" as ContinuousEffectTag,
    targetInstanceId,
  };
}

function cannotIncludeFromNexusCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `test-cannot_include-${targetInstanceId}`,
    sourceInstanceId: "nexus-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "cannot_include" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

function currentEffectDefenseImmuneCE(
  targetInstanceId: string,
  sourceInstanceId: string
): ContinuousEffect {
  return {
    effectId: `test-current-effect-defense_immune-${targetInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId: TEST_SPIRIT.cardNo,
    actingPlayerId: BOB,
    duration: { scope: "current_effect" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune" as ContinuousEffectTag,
    targetInstanceId,
    metadata: {
      source: "opponent_effect",
      currentEffectSourceInstanceId: sourceInstanceId,
      currentEffectSourceDefinitionId: TEST_SPIRIT.cardNo,
      currentEffectIndex: 0,
      currentEffectTargetStepId: "cores",
    },
  };
}

function effectSourcePreventionImmunityForTribes(
  playerId: string,
  tribes: readonly string[]
): ContinuousEffect {
  return {
    effectId: `test-effect_source_prevention_immunity-${playerId}`,
    sourceInstanceId: "prevention-grant-source",
    sourceDefinitionId: TEST_GRANDWALKER.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "effect_source_prevention_immunity",
    targetInstanceId: playerId,
    metadata: { tribes },
  };
}

function redirectEffectTargetCE(
  protectedInstanceId: string,
  candidateInstanceId: string
): ContinuousEffect {
  return {
    effectId: `test-redirect_effect_target-${protectedInstanceId}`,
    sourceInstanceId: protectedInstanceId,
    sourceDefinitionId: TEST_SPIRIT.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    targetInstanceId: protectedInstanceId,
    metadata: {
      triggerCondition: {
        sourcePlayerRef: "opponent",
        protectedTargetKind: "self",
      },
      redirectCandidateSource: {
        kind: "explicit",
        instanceIds: [candidateInstanceId],
      },
      optional: true,
    },
  };
}

function ctx(prevention: PreventionProfile): TargetAcquireContext {
  const source: EffectSourceContext = {
    actingPlayerId: "alice",
    prevention,
    cause: "effect",
  };
  return {
    source,
    targetClass: "card_or_zone",
    selectorIntent: "explicit_target",
  };
}

describe("P3-105 prevention profile", () => {
  it("既存 derivePreventionLevel は targetLockBypass を見ない", () => {
    const level = derivePreventionLevel({
      targetLockBypass: { kind: "all_effects" },
    });
    expect(level).toBeUndefined();
  });

  it("通常の unpreventable は resistance だけを立て、target lock は貫通しない", () => {
    const profile = derivePreventionProfile({
      preventionLevel: "unpreventable",
    });
    expect(profile).toEqual({
      resistance: "unpreventable",
      targetLockBypass: { kind: "none" },
    });
  });

  it("targetLockBypass は profile では unpreventable resistance を暗黙に持つ", () => {
    const profile = derivePreventionProfile({
      targetLockBypass: { kind: "all_effects" },
    });
    expect(profile).toEqual({
      resistance: "unpreventable",
      targetLockBypass: { kind: "all_effects" },
    });
  });

  it("preventionRestriction only* は許可スコープ以外を貫通する bypass に畳む", () => {
    const profile = derivePreventionProfile({
      preventionRestriction: { onlyPreventableByTribes: ["蓬莱"] },
    });
    expect(profile).toEqual({
      resistance: "none",
      targetLockBypass: {
        kind: "preventing_effect_filter",
        filter: { tribes: ["蓬莱"], bypassUnlessMatches: true },
      },
    });
    expect(
      canBypassTargetLock(profile!, {
        categories: ["spirit"],
        tribes: ["蓬莱", "幻想"],
      })
    ).toBe(false);
    expect(
      canBypassTargetLock(profile!, {
        categories: ["spirit"],
        tribes: ["起幻"],
      })
    ).toBe(true);
  });

  it("notPreventableByTribes は一致する防止CEだけを貫通し blanket unpreventable にはしない", () => {
    expect(
      derivePreventionLevel({
        preventionRestriction: { notPreventableByTribes: ["蓬莱"] },
      })
    ).toBeUndefined();
    const profile = derivePreventionProfile({
      preventionRestriction: { notPreventableByTribes: ["蓬莱"] },
    });
    expect(profile).toEqual({
      resistance: "none",
      targetLockBypass: {
        kind: "preventing_effect_filter",
        filter: { tribes: ["蓬莱"] },
      },
    });
  });
});

describe("P3-105 target acquisition gate", () => {
  it("通常の unpreventable では cannot_be_targeted を貫通しない", () => {
    const profile = normalizePreventionProfile({
      resistance: "unpreventable",
    });
    const decision = resolveTargetAcquisition(ctx(profile), CARD, [
      { reason: "cannot_be_targeted", byEffectId: "ce-lock" },
    ]);
    expect(decision).toEqual({
      kind: "excluded",
      target: CARD,
      reason: "cannot_be_targeted",
      byEffectId: "ce-lock",
    });
  });

  it("all_effects targetLockBypass は cannot_include を貫通する", () => {
    const profile = normalizePreventionProfile({
      resistance: "unpreventable",
      targetLockBypass: { kind: "all_effects" },
    });
    const decision = resolveTargetAcquisition(ctx(profile), CARD, [
      { reason: "cannot_include", byEffectId: "ce-lock" },
    ]);
    expect(decision).toEqual({ kind: "candidate", target: CARD });
  });

  it("filter 付き targetLockBypass は防ぐ側の効果源が一致するときだけ貫通する", () => {
    const profile = normalizePreventionProfile({
      resistance: "unpreventable",
      targetLockBypass: {
        kind: "preventing_effect_filter",
        filter: { tribes: ["蓬莱"] },
      },
    });
    expect(
      canBypassTargetLock(profile, {
        categories: ["spirit"],
        tribes: ["蓬莱", "幻想"],
      })
    ).toBe(true);
    expect(
      canBypassTargetLock(profile, {
        categories: ["spirit"],
        tribes: ["起幻"],
      })
    ).toBe(false);
  });

  it("targetLockBypass profile は filter 条件を OR merge する", () => {
    expect(
      mergeTargetLockBypassProfiles(
        { kind: "preventing_effect_filter", filter: { tribes: ["蓬莱"] } },
        { kind: "preventing_effect_filter", filter: { tribes: ["幻想"] } }
      )
    ).toEqual({
      kind: "any_preventing_effect_filter",
      filters: [{ tribes: ["蓬莱"] }, { tribes: ["幻想"] }],
    });
    expect(
      mergeTargetLockBypassProfiles(
        { kind: "all_effects" },
        { kind: "preventing_effect_filter", filter: { tribes: ["幻想"] } }
      )
    ).toEqual({ kind: "all_effects" });
    expect(mergeTargetLockBypassProfiles({ kind: "none" }, undefined)).toBe(
      undefined
    );
  });

  it("target lock bypass は effect_immunity gate までは貫通しない", () => {
    const profile = normalizePreventionProfile({
      resistance: "unpreventable",
      targetLockBypass: { kind: "all_effects" },
    });
    const decision = resolveTargetAcquisition(ctx(profile), CARD, [
      { reason: "effect_immunity", byEffectId: "ce-immune" },
    ]);
    expect(decision).toEqual({
      kind: "excluded",
      target: CARD,
      reason: "effect_immunity",
      byEffectId: "ce-immune",
    });
  });
});

describe("P3-105 optional step prevention bypass", () => {
  it("optional step feasibility passes sourcePreventionBypass into target resolution", () => {
    const target = fieldSpirit("target-1", ALICE);
    const source = fieldSpirit("source-1", BOB);
    const state = {
      ...makeState([target, source]),
      activeContinuousEffects: [defenseImmuneFromNexusCE(target.instanceId)],
    };
    const baseArgs = {
      action: {
        kind: "exhaust" as const,
        target: {
          kind: "filter" as const,
          player: "opponent" as const,
          filter: { category: ["spirit" as const] },
          count: 1,
        },
      },
      state,
      actingPlayerId: BOB,
      sourceInstanceId: source.instanceId,
      getCardDefinitionById: getCardDef,
      stepCtx: createStepExecutionContext(state),
      sourceDefinition: TEST_SPIRIT,
    };

    expect(canExecuteOptionalStep(baseArgs)).toBe(false);
    expect(
      canExecuteOptionalStep({
        ...baseArgs,
        sourcePreventionBypass: {
          kind: "preventing_effect_filter",
          filter: { categories: ["nexus"] },
        },
      })
    ).toBe(true);
    expect(
      canExecuteOptionalStep({
        ...baseArgs,
        sourcePreventionBypass: {
          kind: "preventing_effect_filter",
          filter: { categories: ["ultimate"] },
        },
      })
    ).toBe(false);
  });

  it("targeted disclosure candidate rebuild keeps affect gate separate from candidates", () => {
    const source = fieldSpirit("source-1", ALICE);
    const target = fieldSpirit("target-1", BOB);
    const state = {
      ...makeState([source, target]),
      activeContinuousEffects: [defenseImmuneFromNexusCE(target.instanceId)],
    };
    const action: Action = {
      kind: "destroy",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
    };

    expect(
      resolveTargetCandidateIds(
        action,
        state,
        ALICE,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        TEST_SPIRIT,
        "none",
        { kind: "none" }
      )
    ).toEqual([target.instanceId]);

    expect(
      resolveTargetCandidateIds(
        action,
        state,
        ALICE,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        TEST_SPIRIT,
        "none",
        { kind: "none" },
        { kind: "preventing_effect_filter", filter: { categories: ["nexus"] } }
      )
    ).toEqual([target.instanceId]);
  });

  it("field_card core_move passes source effect metadata to immunity gate", () => {
    const source = fieldSpirit("source-1", BOB);
    const target = fieldSpirit("target-1", ALICE);
    const state = {
      ...makeState([source, target]),
      activeContinuousEffects: [
        currentEffectDefenseImmuneCE(target.instanceId, source.instanceId),
      ],
    };
    const action: Action = {
      kind: "core_move",
      from: {
        kind: "field_card",
        player: "opponent",
        filter: { category: ["spirit"] },
      },
      to: { kind: "reserve", player: "self" },
      amount: 1,
    };

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        undefined,
        TEST_SPIRIT,
        "none",
        { kind: "none" },
        undefined,
        undefined,
        0,
        "cores"
      )
    ).toEqual([]);

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        undefined,
        TEST_SPIRIT,
        "none",
        { kind: "none" },
        undefined,
        undefined,
        1,
        "cores"
      )
    ).toEqual([target.instanceId]);

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        [target.instanceId],
        TEST_SPIRIT,
        "none",
        { kind: "none" },
        undefined,
        undefined,
        0,
        "cores"
      )
    ).toEqual([]);

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        [target.instanceId],
        TEST_SPIRIT,
        "none",
        { kind: "none" },
        undefined,
        undefined,
        1,
        "cores"
      )
    ).toEqual([target.instanceId]);
  });

  it.each([
    [["second"], "second", 0, true],
    [["second"], "cores", 0, false],
    [["second"], "second", 1, false],
    [[], "cores", 0, false],
    [["second", 7], "second", 0, false],
  ] as const)(
    "grouped current-effect binding %j / %s / %s",
    (ids, stepId, effectIndex, blocked) => {
      const source = fieldSpirit("source-1", BOB);
      const target = fieldSpirit("target-1", ALICE);
      const ce = currentEffectDefenseImmuneCE(
        target.instanceId,
        source.instanceId
      );
      const state = {
        ...makeState([source, target]),
        activeContinuousEffects: [
          {
            ...ce,
            metadata: { ...ce.metadata, currentEffectTargetStepIds: ids },
          },
        ],
      };
      const action: Action = {
        kind: "core_move",
        from: {
          kind: "field_card",
          player: "opponent",
          filter: { category: ["spirit"] },
        },
        to: { kind: "reserve", player: "self" },
        amount: 1,
      };
      expect(
        resolveTargets(
          action,
          state,
          BOB,
          source.instanceId,
          getCardDef,
          createStepExecutionContext(state),
          [target.instanceId],
          TEST_SPIRIT,
          "none",
          { kind: "none" },
          undefined,
          undefined,
          effectIndex,
          stepId
        )
      ).toEqual(blocked ? [] : [target.instanceId]);
    }
  );

  it("field_card core_move immunity gate uses under-card effect source identity", () => {
    const host = fieldSpirit("host-1", BOB);
    host.underCards = [
      { cardInstanceId: "under-brave-1", role: "text_role", roleTag: "星霊衣" },
    ];
    const underBrave = fieldCard(TEST_BRAVE, "under-brave-1", BOB);
    underBrave.attachedToInstanceId = host.instanceId;
    const target = fieldSpirit("target-1", ALICE);
    const state = {
      ...makeState([host, underBrave, target]),
      activeContinuousEffects: [
        defenseImmuneFromBraveSourceScopeCE(target.instanceId),
      ],
    };
    const effect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "core_move" as const,
            from: {
              kind: "field_card" as const,
              player: "opponent" as const,
              filter: { category: ["spirit" as const] },
            },
            to: { kind: "this_card" as const },
            amount: 1,
          },
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:target-affect-gate:912",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: underBrave.instanceId,
      effectSourceDefinitionId: TEST_BRAVE.cardNo,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)
        ?.normalCoreCount
    ).toBe(1);
  });

  it("field_card core_move immunity gate treats combined brave text as host source identity", () => {
    const host = fieldSpirit("host-1", BOB);
    const brave = fieldCard(TEST_BRAVE, "brave-1", BOB);
    const target = fieldSpirit("target-1", ALICE);
    const combinedHost = {
      ...host,
      attachedChildrenIds: [brave.instanceId],
    };
    const combinedBrave = {
      ...brave,
      attachedToInstanceId: host.instanceId,
    };
    const state = {
      ...makeState([combinedHost, combinedBrave, target]),
      activeContinuousEffects: [
        defenseImmuneFromBraveSourceScopeCE(target.instanceId),
      ],
    };
    const action: Action = {
      kind: "core_move",
      from: {
        kind: "field_card",
        player: "opponent",
        filter: { category: ["spirit"] },
      },
      to: { kind: "this_card" },
      amount: 1,
    };

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        combinedHost.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        undefined,
        TEST_SPIRIT,
        "none",
        { kind: "none" },
        undefined,
        undefined,
        0,
        "cores",
        undefined,
        combinedBrave.instanceId,
        TEST_BRAVE
      )
    ).toEqual([target.instanceId]);

    const after = executeEffect({
      chainId: "test:target-affect-gate:983",
      state,
      effect: {
        timing: { kind: "activated" as const, mode: "flash" as const },
        steps: [{ action }],
      },
      sourceInstanceId: combinedHost.instanceId,
      effectSourceInstanceId: combinedBrave.instanceId,
      effectSourceDefinitionId: TEST_BRAVE.cardNo,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === combinedHost.instanceId
      )?.normalCoreCount
    ).toBe(2);
  });

  it("CE prevention identity keeps text-role provider but folds combined brave to host", () => {
    const target = fieldSpirit("target-1", ALICE);
    const host = fieldSpirit("host-1", BOB);
    const underBrave = {
      ...fieldCard(TEST_BRAVE, "under-brave-1", BOB),
      attachedToInstanceId: host.instanceId,
    };
    const textRoleHost = {
      ...host,
      underCards: [
        {
          cardInstanceId: underBrave.instanceId,
          role: "text_role" as const,
          roleTag: "星霊衣",
        },
      ],
    };
    const textRoleState = makeState([textRoleHost, underBrave, target]);
    const underCe: ContinuousEffect = {
      effectId: "under-defense",
      sourceInstanceId: textRoleHost.instanceId,
      sourceDefinitionId: TEST_SPIRIT.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: target.instanceId,
      metadata: { source: "opponent_effect" },
      provenance: {
        effectIndex: 0,
        stepIndex: 0,
        effectSourceInstanceId: underBrave.instanceId,
        effectSourceDefinitionId: TEST_BRAVE.cardNo,
      },
    };

    expect(
      canSourceBypassResistanceCE(textRoleState, underCe, getCardDef, "none", {
        kind: "preventing_effect_filter",
        filter: { categories: ["brave"] },
      })
    ).toBe(true);

    const combinedHost = {
      ...host,
      instanceId: "combined-host-1",
      attachedChildrenIds: ["combined-brave-1"],
    };
    const combinedBrave = {
      ...fieldCard(TEST_BRAVE, "combined-brave-1", BOB),
      attachedToInstanceId: combinedHost.instanceId,
    };
    const combinedState = makeState([combinedHost, combinedBrave, target]);
    const combinedCe: ContinuousEffect = {
      ...underCe,
      effectId: "combined-defense",
      sourceInstanceId: combinedHost.instanceId,
      provenance: {
        effectIndex: 0,
        stepIndex: 0,
        effectSourceInstanceId: combinedBrave.instanceId,
        effectSourceDefinitionId: TEST_BRAVE.cardNo,
      },
    };

    expect(
      canSourceBypassResistanceCE(
        combinedState,
        combinedCe,
        getCardDef,
        "none",
        {
          kind: "preventing_effect_filter",
          filter: { categories: ["brave"] },
        }
      )
    ).toBe(false);
    expect(
      canSourceBypassResistanceCE(
        combinedState,
        combinedCe,
        getCardDef,
        "none",
        {
          kind: "preventing_effect_filter",
          filter: { categories: ["spirit"] },
        }
      )
    ).toBe(true);
  });

  it("target-lock prevention identity keeps text-role provider but folds combined brave to host", () => {
    const target = fieldSpirit("target-1", ALICE);
    const host = fieldSpirit("host-1", BOB);
    const underBrave = {
      ...fieldCard(TEST_BRAVE, "under-brave-1", BOB),
      attachedToInstanceId: host.instanceId,
    };
    const textRoleHost = {
      ...host,
      underCards: [
        {
          cardInstanceId: underBrave.instanceId,
          role: "text_role" as const,
          roleTag: "星霊衣",
        },
      ],
    };
    const underLockCe: ContinuousEffect = {
      effectId: "under-lock",
      sourceInstanceId: textRoleHost.instanceId,
      sourceDefinitionId: TEST_SPIRIT.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: "cannot_be_targeted",
      targetInstanceId: target.instanceId,
      metadata: { source: "opponent_effect" },
      provenance: {
        effectIndex: 0,
        stepIndex: 0,
        effectSourceInstanceId: underBrave.instanceId,
        effectSourceDefinitionId: TEST_BRAVE.cardNo,
      },
    };
    const textRoleState = {
      ...makeState([textRoleHost, underBrave, target]),
      activeContinuousEffects: [underLockCe],
    };
    const targetRef = cardTargetRef(target);
    const ctx = (
      categories: Array<"brave" | "spirit">
    ): TargetAcquireContext => ({
      source: {
        actingPlayerId: BOB,
        sourceInstanceId: "bob-effect",
        prevention: normalizePreventionProfile({
          targetLockBypass: {
            kind: "preventing_effect_filter",
            filter: { categories },
          },
        }),
        cause: "effect",
      },
      targetClass: "card_or_zone",
      selectorIntent: "explicit_target",
    });

    expect(
      resolveTargetAcquisition(
        ctx(["brave"]),
        targetRef,
        getTargetAcquisitionGatesForCard(textRoleState, target, getCardDef)
      ).kind
    ).toBe("candidate");

    const combinedHost = {
      ...host,
      instanceId: "combined-host-1",
      attachedChildrenIds: ["combined-brave-1"],
    };
    const combinedBrave = {
      ...fieldCard(TEST_BRAVE, "combined-brave-1", BOB),
      attachedToInstanceId: combinedHost.instanceId,
    };
    const combinedLockCe: ContinuousEffect = {
      ...underLockCe,
      effectId: "combined-lock",
      sourceInstanceId: combinedHost.instanceId,
      provenance: {
        effectIndex: 0,
        stepIndex: 0,
        effectSourceInstanceId: combinedBrave.instanceId,
        effectSourceDefinitionId: TEST_BRAVE.cardNo,
      },
    };
    const combinedState = {
      ...makeState([combinedHost, combinedBrave, target]),
      activeContinuousEffects: [combinedLockCe],
    };

    expect(
      resolveTargetAcquisition(
        ctx(["brave"]),
        targetRef,
        getTargetAcquisitionGatesForCard(combinedState, target, getCardDef)
      ).kind
    ).toBe("excluded");
    expect(
      resolveTargetAcquisition(
        ctx(["spirit"]),
        targetRef,
        getTargetAcquisitionGatesForCard(combinedState, target, getCardDef)
      ).kind
    ).toBe("candidate");
  });

  it("legal target candidates fold combined brave affect identity to host", () => {
    const target = fieldSpirit("target-1", ALICE);
    const host = {
      ...fieldSpirit("host-1", BOB),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...fieldCard(TEST_BRAVE, "brave-1", BOB),
      attachedToInstanceId: host.instanceId,
    };
    const state = {
      ...makeState([host, brave, target]),
      activeContinuousEffects: [
        defenseImmuneFromBraveSourceScopeCE(target.instanceId),
      ],
    };
    const registration: RegisteredTargetedEffectActionBase = {
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilterActionKind: "destroy",
    };
    const affectSourceIdentity = resolveAffectSourceIdentity({
      state,
      sourceInstanceId: host.instanceId,
      sourceDefinition: TEST_SPIRIT,
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinition: TEST_BRAVE,
      getCardDefinitionById: getCardDef,
    });

    expect(
      getCandidateTargetInstanceIds(state, BOB, registration, {
        getCardDefinitionById: getCardDef,
        sourceInstanceId: host.instanceId,
        sourceDefinition: TEST_BRAVE,
        affectSourceIdentity,
      })
    ).toEqual([target.instanceId]);
  });

  it("legal target candidates evaluate immunity using the text-role provider identity", () => {
    const target = fieldSpirit("target-1", ALICE);
    const underBrave = {
      ...fieldCard(TEST_BRAVE, "under-brave-1", BOB),
      attachedToInstanceId: "host-1",
    };
    const host = {
      ...fieldSpirit("host-1", BOB),
      underCards: [
        {
          cardInstanceId: underBrave.instanceId,
          role: "text_role" as const,
          roleTag: "星霊衣",
        },
      ],
    };
    const state = {
      ...makeState([host, underBrave, target]),
      activeContinuousEffects: [
        defenseImmuneFromNexusCE(target.instanceId),
        effectSourcePreventionImmunityForTribes(BOB, ["紅魔"]),
      ],
    };
    const registration: RegisteredTargetedEffectActionBase = {
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilterActionKind: "destroy",
    };
    const affectSourceIdentity = resolveAffectSourceIdentity({
      state,
      sourceInstanceId: host.instanceId,
      sourceDefinition: TEST_SPIRIT,
      effectSourceInstanceId: underBrave.instanceId,
      effectSourceDefinition: TEST_BRAVE,
      getCardDefinitionById: getCardDef,
    });

    expect(
      getCandidateTargetInstanceIds(state, BOB, registration, {
        getCardDefinitionById: getCardDef,
        sourceInstanceId: host.instanceId,
        sourceDefinition: TEST_BRAVE,
        affectSourceIdentity,
      })
    ).toEqual([]);
  });

  it("redirect target candidates receive sourcePreventionBypass", () => {
    const source = fieldSpirit("source-1", BOB);
    const protectedCard = fieldSpirit("protected-1", ALICE);
    const candidate = fieldSpirit("candidate-1", ALICE);
    const state = {
      ...makeState([source, protectedCard, candidate]),
      activeContinuousEffects: [
        redirectEffectTargetCE(protectedCard.instanceId, candidate.instanceId),
        defenseImmuneFromNexusCE(candidate.instanceId),
      ],
    };

    expect(
      findApplicableTargetRedirects(
        state,
        [protectedCard.instanceId],
        BOB,
        "none",
        { instance: source, definition: TEST_SPIRIT },
        getCardDef
      )
    ).toEqual([]);

    expect(
      findApplicableTargetRedirects(
        state,
        [protectedCard.instanceId],
        BOB,
        "none",
        { instance: source, definition: TEST_SPIRIT },
        getCardDef,
        { kind: "preventing_effect_filter", filter: { categories: ["nexus"] } }
      )
    ).toMatchObject([
      {
        protectedInstanceId: protectedCard.instanceId,
        candidateTokenInstanceIds: [candidate.instanceId],
      },
    ]);
  });

  it("borrowed effect suppression receives sourcePreventionBypass", () => {
    const host = fieldSpirit("host-1", BOB);
    const donor = fieldCard(BORROW_DONOR_SPIRIT, "donor-1", ALICE);
    const state = {
      ...makeState([host, donor]),
      activeContinuousEffects: [defenseImmuneFromNexusCE(donor.instanceId)],
    };
    const effect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "borrow_card_event_effect" as const,
            target: {
              kind: "filter" as const,
              player: "opponent" as const,
              filter: { category: ["spirit" as const] },
              count: 1,
            },
            borrowEvents: ["summon" as const],
            suppressBorrowedEffect: true,
          },
        },
      ],
    };

    const blocked = executeEffect({
      chainId: "test:target-affect-gate:1360",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      targetInstanceIds: [donor.instanceId],
      targetSelectionResolved: true,
      pendingStackNegateCandidate: summonTriggeredStack(donor),
    });
    expect(
      blocked.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.targetInstanceId === donor.instanceId
      )
    ).toBe(false);

    const pierced = executeEffect({
      chainId: "test:target-affect-gate:1378",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      targetInstanceIds: [donor.instanceId],
      targetSelectionResolved: true,
      pendingStackNegateCandidate: summonTriggeredStack(donor),
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    });
    expect(pierced.pendingStackNegateRequests).toHaveLength(1);
    expect(
      pierced.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toBe(false);

    const unpreventable = executeEffect({
      chainId: "test:target-affect-gate:1399",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      targetInstanceIds: [donor.instanceId],
      targetSelectionResolved: true,
      pendingStackNegateCandidate: summonTriggeredStack(donor),
      sourcePreventionLevel: "unpreventable",
    });
    expect(unpreventable.pendingStackNegateRequests).toHaveLength(1);
  });

  it("borrowed summon suppression only steals the current response stack effect", () => {
    const host = fieldSpirit("host-1", BOB);
    const donor = fieldCard(BORROW_DONOR_SPIRIT, "donor-1", ALICE);
    const state = makeState([host, donor]);
    const effect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "borrow_card_event_effect" as const,
            target: {
              kind: "filter" as const,
              player: "opponent" as const,
              filter: { category: ["spirit" as const] },
              count: 1,
            },
            borrowEvents: ["summon" as const],
            suppressBorrowedEffect: true,
          },
        },
      ],
    };

    const withoutResponseStack = executeEffect({
      chainId: "test:target-affect-gate:1436",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      targetInstanceIds: [donor.instanceId],
      targetSelectionResolved: true,
    });

    expect(withoutResponseStack.pendingStackNegateRequests).toHaveLength(0);
    expect(withoutResponseStack.log).toContain(
      `borrow_card_event_effect:no_eligible_effect:${BORROW_DONOR_SPIRIT.cardNo}`
    );

    const withResponseStack = executeEffect({
      chainId: "test:target-affect-gate:1451",
      state,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      targetInstanceIds: [donor.instanceId],
      targetSelectionResolved: true,
      pendingStackNegateCandidate: summonTriggeredStack(donor),
    });

    expect(withResponseStack.pendingStackNegateRequests).toMatchObject([
      {
        sourceInstanceId: host.instanceId,
        negateTarget: "effect",
        targetController: "opponent",
        targetEffectFilter: {
          sourceDefinitionId: BORROW_DONOR_SPIRIT.cardNo,
          effectIndex: 0,
          timingKind: "card_event",
          eventAction: "summon",
        },
      },
    ]);
    expect(withResponseStack.log).toContain(
      `borrow_card_event_effect:suppress_pending_stack:stack:summon:${donor.instanceId}:${BORROW_DONOR_SPIRIT.cardNo}:0`
    );
    expect(withResponseStack.log).toContain(
      `borrow_card_event_effect:executed:${BORROW_DONOR_SPIRIT.cardNo}:0:as:${host.instanceId}`
    );
  });

  it("borrowed source_card references the host unless attribution is explicitly redirected", () => {
    const host = fieldSpirit("host-1", BOB);
    const donor = fieldCard(
      BORROW_SOURCE_CARD_DESTROY_DONOR_SPIRIT,
      "donor-1",
      ALICE
    );
    const state = makeState([host, donor]);

    const after = executeSelectedBorrowedCardEventEffect(
      state,
      "test:target-affect-gate:1492",
      BOB,
      host.instanceId,
      donor.instanceId,
      0,
      getCardDef,
      executeEffect,
      () => []
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)
        ?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.pendingLeaveKind
    ).toBeNull();
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${BORROW_SOURCE_CARD_DESTROY_DONOR_SPIRIT.cardNo}:0:as:${host.instanceId}`
    );

    const attributedHost = fieldSpirit("host-2", BOB);
    const attributedDonor = fieldCard(
      BORROW_SOURCE_CARD_DESTROY_DONOR_SPIRIT,
      "donor-2",
      ALICE
    );
    const attributed = executeSelectedBorrowedCardEventEffect(
      makeState([attributedHost, attributedDonor]),
      "test:target-affect-gate:1521",
      BOB,
      attributedHost.instanceId,
      attributedDonor.instanceId,
      0,
      getCardDef,
      executeEffect,
      () => [],
      undefined,
      undefined,
      undefined,
      false,
      "none",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(
      attributed.cardInstances.find(
        (card) => card.instanceId === attributedHost.instanceId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      attributed.cardInstances.find(
        (card) => card.instanceId === attributedDonor.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("borrowed effect body receives sourcePreventionLevel", () => {
    const host = fieldSpirit("host-1", BOB);
    const donor = fieldCard(BORROW_DESTROY_DONOR_SPIRIT, "donor-1", ALICE);
    const protectedCard = fieldSpirit("protected-1", ALICE);
    const state = {
      ...makeState([host, donor, protectedCard]),
      activeContinuousEffects: [
        cannotBeDestroyedFromNexusCE(protectedCard.instanceId),
      ],
    };

    const blocked = executeSelectedBorrowedCardEventEffect(
      state,
      "test:target-affect-gate:1565",
      BOB,
      host.instanceId,
      donor.instanceId,
      0,
      getCardDef,
      executeEffect,
      () => [],
      [protectedCard.instanceId]
    );
    expect(
      blocked.cardInstances.find(
        (card) => card.instanceId === protectedCard.instanceId
      )?.pendingLeaveKind
    ).toBeNull();

    const pierced = executeSelectedBorrowedCardEventEffect(
      state,
      "test:target-affect-gate:1582",
      BOB,
      host.instanceId,
      donor.instanceId,
      0,
      getCardDef,
      executeEffect,
      () => [],
      [protectedCard.instanceId],
      undefined,
      undefined,
      false,
      "unpreventable"
    );
    expect(
      pierced.cardInstances.find(
        (card) => card.instanceId === protectedCard.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("borrowed effect target pending restores sourcePreventionLevel", () => {
    const host = fieldSpirit("host-1", BOB);
    const donor = fieldCard(BORROW_DESTROY_DONOR_SPIRIT, "donor-1", ALICE);
    const protectedCard = fieldSpirit("protected-1", ALICE);
    const state = {
      ...makeState([host, donor, protectedCard]),
      activeContinuousEffects: [
        cannotBeDestroyedFromNexusCE(protectedCard.instanceId),
      ],
    };

    const pendingState = executeSelectedBorrowedCardEventEffect(
      state,
      "test:target-affect-gate:1615",
      BOB,
      host.instanceId,
      donor.instanceId,
      0,
      getCardDef,
      executeEffect,
      () => [],
      undefined,
      undefined,
      undefined,
      false,
      "unpreventable"
    );
    const pending = pendingState.pendingBorrowedEffectTargetSelection;
    expect(pending).toMatchObject({
      sourcePreventionLevel: "unpreventable",
      sourceInstanceId: host.instanceId,
      targetInstanceId: donor.instanceId,
      borrowedEffectIndex: 0,
    });

    const chooseTarget = getLegalActions({
      state: pendingState,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((action) => action.kind === "resolve_borrowed_effect_target");
    expect(chooseTarget).toBeDefined();

    const after = applyLegalAction({
      state: pendingState,
      action: chooseTarget!,
      targetInstanceIds: [protectedCard.instanceId],
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === protectedCard.instanceId
      )
    ).toMatchObject({ zone: "trash", pendingLeaveKind: null });
  });

  it("discard container gates receive sourcePreventionBypass", () => {
    const source = fieldSpirit("source-1", BOB);
    const handCard = createCardInstance(TEST_SPIRIT, {
      instanceId: "alice-hand-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = {
      ...makeState([source, handCard]),
      players: makeState([source, handCard]).players.map((player) =>
        player.id === ALICE ? { ...player, handCount: 1 } : player
      ),
      activeContinuousEffects: [preventHandDiscardFromNexusCE(ALICE)],
    };
    const effect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "discard" as const,
            player: "opponent" as const,
            fromZone: "hand" as const,
            count: 1,
          },
        },
      ],
    };

    const blocked = executeEffect({
      chainId: "test:target-affect-gate:1690",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      blocked.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("hand");
    expect(blocked.players.find((p) => p.id === ALICE)?.handCount).toBe(1);

    const pierced = executeEffect({
      chainId: "test:target-affect-gate:1703",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    });
    expect(
      pierced.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("trash");
    expect(pierced.players.find((p) => p.id === ALICE)?.handCount).toBe(0);
  });

  it("deck discard container gates receive sourcePreventionBypass", () => {
    const source = fieldSpirit("source-1", BOB);
    const deckCard = createCardInstance(TEST_SPIRIT, {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const base = makeState([source, deckCard]);
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === ALICE ? { ...player, deckCount: 1 } : player
      ),
      activeContinuousEffects: [preventDeckDiscardFromNexusCE(ALICE)],
    };
    const effect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "move_card" as const,
            from: { zone: "deck" as const, player: "opponent" as const },
            to: { zone: "trash" as const },
            count: 1,
            deckDiscard: true,
          },
        },
      ],
    };

    const blocked = executeEffect({
      chainId: "test:target-affect-gate:1752",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      blocked.cardInstances.find((c) => c.instanceId === deckCard.instanceId)
        ?.zone
    ).toBe("deck");
    expect(blocked.players.find((p) => p.id === ALICE)?.deckCount).toBe(1);

    const pierced = executeEffect({
      chainId: "test:target-affect-gate:1765",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    });
    expect(
      pierced.cardInstances.find((c) => c.instanceId === deckCard.instanceId)
        ?.zone
    ).toBe("trash");
    expect(pierced.players.find((p) => p.id === ALICE)?.deckCount).toBe(0);
  });

  it("discard deck mills receive sourcePreventionBypass", () => {
    const source = fieldSpirit("source-1", BOB);
    const deckCard = createCardInstance(TEST_SPIRIT, {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const base = makeState([source, deckCard]);
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === ALICE ? { ...player, deckCount: 1 } : player
      ),
      activeContinuousEffects: [preventDeckDiscardFromNexusCE(ALICE)],
    };
    const effect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "discard" as const,
            player: "opponent" as const,
            fromZone: "deck" as const,
            count: 1,
          },
        },
      ],
    };

    const blocked = executeEffect({
      chainId: "test:target-affect-gate:1813",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      blocked.cardInstances.find((c) => c.instanceId === deckCard.instanceId)
        ?.zone
    ).toBe("deck");
    expect(blocked.players.find((p) => p.id === ALICE)?.deckCount).toBe(1);

    const pierced = executeEffect({
      chainId: "test:target-affect-gate:1826",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    });
    expect(
      pierced.cardInstances.find((c) => c.instanceId === deckCard.instanceId)
        ?.zone
    ).toBe("trash");
    expect(pierced.players.find((p) => p.id === ALICE)?.deckCount).toBe(0);
  });

  it("core placement restriction gates receive sourcePreventionBypass", () => {
    const source = fieldSpirit("source-1", BOB);
    const base = makeState([source]);
    const lifeRestrictedState = {
      ...base,
      players: base.players.map((player) =>
        player.id === ALICE
          ? { ...player, voidNormalCoreCount: 2, lifeNormalCoreCount: 3 }
          : player
      ),
      activeContinuousEffects: [restrictCorePlacementLifeFromNexusCE(ALICE)],
    };
    const voidToLifeEffect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "core_move" as const,
            from: { kind: "void" as const, player: "opponent" as const },
            to: { kind: "life" as const, player: "opponent" as const },
            amount: 1,
          },
        },
      ],
    };

    const lifeBlocked = executeEffect({
      chainId: "test:target-affect-gate:1870",
      state: lifeRestrictedState,
      effect: voidToLifeEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      lifeBlocked.players.find((p) => p.id === ALICE)?.lifeNormalCoreCount
    ).toBe(3);
    expect(
      lifeBlocked.players.find((p) => p.id === ALICE)?.voidNormalCoreCount
    ).toBe(2);

    const lifePierced = executeEffect({
      chainId: "test:target-affect-gate:1884",
      state: lifeRestrictedState,
      effect: voidToLifeEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    });
    expect(
      lifePierced.players.find((p) => p.id === ALICE)?.lifeNormalCoreCount
    ).toBe(4);
    expect(
      lifePierced.players.find((p) => p.id === ALICE)?.voidNormalCoreCount
    ).toBe(1);

    const voidRestrictedState = {
      ...base,
      players: base.players.map((player) =>
        player.id === BOB
          ? { ...player, voidNormalCoreCount: 2, reserveNormalCoreCount: 0 }
          : player
      ),
      activeContinuousEffects: [restrictCorePlacementVoidFromNexusCE(BOB)],
    };
    const voidToReserveEffect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      steps: [
        {
          action: {
            kind: "core_move" as const,
            from: { kind: "void" as const, player: "self" as const },
            to: { kind: "reserve" as const, player: "self" as const },
            amount: 1,
          },
        },
      ],
    };

    const voidBlocked = executeEffect({
      chainId: "test:target-affect-gate:1925",
      state: voidRestrictedState,
      effect: voidToReserveEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      voidBlocked.players.find((p) => p.id === BOB)?.voidNormalCoreCount
    ).toBe(2);
    expect(
      voidBlocked.players.find((p) => p.id === BOB)?.reserveNormalCoreCount
    ).toBe(0);

    const voidPierced = executeEffect({
      chainId: "test:target-affect-gate:1939",
      state: voidRestrictedState,
      effect: voidToReserveEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      sourcePreventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    });
    expect(
      voidPierced.players.find((p) => p.id === BOB)?.voidNormalCoreCount
    ).toBe(1);
    expect(
      voidPierced.players.find((p) => p.id === BOB)?.reserveNormalCoreCount
    ).toBe(1);
  });

  it("effect_suppression reevaluation ignores matching sourcePreventionBypass CE", () => {
    const source = fieldSpirit("source-1", BOB);
    const state = {
      ...makeState([source]),
      activeContinuousEffects: [
        effectSuppressionFromNexusCE(source.instanceId),
      ],
    };

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        getCardDefinitionById: getCardDef,
      })
    ).toBe(false);

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        getCardDefinitionById: getCardDef,
        sourcePreventionLevel: "unpreventable",
      })
    ).toBe(true);

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        getCardDefinitionById: getCardDef,
        sourcePreventionLevel: "immune",
      })
    ).toBe(true);

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        getCardDefinitionById: getCardDef,
        sourcePreventionLevel: "suppress",
      })
    ).toBe(false);

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        getCardDefinitionById: getCardDef,
        sourcePreventionBypass: {
          kind: "preventing_effect_filter",
          filter: { categories: ["nexus"] },
        },
      })
    ).toBe(true);
  });
});

describe("P3-105 card affect adapter", () => {
  const card = { instanceId: "card-1" };

  it("CardInstance 互換オブジェクトを card TargetRef に変換する", () => {
    expect(cardTargetRef(card)).toEqual({
      kind: "card",
      instanceId: "card-1",
    });
  });

  it("card affect decision を TargetRef ベースで返す", () => {
    expect(allowCardAffect(card)).toEqual({
      kind: "allowed",
      effectiveTarget: { kind: "card", instanceId: "card-1" },
    });
    expect(blockCardAffect(card, "effect_resistance", "ce-1")).toEqual({
      kind: "blocked",
      target: { kind: "card", instanceId: "card-1" },
      reason: "effect_resistance",
      byEffectId: "ce-1",
    });
  });
});

describe("P3-105 affect target classes", () => {
  it("player target を AffectDecision に畳める", () => {
    expect(allowAffect({ kind: "player", playerId: "alice" })).toEqual({
      kind: "allowed",
      effectiveTarget: { kind: "player", playerId: "alice" },
    });
  });

  it("zone target を AffectDecision に畳める", () => {
    expect(
      blockAffect(
        { kind: "zone", playerId: "alice", zone: "hand" },
        "container_gate"
      )
    ).toEqual({
      kind: "blocked",
      target: { kind: "zone", playerId: "alice", zone: "hand" },
      reason: "container_gate",
    });
  });

  it("core_container target を AffectDecision に畳める", () => {
    expect(
      allowAffect({
        kind: "core_container",
        location: { kind: "reserve", playerId: "alice" },
      })
    ).toEqual({
      kind: "allowed",
      effectiveTarget: {
        kind: "core_container",
        location: { kind: "reserve", playerId: "alice" },
      },
    });
  });

  it("effect target を AffectDecision に畳める", () => {
    expect(
      blockAffect({ kind: "effect", stackId: "stack-1" }, "negated", "ce-1")
    ).toEqual({
      kind: "blocked",
      target: { kind: "effect", stackId: "stack-1" },
      reason: "negated",
      byEffectId: "ce-1",
    });
  });
});

describe("P3-105 executor migration", () => {
  it("resolveTargets は通常効果のpreSelected対象を player/filter で再検証する", () => {
    const source = fieldSpirit("bob-source", BOB);
    const friendlyTarget = fieldSpirit("bob-friendly", BOB);
    const state = makeState([source, friendlyTarget]);
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
      properties: { levelCostDelta: 2 },
      duration: { scope: "turn" },
    };

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        [friendlyTarget.instanceId],
        getCardDef(source.definitionId)
      )
    ).toEqual([]);
  });

  it("resolveTargets はredirect resume対象だけ元filter再検証をバイパスし、affect gateは維持する", () => {
    const source = fieldSpirit("bob-source", BOB);
    const redirectTarget = fieldCard(TEST_MAGIC, "redirect-magic", ALICE);
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
      properties: { levelCostDelta: 2 },
      duration: { scope: "turn" },
    };
    const resolve = (state: GameState, skipFilterRevalidation: boolean) =>
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        [redirectTarget.instanceId],
        getCardDef(source.definitionId),
        undefined,
        undefined,
        undefined,
        true,
        0,
        "lv-cost",
        undefined,
        undefined,
        undefined,
        skipFilterRevalidation
      );

    const state = makeState([redirectTarget, source]);

    expect(resolve(state, false)).toEqual([]);
    expect(resolve(state, true)).toEqual([redirectTarget.instanceId]);

    const lockedState = registerResistance(
      makeState([redirectTarget, source]),
      "cannot_be_targeted"
    );
    expect(resolve(lockedState, true)).toEqual([]);
  });

  it("resolveTargets は override_properties のpreSelected複数IDを選択順で target.count 制限する", () => {
    const source = fieldSpirit("bob-source", BOB);
    const target1 = fieldSpirit("target-1", ALICE);
    const target2 = fieldSpirit("target-2", ALICE);
    const state = makeState([source, target1, target2]);
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
      properties: { levelCostDelta: 2 },
      duration: { scope: "turn" },
    };

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        [target2.instanceId, target1.instanceId],
        getCardDef(source.definitionId)
      )
    ).toEqual([target2.instanceId]);
  });

  it("resolveTargets は Lvコスト変更以外の override_properties で pending leave 対象を拾わない", () => {
    const source = fieldSpirit("bob-source", BOB);
    const liveTarget = fieldSpirit("live-target", ALICE);
    const pendingTarget: CardInstance = {
      ...fieldSpirit("pending-target", ALICE),
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "pending-chain",
    };
    const state = makeState([source, pendingTarget, liveTarget]);
    const target = {
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit"] },
      count: "all",
    } as const;

    const addTribesAction: Action = {
      kind: "override_properties",
      target,
      properties: { addTribes: ["対象"] },
      duration: { scope: "turn" },
    };
    const levelCostAction: Action = {
      kind: "override_properties",
      target,
      properties: { levelCostDelta: 2 },
      duration: { scope: "turn" },
    };

    expect(
      resolveTargets(
        addTribesAction,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        undefined,
        getCardDef(source.definitionId)
      )
    ).toEqual([liveTarget.instanceId]);
    expect(
      resolveTargets(
        levelCostAction,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        undefined,
        getCardDef(source.definitionId)
      )
    ).toEqual([pendingTarget.instanceId, liveTarget.instanceId]);
  });

  it("override_properties executor は gate 後の空 resolvedTargetIds を raw 再解決しない", () => {
    const target = fieldSpirit("target-1", ALICE);
    const source = fieldSpirit("bob-source", BOB);
    const lockSource = fieldCard(TEST_GRANDWALKER, "alice-source", ALICE);
    const state = registerResistance(
      makeState([target, source, lockSource]),
      "cannot_be_targeted"
    );
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
      properties: { levelCostDelta: 2 },
      duration: { scope: "turn" },
    };

    expect(
      resolveTargets(
        action,
        state,
        BOB,
        source.instanceId,
        getCardDef,
        createStepExecutionContext(state),
        undefined,
        getCardDef(source.definitionId)
      )
    ).toEqual([]);

    const result = executeOverrideProperties(
      action,
      state,
      BOB,
      source.instanceId,
      getCardDef,
      { timing: { kind: "card_event", event: "attack" }, steps: [] },
      [],
      { effectIndex: 0, stepIndex: 0 }
    );

    expect(
      result.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "override_properties" &&
          ce.targetInstanceId === target.instanceId
      )
    ).toEqual([]);
  });

  it('redirect 済み count:"all" 継続 override_properties は resolved 対象への snapshot CE にする', () => {
    const source = fieldSpirit("bob-source", BOB);
    const redirectedTarget = fieldCard(TEST_BRAVE, "redirect-brave", ALICE);
    const state = makeState([redirectedTarget, source]);
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: "all",
      },
      properties: { levelCostDelta: 2 },
      duration: { scope: "while_on_field" },
    };

    const result = executeOverrideProperties(
      action,
      state,
      BOB,
      source.instanceId,
      getCardDef,
      { timing: { kind: "continuous" }, steps: [] },
      [redirectedTarget.instanceId],
      { effectIndex: 0, stepIndex: 0 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe(redirectedTarget.instanceId);
    expect(ces[0]!.targetFilter).toBeUndefined();
  });

  it("override_properties global CE は CardFilter の tribesLogic/maxCores 等を保持して評価する", () => {
    const source = fieldSpirit("bob-source", BOB);
    const target = fieldSpirit("alice-target", ALICE);
    const state = makeState([target, source]);
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit"],
          tribes: ["紅魔", "導魔"],
          tribesLogic: "and",
          cardName: { contains: "Spirit" },
          maxCores: 1,
        },
        count: "all",
      },
      properties: { addTribes: ["対象"] },
      duration: { scope: "while_on_field" },
    };

    const result = executeOverrideProperties(
      action,
      state,
      BOB,
      source.instanceId,
      getCardDef,
      { timing: { kind: "continuous" }, steps: [] },
      undefined,
      { effectIndex: 0, stepIndex: 0 }
    );

    const ce = result.activeContinuousEffects.find(
      (candidate) => candidate.modifierTag === "override_properties"
    );
    expect(ce?.targetFilter).toMatchObject({
      player: "opponent",
      category: ["spirit"],
      tribes: ["紅魔", "導魔"],
      tribesLogic: "and",
      cardName: { contains: "Spirit" },
      maxCores: 1,
    });
    expect(getEffectiveTribes(result, target, TEST_SPIRIT, getCardDef)).toEqual(
      ["紅魔"]
    );
  });

  it("override_properties global CE は cost 条件つき filter も動的メンバーシップ (targetFilter) にする", () => {
    // maxCost/costBasis は matchesCardFilter が印字/効果コストから直接判定できる静的プロパティで
    // あり、maxCores/tribes 等と同様に dynamic membership global CE の対象にできる
    // (ENGINE-override-properties-cost-filter-dynamic-membership、BSTH09-X02「本来のコストが
    // 7以下」= count:"all" が snapshot に落ちて場入り後の対象を拾えなかった adversarial
    // verifier 指摘で解消)。
    const source = fieldSpirit("bob-source", BOB);
    const target = fieldSpirit("alice-target", ALICE);
    const state = makeState([target, source]);
    const action: Action = {
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit"],
          maxCost: 3,
        },
        count: "all",
      },
      properties: { addTribes: ["対象"] },
      duration: { scope: "while_on_field" },
    };

    const result = executeOverrideProperties(
      action,
      state,
      BOB,
      source.instanceId,
      getCardDef,
      { timing: { kind: "continuous" }, steps: [] },
      undefined,
      { effectIndex: 0, stepIndex: 0 }
    );

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBeUndefined();
    expect(ces[0]!.targetFilter).toMatchObject({
      player: "opponent",
      category: ["spirit"],
      maxCost: 3,
    });
    expect(getEffectiveTribes(result, target, TEST_SPIRIT, getCardDef)).toEqual(
      ["紅魔", "対象"]
    );
  });

  it("global override_properties.addTribes は include_all 対象取得 gate で cannot_include に遮断される", () => {
    const target = fieldSpirit("alice-target", ALICE);
    const source = fieldSpirit("bob-source", BOB);
    const base = makeState([target, source]);
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        {
          effectId: "ce-cannot-include",
          sourceInstanceId: "alice-lock-source",
          sourceDefinitionId: TEST_GRANDWALKER.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "cannot_include" as ContinuousEffectTag,
          targetInstanceId: target.instanceId,
          metadata: { source: "opponent_effect" },
        },
        {
          effectId: "ce-global-add-tribe",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: TEST_SPIRIT.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties" as ContinuousEffectTag,
          targetFilter: {
            player: "opponent",
            category: ["spirit"],
          },
          metadata: { properties: { addTribes: ["対象"] } },
        },
      ],
    };

    expect(getEffectiveTribes(state, target, TEST_SPIRIT, getCardDef)).toEqual([
      "紅魔",
    ]);
  });

  it("destroy executor の count:1 は cannot_be_targeted を通常 unpreventable では貫通しない", () => {
    const target = fieldSpirit("target-1", ALICE);
    const state = registerResistance(makeState([target]), "cannot_be_targeted");

    const result = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "bob-source",
      undefined,
      undefined,
      "unpreventable"
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === target.instanceId)
        ?.pendingLeaveKind
    ).toBeNull();
  });

  it("destroy executor の count:1 は targetLockBypass:{kind:'all_effects'} だけ cannot_be_targeted を貫通する", () => {
    const target = fieldSpirit("target-1", ALICE);
    const state = registerResistance(makeState([target]), "cannot_be_targeted");

    const result = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "bob-source",
      undefined,
      undefined,
      "unpreventable",
      { kind: "all_effects" }
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === target.instanceId)
        ?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("destroy executor の count:1 自動選択は target acquisition gate 後の候補から選ぶ", () => {
    const locked = fieldSpirit("locked-1", ALICE);
    const open = fieldSpirit("open-1", ALICE);
    const state = registerResistance(
      makeState([locked, open]),
      "cannot_be_targeted"
    );

    const result = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "bob-source",
      undefined,
      undefined,
      "unpreventable"
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === locked.instanceId)
        ?.pendingLeaveKind
    ).toBeNull();
    expect(
      result.cardInstances.find((c) => c.instanceId === open.instanceId)
        ?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("bp_modify executor の count:1 自動選択は target acquisition gate 後の候補から選ぶ", () => {
    const locked = fieldSpirit("locked-1", ALICE);
    const open = fieldSpirit("open-1", ALICE);
    const state = registerResistance(
      makeState([locked, open]),
      "cannot_be_targeted"
    );

    const result = executeBpModify(
      state,
      BOB,
      {
        target: { selfCard: false, player: "opponent", count: 1 },
        amount: 1000,
        duration: { scope: "turn" },
      },
      "bob-source",
      getCardDef,
      undefined,
      undefined,
      undefined,
      "unpreventable"
    );

    expect(
      result.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "bp_modifier"
      )
    ).toMatchObject([{ targetInstanceId: open.instanceId }]);
  });

  it("dynamic-all bp_modifier は sourcePreventionBypass で defense_immune を貫通する", () => {
    const source = fieldSpirit("source-1", BOB);
    const target = fieldSpirit("target-1", ALICE);
    const state = {
      ...makeState([source, target]),
      activeContinuousEffects: [defenseImmuneFromNexusCE(target.instanceId)],
    };
    const action = {
      target: {
        selfCard: false,
        player: "opponent" as const,
        count: -1,
        category: ["spirit" as const],
      },
      amount: 1000,
      duration: { scope: "turn" as const },
    };

    const blocked = executeBpModify(
      state,
      BOB,
      action,
      source.instanceId,
      getCardDef
    );
    expect(
      getBpModifierTotal(blocked, target.instanceId, target, getCardDef)
    ).toBe(0);

    const pierced = executeBpModify(
      state,
      BOB,
      action,
      source.instanceId,
      getCardDef,
      undefined,
      undefined,
      undefined,
      "none",
      undefined,
      false,
      true,
      { kind: "preventing_effect_filter", filter: { categories: ["nexus"] } }
    );
    expect(
      getBpModifierTotal(pierced, target.instanceId, target, getCardDef)
    ).toBe(1000);
  });

  it("dynamic-all bp_modifier は OR 集約 targetLockBypass を保持する", () => {
    const source = fieldSpirit("source-1", BOB);
    const target = fieldSpirit("target-1", ALICE);
    const state = {
      ...makeState([source, target]),
      activeContinuousEffects: [cannotIncludeFromNexusCE(target.instanceId)],
    };

    const result = executeBpModify(
      state,
      BOB,
      {
        target: {
          selfCard: false,
          player: "opponent",
          count: -1,
          category: ["spirit"],
        },
        amount: 1000,
        duration: { scope: "turn" },
      },
      source.instanceId,
      getCardDef,
      undefined,
      undefined,
      undefined,
      "none",
      {
        kind: "any_preventing_effect_filter",
        filters: [{ categories: ["nexus"] }, { categories: ["ultimate"] }],
      }
    );

    expect(
      getBpModifierTotal(result, target.instanceId, target, getCardDef)
    ).toBe(1000);
  });

  it("exhaust executor は cannot_be_exhausted を AffectDecision gate 経由で消費する", () => {
    const target = fieldSpirit("target-1", ALICE);
    const state = registerResistance(
      makeState([target]),
      "cannot_be_exhausted"
    );

    const blocked = executeExhaust(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      undefined,
      "bob-source"
    );
    expect(
      blocked.cardInstances.find((c) => c.instanceId === target.instanceId)
        ?.exhaustState
    ).toBe("recovered");
    expect(blocked.log).toContain(
      `effect:exhaust:blocked-by-resistance:${BOB}:${target.instanceId}`
    );

    const pierced = executeExhaust(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      undefined,
      "bob-source",
      undefined,
      "unpreventable"
    );
    expect(
      pierced.cardInstances.find((c) => c.instanceId === target.instanceId)
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      pierced.cardInstances.find((c) => c.instanceId === target.instanceId)
        ?.exhaustedByUnpreventableEffect
    ).toBe(true);
  });

  it("legal action candidates exclude target-locked cards unless targetLockBypass is present", () => {
    const target = fieldSpirit("target-1", ALICE);
    const state = registerResistance(makeState([target]), "cannot_be_targeted");
    const registration: RegisteredTargetedEffectActionBase = {
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilterActionKind: "destroy",
      preventionLevel: "unpreventable",
    };

    expect(
      getCandidateTargetInstanceIds(state, BOB, registration, {
        getCardDefinitionById: getCardDef,
        sourceInstanceId: "bob-source",
      })
    ).toEqual([]);
    expect(
      getCandidateTargetInstanceIds(
        state,
        BOB,
        {
          ...registration,
          targetLockBypass: { kind: "all_effects" },
        },
        {
          getCardDefinitionById: getCardDef,
          sourceInstanceId: "bob-source",
        }
      )
    ).toEqual([target.instanceId]);
  });

  it("targetLockBypass 付きの広義 nexus 候補は特殊ネクサスを対象にできる", () => {
    const grandwalker = fieldCard(TEST_GRANDWALKER, "gw-1", ALICE);
    const grandstone = fieldCard(TEST_GRANDSTONE, "gs-1", ALICE);
    const state = makeState([grandwalker, grandstone]);
    const registration: RegisteredTargetedEffectActionBase = {
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilter: { category: ["nexus"] },
      preventionLevel: "unpreventable",
    };

    expect(
      getCandidateTargetInstanceIds(state, BOB, registration, {
        getCardDefinitionById: getCardDef,
        sourceInstanceId: "bob-source",
      })
    ).toEqual([]);
    expect(
      getCandidateTargetInstanceIds(
        state,
        BOB,
        {
          ...registration,
          targetLockBypass: { kind: "all_effects" },
        },
        {
          getCardDefinitionById: getCardDef,
          sourceInstanceId: "bob-source",
        }
      )
    ).toEqual([grandwalker.instanceId, grandstone.instanceId]);
  });

  it("preventionRestriction 付き remove_from_game は広義 nexus 指定で創界神の離れない耐性も貫通する", () => {
    const source = fieldSpirit("source-1", BOB);
    const grandwalker = fieldCard(TEST_GRANDWALKER, "gw-1", ALICE);
    const state = {
      ...makeState([source, grandwalker]),
      activeContinuousEffects: [
        {
          effectId: "ce-cannot-leave",
          sourceInstanceId: grandwalker.instanceId,
          sourceDefinitionId: grandwalker.definitionId,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" as const },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "cannot_leave_field" as const,
          targetInstanceId: grandwalker.instanceId,
          metadata: { source: "all" as const },
        },
      ],
    };

    const plain = executeEffect({
      chainId: "test:target-affect-gate:2818",
      state,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
            },
          },
        ],
      },
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      plain.cardInstances.find((c) => c.instanceId === grandwalker.instanceId)
        ?.zone
    ).toBe("field");

    const restricted = executeEffect({
      chainId: "test:target-affect-gate:2845",
      state,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        preventionRestriction: { onlyPreventableByTribes: ["蓬莱"] },
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
            },
          },
        ],
      },
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    // Step 4 (ENGINE-remove-from-game-attached-brave-orphan): queuePendingLeave 経由化済。
    // executeEffect は flush しないため pendingLeaveKind で離脱判定確定を検証する (destroy と同型)。
    expect(
      restricted.cardInstances.find(
        (c) => c.instanceId === grandwalker.instanceId
      )?.pendingLeaveKind
    ).toBe("remove_from_game");
  });
});

describe("P3-139 convertCoreLocation: default:{void,self} 誤縮退の解消", () => {
  // CoreLocation.kind は 15 種で網羅。全種が明示 case を持つことを確認する
  // (default は never 網羅チェックの throw のみで、値へは縮退しない)。
  const LOCATIONS: Array<[string, CoreLocation]> = [
    ["void", { kind: "void", player: "self" }],
    ["reserve", { kind: "reserve", player: "self" }],
    ["trash", { kind: "trash", player: "self" }],
    ["life", { kind: "life", player: "self" }],
    ["outside_game", { kind: "outside_game" }],
    ["removed_from_game", { kind: "removed_from_game", player: "self" }],
    ["field", { kind: "field", player: "self" }],
    ["count_area", { kind: "count_area", player: "self" }],
    ["this_card", { kind: "this_card" }],
    ["target_card", { kind: "target_card" }],
    ["card_instance", { kind: "card_instance", instanceId: "x" }],
    ["ref", { kind: "ref", stepId: "step-1" }],
    ["field_card", { kind: "field_card", player: "self", filter: {} }],
    ["any_movable_self", { kind: "any_movable_self" }],
    ["field_and_reserve_self", { kind: "field_and_reserve_self" }],
    [
      "field_reserve_and_trash_self",
      { kind: "field_reserve_and_trash_self", trashCoreLimit: 1 },
    ],
  ];

  it.each(LOCATIONS)("%s は例外を投げず変換される", (_label, loc) => {
    expect(() => convertCoreLocation(loc)).not.toThrow();
  });

  it("ref は明示的に this_card へフォールバックする (誤用時の意図的縮退、default とは別)", () => {
    expect(convertCoreLocation({ kind: "ref", stepId: "step-1" })).toEqual({
      kind: "this_card",
    });
  });
});
