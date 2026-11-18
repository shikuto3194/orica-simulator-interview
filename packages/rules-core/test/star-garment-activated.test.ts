/**
 * P3-100 星霊衣 star_garment — S3 host 効果集約の activated slice。
 *
 * BSFT01-TR06(B) の「【星霊衣】でスピリット下にあるこのカード」のフラッシュ効果は、
 * under-card 自身ではなく host の「このスピリット」効果として発揮する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { getAvailableFieldCardEffectLegalActions } from "../src/legal/legal-actions-availability";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition, ContinuousEffect, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const defs = new Map(expanded.map((def) => [def.cardNo, def]));
const getDef = (id: string): CardDefinition | undefined => defs.get(id);
const fieldLookup = buildFieldCardEffectLookup(expanded);
const battleLookup = buildBattleImmediateEffectLookup(expanded);
const triggeredLookup = buildTriggeredEffectLookup(expanded);

function card(cardNo: string): CardDefinition {
  const def = getDef(cardNo);
  if (!def) throw new Error(`missing test card: ${cardNo}`);
  return def;
}

const TARGETED_RESPONDER_DEF = {
  cardNo: "SG-ACTIVATED-TARGETED-RESPONDER",
  name: "activated star garment targeted responder",
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
        triggerSourceFilter: {
          cardName: { exact: card("BSFT01-TR06(B)").name },
        },
      },
      executionMode: "optional",
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
} as CardDefinition;

defs.set(TARGETED_RESPONDER_DEF.cardNo, TARGETED_RESPONDER_DEF);

const NORMAL_TEXT_ROLE_UNDER_DEF = {
  cardNo: "SG-ACTIVATED-NORMAL-UNDER",
  name: "normal text-role under activated source",
  printedCategory: "spirit",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: ["フラッシュ：自分はデッキから1枚ドローする。"],
  images: {},
  colors: ["red"],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      textRef: [0],
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
} as CardDefinition;

const STACK_TEXT_ROLE_UNDER_DEF = {
  cardNo: "SG-ACTIVATED-STACK-UNDER",
  name: "star garment under stack provider",
  printedCategory: "spirit",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [
    "【星霊衣】でスピリットの下にあるこのカードは、スタック：自分はデッキから1枚ドローする。",
  ],
  images: {},
  colors: ["red"],
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      textRef: [0],
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
} as CardDefinition;

const BULLET_EDIT_STACK_UNDER_DEF = {
  ...STACK_TEXT_ROLE_UNDER_DEF,
  cardNo: "SG-ACTIVATED-BULLET-EDIT-STACK-UNDER",
  name: "bullet edit under stack provider",
  textLines: [
    "【バレットエディット】でスピリットの下にあるこのカードは、スタック：自分はデッキから1枚ドローする。",
  ],
} as CardDefinition;

defs.set(NORMAL_TEXT_ROLE_UNDER_DEF.cardNo, NORMAL_TEXT_ROLE_UNDER_DEF);
defs.set(STACK_TEXT_ROLE_UNDER_DEF.cardNo, STACK_TEXT_ROLE_UNDER_DEF);
defs.set(BULLET_EDIT_STACK_UNDER_DEF.cardNo, BULLET_EDIT_STACK_UNDER_DEF);

const targetedTriggeredLookup = buildTriggeredEffectLookup([
  ...expanded,
  TARGETED_RESPONDER_DEF,
]);

const customUnderFieldLookup = buildFieldCardEffectLookup([
  ...expanded,
  NORMAL_TEXT_ROLE_UNDER_DEF,
  STACK_TEXT_ROLE_UNDER_DEF,
  BULLET_EDIT_STACK_UNDER_DEF,
]);

function makeFlashState(): GameState {
  const hostDef = card("BSFT01-CX01");
  const underDef = card("BSFT01-TR06(B)");

  const host = createCardInstance(hostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  host.underCards = [
    { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
  ];

  const under = createCardInstance(underDef, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "host-1";
  under.zoneRoleName = "star-garment";

  const enemy = createCardInstance(hostDef, {
    instanceId: "enemy-1",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "recovered",
  });

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, under, enemy],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    }),
    step: "attack",
    window: "flash_before_block",
    activePlayerId: ALICE,
    turnNumber: 2,
    activeAttack: {
      attackId: "attack-1",
      primaryEntityId: "battle-entity:attacker",
      participantEntityIds: ["battle-entity:attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [],
      symbolResolutionOrder: ["battle-entity:attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    },
  };
}

function sourcePreventionGrantCE(state: GameState): ContinuousEffect {
  return {
    effectId: "ce-star-garment-activated-source-prevention",
    sourceInstanceId: "host-1",
    sourceDefinitionId: "BSFT01-TR01(A)",
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
    effectId: `ce-star-garment-activated-defense-immune-${targetInstanceId}`,
    sourceInstanceId: "nexus-preventer",
    sourceDefinitionId: "BSFT01-C03",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
  };
}

function defenseImmuneFromGreenSourceCE(
  targetInstanceId: string,
  state: GameState
): ContinuousEffect {
  return {
    effectId: `ce-star-garment-activated-defense-immune-green-${targetInstanceId}`,
    sourceInstanceId: "green-source-preventer",
    sourceDefinitionId: "BSFT01-C03",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
    immunitySourceScope: { colors: ["green"] },
  };
}

function makeCustomUnderState(
  underDef: CardDefinition,
  underInstanceId: string,
  roleTag = "星霊衣",
  zoneRoleName = "star-garment"
): GameState {
  const hostDef = card("BSFT01-CX01");

  const host = createCardInstance(hostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  host.underCards = [
    {
      cardInstanceId: underInstanceId,
      role: "text_role",
      roleTag,
    },
  ];

  const under = createCardInstance(underDef, {
    instanceId: underInstanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "host-1";
  under.zoneRoleName = zoneRoleName;

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, under],
    }),
    step: "attack",
    activePlayerId: ALICE,
    turnNumber: 2,
  };
}

function withSoulStateHost(state: GameState, hostId = "host-1"): GameState {
  return {
    ...state,
    cardInstances: state.cardInstances.map((cardInstance) =>
      cardInstance.instanceId === hostId
        ? { ...cardInstance, normalCoreCount: 0 }
        : cardInstance
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

describe("P3-100 star_garment: activated host aggregation", () => {
  it("BSFT01-TR06(B) under-card flash effect resolves from the host", () => {
    const state = makeFlashState();
    const conditionalCostLookups: Array<{ cardNo: string; stepIndex: number }> =
      [];

    const declaration = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: (cardNo) => {
        const registrations = fieldLookup(cardNo);
        if (cardNo !== "BSFT01-TR06(B)") return registrations;
        return registrations?.map((registration) => ({
          ...registration,
          composition: { kind: "conditional_cost", steps: [{}] },
        }));
      },
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getConditionalCostCanExecuteCheck: (cardNo, stepIndex) => {
        conditionalCostLookups.push({ cardNo, stepIndex });
        return undefined;
      },
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(declaration).toBeDefined();
    expect(conditionalCostLookups).toContainEqual({
      cardNo: "BSFT01-TR06(B)",
      stepIndex: 0,
    });
    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-CX01",
      sourceEffectDefinitionId: "BSFT01-TR06(B)",
      sourceEffectInstanceId: "under-1",
      sourceCardNo: "BSFT01-TR06(B)",
      timing: "flash",
      requiredTargetCount: 1,
      candidateTargetInstanceIds: ["enemy-1"],
    });

    const declared = applyLegalAction({
      state,
      action: declaration!,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;

    expect(
      declared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({
      actionKind: "field_card_effect",
      cardInstanceId: "host-1",
      cardDefinitionId: "BSFT01-CX01",
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: "BSFT01-TR06(B)",
    });

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );

    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");

    expect(targetSelection).toBeDefined();

    const resolved = applyLegalAction({
      state: afterPass,
      action: targetSelection!,
      targetInstanceIds: ["enemy-1"],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "enemy-1")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      resolved.players.find((player) => player.id === ALICE)
    ).toMatchObject({
      reserveNormalCoreCount: 0,
      trashNormalCoreCount: 1,
    });

    const secondAttemptState = {
      ...resolved,
      players: resolved.players.map((player) =>
        player.id === ALICE
          ? {
              ...player,
              reserveNormalCoreCount: 1,
              trashNormalCoreCount: 0,
            }
          : player
      ),
      cardInstances: resolved.cardInstances.map((card) =>
        card.instanceId === "enemy-1"
          ? { ...card, exhaustState: "recovered" as const }
          : card
      ),
    };
    const secondUse = getLegalActions({
      state: secondAttemptState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(secondUse).toBeUndefined();
  });

  it("uses the provider under-card for source-prevention bypass in field availability candidates", () => {
    const base = makeFlashState();
    const protectedState: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        sourcePreventionGrantCE(base),
        defenseImmuneFromNexusCE("enemy-1", base),
      ],
    };

    const declaration = getLegalActions({
      state: protectedState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceEffectInstanceId: "under-1",
      candidateTargetInstanceIds: ["enemy-1"],
    });
  });

  it("excludes targets immune to the provider under-card source from field availability", () => {
    const base = makeFlashState();
    const protectedState: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        defenseImmuneFromGreenSourceCE("enemy-1", base),
      ],
    };

    const declaration = getLegalActions({
      state: protectedState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(declaration).toBeUndefined();
  });

  it("keeps BSFT01-TR06(B) as the effect source through targeted disclosure", () => {
    const responder = createCardInstance(TARGETED_RESPONDER_DEF, {
      instanceId: "responder-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = makeFlashState();
    const state: GameState = {
      ...baseState,
      cardInstances: [...baseState.cardInstances, responder],
    };

    const declaration = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration!,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
    }).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );

    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");

    expect(targetSelection).toBeDefined();

    const disclosed = applyLegalAction({
      state: afterPass,
      action: targetSelection!,
      targetInstanceIds: ["enemy-1"],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;

    expect(disclosed.pendingTriggeredEffects).toHaveLength(1);
    expect(disclosed.pendingTriggeredEffects[0]).toMatchObject({
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: "BSFT01-TR06(B)",
    });
    expect(disclosed.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "BSFT01-TR06(B)",
      effectSourceInstanceId: "under-1",
      effectSourceDefinitionId: "BSFT01-TR06(B)",
      targetInstanceIds: ["enemy-1"],
    });

    let resolved = disclosed;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (resolved.pendingTargetedDisclosureContinuation === null) break;
      const skipResponder = getLegalActions({
        state: resolved,
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
        getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
      }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "responder-1"
      );

      expect(skipResponder).toBeDefined();

      resolved = applyLegalAction({
        state: resolved,
        action: skipResponder!,
        skipOptionalEffect: true,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions: targetedTriggeredLookup,
        getRegisteredBurstActions: () => [],
        getRegisteredBattleImmediateEffectActions: battleLookup,
      }).state;
    }

    expect(resolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "enemy-1"
      )?.exhaustState
    ).toBe("exhausted");
  });

  it("fizzles if BSFT01-TR06(B) leaves the star_garment under-card slot before resolution", () => {
    const state = makeFlashState();

    const declaration = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration!,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;
    const staleDeclared: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? {
              ...cardInstance,
              underCards: cardInstance.underCards.filter(
                (underCard) => underCard.cardInstanceId !== "under-1"
              ),
            }
          : cardInstance.instanceId === "under-1"
            ? {
                ...cardInstance,
                zone: "trash",
                attachedToInstanceId: null,
              }
            : cardInstance
      ),
    };

    const pass = getLegalActions({
      state: staleDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );

    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: staleDeclared,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");

    expect(targetSelection).toBeUndefined();
    expect(afterPass.log).toContainEqual(
      expect.stringContaining("effect-source-not-star-garment-under")
    );
    expect(
      afterPass.cardInstances.find((card) => card.instanceId === "enemy-1")
        ?.exhaustState
    ).toBe("recovered");
  });

  it("fizzles if the host is face-down before the star_garment flash effect resolves", () => {
    const state = makeFlashState();

    const declaration = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectDefinitionId === "BSFT01-TR06(B)"
    );

    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration!,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;
    const faceDownHostDeclared: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? { ...cardInstance, faceDown: true }
          : cardInstance
      ),
    };

    const pass = getLegalActions({
      state: faceDownHostDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );

    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: faceDownHostDeclared,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;

    expect(
      getLegalActions({
        state: afterPass,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).find((action) => action.kind === "resolve_pending_effect_target")
    ).toBeUndefined();
    expect(afterPass.log).toContainEqual(
      expect.stringContaining("effect-source-not-star-garment-under")
    );
    expect(
      afterPass.cardInstances.find((card) => card.instanceId === "enemy-1")
        ?.exhaustState
    ).toBe("recovered");
  });

  it("does not expose the star_garment_under flash effect from the under-card itself", () => {
    const state = makeFlashState();

    const underAction = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "under-1" &&
        action.sourceCardNo === "BSFT01-TR06(B)"
    );

    expect(underAction).toBeUndefined();
  });

  it("does not expose ordinary activated effects from a text_role under-card itself", () => {
    const state = makeCustomUnderState(
      NORMAL_TEXT_ROLE_UNDER_DEF,
      "normal-under-1"
    );

    const underAction = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: customUnderFieldLookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      },
      "flash"
    ).find(
      (action) =>
        action.sourceInstanceId === "normal-under-1" ||
        action.sourceEffectInstanceId === "normal-under-1"
    );

    expect(underAction).toBeUndefined();
  });

  it("does not expose a bullet_edit under-card stack effect when the host is soul state", () => {
    const state = withSoulStateHost(
      makeCustomUnderState(
        BULLET_EDIT_STACK_UNDER_DEF,
        "bullet-under-1",
        "バレットエディット",
        "bullet-edit"
      )
    );

    const underAction = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: customUnderFieldLookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      },
      "stack"
    ).find(
      (action) =>
        action.sourceEffectDefinitionId === BULLET_EDIT_STACK_UNDER_DEF.cardNo
    );

    expect(underAction).toBeUndefined();
  });

  it("uses the provider under-card for effect-source restrict_stack checks", () => {
    const base = makeCustomUnderState(
      STACK_TEXT_ROLE_UNDER_DEF,
      "stack-under-1"
    );
    const unrestricted = getAvailableFieldCardEffectLegalActions(
      {
        state: base,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: customUnderFieldLookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      },
      "stack"
    ).find(
      (action) =>
        action.sourceEffectDefinitionId === STACK_TEXT_ROLE_UNDER_DEF.cardNo
    );

    expect(unrestricted).toMatchObject({
      sourceInstanceId: "host-1",
      sourceEffectInstanceId: "stack-under-1",
      sourceEffectDefinitionId: STACK_TEXT_ROLE_UNDER_DEF.cardNo,
      timing: "stack",
    });

    const restrictSource = createCardInstance(card("BSES01-M01"), {
      instanceId: "restrict-source-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const ces: ContinuousEffect[] = [
      {
        effectId: "ce:host-immune",
        sourceInstanceId: "host-1",
        sourceDefinitionId: "BSFT01-CX01",
        actingPlayerId: ALICE,
        modifierTag: "defense_immune",
        targetInstanceId: "host-1",
        duration: { scope: "turn" },
        createdAtTurn: base.turnNumber,
        createdAtAttackId: null,
      },
      {
        effectId: "ce:restrict-stack",
        sourceInstanceId: "restrict-source-1",
        sourceDefinitionId: "BSES01-M01",
        actingPlayerId: BOB,
        modifierTag: "restrict_stack",
        targetInstanceId: ALICE,
        duration: { scope: "turn" },
        createdAtTurn: base.turnNumber,
        createdAtAttackId: null,
        metadata: {
          targetScope: "effect_source",
          effectFilter: { timingKind: "activated", activatedMode: "stack" },
        },
      },
    ];
    const restricted: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, restrictSource],
      activeContinuousEffects: [...base.activeContinuousEffects, ...ces],
    };

    const restrictedAction = getAvailableFieldCardEffectLegalActions(
      {
        state: restricted,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: customUnderFieldLookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      },
      "stack"
    ).find(
      (action) =>
        action.sourceEffectDefinitionId === STACK_TEXT_ROLE_UNDER_DEF.cardNo
    );

    expect(restrictedAction).toBeUndefined();
  });
});
