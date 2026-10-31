/**
 * P3-100 star_garment: S3 host effect aggregation for general triggered effects.
 *
 * A star_garment under-card's B-face card_event/game_event effects are emitted
 * by the host, while the provider definition remains the under-card B face.
 */
import { describe, expect, it } from "vitest";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { runActionMainResolution } from "../src/effect/effect-resolution";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const HOST_DEF = {
  underCardSlots: [
    { roleTag: "星霊衣", maxCount: 1 },
    { roleTag: "バレットエディット", maxCount: 1 },
  ],
  cardNo: "SG-TRIGGER-HOST",
  name: "星霊衣 host",
  printedCategory: "spirit",
  printedColors: ["blue"],
  colors: ["blue"],
  symbolColors: ["blue"],
  printedCost: 2,
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  textLines: [],
  images: {},
} as CardDefinition;

const UNDER_DEF = {
  cardNo: "SG-TRIGGER-UNDER",
  name: "星霊衣 provider",
  printedCategory: "spirit",
  printedColors: ["blue"],
  colors: ["blue"],
  symbolColors: ["blue"],
  printedCost: 4,
  cost: 4,
  tribe: "星霊",
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
    "“『このスピリットの回復時』カウント+1する。”",
    "",
    "Lv1-Lv2『このスピリットの転醒時』",
    "カウント+1する。",
    "“『このスピリットの疲労時』カウント+1する。”",
    "“このスピリットが効果の対象になったとき、この効果の対象になったスピリットすべてからコア1個ずつをリザーブに置く。”",
  ],
  images: {},
  keywordTags: ["star_garment"],
  effects: [
    {
      timing: { kind: "card_event", event: "recover" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [0, 1],
    },
    {
      timing: { kind: "card_event", event: "rebirth" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [3, 4],
    },
    {
      timing: { kind: "card_event", event: "exhaust" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [0, 5],
    },
    {
      timing: { kind: "game_event", player: "self", event: "targeted" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trigger_related_instances" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0, 6],
    },
  ],
} as CardDefinition;

const HOST_LV2_DEF = {
  ...HOST_DEF,
  cardNo: "SG-TRIGGER-HOST-LV2",
  name: "星霊衣 host Lv2",
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 2000 },
    { level: 2, requiredCores: 2, bp: 4000 },
  ],
} as CardDefinition;

const UNDER_HOST_LEVEL_GATED_DEF = {
  ...UNDER_DEF,
  cardNo: "SG-TRIGGER-UNDER-HOST-LV2",
  name: "星霊衣 provider host Lv2 gated",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
    "“Lv2『このスピリットの回復時』カウント+1する。”",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "recover" },
      applicability: { level: { min: 2 } },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [0, 1],
    },
  ],
} as CardDefinition;

