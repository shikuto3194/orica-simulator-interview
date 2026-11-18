/**
 * engine-effect-prevention-immunity-tribes:
 * `grant_effect_source_prevention_immunity` CE 登録プリミティブ (BSSL01-X02[9,10]
 * 『自分の系統：「影」を持つ効果は、相手の効果では防げない』の土台)。
 *
 * `grant_paid_prevention_immunity` (対価支払いで unpreventable 化する権利付与) との違いは、
 * 対価が不要で「発生源カードの実効系統がスコープに一致する限り常時 unpreventable」な
 * player-scoped CE である点。誘発/起動効果の宣言時に
 * `isEffectSourceTribePreventionImmune` が自動適用し、legal action の variant 分岐は生じない。
 */
import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  ActiveStack,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolveDeferredFieldEffectStack } from "../src/card/card-effect-system";
import {
  getEffectSourceTribePreventionBypass,
  isEffectSourceTribePreventionImmune,
  effectHasSoulDriveDepartureCost,
  getSoulDriveDeparturePreventionBypass,
} from "../src/legal/legal-actions-shared";
import {
  flushPendingLeaves,
  runStateBasedActions,
} from "../src/state-based-actions";
import { executeDestroy } from "../src/effect/structured-card-replacement";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { canBypassTargetLock } from "../src/effect/target-affect-gate";
import {
  playSummonAsAction,
  getLegalActions,
  applyLegalAction,
} from "../src/index";
import { stackMatchesNegateAction } from "../src/stack/stack-negate";
import { getStackTargetSelection } from "../src/legal/stack-target-resolution";
import {
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const GRANT_HOST_DEF: CardDefinition = {
  cardNo: "GEP-HOST",
  name: "Grant Host",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  tribe: "影",
} as unknown as CardDefinition;

const GRANT_EFFECT: Effect = {
  timing: { kind: "continuous" },
  steps: [
    {
      action: {
        kind: "grant_effect_source_prevention_immunity",
        player: "self",
        sourceScope: { tribes: ["影"] },
        duration: { scope: "battle" },
      },
    },
  ],
} as unknown as Effect;

const SHADOW_TRIGGER_DEF: CardDefinition = {
  cardNo: "GEP-SHADOW",
  name: "Shadow Triggerer",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  tribe: "影",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
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
} as unknown as CardDefinition;

const NON_SHADOW_TRIGGER_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-NONSHADOW",
  tribe: "プレイヤー",
} as unknown as CardDefinition;

const SHADOW_FIELD_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-FIELD",
  name: "Shadow Field",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const NON_SHADOW_FIELD_DEF: CardDefinition = {
  ...SHADOW_FIELD_DEF,
  cardNo: "GEP-NONSHADOW-FIELD",
  tribe: "プレイヤー",
} as unknown as CardDefinition;

const SHADOW_FIELD_DESTROY_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-FIELD-DESTROY",
  name: "Shadow Field Destroy",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
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
} as unknown as CardDefinition;

const SHADOW_FIELD_CONDITIONAL_PREVENTION_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-FIELD-CONDITIONAL",
  name: "Shadow Field Conditional",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      preventionLevel: "unpreventable",
      preventionLevelCondition: [
        { kind: "count_value", player: "self", min: 5 },
      ],
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const SHADOW_HAND_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-HAND",
  name: "Shadow Hand",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      applicability: { zone: "hand" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const SHADOW_FREE_MAGIC_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-FREE-MAGIC",
  name: "Shadow Free Magic",
  printedCategory: "magic",
  levelDefs: [],
  tribe: "影",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const FREE_MAGIC_TRIGGER_EFFECT: Effect = {
  timing: { kind: "card_event", event: "summon" },
  steps: [
    {
      action: { kind: "use_magic_without_cost", magicTiming: "flash" },
    },
  ],
} as unknown as Effect;

const SHADOW_BURST_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-BURST",
  name: "Shadow Burst",
  keywordTags: ["burst"],
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: { kind: "attack_finished", player: "opponent" },
      },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const SHADOW_ACCEL_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-ACCEL",
  name: "Shadow Accel",
  effects: undefined,
  accelData: {
    timing: "main",
    cost: 0,
    reduction: [],
    effects: [{ timing: { kind: "activated", mode: "main" }, steps: [] }],
  },
} as unknown as CardDefinition;

const SHADOW_CHANGE_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-CHANGE",
  name: "Shadow Change",
  effects: undefined,
  changeData: {
    cost: 0,
    reduction: [],
    effects: [{ timing: { kind: "activated", mode: "flash" }, steps: [] }],
    swapCondition: { tribes: ["影"] },
  },
} as unknown as CardDefinition;

const SHADOW_DIVINE_DEF: CardDefinition = {
  ...SHADOW_TRIGGER_DEF,
  cardNo: "GEP-SHADOW-DIVINE",
  name: "Shadow Divine",
  printedCategory: "nexus",
  effects: undefined,
  grandwalkerData: {
    divineSkills: [
      {
        label: "divine_skill",
        coreCost: 0,
        timing: "main",
        effects: [{ timing: { kind: "activated", mode: "main" }, steps: [] }],
      },
    ],
  },
} as unknown as CardDefinition;

