import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { isTrainingResponseWindowClosingAction } from "../src/training-decision-surface";
import {
  applyLegalAction,
  applyTrainingDecisionChoice,
  createCardInstance,
  createActionInputDecisionNode,
  createEmptyGameState,
  getNextTrainingDecision,
  isNovelTrainingProgressState,
  playTrainingGame,
  recomputeAndRebuildContinuousEffects,
  trainingProgressFingerprint,
  type CardDefinition,
  type Engine,
  type TrainingDecisionChoice,
  type TrainingDecisionNode,
  type TrainingPolicy,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardsByNo = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);

function card(cardNo: string): CardDefinition {
  const definition = cardsByNo.get(cardNo);
  if (!definition) throw new Error(`missing fixture card: ${cardNo}`);
  return definition;
}

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardsByNo.get(id);

const C07_SELF_SPIRIT: CardDefinition = {
  cardNo: "TRAINING-C07-SELF-SPIRIT",
  name: "training C07 self spirit",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  tribe: "地球",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const C07_OPPONENT_SPIRIT: CardDefinition = {
  ...C07_SELF_SPIRIT,
  cardNo: "TRAINING-C07-OPPONENT-SPIRIT",
  name: "training C07 opponent spirit",
};

const TRAINING_RESPONSE_NOOP: CardDefinition = {
  ...C07_SELF_SPIRIT,
  cardNo: "TRAINING-RESPONSE-NOOP",
  name: "training response noop",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: { kind: "noop" } }],
    },
  ],
};

const getCardDefinitionByIdWithC07SelfSpirit = (
  id: string
): CardDefinition | undefined =>
  id === C07_SELF_SPIRIT.cardNo
    ? C07_SELF_SPIRIT
    : id === C07_OPPONENT_SPIRIT.cardNo
      ? C07_OPPONENT_SPIRIT
      : getCardDefinitionById(id);

const engine: Engine = {
  cards: ALL_CARDS,
  getCardDefinitionById,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

const c12ReplayEngine: Engine = {
  ...engine,
  cards: [...ALL_CARDS, C07_SELF_SPIRIT, C07_OPPONENT_SPIRIT],
  getCardDefinitionById: getCardDefinitionByIdWithC07SelfSpirit,
  lookups: {
    ...engine.lookups,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
    getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  },
};

const c07ReplayEngine: Engine = {
  ...c12ReplayEngine,
  cards: [...ALL_CARDS, C07_SELF_SPIRIT, C07_OPPONENT_SPIRIT],
  getCardDefinitionById: getCardDefinitionByIdWithC07SelfSpirit,
};

const m02TargetedDisclosureReplayEngine: Engine = {
  ...c07ReplayEngine,
  lookups: {
    ...c07ReplayEngine.lookups,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
    getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  },
};

const targetedDisclosureRootIsolationReplayEngine: Engine = {
  ...m02TargetedDisclosureReplayEngine,
  cards: [...m02TargetedDisclosureReplayEngine.cards, TRAINING_RESPONSE_NOOP],
  getCardDefinitionById: (id) =>
    id === TRAINING_RESPONSE_NOOP.cardNo
      ? TRAINING_RESPONSE_NOOP
      : m02TargetedDisclosureReplayEngine.getCardDefinitionById(id),
  lookups: {
    ...m02TargetedDisclosureReplayEngine.lookups,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
      ...ALL_CARDS,
      TRAINING_RESPONSE_NOOP,
    ]),
  },
};

function combinedBraveState() {
  const host = {
    ...createCardInstance(card("BSSL01-CX01"), {
      instanceId: "host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    }),
    attachedChildrenIds: ["brave"],
  };
  const brave = {
    ...createCardInstance(card("BSSL01-C05"), {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    }),
    attachedToInstanceId: "host",
  };
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, brave],
    }),
    activePlayerId: ALICE,
    step: "main" as const,
  };
}

function declareC12(state: Parameters<typeof getNextTrainingDecision>[0]) {
  const node = getNextTrainingDecision(state, c12ReplayEngine, {
    maxGeneratedChoices: 1024,
  });
  const activate = node?.choices.find(
    (choice) => choice.action?.sourceCardNo === "BSLH01-C12"
  );
  if (!node || !activate?.action)
    throw new Error("C12 declaration unavailable");
  const input = createActionInputDecisionNode(state, activate.action, {
    getCardDefinitionById: c12ReplayEngine.getCardDefinitionById,
  });
  if (!input?.choices[0])
    throw new Error("C12 deferred payment input unavailable");
  return applyTrainingDecisionChoice(
    state,
    input,
    input.choices[0],
    c12ReplayEngine
  );
}

function payC12(state: Parameters<typeof getNextTrainingDecision>[0]) {
  const node = getNextTrainingDecision(state, c12ReplayEngine, {
    maxGeneratedChoices: 1024,
  });
  const payment = node?.choices.find(
    (choice) => choice.action?.kind === "resolve_core_source_allocation"
  );
  if (!payment?.action) throw new Error("C12 payment unavailable");
  const input = createActionInputDecisionNode(state, payment.action, {
    getCardDefinitionById: c12ReplayEngine.getCardDefinitionById,
  });
  const choice = input?.choices.find(
    (candidate) => candidate.applyOptions?.coreSourceAllocations?.c12 === 2
  );
  if (!input || !choice) throw new Error("C12 self payment input unavailable");
  expect(isTrainingResponseWindowClosingAction(state, payment.action)).toBe(
    true
  );
  const paid = applyTrainingDecisionChoice(
    state,
    input,
    choice,
    c12ReplayEngine
  );
  expect(paid.pendingCoreSourceAllocation).toBeNull();
  return paid;
}