const NEXUS_DEF = {
  cardNo: "SG-TRIGGER-NEXUS",
  name: "prevention source nexus",
  printedCategory: "nexus",
  printedColors: ["blue"],
  colors: ["blue"],
  symbolColors: ["blue"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  textLines: [],
  images: {},
} as CardDefinition;

const UNDER_TARGET_DEF = {
  cardNo: "SG-TRIGGER-UNDER-TARGET",
  name: "星霊衣 provider target acquisition",
  printedCategory: "spirit",
  printedColors: ["blue"],
  colors: ["blue"],
  symbolColors: ["blue"],
  printedCost: 4,
  cost: 4,
  tribe: "星霊",
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
    "“このスピリットが効果の対象になったとき、相手のスピリット1体を疲労させる。”",
  ],
  images: {},
  keywordTags: ["star_garment"],
  effects: [
    {
      timing: { kind: "game_event", player: "self", event: "targeted" },
      steps: [
        {
          action: {
            kind: "exhaust",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
} as CardDefinition;

const MAGIC_DEF = {
  cardNo: "SG-TRIGGER-MAGIC",
  name: "星霊衣 targeting probe magic",
  printedCategory: "magic",
  printedColors: ["blue"],
  colors: ["blue"],
  symbolColors: [],
  printedCost: 4,
  cost: 4,
  reductionSymbols: [],
  levelDefs: [],
  textLines: ["相手のスピリット1体を対象にする。"],
  images: {},
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
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

const defs = new Map(
  expandCardDefinitionsWithBackFaces([
    HOST_DEF,
    HOST_LV2_DEF,
    UNDER_DEF,
    UNDER_HOST_LEVEL_GATED_DEF,
    NEXUS_DEF,
    UNDER_TARGET_DEF,
    MAGIC_DEF,
  ]).map((def) => [def.cardNo, def])
);
const getDef = (id: string): CardDefinition | undefined => defs.get(id);
const triggeredLookup = buildTriggeredEffectLookup([...defs.values()]);
const emptyFieldLookup = () => undefined;
const emptyBurstLookup = () => [];

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

  const ally = createCardInstance(HOST_DEF, {
    instanceId: "ally-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const magic = createCardInstance(MAGIC_DEF, {
    instanceId: "magic-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "in_use",
    normalCoreCount: 0,
  });

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, under, ally, magic],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "main",
  };
}

function withSoulStateHost(state: GameState, hostId = "host-1"): GameState {
  return {
    ...state,
    cardInstances: state.cardInstances.map((card) =>
      card.instanceId === hostId ? { ...card, normalCoreCount: 0 } : card
    ),
    players: state.players.map((player) =>
      player.id === ALICE
        ? {
            ...player,
            soulStateInstanceIds: [
              ...new Set([...player.soulStateInstanceIds, hostId]),
            ],
          }
        : player
    ),
  };
}

function recoverPending(relatedInstanceId: string): PendingTriggeredEffect {
  return {
    pendingId: `recover:${relatedInstanceId}`,
    actingPlayerId: ALICE,
    eventKind: "recover",
    source: "action_resolution",
    chainId: "chain:recover",
    attackId: null,
    relatedPlayerId: ALICE,
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "main",
    resolvedSourceInstanceIds: [],
  };
}

function rebirthPending(relatedInstanceId: string): PendingTriggeredEffect {
  return {
    pendingId: `rebirth:${relatedInstanceId}`,
    actingPlayerId: ALICE,
    eventKind: "rebirth",
    source: "action_resolution",
    chainId: "chain:rebirth",
    attackId: null,
    relatedPlayerId: ALICE,
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "main",
    resolvedSourceInstanceIds: [],
  };
}

function exhaustEvent(relatedInstanceId: string): CollectedTriggerEvent {
  return {
    eventKind: "exhaust",
    source: "action_resolution",
    chainId: `chain:exhaust:${relatedInstanceId}`,
    actingPlayerId: ALICE,
    relatedPlayerId: ALICE,
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "main",
    attackId: null,
  };
}

function targetedEvent(relatedInstanceId: string): CollectedTriggerEvent {
  return {
    eventKind: "targeted",
    source: "action_resolution",
    chainId: "chain:targeted",
    actingPlayerId: ALICE,
    relatedPlayerId: ALICE,
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "main",
    attackId: null,
    effectSourceInstanceId: "opponent-effect-1",
    effectSourceDefinitionId: "OPPONENT-MAGIC",
    effectActionKind: "magic",
  };
}

function sourcePreventionGrantCE(state: GameState): ContinuousEffect {
  return {
    effectId: "test-source-prevention-grant",
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
      appliesTo: ["prevention", "stack_negate"],
      preventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus"] },
      },
    },
  };
}

function drainStackWindows(state: GameState): GameState {
  let next = state;
  let safety = 20;
  while (safety-- > 0) {
    const action = [ALICE, BOB]
      .flatMap((playerId) =>
        getLegalActions({
          state: next,
          actingPlayerId: playerId,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredFieldCardEffectActions: emptyFieldLookup,
        })
      )
      .find((candidate) => candidate.kind === "pass_stack");
    if (!action) return next;
    next = applyLegalAction({
      state: next,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).state;
  }
  throw new Error("stack drain did not converge");
}

const BULLET_EDIT_UNDER_DEF = {
  ...UNDER_DEF,
  cardNo: "SG-TRIGGER-BULLET-EDIT-UNDER",
  name: "バレットエディット provider",
  textLines: [
    "（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
    "“『このスピリットの回復時』カウント+1する。”",
    "",
    "Lv1-Lv2『このスピリットの転醒時』",
    "カウント+1する。",
    "“『このスピリットの疲労時』カウント+1する。”",
    "“このスピリットが効果の対象になったとき、この効果の対象になったスピリットすべてからコア1個ずつをリザーブに置く。”",
  ],
  keywordTags: [],
} as CardDefinition;

const bulletEditDefs = new Map(
  expandCardDefinitionsWithBackFaces([
    HOST_DEF,
    BULLET_EDIT_UNDER_DEF,
    MAGIC_DEF,
  ]).map((def) => [def.cardNo, def])
);
const getBulletEditDef = (id: string): CardDefinition | undefined =>
  bulletEditDefs.get(id);
const bulletEditTriggeredLookup = buildTriggeredEffectLookup([
  ...bulletEditDefs.values(),
]);

function makeBulletEditState(): GameState {
  const host = createCardInstance(HOST_DEF, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  host.underCards = [
    {
      cardInstanceId: "under-1",
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];

  const under = createCardInstance(BULLET_EDIT_UNDER_DEF, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "host-1";

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, under],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "main",
  };
}

describe("P3-111 bullet_edit: text_role under-card triggered host aggregation (roleTag 不問 regression)", () => {
  it("keeps opt-in exhaust events when the host only has a roleTag:バレットエディット (non-星霊衣) under-card listener", () => {
    const queued = queuePendingReactionsFromTriggerEvents(
      makeBulletEditState(),
      [exhaustEvent("host-1")],
      undefined,
      {
        getCardDefinitionById: getBulletEditDef,
        getRegisteredTriggeredEffectActions: bulletEditTriggeredLookup,
        getRegisteredBurstActions: undefined,
      }
    );

    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: queued.pendingTriggeredEffects[0]!,
      getCardDefinitionById: getBulletEditDef,
      getRegisteredTriggeredEffectActions: bulletEditTriggeredLookup,
    });
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      sourceCard: { instanceId: "host-1" },
      sourceEffectInstanceId: "under-1",
      sourceEffectDefinitionId: "SG-TRIGGER-BULLET-EDIT-UNDER",
    });
  });

  it("does not expose a bullet_edit under-card triggered source when the host is soul state", () => {
    const state = {
      ...withSoulStateHost(makeBulletEditState()),
      pendingTriggeredEffects: [recoverPending("host-1")],
    };

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: state.pendingTriggeredEffects[0]!,
      getCardDefinitionById: getBulletEditDef,
      getRegisteredTriggeredEffectActions: bulletEditTriggeredLookup,
    });

    expect(choices).toHaveLength(0);
  });
});

