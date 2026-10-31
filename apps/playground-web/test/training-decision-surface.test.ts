import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  initializeGame,
  type CardDefinition,
  type LegalAction,
} from "@orica/rules-core";
import { AI_DECISION_APPLY_OPTION_FIELDS } from "./ai-action-input-fields";
import { buildEngine, mulberry32 } from "./selfplay-driver";
import {
  TRAINING_DECISION_APPLY_OPTION_FIELDS,
  TRAINING_SELFPLAY_AUTO_INPUT_FIELDS,
  TRAINING_SYSTEM_ACTION_KINDS,
  applyTrainingSystemAction,
  applyPreGameChoice,
  createActionInputDecisionNode,
  getPreGameDecisionNode,
  legalActionsForTraining,
  playTrainingGame,
} from "./training-decision-surface";

const normalCard: CardDefinition = {
  cardNo: "TEST-NORMAL",
  name: "Normal",
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

const contractCard: CardDefinition = {
  ...normalCard,
  cardNo: "TEST-CONTRACT",
  name: "Contract",
  keywordTags: ["contract"],
};

function baseAction(overrides: Partial<LegalAction>): LegalAction {
  return {
    kind: "resolve_pending_effect_target",
    actionId: "a",
    can: true,
    reason: "test",
    actingPlayerId: "alice",
    pendingId: "p",
    sourceInstanceId: "src",
    sourceDefinitionId: "TEST",
    targetMode: "manual",
    requiredTargetCount: 1,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: ["t1"],
    ...overrides,
  } as LegalAction;
}

function testEngine() {
  const base = buildEngine();
  return {
    ...base,
    cards: [normalCard, contractCard, ...base.cards],
    getCardDefinitionById: (id: string) =>
      id === normalCard.cardNo
        ? normalCard
        : id === contractCard.cardNo
          ? contractCard
          : base.getCardDefinitionById(id),
  };
}

describe("training decision surface", () => {
  it("keeps the learning decision field registry aligned with AI-decision fields", () => {
    expect([...TRAINING_DECISION_APPLY_OPTION_FIELDS].sort()).toEqual(
      [...AI_DECISION_APPLY_OPTION_FIELDS].sort()
    );
    expect([...TRAINING_SELFPLAY_AUTO_INPUT_FIELDS].sort()).toEqual([
      "coreDistributionAllocations",
      "coreDistributionSoulCoreAllocations",
      "coreDistributionSoulCoreSourceAllocations",
      "coreDistributionSourceAllocations",
      "coreShootDistribution",
      "coreShootSoulCoreInstanceId",
      "coreSourceAllocations",
      "coreSourceSoulCoreInstanceId",
      "coreSplitDistribution",
      "deckRevealPickFreeDestination",
      "deckRevealPlacement",
      "deckRevealRemainderOrder",
      "deckRevealRemainderPlacements",
      "enterFieldCorePlacements",
      "lifeCorePartitionChoice",
      "paidPreventionImmunityCardSelection",
      "paymentSources",
      "selectedDeckRevealCardIds",
      "selectedZoneCardIds",
      "summonCostCoreMoveAllocations",
      "summonCostCoreMoveSelectedCount",
      "summonCostExcludeSelectedCardInstanceIds",
      "summonPaymentSources",
      "targetInstanceIds",
      "zoneSelectionDestinationByCardId",
    ]);
    expect([...TRAINING_SYSTEM_ACTION_KINDS]).toEqual([
      "advance_step",
      "manual_core_move",
      "select_multi_placement_source",
      "select_factored_target_selection",
      "select_factored_zone_selection",
      "select_factored_deck_reveal_order",
      "commit_factored_manual_core_move",
    ]);
  });

  it("exposes target and deck reveal inputs as action-input choices", () => {
    const targetNode = createActionInputDecisionNode(
      initializeGame({
        decks: [[normalCard], [normalCard]],
        skipPreGame: true,
      }),
      baseAction({
        candidateTargetInstanceIds: ["t1", "t2", "t3"],
        requiredTargetCount: 1,
      })
    );
    expect(targetNode?.fields).toEqual(["targetInstanceIds"]);
    expect(
      targetNode?.choices.map(
        (choice) => choice.applyOptions?.targetInstanceIds
      )
    ).toEqual(expect.arrayContaining([["t1"], ["t2"], ["t3"]]));

    const revealNode = createActionInputDecisionNode(
      initializeGame({
        decks: [[normalCard], [normalCard]],
        skipPreGame: true,
      }),
      baseAction({
        kind: "resolve_pending_deck_reveal_pick",
        candidateCardInstanceIds: ["c1", "c2"],
        maxPickCount: 1,
        canSkip: true,
        requiresFreeDestinationChoice: true,
      } as Partial<LegalAction>)
    );
    expect(revealNode?.fields).toEqual([
      "deckRevealPickFreeDestination",
      "selectedDeckRevealCardIds",
    ]);
    expect(revealNode?.choices.length).toBe(5);
  });

  it("exposes soul-core-only payment sources instead of fixing reserve payment", () => {
    const state = initializeGame({
      decks: [[normalCard], [normalCard]],
      skipPreGame: true,
    });
    const action = baseAction({
      kind: "use_magic",
      timing: "main",
      sourceCardNo: "TEST-NORMAL",
      sourceDefinitionId: "TEST-NORMAL",
      sourceInstanceId: "hand-1",
      targetMode: "none",
      requiredTargetCount: 0,
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      reducedCost: 1,
      additionalCost: 0,
      finalCost: 1,
      totalReduction: 0,
      availableReserveCoreAmount: 0,
      availableOnBoardCoreSources: [],
      availableSoulCoreOnlySources: [
        {
          kind: "card",
          instanceId: "soul-only-card",
          definitionId: "TEST-NORMAL",
          zoneRoleName: "spirit",
          availableSoulCoreAmount: 1,
        },
      ],
      costMode: "paid",
    } as Partial<LegalAction>);

    const node = createActionInputDecisionNode(state, action);

    expect(node?.fields).toEqual(["paymentSources"]);
    expect(node?.choices).toContainEqual(
      expect.objectContaining({
        applyOptions: {
          paymentSources: [
            {
              kind: "card",
              instanceId: "soul-only-card",
              amount: 1,
              includeSoulCore: true,
            },
          ],
        },
      })
    );
  });

  it("exposes advance-step beside remaining top-level actions", () => {
    const engine = testEngine();
    const state = {
      ...initializeGame({
        decks: [
          Array.from({ length: 40 }, () => normalCard),
          Array.from({ length: 40 }, () => normalCard),
        ],
        skipPreGame: true,
        allowUnavailableDeckCards: true,
      }),
      step: "main" as const,
      window: "none" as const,
    };

    const node = legalActionsForTraining(state, engine);

    expect(
      node?.choices.some((choice) => choice.action?.kind === "summon")
    ).toBe(true);
    expect(
      node?.choices.some(
        (choice) => choice.systemAction?.kind === "advance_step"
      )
    ).toBe(true);
  });

  it("exposes manual core move as a batch system choice", () => {
    const engine = testEngine();
    const base = initializeGame({
      decks: [
        Array.from({ length: 40 }, () => normalCard),
        Array.from({ length: 40 }, () => normalCard),
      ],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });
    const left = createCardInstance(normalCard, {
      instanceId: "alice-left",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const right = createCardInstance(normalCard, {
      instanceId: "alice-right",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = {
      ...base,
      step: "main" as const,
      window: "none" as const,
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 0, reserveSoulCoreCount: 0 }
          : player
      ),
      cardInstances: [...base.cardInstances, left, right],
    };

    const node = legalActionsForTraining(state, engine, {
      maxGeneratedChoices: 32,
    });
    const moveChoice = node?.choices.find(
      (choice) =>
        choice.systemAction?.kind === "manual_core_move" &&
        choice.systemAction.drafts.some(
          (draft) =>
            draft.kind === "normal" &&
            draft.from.kind === "card" &&
            draft.from.instanceId === "alice-left" &&
            draft.to.kind === "card" &&
            draft.to.instanceId === "alice-right" &&
            draft.amount === 1
        )
    );

    expect(moveChoice).toBeDefined();
    const after = applyTrainingSystemAction(
      state,
      moveChoice!.systemAction!,
      engine
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "alice-left")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find((card) => card.instanceId === "alice-right")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("drives preGame choices through contract, janken, order, and mulligan", () => {
    const engine = buildEngine();
    const decks: [CardDefinition[], CardDefinition[]] = [
      [contractCard, ...Array.from({ length: 39 }, () => normalCard)],
      [contractCard, ...Array.from({ length: 39 }, () => normalCard)],
    ];
    let state = initializeGame({
      decks,
      skipPreGame: false,
      allowUnavailableDeckCards: true,
    });

    const contractAlice = getPreGameDecisionNode(state);
    expect(contractAlice?.preGamePhase).toBe("waiting_contract");
    state = applyPreGameChoice(
      state,
      { kind: "contract_presentation", playerId: "alice", present: true },
      engine
    );
    state = applyPreGameChoice(
      state,
      { kind: "contract_presentation", playerId: "bob", present: false },
      engine
    );
    expect(state.preGame?.phase).toBe("contract_confirm");

    state = applyPreGameChoice(
      state,
      { kind: "contract_confirm", playerId: "alice" },
      engine
    );
    state = applyPreGameChoice(
      state,
      { kind: "contract_confirm", playerId: "bob" },
      engine
    );
    state = applyPreGameChoice(
      state,
      { kind: "janken", playerId: "alice", hand: "rock" },
      engine
    );
    state = applyPreGameChoice(
      state,
      { kind: "janken", playerId: "bob", hand: "scissors" },
      engine
    );
    expect(state.preGame?.phase).toBe("waiting_order_pick");

    state = applyPreGameChoice(
      state,
      { kind: "first_player", playerId: "alice", firstPlayerId: "alice" },
      engine
    );
    state = applyPreGameChoice(
      state,
      { kind: "mulligan", playerId: "alice", mulligan: false },
      engine
    );
    state = applyPreGameChoice(
      state,
      { kind: "mulligan", playerId: "bob", mulligan: false },
      engine
    );
    expect(state.preGame).toBeNull();
  });

  it("can produce a training trace without invoking fuzz action-input completion", () => {
    const engine = buildEngine();
    const result = playTrainingGame({
      engine,
      rng: mulberry32(1),
      maxSteps: 40,
      skipPreGame: false,
    });

    expect(result.outcome).not.toBe("error");
    expect(result.trace.some((entry) => entry.nodeKind === "pregame")).toBe(
      true
    );
    expect(
      result.trace.some((entry) => entry.nodeKind === "legal_action")
    ).toBe(true);
  });
});