function c12ConditionalCostNoOpState() {
  const c12 = createCardInstance(card("BSLH01-C12"), {
    instanceId: "c12",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 3,
    everHadCorePlaced: true,
  });
  const tokens = ["BSLH01-T01", "BSLH01-T02", "BSLH01-T03"].map(
    (cardNo, index) =>
      createCardInstance(card(cardNo), {
        instanceId: `c12-token-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        // Conditional-cost rollback retains this SBA snapshot, so seed the
        // pre-declaration state as the normal in-game state already has it.
        pendingLeaveLvSnapshot: 1,
      })
  );
  const state = recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [c12, ...tokens],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    },
    c12ReplayEngine.getCardDefinitionById
  );
  const declared = declareC12(state);
  const responseNode = getNextTrainingDecision(declared, c12ReplayEngine, {
    maxGeneratedChoices: 1024,
  });
  if (!responseNode?.choices[0]) {
    throw new Error("BSLH01-C12 replay setup has no stack response");
  }
  return payC12(
    applyTrainingDecisionChoice(
      declared,
      responseNode,
      responseNode.choices[0],
      c12ReplayEngine
    )
  );
}

function c07ConditionalCostNoOpFlashState() {
  const c07 = createCardInstance(card("BSAZ01-C07"), {
    instanceId: "c07",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  const aliceSpirit = createCardInstance(C07_SELF_SPIRIT, {
    instanceId: "c07-alice-spirit",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const bobSpirit = createCardInstance(C07_OPPONENT_SPIRIT, {
    instanceId: "c07-bob-spirit",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  return recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [c07, aliceSpirit, bobSpirit],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "flash_before_block" as const,
      battleEntities: [
        {
          entityId: "battle-entity:c07-alice-spirit",
          memberInstanceIds: ["c07-alice-spirit"],
          resolvedBp: 1000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking" as const,
        },
      ],
      activeAttack: {
        attackId:
          "attack-group:training-c07:alice:battle-entity:c07-alice-spirit",
        primaryEntityId: "battle-entity:c07-alice-spirit",
        participantEntityIds: ["battle-entity:c07-alice-spirit"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:c07-alice-spirit",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:c07-alice-spirit"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          // The defending (non-active) player receives the first flash
          // priority. EDH-0025 then has Alice answer Bob's outer declaration
          // with BSTH04-C11 from hand.
          priorityPlayerId: BOB,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: BOB,
          pendingStackAction: null,
        },
      },
      activeContinuousEffects: [
        {
          effectId: "training-c07-opponent-destroy-resistance",
          sourceInstanceId: "c07-bob-spirit",
          sourceDefinitionId: C07_OPPONENT_SPIRIT.cardNo,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 0,
          createdAtAttackId: null,
          modifierTag: "cannot_be_destroyed",
          targetInstanceId: "c07-bob-spirit",
          metadata: { source: "opponent_effect" },
        },
      ],
    },
    c07ReplayEngine.getCardDefinitionById
  );
}

function c11NestedStackReplayState() {
  const base = c07ConditionalCostNoOpFlashState();
  const c11 = createCardInstance(card("BSTH04-C11"), {
    instanceId: "c11-stack-response",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  // Give the otherwise-minimal replay state one remaining card per player.
  // After the asserted attack response drains, the normal turn flow can draw
  // these cards and reach a legitimate deck-out instead of spinning through
  // empty forced turn transitions.
  const aliceDeckCard = createCardInstance(C07_SELF_SPIRIT, {
    instanceId: "c11-alice-deck-card",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const bobDeckCard = createCardInstance(C07_OPPONENT_SPIRIT, {
    instanceId: "c11-bob-deck-card",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "deck",
  });
  return {
    ...base,
    cardInstances: [
      ...base.cardInstances.map((instance) =>
        instance.instanceId === "c07-alice-spirit"
          ? { ...instance, normalCoreCount: 1, everHadCorePlaced: true }
          : instance
      ),
      c11,
      aliceDeckCard,
      bobDeckCard,
    ],
    players: base.players.map((player) =>
      player.id === ALICE
        ? { ...player, deckCount: 1, reserveNormalCoreCount: 3 }
        : { ...player, deckCount: 1 }
    ),
  };
}

function m01DeferredNoOpFlashChoiceState() {
  const base = c07ConditionalCostNoOpFlashState();
  const m01 = createCardInstance(card("BSLH01-M01"), {
    instanceId: "m01-deferred-no-op",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    level: 1,
    normalCoreCount: 1,
    everHadCorePlaced: true,
  });
  const initial = {
    ...base,
    cardInstances: [...base.cardInstances, m01],
  };
  const initialNode = getNextTrainingDecision(initial, c12ReplayEngine, {
    maxGeneratedChoices: 1024,
  });
  const activate = initialNode?.choices.find(
    (choice) => choice.action?.sourceCardNo === "BSLH01-M01"
  );
  if (!initialNode || !activate) {
    throw new Error(
      "BSLH01-M01 flash activation was not available for replay setup"
    );
  }
  const declared = applyTrainingDecisionChoice(
    initial,
    initialNode,
    activate,
    c12ReplayEngine
  );
  const responseNode = getNextTrainingDecision(declared, c12ReplayEngine, {
    maxGeneratedChoices: 1024,
  });
  const stackPass = responseNode?.choices.find(
    (choice) =>
      choice.action?.kind === "pass_battle_flash" &&
      choice.action.responseTiming === "stack"
  );
  if (!responseNode || !stackPass) {
    throw new Error("BSLH01-M01 replay setup has no stack pass");
  }
  const pendingChoice = applyTrainingDecisionChoice(
    declared,
    responseNode,
    stackPass,
    c12ReplayEngine
  );
  const choiceNode = getNextTrainingDecision(pendingChoice, c12ReplayEngine, {
    maxGeneratedChoices: 1024,
  });
  const noOpChoice = choiceNode?.choices.find(
    (choice) =>
      choice.action?.kind === "resolve_pending_step_choice" &&
      choice.action.choiceIndex === 0
  );
  if (!choiceNode || !noOpChoice) {
    throw new Error("BSLH01-M01 replay setup has no deferred no-op choice");
  }
  return {
    initial,
    pendingChoice,
    choiceNode,
    noOpChoice,
    resolved: applyTrainingDecisionChoice(
      pendingChoice,
      choiceNode,
      noOpChoice,
      c12ReplayEngine
    ),
  };
}

function m01TargetedDisclosureFlashState() {
  const base = c07ConditionalCostNoOpFlashState();
  const m01 = createCardInstance(card("BSLH01-M01"), {
    instanceId: "m01-targeted-disclosure",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    level: 1,
    normalCoreCount: 1,
    everHadCorePlaced: true,
  });
  const goku = createCardInstance(card("BSDB01-C01"), {
    instanceId: "m01-targeted-goku",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    everHadCorePlaced: true,
  });
  const piccolo = createCardInstance(card("BSDB01-M02"), {
    instanceId: "m01-targeted-piccolo",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  return {
    ...base,
    cardInstances: [...base.cardInstances, m01, goku, piccolo],
  };
}

function targetedDisclosureRootIsolationState() {
  const base = m01TargetedDisclosureFlashState();
  const noop = createCardInstance(TRAINING_RESPONSE_NOOP, {
    instanceId: "m01-root-isolation-noop",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
    everHadCorePlaced: true,
  });
  return {
    ...base,
    cardInstances: [...base.cardInstances, noop],
  };
}

function yuuBulletEditSwapCycleState() {
  const yuu = createCardInstance(card("BSGE01-CX01"), {
    instanceId: "yuu",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    everHadCorePlaced: true,
  });
  const under = createCardInstance(card("BSSL01-C05"), {
    instanceId: "yuu-under",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const hand = createCardInstance(card("BSSL01-C02"), {
    instanceId: "yuu-hand",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  yuu.underCards = [
    {
      cardInstanceId: under.instanceId,
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];
  under.attachedToInstanceId = yuu.instanceId;
  under.zoneRoleName = "bullet-edit";

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [yuu, under, hand],
      playerOverrides: [{ handCount: 1 }, {}],
    }),
    activePlayerId: ALICE,
    step: "main" as const,
  };
}

function findAction(
  choices: readonly TrainingDecisionChoice[],
  kind: string
): TrainingDecisionChoice | undefined {
  return choices.find((choice) => choice.action?.kind === kind);
}

describe("training progress revisit guard", () => {
  it("EDH-0041: reversible バレットエディット交換の pass 後は同じ起動を選び直さない", () => {
    const preferSwapThenAdvance: TrainingPolicy = (_state, node) =>
      node.choices.find(
        (choice) =>
          choice.action?.kind === "use_field_card_effect" &&
          choice.action.sourceInstanceId === "yuu" &&
          choice.action.registrationIndex === 1
      ) ??
      node.choices.find((choice) => choice.action?.kind === "pass_stack") ??
      node.choices.find(
        (choice) => choice.systemAction?.kind === "advance_step"
      ) ??
      node.choices[0]!;

    const result = playTrainingGame({
      engine: c12ReplayEngine,
      initialState: yuuBulletEditSwapCycleState(),
      maxSteps: 8,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 4,
      policies: {
        [ALICE]: preferSwapThenAdvance,
        [BOB]: preferSwapThenAdvance,
      },
      rng: () => 0,
    });

    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(
      result.trace.some((entry) => entry.systemActionKind === "advance_step")
    ).toBe(true);
  });

  it("drains BSLH01-C12's no-op stack response before advancing", () => {
    const initial = c12ConditionalCostNoOpState();
    const declared = declareC12(initial);
    const responseNode = getNextTrainingDecision(declared, c12ReplayEngine, {
      maxGeneratedChoices: 1024,
    });
    expect(responseNode?.actingPlayerId).toBe(BOB);
    expect(responseNode?.choices).toHaveLength(1);
    expect(responseNode?.choices[0]?.action?.kind).toBe("pass_stack");

    const resolved = payC12(
      applyTrainingDecisionChoice(
        declared,
        responseNode!,
        responseNode!.choices[0]!,
        c12ReplayEngine
      )
    );
    expect(trainingProgressFingerprint(resolved)).toBe(
      trainingProgressFingerprint(initial)
    );

    const preferC12ThenAdvance: TrainingPolicy = (_state, node) =>
      node.choices.find(
        (choice) => choice.applyOptions?.coreSourceAllocations?.c12 === 2
      ) ??
      node.choices.find(
        (choice) => choice.action?.sourceCardNo === "BSLH01-C12"
      ) ??
      node.choices.find((choice) => choice.action?.kind === "pass_stack") ??
      node.choices.find(
        (choice) => choice.systemAction?.kind === "advance_step"
      ) ??
      node.choices[0]!;
    const result = playTrainingGame({
      engine: c12ReplayEngine,
      initialState: initial,
      maxSteps: 3,
      maxForcedTransitions: 100,
      policies: { [ALICE]: preferC12ThenAdvance, [BOB]: preferC12ThenAdvance },
      rng: () => 0,
    });

    expect(result.terminationReason).toBe("decision_limit");
    expect(
      result.trace.some((entry) => entry.actionKind === "pass_stack")
    ).toBe(true);
    expect(
      result.trace.some(
        (entry) => entry.actionKind === "resolve_core_source_allocation"
      )
    ).toBe(true);
    expect(result.finalState.pendingCoreSourceAllocation).toBeNull();
  });

  it("EDH-0025: drains an active-attack nested stack pass instead of advancing", () => {
    const initial = c07ConditionalCostNoOpFlashState();
    const initialNode = getNextTrainingDecision(initial, c07ReplayEngine, {
      maxGeneratedChoices: 1024,
    });
    const initialC07 = initialNode?.choices.find(
      (choice) => choice.action?.sourceCardNo === "BSAZ01-C07"
    );
    expect(initialC07).toBeDefined();
    expect(
      isTrainingResponseWindowClosingAction(initial, initialC07!.action!)
    ).toBe(false);

    const declared = applyLegalAction({
      state: initial,
      action: initialC07!.action!,
      paymentSources: [
        {
          kind: "reserve",
          amount:
            initialC07!.action!.kind === "use_magic"
              ? initialC07!.action!.finalCost
              : 0,
        },
      ],
      getCardDefinitionById: c07ReplayEngine.getCardDefinitionById,
      ...c07ReplayEngine.lookups,
    }).state;
    const responseNode = getNextTrainingDecision(declared, c07ReplayEngine, {
      maxGeneratedChoices: 1024,
    });
    const nestedPass = responseNode?.choices.find(
      (choice) =>
        choice.action?.kind === "pass_battle_flash" &&
        choice.action.responseTiming === "stack"
    );
    expect(nestedPass).toBeDefined();
    expect(
      isTrainingResponseWindowClosingAction(declared, nestedPass!.action!)
    ).toBe(true);

    const resolved = applyTrainingDecisionChoice(
      declared,
      responseNode!,
      nestedPass!,
      c07ReplayEngine
    );
    // EDH-0025 と同じく、アタック中の stack response を閉じると外側の
    // フラッシュ窓へ戻る。ここで pass を再訪として棄却すると、
    // forced-transition fallback が activeAttack を残して advanceStep する。
    expect(resolved.activeAttack).not.toBeNull();
    expect(
      resolved.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });

  it("EDH-0038: drains an outer flash pass even when its state was visited", () => {
    // The production replay reaches this shape after a stack response closes:
    // activeAttack remains, there is no pending stack, and the only safe
    // transition is the outer flash pass. The state itself intentionally has
    // no history field, so this fixture models the equivalent decision shape.
    const initial = c07ConditionalCostNoOpFlashState();
    const flashNode = getNextTrainingDecision(initial, c07ReplayEngine, {
      maxGeneratedChoices: 1024,
    });
    const flashPass = flashNode?.choices.find(
      (choice) =>
        choice.action?.kind === "pass_battle_flash" &&
        choice.action.responseTiming === "flash"
    );
    expect(flashPass).toBeDefined();
    expect(
      isTrainingResponseWindowClosingAction(initial, flashPass!.action!)
    ).toBe(true);

    const afterPass = applyTrainingDecisionChoice(
      initial,
      flashNode!,
      flashPass!,
      c07ReplayEngine
    );
    expect(afterPass.activeAttack?.flashWindowState?.consecutivePassCount).toBe(
      1
    );

    const priorProgressVisits = new Map<string, number>();
    let injectedOuterFlashRevisit = false;
    const policy: TrainingPolicy = (_state, node) =>
      node.choices.find(
        (choice) =>
          choice.action?.kind === "pass_battle_flash" &&
          choice.action.responseTiming === "flash"
      ) ?? node.choices[0]!;
    const result = playTrainingGame({
      engine: c07ReplayEngine,
      initialState: initial,
      initialProgressStateVisits: priorProgressVisits,
      maxSteps: 1,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 5,
      policies: { [ALICE]: policy, [BOB]: policy },
      onBeforeProgressVisitCheck: ({
        stateBeforeTransition,
        nextState,
        action,
      }) => {
        if (
          !injectedOuterFlashRevisit &&
          action?.kind === "pass_battle_flash" &&
          action.responseTiming === "flash" &&
          stateBeforeTransition.activeAttack?.flashWindowState
            ?.pendingStackAction === null
        ) {
          // Simulate the revisit caused by returning from the nested stack.
          // The flash pass must still reach its deterministic close sequence.
          priorProgressVisits.set(trainingProgressFingerprint(nextState), 1);
          injectedOuterFlashRevisit = true;
        }
      },
      rng: () => 0,
    });

    expect(injectedOuterFlashRevisit).toBe(true);
    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(result.lastError ?? "").not.toMatch(
      /advanceStep blocked: activeAttack is in progress/
    );
    expect(
      result.trace.some(
        (entry) =>
          entry.actionKind === "pass_battle_flash" &&
          entry.choiceId === flashPass!.choiceId
      )
    ).toBe(true);
  });

  it("EDH-0006: drains BSLH01-M01's deferred no-op choice before advancing an active attack", () => {
    const { pendingChoice, choiceNode, noOpChoice, resolved } =
      m01DeferredNoOpFlashChoiceState();
    expect(pendingChoice.activeAttack).not.toBeNull();
    expect(pendingChoice.pendingStepChoice?.deferredStack).toBeDefined();
    expect(
      isTrainingResponseWindowClosingAction(pendingChoice, noOpChoice.action!)
    ).toBe(true);

    // The production failure happened when this required branch returned to a
    // previously recorded outer flash state. Recreate that visit precisely:
    // skipping the choice would leave activeAttack open and make the fallback
    // call to advanceStep illegal.
    const priorProgressVisits = new Map<string, number>([
      [trainingProgressFingerprint(resolved), 1],
    ]);
    const policy: TrainingPolicy = (_state, node) =>
      node.choices.find(
        (choice) =>
          choice.action?.kind === "resolve_pending_step_choice" &&
          choice.action.choiceIndex === 0
      ) ?? node.choices[0]!;
    const result = playTrainingGame({
      engine: c12ReplayEngine,
      initialState: pendingChoice,
      initialProgressStateVisits: priorProgressVisits,
      maxSteps: 1,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 4,
      policies: { [ALICE]: policy, [BOB]: policy },
      rng: () => 0,
    });

    expect(choiceNode.actingPlayerId).toBe(BOB);
    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(result.finalState.pendingStepChoice).toBeNull();
    expect(result.finalState.activeAttack).not.toBeNull();
    expect(
      result.trace.some(
        (entry) =>
          entry.actionKind === "resolve_pending_step_choice" &&
          entry.choiceId === noOpChoice.choiceId
      )
    ).toBe(true);
  });

  it("EDH-0006: drains the deferred BSLH01-M01 target selection before advancing an active attack", () => {
    const { resolved: pendingTarget } = m01DeferredNoOpFlashChoiceState();
    const targetNode = getNextTrainingDecision(pendingTarget, c12ReplayEngine, {
      maxGeneratedChoices: 1024,
    });
    const targetAction = targetNode?.choices.find(
      (
        choice
      ): choice is TrainingDecisionChoice & {
        action: Extract<
          NonNullable<TrainingDecisionChoice["action"]>,
          { kind: "resolve_pending_effect_target" }
        >;
      } => choice.action?.kind === "resolve_pending_effect_target"
    )?.action;
    expect(targetAction).toBeDefined();
    expect(
      isTrainingResponseWindowClosingAction(pendingTarget, targetAction!)
    ).toBe(true);

    const selectedTargetId = targetAction!.candidateTargetInstanceIds[0]!;
    const afterTarget = applyLegalAction({
      state: pendingTarget,
      action: targetAction!,
      targetInstanceIds: [selectedTargetId],
      getCardDefinitionById: c12ReplayEngine.getCardDefinitionById,
      ...c12ReplayEngine.lookups,
    }).state;
    const priorProgressVisits = new Map<string, number>([
      [trainingProgressFingerprint(afterTarget), 1],
    ]);
    const result = playTrainingGame({
      engine: c12ReplayEngine,
      initialState: pendingTarget,
      initialProgressStateVisits: priorProgressVisits,
      maxSteps: 1,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 4,
      policies: {
        [ALICE]: (_state, node) => node.choices[0]!,
        [BOB]: (_state, node) => node.choices[0]!,
      },
      rng: () => 0,
    });

    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(result.finalState.pendingEffectTargetSelection).toBeNull();
    expect(result.finalState.activeAttack).not.toBeNull();
    expect(
      result.trace.some(
        (entry) => entry.actionKind === "resolve_pending_effect_target"
      )
    ).toBe(true);
  });

  it("EDH-0006: blocks repeating BSLH01-M01 when its deferred target chain returns to a visited outer flash state", () => {
    const { initial } = m01DeferredNoOpFlashChoiceState();
    const m01SourceInstanceId = "m01-deferred-no-op";
    const priorProgressVisits = new Map<string, number>();
    let injectedDeferredTargetRevisit = false;
    const policy: TrainingPolicy = (_state, node) =>
      node.choices.find(
        (choice) =>
          choice.action?.kind === "use_field_card_effect" &&
          choice.action.sourceInstanceId === m01SourceInstanceId
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "resolve_pending_step_choice" &&
          choice.action.choiceIndex === 0
      ) ??
      node.choices.find(
        (choice) => choice.action?.kind === "pass_battle_flash"
      ) ??
      node.choices[0]!;

    // Simulate the second no-op chain returning to the first chain's outer
    // flash fingerprint immediately before the visit guard observes it. The
    // target resolution must retain the original M01 declaration ID so that
    // M01 is excluded before the policy can select it again.
    const result = playTrainingGame({
      engine: c12ReplayEngine,
      initialState: initial,
      initialProgressStateVisits: priorProgressVisits,
      maxSteps: 4,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 4,
      policies: { [ALICE]: policy, [BOB]: policy },
      onBeforeProgressVisitCheck: ({
        stateBeforeTransition,
        nextState,
        action,
      }) => {
        if (
          !injectedDeferredTargetRevisit &&
          action?.kind === "resolve_pending_effect_target" &&
          stateBeforeTransition.pendingEffectTargetSelection
            ?.sourceInstanceId === m01SourceInstanceId
        ) {
          priorProgressVisits.set(trainingProgressFingerprint(nextState), 1);
          injectedDeferredTargetRevisit = true;
        }
      },
      rng: () => 0,
    });

    const m01Declarations = result.trace.filter(
      (entry) =>
        entry.actionKind === "use_field_card_effect" &&
        entry.actionId?.includes(m01SourceInstanceId)
    );
    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(injectedDeferredTargetRevisit).toBe(true);
    expect(m01Declarations).toHaveLength(1);
    const firstDeclarationIndex = result.trace.findIndex(
      (entry) => entry === m01Declarations[0]
    );
    expect(
      result.trace.findIndex(
        (entry, index) =>
          index > firstDeclarationIndex &&
          entry.actionKind === "pass_battle_flash"
      )
    ).toBeGreaterThan(firstDeclarationIndex);
  });

  it("EDH-0006: retains BSLH01-M01 as a blocked origin across BSDB01-M02 targeted disclosure", () => {
    const m01SourceInstanceId = "m01-targeted-disclosure";
    const gokuInstanceId = "m01-targeted-goku";
    const piccoloInstanceId = "m01-targeted-piccolo";
    const priorProgressVisits = new Map<string, number>();
    let injectedTargetedDisclosureRevisit = false;
    let resolvedTargetedDisclosure = false;
    const policy: TrainingPolicy = (_state, node) =>
      node.choices.find(
        (choice) =>
          choice.action?.kind === "use_field_card_effect" &&
          choice.action.sourceInstanceId === m01SourceInstanceId
      ) ??
      node.choices.find(
        (choice) =>
          choice.applyOptions?.targetInstanceIds?.includes(gokuInstanceId) ===
          true
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "declare_private_triggered_effect" &&
          choice.action.sourceInstanceId === piccoloInstanceId
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "resolve_pending_triggered_effect" &&
          choice.action.sourceInstanceId === piccoloInstanceId
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "resolve_pending_step_choice" &&
          choice.action.sourceInstanceId === m01SourceInstanceId &&
          choice.action.choiceIndex === 1
      ) ??
      node.choices.find(
        (choice) => choice.action?.kind === "resolve_pending_step_choice"
      ) ??
      node.choices.find(
        (choice) => choice.action?.kind === "pass_battle_flash"
      ) ??
      node.choices.find((choice) => choice.action?.kind === "pass_stack") ??
      node.choices[0]!;

    const result = playTrainingGame({
      engine: m02TargetedDisclosureReplayEngine,
      initialState: m01TargetedDisclosureFlashState(),
      initialProgressStateVisits: priorProgressVisits,
      maxSteps: 16,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 4,
      policies: { [ALICE]: policy, [BOB]: policy },
      onBeforeProgressVisitCheck: ({
        stateBeforeTransition,
        nextState,
        action,
      }) => {
        if (
          action?.kind === "resolve_pending_step_choice" &&
          action.actionId.includes(":targeted:")
        ) {
          resolvedTargetedDisclosure = true;
          return;
        }
        if (
          resolvedTargetedDisclosure &&
          !injectedTargetedDisclosureRevisit &&
          action?.kind === "pass_battle_flash" &&
          action.responseTiming === "flash" &&
          stateBeforeTransition.activeAttack !== null
        ) {
          priorProgressVisits.set(trainingProgressFingerprint(nextState), 1);
          injectedTargetedDisclosureRevisit = true;
        }
      },
      rng: () => 0,
    });

    const originalAttackEndIndex = result.trace.findIndex(
      (entry) => entry.actionKind === "end_attack_step"
    );
    const m01DeclarationsInOriginalAttack = result.trace
      .slice(0, originalAttackEndIndex)
      .filter(
        (entry) =>
          entry.actionKind === "use_field_card_effect" &&
          entry.actionId?.includes(m01SourceInstanceId)
      );
    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(injectedTargetedDisclosureRevisit).toBe(true);
    expect(originalAttackEndIndex).toBeGreaterThan(0);
    expect(m01DeclarationsInOriginalAttack).toHaveLength(1);
    expect(
      result.trace.some(
        (entry) =>
          entry.actionKind === "resolve_pending_triggered_effect" &&
          entry.actionId?.includes(piccoloInstanceId)
      )
    ).toBe(true);
  });

  it("EDH-0006: does not block an earlier response root when a later no-op response revisits its own state", () => {
    const m01SourceInstanceId = "m01-targeted-disclosure";
    const gokuInstanceId = "m01-targeted-goku";
    const piccoloInstanceId = "m01-targeted-piccolo";
    const noopSourceInstanceId = "m01-root-isolation-noop";
    let initialM01Declared = false;
    let targetedDisclosureResolved = false;
    let noopDeclarations = 0;
    const policy: TrainingPolicy = (state, node) =>
      node.choices.find(
        (choice) => choice.applyOptions?.coreSourceAllocations?.reserve === 1
      ) ??
      node.choices.find(
        (choice) =>
          choice.applyOptions?.targetInstanceIds?.includes(gokuInstanceId) ===
          true
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "declare_private_triggered_effect" &&
          choice.action.sourceInstanceId === piccoloInstanceId
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "resolve_pending_triggered_effect" &&
          choice.action.sourceInstanceId === piccoloInstanceId
      ) ??
      node.choices.find(
        (choice) =>
          choice.action?.kind === "resolve_pending_step_choice" &&
          choice.action.sourceInstanceId === m01SourceInstanceId &&
          choice.action.choiceIndex === 1
      ) ??
      node.choices.find(
        (choice) => choice.action?.kind === "resolve_pending_step_choice"
      ) ??
      (state.activeAttack?.flashWindowState?.pendingStackAction !== null
        ? node.choices.find(
            (choice) => choice.action?.kind === "pass_battle_flash"
          )
        : undefined) ??
      (!initialM01Declared
        ? node.choices.find(
            (choice) =>
              choice.action?.kind === "use_field_card_effect" &&
              choice.action.sourceInstanceId === m01SourceInstanceId
          )
        : undefined) ??
      (targetedDisclosureResolved && noopDeclarations < 2
        ? node.choices.find(
            (choice) =>
              choice.action?.kind === "use_field_card_effect" &&
              choice.action.sourceInstanceId === noopSourceInstanceId
          )
        : undefined) ??
      (noopDeclarations >= 2
        ? node.choices.find(
            (choice) =>
              choice.action?.kind === "use_field_card_effect" &&
              choice.action.sourceInstanceId === m01SourceInstanceId
          )
        : undefined) ??
      node.choices.find(
        (choice) => choice.action?.kind === "pass_battle_flash"
      ) ??
      node.choices.find((choice) => choice.action?.kind === "pass_stack") ??
      node.choices[0]!;

    const result = playTrainingGame({
      engine: targetedDisclosureRootIsolationReplayEngine,
      initialState: targetedDisclosureRootIsolationState(),
      maxSteps: 16,
      maxForcedTransitions: 100,
      maxRepeatedStateTransitions: 4,
      policies: { [ALICE]: policy, [BOB]: policy },
      onBeforeProgressVisitCheck: ({ action }) => {
        if (
          action?.kind === "use_field_card_effect" &&
          action.sourceInstanceId === m01SourceInstanceId
        ) {
          initialM01Declared = true;
        }
        if (
          action?.kind === "resolve_pending_step_choice" &&
          action.actionId.includes(":targeted:")
        ) {
          targetedDisclosureResolved = true;
        }
        if (
          action?.kind === "use_field_card_effect" &&
          action.sourceInstanceId === noopSourceInstanceId
        ) {
          noopDeclarations += 1;
        }
      },
      rng: () => 0,
    });

    // A corrected paid result can advance this bounded run into another turn.
    // Response-root isolation is scoped to the original attack, not that later
    // turn's independently legal flash effects.
    const originalAttackEndIndex = result.trace.findIndex(
      (entry) => entry.actionKind === "end_attack_step"
    );
    expect(originalAttackEndIndex).toBeGreaterThan(0);
    const actionEntriesFor = (sourceInstanceId: string) =>
      result.trace
        .slice(0, originalAttackEndIndex)
        .filter(
          (entry) =>
            entry.actionKind === "use_field_card_effect" &&
            entry.actionId?.includes(sourceInstanceId)
        );
    const noopEntries = actionEntriesFor(noopSourceInstanceId);
    const m01Entries = actionEntriesFor(m01SourceInstanceId);

    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(noopEntries, JSON.stringify(result.trace, null, 2)).toHaveLength(2);
    // The second no-op returns to its own visited response state. It must be
    // filtered, but the earlier M01 chain changed the state and remains a
    // valid declaration from that outer flash state.
    expect(m01Entries.length).toBeGreaterThanOrEqual(2);
    expect(
      result.trace.findIndex((entry) => entry === m01Entries[1])
    ).toBeGreaterThan(
      result.trace.findIndex((entry) => entry === noopEntries[1])
    );
  });

  it("EDH-0025: BSTH04-C11 stack input is followed by drained attack response", () => {
    const initial = c11NestedStackReplayState();
    const priorProgressVisits = new Map<string, number>();
    const makeC11ReplayPolicy = () => {
      const c11ActionInputContexts: {
        attackId: string;
        responseSourcePlayerId: string;
      }[] = [];
      const stackPassChoiceIds: string[] = [];
      const policy: TrainingPolicy = (state, node) => {
        if (node.kind === "action_input") {
          if (node.action?.sourceCardNo === "BSTH04-C11") {
            const attackId = state.activeAttack?.attackId;
            const responseSourcePlayerId =
              state.activeAttack?.flashWindowState?.pendingStackAction
                ?.actingPlayerId;
            expect(node.actingPlayerId).toBe(ALICE);
            expect(attackId).toBeDefined();
            expect(responseSourcePlayerId).toBe(BOB);
            c11ActionInputContexts.push({
              attackId: attackId!,
              responseSourcePlayerId: responseSourcePlayerId!,
            });
          }
          return node.choices[0]!;
        }
        const selected =
          node.choices.find(
            (choice) => choice.action?.sourceCardNo === "BSAZ01-C07"
          ) ??
          node.choices.find(
            (choice) => choice.action?.sourceCardNo === "BSTH04-C11"
          ) ??
          node.choices.find(
            (choice) =>
              choice.action?.kind === "pass_battle_flash" &&
              choice.action.responseTiming === "stack"
          ) ??
          node.choices.find(
            (choice) => choice.action?.kind === "pass_battle_flash"
          ) ??
          node.choices[0]!;
        if (
          selected.action?.kind === "pass_battle_flash" &&
          selected.action.responseTiming === "stack"
        ) {
          expect(
            state.activeAttack?.flashWindowState?.pendingStackAction
          ).not.toBeNull();
          stackPassChoiceIds.push(selected.choiceId);
        }
        return selected;
      };
      return {
        policy,
        c11ActionInputContexts,
        stackPassChoiceIds,
      };
    };

    const rollout = makeC11ReplayPolicy();
    const repeatedStackPasses: {
      actionId: string;
      attackId: string;
      wasVisitedBeforeInjection: boolean;
    }[] = [];
    const result = playTrainingGame({
      engine: c07ReplayEngine,
      initialState: initial,
      initialProgressStateVisits: priorProgressVisits,
      maxSteps: 8,
      maxForcedTransitions: 100,
      policies: {
        [ALICE]: rollout.policy,
        [BOB]: rollout.policy,
      },
      onBeforeProgressVisitCheck: ({
        stateBeforeTransition,
        nextState,
        action,
      }) => {
        if (
          action?.kind === "pass_battle_flash" &&
          action.responseTiming === "stack" &&
          stateBeforeTransition.activeAttack?.flashWindowState
            ?.pendingStackAction?.cardDefinitionId === "BSTH04-C11"
        ) {
          const attackId = stateBeforeTransition.activeAttack.attackId;
          const c11Context = rollout.c11ActionInputContexts.find(
            (context) => context.attackId === attackId
          );
          expect(c11Context?.responseSourcePlayerId).toBe(BOB);
          const nextFingerprint = trainingProgressFingerprint(nextState);
          // Mutate the same progress index supplied to this deterministic
          // replay immediately before the core guard inspects it. This makes
          // the C11 response-close a real prior visit in this exact rollout.
          const wasVisitedBeforeInjection =
            priorProgressVisits.has(nextFingerprint);
          priorProgressVisits.set(nextFingerprint, 1);
          expect(priorProgressVisits.has(nextFingerprint)).toBe(true);
          repeatedStackPasses.push({
            actionId: action.actionId,
            attackId,
            wasVisitedBeforeInjection,
          });
        }
      },
      rng: () => 0,
    });

    expect(result.outcome, result.lastError ?? "").not.toBe("stuck");
    expect(result.lastError ?? "").not.toMatch(
      /advanceStep blocked: activeAttack is in progress/
    );
    expect(rollout.c11ActionInputContexts).not.toHaveLength(0);
    expect(
      result.trace.some(
        (entry) =>
          entry.nodeKind === "legal_action" &&
          entry.actingPlayerId === BOB &&
          entry.actionKind === "use_magic" &&
          entry.actionId?.includes("c07")
      )
    ).toBe(true);
    expect(
      result.trace.some(
        (entry) =>
          entry.nodeKind === "action_input" &&
          entry.actingPlayerId === ALICE &&
          entry.actionKind === "use_magic" &&
          entry.actionId?.includes("c11-stack-response")
      )
    ).toBe(true);
    expect(repeatedStackPasses).not.toHaveLength(0);
    for (const stackPass of repeatedStackPasses) {
      expect(stackPass.wasVisitedBeforeInjection).toBe(false);
      expect(rollout.stackPassChoiceIds).toContain(stackPass.actionId);
      const c11InputIndex = result.trace.findIndex(
        (entry) =>
          entry.nodeKind === "action_input" &&
          entry.actingPlayerId === ALICE &&
          entry.actionId?.includes("c11-stack-response")
      );
      const stackPassIndex = result.trace.findIndex(
        (entry) => entry.choiceId === stackPass.actionId
      );
      expect(c11InputIndex).toBeGreaterThanOrEqual(0);
      expect(stackPassIndex).toBeGreaterThan(c11InputIndex);
      expect(
        rollout.c11ActionInputContexts.some(
          (context) => context.attackId === stackPass.attackId
        )
      ).toBe(true);
    }
  });

  it("rejects a cost-free brave separate → combine return to a visited state", () => {
    const combined = combinedBraveState();
    const separated = applyLegalAction({
      state: combined,
      action: {
        kind: "brave_separate",
        actionId: "test:separate",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        hostInstanceId: "host",
        braveInstanceId: "brave",
      },
      separateCoreDistribution: { host: 1 },
      getCardDefinitionById,
      ...engine.lookups,
    }).state;
    const visited = new Map([[trainingProgressFingerprint(combined), 1]]);
    expect(isNovelTrainingProgressState(separated, visited)).toBe(true);
    visited.set(trainingProgressFingerprint(separated), 1);

    let current = separated;
    let revisited = false;
    for (let round = 0; round < 8 && !revisited; round += 1) {
      current = applyLegalAction({
        state: current,
        action: {
          kind: "brave_combine",
          actionId: `test:combine:${round}`,
          can: true,
          reason: "test",
          actingPlayerId: ALICE,
          braveInstanceId: "brave",
          targetInstanceId: "host",
        },
        getCardDefinitionById,
        ...engine.lookups,
      }).state;
      if (!isNovelTrainingProgressState(current, visited)) {
        revisited = true;
        break;
      }
      visited.set(trainingProgressFingerprint(current), 1);

      current = applyLegalAction({
        state: current,
        action: {
          kind: "brave_separate",
          actionId: `test:separate:${round}`,
          can: true,
          reason: "test",
          actingPlayerId: ALICE,
          hostInstanceId: "host",
          braveInstanceId: "brave",
        },
        separateCoreDistribution: { host: 1 },
        getCardDefinitionById,
        ...engine.lookups,
      }).state;
      revisited = !isNovelTrainingProgressState(current, visited);
      if (!revisited) {
        visited.set(trainingProgressFingerprint(current), 1);
      }
    }

    expect(revisited).toBe(true);
    expect(isNovelTrainingProgressState(current, visited)).toBe(false);
  });

  it("accepts a factored manual-core commit that only closes the training draft", () => {
    const activeDraftState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main" as const,
      window: "none" as const,
      log: ["training:factored-manual-core-draft:active:alice"],
    };
    const node = getNextTrainingDecision(activeDraftState, engine, {
      factorManualCoreMovesThroughReserve: true,
    }) as TrainingDecisionNode;
    const commit = node.choices.find(
      (choice) =>
        choice.systemAction?.kind === "commit_factored_manual_core_move"
    );
    expect(commit).toBeDefined();

    const committed = applyTrainingDecisionChoice(
      activeDraftState,
      node,
      commit!,
      engine
    );
    const visited = new Map([
      [trainingProgressFingerprint(activeDraftState), 1],
    ]);

    expect(isNovelTrainingProgressState(committed, visited)).toBe(true);
  });

  it("skips a revisiting Brave action in playTrainingGame and advances instead", () => {
    let separateSelections = 0;
    let combineSelections = 0;
    let braveSelections = 0;
    const policy: TrainingPolicy = (_state, node) => {
      if (node.kind === "action_input") return node.choices[0]!;
      const separate = findAction(node.choices, "brave_separate");
      const combine = findAction(node.choices, "brave_combine");
      const advance = node.choices.find(
        (choice: TrainingDecisionChoice) =>
          choice.systemAction?.kind === "advance_step"
      );
      if (separate && separateSelections === combineSelections) {
        separateSelections += 1;
        braveSelections += 1;
        return separate;
      }
      if (combine && separateSelections > combineSelections) {
        combineSelections += 1;
        braveSelections += 1;
        return combine;
      }
      return advance ?? node.choices[0]!;
    };

    const result = playTrainingGame({
      engine,
      initialState: combinedBraveState(),
      maxSteps: 12,
      maxRepeatedStateTransitions: 1,
      policies: { [ALICE]: policy },
      suppressManualCoreMovesWhenLegalActionsExist: true,
    });

    const appliedBraveActions = result.trace.filter(
      (entry) =>
        entry.nodeKind === "legal_action" &&
        (entry.actionKind === "brave_separate" ||
          entry.actionKind === "brave_combine")
    );
    expect(braveSelections).toBeGreaterThan(appliedBraveActions.length);
    expect(result.outcome).not.toBe("stuck");
    expect(result.terminationReason).not.toBe("repeated_state");
    expect(
      result.trace.some((entry) => entry.systemActionKind === "advance_step")
    ).toBe(true);
  });

  it("starts an initialState replay without generating a random deck or consuming RNG", () => {
    let rngCalls = 0;
    const result = playTrainingGame({
      engine: { ...engine, cards: [] },
      initialState: combinedBraveState(),
      maxSteps: 0,
      rng: () => {
        rngCalls += 1;
        return 0.5;
      },
    });

    expect(result.outcome).toBe("capped");
    expect(rngCalls).toBe(0);
  });

  it("caps a training-only rollout at its elapsed-time budget", () => {
    let clockRead = 0;
    const result = playTrainingGame({
      engine,
      initialState: combinedBraveState(),
      maxSteps: 12,
      maxDurationMs: 1,
      now: () => (clockRead++ === 0 ? 0 : 1),
    });

    expect(result).toMatchObject({
      outcome: "capped",
      terminationReason: "elapsed_time_limit",
      decisionSteps: 0,
      transitionSteps: 0,
    });
    expect(result.lastError).toContain("maxDurationMs=1");
  });
});
