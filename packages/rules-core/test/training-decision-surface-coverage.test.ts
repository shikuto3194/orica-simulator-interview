import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";

import {
  AI_DECISION_APPLY_OPTION_FIELDS,
  TRAINING_ACTION_INPUT_FIELD_GAPS,
  TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS,
  createCardInstance,
  createEmptyGameState,
  applyTrainingDecisionChoice,
  applyLegalAction,
  createActionInputDecisionNode,
  getNextTrainingDecision,
  getLegalActions,
  heuristicTrainingPolicy,
  initializeGame,
  isPolicyControlledTrainingDecision,
  makeMctsTrainingPolicy,
  playTrainingGame,
  playTrainingTraceSmoke,
  trainingProgressFingerprint,
  type CardInstance,
  type CardDefinition,
  type ContinuousEffect,
  type Engine,
  type GameState,
  type LegalAction,
  type TrainingDecisionNode,
} from "../src";
import { processMovedToTrashEffects } from "../src/effect/structured-effect-interpreter";

const normalCard: CardDefinition = {
  cardNo: "TEST-AI-SURFACE",
  name: "AI Surface Test",
  colors: ["red"],
  symbolColors: ["red"],
  cost: 1,
  reduction: [],
  reductionSymbols: [],
  category: "spirit",
  printedCategory: "spirit",
  bp: 1000,
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  keywordTags: [],
  effects: [],
};

const widePaymentCard: CardDefinition = {
  ...normalCard,
  cardNo: "TEST-AI-SURFACE-WIDE-PAYMENT",
  name: "AI Surface Wide Payment Test",
  cost: 7,
};

const mirageCard: CardDefinition = {
  ...normalCard,
  cardNo: "TEST-AI-SURFACE-MIRAGE",
  name: "AI Surface Mirage Test",
  mirageData: { cost: 1, reduction: [] },
};

function testState() {
  return initializeGame({
    decks: [[normalCard], [normalCard]],
    skipPreGame: true,
  });
}

function getCardDefinitionById(id: string) {
  return id === normalCard.cardNo
    ? normalCard
    : id === widePaymentCard.cardNo
      ? widePaymentCard
      : undefined;
}

function fieldCard(instanceId: string, overrides: Partial<CardInstance> = {}) {
  return createCardInstance(normalCard, {
    instanceId,
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
    ...overrides,
  });
}

const testEngine: Engine = {
  cards: [normalCard, widePaymentCard],
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

function attackExhaustCostGate(): ContinuousEffect {
  return {
    effectId: "test-attack-exhaust-cost-gate",
    sourceInstanceId: "gate",
    sourceDefinitionId: normalCard.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "while_on_field" },
    createdAtTurn: 2,
    createdAtAttackId: null,
    modifierTag: "attack_exhaust_cost_gate",
    targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
    metadata: { costTargetCategory: ["spirit", "ultimate"] },
  };
}

function simultaneousAttackAction(): LegalAction {
  return {
    kind: "attack",
    actionId: "attack:attacker:exhaust:primary-cost",
    can: true,
    reason: "test",
    actingPlayerId: "bob",
    sourceInstanceId: "attacker",
    sourceDefinitionId: normalCard.cardNo,
    sourceCardNo: normalCard.cardNo,
    battleEntityId: "battle:attacker",
    attackExhaustCostSourceInstanceId: "primary-cost",
    simultaneousAttackOption: {
      candidateInstanceIds: ["joiner"],
      maxCount: 2,
      grantSourceInstanceId: "grant",
    },
  };
}