const ENEMY_DEF: CardDefinition = {
  cardNo: "GEP-ENEMY",
  name: "Enemy Spirit",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as unknown as CardDefinition;

const PREVENTER_SPIRIT_DEF: CardDefinition = {
  ...ENEMY_DEF,
  cardNo: "GEP-PREVENTER-SPIRIT",
  name: "Preventer Spirit",
  printedCategory: "spirit",
} as unknown as CardDefinition;

const PREVENTER_NEXUS_DEF: CardDefinition = {
  ...ENEMY_DEF,
  cardNo: "GEP-PREVENTER-NEXUS",
  name: "Preventer Nexus",
  printedCategory: "nexus",
  levelDefs: [],
} as unknown as CardDefinition;

const DEFS = [
  GRANT_HOST_DEF,
  SHADOW_TRIGGER_DEF,
  NON_SHADOW_TRIGGER_DEF,
  SHADOW_FIELD_DEF,
  NON_SHADOW_FIELD_DEF,
  SHADOW_FIELD_DESTROY_DEF,
  SHADOW_FIELD_CONDITIONAL_PREVENTION_DEF,
  SHADOW_HAND_DEF,
  SHADOW_FREE_MAGIC_DEF,
  SHADOW_BURST_DEF,
  SHADOW_ACCEL_DEF,
  SHADOW_CHANGE_DEF,
  SHADOW_DIVINE_DEF,
  ENEMY_DEF,
  PREVENTER_SPIRIT_DEF,
  PREVENTER_NEXUS_DEF,
];
const cardNoMap = new Map(DEFS.map((d) => [d.cardNo, d]));
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(DEFS);
const fieldLookup = buildFieldCardEffectLookup(DEFS);
const handLookup = buildHandActivatedEffectLookup(DEFS);
const burstLookup = buildBurstEffectLookup(DEFS);

describe("grant_effect_source_prevention_immunity CE registration", () => {
  it("registers a player-scoped CE and isEffectSourceTribePreventionImmune matches a source card sharing a scoped tribe", () => {
    let state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const shadow = createCardInstance(SHADOW_TRIGGER_DEF, {
      instanceId: "shadow-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const nonShadow = createCardInstance(NON_SHADOW_TRIGGER_DEF, {
      instanceId: "nonshadow-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = {
      ...state,
      cardInstances: [...state.cardInstances, host, shadow, nonShadow],
    };

    state = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:359",
      state,
      effect: GRANT_EFFECT,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const ce = state.activeContinuousEffects.find(
      (c) => c.modifierTag === "effect_source_prevention_immunity"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe(ALICE);
    expect((ce!.metadata as { tribes?: string[] }).tribes).toEqual(["影"]);

    expect(
      isEffectSourceTribePreventionImmune(state, "shadow-1", ALICE, getDef)
    ).toBe(true);
    expect(
      isEffectSourceTribePreventionImmune(state, "nonshadow-1", ALICE, getDef)
    ).toBe(false);
    // acting player without the grant is unaffected even for a matching-tribe source.
    expect(
      isEffectSourceTribePreventionImmune(state, "shadow-1", BOB, getDef)
    ).toBe(false);
  });

  it("restricted CE と blanket CE が同時にあるときは順序に依存せず all_effects を優先する", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const shadow = createCardInstance(SHADOW_TRIGGER_DEF, {
      instanceId: "shadow-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });

    for (const effects of [
      [restrictedPreventionImmunityCE(ALICE), preventionImmunityCE(ALICE)],
      [preventionImmunityCE(ALICE), restrictedPreventionImmunityCE(ALICE)],
    ]) {
      const state = {
        ...base,
        cardInstances: [shadow],
        activeContinuousEffects: effects,
      };

      expect(
        getEffectSourceTribePreventionBypass(
          state,
          shadow.instanceId,
          ALICE,
          getDef
        )
      ).toEqual({ kind: "all_effects" });
      expect(
        isEffectSourceTribePreventionImmune(
          state,
          shadow.instanceId,
          ALICE,
          getDef
        )
      ).toBe(true);
    }
  });

  it("restricted CE が複数あるときは防止元 filter を OR 集約する", () => {
    const state = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(SHADOW_TRIGGER_DEF, {
          instanceId: "shadow-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
      ],
      activeContinuousEffects: [
        restrictedPreventionImmunityCE(ALICE, ["nexus"], "nexus"),
        restrictedPreventionImmunityCE(ALICE, ["ultimate"], "ultimate"),
      ],
    };

    const bypass = getEffectSourceTribePreventionBypass(
      state,
      "shadow-1",
      ALICE,
      getDef
    );

    expect(bypass).toEqual({
      kind: "any_preventing_effect_filter",
      filters: [{ categories: ["nexus"] }, { categories: ["ultimate"] }],
    });
    expect(
      canBypassTargetLock(
        { resistance: "none", targetLockBypass: bypass ?? { kind: "none" } },
        { categories: ["nexus"] }
      )
    ).toBe(true);
    expect(
      canBypassTargetLock(
        { resistance: "none", targetLockBypass: bypass ?? { kind: "none" } },
        { categories: ["ultimate"] }
      )
    ).toBe(true);
    expect(
      canBypassTargetLock(
        { resistance: "none", targetLockBypass: bypass ?? { kind: "none" } },
        { categories: ["spirit"] }
      )
    ).toBe(false);
  });
});

/** 相手起因の cannot_be_destroyed 耐性 CE を対象 instance に直接付与する。 */
function cannotBeDestroyedCE(
  targetInstanceId: string,
  ownerPlayerId: string
): ContinuousEffect {
  return cannotBeDestroyedCEFrom(targetInstanceId, ownerPlayerId, "test");
}

function cannotBeDestroyedCEFrom(
  targetInstanceId: string,
  ownerPlayerId: string,
  sourceDefinitionId: string
): ContinuousEffect {
  return {
    effectId: `test-cannot_be_destroyed-${targetInstanceId}-${sourceDefinitionId}`,
    sourceInstanceId: `test-source-${sourceDefinitionId}`,
    sourceDefinitionId,
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

/** 事前に有効化された effect_source_prevention_immunity CE (自動・無償)。 */
function preventionImmunityCE(ownerPlayerId: string): ContinuousEffect {
  return {
    effectId: "test-effect_source_prevention_immunity",
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "battle" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "effect_source_prevention_immunity" as ContinuousEffectTag,
    targetInstanceId: ownerPlayerId,
    metadata: { tribes: ["影"] },
  };
}

/** 防止元 filter 付きの effect_source_prevention_immunity CE。 */
function restrictedPreventionImmunityCE(
  ownerPlayerId: string,
  categories: ("nexus" | "ultimate")[] = ["nexus"],
  effectIdSuffix = "restricted"
): ContinuousEffect {
  return {
    effectId: `test-effect_source_prevention_immunity_${effectIdSuffix}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "battle" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "effect_source_prevention_immunity" as ContinuousEffectTag,
    targetInstanceId: ownerPlayerId,
    metadata: {
      tribes: ["影"],
      preventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories },
      },
    },
  };
}

/** stack negate のみを拒否する effect_source_prevention_immunity CE。 */
function stackNegateImmunityCE(ownerPlayerId: string): ContinuousEffect {
  return {
    effectId: "test-effect_source_stack_negate_immunity",
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "battle" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "effect_source_prevention_immunity" as ContinuousEffectTag,
    targetInstanceId: ownerPlayerId,
    metadata: { tribes: ["影"], appliesTo: ["stack_negate"] },
  };
}

function passOpponentToCloseTriggeredStack(state: GameState): GameState {
  if (state.window !== "stack" || !state.stackWindow) {
    return state;
  }
  const opponentId = state.stackWindow.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${opponentId}`,
      can: true,
      reason: "test_close",
      actingPlayerId: opponentId,
    },
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function resolveEnemyTargetIfPending(state: GameState): GameState {
  if (!state.pendingEffectTargetSelection) return state;
  const resolveTarget = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find((a) => a.kind === "resolve_pending_effect_target");
  if (!resolveTarget) return state;
  return applyLegalAction({
    state,
    action: resolveTarget,
    targetInstanceIds: ["enemy-1"],
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeBaseState(
  triggerCard: CardDefinition,
  hasPreventionImmunity: boolean
): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(triggerCard, {
        instanceId: "trigger-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
      createCardInstance(ENEMY_DEF, {
        instanceId: "enemy-1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      cannotBeDestroyedCE("enemy-1", BOB),
      ...(hasPreventionImmunity ? [preventionImmunityCE(ALICE)] : []),
    ],
  };
}

function summonTrigger(state: GameState): GameState {
  return playSummonAsAction({
    state,
    actingPlayerId: ALICE,
    cardInstanceId: "trigger-1",
    paymentSources: [{ kind: "reserve", amount: 2 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeFieldActivationState(
  sourceDef: CardDefinition,
  hasPreventionImmunity: boolean
): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(sourceDef, {
        instanceId: "field-source-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      ...(hasPreventionImmunity ? [preventionImmunityCE(ALICE)] : []),
    ],
  };
}

function declareFieldEffect(state: GameState, sourceCardNo: string): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find(
    (a) => a.kind === "use_field_card_effect" && a.sourceCardNo === sourceCardNo
  );
  expect(action).toBeDefined();

  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeHandActivationState(hasStackNegateImmunity: boolean): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(SHADOW_HAND_DEF, {
        instanceId: "hand-source-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      }),
    ],
    playerOverrides: [{ handCount: 1 }, {}],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      ...(hasStackNegateImmunity ? [stackNegateImmunityCE(ALICE)] : []),
    ],
  };
}

function declareHandEffect(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredHandActivatedEffectActions: handLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find(
    (a) =>
      a.kind === "use_hand_card_effect" && a.sourceCardNo === "GEP-SHADOW-HAND"
  );
  expect(action).toBeDefined();

  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredHandActivatedEffectActions: handLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeBurstActivationState(hasStackNegateImmunity: boolean): GameState {
  const burstSource = createCardInstance(SHADOW_BURST_DEF, {
    instanceId: "burst-source-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "burst",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [burstSource],
  });
  return {
    ...base,
    activePlayerId: BOB,
    step: "attack",
    setBurstStates: [
      { playerId: ALICE, cardInstanceId: burstSource.instanceId },
    ],
    pendingBurstChecks: [
      {
        checkId: "gep-burst-check-1",
        actingPlayerId: ALICE,
        eventKind: "attack_after",
        source: "battle_resolution",
        chainId: "test:grant-effect-source-prevention-immunity:754",
        attackId: "attack-1",
        relatedPlayerId: BOB,
        amount: 0,
        step: "attack",
        window: "battle_resolution",
        resolvedBurstCardInstanceIds: [],
      },
    ],
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      ...(hasStackNegateImmunity ? [stackNegateImmunityCE(ALICE)] : []),
    ],
  };
}

function declareBurstEffect(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredBurstActions: burstLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find(
    (a) =>
      a.kind === "resolve_pending_burst_check" &&
      a.sourceCardNo === "GEP-SHADOW-BURST"
  );
  expect(action).toBeDefined();

  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredBurstActions: burstLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeStackNegateDeclarationState(
  sourceDef: CardDefinition,
  zone: "field" | "hand"
): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(sourceDef, {
        instanceId: "stack-source-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone,
        normalCoreCount: zone === "field" ? 1 : 0,
      }),
    ],
    playerOverrides: [{ handCount: zone === "hand" ? 1 : 0 }, {}],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      stackNegateImmunityCE(ALICE),
    ],
  };
}

function declareAccelEffect(): GameState {
  const action = {
    kind: "use_accel" as const,
    actionId: "test-use-accel",
    can: true as const,
    reason: "test",
    actingPlayerId: ALICE,
    timing: "main" as const,
    sourceInstanceId: "stack-source-1",
    sourceDefinitionId: SHADOW_ACCEL_DEF.cardNo,
    sourceCardNo: SHADOW_ACCEL_DEF.cardNo,
    targetMode: "none" as const,
    requiredTargetCount: 0,
    targetEffectFilterTags: ["general"] as const,
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    reducedCost: 0,
    additionalCost: 0,
    finalCost: 0,
    totalReduction: 0,
    availableReserveCoreAmount: 0,
    availableOnBoardCoreSources: [],
    availableSoulCoreOnlySources: [],
  };

  return applyLegalAction({
    state: makeStackNegateDeclarationState(SHADOW_ACCEL_DEF, "hand"),
    action,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions: burstLookup,
    paymentSources: [],
  }).state;
}

function declareChangeEffect(): GameState {
  const action = {
    kind: "use_change" as const,
    actionId: "test-use-change",
    can: true as const,
    reason: "test",
    actingPlayerId: ALICE,
    sourceInstanceId: "stack-source-1",
    sourceDefinitionId: SHADOW_CHANGE_DEF.cardNo,
    sourceCardNo: SHADOW_CHANGE_DEF.cardNo,
    targetMode: "none" as const,
    requiredTargetCount: 0,
    targetEffectFilterTags: ["general"] as const,
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    reducedCost: 0,
    additionalCost: 0,
    finalCost: 0,
    totalReduction: 0,
    availableReserveCoreAmount: 0,
    availableOnBoardCoreSources: [],
    availableSoulCoreOnlySources: [],
    swapCandidateInstanceIds: [],
  };

  return applyLegalAction({
    state: makeStackNegateDeclarationState(SHADOW_CHANGE_DEF, "hand"),
    action,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions: burstLookup,
    paymentSources: [],
  }).state;
}

function declareDivineSkillEffect(): GameState {
  const action = {
    kind: "use_divine_skill" as const,
    actionId: "test-use-divine-skill",
    can: true as const,
    reason: "test",
    actingPlayerId: ALICE,
    sourceInstanceId: "stack-source-1",
    sourceDefinitionId: SHADOW_DIVINE_DEF.cardNo,
    sourceCardNo: SHADOW_DIVINE_DEF.cardNo,
    skillIndex: 0,
    label: "divine_skill" as const,
    coreCost: 0,
    availableCores: 0,
  };

  return applyLegalAction({
    state: makeStackNegateDeclarationState(SHADOW_DIVINE_DEF, "field"),
    action,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions: burstLookup,
  }).state;
}

describe("grant_effect_source_prevention_immunity — 誘発効果宣言時の自動 unpreventable 化", () => {
  it("スコープ一致 (影) の発生源からの誘発効果宣言は、選択の余地なく単一 variant で自動的に cannot_be_destroyed を貫通する", () => {
    const summoned = summonTrigger(makeBaseState(SHADOW_TRIGGER_DEF, true));
    const legalActions = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveActions = legalActions.filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon"
    );
    // 対価不要の自動適用のため、paid variant のような分岐は発生しない。
    expect(resolveActions.length).toBe(1);

    const applied = applyLegalAction({
      state: summoned,
      action: resolveActions[0]!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const drained = resolveEnemyTargetIfPending(
      passOpponentToCloseTriggeredStack(applied.state)
    );

    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    const enemyLeftField =
      !enemy ||
      enemy.zone !== "field" ||
      drained.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-1" && !e.blockedByResistance
      );
    expect(enemyLeftField).toBe(true);
  });

  it("スコープ不一致 (プレイヤー系統) の発生源では免疫が適用されず cannot_be_destroyed に阻まれる", () => {
    const summoned = summonTrigger(makeBaseState(NON_SHADOW_TRIGGER_DEF, true));
    const legalActions = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveAction = legalActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon"
    );
    expect(resolveAction).toBeDefined();

    const applied = applyLegalAction({
      state: summoned,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const drained = resolveEnemyTargetIfPending(
      passOpponentToCloseTriggeredStack(applied.state)
    );

    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).toBe("field");
  });

  it("免疫 CE が無いとき、影の発生源でも cannot_be_destroyed に阻まれる", () => {
    const summoned = summonTrigger(makeBaseState(SHADOW_TRIGGER_DEF, false));
    const legalActions = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveAction = legalActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon"
    );
    expect(resolveAction).toBeDefined();

    const applied = applyLegalAction({
      state: summoned,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const drained = resolveEnemyTargetIfPending(
      passOpponentToCloseTriggeredStack(applied.state)
    );

    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).toBe("field");
  });
});

describe("grant_effect_source_prevention_immunity — 起動効果宣言時の自動 unpreventable 化", () => {
  it("スコープ一致 (影) のフィールド起動効果は、宣言スタックに preventionLevel:unpreventable を持つ", () => {
    const declared = declareFieldEffect(
      makeFieldActivationState(SHADOW_FIELD_DEF, true),
      "GEP-SHADOW-FIELD"
    );

    expect(declared.window).toBe("stack");
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "field_card_effect"
    );
    expect(declared.stackWindow?.pendingStackAction?.preventionLevel).toBe(
      "unpreventable"
    );
  });

  it("restricted prevention immunity は ActiveStack を global unpreventable に昇格せず bypass として焼く", () => {
    const base = makeFieldActivationState(SHADOW_FIELD_DEF, false);
    const declared = declareFieldEffect(
      {
        ...base,
        activeContinuousEffects: [
          ...base.activeContinuousEffects,
          restrictedPreventionImmunityCE(ALICE, ["nexus", "ultimate"]),
        ],
      },
      "GEP-SHADOW-FIELD"
    );

    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("field_card_effect");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.preventionBypass).toEqual({
      kind: "preventing_effect_filter",
      filter: { categories: ["nexus", "ultimate"] },
    });
  });

  it("restricted prevention immunity の直接解決は nexus 起源の防止だけを貫通し spirit 起源は残す", () => {
    const makeRestrictedState = (sourceDefinitionId: string): GameState => {
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(SHADOW_TRIGGER_DEF, {
            instanceId: "shadow-source-1",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(ENEMY_DEF, {
            instanceId: "enemy-1",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      });
      return {
        ...base,
        step: "main",
        activePlayerId: ALICE,
        activeContinuousEffects: [
          ...base.activeContinuousEffects,
          restrictedPreventionImmunityCE(ALICE, ["nexus"]),
          cannotBeDestroyedCEFrom("enemy-1", BOB, sourceDefinitionId),
        ],
      };
    };

    const effect = SHADOW_TRIGGER_DEF.effects![0]!;
    const spiritBlocked = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:1091",
      state: makeRestrictedState(PREVENTER_SPIRIT_DEF.cardNo),
      effect,
      sourceInstanceId: "shadow-source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      spiritBlocked.cardInstances.find((c) => c.instanceId === "enemy-1")
        ?.pendingLeaveKind
    ).toBeNull();

    const nexusPierced = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:1103",
      state: makeRestrictedState(PREVENTER_NEXUS_DEF.cardNo),
      effect,
      sourceInstanceId: "shadow-source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      nexusPierced.cardInstances.find((c) => c.instanceId === "enemy-1")
        ?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("stack_negate 専用 CE は、target/leave 防止貫通ではなく stack negate だけを拒否する", () => {
    const base = makeFieldActivationState(SHADOW_FIELD_DEF, false);
    const declared = declareFieldEffect(
      {
        ...base,
        activeContinuousEffects: [
          ...base.activeContinuousEffects,
          stackNegateImmunityCE(ALICE),
        ],
      },
      "GEP-SHADOW-FIELD"
    );
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("field_card_effect");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("stack_negate 専用 CE は手札起動効果の ActiveStack にも negatePreventionLevel を焼き込む", () => {
    const declared = declareHandEffect(makeHandActivationState(true));
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("hand_card_effect");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("use_magic_without_cost 経路の synthetic magic stack に dynamic preventionLevel と negatePreventionLevel を引き継ぐ", () => {
    const source = createCardInstance(SHADOW_FREE_MAGIC_DEF, {
      instanceId: "free-magic-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
      playerOverrides: [{ deckCount: 5 }, {}],
    });
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: ALICE,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        preventionImmunityCE(ALICE),
        stackNegateImmunityCE(ALICE),
      ],
    };
    let capturedStack: ActiveStack | undefined;

    executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:1184",
      state,
      effect: FREE_MAGIC_TRIGGER_EFFECT,
      sourceInstanceId: "free-magic-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
      resolveDeferredStackForFreeMagicUse: (current, stack) => {
        capturedStack = stack;
        return current;
      },
    });

    expect(capturedStack?.actionKind).toBe("magic");
    expect(capturedStack?.cardInstanceId).toBe("free-magic-1");
    expect(capturedStack?.chosenTiming).toBe("flash");
    expect(capturedStack?.preventionLevel).toBe("unpreventable");
    expect(capturedStack?.negatePreventionLevel).toBe("unpreventable");
  });

  it("stack_negate 専用 CE はバースト発動の ActiveStack にも negatePreventionLevel を焼き込む", () => {
    const declared = declareBurstEffect(makeBurstActivationState(true));
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("burst_activation");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("stack_negate 専用 CE はアクセルの ActiveStack にも negatePreventionLevel を焼き込む", () => {
    const declared = declareAccelEffect();
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("accel");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("stack_negate 専用 CE はチェンジの ActiveStack にも negatePreventionLevel を焼き込む", () => {
    const declared = declareChangeEffect();
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("change");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("stack_negate 専用 CE は神技の ActiveStack にも negatePreventionLevel を焼き込む", () => {
    const declared = declareDivineSkillEffect();
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("divine_skill");
    expect(stack?.preventionLevel).toBeUndefined();
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("negatePreventionLevel は対象効果自身の preventionLevelCondition が false でも stack negate を拒否する", () => {
    const base = makeFieldActivationState(
      SHADOW_FIELD_CONDITIONAL_PREVENTION_DEF,
      false
    );
    const declared = declareFieldEffect(
      {
        ...base,
        activeContinuousEffects: [
          ...base.activeContinuousEffects,
          stackNegateImmunityCE(ALICE),
        ],
      },
      "GEP-SHADOW-FIELD-CONDITIONAL"
    );
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.actionKind).toBe("field_card_effect");
    expect(stack?.preventionLevel).toBe("unpreventable");
    expect(stack?.negatePreventionLevel).toBe("unpreventable");
    expect(
      stackMatchesNegateAction({
        state: declared,
        stack: stack!,
        request: { negateTarget: "effect" },
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("窓後対象候補生成は、宣言時 activeStack に焼いた動的 preventionLevel を使って cannot_be_destroyed を貫通する", () => {
    const source = createCardInstance(SHADOW_FIELD_DESTROY_DEF, {
      instanceId: "field-source-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "enemy-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, enemy],
      }),
      activeContinuousEffects: [cannotBeDestroyedCE("enemy-1", BOB)],
    };
    const stack: ActiveStack = {
      stackId: "stack:field-destroy",
      actionKind: "field_card_effect",
      chainId: "field-destroy",
      actingPlayerId: ALICE,
      cardInstanceId: "field-source-1",
      cardDefinitionId: "GEP-SHADOW-FIELD-DESTROY",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      fieldEffectSourceKind: "spirit",
      chosenTiming: "main",
      fieldEffectRegistrationIndex: 0,
      preventionLevel: "unpreventable",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const selection = getStackTargetSelection(state, stack, {
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(selection?.candidateInstanceIds).toEqual(["enemy-1"]);
  });

  it("field_card_effect の deferred 本体解決は activeStack の preventionLevel を復元する", () => {
    const source = createCardInstance(SHADOW_FIELD_DESTROY_DEF, {
      instanceId: "field-source-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "enemy-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, enemy],
      }),
      step: "main" as const,
      activePlayerId: ALICE,
      activeContinuousEffects: [
        preventionImmunityCE(ALICE),
        cannotBeDestroyedCE("enemy-1", BOB),
      ],
    };
    const declared = declareFieldEffect(base, "GEP-SHADOW-FIELD-DESTROY");
    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.preventionLevel).toBe("unpreventable");

    const resolved = resolveDeferredFieldEffectStack({
      state: declared,
      activeStack: {
        ...stack!,
        targetInstanceIds: ["enemy-1"],
        targetSelectionResolved: true,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    });

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "enemy-1")?.zone
    ).toBe("trash");
  });

  it("スコープ不一致のフィールド起動効果は、宣言スタックへ preventionLevel を付与されない", () => {
    const declared = declareFieldEffect(
      makeFieldActivationState(NON_SHADOW_FIELD_DEF, true),
      "GEP-NONSHADOW-FIELD"
    );

    expect(declared.window).toBe("stack");
    expect(
      declared.stackWindow?.pendingStackAction?.preventionLevel
    ).toBeUndefined();
  });
});

/**
 * P3-125 Step13 (BSLH01-C07 冥王珠): `sourceScope:{soulDriveDeparture:true}` variant。
 * tribes 版と異なり判定基準は発生源カードでなく**宣言中の effect 自身**の steps 形状
 * (explicit_soul_core コスト + 相手スピ/アルティメットへの離脱を及ぼすステップ)。
 * card-data 側の BSLH01-C07 は adversarial verifier round1 (stay_on_field 型残置リアクション
 * を貫通できない) で stub のまま残っているため、本 primitive 自体の正しさは合成 Effect で
 * 直接検証する。
 */
const SOUL_DRIVE_COST_STEP = {
  id: "soul-drive-cost",
  action: {
    kind: "core_move" as const,
    from: {
      kind: "field" as const,
      player: "self" as const,
      includeReserve: true,
    },
    to: { kind: "removed_from_game" as const, player: "self" as const },
    amount: 1,
    effectKind: "explicit_soul_core" as const,
  },
};

const SOUL_DRIVE_DEPARTURE_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    SOUL_DRIVE_COST_STEP,
    {
      stepCondition: { kind: "ref_succeeded", stepId: "soul-drive-cost" },
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
} as unknown as Effect;

const SOUL_DRIVE_NON_DEPARTURE_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    SOUL_DRIVE_COST_STEP,
    {
      stepCondition: { kind: "ref_succeeded", stepId: "soul-drive-cost" },
      action: { kind: "draw", count: 1 },
    },
  ],
} as unknown as Effect;

const NON_SOUL_DRIVE_DESTROY_EFFECT: Effect = {
  timing: { kind: "card_event", event: "summon" },
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
} as unknown as Effect;

const SOUL_DRIVE_GRANT_EFFECT: Effect = {
  timing: { kind: "continuous" },
  steps: [
    {
      action: {
        kind: "grant_effect_source_prevention_immunity",
        player: "self",
        sourceScope: { soulDriveDeparture: true },
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        duration: { scope: "battle" },
      },
    },
  ],
} as unknown as Effect;

/** defense_immune (「相手の効果を受けない」) CE を対象 instance に直接付与する。 */
function defenseImmuneCE(
  targetInstanceId: string,
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: `test-defense-immune-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune" as ContinuousEffectTag,
    targetInstanceId,
    metadata: {},
  };
}

describe("grant_effect_source_prevention_immunity — sourceScope:{soulDriveDeparture:true} (P3-125 Step13)", () => {
  it("effectHasSoulDriveDepartureCost: explicit_soul_core コスト + 相手への destroy を含む effect のみ true", () => {
    expect(effectHasSoulDriveDepartureCost(SOUL_DRIVE_DEPARTURE_EFFECT)).toBe(
      true
    );
    // コストは払うが相手への離脱を及ぼさない (自己ドロー) effect は対象外。
    expect(
      effectHasSoulDriveDepartureCost(SOUL_DRIVE_NON_DEPARTURE_EFFECT)
    ).toBe(false);
    // 相手への destroy はあるが explicit_soul_core コストが無い effect も対象外。
    expect(effectHasSoulDriveDepartureCost(NON_SOUL_DRIVE_DESTROY_EFFECT)).toBe(
      false
    );
  });

  it("getSoulDriveDeparturePreventionBypass: 一致 CE が無ければ undefined、登録後は一致する", () => {
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    expect(
      getSoulDriveDeparturePreventionBypass(
        state,
        SOUL_DRIVE_DEPARTURE_EFFECT,
        ALICE
      )
    ).toBeUndefined();

    const withGrantCE: GameState = {
      ...state,
      cardInstances: [
        createCardInstance(GRANT_HOST_DEF, {
          instanceId: "sd-grant-host",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
      ],
      activeContinuousEffects: [
        {
          effectId: "test-soul-drive-grant",
          sourceInstanceId: "sd-grant-host",
          sourceDefinitionId: GRANT_HOST_DEF.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "battle" },
          createdAtTurn: 0,
          createdAtAttackId: null,
          modifierTag:
            "effect_source_prevention_immunity" as ContinuousEffectTag,
          targetInstanceId: ALICE,
          metadata: { soulDriveDeparture: true },
        },
      ],
    };
    expect(
      getSoulDriveDeparturePreventionBypass(
        withGrantCE,
        SOUL_DRIVE_DEPARTURE_EFFECT,
        ALICE
      )
    ).toBeDefined();
    // 非離脱型 effect (自己ドロー) は grant CE があっても一致しない。
    expect(
      getSoulDriveDeparturePreventionBypass(
        withGrantCE,
        SOUL_DRIVE_NON_DEPARTURE_EFFECT,
        ALICE
      )
    ).toBeUndefined();
  });

  it("[意味差分] grant 未登録: 相手の defense_immune 耐性が destroy を阻み対象は場に残る", () => {
    const src = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "sd-src-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "sd-enemy-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, enemy],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
      activeContinuousEffects: [defenseImmuneCE("sd-enemy-1", BOB)],
    };
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:grant-effect-source-prevention-immunity:1617",
        state: before,
        effect: SOUL_DRIVE_DEPARTURE_EFFECT,
        sourceInstanceId: src.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "sd-enemy-1")?.zone
    ).toBe("field");
  });

  it("[意味差分] grant 登録済み: 相手の defense_immune 耐性があっても destroy が貫通しトラッシュへ送られる", () => {
    const grantHost = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "sd-grant-host-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const src = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "sd-src-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "sd-enemy-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [grantHost, src, enemy],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
      activeContinuousEffects: [defenseImmuneCE("sd-enemy-2", BOB)],
    };
    const withGrant = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:1669",
      state: before,
      effect: SOUL_DRIVE_GRANT_EFFECT,
      sourceInstanceId: grantHost.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:grant-effect-source-prevention-immunity:1677",
        state: withGrant,
        effect: SOUL_DRIVE_DEPARTURE_EFFECT,
        sourceInstanceId: src.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "sd-enemy-2")?.zone
    ).toBe("trash");

    // usageLimit:per_instance/turn:1 を使い切ったため、以後の照会は一致しない。
    expect(
      getSoulDriveDeparturePreventionBypass(
        after,
        SOUL_DRIVE_DEPARTURE_EFFECT,
        ALICE
      )
    ).toBeUndefined();
  });
});

/**
 * ENGINE-soul-drive-departure-prevention-immunity (P3-125 Step14): stay_on_field 型残置
 * リアクション貫通の producer 側配線。consumer 側 (`preventStayOnField:true` が実際に
 * stay_on_field を止める) は send-to-deck-pending-leave.test.ts で検証済みのため、ここでは
 * destroy 経路 (`executeDestroy` の新設 `preventStayOnField` 引数、X10 precedent) と
 * SBA コア不足消滅経路 (`runStateBasedActions` が
 * `pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds` 配列の
 * `causedByEffectSourceInstanceId` 一致を条件に適用、X09 precedent) が正しく
 * `PendingLeaveEntity.preventStayOnField` を立てることと、`executeEffect` wrapper が
 * 呼び出し全体の return 時に自分の sourceInstanceId だけを正しく取り除くことを検証する。
 * 単一発動が複数対象 (X09 Lv2/Lv3、対象ごとに個別 `after_triggers`) へ及ぶケースは、
 * 実カード DSL 相当の合成 Effect を `executeEffect` に1回通す統合テストで別途検証する
 * (末尾 describe ブロック参照。adversarial verifier が指摘した producer 単体テストだけでは
 * 検出できない bug の再発防止)。
 */
describe("ENGINE-soul-drive-departure-prevention-immunity: destroy 経路 preventStayOnField", () => {
  it("preventStayOnField:true を渡すと生成される PendingLeaveEntity に反映される", () => {
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "sd-destroy-enemy-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const after = executeDestroy(
      state,
      ALICE,
      { player: "opponent", count: 1 },
      getDef,
      "sd-destroy-src",
      [enemy.instanceId],
      undefined,
      undefined,
      undefined,
      undefined,
      "effect",
      undefined,
      undefined,
      undefined,
      true
    );
    const pendingLeave = after.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBe(true);
  });

  it("preventStayOnField を省略すると従来通り立たない", () => {
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "sd-destroy-enemy-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const after = executeDestroy(
      state,
      ALICE,
      { player: "opponent", count: 1 },
      getDef,
      "sd-destroy-src",
      [enemy.instanceId]
    );
    const pendingLeave = after.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBeUndefined();
  });
});

describe("ENGINE-soul-drive-departure-prevention-immunity: SBA コア不足消滅経路 preventStayOnField", () => {
  function coreDeficitEnemy(instanceId: string, controllerPlayerId = BOB) {
    return createCardInstance(ENEMY_DEF, {
      instanceId,
      ownerPlayerId: controllerPlayerId,
      controllerPlayerId,
      zone: "field",
      normalCoreCount: 0,
    });
  }

  it("sourceInstanceId が配列に含まれ causedByEffectSourceInstanceId と一致すると、相手カードのコア不足消滅に preventStayOnField が反映される", () => {
    const enemy = coreDeficitEnemy("sd-sba-enemy-1");
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const state: GameState = {
      ...base,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
        "sd-sba-src-1",
      ],
    };
    const result = runStateBasedActions(state, getDef, ALICE, "sd-sba-src-1");
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBe(true);
    // runStateBasedActions 自体は配列をクリアしない (executeEffect wrapper の責務)。
    expect(
      result.state
        .pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds
    ).toEqual(["sd-sba-src-1"]);
  });

  it("causedByEffectSourceInstanceId が配列に含まれない sourceInstanceId だと反映されない", () => {
    const enemy = coreDeficitEnemy("sd-sba-enemy-mismatch");
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const state: GameState = {
      ...base,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
        "sd-sba-src-other",
      ],
    };
    const result = runStateBasedActions(
      state,
      getDef,
      ALICE,
      "sd-sba-src-mismatch"
    );
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBeUndefined();
  });

  it("配列に含まれていても自分 (causedByPlayerId) が管理するカードのコア不足消滅には反映されない", () => {
    const ownEnemy = coreDeficitEnemy("sd-sba-own-1", ALICE);
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [ownEnemy],
    });
    const state: GameState = {
      ...base,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
        "sd-sba-src-2",
      ],
    };
    const result = runStateBasedActions(state, getDef, ALICE, "sd-sba-src-2");
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === ownEnemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBeUndefined();
  });

  it("配列が空/未設定ならコア不足消滅は従来通り preventStayOnField 無しで処理される", () => {
    const enemy = coreDeficitEnemy("sd-sba-enemy-2");
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const result = runStateBasedActions(state, getDef, ALICE, "sd-sba-src-3");
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBeUndefined();
  });

  it("eligibleInstanceIds 省略時 (下位テスト向けフォールバック): 同一 sourceInstanceId から生じた複数のコア不足消滅チェックすべてに preventStayOnField が反映される (単一発動が複数対象へ及ぶケース)", () => {
    const enemy1 = coreDeficitEnemy("sd-sba-multi-1");
    const enemy2 = coreDeficitEnemy("sd-sba-multi-2");
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy1, enemy2],
    });
    const state: GameState = {
      ...base,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
        "sd-sba-src-multi",
      ],
    };
    const result = runStateBasedActions(
      state,
      getDef,
      ALICE,
      "sd-sba-src-multi"
    );
    const leave1 = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy1.instanceId
    );
    const leave2 = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy2.instanceId
    );
    expect(leave1?.preventStayOnField).toBe(true);
    expect(leave2?.preventStayOnField).toBe(true);
  });

  it("eligibleInstanceIds が渡されると、そこに含まれる対象だけに preventStayOnField が絞り込まれる (同じ SBA パスに偶然混入した無関係な相手カードは対象外、adversarial verifier round2)", () => {
    const targeted = coreDeficitEnemy("sd-sba-eligible-targeted");
    const unrelated = coreDeficitEnemy("sd-sba-eligible-unrelated");
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [targeted, unrelated],
    });
    const state: GameState = {
      ...base,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
        "sd-sba-src-eligible",
      ],
    };
    const result = runStateBasedActions(
      state,
      getDef,
      ALICE,
      "sd-sba-src-eligible",
      [targeted.instanceId]
    );
    const targetedLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === targeted.instanceId
    );
    const unrelatedLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === unrelated.instanceId
    );
    expect(targetedLeave?.preventStayOnField).toBe(true);
    expect(unrelatedLeave?.preventStayOnField).toBeUndefined();
  });

  it("eligibleInstanceIds が空配列だと、causedByEffectSourceInstanceId が一致していても preventStayOnField は一切反映されない", () => {
    const enemy = coreDeficitEnemy("sd-sba-eligible-empty");
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const state: GameState = {
      ...base,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
        "sd-sba-src-empty",
      ],
    };
    const result = runStateBasedActions(
      state,
      getDef,
      ALICE,
      "sd-sba-src-empty",
      []
    );
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (p) => p.instanceId === enemy.instanceId
    );
    expect(pendingLeave?.preventStayOnField).toBeUndefined();
  });
});

describe("ENGINE-soul-drive-departure-prevention-immunity: executeEffect wrapper の producer/クリア", () => {
  it("soulDriveConsumption 成立時でも、単一ステップ (after_triggers 無し) の効果は executeEffect の return までに配列から自分の sourceInstanceId を取り除く", () => {
    const grantHost = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "sd-flag-grant-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const src = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "sd-flag-src",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "sd-flag-enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [grantHost, src, enemy],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
      activeContinuousEffects: [defenseImmuneCE("sd-flag-enemy", BOB)],
    };
    const withGrant = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:1994",
      state: before,
      effect: SOUL_DRIVE_GRANT_EFFECT,
      sourceInstanceId: grantHost.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      withGrant.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds
    ).toBeUndefined();
    // SOUL_DRIVE_DEPARTURE_EFFECT は after_triggers 連鎖を持たない単一 destroy ステップのため、
    // executeEffect (wrapper) が return するまでに自分の sourceInstanceId を配列から
    // 取り除き切る (= destroy 自体は内部で正しくフラグを見て preventStayOnField を適用できるが、
    // 外へ漏れ出さない)。
    const afterDeparture = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:2008",
      state: withGrant,
      effect: SOUL_DRIVE_DEPARTURE_EFFECT,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      afterDeparture.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds?.includes(
        src.instanceId
      )
    ).not.toBe(true);
  });

  it("grant が無い (soulDriveConsumption 不成立) ときはフラグが立たない", () => {
    const src = createCardInstance(GRANT_HOST_DEF, {
      instanceId: "sd-flag-src-nogrant",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const enemy = createCardInstance(ENEMY_DEF, {
      instanceId: "sd-flag-enemy-nogrant",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, enemy],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const afterDeparture = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:2053",
      state: before,
      effect: SOUL_DRIVE_DEPARTURE_EFFECT,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      afterDeparture.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds
    ).toBeUndefined();
  });
});

/**
 * BSLH01-X09 型 (Lv2/Lv3 で対象を複数回コアシュートし、各対象ごとに独立した
 * `connector:"after_triggers"` を挟む) の統合再現。adversarial verifier (2026-07-21) が
 * producer 単体テストだけでは検出できなかった実バグを指摘: 単発 boolean フラグ設計だと
 * 1体目の after_triggers 呼び出しで消費・クリアされてしまい、同一 executeEffect 呼び出し内の
 * 2体目以降は preventStayOnField を得られなかった。実カード DSL を模した合成 Effect を
 * `executeEffect` に1回通し、両対象とも preventStayOnField が反映されることを確認する。
 */
const ENEMY_DEF_2: CardDefinition = {
  ...ENEMY_DEF,
  cardNo: "GEP-ENEMY-2",
  name: "Enemy Spirit 2",
  cost: 2,
} as unknown as CardDefinition;

/** BSLH01-R01 型 (対象自身の card_event:leave_field → stay_on_field、mandatory＝選択不要) */
/** BSLH01-R01 型: ボイドコア1個で残す (コア補充が無いと直後の SBA で再度コア不足消滅する)。 */
const stayOnFieldReaction = {
  timing: { kind: "card_event" as const, event: "leave_field" as const },
  steps: [
    {
      action: {
        kind: "core_move" as const,
        from: { kind: "void" as const, player: "self" as const },
        to: { kind: "this_card" as const },
        amount: 1,
      },
    },
    {
      action: {
        kind: "stay_on_field" as const,
        target: { kind: "self" as const },
      },
    },
  ],
};
const ENEMY_DEF_WITH_STAY_ON_FIELD: CardDefinition = {
  ...ENEMY_DEF,
  cardNo: "GEP-ENEMY-STAY-1",
  name: "Enemy Spirit (stay_on_field)",
  effects: [stayOnFieldReaction],
} as unknown as CardDefinition;
const ENEMY_DEF_2_WITH_STAY_ON_FIELD: CardDefinition = {
  ...ENEMY_DEF_2,
  cardNo: "GEP-ENEMY-STAY-2",
  name: "Enemy Spirit 2 (stay_on_field)",
  effects: [stayOnFieldReaction],
} as unknown as CardDefinition;

const SOUL_DRIVE_MULTI_TARGET_DEPARTURE_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    SOUL_DRIVE_COST_STEP,
    {
      id: "sd-multi-target-1",
      stepCondition: { kind: "ref_succeeded", stepId: "soul-drive-cost" },
      action: {
        kind: "core_move",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"], maxCost: 1 },
          count: 1,
        },
        from: { kind: "target_card" },
        to: { kind: "trash", player: "opponent" },
        amount: 1,
      },
    },
    {
      connector: "after_triggers",
      action: { kind: "draw", count: 1 },
    },
    {
      id: "sd-multi-target-2",
      stepCondition: { kind: "ref_succeeded", stepId: "soul-drive-cost" },
      action: {
        kind: "core_move",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"], minCost: 2 },
          count: 1,
        },
        from: { kind: "target_card" },
        to: { kind: "trash", player: "opponent" },
        amount: 1,
      },
    },
    {
      connector: "after_triggers",
      action: { kind: "draw", count: 1 },
    },
  ],
} as unknown as Effect;

const DEFS_WITH_STAY = [
  ...DEFS,
  ENEMY_DEF_2,
  ENEMY_DEF_WITH_STAY_ON_FIELD,
  ENEMY_DEF_2_WITH_STAY_ON_FIELD,
];
const cardNoMapWithStay = new Map(DEFS_WITH_STAY.map((d) => [d.cardNo, d]));
const getDefWithStay = (id: string): CardDefinition | undefined =>
  cardNoMapWithStay.get(id);
const triggeredLookupWithStay = buildTriggeredEffectLookup(DEFS_WITH_STAY);

function setupMultiTargetScenario(
  enemyDef1: CardDefinition,
  enemyDef2: CardDefinition
) {
  const grantHost = createCardInstance(GRANT_HOST_DEF, {
    instanceId: "sd-multi-grant-host",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const src = createCardInstance(GRANT_HOST_DEF, {
    instanceId: "sd-multi-src",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    soulCoreCount: 1,
  });
  const enemy1 = createCardInstance(enemyDef1, {
    instanceId: "sd-multi-enemy-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const enemy2 = createCardInstance(enemyDef2, {
    instanceId: "sd-multi-enemy-2",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  // X09 が一切触れない、既にコア不足状態の相手カード (adversarial verifier round2: 同じ SBA
  // パスに偶然混入しても preventStayOnField を誤って得ないことの回帰確認用)。
  const unrelatedDeficitEnemy = createCardInstance(
    ENEMY_DEF_WITH_STAY_ON_FIELD,
    {
      instanceId: "sd-multi-unrelated-deficit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    }
  );
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [grantHost, src, enemy1, enemy2, unrelatedDeficitEnemy],
  });
  const before: GameState = {
    ...base,
    players: base.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            soulCoreLocation: { kind: "card", instanceId: src.instanceId },
          }
        : p
    ),
  };
  return { grantHost, src, enemy1, enemy2, unrelatedDeficitEnemy, before };
}

/**
 * `resolve_pending_triggered_effect` / `resumeStackCascadeIfReady` を交互に、
 * これ以上進行しなくなるまで繰り返す (after-triggers-stay-flush-gap.test.ts の
 * `driveTriggeredStayToQuiescence` と同型)。対象自身の mandatory stay_on_field 反応が
 * `pendingAfterTriggersContinuations` を挟む実カード解決の完全な駆動に必要。
 */
function driveToQuiescence(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 40; i++) {
    const resumed = resumeStackCascadeIfReady(cur, {
      getCardDefinitionById: getDefWithStay,
      getRegisteredTriggeredEffectActions: triggeredLookupWithStay,
    });
    let progressed = resumed !== cur;
    cur = resumed;
    for (const pid of [BOB, ALICE]) {
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: pid,
        getCardDefinitionById: getDefWithStay,
        getRegisteredTriggeredEffectActions: triggeredLookupWithStay,
        getRegisteredFieldCardEffectActions: () => [],
      });
      const action =
        actions.find((a) => a.kind === "select_pending_to_resolve") ??
        actions.find((a) => a.kind === "resolve_pending_triggered_effect") ??
        actions.find((a) => a.kind === "resolve_pending_burst_check") ??
        actions.find((a) => a.kind === "decline_pending_burst_check") ??
        actions.find((a) => a.kind === "pass_stack");
      if (!action) continue;
      cur = applyLegalAction({
        state: cur,
        action,
        getCardDefinitionById: getDefWithStay,
        getRegisteredTriggeredEffectActions: triggeredLookupWithStay,
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  return cur;
}

describe("ENGINE-soul-drive-departure-prevention-immunity: X09型 複数対象 after_triggers 統合テスト", () => {
  it("[意味差分] grant 未登録: 両対象とも自身の stay_on_field 反応でフィールドに残る", () => {
    const { src, enemy1, enemy2, before } = setupMultiTargetScenario(
      ENEMY_DEF_WITH_STAY_ON_FIELD,
      ENEMY_DEF_2_WITH_STAY_ON_FIELD
    );
    const declared = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:2285",
      state: before,
      effect: SOUL_DRIVE_MULTI_TARGET_DEPARTURE_EFFECT,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithStay,
      getRegisteredTriggeredEffectActions: triggeredLookupWithStay,
    });
    const afterDeparture = flushPendingLeaves(
      driveToQuiescence(declared),
      getDefWithStay
    );
    expect(afterDeparture.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(
      afterDeparture.cardInstances.find(
        (c) => c.instanceId === enemy1.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterDeparture.cardInstances.find(
        (c) => c.instanceId === enemy2.instanceId
      )?.zone
    ).toBe("field");
  });

  it("[意味差分] grant 登録済み: 1回の executeEffect 呼び出し内の2つの独立した after_triggers (2体の対象) いずれも stay_on_field を貫通しトラッシュへ送られる。X09 が触れていない無関係な相手のコア不足カードは誤って貫通しない (adversarial verifier round2)", () => {
    const { grantHost, src, enemy1, enemy2, unrelatedDeficitEnemy, before } =
      setupMultiTargetScenario(
        ENEMY_DEF_WITH_STAY_ON_FIELD,
        ENEMY_DEF_2_WITH_STAY_ON_FIELD
      );
    const withGrant = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:2316",
      state: before,
      effect: SOUL_DRIVE_GRANT_EFFECT,
      sourceInstanceId: grantHost.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithStay,
    });
    const declared = executeEffect({
      chainId: "test:grant-effect-source-prevention-immunity:2323",
      state: withGrant,
      effect: SOUL_DRIVE_MULTI_TARGET_DEPARTURE_EFFECT,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithStay,
      getRegisteredTriggeredEffectActions: triggeredLookupWithStay,
    });
    const afterDeparture = flushPendingLeaves(
      driveToQuiescence(declared),
      getDefWithStay
    );
    expect(afterDeparture.pendingAfterTriggersContinuations).toHaveLength(0);
    // これが adversarial verifier が指摘した実バグの再現ポイント: 単発 boolean フラグ設計だと
    // 1体目の after_triggers 呼び出しで消費・クリアされ、2体目 (enemy2) は
    // stay_on_field を貫通できず field に残ってしまっていた。
    expect(
      afterDeparture.cardInstances.find(
        (c) => c.instanceId === enemy1.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      afterDeparture.cardInstances.find(
        (c) => c.instanceId === enemy2.instanceId
      )?.zone
    ).toBe("trash");
    // adversarial verifier round2: X09 が実際にコアシュートしていない無関係な相手カードが
    // 同じ SBA パスに偶然混入しても、eligibleInstanceIds 絞り込みにより preventStayOnField を
    // 誤って得ず、自身の stay_on_field 反応どおり field に残る。
    expect(
      afterDeparture.cardInstances.find(
        (c) => c.instanceId === unrelatedDeficitEnemy.instanceId
      )?.zone
    ).toBe("field");
    // wrapper が呼び出し全体の完了時にクリアし切っていること (無関係な後続 SBA への漏洩防止)。
    expect(
      afterDeparture.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds?.includes(
        src.instanceId
      )
    ).not.toBe(true);
  });
});