describe("P3-100 star_garment: general triggered host aggregation", () => {
  it("evaluates text_role_under triggered applicability on the host, not the under-card", () => {
    const host = createCardInstance(HOST_LV2_DEF, {
      instanceId: "host-lv2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    host.underCards = [
      { cardInstanceId: "under-lv-gate", role: "text_role", roleTag: "星霊衣" },
    ];
    const under = createCardInstance(UNDER_HOST_LEVEL_GATED_DEF, {
      instanceId: "under-lv-gate",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = host.instanceId;
    under.zoneRoleName = "star-garment";
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, under],
      }),
      pendingTriggeredEffects: [recoverPending(host.instanceId)],
    };

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: state.pendingTriggeredEffects[0]!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      sourceCard: { instanceId: "host-lv2" },
      sourceDefinition: { cardNo: HOST_LV2_DEF.cardNo },
      sourceEffectInstanceId: "under-lv-gate",
      sourceEffectDefinitionId: UNDER_HOST_LEVEL_GATED_DEF.cardNo,
    });
  });

  it("queues and resolves a B-face card_event effect from the host source", () => {
    const queued = {
      ...makeState(),
      pendingTriggeredEffects: [recoverPending("host-1")],
    };

    const action = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_triggered_effect"
    );

    expect(action).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      sourceInstanceId: "host-1",
      sourceDefinitionId: "SG-TRIGGER-HOST",
      sourceEffectInstanceId: "under-1",
      sourceEffectDefinitionId: "SG-TRIGGER-UNDER",
      sourceCardNo: "SG-TRIGGER-UNDER",
    });
    if (!action || action.kind !== "resolve_pending_triggered_effect") {
      throw new Error("missing resolve_pending_triggered_effect action");
    }

    const declared = applyLegalAction({
      state: queued,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).state;
    const resolved = drainStackWindows(declared);

    expect(
      resolved.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(1);
    expect(
      resolved.players.find((player) => player.id === BOB)?.countValue
    ).toBe(0);
  });

  it("uses the under-card provider, not the host, for source-prevention immunity on triggered stacks", () => {
    const base = makeState();
    const queued = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
      ],
      pendingTriggeredEffects: [recoverPending("host-1")],
    };

    const action = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_triggered_effect"
    );
    if (!action || action.kind !== "resolve_pending_triggered_effect") {
      throw new Error("missing resolve_pending_triggered_effect action");
    }

    expect(action.sourceInstanceId).toBe("host-1");
    expect(action.sourceEffectInstanceId).toBe("under-1");

    const declared = applyLegalAction({
      state: queued,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).state;

    const pendingStack = declared.stackWindow?.pendingStackAction;
    expect(pendingStack?.cardInstanceId).toBe("host-1");
    expect(pendingStack?.effectSourceInstanceId).toBe("under-1");
    expect(pendingStack?.preventionBypass).toEqual({
      kind: "preventing_effect_filter",
      filter: { categories: ["nexus"] },
    });
    expect(pendingStack?.negatePreventionLevel).toBe("unpreventable");
  });

  it("uses the under-card provider for executeEffect prevention bypass fallback", () => {
    const base = makeState();
    const target = createCardInstance(HOST_DEF, {
      instanceId: "bob-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const protectedState: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, target],
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        {
          effectId: "test-core-min-from-nexus",
          sourceInstanceId: "nexus-preventer",
          sourceDefinitionId: NEXUS_DEF.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "cannot_reduce_cores_below",
          targetInstanceId: target.instanceId,
          metadata: { source: "opponent_effect", coreMinimum: 2 },
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:star-garment-triggered:699",
      state: protectedState,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "host-1",
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: UNDER_DEF.cardNo,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.normalCoreCount
    ).toBe(1);
  });

  it("uses the under-card provider for exhaust target acquisition immunity bypass", () => {
    const base = makeState();
    const target = createCardInstance(HOST_DEF, {
      instanceId: "bob-exhaust-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const protectedState: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, target],
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        {
          effectId: "test-exhaust-immunity-from-nexus",
          sourceInstanceId: "nexus-preventer",
          sourceDefinitionId: NEXUS_DEF.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
          metadata: { source: "opponent_effect" },
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:star-garment-triggered:765",
      state: protectedState,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "exhaust",
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
      sourceInstanceId: "host-1",
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: UNDER_DEF.cardNo,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("uses the under-card provider for leave target acquisition immunity bypass", () => {
    const base = makeState();
    const target = createCardInstance(HOST_DEF, {
      instanceId: "bob-bounce-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const protectedState: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, target],
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        {
          effectId: "test-leave-immunity-from-nexus",
          sourceInstanceId: "nexus-preventer",
          sourceDefinitionId: NEXUS_DEF.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
          metadata: { source: "opponent_effect" },
        },
      ],
    };

    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:star-garment-triggered:828",
        state: protectedState,
        effect: {
          timing: { kind: "activated", mode: "flash" },
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
        },
        sourceInstanceId: "host-1",
        effectSourceInstanceId: "under-1",
        effectSourceDefinitionId: UNDER_DEF.cardNo,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }),
      getDef
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.zone
    ).toBe("hand");
  });

  it("matches source-prevention bypass filters against effective preventing-source category", () => {
    const base = makeState();
    const target = createCardInstance(HOST_DEF, {
      instanceId: "bob-effect-immune-by-effective-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const preventingSource = createCardInstance(HOST_DEF, {
      instanceId: "preventing-source-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const protectedState: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, target, preventingSource],
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        {
          effectId: "test-preventing-source-as-nexus",
          sourceInstanceId: "preventing-source-spirit",
          sourceDefinitionId: HOST_DEF.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "preventing-source-spirit",
          metadata: { properties: { treatAsCategory: "nexus" } },
        },
        {
          effectId: "test-effect-immunity-from-effective-nexus",
          sourceInstanceId: "preventing-source-spirit",
          sourceDefinitionId: HOST_DEF.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
          metadata: { source: "opponent_effect" },
        },
      ],
    };

    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:star-garment-triggered:912",
        state: protectedState,
        effect: {
          timing: { kind: "activated", mode: "flash" },
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
        },
        sourceInstanceId: "host-1",
        effectSourceInstanceId: "under-1",
        effectSourceDefinitionId: UNDER_DEF.cardNo,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }),
      getDef
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.zone
    ).toBe("hand");
  });

  it("preserves the under-card provider prevention bypass across life-core selection pending", () => {
    const base = makeState();
    const pendingSourceState: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === ALICE
          ? {
              ...player,
              lifeNormalCoreCount: 2,
              soulCoreLocation: { kind: "life" },
            }
          : player
      ),
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
      ],
    };

    const after = executeEffect({
      chainId: "test:star-garment-triggered:965",
      state: pendingSourceState,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "host-1",
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: UNDER_DEF.cardNo,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(after.pendingLifeCoreSelection?.sourceInstanceId).toBe("host-1");
    expect(after.pendingLifeCoreSelection?.sourcePreventionBypass).toEqual({
      kind: "preventing_effect_filter",
      filter: { categories: ["nexus"] },
    });
  });

  it("does not expose the B-face card_event from the under-card itself", () => {
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: makeState(),
      pendingEffect: recoverPending("under-1"),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(choices).toEqual([]);
  });

  it("does not expose non-star-garment B-face card_event effects through the host", () => {
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: makeState(),
      pendingEffect: rebirthPending("host-1"),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(choices).toEqual([]);
  });

  it("keeps opt-in exhaust events when the host only has a star_garment under-card listener", () => {
    const queued = queuePendingReactionsFromTriggerEvents(
      makeState(),
      [exhaustEvent("host-1")],
      undefined,
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: undefined,
      }
    );

    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: queued.pendingTriggeredEffects[0]!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      sourceCard: { instanceId: "host-1" },
      sourceEffectInstanceId: "under-1",
      sourceEffectDefinitionId: "SG-TRIGGER-UNDER",
    });
  });

  it("keys targeted related-instance aggregation by the under-card provider", () => {
    const queued = queuePendingReactionsFromTriggerEvents(
      makeState(),
      [targetedEvent("host-1"), targetedEvent("ally-1")],
      undefined,
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: undefined,
      }
    );

    const pending = queued.pendingTriggeredEffects.find(
      (candidate) => candidate.relatedInstanceId === "host-1"
    );
    expect(pending).toBeDefined();
    if (!pending) throw new Error("missing targeted pending");

    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(pending.relatedInstanceIds).toEqual(["host-1", "ally-1"]);
    expect(pending.relatedInstanceIdsBySourceRegistrationKey).toEqual({
      "under-1#3": ["host-1", "ally-1"],
    });
    expect(
      pending.relatedInstanceIdsBySourceRegistrationKey
    ).not.toHaveProperty("host-1#3");
  });

  it("uses the under-card provider for triggered target candidate affect-immunity bypass", () => {
    const base = makeState();
    const targetHost = createCardInstance(HOST_DEF, {
      instanceId: "target-host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    targetHost.underCards = [
      {
        cardInstanceId: "under-target-1",
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    const underTarget = createCardInstance(UNDER_TARGET_DEF, {
      instanceId: "under-target-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    underTarget.attachedToInstanceId = "target-host-1";
    underTarget.zoneRoleName = "star-garment";
    const bobCandidate = createCardInstance(HOST_DEF, {
      instanceId: "bob-trigger-candidate",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const protectedState: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        targetHost,
        underTarget,
        bobCandidate,
      ],
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        {
          effectId: "test-triggered-effect-immunity-from-nexus",
          sourceInstanceId: "nexus-preventer",
          sourceDefinitionId: NEXUS_DEF.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: "bob-trigger-candidate",
          metadata: { source: "opponent_effect" },
        },
      ],
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      protectedState,
      [targetedEvent("target-host-1")],
      undefined,
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: undefined,
      }
    );

    const responderAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: emptyBurstLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "target-host-1" &&
        candidate.sourceEffectInstanceId === "under-target-1" &&
        candidate.sourceEffectDefinitionId === UNDER_TARGET_DEF.cardNo
    );

    expect(responderAction).toBeDefined();
    expect(responderAction).toMatchObject({
      candidateTargetInstanceIds: ["bob-trigger-candidate"],
    });
  });

  it("queues targeted disclosure for a B-face targeted responder through the host", () => {
    const state: GameState = {
      ...makeState(),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:star-garment-structured",
        actingPlayerId: BOB,
        sourceInstanceId: "magic-1",
        sourceDefinitionId: MAGIC_DEF.cardNo,
        deferredStack: {
          stackId: "stack:star-garment-structured",
          actionKind: "magic",
          chainId: "chain:star-garment-structured",
          actingPlayerId: BOB,
          cardInstanceId: "magic-1",
          cardDefinitionId: MAGIC_DEF.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["host-1"],
        targetEffectFilterTags: [],
      },
    };

    const action = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: emptyBurstLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(action).toBeDefined();

    const afterDisclosure = applyLegalAction({
      state,
      action: action!,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: emptyBurstLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).state;

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        sourceInstanceId: "magic-1",
        sourceDefinitionId: MAGIC_DEF.cardNo,
        targetInstanceIds: ["host-1"],
      }
    );
    expect(afterDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(afterDisclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: "host-1",
      effectSourceInstanceId: "magic-1",
      effectSourceDefinitionId: MAGIC_DEF.cardNo,
    });
    const responderAction = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: emptyBurstLookup,
      getRegisteredFieldCardEffectActions: emptyFieldLookup,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "host-1" &&
        candidate.sourceEffectInstanceId === "under-1" &&
        candidate.sourceEffectDefinitionId === UNDER_DEF.cardNo
    );
    expect(responderAction).toBeDefined();
  });

  it("queues hand-written targeted disclosure using the B-face provider definition", () => {
    const state: GameState = {
      ...makeState(),
      activePlayerId: BOB,
      step: "attack",
    };
    const host = state.cardInstances.find(
      (card) => card.instanceId === "host-1"
    )!;
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === UNDER_DEF.cardNo
        ? (current: GameState) => ({
            ...current,
            log: [...current.log, "hand-written:star-garment-provider"],
          })
        : undefined;

    const afterDisclosure = runActionMainResolution({
      state,
      chainId: "chain:star-garment-hand-written",
      startLogs: ["hand-written:start"],
      endLogs: ["hand-written:end"],
      context: {
        chainId: "chain:star-garment-hand-written",
        resolutionKind: "pending_triggered_effect",
        actingPlayerId: BOB,
        sourceKind: "field",
        sourceCard: host,
        sourceDefinition: HOST_DEF,
        effectSourceInstanceId: "under-1",
        effectSourceDefinitionId: UNDER_DEF.cardNo,
        effectSourceDefinition: UNDER_DEF,
        targetInstanceIds: ["host-1"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: emptyBurstLookup,
        effectActionKind: "triggered_effect",
      },
      getHandWrittenEffectResolver,
    });

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        sourceInstanceId: "host-1",
        effectSourceInstanceId: "under-1",
        effectSourceDefinitionId: UNDER_DEF.cardNo,
        targetInstanceIds: ["host-1"],
      }
    );
    expect(afterDisclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(afterDisclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: "host-1",
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: UNDER_DEF.cardNo,
    });
  });
});