describe("training decision surface coverage", () => {
  it("surfaces a deferred optional trash add before training can advance again", () => {
    const lunaClock = ALL_CARDS.find((card) => card.cardNo === "BSTH01-R12");
    expect(lunaClock).toBeDefined();

    const lunaClockInstance = createCardInstance(lunaClock!, {
      instanceId: "training-luna-clock",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const source = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [lunaClockInstance],
    });
    const deferred = processMovedToTrashEffects(
      source,
      [lunaClockInstance.instanceId],
      (id) => (id === lunaClock!.cardNo ? lunaClock : undefined),
      { sourceColors: ["red"], fromZone: "deck" }
    );
    expect(deferred.pendingTrashOptionalAdds).toHaveLength(1);
    expect(deferred.pendingDeckReveal).toBeNull();

    const engine: Engine = {
      ...testEngine,
      cards: [normalCard, lunaClock!],
      getCardDefinitionById: (id) =>
        id === lunaClock!.cardNo
          ? lunaClock
          : id === normalCard.cardNo
            ? normalCard
            : undefined,
    };
    const trace = playTrainingTraceSmoke({
      engine,
      initialState: deferred,
      maxSteps: 1,
      maxForcedTransitions: 4,
      rng: () => 0,
    });
    expect(trace.terminationReason).not.toBe("advance_error");

    const promptFrame = trace.replay.frames.find(
      (frame) =>
        frame.state.pendingDeckReveal?.pendingId !== undefined &&
        frame.state.pendingDeckReveal.origin === "trash"
    );
    expect(promptFrame?.state.pendingTrashOptionalAdds).toHaveLength(0);
    expect(promptFrame?.state.pendingDeckReveal).toMatchObject({
      actingPlayerId: "alice",
      origin: "trash",
      revealedAutoAddCandidateIds: [lunaClockInstance.instanceId],
    });

    const promptNode = promptFrame?.traceEntry
      ? getNextTrainingDecision(promptFrame.state, engine)
      : null;
    expect(
      promptNode?.choices.some(
        (choice) => choice.action?.kind === "resolve_pending_deck_reveal_pick"
      )
    ).toBe(true);
    expect(
      promptNode?.choices.some(
        (choice) => choice.systemAction?.kind === "advance_step"
      )
    ).toBe(false);
  });

  it("factors the EDH large hand-selection and deck-order input surfaces without truncation", () => {
    const state = testState();
    const zoneSelection = {
      kind: "resolve_pending_zone_selection",
      actionId: "edh-zone-selection",
      can: true,
      reason: "zone_selection_discard_hand",
      actingPlayerId: "alice",
      pendingId: "edh-zone-pending",
      actionKind: "discard_hand",
      candidateCardInstanceIds: Array.from(
        { length: 14 },
        (_, index) => `hand-${index}`
      ),
      maxCount: 9,
      canSkip: true,
    } as Extract<LegalAction, { kind: "resolve_pending_zone_selection" }>;
    const zoneNode = createActionInputDecisionNode(state, zoneSelection, {
      maxGeneratedChoices: 1024,
    });
    expect(zoneNode?.truncated).toBe(false);
    expect(zoneNode?.choices).toHaveLength(2);
    expect(
      zoneNode?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_zone_selection"
      )
    ).toBe(true);

    const deckOrder = {
      kind: "resolve_pending_deck_reveal_order",
      actionId: "edh-deck-order",
      can: true,
      reason: "deck_reveal_order_remainder",
      actingPlayerId: "bob",
      pendingId: "edh-deck-pending",
      remainingCardInstanceIds: Array.from(
        { length: 8 },
        (_, index) => `reveal-${index}`
      ),
      remainder: "top_bottom_split",
    } as Extract<LegalAction, { kind: "resolve_pending_deck_reveal_order" }>;
    const deckNode = createActionInputDecisionNode(state, deckOrder, {
      maxGeneratedChoices: 1024,
    });
    expect(deckNode?.truncated).toBe(false);
    expect(deckNode?.choices).toHaveLength(16);
    expect(
      deckNode?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_deck_reveal_order"
      )
    ).toBe(true);

    const deckTopOrBottomOrder = {
      ...deckOrder,
      actionId: "edh-deck-top-or-bottom-order",
      remainder: "top_or_bottom",
    } as Extract<LegalAction, { kind: "resolve_pending_deck_reveal_order" }>;
    const topOrBottomNode = createActionInputDecisionNode(
      state,
      deckTopOrBottomOrder,
      { maxGeneratedChoices: 1024 }
    );
    expect(topOrBottomNode?.truncated).toBe(false);
    expect(topOrBottomNode?.fields).toEqual([
      "deckRevealRemainderOrder",
      "deckRevealPlacement",
    ]);
    expect(topOrBottomNode?.choices).toHaveLength(16);
    expect(
      topOrBottomNode?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_deck_reveal_order"
      )
    ).toBe(true);

    const deckBottomOrder = {
      ...deckOrder,
      actionId: "edh-deck-bottom-order",
      remainder: "bottom",
    } as Extract<LegalAction, { kind: "resolve_pending_deck_reveal_order" }>;
    const bottomNode = createActionInputDecisionNode(state, deckBottomOrder, {
      maxGeneratedChoices: 1024,
    });
    expect(bottomNode?.truncated).toBe(false);
    expect(bottomNode?.fields).toEqual(["deckRevealRemainderOrder"]);
    expect(bottomNode?.choices).toHaveLength(8);
    expect(
      bottomNode?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_deck_reveal_order" &&
          choice.systemAction.placement === "bottom"
      )
    ).toBe(true);
  });

  it("factors same-owner any-movable core distribution before its combined surface truncates", () => {
    const source = fieldCard("core-source", { normalCoreCount: 1 });
    const targets = [
      fieldCard("token-1", { normalCoreCount: 0 }),
      fieldCard("token-2", { normalCoreCount: 0 }),
      fieldCard("token-3", { normalCoreCount: 0 }),
    ];
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, ...targets],
      playerOverrides: [
        {},
        { reserveNormalCoreCount: 11, reserveSoulCoreCount: 1 },
      ],
    });
    const state = {
      ...base,
      activePlayerId: "bob",
      step: "main" as const,
      pendingCoreDistribution: {
        pendingId: "edh-factored-self-distribution",
        actingPlayerId: "bob",
        sourceInstanceId: "core-source",
        sourceDefinitionId: normalCard.cardNo,
        candidates: targets.map((target) => ({
          instanceId: target.instanceId,
          definitionId: normalCard.cardNo,
        })),
        totalNormalCores: 12,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable" as const,
        allowedSources: [
          { kind: "reserve" as const },
          { kind: "field" as const, instanceId: "core-source" },
        ],
        sourceAvailable: { reserve: 11, "field:core-source": 1 },
        soulSourceAvailable: { reserve: 1 },
        sourceTotalAvailable: { reserve: 12, "field:core-source": 1 },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources" as const,
          targetChooserPlayerId: "bob",
          sourceOwnerPlayerId: "bob",
        },
        minTotal: 1,
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-edh-factored-self-distribution",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "bob",
      pendingId: "edh-factored-self-distribution",
      candidates: state.pendingCoreDistribution.candidates,
      totalNormalCores: 12,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      allowedSources: state.pendingCoreDistribution.allowedSources,
      sourceAvailable: state.pendingCoreDistribution.sourceAvailable,
      soulSourceAvailable: state.pendingCoreDistribution.soulSourceAvailable,
      sourceTotalAvailable: state.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection: state.pendingCoreDistribution.targetTotalSelection,
      minTotal: 1,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    const targetNode = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 1024,
    });
    expect(targetNode?.truncated).toBe(false);
    expect(targetNode?.choices.length).toBeLessThanOrEqual(1024);
    expect(targetNode?.fields).toEqual(["coreDistributionAllocations"]);

    const sourceOwnerState = applyTrainingDecisionChoice(
      state,
      targetNode!,
      targetNode!.choices.at(-1)!,
      testEngine
    );
    const sourceOwnerAction = {
      ...action,
      targetTotalSelection:
        sourceOwnerState.pendingCoreDistribution!.targetTotalSelection,
    } as LegalAction;
    const sourceOwnerNode = createActionInputDecisionNode(
      sourceOwnerState,
      sourceOwnerAction,
      { maxGeneratedChoices: 1024 }
    );
    expect(sourceOwnerNode?.truncated).toBe(false);
    expect(sourceOwnerNode?.choices.length).toBeLessThanOrEqual(1024);
  });

  it("factors the EDH-sized core-distribution target-total surface without dropping allocations", () => {
    const source = fieldCard("edh-core-source");
    const targets = [
      fieldCard("edh-token-1", { normalCoreCount: 0 }),
      fieldCard("edh-token-2", { normalCoreCount: 0 }),
      fieldCard("edh-token-3", { normalCoreCount: 0 }),
    ];
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, ...targets],
      playerOverrides: [
        { reserveNormalCoreCount: 25, reserveSoulCoreCount: 1 },
        {},
      ],
    });
    const state = {
      ...base,
      activePlayerId: "alice",
      step: "main" as const,
      pendingCoreDistribution: {
        pendingId: "edh-large-target-totals",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        candidates: targets.map((target) => ({
          instanceId: target.instanceId,
          definitionId: normalCard.cardNo,
        })),
        totalNormalCores: 25,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable" as const,
        allowedSources: [{ kind: "reserve" as const }],
        sourceAvailable: { reserve: 25 },
        soulSourceAvailable: { reserve: 1 },
        sourceTotalAvailable: { reserve: 26 },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources" as const,
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "alice",
        },
        minTotal: 1,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-edh-large-target-totals",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "alice",
      pendingId: "edh-large-target-totals",
      candidates: state.pendingCoreDistribution.candidates,
      totalNormalCores: 25,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      allowedSources: state.pendingCoreDistribution.allowedSources,
      sourceAvailable: state.pendingCoreDistribution.sourceAvailable,
      soulSourceAvailable: state.pendingCoreDistribution.soulSourceAvailable,
      sourceTotalAvailable: state.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection: state.pendingCoreDistribution.targetTotalSelection,
      minTotal: 1,
      fromPlayerId: "alice",
      toPlayerId: "alice",
    } as LegalAction;

    let current = state;
    let node = createActionInputDecisionNode(current, action, {
      maxGeneratedChoices: 1024,
    });
    expect(node?.truncated).toBe(false);
    expect(node?.choices.length).toBeLessThanOrEqual(27);
    expect(
      node?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_target_selection" &&
          "targetTotal" in choice.systemAction
      )
    ).toBe(true);

    for (const targetTotal of [25, 0, 0]) {
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_target_selection" &&
          "targetTotal" in candidate.systemAction &&
          candidate.systemAction.targetTotal === targetTotal
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      node = getNextTrainingDecision(current, testEngine, {
        maxGeneratedChoices: 1024,
      });
    }

    expect(current.pendingCoreDistribution?.targetTotalSelection).toMatchObject(
      {
        fixedTargetTotals: { "edh-token-1": 25 },
      }
    );
    expect(node?.kind).toBe("legal_action");
    const sourceAction = node?.choices.find(
      (choice) => choice.action?.kind === "resolve_pending_core_distribution"
    )?.action as Extract<
      LegalAction,
      { kind: "resolve_pending_core_distribution" }
    >;
    expect(sourceAction).toBeDefined();
    const sourceNode = createActionInputDecisionNode(current, sourceAction, {
      maxGeneratedChoices: 1024,
    });
    expect(sourceNode?.truncated).toBe(false);
    expect(sourceNode?.choices.length).toBeGreaterThan(0);
    const resolve = sourceNode?.choices.find(
      (choice) =>
        choice.applyOptions?.coreDistributionAllocations?.["edh-token-1"] === 25
    );
    expect(resolve).toBeDefined();
    const resolved = applyTrainingDecisionChoice(
      current,
      sourceNode!,
      resolve!,
      testEngine
    );
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "edh-token-1")
        ?.normalCoreCount
    ).toBe(25);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "edh-token-2")
        ?.normalCoreCount
    ).toBe(0);
  });

  it("factors an EDH-sized core distribution when targets are mixed normal/soul sources", () => {
    const sourceA = fieldCard("overlap-source-a", {
      normalCoreCount: 3,
      soulCoreCount: 1,
    });
    const sourceB = fieldCard("overlap-source-b", { normalCoreCount: 2 });
    const sourceC = fieldCard("overlap-source-c", { normalCoreCount: 4 });
    const targets = [
      sourceA,
      sourceB,
      sourceC,
      fieldCard("overlap-target-d", { normalCoreCount: 0 }),
      fieldCard("overlap-target-e", { normalCoreCount: 0 }),
      fieldCard("overlap-target-f", { normalCoreCount: 0 }),
      fieldCard("overlap-target-g", { normalCoreCount: 0 }),
    ];
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: targets,
      }),
      activePlayerId: "alice",
      step: "main" as const,
      pendingCoreDistribution: {
        pendingId: "edh-overlap-target-source-distribution",
        actingPlayerId: "alice",
        sourceInstanceId: "overlap-effect",
        sourceDefinitionId: normalCard.cardNo,
        candidates: targets.map((target) => ({
          instanceId: target.instanceId,
          definitionId: normalCard.cardNo,
        })),
        totalNormalCores: 4,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable" as const,
        allowedSources: [
          { kind: "field" as const, instanceId: sourceA.instanceId },
          { kind: "field" as const, instanceId: sourceB.instanceId },
          { kind: "field" as const, instanceId: sourceC.instanceId },
        ],
        sourceAvailable: {
          [`field:${sourceA.instanceId}`]: 2,
          [`field:${sourceB.instanceId}`]: 1,
          [`field:${sourceC.instanceId}`]: 4,
        },
        soulSourceAvailable: {
          [`field:${sourceA.instanceId}`]: 1,
        },
        sourceTotalAvailable: {
          [`field:${sourceA.instanceId}`]: 3,
          [`field:${sourceB.instanceId}`]: 1,
          [`field:${sourceC.instanceId}`]: 4,
        },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources" as const,
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "bob",
        },
        maxTotal: 4,
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-edh-overlap-target-source-distribution",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "alice",
      pendingId: "edh-overlap-target-source-distribution",
      candidates: state.pendingCoreDistribution.candidates,
      totalNormalCores: 4,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      allowedSources: state.pendingCoreDistribution.allowedSources,
      sourceAvailable: state.pendingCoreDistribution.sourceAvailable,
      soulSourceAvailable: state.pendingCoreDistribution.soulSourceAvailable,
      sourceTotalAvailable: state.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection: state.pendingCoreDistribution.targetTotalSelection,
      maxTotal: 4,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    let current = state;
    let node = createActionInputDecisionNode(current, action, {
      maxGeneratedChoices: 1024,
    });
    expect(node?.truncated).toBe(false);
    expect(node?.fields).toEqual(["coreDistributionAllocations"]);
    expect(
      node?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_target_selection" &&
          "targetTotal" in choice.systemAction
      )
    ).toBe(true);

    for (const targetTotal of [2, 1, 3, 4, 0, 0, 0]) {
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_target_selection" &&
          "targetTotal" in candidate.systemAction &&
          candidate.systemAction.targetTotal === targetTotal
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      node = getNextTrainingDecision(current, testEngine, {
        maxGeneratedChoices: 1024,
      });
    }

    expect(current.pendingCoreDistribution?.targetTotalSelection).toMatchObject(
      {
        fixedTargetTotals: {
          "overlap-source-a": 2,
          "overlap-source-b": 1,
          "overlap-source-c": 3,
          "overlap-target-d": 4,
        },
      }
    );

    const sourceAction = node?.choices.find(
      (choice) => choice.action?.kind === "resolve_pending_core_distribution"
    )?.action as Extract<
      LegalAction,
      { kind: "resolve_pending_core_distribution" }
    >;
    expect(sourceAction).toBeDefined();
    const sourceNode = createActionInputDecisionNode(current, sourceAction, {
      maxGeneratedChoices: 1024,
    });
    expect(sourceNode?.truncated).toBe(false);
    const resolve = sourceNode?.choices.find(
      (choice) =>
        choice.applyOptions?.coreDistributionAllocations?.[
          "overlap-target-d"
        ] === 4 &&
        choice.applyOptions?.coreDistributionSourceAllocations?.[
          "field:overlap-source-a"
        ] === 2 &&
        choice.applyOptions?.coreDistributionSourceAllocations?.[
          "field:overlap-source-b"
        ] === 1 &&
        choice.applyOptions?.coreDistributionSourceAllocations?.[
          "field:overlap-source-c"
        ] === 1 &&
        choice.applyOptions?.coreDistributionSoulCoreAllocations === undefined
    );
    expect(resolve).toBeDefined();
    const resolved = applyTrainingDecisionChoice(
      current,
      sourceNode!,
      resolve!,
      testEngine
    );
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "overlap-source-a"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "overlap-source-a"
      )?.soulCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "overlap-target-d"
      )?.normalCoreCount
    ).toBe(4);
  });

  it("factors a fixed single-target core distribution by physical source without truncation", () => {
    const target = fieldCard("edh-overlap-target", { normalCoreCount: 5 });
    const sourceA = fieldCard("edh-overlap-source-a", { normalCoreCount: 5 });
    const sourceB = fieldCard("edh-overlap-source-b", { normalCoreCount: 5 });
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [target, sourceA, sourceB],
        playerOverrides: [
          {
            reserveNormalCoreCount: 5,
            reserveSoulCoreCount: 1,
            trashNormalCoreCount: 5,
            lifeNormalCoreCount: 5,
          },
          {},
        ],
      }),
      // 全ライフを分配しても解決を継続するため、この盤面では敗北防止を付与する。
      activeContinuousEffects: [
        {
          effectId: "distribution-loss-immunity",
          sourceInstanceId: target.instanceId,
          sourceDefinitionId: normalCard.cardNo,
          actingPlayerId: "alice",
          targetInstanceId: "alice",
          modifierTag: "immune_to_game_loss",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
        },
      ],
      activePlayerId: "alice",
      step: "main",
      pendingCoreDistribution: {
        pendingId: "edh-overlap-source-allocation",
        actingPlayerId: "alice",
        sourceInstanceId: target.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        candidates: [
          { instanceId: target.instanceId, definitionId: normalCard.cardNo },
        ],
        totalNormalCores: 20,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable",
        allowedSources: [
          { kind: "reserve" },
          { kind: "trash" },
          { kind: "life" },
          { kind: "field", instanceId: target.instanceId },
          { kind: "field", instanceId: sourceA.instanceId },
          { kind: "field", instanceId: sourceB.instanceId },
        ],
        sourceAvailable: {
          reserve: 5,
          trash: 5,
          life: 5,
          [`field:${target.instanceId}`]: 5,
          [`field:${sourceA.instanceId}`]: 5,
          [`field:${sourceB.instanceId}`]: 5,
        },
        soulSourceAvailable: { reserve: 1 },
        sourceTotalAvailable: {
          reserve: 6,
          trash: 5,
          life: 5,
          [`field:${target.instanceId}`]: 5,
          [`field:${sourceA.instanceId}`]: 5,
          [`field:${sourceB.instanceId}`]: 5,
        },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources",
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "alice",
          fixedTargetTotals: { [target.instanceId]: 26 },
        },
        minTotal: 1,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "activated", mode: "main" },
      },
    };
    const resolveAction = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_core_distribution" }
      > => action.kind === "resolve_pending_core_distribution"
    );
    expect(resolveAction).toBeDefined();

    let node = createActionInputDecisionNode(current, resolveAction!, {
      maxGeneratedChoices: 1024,
    });
    for (let sourceIndex = 0; sourceIndex < 6; sourceIndex++) {
      expect(node?.truncated).toBe(false);
      expect(
        node?.choices.every(
          (choice) =>
            choice.systemAction?.kind === "select_factored_zone_selection" &&
            "coreDistributionSourceCandidateIndex" in choice.systemAction
        )
      ).toBe(true);
      const choice = node?.choices[0];
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      if (sourceIndex < 5) {
        node = getNextTrainingDecision(current, testEngine, {
          maxGeneratedChoices: 1024,
        });
      }
    }

    expect(current.pendingCoreDistribution).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === target.instanceId
      )?.normalCoreCount
    ).toBe(25);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === target.instanceId
      )?.soulCoreCount
    ).toBe(1);
  });

  it("factors an optional single-target core charge by physical source without truncation", () => {
    const target = fieldCard("optional-charge-target", { normalCoreCount: 0 });
    const sources = Array.from({ length: 7 }, (_, index) =>
      fieldCard(`optional-charge-source-${index + 1}`, {
        normalCoreCount: 3,
      })
    );
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [target, ...sources],
        playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingCoreDistribution: {
        pendingId: "edh-optional-single-target-charge",
        actingPlayerId: "alice",
        sourceInstanceId: target.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        candidates: [
          { instanceId: target.instanceId, definitionId: normalCard.cardNo },
        ],
        totalNormalCores: 24,
        hasSoulCore: false,
        fromKind: "any_movable",
        allowedSources: [
          { kind: "reserve" },
          ...sources.map((source) => ({
            kind: "field" as const,
            instanceId: source.instanceId,
          })),
        ],
        sourceAvailable: {
          reserve: 3,
          ...Object.fromEntries(
            sources.map((source) => [`field:${source.instanceId}`, 3])
          ),
        },
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "continuous" },
      },
    };
    const resolveAction = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_core_distribution" }
      > => action.kind === "resolve_pending_core_distribution"
    );
    expect(resolveAction).toBeDefined();

    let node = createActionInputDecisionNode(current, resolveAction!, {
      maxGeneratedChoices: 1024,
    });
    for (let sourceIndex = 0; sourceIndex < 8; sourceIndex++) {
      expect(node?.truncated).toBe(false);
      expect(
        node?.choices.every(
          (choice) =>
            choice.systemAction?.kind === "select_factored_zone_selection" &&
            "coreDistributionSourceCandidateIndex" in choice.systemAction
        )
      ).toBe(true);
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "coreDistributionSourceCandidateIndex" in candidate.systemAction &&
          candidate.systemAction.normalAmount === 1 &&
          candidate.systemAction.soulAmount === 0
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      if (sourceIndex < 7) {
        node = getNextTrainingDecision(current, testEngine, {
          maxGeneratedChoices: 1024,
        });
      }
    }

    expect(current.pendingCoreDistribution).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === target.instanceId
      )?.normalCoreCount
    ).toBe(8);
  });

  it("factors fixed disjoint multi-target core sources and keeps every soul destination", () => {
    const targets = [
      fieldCard("factored-target-1", { normalCoreCount: 0 }),
      fieldCard("factored-target-2", { normalCoreCount: 0 }),
      fieldCard("factored-target-3", { normalCoreCount: 0 }),
    ];
    const sources = [
      fieldCard("factored-source-1", { normalCoreCount: 6 }),
      fieldCard("factored-source-2", { normalCoreCount: 5 }),
      fieldCard("factored-source-3", { normalCoreCount: 1 }),
      fieldCard("factored-source-4", { normalCoreCount: 2 }),
      fieldCard("factored-soul-source", {
        normalCoreCount: 6,
        soulCoreCount: 1,
      }),
      fieldCard("factored-source-6", { normalCoreCount: 8 }),
    ];
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [...targets, ...sources],
        playerOverrides: [
          {},
          {
            soulCoreLocation: {
              kind: "card",
              instanceId: "factored-soul-source",
            },
          },
        ],
      }),
      activePlayerId: "bob",
      step: "main",
      pendingCoreDistribution: {
        pendingId: "edh-fixed-disjoint-multi-target",
        actingPlayerId: "bob",
        sourceInstanceId: "factored-source-1",
        sourceDefinitionId: normalCard.cardNo,
        candidates: targets.map((target) => ({
          instanceId: target.instanceId,
          definitionId: normalCard.cardNo,
        })),
        totalNormalCores: 28,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable",
        allowedSources: sources.map((source) => ({
          kind: "field" as const,
          instanceId: source.instanceId,
        })),
        sourceAvailable: {
          "field:factored-source-1": 6,
          "field:factored-source-2": 5,
          "field:factored-source-3": 1,
          "field:factored-source-4": 2,
          "field:factored-soul-source": 6,
          "field:factored-source-6": 8,
        },
        soulSourceAvailable: { "field:factored-soul-source": 1 },
        sourceTotalAvailable: {
          "field:factored-source-1": 6,
          "field:factored-source-2": 5,
          "field:factored-source-3": 1,
          "field:factored-source-4": 2,
          "field:factored-soul-source": 7,
          "field:factored-source-6": 8,
        },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources",
          targetChooserPlayerId: "bob",
          sourceOwnerPlayerId: "bob",
          fixedTargetTotals: {
            "factored-target-1": 3,
            "factored-target-2": 5,
            "factored-target-3": 11,
          },
        },
        minTotal: 1,
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated", mode: "main" },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-edh-fixed-disjoint-multi-target",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "bob",
      pendingId: "edh-fixed-disjoint-multi-target",
      candidates: current.pendingCoreDistribution.candidates,
      totalNormalCores: 28,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      allowedSources: current.pendingCoreDistribution.allowedSources,
      sourceAvailable: current.pendingCoreDistribution.sourceAvailable,
      soulSourceAvailable: current.pendingCoreDistribution.soulSourceAvailable,
      sourceTotalAvailable:
        current.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection:
        current.pendingCoreDistribution.targetTotalSelection,
      minTotal: 1,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    let node = createActionInputDecisionNode(current, action, {
      maxGeneratedChoices: 1024,
    });
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      expect(node?.truncated).toBe(false);
      expect(node?.fields).toEqual([
        "coreDistributionSourceAllocations",
        "coreDistributionSoulCoreSourceAllocations",
      ]);
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "coreDistributionSourceCandidateIndex" in candidate.systemAction &&
          candidate.systemAction.coreDistributionSourceCandidateIndex ===
            sourceIndex &&
          (sourceIndex !== 4 || candidate.systemAction.soulAmount === 1)
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      if (sourceIndex < sources.length - 1) {
        node = getNextTrainingDecision(current, testEngine, {
          maxGeneratedChoices: 1024,
        });
      }
    }

    node = getNextTrainingDecision(current, testEngine, {
      maxGeneratedChoices: 1024,
    });
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      expect(node?.truncated).toBe(false);
      expect(node?.fields).toEqual(["coreDistributionSoulCoreAllocations"]);
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_target_selection" &&
          "coreDistributionSoulTargetCandidateIndex" in
            candidate.systemAction &&
          candidate.systemAction.coreDistributionSoulTargetCandidateIndex ===
            targetIndex &&
          candidate.systemAction.soulAmount === (targetIndex === 0 ? 1 : 0)
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      if (targetIndex < targets.length - 1) {
        node = getNextTrainingDecision(current, testEngine, {
          maxGeneratedChoices: 1024,
        });
      }
    }

    expect(current.pendingCoreDistribution).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === "factored-target-1"
      )
    ).toMatchObject({ normalCoreCount: 2, soulCoreCount: 1 });
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === "factored-target-2"
      )?.normalCoreCount
    ).toBe(5);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === "factored-target-3"
      )?.normalCoreCount
    ).toBe(11);
  });

  it("keeps alternate zone-selection counts on the exhaustive input path", () => {
    const action = {
      kind: "resolve_pending_zone_selection",
      actionId: "alternate-zone-selection",
      can: true,
      reason: "zone_selection_discard_hand",
      actingPlayerId: "alice",
      pendingId: "alternate-zone-pending",
      actionKind: "discard_hand",
      candidateCardInstanceIds: ["hand-a", "hand-b", "hand-c"],
      maxCount: 3,
      canSkip: false,
      alternateSelections: [
        {
          count: 1,
          candidateInstanceIds: ["red-demon"],
          label: "red_demon_one",
        },
      ],
    } as Extract<LegalAction, { kind: "resolve_pending_zone_selection" }>;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 1024,
    });

    expect(node?.truncated).toBe(false);
    expect(node?.choices).toHaveLength(2);
    expect(node?.choices.every((choice) => !choice.systemAction)).toBe(true);
    expect(
      node?.choices.some(
        (choice) =>
          choice.applyOptions?.selectedZoneCardIds?.join("\0") === "red-demon"
      )
    ).toBe(true);
  });

  it("commits factored zone selections after applying every training action", () => {
    const source = createCardInstance(normalCard, {
      instanceId: "factored-zone-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCards = ["zone-hand-a", "zone-hand-b", "zone-hand-c"].map(
      (instanceId) =>
        createCardInstance(normalCard, {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        })
    );
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...handCards],
        playerOverrides: [{ handCount: handCards.length }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingZoneSelection: {
        pendingId: "factored-zone-pending",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        actionKind: "discard_hand",
        sourceZone: "hand",
        candidateCardInstanceIds: handCards.map((card) => card.instanceId),
        maxCount: 2,
        destination: "trash",
        remainingActions: [],
        effectTiming: { kind: "continuous" },
        canSkip: true,
      },
    };
    const selectAt = (candidateIndex: number, select: boolean) => {
      const next = getNextTrainingDecision(current, testEngine, {
        maxGeneratedChoices: 1024,
      });
      const action = next?.choices.find(
        (candidate) =>
          candidate.action?.kind === "resolve_pending_zone_selection"
      )?.action;
      const node = action
        ? createActionInputDecisionNode(current, action, {
            maxGeneratedChoices: 1024,
          })
        : next;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === select
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
    };

    selectAt(0, true);
    expect(
      (current as { trainingZoneSelectionDraft?: unknown })
        .trainingZoneSelectionDraft
    ).toBeDefined();
    selectAt(1, false);
    selectAt(2, true);

    expect(current.pendingZoneSelection).toBeNull();
    expect(
      (current as { trainingZoneSelectionDraft?: unknown })
        .trainingZoneSelectionDraft
    ).toBeUndefined();
    expect(
      current.cardInstances
        .filter((card) => card.zone === "trash")
        .map((card) => card.instanceId)
        .sort()
    ).toEqual(["zone-hand-a", "zone-hand-c"]);
    expect(
      current.cardInstances.find((card) => card.instanceId === "zone-hand-b")
        ?.zone
    ).toBe("hand");
    expect(
      current.players.find((player) => player.id === "alice")?.handCount
    ).toBe(1);
  });

  it("commits factored deck-reveal order and placement after every training action", () => {
    const source = createCardInstance(normalCard, {
      instanceId: "factored-deck-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckAnchor = createCardInstance(normalCard, {
      instanceId: "deck-anchor",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const revealedCards = ["reveal-a", "reveal-b", "reveal-c"].map(
      (instanceId) =>
        createCardInstance(normalCard, {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "revealed",
        })
    );
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingDeckCount: 1,
        cardInstances: [source, deckAnchor, ...revealedCards],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingDeckReveal: {
        pendingId: "factored-deck-pending",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        revealedCardInstanceIds: revealedCards.map((card) => card.instanceId),
        originalRevealedCardInstanceIds: revealedCards.map(
          (card) => card.instanceId
        ),
        picks: [],
        remainder: "top_bottom_split",
        phase: "ordering_remainder",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
      },
    };
    const selectCard = (
      cardInstanceId: string,
      placement: "top" | "bottom"
    ) => {
      const next = getNextTrainingDecision(current, testEngine, {
        maxGeneratedChoices: 1024,
      });
      const action = next?.choices.find(
        (candidate) =>
          candidate.action?.kind === "resolve_pending_deck_reveal_order"
      )?.action;
      const node = action
        ? createActionInputDecisionNode(current, action, {
            maxGeneratedChoices: 1024,
          })
        : next;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind ===
            "select_factored_deck_reveal_order" &&
          candidate.systemAction.cardInstanceId === cardInstanceId &&
          candidate.systemAction.placement === placement
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
    };

    selectCard("reveal-a", "top");
    expect(
      (current as { trainingDeckRevealOrderDraft?: unknown })
        .trainingDeckRevealOrderDraft
    ).toBeDefined();
    selectCard("reveal-b", "bottom");
    selectCard("reveal-c", "top");

    expect(current.pendingDeckReveal).toBeNull();
    expect(
      (current as { trainingDeckRevealOrderDraft?: unknown })
        .trainingDeckRevealOrderDraft
    ).toBeUndefined();
    expect(
      current.cardInstances
        .filter(
          (card) => card.ownerPlayerId === "alice" && card.zone === "deck"
        )
        .map((card) => card.instanceId)
    ).toEqual(["reveal-c", "reveal-a", "deck-anchor", "reveal-b"]);
    expect(
      current.players.find((player) => player.id === "alice")?.deckCount
    ).toBe(4);

    current = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingDeckCount: 1,
        cardInstances: [source, deckAnchor, ...revealedCards],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingDeckReveal: {
        pendingId: "factored-deck-top-or-bottom-pending",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        revealedCardInstanceIds: revealedCards.map((card) => card.instanceId),
        originalRevealedCardInstanceIds: revealedCards.map(
          (card) => card.instanceId
        ),
        picks: [],
        remainder: "top_or_bottom",
        phase: "ordering_remainder",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
      },
    };

    selectCard("reveal-a", "top");
    const next = getNextTrainingDecision(current, testEngine, {
      maxGeneratedChoices: 1024,
    });
    const nextAction = next?.choices.find(
      (candidate) =>
        candidate.action?.kind === "resolve_pending_deck_reveal_order"
    )?.action;
    const nextNode = nextAction
      ? createActionInputDecisionNode(current, nextAction, {
          maxGeneratedChoices: 1024,
        })
      : next;
    expect(nextNode?.truncated).toBe(false);
    expect(
      nextNode?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_deck_reveal_order" &&
          choice.systemAction.placement === "top"
      )
    ).toBe(true);
    selectCard("reveal-b", "top");
    selectCard("reveal-c", "top");

    expect(current.pendingDeckReveal).toBeNull();
    expect(
      (current as { trainingDeckRevealOrderDraft?: unknown })
        .trainingDeckRevealOrderDraft
    ).toBeUndefined();
    expect(
      current.cardInstances
        .filter(
          (card) => card.ownerPlayerId === "alice" && card.zone === "deck"
        )
        .map((card) => card.instanceId)
    ).toEqual(["reveal-c", "reveal-b", "reveal-a", "deck-anchor"]);

    current = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingDeckCount: 1,
        cardInstances: [source, deckAnchor, ...revealedCards],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingDeckReveal: {
        pendingId: "factored-deck-bottom-pending",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        revealedCardInstanceIds: revealedCards.map((card) => card.instanceId),
        originalRevealedCardInstanceIds: revealedCards.map(
          (card) => card.instanceId
        ),
        picks: [],
        remainder: "bottom",
        phase: "ordering_remainder",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
      },
    };

    selectCard("reveal-a", "bottom");
    selectCard("reveal-b", "bottom");
    selectCard("reveal-c", "bottom");

    expect(current.pendingDeckReveal).toBeNull();
    expect(
      (current as { trainingDeckRevealOrderDraft?: unknown })
        .trainingDeckRevealOrderDraft
    ).toBeUndefined();
    expect(
      current.cardInstances
        .filter(
          (card) => card.ownerPlayerId === "alice" && card.zone === "deck"
        )
        .map((card) => card.instanceId)
    ).toEqual(["deck-anchor", "reveal-c", "reveal-b", "reveal-a"]);
  });

  it("classifies forced-transition exhaustion as stuck outside the decision budget", () => {
    const result = playTrainingGame({
      engine: testEngine,
      decks: [[normalCard], [normalCard]],
      maxSteps: 1,
      maxForcedTransitions: 1,
      skipPreGame: true,
    });

    expect(result.outcome).toBe("stuck");
    expect(result.terminationReason).toBe("forced_transition_limit");
    expect(result.steps).toBe(1);
    expect(result.decisionSteps).toBe(0);
    expect(result.transitionSteps).toBe(1);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      step: 0,
      systemActionKind: "advance_step",
    });
  });

  it("normalizes append-only diagnostics, public history, and duplicate flash history in the training progress fingerprint", () => {
    const state = testState();
    const diagnosticsOnly = structuredClone(state);
    diagnosticsOnly.log.push("diagnostic-only");
    diagnosticsOnly.actionStartLogIndex += 1;
    const publiclyDisclosed = structuredClone(state);
    publiclyDisclosed.publicDisclosures.push({
      id: "public-disclosure:1",
      sequence: 1,
      turnNumber: state.turnNumber,
      step: state.step,
      actorPlayerId: "alice",
      audience: "both",
      kind: "state_changed",
      targets: [],
      results: [],
    });
    const morePubliclyDisclosed = structuredClone(publiclyDisclosed);
    morePubliclyDisclosed.publicDisclosures.push({
      id: "public-disclosure:2",
      sequence: 2,
      turnNumber: state.turnNumber,
      step: state.step,
      actorPlayerId: "alice",
      audience: "both",
      kind: "state_changed",
      targets: [],
      results: [],
    });
    const onceActivated = structuredClone(state);
    const activation = {
      playerId: "alice",
      sourceInstanceId: "source-1",
      sourceDefinitionId: normalCard.cardNo,
      effectIndex: 0,
      turnNumber: state.turnNumber,
      step: state.step,
      attackId: null,
    };
    onceActivated.flashEffectActivationLog = [activation];
    const repeatedActivation = structuredClone(onceActivated);
    repeatedActivation.flashEffectActivationLog.push({ ...activation });
    const differentLatestActivation = structuredClone(onceActivated);
    differentLatestActivation.flashEffectActivationLog.push({
      ...activation,
      playerId: "bob",
    });
    const interspersedRepeat = structuredClone(onceActivated);
    interspersedRepeat.flashEffectActivationLog.push(
      { ...activation, playerId: "bob" },
      { ...activation }
    );
    const equivalentLatestHistory = structuredClone(onceActivated);
    equivalentLatestHistory.flashEffectActivationLog = [
      { ...activation, playerId: "bob" },
      { ...activation },
    ];
    const progressed = structuredClone(state);
    progressed.turn += 1;

    expect(trainingProgressFingerprint(diagnosticsOnly)).toBe(
      trainingProgressFingerprint(state)
    );
    expect(trainingProgressFingerprint(publiclyDisclosed)).not.toBe(
      trainingProgressFingerprint(state)
    );
    expect(trainingProgressFingerprint(morePubliclyDisclosed)).toBe(
      trainingProgressFingerprint(publiclyDisclosed)
    );
    expect(trainingProgressFingerprint(repeatedActivation)).toBe(
      trainingProgressFingerprint(onceActivated)
    );
    expect(trainingProgressFingerprint(differentLatestActivation)).not.toBe(
      trainingProgressFingerprint(onceActivated)
    );
    expect(trainingProgressFingerprint(interspersedRepeat)).toBe(
      trainingProgressFingerprint(equivalentLatestHistory)
    );
    expect(trainingProgressFingerprint(progressed)).not.toBe(
      trainingProgressFingerprint(state)
    );
  });

  it("classifies every AI-decision ApplyLegalActionOptions field for training", () => {
    expect(
      [
        ...TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS,
        ...Object.keys(TRAINING_ACTION_INPUT_FIELD_GAPS),
      ].sort()
    ).toEqual([...AI_DECISION_APPLY_OPTION_FIELDS].sort());
    expect(Object.keys(TRAINING_ACTION_INPUT_FIELD_GAPS).sort()).toEqual([]);
  });

  it("supplies per-card mirage payments for a card-event deck reveal choice", () => {
    const revealedMirage = createCardInstance(mirageCard, {
      instanceId: "revealed-mirage",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [revealedMirage],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const state = {
      ...base,
      pendingDeckReveal: {
        pendingId: "pending-revealed-mirage",
        actingPlayerId: "alice",
        sourceInstanceId: "reveal-source",
        sourceDefinitionId: normalCard.cardNo,
        revealedCardInstanceIds: [revealedMirage.instanceId],
        originalRevealedCardInstanceIds: [revealedMirage.instanceId],
        picks: [],
        remainder: "bottom" as const,
        phase: "revealed_choice" as const,
        currentPickIndex: -1,
        pickedCardInstanceIds: [],
        revealedAutoAddCandidateIds: [revealedMirage.instanceId],
        revealedDispositionMap: {
          [revealedMirage.instanceId]: { kind: "set_as_mirage" as const },
        },
      },
    };
    const action = {
      kind: "resolve_pending_deck_reveal_pick",
      actionId: "resolve-revealed-mirage",
      can: true,
      reason: "deck_reveal_revealed_choice",
      actingPlayerId: "alice",
      pendingId: "pending-revealed-mirage",
      pickIndex: -1,
      candidateCardInstanceIds: [revealedMirage.instanceId],
      maxPickCount: 1,
      canSkip: true,
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action, {
      getCardDefinitionById: (id) =>
        id === mirageCard.cardNo
          ? mirageCard
          : id === normalCard.cardNo
            ? normalCard
            : undefined,
    });

    expect(node?.fields).toEqual([
      "deckRevealMiragePaymentSourcesByInstanceId",
      "selectedDeckRevealCardIds",
    ]);
    expect(
      node?.choices.find((choice) =>
        choice.applyOptions?.selectedDeckRevealCardIds?.includes(
          revealedMirage.instanceId
        )
      )?.applyOptions
    ).toEqual({
      selectedDeckRevealCardIds: [revealedMirage.instanceId],
      deckRevealMiragePaymentSourcesByInstanceId: {
        [revealedMirage.instanceId]: [{ kind: "reserve", amount: 1 }],
      },
    });

    const withoutLookup = createActionInputDecisionNode(state, action);
    expect(withoutLookup?.choices.map((choice) => choice.applyOptions)).toEqual(
      [{ selectedDeckRevealCardIds: [] }]
    );

    const truncated = createActionInputDecisionNode(state, action, {
      getCardDefinitionById: (id) =>
        id === mirageCard.cardNo
          ? mirageCard
          : id === normalCard.cardNo
            ? normalCard
            : undefined,
      maxGeneratedChoices: 1,
    });
    expect(truncated?.choices).toHaveLength(1);
    expect(truncated?.truncated).toBe(true);
  });

  it("exposes per-participant exhaust cost choices for simultaneous attack", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        fieldCard("attacker"),
        fieldCard("primary-cost"),
        fieldCard("joiner"),
        fieldCard("join-cost"),
      ],
    });
    const state = {
      ...base,
      turnNumber: 2,
      activePlayerId: "bob",
      step: "attack" as const,
      activeContinuousEffects: [attackExhaustCostGate()],
    };

    const node = createActionInputDecisionNode(
      state,
      simultaneousAttackAction(),
      { getCardDefinitionById }
    );
    const joinChoices = node?.choices.filter((choice) =>
      choice.applyOptions?.additionalSourceInstanceIds?.includes("joiner")
    );

    expect(node?.fields).toEqual([
      "additionalAttackExhaustCostSourceInstanceIds",
      "additionalSourceInstanceIds",
    ]);
    expect(joinChoices?.map((choice) => choice.applyOptions)).toEqual([
      {
        additionalSourceInstanceIds: ["joiner"],
        additionalAttackExhaustCostSourceInstanceIds: { joiner: "join-cost" },
      },
    ]);
  });

  it("exposes brave separation core distributions as action-input choices", () => {
    const host = createCardInstance(normalCard, {
      instanceId: "host",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
      attachedChildrenIds: ["brave"],
    });
    const brave = createCardInstance(normalCard, {
      instanceId: "brave",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
      minimumRequiredCores: 2,
      attachedToInstanceId: "host",
    });
    const ally = createCardInstance(normalCard, {
      instanceId: "ally",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave, ally],
      playerOverrides: [{}, { reserveNormalCoreCount: 2 }],
    });
    const state = {
      ...base,
      activePlayerId: "bob",
      step: "main" as const,
    };
    const action = {
      kind: "brave_separate",
      actionId: "legal:brave-separate:host:brave",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      hostInstanceId: "host",
      braveInstanceId: "brave",
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action, {
      getCardDefinitionById,
      maxGeneratedChoices: 8,
    });
    const distributions = node?.choices.map(
      (choice) => choice.applyOptions?.separateCoreDistribution
    );

    expect(node?.fields).toEqual(["separateCoreDistribution"]);
    expect(distributions).toHaveLength(3);
    expect(distributions).toEqual(
      expect.arrayContaining([
        { ally: 2 },
        { reserve: 1, ally: 1 },
        { reserve: 2 },
      ])
    );

    const keepAction = {
      kind: "resolve_brave_leave_choice",
      actionId: "brave-leave-keep-host",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      hostInstanceId: "host",
      braveInstanceIds: ["brave"],
      choice: "keep",
    } as LegalAction;
    const keepNode = createActionInputDecisionNode(state, keepAction, {
      getCardDefinitionById,
      maxGeneratedChoices: 8,
    });

    expect(keepNode?.fields).toEqual(["separateCoreDistribution"]);
    expect(
      keepNode?.choices.map(
        (choice) => choice.applyOptions?.separateCoreDistribution
      )
    ).toEqual(expect.arrayContaining([{ ally: 2 }, { reserve: 2 }]));
  });

  it("exposes burst source follow-up enter-field placements", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(normalCard, {
          instanceId: "burst-source",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      playerOverrides: [{}, { reserveNormalCoreCount: 1 }],
    });
    const action = {
      chainId: "test:training-decision-surface-coverage:1831",
      kind: "resolve_pending_burst_check",
      actionId: "burst-source-follow-up",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      checkId: "burst-check",
      eventKind: "reduce_life",
      relatedPlayerId: "bob",
      sourceKind: "spirit",
      sourceInstanceId: "burst-source",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      registrationIndex: 0,
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      playsSourceCardWithoutCostAfterResolve: true,
      usesSourceCardWithoutCostAfterResolve: false,
      playsTargetCardWithoutCostAfterResolve: false,
      usesTargetCardWithoutCostAfterResolve: false,
      enterFieldCorePlacementRule: "required_minimum",
      minimumEnterFieldCoreCount: 1,
      maximumEnterFieldCoreCount: 1,
      requiresEnterFieldCorePlacements: true,
      targetFollowUpMagicOptions: [],
      targetEnterFieldCorePlacementOptions: [],
    } as LegalAction;

    const node = createActionInputDecisionNode(base, action);

    expect(node?.fields).toEqual(["enterFieldCorePlacements"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual([
      { enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }] },
    ]);
  });

  it("includes waiting cores but excludes independently managed cores from placement choices", () => {
    const guidedNexus: CardDefinition = {
      ...normalCard,
      cardNo: "TEST-GUIDED-NEXUS",
      name: "AI Surface Guided Nexus",
      category: "nexus",
      printedCategory: "nexus",
      grandwalkerData: {
        kind: "guided",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    };
    const pendingSource = fieldCard("pending-source", {
      normalCoreCount: 2,
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "state_based_action",
      pendingLeaveChainId: "sba:pending-source",
    });
    const immovableSource = createCardInstance(guidedNexus, {
      instanceId: "guided-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [pendingSource, immovableSource],
      playerOverrides: [{}, { reserveNormalCoreCount: 1 }],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "pending-source",
        kind: "vanish",
        cause: "state_based_action",
        causePlayerId: null,
        chainId: "sba:pending-source",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ];
    const action = {
      kind: "resolve_pending_enter_field_placement",
      actionId: "efp-test",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      pendingId: "pending-placement",
      sourceInstanceId: "new-spirit",
      sourceDefinitionId: normalCard.cardNo,
      minimumCoreCount: 1,
      maximumCoreCount: 1,
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action, {
      getCardDefinitionById: (id) =>
        id === guidedNexus.cardNo ? guidedNexus : getCardDefinitionById(id),
    });

    expect(node?.fields).toEqual(["enterFieldCorePlacements"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual([
      {
        enterFieldCorePlacements: [
          { kind: "card_normal", instanceId: "pending-source", amount: 1 },
        ],
      },
      { enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }] },
    ]);
  });

  it("factors an enter-field placement at the 65th atomic candidate", () => {
    const entering = createCardInstance(normalCard, {
      instanceId: "threshold-entering-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      zoneRoleName: "spirit",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [entering],
        playerOverrides: [{}, { reserveNormalCoreCount: 64 }],
      }),
      pendingEnterFieldPlacement: {
        pendingId: "threshold-enter-field-pending",
        actingPlayerId: "bob",
        sourceInstanceId: entering.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        deferredStack: {
          stackId: "threshold-enter-field-stack",
          actionKind: "summon",
          chainId: "threshold-enter-field-chain",
          actingPlayerId: "bob",
          cardInstanceId: entering.instanceId,
          cardDefinitionId: normalCard.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
        },
        remainingStacks: [],
        minimumCoreCount: 0,
        maximumCoreCount: 64,
      },
    };
    const action = {
      kind: "resolve_pending_enter_field_placement",
      actionId: "threshold-enter-field-action",
      can: true,
      reason: "pending_enter_field_placement",
      actingPlayerId: "bob",
      pendingId: "threshold-enter-field-pending",
      sourceInstanceId: entering.instanceId,
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      minimumCoreCount: 0,
      maximumCoreCount: 64,
    } as LegalAction;

    const cappedNode = createActionInputDecisionNode(state, action, {
      getCardDefinitionById,
      maxGeneratedChoices: 64,
    });
    expect(cappedNode).toMatchObject({
      kind: "action_input",
      fields: ["enterFieldCorePlacements"],
      truncated: true,
    });
    expect(cappedNode?.choices).toHaveLength(64);

    const node = createActionInputDecisionNode(state, action, {
      getCardDefinitionById,
      maxGeneratedChoices: 1024,
    });

    expect(node).toMatchObject({
      kind: "action_input",
      fields: ["enterFieldCorePlacements"],
      truncated: false,
    });
    expect(node?.choices).toHaveLength(65);
    expect(
      node?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_multi_placement_source"
      )
    ).toBe(true);
  });
  it("factors a wide enter-field placement and commits the selected sources", () => {
    const entering = createCardInstance(normalCard, {
      instanceId: "wide-entering-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      zoneRoleName: "spirit",
    });
    const fieldSourceA = fieldCard("wide-placement-source-a", {
      normalCoreCount: 2,
      minimumRequiredCores: 0,
    });
    const fieldSourceB = fieldCard("wide-placement-source-b", {
      normalCoreCount: 2,
      minimumRequiredCores: 0,
    });
    const fieldSourceC = fieldCard("wide-placement-source-c", {
      normalCoreCount: 2,
      minimumRequiredCores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [entering, fieldSourceA, fieldSourceB, fieldSourceC],
        playerOverrides: [{}, { reserveNormalCoreCount: 2 }],
      }),
      pendingEnterFieldPlacement: {
        pendingId: "wide-enter-field-pending",
        actingPlayerId: "bob",
        sourceInstanceId: entering.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        deferredStack: {
          stackId: "wide-enter-field-stack",
          actionKind: "summon",
          chainId: "wide-enter-field-chain",
          actingPlayerId: "bob",
          cardInstanceId: entering.instanceId,
          cardDefinitionId: normalCard.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
        },
        remainingStacks: [],
        minimumCoreCount: 1,
        maximumCoreCount: null,
      },
    };
    const action = {
      kind: "resolve_pending_enter_field_placement",
      actionId: "wide-enter-field-action",
      can: true,
      reason: "pending_enter_field_placement",
      actingPlayerId: "bob",
      pendingId: "wide-enter-field-pending",
      sourceInstanceId: entering.instanceId,
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      minimumCoreCount: 1,
      maximumCoreCount: null,
    } as LegalAction;
    const surfaceOptions = {
      getCardDefinitionById,
      maxGeneratedChoices: 1024,
    };

    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    for (let sourceIndex = 0; sourceIndex < 4; sourceIndex++) {
      expect(node).toMatchObject({
        kind: "action_input",
        fields: ["enterFieldCorePlacements"],
        truncated: false,
      });
      const normalAmount = sourceIndex === 0 ? 1 : 0;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_multi_placement_source" &&
          candidate.systemAction.sourceIndex === sourceIndex &&
          candidate.systemAction.normalAmount === normalAmount &&
          candidate.systemAction.soulAmount === 0
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      if (sourceIndex < 3) {
        node = getNextTrainingDecision(current, testEngine, surfaceOptions);
      }
    }

    expect(current.pendingEnterFieldPlacement).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === entering.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(current.players[1]?.reserveNormalCoreCount).toBe(1);
    expect(
      current.cardInstances
        .filter((card) => card.instanceId.startsWith("wide-placement-source-"))
        .map((card) => card.normalCoreCount)
    ).toEqual([2, 2, 2]);
  });
  it("factors a single-target multi-placement by source without truncating its legal allocations", () => {
    const destination = fieldCard("placement-destination", {
      normalCoreCount: 0,
      minimumRequiredCores: 1,
    });
    const fieldSourceA = fieldCard("placement-source-a", {
      normalCoreCount: 9,
      minimumRequiredCores: 0,
    });
    const fieldSourceB = fieldCard("placement-source-b", {
      normalCoreCount: 9,
      minimumRequiredCores: 0,
    });
    const fieldSourceC = fieldCard("placement-source-c", {
      normalCoreCount: 9,
      minimumRequiredCores: 0,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [destination, fieldSourceA, fieldSourceB, fieldSourceC],
        playerOverrides: [{}, { reserveNormalCoreCount: 9 }],
      }),
      pendingMultiPlacement: {
        pendingId: "placement-pending",
        actingPlayerId: "bob",
        sourceInstanceId: destination.instanceId,
        sourceDefinitionId: normalCard.cardNo,
        targets: [
          {
            instanceId: destination.instanceId,
            definitionId: normalCard.cardNo,
            minimumCoreCount: 10,
            maximumCoreCount: null,
            enterFieldEventKind: "summon" as const,
          },
        ],
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const action = {
      kind: "resolve_pending_multi_placement",
      actionId: "placement-pending-action",
      can: true,
      reason: "pending_multi_placement",
      actingPlayerId: "bob",
      pendingId: "placement-pending",
      sourceInstanceId: destination.instanceId,
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      targets: state.pendingMultiPlacement.targets,
    } as LegalAction;
    const surfaceOptions = {
      getCardDefinitionById,
      maxGeneratedChoices: 1024,
    };

    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    expect(node?.truncated).toBe(false);
    expect(node?.choices).toHaveLength(10); // reserve: 0 through 9 normal cores

    const reserveNone = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.kind === "reserve" &&
        choice.systemAction.normalAmount === 0
    );
    expect(reserveNone).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      reserveNone!,
      testEngine
    );

    node = getNextTrainingDecision(current, testEngine, surfaceOptions);
    expect(node?.kind).toBe("action_input");
    expect(node?.truncated).toBe(false);
    const fieldANone = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.instanceId === fieldSourceA.instanceId &&
        choice.systemAction.normalAmount === 0
    );
    expect(fieldANone).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      fieldANone!,
      testEngine
    );

    // A zero allocation at the third source would leave only nine cores at
    // the final source, below the required ten. Do not expose that dead-end.
    node = getNextTrainingDecision(current, testEngine, surfaceOptions);
    expect(
      node?.choices.some(
        (choice) =>
          choice.systemAction?.kind === "select_multi_placement_source" &&
          choice.systemAction.normalAmount === 0
      )
    ).toBe(false);
    const fieldBOne = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.instanceId === fieldSourceB.instanceId &&
        choice.systemAction.normalAmount === 1
    );
    expect(fieldBOne).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      fieldBOne!,
      testEngine
    );

    node = getNextTrainingDecision(current, testEngine, surfaceOptions);
    const fieldCAll = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.instanceId === fieldSourceC.instanceId &&
        choice.systemAction.normalAmount === 9
    );
    expect(fieldCAll).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      fieldCAll!,
      testEngine
    );

    expect(current.pendingMultiPlacement).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === destination.instanceId
      )?.normalCoreCount
    ).toBe(10);
  });

  it("factors optional enter-field placement by source without truncating its legal allocations", () => {
    const trashPlacementCard: CardDefinition = {
      ...normalCard,
      cardNo: "TEST-AI-SURFACE-TRASH-PLACEMENT",
      name: "AI Surface Trash Placement Test",
      tribe: "CB",
    };
    const placementEngine: Engine = {
      ...testEngine,
      cards: [normalCard, trashPlacementCard],
      getCardDefinitionById: (id) =>
        id === trashPlacementCard.cardNo
          ? trashPlacementCard
          : id === normalCard.cardNo
            ? normalCard
            : undefined,
    };
    const destination = createCardInstance(trashPlacementCard, {
      instanceId: "enter-field-placement-destination",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const fieldSourceA = createCardInstance(normalCard, {
      instanceId: "enter-field-placement-source-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 9,
      minimumRequiredCores: 0,
    });
    const fieldSourceB = createCardInstance(normalCard, {
      instanceId: "enter-field-placement-source-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 9,
      minimumRequiredCores: 0,
    });
    const fieldSourceC = createCardInstance(normalCard, {
      instanceId: "enter-field-placement-source-c",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 9,
      minimumRequiredCores: 0,
    });
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [destination, fieldSourceA, fieldSourceB, fieldSourceC],
        playerOverrides: [
          { reserveNormalCoreCount: 10, trashNormalCoreCount: 1 },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        {
          effectId: "training-grant-trash-placement",
          sourceInstanceId: "training-grant-source",
          sourceDefinitionId: "TEST-GRANT-SOURCE",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "grant_summon_trash_core_placement",
          targetInstanceId: "alice",
          metadata: {
            filter: { category: ["spirit"], tribes: ["CB"] },
            amount: 1,
          },
        },
      ],
    };
    const summon = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: placementEngine.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (candidate): candidate is Extract<LegalAction, { kind: "summon" }> =>
        candidate.kind === "summon"
    );
    expect(summon).toBeDefined();
    const opened = applyLegalAction({
      state: current,
      action: summon!,
      getCardDefinitionById: placementEngine.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    const pass = getLegalActions({
      state: opened,
      actingPlayerId: "bob",
      getCardDefinitionById: placementEngine.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: placementEngine.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).state;
    const action = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: placementEngine.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (
        candidate
      ): candidate is Extract<
        LegalAction,
        { kind: "resolve_pending_enter_field_placement" }
      > => candidate.kind === "resolve_pending_enter_field_placement"
    );
    expect(action).toBeDefined();
    expect(action?.maximumCoreCount).toBeNull();
    const surfaceOptions = {
      getCardDefinitionById: placementEngine.getCardDefinitionById,
      maxGeneratedChoices: 1024,
    };

    let node = createActionInputDecisionNode(current, action!, surfaceOptions);
    expect(node?.fields).toEqual(["enterFieldCorePlacements"]);
    expect(node?.truncated).toBe(false);
    expect(node?.choices).toHaveLength(10); // reserve: 0 through 9 normal cores

    const reserveNone = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.kind === "reserve" &&
        choice.systemAction.normalAmount === 0
    );
    expect(reserveNone).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      reserveNone!,
      placementEngine
    );

    node = getNextTrainingDecision(current, placementEngine, surfaceOptions);
    expect(node?.truncated).toBe(false);
    const trashOne = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.kind === "trash" &&
        choice.systemAction.normalAmount === 1
    );
    expect(trashOne).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      trashOne!,
      placementEngine
    );

    node = getNextTrainingDecision(current, placementEngine, surfaceOptions);
    expect(node?.truncated).toBe(false);
    const fieldAAll = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.instanceId === fieldSourceA.instanceId &&
        choice.systemAction.normalAmount === 9
    );
    expect(fieldAAll).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      fieldAAll!,
      placementEngine
    );

    node = getNextTrainingDecision(current, placementEngine, surfaceOptions);
    expect(node?.truncated).toBe(false);
    const fieldBFour = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.instanceId === fieldSourceB.instanceId &&
        choice.systemAction.normalAmount === 4
    );
    expect(fieldBFour).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      fieldBFour!,
      placementEngine
    );

    node = getNextTrainingDecision(current, placementEngine, surfaceOptions);
    expect(node?.truncated).toBe(false);
    const fieldCNone = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_multi_placement_source" &&
        choice.systemAction.source.instanceId === fieldSourceC.instanceId &&
        choice.systemAction.normalAmount === 0
    );
    expect(fieldCNone).toBeDefined();
    current = applyTrainingDecisionChoice(
      current,
      node!,
      fieldCNone!,
      placementEngine
    );

    expect(current.pendingEnterFieldPlacement).toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === destination.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 14 });
    expect(
      current.players.find((player) => player.id === "alice")
        ?.trashNormalCoreCount
    ).toBe(1); // one initial trash core plus one spent as the summon cost
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === fieldSourceA.instanceId
      )?.normalCoreCount
    ).toBe(0);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === fieldSourceB.instanceId
      )?.normalCoreCount
    ).toBe(5);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === fieldSourceC.instanceId
      )?.normalCoreCount
    ).toBe(9);
  });

  it("flushes pending leaves created by training manual core moves", () => {
    const pendingSource = fieldCard("pending-source");
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [pendingSource, fieldCard("live-spirit")],
        playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
      }),
      activePlayerId: "bob",
      step: "main" as const,
      window: "none" as const,
    };
    const node: TrainingDecisionNode = {
      nodeId: "manual-core-move-test",
      kind: "legal_action",
      actingPlayerId: "bob",
      fields: [],
      choices: [
        {
          choiceId: "manual-core-move-test:choice",
          label: "manual_core_move",
          systemAction: {
            kind: "manual_core_move",
            actingPlayerId: "bob",
            drafts: [
              {
                kind: "normal",
                from: { kind: "card", instanceId: "pending-source" },
                to: { kind: "card", instanceId: "live-spirit" },
                amount: 1,
                purpose: "core_move",
              },
            ],
          },
        },
      ],
      truncated: false,
    };

    const next = applyTrainingDecisionChoice(
      state,
      node,
      node.choices[0]!,
      testEngine
    );

    expect(next.pendingLeaveEntities).toHaveLength(0);
    expect(
      next.cardInstances.find((card) => card.instanceId === "pending-source")
        ?.zone
    ).toBe("trash");
    expect(
      next.cardInstances.find((card) => card.instanceId === "live-spirit")
        ?.normalCoreCount
    ).toBe(2);
  });

  it("defers battle-immediate target-group selection until stack closes", () => {
    const action = {
      kind: "resolve_battle_immediate_effect",
      actionId: "battle-immediate-target-groups",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      promptId: "battle-immediate-test",
      attackId: "attack-test",
      timing: "attack",
      sourceKind: "spirit",
      sourceInstanceId: "attacker",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      participantEntityId: "battle-entity:attacker",
      registrationIndex: 0,
      executionMode: "optional",
      targetMode: "manual",
      requiredTargetCount: 1,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: ["trash-target"],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      targetGroups: [
        {
          requiredTargetCount: 0,
          targetStepId: "__step_0",
          candidateTargetZones: ["field"],
          candidateTargetInstanceIds: [],
        },
        {
          requiredTargetCount: 1,
          targetStepId: "__step_1",
          candidateTargetZones: ["trash"],
          candidateTargetInstanceIds: ["trash-target"],
        },
      ],
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action);

    expect(node?.fields).toEqual(["skipOptionalEffect"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual([
      { skipOptionalEffect: false },
      { skipOptionalEffect: true },
    ]);
  });

  it("does not factor battle-immediate targets that stay deferred until stack close", () => {
    const action = {
      kind: "resolve_battle_immediate_effect",
      actionId: "battle-immediate-wide-deferred-targets",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      promptId: "battle-immediate-wide-deferred-targets",
      attackId: "attack-test",
      timing: "attack",
      sourceKind: "spirit",
      sourceInstanceId: "attacker",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      participantEntityId: "battle-entity:attacker",
      registrationIndex: 0,
      executionMode: "optional",
      targetMode: "manual",
      requiredTargetCount: 0,
      maxTargetCount: 9,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: Array.from(
        { length: 9 },
        (_, index) => `deferred-target-${index}`
      ),
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      requiredPayCostAmount: 1,
    } as LegalAction;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 1 },
        { reserveNormalCoreCount: 0 },
      ],
    });

    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 1024,
    });

    expect(node?.nodeId).toBe(`${action.actionId}:input`);
    expect(node?.truncated).toBe(false);
    expect(node?.fields).not.toContain("targetInstanceIds");
    expect(node?.choices).toHaveLength(2);
    expect(
      node?.choices.some(
        (choice) => choice.applyOptions?.skipOptionalEffect === true
      )
    ).toBe(true);
    expect(
      node?.choices.some(
        (choice) => choice.applyOptions?.deferPayCostSourceSelection === true
      )
    ).toBe(true);
    expect(
      node?.choices.some(
        (choice) => choice.applyOptions?.payCostPaymentSources !== undefined
      )
    ).toBe(false);
    expect(
      node?.choices.every(
        (choice) =>
          choice.systemAction?.kind !== "select_factored_target_selection"
      )
    ).toBe(true);
  });

  it("keeps dedicated paid-prevention truncation visible instead of factoring unrelated targets", () => {
    const action = {
      kind: "resolve_pending_triggered_effect",
      actionId: "triggered-effect-wide-paid-prevention",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "triggered-effect-wide-paid-prevention",
      sourceInstanceId: "trigger-source",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      effectIndex: 0,
      executionMode: "mandatory",
      targetMode: "manual",
      requiredTargetCount: 0,
      maxTargetCount: 9,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: Array.from(
        { length: 9 },
        (_, index) => `unrelated-target-${index}`
      ),
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      paidPreventionImmunityCardCostCandidateInstanceIds: Array.from(
        { length: 20 },
        (_, index) => `prevention-cost-${index}`
      ),
      paidPreventionImmunityCardCostAmount: 3,
    } as LegalAction;

    const node = createActionInputDecisionNode(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      action,
      { maxGeneratedChoices: 1024 }
    );

    expect(node?.nodeId).toBe(`${action.actionId}:input`);
    expect(node?.fields).toEqual(["paidPreventionImmunityCardSelection"]);
    expect(node?.choices).toHaveLength(1024);
    expect(node?.truncated).toBe(true);
    expect(
      node?.choices.every(
        (choice) =>
          choice.systemAction?.kind !== "select_factored_target_selection"
      )
    ).toBe(true);
  });

  it("exposes single target follow-up magic target and life-core choices", () => {
    const action = {
      chainId: "test:training-decision-surface-coverage:2721",
      kind: "resolve_pending_burst_check",
      actionId: "burst-target-follow-up-magic",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      checkId: "burst-check",
      eventKind: "reduce_life",
      relatedPlayerId: "bob",
      sourceKind: "spirit",
      sourceInstanceId: "burst-source",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      registrationIndex: 0,
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      playsSourceCardWithoutCostAfterResolve: false,
      usesSourceCardWithoutCostAfterResolve: false,
      playsTargetCardWithoutCostAfterResolve: false,
      usesTargetCardWithoutCostAfterResolve: true,
      enterFieldCorePlacementRule: "optional",
      minimumEnterFieldCoreCount: 0,
      maximumEnterFieldCoreCount: null,
      requiresEnterFieldCorePlacements: false,
      targetFollowUpMagicOptions: [
        {
          targetInstanceId: "follow-up-magic",
          targetMode: "manual",
          requiredTargetCount: 1,
          targetEffectFilterTags: ["general"],
          candidateTargetInstanceIds: ["follow-up-target"],
          availableChosenLifeCoreKinds: ["normal", "soul"],
          requiresChosenLifeCoreKind: true,
        },
      ],
      targetEnterFieldCorePlacementOptions: [],
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.fields).toEqual([
      "followUpChosenLifeCoreKind",
      "followUpTargetInstanceIds",
    ]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual(
      expect.arrayContaining([
        {
          followUpTargetInstanceIds: ["follow-up-target"],
          followUpChosenLifeCoreKind: "normal",
        },
        {
          followUpTargetInstanceIds: ["follow-up-target"],
          followUpChosenLifeCoreKind: "soul",
        },
      ])
    );
  });

  it("exposes per-target follow-up inputs for multiple target magic candidates", () => {
    const action = {
      chainId: "test:training-decision-surface-coverage:2786",
      kind: "resolve_pending_burst_check",
      actionId: "burst-multi-target-follow-up-magic",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      checkId: "burst-check",
      eventKind: "reduce_life",
      relatedPlayerId: "bob",
      sourceKind: "spirit",
      sourceInstanceId: "burst-source",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      registrationIndex: 0,
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      playsSourceCardWithoutCostAfterResolve: false,
      usesSourceCardWithoutCostAfterResolve: false,
      playsTargetCardWithoutCostAfterResolve: false,
      usesTargetCardWithoutCostAfterResolve: true,
      enterFieldCorePlacementRule: "optional",
      minimumEnterFieldCoreCount: 0,
      maximumEnterFieldCoreCount: null,
      requiresEnterFieldCorePlacements: false,
      targetFollowUpMagicOptions: [
        {
          targetInstanceId: "follow-up-magic-a",
          targetMode: "manual",
          requiredTargetCount: 1,
          targetEffectFilterTags: ["general"],
          candidateTargetInstanceIds: ["target-a"],
          availableChosenLifeCoreKinds: [],
          requiresChosenLifeCoreKind: false,
        },
        {
          targetInstanceId: "follow-up-magic-b",
          targetMode: "manual",
          requiredTargetCount: 1,
          targetEffectFilterTags: ["general"],
          candidateTargetInstanceIds: ["target-b"],
          availableChosenLifeCoreKinds: ["normal", "soul"],
          requiresChosenLifeCoreKind: true,
        },
      ],
      targetEnterFieldCorePlacementOptions: [],
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.fields).toEqual(["followUpPerTargetInputs"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual(
      expect.arrayContaining([
        {
          followUpPerTargetInputs: [
            {
              targetInstanceId: "follow-up-magic-a",
              followUpTargetInstanceIds: ["target-a"],
            },
            {
              targetInstanceId: "follow-up-magic-b",
              followUpTargetInstanceIds: ["target-b"],
              followUpChosenLifeCoreKind: "normal",
            },
          ],
        },
        {
          followUpPerTargetInputs: [
            {
              targetInstanceId: "follow-up-magic-a",
              followUpTargetInstanceIds: ["target-a"],
            },
            {
              targetInstanceId: "follow-up-magic-b",
              followUpTargetInstanceIds: ["target-b"],
              followUpChosenLifeCoreKind: "soul",
            },
          ],
        },
      ])
    );
  });

  it("exposes per-target follow-up placement inputs for target card play", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{}, { reserveNormalCoreCount: 1 }],
    });
    const action = {
      chainId: "test:training-decision-surface-coverage:2879",
      kind: "resolve_pending_burst_check",
      actionId: "burst-target-follow-up-play",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
      checkId: "burst-check",
      eventKind: "reduce_life",
      relatedPlayerId: "bob",
      sourceKind: "spirit",
      sourceInstanceId: "burst-source",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      registrationIndex: 0,
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      playsSourceCardWithoutCostAfterResolve: false,
      usesSourceCardWithoutCostAfterResolve: false,
      playsTargetCardWithoutCostAfterResolve: true,
      usesTargetCardWithoutCostAfterResolve: false,
      enterFieldCorePlacementRule: "required_minimum",
      minimumEnterFieldCoreCount: 1,
      maximumEnterFieldCoreCount: 1,
      requiresEnterFieldCorePlacements: true,
      targetFollowUpMagicOptions: [],
      targetEnterFieldCorePlacementOptions: [
        {
          targetInstanceId: "follow-up-spirit",
          enterFieldCorePlacementRule: "required_minimum",
          minimumEnterFieldCoreCount: 1,
          maximumEnterFieldCoreCount: 1,
          requiresEnterFieldCorePlacements: true,
        },
      ],
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action);

    expect(node?.fields).toEqual(["followUpPerTargetInputs"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual([
      {
        followUpPerTargetInputs: [
          {
            targetInstanceId: "follow-up-spirit",
            enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      },
    ]);
  });

  it("exposes optional effect execution and decline as action-input choices", () => {
    const action = {
      chainId: "test:training-decision-surface-coverage:2935",
      kind: "resolve_pending_triggered_effect",
      actionId: "optional-trigger",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-1",
      eventKind: "test",
      executionMode: "optional",
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action);

    expect(node?.fields).toEqual(["skipOptionalEffect"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual(
      expect.arrayContaining([
        { skipOptionalEffect: false },
        { skipOptionalEffect: true },
      ])
    );
  });

  it("exposes soul-core-only allocations when they alone satisfy the minimum distribution", () => {
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "core-distribution",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-core",
      candidates: [{ instanceId: "target-1", definitionId: normalCard.cardNo }],
      totalNormalCores: 0,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      sourceAvailable: {},
      soulSourceAvailable: { reserve: 1, trash: 1 },
      minTotal: 1,
      fromPlayerId: "alice",
      toPlayerId: "alice",
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.fields).toContain("coreDistributionSoulCoreSourceAllocations");
    expect(
      node?.choices.map(
        (choice) =>
          choice.applyOptions?.coreDistributionSoulCoreSourceAllocations
      )
    ).toEqual(expect.arrayContaining([{ reserve: 1 }, { trash: 1 }]));
    expect(node?.choices).toHaveLength(2);
  });

  it("exposes every required multi-soul-core partition for core distribution", () => {
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "multi-soul-core-distribution",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-multi-soul",
      candidates: [
        { instanceId: "target-1", definitionId: normalCard.cardNo },
        { instanceId: "target-2", definitionId: normalCard.cardNo },
      ],
      totalNormalCores: 0,
      hasSoulCore: true,
      totalSoulCores: 3,
      mustPlaceSoulCore: true,
      fromKind: "trash",
      fromPlayerId: "alice",
      toPlayerId: "alice",
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 16,
    });
    const soulAllocations = node?.choices.map(
      (choice) => choice.applyOptions?.coreDistributionSoulCoreAllocations
    );

    expect(node?.fields).toContain("coreDistributionSoulCoreAllocations");
    expect(soulAllocations).toEqual(
      expect.arrayContaining([
        { "target-1": 3 },
        { "target-1": 2, "target-2": 1 },
        { "target-1": 1, "target-2": 2 },
        { "target-2": 3 },
      ])
    );
    expect(soulAllocations).toHaveLength(4);
  });

  it("filters an any_movable soul allocation that would move a card's core to itself", () => {
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "field-soul-core-distribution",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-field-soul",
      candidates: [
        { instanceId: "target-1", definitionId: normalCard.cardNo },
        { instanceId: "target-2", definitionId: normalCard.cardNo },
      ],
      totalNormalCores: 0,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      allowedSources: [{ kind: "field", instanceId: "target-1" }],
      sourceAvailable: {},
      soulSourceAvailable: { "field:target-1": 1 },
      minTotal: 1,
      fromPlayerId: "alice",
      toPlayerId: "alice",
    } as LegalAction;

    const source = createCardInstance(normalCard, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      soulCoreCount: 1,
    });
    const target = createCardInstance(normalCard, {
      instanceId: "target-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
      playerOverrides: [
        {
          reserveSoulCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "target-1" },
        },
        {},
      ],
    });
    const state = {
      ...base,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      pendingCoreDistribution: {
        pendingId: "pending-field-soul",
        actingPlayerId: "alice",
        sourceInstanceId: "target-1",
        sourceDefinitionId: normalCard.cardNo,
        candidates: [
          { instanceId: "target-1", definitionId: normalCard.cardNo },
          { instanceId: "target-2", definitionId: normalCard.cardNo },
        ],
        totalNormalCores: 0,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable" as const,
        allowedSources: [{ kind: "field" as const, instanceId: "target-1" }],
        sourceAvailable: {},
        soulSourceAvailable: { "field:target-1": 1 },
        minTotal: 1,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual([
      {
        coreDistributionAllocations: {},
        coreDistributionSourceAllocations: {},
        coreDistributionSoulCoreAllocations: { "target-2": 1 },
        coreDistributionSoulCoreSourceAllocations: { "field:target-1": 1 },
      },
    ]);

    const next = applyTrainingDecisionChoice(
      state,
      node!,
      node!.choices[0]!,
      testEngine
    );
    expect(next.pendingCoreDistribution).toBeNull();
    expect(
      next.cardInstances.find((card) => card.instanceId === "target-2")
        ?.soulCoreCount
    ).toBe(1);
  });

  it("generates reachable totals under a four-core move cap with five targets and a soul core", () => {
    const source = fieldCard("source", {
      normalCoreCount: 10,
      soulCoreCount: 1,
    });
    const targets = ["target-1", "target-2", "target-3", "target-4"].map((id) =>
      fieldCard(id, { normalCoreCount: 0 })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...targets],
        playerOverrides: [
          {},
          {
            reserveSoulCoreCount: 0,
            soulCoreLocation: { kind: "card", instanceId: "source" },
          },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "none",
      pendingCoreDistribution: {
        pendingId: "four-core-cap",
        actingPlayerId: "alice",
        sourceInstanceId: "source",
        sourceDefinitionId: normalCard.cardNo,
        candidates: [source, ...targets].map((c) => ({
          instanceId: c.instanceId,
          definitionId: c.definitionId,
        })),
        totalNormalCores: 4,
        hasSoulCore: true,
        totalSoulCores: 1,
        fromKind: "any_movable",
        allowedSources: [{ kind: "field", instanceId: "source" }],
        sourceAvailable: { "field:source": 10 },
        soulSourceAvailable: { "field:source": 1 },
        sourceTotalAvailable: { "field:source": 10 },
        maxTotal: 4,
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources",
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "bob",
        },
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated", mode: "main" },
      },
    };
    const action = {
      ...state.pendingCoreDistribution!,
      kind: "resolve_pending_core_distribution",
      actionId: "four-core-cap",
      can: true,
      reason: "pending_core_distribution",
    } as LegalAction;
    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 128,
    });
    expect(node!.choices.length).toBeGreaterThan(0);
    for (const choice of node!.choices) {
      const totals = choice.applyOptions.coreDistributionAllocations!;
      expect(totals.source).toBeGreaterThanOrEqual(7);
      expect(Object.values(totals).reduce((n, x) => n + x, 0)).toBe(11);
    }
    const ownerState = applyTrainingDecisionChoice(
      state,
      node!,
      node!.choices[0]!,
      testEngine
    );
    const ownerNode = createActionInputDecisionNode(
      ownerState,
      {
        ...action,
        actingPlayerId: "bob",
        targetTotalSelection:
          ownerState.pendingCoreDistribution!.targetTotalSelection,
      } as LegalAction,
      { maxGeneratedChoices: 128 }
    );
    expect(ownerNode!.choices.length).toBeGreaterThan(0);
    const after = applyTrainingDecisionChoice(
      ownerState,
      ownerNode!,
      ownerNode!.choices[0]!,
      testEngine
    );
    expect(after.pendingCoreDistribution).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")
    ).toMatchObject({ normalCoreCount: 7, soulCoreCount: 0 });
    expect(
      after.cardInstances
        .filter((c) => c.instanceId.startsWith("target-"))
        .reduce((n, c) => n + c.normalCoreCount + c.soulCoreCount, 0)
    ).toBe(4);
    expect(after.cardInstances.reduce((n, c) => n + c.soulCoreCount, 0)).toBe(
      1
    );
    expect(after.players[1]!.reserveNormalCoreCount).toBe(
      state.players[1]!.reserveNormalCoreCount
    );
  });

  it("keeps a source card's cores in place when its owner resolves fixed target totals", () => {
    const source = createCardInstance(normalCard, {
      instanceId: "source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const target = createCardInstance(normalCard, {
      instanceId: "target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
    });
    const state = {
      ...base,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      pendingCoreDistribution: {
        pendingId: "pending-fixed-target-totals",
        actingPlayerId: "bob",
        sourceInstanceId: "source",
        sourceDefinitionId: normalCard.cardNo,
        candidates: [
          { instanceId: "source", definitionId: normalCard.cardNo },
          { instanceId: "target", definitionId: normalCard.cardNo },
        ],
        totalNormalCores: 2,
        hasSoulCore: false,
        fromKind: "any_movable" as const,
        allowedSources: [{ kind: "field" as const, instanceId: "source" }],
        sourceAvailable: { "field:source": 2 },
        sourceTotalAvailable: { "field:source": 2 },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources" as const,
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "bob",
          fixedTargetTotals: { source: 2, target: 0 },
        },
        maxTotal: 2,
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-pending-fixed-target-totals",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "bob",
      pendingId: "pending-fixed-target-totals",
      candidates: state.pendingCoreDistribution.candidates,
      totalNormalCores: 2,
      hasSoulCore: false,
      fromKind: "any_movable",
      allowedSources: state.pendingCoreDistribution.allowedSources,
      sourceAvailable: state.pendingCoreDistribution.sourceAvailable,
      sourceTotalAvailable: state.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection: state.pendingCoreDistribution.targetTotalSelection,
      maxTotal: 2,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual([
      {
        coreDistributionAllocations: {},
        coreDistributionSourceAllocations: {},
      },
    ]);
    const next = applyTrainingDecisionChoice(
      state,
      node!,
      node!.choices[0]!,
      testEngine
    );
    expect(next.pendingCoreDistribution).toBeNull();
    expect(
      next.cardInstances.find((card) => card.instanceId === "source")
        ?.normalCoreCount
    ).toBe(2);
  });

  it("offers reachable final totals to the target chooser before the source owner allocates cores", () => {
    const source = createCardInstance(normalCard, {
      instanceId: "source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const target = createCardInstance(normalCard, {
      instanceId: "target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      pendingCoreDistribution: {
        pendingId: "pending-target-total-chooser",
        actingPlayerId: "alice",
        sourceInstanceId: "source",
        sourceDefinitionId: normalCard.cardNo,
        candidates: [
          { instanceId: "source", definitionId: normalCard.cardNo },
          { instanceId: "target", definitionId: normalCard.cardNo },
        ],
        totalNormalCores: 2,
        hasSoulCore: false,
        fromKind: "any_movable" as const,
        allowedSources: [
          { kind: "field" as const, instanceId: "source" },
          { kind: "field" as const, instanceId: "target" },
        ],
        sourceAvailable: { "field:source": 1, "field:target": 1 },
        sourceTotalAvailable: { "field:source": 1, "field:target": 1 },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources" as const,
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "bob",
        },
        maxTotal: 4,
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated" as const, mode: "flash" as const },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-pending-target-total-chooser",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "alice",
      pendingId: "pending-target-total-chooser",
      candidates: state.pendingCoreDistribution.candidates,
      totalNormalCores: 2,
      hasSoulCore: false,
      fromKind: "any_movable",
      allowedSources: state.pendingCoreDistribution.allowedSources,
      sourceAvailable: state.pendingCoreDistribution.sourceAvailable,
      sourceTotalAvailable: state.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection: state.pendingCoreDistribution.targetTotalSelection,
      maxTotal: 4,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 16,
    });
    expect(node?.choices).not.toHaveLength(0);
    expect(
      node?.choices.some(
        (choice) =>
          choice.applyOptions?.coreDistributionAllocations?.source === 2 &&
          choice.applyOptions.coreDistributionAllocations.target === 2
      )
    ).toBe(true);

    for (const choice of node?.choices ?? []) {
      const next = applyTrainingDecisionChoice(
        state,
        node!,
        choice,
        testEngine
      );
      expect(next.pendingCoreDistribution).toMatchObject({
        actingPlayerId: "bob",
        targetTotalSelection: {
          fixedTargetTotals: choice.applyOptions?.coreDistributionAllocations,
        },
      });
    }
  });

  it("does not offer target totals that leave the source owner below the required core move", () => {
    const source = createCardInstance(normalCard, {
      instanceId: "source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const target = createCardInstance(normalCard, {
      instanceId: "target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      pendingCoreDistribution: {
        pendingId: "pending-target-total-minimum-move",
        actingPlayerId: "alice",
        sourceInstanceId: "source",
        sourceDefinitionId: normalCard.cardNo,
        candidates: [
          { instanceId: "source", definitionId: normalCard.cardNo },
          { instanceId: "target", definitionId: normalCard.cardNo },
        ],
        totalNormalCores: 2,
        hasSoulCore: false,
        fromKind: "any_movable" as const,
        allowedSources: [{ kind: "field" as const, instanceId: "source" }],
        sourceAvailable: { "field:source": 1 },
        sourceTotalAvailable: { "field:source": 1 },
        targetTotalSelection: {
          mode: "target_totals_then_core_owner_sources" as const,
          targetChooserPlayerId: "alice",
          sourceOwnerPlayerId: "bob",
        },
        minTotal: 1,
        maxTotal: 1,
        fromPlayerId: "bob",
        toPlayerId: "bob",
        effectTiming: { kind: "activated" as const, mode: "main" as const },
      },
    };
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-pending-target-total-minimum-move",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "alice",
      pendingId: "pending-target-total-minimum-move",
      candidates: state.pendingCoreDistribution.candidates,
      totalNormalCores: 2,
      hasSoulCore: false,
      fromKind: "any_movable",
      allowedSources: state.pendingCoreDistribution.allowedSources,
      sourceAvailable: state.pendingCoreDistribution.sourceAvailable,
      sourceTotalAvailable: state.pendingCoreDistribution.sourceTotalAvailable,
      targetTotalSelection: state.pendingCoreDistribution.targetTotalSelection,
      minTotal: 1,
      maxTotal: 1,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    const targetNode = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 8,
    });
    expect(targetNode?.choices.map((choice) => choice.applyOptions)).toEqual([
      { coreDistributionAllocations: { source: 1, target: 1 } },
    ]);

    const sourceOwnerState = applyTrainingDecisionChoice(
      state,
      targetNode!,
      targetNode!.choices[0]!,
      testEngine
    );
    const sourceOwnerAction = {
      ...action,
      actingPlayerId: "bob",
      targetTotalSelection:
        sourceOwnerState.pendingCoreDistribution!.targetTotalSelection,
    } as LegalAction;
    const sourceOwnerNode = createActionInputDecisionNode(
      sourceOwnerState,
      sourceOwnerAction,
      { maxGeneratedChoices: 8 }
    );
    expect(sourceOwnerNode?.choices).not.toHaveLength(0);

    const resolved = applyTrainingDecisionChoice(
      sourceOwnerState,
      sourceOwnerNode!,
      sourceOwnerNode!.choices[0]!,
      testEngine
    );
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "source")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "target")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("does not expose source-owner allocations above a mixed normal/soul source cap", () => {
    const brave = createCardInstance(normalCard, {
      instanceId: "brave",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const spirit = createCardInstance(normalCard, {
      instanceId: "spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const ultimate = createCardInstance(normalCard, {
      instanceId: "ultimate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave, spirit, ultimate],
    });
    const action = {
      kind: "resolve_pending_core_distribution",
      actionId: "cd-mixed-source-cap",
      can: true,
      reason: "pending_core_distribution",
      actingPlayerId: "bob",
      pendingId: "mixed-source-cap",
      candidates: [
        { instanceId: "brave", definitionId: normalCard.cardNo },
        { instanceId: "spirit", definitionId: normalCard.cardNo },
        { instanceId: "ultimate", definitionId: normalCard.cardNo },
      ],
      totalNormalCores: 3,
      hasSoulCore: true,
      totalSoulCores: 1,
      fromKind: "any_movable",
      allowedSources: [
        { kind: "field", instanceId: "brave" },
        { kind: "field", instanceId: "spirit" },
      ],
      sourceAvailable: { "field:brave": 2, "field:spirit": 1 },
      soulSourceAvailable: { "field:brave": 1 },
      sourceTotalAvailable: { "field:brave": 2, "field:spirit": 1 },
      targetTotalSelection: {
        mode: "target_totals_then_core_owner_sources",
        targetChooserPlayerId: "alice",
        sourceOwnerPlayerId: "bob",
        fixedTargetTotals: { brave: 1, spirit: 0, ultimate: 3 },
      },
      maxTotal: 4,
      fromPlayerId: "bob",
      toPlayerId: "bob",
    } as LegalAction;

    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 64,
    });

    expect(node?.choices).not.toHaveLength(0);
    for (const choice of node?.choices ?? []) {
      const normal =
        choice.applyOptions?.coreDistributionSourceAllocations ?? {};
      const soul =
        choice.applyOptions?.coreDistributionSoulCoreSourceAllocations ?? {};
      expect(
        (normal["field:brave"] ?? 0) + (soul["field:brave"] ?? 0)
      ).toBeLessThanOrEqual(2);
      expect(
        (normal["field:spirit"] ?? 0) + (soul["field:spirit"] ?? 0)
      ).toBeLessThanOrEqual(1);
    }
    expect(
      node?.choices.some(
        (choice) =>
          choice.applyOptions?.coreDistributionAllocations?.ultimate === 3 &&
          choice.applyOptions.coreDistributionSoulCoreAllocations === undefined
      )
    ).toBe(true);
  });

  it("keeps duplicate-capable target inputs on the exhaustive path and counts truncation as policy-controlled", () => {
    const action = {
      kind: "resolve_pending_step_optional_target_selection",
      actionId: "step-optional-target",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-target",
      sourceInstanceId: "source-1",
      sourceDefinitionId: normalCard.cardNo,
      effectIndex: 0,
      stepIndex: 1,
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateTargetInstanceIds: ["target-1", "target-2"],
      allowDuplicateTargets: true,
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.fields).toEqual(["targetInstanceIds"]);
    expect(node?.choices.map((choice) => choice.applyOptions)).toEqual(
      expect.arrayContaining([
        { targetInstanceIds: ["target-1"] },
        { targetInstanceIds: ["target-2"] },
      ])
    );

    const truncatedInputNode = createActionInputDecisionNode(
      testState(),
      action,
      { maxGeneratedChoices: 1 }
    );
    const singleActionNode: TrainingDecisionNode = {
      nodeId: "single-truncated-target-action",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: action.actionId,
          label: action.kind,
          action,
        },
      ],
      truncated: false,
    };

    expect(truncatedInputNode?.choices).toHaveLength(1);
    expect(truncatedInputNode?.truncated).toBe(true);
    expect(
      isPolicyControlledTrainingDecision(singleActionNode, truncatedInputNode)
    ).toBe(true);
  });

  it("factors the EDH-sized ordinary target subset before it reaches the choice cap", () => {
    const action = {
      kind: "use_magic",
      actionId: "edh-large-target-subset",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceDefinitionId: normalCard.cardNo,
      effectIndex: 0,
      targetMode: "manual",
      requiredTargetCount: 0,
      maxTargetCount: 13,
      candidateTargetInstanceIds: Array.from(
        { length: 18 },
        (_, index) => `target-${index}`
      ),
    } as LegalAction;

    const state = testState();
    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 1024,
    });

    expect(node?.truncated).toBe(false);
    expect(node?.fields).toEqual(["targetInstanceIds"]);
    expect(node?.choices).toHaveLength(2);
    expect(
      node?.choices.every(
        (choice) =>
          choice.systemAction?.kind === "select_factored_target_selection"
      )
    ).toBe(true);

    const selectFirst = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "select_factored_target_selection" &&
        choice.systemAction.select
    );
    expect(selectFirst).toBeDefined();
    const afterFirst = applyTrainingDecisionChoice(
      state,
      node!,
      selectFirst!,
      testEngine
    );
    expect(
      (
        afterFirst as {
          trainingTargetSelectionDraft?: {
            candidateIndex: number;
            selectedTargetInstanceIds: readonly string[];
            complete: boolean;
          };
        }
      ).trainingTargetSelectionDraft
    ).toEqual({
      candidateIndex: 1,
      selectedTargetInstanceIds: ["target-0"],
      complete: false,
      actionId: action.actionId,
    });

    const pendingAction = {
      ...action,
      kind: "resolve_pending_effect_target",
      actionId: "edh-large-pending-target-subset",
      pendingId: "pending-edh-target-subset",
    } as LegalAction;
    const completedState = {
      ...state,
      trainingTargetSelectionDraft: {
        actionId: pendingAction.actionId,
        candidateIndex: 18,
        selectedTargetInstanceIds: ["target-0", "target-4", "target-9"],
        complete: true,
      },
    };
    const completedNode = createActionInputDecisionNode(
      completedState,
      pendingAction,
      { maxGeneratedChoices: 1024 }
    );
    expect(completedNode?.truncated).toBe(false);
    expect(completedNode?.choices).toHaveLength(1);
    expect(completedNode?.choices[0]?.applyOptions).toEqual({
      targetInstanceIds: ["target-0", "target-4", "target-9"],
    });
  });

  it("factors a target subset when its payment cross-product reaches the choice cap", () => {
    const candidateTargetInstanceIds = Array.from(
      { length: 9 },
      (_, index) => `cross-product-target-${index}`
    );
    const action = {
      kind: "use_magic",
      actionId: "edh-target-payment-cross-product",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      sourceInstanceId: "cross-product-magic",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: normalCard.cardNo,
      effectIndex: 0,
      timing: "flash",
      targetMode: "manual",
      requiredTargetCount: 0,
      maxTargetCount: 13,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds,
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      reducedCost: 1,
      additionalCost: 0,
      finalCost: 1,
      totalReduction: 0,
      availableReserveCoreAmount: 1,
      availableOnBoardCoreSources: [
        { instanceId: "payment-source-a", availableCoreAmount: 1 },
        { instanceId: "payment-source-b", availableCoreAmount: 1 },
      ],
      availableSoulCoreOnlySources: [],
      costMode: "paid",
    } as LegalAction;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 1 },
        { reserveNormalCoreCount: 0 },
      ],
    });
    const surfaceOptions = { maxGeneratedChoices: 1024 };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    const selectedTargetInstanceIds = [
      candidateTargetInstanceIds[0]!,
      candidateTargetInstanceIds[4]!,
    ];

    for (
      let candidateIndex = 0;
      candidateIndex < candidateTargetInstanceIds.length;
      candidateIndex++
    ) {
      expect(node).toMatchObject({
        fields: ["targetInstanceIds"],
        truncated: false,
      });
      expect(node?.choices.length).toBeLessThanOrEqual(2);
      const select = candidateIndex === 0 || candidateIndex === 4;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_target_selection" &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === select
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      node = createActionInputDecisionNode(current, action, surfaceOptions);
    }

    expect(node?.truncated).toBe(false);
    expect(node?.fields).toEqual(
      expect.arrayContaining(["paymentSources", "targetInstanceIds"])
    );
    expect(node?.choices).toHaveLength(3);
    expect(
      node?.choices.every(
        (choice) =>
          choice.applyOptions?.targetInstanceIds?.join("\0") ===
          selectedTargetInstanceIds.join("\0")
      )
    ).toBe(true);
  });

  it("factors disjoint grouped magic targets before their payment cross-product truncates", () => {
    const nexusTargets = Array.from(
      { length: 7 },
      (_, index) => `bsrk01-r02-nexus-${index}`
    );
    const grandwalkerTargets = Array.from(
      { length: 7 },
      (_, index) => `bsrk01-r02-grandwalker-${index}`
    );
    const action = {
      kind: "use_magic",
      actionId: "bsrk01-r02-grouped-target-payment",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      sourceInstanceId: "bsrk01-r02-magic",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: "BSRK01-R02",
      effectIndex: 0,
      timing: "flash",
      targetMode: "manual",
      requiredTargetCount: 2,
      maxTargetCount: 4,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [...nexusTargets, ...grandwalkerTargets],
      targetGroups: [
        {
          requiredTargetCount: 0,
          maxTargetCount: 2,
          candidateTargetInstanceIds: nexusTargets,
        },
        {
          requiredTargetCount: 2,
          candidateTargetInstanceIds: grandwalkerTargets,
        },
      ],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      reducedCost: 1,
      additionalCost: 0,
      finalCost: 1,
      totalReduction: 0,
      availableReserveCoreAmount: 1,
      availableOnBoardCoreSources: [
        { instanceId: "payment-source-a", availableCoreAmount: 1 },
        { instanceId: "payment-source-b", availableCoreAmount: 1 },
      ],
      availableSoulCoreOnlySources: [],
      costMode: "paid",
    } as LegalAction;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 1 },
        { reserveNormalCoreCount: 0 },
      ],
    });
    const surfaceOptions = { maxGeneratedChoices: 1024 };
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);
    const selectedTargetInstanceIds = [
      nexusTargets[0]!,
      grandwalkerTargets[0]!,
      grandwalkerTargets[3]!,
    ];

    for (const [targetGroupIndex, candidates] of [
      nexusTargets,
      grandwalkerTargets,
    ].entries()) {
      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex++
      ) {
        expect(node).toMatchObject({
          fields: ["targetInstanceIds"],
          truncated: false,
        });
        const select =
          (targetGroupIndex === 0 && candidateIndex === 0) ||
          (targetGroupIndex === 1 &&
            (candidateIndex === 0 || candidateIndex === 3));
        const choice = node?.choices.find(
          (candidate) =>
            candidate.systemAction?.kind ===
              "select_factored_target_selection" &&
            candidate.systemAction.targetGroupIndex === targetGroupIndex &&
            candidate.systemAction.candidateIndex === candidateIndex &&
            candidate.systemAction.select === select
        );
        expect(choice).toBeDefined();
        current = applyTrainingDecisionChoice(
          current,
          node!,
          choice!,
          testEngine
        );
        node = createActionInputDecisionNode(current, action, surfaceOptions);
      }
    }

    expect(node?.truncated).toBe(false);
    expect(node?.fields).toEqual(
      expect.arrayContaining(["paymentSources", "targetInstanceIds"])
    );
    expect(node?.choices).toHaveLength(3);
    expect(
      node?.choices.every(
        (choice) =>
          choice.applyOptions?.targetInstanceIds?.join("\0") ===
          selectedTargetInstanceIds.join("\0")
      )
    ).toBe(true);
  });

  it("skips an empty optional BSRK01-R02 target group while factoring a large required group", () => {
    const grandwalkerTargets = Array.from(
      { length: 50 },
      (_, index) => `bsrk01-r02-grandwalker-${index}`
    );
    const action = {
      kind: "use_magic",
      actionId: "bsrk01-r02-empty-optional-target-group",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      sourceInstanceId: "bsrk01-r02-magic",
      sourceDefinitionId: normalCard.cardNo,
      sourceCardNo: "BSRK01-R02",
      effectIndex: 0,
      timing: "flash",
      targetMode: "manual",
      requiredTargetCount: 2,
      maxTargetCount: 4,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: grandwalkerTargets,
      targetGroups: [
        {
          requiredTargetCount: 0,
          maxTargetCount: 2,
          candidateTargetInstanceIds: [],
        },
        {
          requiredTargetCount: 2,
          candidateTargetInstanceIds: grandwalkerTargets,
        },
      ],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      reducedCost: 1,
      additionalCost: 0,
      finalCost: 1,
      totalReduction: 0,
      availableReserveCoreAmount: 1,
      availableOnBoardCoreSources: [
        { instanceId: "payment-source-a", availableCoreAmount: 1 },
        { instanceId: "payment-source-b", availableCoreAmount: 1 },
      ],
      availableSoulCoreOnlySources: [],
      costMode: "paid",
    } as LegalAction;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 1 },
        { reserveNormalCoreCount: 0 },
      ],
    });
    const surfaceOptions = { maxGeneratedChoices: 1024 };
    const selectedTargetInstanceIds = [
      grandwalkerTargets[0]!,
      grandwalkerTargets[3]!,
    ];
    let current = state;
    let node = createActionInputDecisionNode(current, action, surfaceOptions);

    for (
      let candidateIndex = 0;
      candidateIndex < grandwalkerTargets.length;
      candidateIndex++
    ) {
      expect(node).toMatchObject({
        fields: ["targetInstanceIds"],
        truncated: false,
      });
      const select = candidateIndex === 0 || candidateIndex === 3;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_target_selection" &&
          candidate.systemAction.targetGroupIndex === 1 &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === select
      );
      expect(choice).toBeDefined();
      current = applyTrainingDecisionChoice(
        current,
        node!,
        choice!,
        testEngine
      );
      node = createActionInputDecisionNode(current, action, surfaceOptions);
    }

    expect(node?.truncated).toBe(false);
    expect(node?.fields).toEqual(
      expect.arrayContaining(["paymentSources", "targetInstanceIds"])
    );
    expect(
      node?.choices.every(
        (choice) =>
          choice.applyOptions?.targetInstanceIds?.join("\0") ===
          selectedTargetInstanceIds.join("\0")
      )
    ).toBe(true);
  });

  it("applies a completed factored pending target selection through the MCTS top-level input path", () => {
    const pendingMagicCard: CardDefinition = {
      ...normalCard,
      cardNo: "TEST-AI-SURFACE-PENDING-MAGIC",
      name: "AI Surface Pending Magic Test",
      category: "magic",
      printedCategory: "magic",
    };
    const pendingTargetEngine: Engine = {
      ...testEngine,
      cards: [normalCard, pendingMagicCard],
      getCardDefinitionById: (id) =>
        id === pendingMagicCard.cardNo
          ? pendingMagicCard
          : getCardDefinitionById(id),
    };
    const candidateTargetInstanceIds = Array.from(
      { length: 18 },
      (_, index) => `pending-target-${index}`
    );
    const source = createCardInstance(pendingMagicCard, {
      instanceId: "pending-target-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          source,
          ...candidateTargetInstanceIds.map((instanceId) =>
            fieldCard(instanceId)
          ),
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "training-factored-target-pending",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: pendingMagicCard.cardNo,
        deferredStack: {
          stackId: "stack:training-factored-target-pending",
          actionKind: "magic",
          chainId: "chain:training-factored-target-pending",
          actingPlayerId: "alice",
          cardInstanceId: source.instanceId,
          cardDefinitionId: pendingMagicCard.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
          // The pending target action itself is real; nullifying this minimal
          // fixture keeps the post-target stack resolution intentionally inert.
          isNullified: true,
        },
        remainingStacks: [],
        requiredTargetCount: 0,
        maxTargetCount: 13,
        candidateInstanceIds: [...candidateTargetInstanceIds],
        targetEffectFilterTags: [],
      },
    };
    const mctsPolicy = makeMctsTrainingPolicy({
      iterations: 1,
      rolloutDepth: 1,
      maxGeneratedChoices: 1024,
    });
    let completedPendingInputMctsCalls = 0;
    const policy = (
      currentState: GameState,
      node: TrainingDecisionNode,
      engine: Engine,
      rng: () => number
    ) => {
      const factoredTargetChoice = node.choices.find(
        (choice) =>
          choice.systemAction?.kind === "select_factored_target_selection"
      );
      if (
        factoredTargetChoice?.systemAction?.kind ===
        "select_factored_target_selection"
      ) {
        const { candidateIndex } = factoredTargetChoice.systemAction;
        return node.choices.find(
          (choice) =>
            choice.systemAction?.kind === "select_factored_target_selection" &&
            choice.systemAction.select === candidateIndex < 3
        )!;
      }
      if (
        node.kind === "action_input" &&
        node.action?.kind === "resolve_pending_effect_target"
      ) {
        completedPendingInputMctsCalls += 1;
      }
      return mctsPolicy(currentState, node, engine, rng);
    };

    const result = playTrainingGame({
      engine: pendingTargetEngine,
      initialState: state,
      maxSteps: 19,
      maxForcedTransitions: 100,
      maxGeneratedChoices: 1024,
      policies: { alice: policy, bob: policy },
      rng: () => 0,
    });

    expect(
      result.trace.filter(
        (entry) => entry.systemActionKind === "select_factored_target_selection"
      )
    ).toHaveLength(candidateTargetInstanceIds.length);
    expect(completedPendingInputMctsCalls).toBeGreaterThan(0);
    expect(
      result.trace.some(
        (entry) =>
          entry.nodeKind === "action_input" &&
          entry.actionKind === "resolve_pending_effect_target" &&
          entry.systemActionKind === undefined
      )
    ).toBe(true);
    expect(result.finalState.pendingEffectTargetSelection).toBeNull();
    expect(result.finalState.log).toContain(
      "effect:target-selection:resolved:chain:training-factored-target-pending:pending-target-0,pending-target-1,pending-target-2"
    );
    expect(
      (result.finalState as { trainingTargetSelectionDraft?: unknown })
        .trainingTargetSelectionDraft
    ).toBeUndefined();
  });

  it("preserves duplicate target assignments when target groups allow duplicates", () => {
    const action = {
      chainId: "test:training-decision-surface-coverage:4130",
      kind: "resolve_pending_triggered_effect",
      actionId: "duplicate-target-groups",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-duplicate-targets",
      eventKind: "summon",
      executionMode: "mandatory",
      targetMode: "manual",
      requiredTargetCount: 2,
      candidateTargetInstanceIds: ["target-1"],
      targetGroups: [
        {
          requiredTargetCount: 1,
          targetStepId: "__step_0",
          candidateTargetZones: ["field"],
          candidateTargetInstanceIds: ["target-1"],
        },
        {
          requiredTargetCount: 1,
          targetStepId: "__step_1",
          candidateTargetZones: ["field"],
          candidateTargetInstanceIds: ["target-1"],
        },
      ],
      allowDuplicateTargets: true,
      targetEffectFilterTags: ["general"],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    } as LegalAction;

    const node = createActionInputDecisionNode(testState(), action, {
      maxGeneratedChoices: 8,
    });

    expect(node?.choices.map((choice) => choice.applyOptions)).toContainEqual({
      targetInstanceIds: ["target-1", "target-1"],
    });
  });

  it("heuristic baseline prefers executing optional effects over declining them", () => {
    const node: TrainingDecisionNode = {
      nodeId: "input",
      kind: "action_input",
      actingPlayerId: "alice",
      fields: ["skipOptionalEffect"],
      choices: [
        {
          choiceId: "decline",
          label: "decline",
          applyOptions: { skipOptionalEffect: true },
        },
        {
          choiceId: "execute",
          label: "execute",
          applyOptions: { skipOptionalEffect: false },
        },
      ],
      truncated: false,
    };

    expect(
      heuristicTrainingPolicy(
        testState(),
        node,
        {
          cards: [normalCard],
          getCardDefinitionById: () => normalCard,
          lookups: {
            getRegisteredTriggeredEffectActions: () => [],
            getRegisteredBurstActions: () => [],
            getRegisteredBattleImmediateEffectActions: () => [],
            getRegisteredFieldCardEffectActions: () => [],
            getRegisteredHandActivatedEffectActions: () => [],
            getRegisteredMagicActions: () => [],
          },
        },
        Math.random
      ).choiceId
    ).toBe("execute");
  });

  it("heuristic baseline ends the attack step when a non-lethal attack opens lethal return pressure", () => {
    const attacker = fieldCard("attacker", {
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
    });
    const blocker = fieldCard("blocker", {
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker, blocker],
        playerOverrides: [
          { lifeNormalCoreCount: 1 },
          { lifeNormalCoreCount: 5 },
        ],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "none" as const,
    };
    const node: TrainingDecisionNode = {
      nodeId: "attack-choice",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "attack",
          label: "attack",
          action: {
            kind: "attack",
            actionId: "attack",
            can: true,
            reason: "test",
            actingPlayerId: "alice",
            sourceInstanceId: "attacker",
            sourceDefinitionId: normalCard.cardNo,
            sourceCardNo: normalCard.cardNo,
            battleEntityId: "attacker",
          } as LegalAction,
        },
        {
          choiceId: "end",
          label: "end_attack_step",
          action: {
            kind: "end_attack_step",
            actionId: "end",
            can: true,
            reason: "test",
            actingPlayerId: "alice",
          } as LegalAction,
        },
      ],
      truncated: false,
    };

    expect(
      heuristicTrainingPolicy(state, node, testEngine, Math.random).choiceId
    ).toBe("end");
  });

  it("heuristic baseline attacks instead of ending the attack step when damage is lethal", () => {
    const attacker = fieldCard("attacker", {
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker],
        playerOverrides: [
          { lifeNormalCoreCount: 3 },
          { lifeNormalCoreCount: 1 },
        ],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "none" as const,
    };
    const node: TrainingDecisionNode = {
      nodeId: "attack-choice",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "attack",
          label: "attack",
          action: {
            kind: "attack",
            actionId: "attack",
            can: true,
            reason: "test",
            actingPlayerId: "alice",
            sourceInstanceId: "attacker",
            sourceDefinitionId: normalCard.cardNo,
            sourceCardNo: normalCard.cardNo,
            battleEntityId: "attacker",
          } as LegalAction,
        },
        {
          choiceId: "end",
          label: "end_attack_step",
          action: {
            kind: "end_attack_step",
            actionId: "end",
            can: true,
            reason: "test",
            actingPlayerId: "alice",
          } as LegalAction,
        },
      ],
      truncated: false,
    };

    expect(
      heuristicTrainingPolicy(state, node, testEngine, Math.random).choiceId
    ).toBe("attack");
  });

  it("factors a summon-cost-exclude subset and completes its atomic payment and summon", () => {
    const source = createCardInstance(widePaymentCard, {
      instanceId: "summon-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const excludedCandidates = Array.from({ length: 15 }, (_, index) =>
      createCardInstance(normalCard, {
        instanceId: `exclude-${index}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      })
    );
    const paymentCards = Array.from(
      { length: 8 },
      (_, index) => `payment-${index}`
    ).map((instanceId) =>
      createCardInstance(normalCard, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 7,
      })
    );
    const action = {
      kind: "resolve_pending_summon_cost_exclude_choice",
      actionId: "edh-summon-cost-exclude",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "edh-pending",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: widePaymentCard.cardNo,
      sourceCardNo: widePaymentCard.cardNo,
      candidateCardInstanceIds: excludedCandidates.map(
        (candidate) => candidate.instanceId
      ),
      maxCount: 2,
      discountPerCard: 1,
      printedCost: 7,
      reducedCost: 7,
      availableReserveCoreAmount: 7,
      availableOnBoardCoreSources: paymentCards.map((card) => ({
        instanceId: card.instanceId,
        availableCoreAmount: 7,
      })),
      availableSoulCoreOnlySources: [],
    } as LegalAction;
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...excludedCandidates, ...paymentCards],
        playerOverrides: [{ reserveNormalCoreCount: 7 }, {}],
      }),
      step: "main",
      activePlayerId: "alice",
      pendingSummonCostExcludeChoice: {
        pendingId: "edh-pending",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: widePaymentCard.cardNo,
        effectIndex: 0,
        candidateCardInstanceIds: excludedCandidates.map(
          (candidate) => candidate.instanceId
        ),
        maxCount: 2,
        discountPerCard: 1,
      },
    };

    let node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 1024,
      getCardDefinitionById,
    });
    expect(node).toMatchObject({
      fields: ["summonCostExcludeSelectedCardInstanceIds"],
      truncated: false,
    });
    expect(node?.choices).toHaveLength(2);

    for (let candidateIndex = 0; candidateIndex < 15; candidateIndex++) {
      const select = candidateIndex < 2;
      const choice = node?.choices.find(
        (candidate) =>
          candidate.systemAction?.kind === "select_factored_zone_selection" &&
          "candidateIndex" in candidate.systemAction &&
          candidate.systemAction.candidateIndex === candidateIndex &&
          candidate.systemAction.select === select
      );
      expect(choice).toBeDefined();
      state = applyTrainingDecisionChoice(state, node!, choice!, testEngine);
      node = createActionInputDecisionNode(state, action, {
        maxGeneratedChoices: 1024,
        getCardDefinitionById,
      });
    }

    expect(node).toMatchObject({
      fields: ["paymentSources"],
      truncated: false,
    });
    for (let sourceIndex = 0; sourceIndex < 9; sourceIndex++) {
      const choice = node?.choices.find((candidate) => {
        const systemAction = candidate.systemAction;
        if (
          systemAction?.kind !== "select_factored_zone_selection" ||
          !("summonCostExcludePaymentCandidateIndex" in systemAction) ||
          systemAction.summonCostExcludePaymentCandidateIndex !== sourceIndex
        ) {
          return false;
        }
        return sourceIndex === 0
          ? systemAction.paymentSource?.kind === "reserve" &&
              systemAction.paymentSource.amount === 5
          : systemAction.paymentSource === undefined;
      });
      expect(choice).toBeDefined();
      state = applyTrainingDecisionChoice(state, node!, choice!, testEngine);
      if (sourceIndex < 8) {
        node = createActionInputDecisionNode(state, action, {
          maxGeneratedChoices: 1024,
          getCardDefinitionById,
        });
      }
    }

    expect(state.pendingSummonCostExcludeChoice).toBeNull();
    expect(
      state.cardInstances.find((card) => card.instanceId === "exclude-0")?.zone
    ).toBe("removed_from_game");
    expect(
      state.cardInstances.find((card) => card.instanceId === "exclude-1")?.zone
    ).toBe("removed_from_game");
    expect(
      state.cardInstances.find((card) => card.instanceId === "exclude-2")?.zone
    ).toBe("trash");

    const passStack = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(passStack).toBeDefined();
    state = applyLegalAction({
      state,
      action: passStack!,
      getCardDefinitionById,
      ...testEngine.lookups,
    }).state;
    const placement = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_enter_field_placement"
    );
    expect(placement).toBeDefined();
    const resolved = applyLegalAction({
      state,
      action: placement!,
      getCardDefinitionById,
      ...testEngine.lookups,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      resolved.players.find((player) => player.id === "alice")
    ).toMatchObject({ reserveNormalCoreCount: 1 });
  });

  it("factors an ordinary summon payment surface and completes payment and summon", () => {
    const source = createCardInstance(widePaymentCard, {
      instanceId: "summon-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const paymentCards = ["payment-a", "payment-b", "payment-c"].map(
      (instanceId) =>
        createCardInstance(normalCard, {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 7,
        })
    );
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...paymentCards],
        playerOverrides: [{ reserveNormalCoreCount: 7 }, {}],
      }),
      step: "main",
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "summon" &&
        candidate.sourceInstanceId === source.instanceId
    );
    expect(action).toBeDefined();

    let node = createActionInputDecisionNode(state, action!, {
      maxGeneratedChoices: 1024,
      getCardDefinitionById,
    });

    expect(node).toMatchObject({
      fields: ["paymentSources"],
      truncated: false,
    });
    for (let sourceIndex = 0; sourceIndex < 4; sourceIndex++) {
      const choice = node?.choices.find((candidate) => {
        const systemAction = candidate.systemAction;
        if (
          systemAction?.kind !== "select_factored_zone_selection" ||
          !("topLevelPaymentCandidateIndex" in systemAction) ||
          systemAction.topLevelPaymentCandidateIndex !== sourceIndex
        ) {
          return false;
        }
        if (sourceIndex === 0) {
          return (
            systemAction.paymentSource?.kind === "reserve" &&
            systemAction.paymentSource.amount === 6
          );
        }
        if (sourceIndex === 1) {
          return (
            systemAction.paymentSource?.kind === "card" &&
            systemAction.paymentSource.instanceId === "payment-a" &&
            systemAction.paymentSource.amount === 1
          );
        }
        return systemAction.paymentSource === undefined;
      });
      expect(choice).toBeDefined();
      state = applyTrainingDecisionChoice(state, node!, choice!, testEngine);
      if (sourceIndex < 3) {
        node = createActionInputDecisionNode(state, action!, {
          maxGeneratedChoices: 1024,
          getCardDefinitionById,
        });
      }
    }

    const passStack = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(passStack).toBeDefined();
    state = applyLegalAction({
      state,
      action: passStack!,
      getCardDefinitionById,
      ...testEngine.lookups,
    }).state;
    const placement = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...testEngine.lookups,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_enter_field_placement"
    );
    expect(placement).toBeDefined();
    const resolved = applyLegalAction({
      state,
      action: placement!,
      getCardDefinitionById,
      ...testEngine.lookups,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      resolved.players.find((player) => player.id === "alice")
    ).toMatchObject({ reserveNormalCoreCount: 0 });
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "payment-a")
        ?.normalCoreCount
    ).toBe(6);
    expect(
      resolved.cardInstances
        .filter((card) => ["payment-b", "payment-c"].includes(card.instanceId))
        .map((card) => card.normalCoreCount)
    ).toEqual([7, 7]);
  });

  it("heuristic baseline keeps designated attacks neutral even into set burst", () => {
    const attacker = fieldCard("attacker", {
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
    });
    const target = fieldCard("target", {
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      exhaustState: "exhausted",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker, target],
        playerOverrides: [
          { lifeNormalCoreCount: 3 },
          { lifeNormalCoreCount: 5 },
        ],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "none" as const,
      setBurstStates: [{ playerId: "bob", cardInstanceId: "burst" }],
    };
    const node: TrainingDecisionNode = {
      nodeId: "attack-choice",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "attack-target",
          label: "attack",
          action: {
            kind: "attack",
            actionId: "attack-target",
            can: true,
            reason: "test",
            actingPlayerId: "alice",
            sourceInstanceId: "attacker",
            sourceDefinitionId: normalCard.cardNo,
            sourceCardNo: normalCard.cardNo,
            battleEntityId: "attacker",
            targetInstanceId: "target",
          } as LegalAction,
        },
        {
          choiceId: "end",
          label: "end_attack_step",
          action: {
            kind: "end_attack_step",
            actionId: "end",
            can: true,
            reason: "test",
            actingPlayerId: "alice",
          } as LegalAction,
        },
      ],
      truncated: false,
    };

    expect(
      heuristicTrainingPolicy(state, node, testEngine, Math.random).choiceId
    ).toBe("attack-target");
  });
});
