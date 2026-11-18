import { describe, expect, it } from "vitest";

import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  AiWorkTelemetry,
  mulberry32,
  applyPreGameChoice,
  applyTrainingDecisionChoice,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getNextTrainingDecision,
  heuristicTrainingPolicy,
  initializeGame,
  makeMctsTrainingPolicy,
  progressRandomTrainingPolicy,
  searchTrainingDecisionMcts,
  type CardDefinition,
  type Engine,
  type GameState,
  type LegalAction,
  type ActiveAttack,
  type PreDeclarationStackWindow,
  type StackWindow,
  type TrainingDecisionChoice,
  type TrainingDecisionNode,
} from "../src";

const normalCard: CardDefinition = {
  cardNo: "TEST-MCTS-001",
  name: "MCTS Test Spirit",
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

const levelNexus: CardDefinition = {
  ...normalCard,
  cardNo: "TEST-MCTS-NEXUS",
  name: "MCTS Test Nexus",
  category: "nexus",
  printedCategory: "nexus",
  levelDefs: [
    { level: 1, requiredCores: 0, bp: 0 },
    { level: 2, requiredCores: 1, bp: 0 },
  ],
};

const threeLevelSpirit: CardDefinition = {
  ...normalCard,
  cardNo: "TEST-MCTS-LV3",
  name: "MCTS Test Lv3 Spirit",
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 2, bp: 2000 },
    { level: 3, requiredCores: 4, bp: 4000 },
  ],
};

const tokenManagedSpirit: CardDefinition = {
  ...normalCard,
  cardNo: "TEST-MCTS-TOKEN",
  name: "MCTS Test Token",
  tokenIndependentCoreManagement: {
    redirectCoresToVoid: true,
    placementRestrictedToEnterField: true,
  },
};

function emptyLookups(): Engine["lookups"] {
  return {
    getRegisteredTriggeredEffectActions:
      (() => []) as Engine["lookups"]["getRegisteredTriggeredEffectActions"],
    getRegisteredBurstActions:
      (() => []) as Engine["lookups"]["getRegisteredBurstActions"],
    getRegisteredBattleImmediateEffectActions:
      (() => []) as Engine["lookups"]["getRegisteredBattleImmediateEffectActions"],
    getRegisteredFieldCardEffectActions:
      (() => []) as Engine["lookups"]["getRegisteredFieldCardEffectActions"],
    getRegisteredHandActivatedEffectActions:
      (() => []) as Engine["lookups"]["getRegisteredHandActivatedEffectActions"],
    getRegisteredMagicActions:
      (() => []) as Engine["lookups"]["getRegisteredMagicActions"],
  };
}

function engine(cards: CardDefinition[] = [normalCard]): Engine {
  return {
    cards,
    getCardDefinitionById: (id) => cards.find((card) => card.cardNo === id),
    lookups: emptyLookups(),
  };
}

function deck(): CardDefinition[] {
  return Array.from({ length: 40 }, () => normalCard);
}

function waitingForBobJankenState(e: Engine) {
  return applyPreGameChoice(
    initializeGame({
      decks: [deck(), deck()],
      skipPreGame: false,
      allowUnavailableDeckCards: true,
    }),
    { kind: "janken", playerId: "alice", hand: "scissors" },
    e
  );
}

describe("training MCTS policy", () => {
  it("counts input generation inside direct and MCTS action application", () => {
    const e = engine([]);
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-group:test:alice:battle-entity:none",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 8,
    });
    const choice = node?.choices.find(
      (candidate) => candidate.action?.kind === "pass_battle_flash"
    );
    if (!node || !choice) throw new Error("fixture has no legal flash pass");
    expect(node.choices).toHaveLength(1);
    const before = JSON.stringify(state);
    const plain = applyTrainingDecisionChoice(state, node, choice, e);
    let tick = 0;
    const direct = new AiWorkTelemetry(() => tick++);
    const measured = applyTrainingDecisionChoice(
      state,
      node,
      choice,
      e,
      direct
    );
    expect(measured).toEqual(plain);
    expect(measured.activeAttack?.flashWindowState?.consecutivePassCount).toBe(
      1
    );
    const directRows = direct.snapshot().measurements;
    const inputs = directRows.find(
      (row) => row.operation === "input_generation"
    )!;
    const transitions = directRows.find(
      (row) => row.operation === "engine_transition"
    )!;
    expect(inputs).toMatchObject({
      observed: true,
      attempted: 1,
      returned: 1,
      threw: 0,
    });
    expect(transitions).toMatchObject({ attempted: 1, returned: 1, threw: 0 });
    expect(inputs.inclusiveMs).toBe(1);
    expect(transitions.exclusiveMs).toBe(
      transitions.inclusiveMs - inputs.inclusiveMs
    );

    const search = new AiWorkTelemetry();
    const result = searchTrainingDecisionMcts(
      state,
      node,
      e,
      {
        iterations: 1,
        rolloutDepth: 0,
        maxGeneratedChoices: 8,
        telemetry: search,
      },
      mulberry32(47)
    );
    expect(result.choice).toEqual(choice);
    expect(result.root.visits).toBe(1);
    const searchRows = search.snapshot().measurements;
    // One read-only virtual-input probe, then the apply-time safety probe.
    expect(
      searchRows.find((row) => row.operation === "input_generation")
    ).toMatchObject({ attempted: 2, returned: 2, threw: 0 });
    expect(
      searchRows.find((row) => row.operation === "engine_transition")
    ).toMatchObject({ returned: 1, threw: 0 });
    expect(
      searchRows.find((row) => row.operation === "simulation")!.returned
    ).toBe(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("telemetry preserves fixed-seed choices and statistics while separating simulations and engine work", () => {
    const e = engine();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    state.turnNumber = 2;
    state.step = "main";
    state.window = "none";
    const telemetry = new AiWorkTelemetry();
    const options = { iterations: 4, rolloutDepth: 2, maxGeneratedChoices: 8 };
    const node = getNextTrainingDecision(state, e, { ...options, telemetry })!;
    const before = JSON.stringify(state);
    const plain = searchTrainingDecisionMcts(
      state,
      node,
      e,
      options,
      mulberry32(47)
    );
    const measured = searchTrainingDecisionMcts(
      state,
      node,
      e,
      { ...options, telemetry },
      mulberry32(47)
    );
    expect(measured).toEqual(plain);
    expect(JSON.stringify(state)).toBe(before);
    const rows = telemetry.snapshot().measurements;
    const count = (op: string) =>
      rows.find((row) => row.operation === op)!.returned;
    expect(count("decision")).toBe(1);
    expect(count("simulation")).toBe(4);
    expect(count("state_copy")).toBeGreaterThan(0);
    expect(count("legal_generation")).toBeGreaterThan(0);
    expect(count("engine_transition")).toBeGreaterThan(0);
    expect(count("heuristic_inference")).toBeGreaterThan(0);
    expect(count("nn_inference")).toBe(0);
  });

  it("passes instead of repeating a targetless one-step field-summon empty fire", () => {
    // 無償の場起動を検証する。作戦C06の常時許可は通常の有償使用なので別物。
    const c06: CardDefinition = {
      ...normalCard,
      cardNo: "TEST-MCTS-FIELD-SUMMON",
      textLines: [],
      effects: [
        ALL_CARDS.find((card) => card.cardNo === "BSAZ01-C06")!.effects!.find(
          (effect) =>
            effect.timing.kind === "activated" && effect.timing.mode === "flash"
        )!,
      ],
    };
    const definitions = [...ALL_CARDS, c06];
    const e = engine(definitions);
    e.lookups = {
      ...emptyLookups(),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
    };
    const c06Field = createCardInstance(c06, {
      instanceId: "c06-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c06Field],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      activeAttack: {
        attackId: "attack-group:test:alice:battle-entity:none",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: "alice" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block" as const,
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });
    const emptyFire = node?.choices.find(
      (choice) => choice.action?.kind === "use_field_card_effect"
    );
    expect(emptyFire?.action).toMatchObject({
      sourceCardNo: "TEST-MCTS-FIELD-SUMMON",
      targetMode: "none",
      requiredTargetCount: 0,
      candidateTargetInstanceIds: [],
    });

    const selected = makeMctsTrainingPolicy({
      iterations: 1,
      rolloutDepth: 1,
      maxGeneratedChoices: 32,
    })(state, node!, e, () => 0);

    expect(selected.action?.kind).toBe("pass_battle_flash");
  });

  it("suppresses an immediate return to a visited manual core distribution", () => {
    const e = engine([levelNexus]);
    const nexus = createCardInstance(levelNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      everHadCorePlaced: true,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 1,
            reserveSoulCoreCount: 0,
            soulCoreLocation: null,
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });
    const choice = node?.choices.find(
      (candidate) => candidate.systemAction?.kind === "manual_core_move"
    );

    expect(choice).toBeDefined();
    const next = applyTrainingDecisionChoice(state, node!, choice!, e);

    expect(
      next.cardInstances.find((card) => card.instanceId === "nexus-1")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      next.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
    const nextNode = getNextTrainingDecision(next, e, {
      maxGeneratedChoices: 32,
    });
    expect(
      nextNode?.choices.some(
        (candidate) => candidate.systemAction?.kind === "manual_core_move"
      )
    ).toBe(false);
  });

  it("keeps an inverse manual core move when first placement changed the core-history latch", () => {
    const e = engine([levelNexus]);
    const nexus = createCardInstance(levelNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      everHadCorePlaced: false,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 1,
            reserveSoulCoreCount: 0,
            soulCoreLocation: null,
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });
    const toNexus = node?.choices.find(
      (candidate) => candidate.systemAction?.kind === "manual_core_move"
    );

    expect(toNexus).toBeDefined();
    const next = applyTrainingDecisionChoice(state, node!, toNexus!, e);
    expect(
      next.cardInstances.find((card) => card.instanceId === "nexus-1")
        ?.everHadCorePlaced
    ).toBe(true);

    const nextNode = getNextTrainingDecision(next, e, {
      maxGeneratedChoices: 32,
    });
    expect(
      nextNode?.choices.some(
        (candidate) => candidate.systemAction?.kind === "manual_core_move"
      )
    ).toBe(true);
  });

  it("keeps later manual core moves in the same main step when they reach a new distribution", () => {
    const e = engine([levelNexus]);
    const nexusA = createCardInstance(levelNexus, {
      instanceId: "nexus-a",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const nexusB = createCardInstance(levelNexus, {
      instanceId: "nexus-b",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexusA, nexusB],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 2,
            reserveSoulCoreCount: 0,
            soulCoreLocation: null,
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 64,
    });
    const firstToA = node?.choices.find((candidate) => {
      const action = candidate.systemAction;
      return (
        action?.kind === "manual_core_move" &&
        action.drafts.length === 1 &&
        action.drafts[0]?.kind === "normal" &&
        action.drafts[0].from.kind === "reserve" &&
        action.drafts[0].to.kind === "card" &&
        action.drafts[0].to.instanceId === "nexus-a" &&
        action.drafts[0].amount === 1
      );
    });

    expect(firstToA).toBeDefined();
    const next = applyTrainingDecisionChoice(state, node!, firstToA!, e);
    const nextNode = getNextTrainingDecision(next, e, {
      maxGeneratedChoices: 64,
    });
    const secondToB = nextNode?.choices.find((candidate) => {
      const action = candidate.systemAction;
      return (
        action?.kind === "manual_core_move" &&
        action.drafts.length === 1 &&
        action.drafts[0]?.kind === "normal" &&
        action.drafts[0].from.kind === "reserve" &&
        action.drafts[0].to.kind === "card" &&
        action.drafts[0].to.instanceId === "nexus-b" &&
        action.drafts[0].amount === 1
      );
    });

    expect(secondToB).toBeDefined();
    const afterSecond = applyTrainingDecisionChoice(
      next,
      nextNode!,
      secondToB!,
      e
    );

    expect(
      afterSecond.cardInstances.find((card) => card.instanceId === "nexus-a")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterSecond.cardInstances.find((card) => card.instanceId === "nexus-b")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterSecond.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("factors oversized manual core distributions through reserve for effect-debug", () => {
    const e = engine([levelNexus]);
    const field = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(levelNexus, {
        instanceId: `nexus-${index}`,
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: index === 0 ? 10 : index === 1 ? 1 : 0,
        soulCoreCount: index === 2 ? 1 : 0,
        everHadCorePlaced: index <= 2,
      })
    );
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: field,
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 1,
            reserveSoulCoreCount: 0,
            soulCoreLocation: { kind: "card", instanceId: "nexus-2" },
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const expanded = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 16,
    });
    const factored = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 16,
      factorManualCoreMovesThroughReserve: true,
    });
    const manualMoves =
      factored?.choices.filter(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      ) ?? [];

    expect(expanded?.truncated).toBe(true);
    expect(factored?.truncated).toBe(false);
    expect(manualMoves).not.toHaveLength(0);
    expect(
      manualMoves.every((choice) => choice.systemAction?.drafts.length === 1)
    ).toBe(true);
    expect(
      manualMoves.some((choice) => {
        const draft = choice.systemAction?.drafts[0];
        return (
          draft?.kind === "normal" &&
          draft.from.kind === "reserve" &&
          draft.to.kind === "card" &&
          draft.to.instanceId === "nexus-5"
        );
      })
    ).toBe(true);
    expect(
      manualMoves.some((choice) => {
        const draft = choice.systemAction?.drafts[0];
        return (
          draft?.kind === "soul" &&
          draft.from.kind === "card" &&
          draft.from.instanceId === "nexus-2" &&
          draft.to.kind === "reserve"
        );
      })
    ).toBe(true);
  });

  it("commits a factored normal/soul core exchange as one atomic manual core batch", () => {
    const e = engine([normalCard]);
    const normalHolder = createCardInstance(normalCard, {
      instanceId: "normal-holder",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: true,
    });
    const soulHolder = createCardInstance(normalCard, {
      instanceId: "soul-holder",
      ownerPlayerId: "alice",
      zone: "field",
      soulCoreCount: 1,
      everHadCorePlaced: true,
    });
    let state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [normalHolder, soulHolder],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 0,
            reserveSoulCoreCount: 0,
            soulCoreLocation: { kind: "card", instanceId: "soul-holder" },
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const factoredOptions = {
      maxGeneratedChoices: 64,
      factorManualCoreMovesThroughReserve: true,
    };
    const selectMove = (
      predicate: (draft: {
        kind: string;
        from: unknown;
        to: unknown;
      }) => boolean
    ) => {
      const node = getNextTrainingDecision(state, e, factoredOptions)!;
      const choice = node.choices.find((candidate) => {
        const action = candidate.systemAction;
        const draft =
          action?.kind === "manual_core_move" ? action.drafts[0] : undefined;
        return (
          action?.kind === "manual_core_move" &&
          action.trainingFactored === true &&
          draft !== undefined &&
          predicate(draft)
        );
      });
      expect(choice).toBeDefined();
      state = applyTrainingDecisionChoice(state, node, choice!, e);
    };

    selectMove(
      (draft) =>
        draft.kind === "normal" &&
        (draft.from as { kind: string; instanceId?: string }).kind === "card" &&
        (draft.from as { instanceId?: string }).instanceId ===
          "normal-holder" &&
        (draft.to as { kind: string }).kind === "reserve"
    );
    expect(
      state.cardInstances.find((card) => card.instanceId === "normal-holder")
        ?.zone
    ).toBe("field");
    selectMove(
      (draft) =>
        draft.kind === "soul" &&
        (draft.from as { kind: string; instanceId?: string }).kind === "card" &&
        (draft.from as { instanceId?: string }).instanceId === "soul-holder" &&
        (draft.to as { kind: string }).kind === "reserve"
    );
    selectMove(
      (draft) =>
        draft.kind === "normal" &&
        (draft.from as { kind: string }).kind === "reserve" &&
        (draft.to as { kind: string; instanceId?: string }).kind === "card" &&
        (draft.to as { instanceId?: string }).instanceId === "soul-holder"
    );
    selectMove(
      (draft) =>
        draft.kind === "soul" &&
        (draft.from as { kind: string }).kind === "reserve" &&
        (draft.to as { kind: string; instanceId?: string }).kind === "card" &&
        (draft.to as { instanceId?: string }).instanceId === "normal-holder"
    );

    const commitNode = getNextTrainingDecision(state, e, factoredOptions)!;
    const commit = commitNode.choices.find(
      (choice) =>
        choice.systemAction?.kind === "commit_factored_manual_core_move"
    );
    expect(commit).toBeDefined();
    state = applyTrainingDecisionChoice(state, commitNode, commit!, e);

    expect(
      state.cardInstances.find((card) => card.instanceId === "normal-holder")
    ).toMatchObject({ zone: "field", normalCoreCount: 0, soulCoreCount: 1 });
    expect(
      state.cardInstances.find((card) => card.instanceId === "soul-holder")
    ).toMatchObject({ zone: "field", normalCoreCount: 1, soulCoreCount: 0 });
    expect(
      state.players.find((player) => player.id === "alice")?.soulCoreLocation
    ).toEqual({
      kind: "card",
      instanceId: "normal-holder",
    });
  });

  it("prioritizes every response pass over an active factored manual-core draft", () => {
    const e = engine([normalCard]);
    const holder = createCardInstance(normalCard, {
      instanceId: "draft-holder",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: true,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [holder],
        playerOverrides: [{ id: "alice" }, { id: "bob" }],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const options = {
      maxGeneratedChoices: 64,
      factorManualCoreMovesThroughReserve: true,
    };
    const draftNode = getNextTrainingDecision(state, e, options)!;
    const draft = draftNode.choices.find(
      (choice) =>
        choice.systemAction?.kind === "manual_core_move" &&
        choice.systemAction.trainingFactored === true
    );
    expect(draft).toBeDefined();
    const drafted = applyTrainingDecisionChoice(state, draftNode, draft!, e);

    const stackWindow = {
      actingPlayerId: "alice",
      previousWindow: "none",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: {
        stackId: "stack:test-factored-manual-core",
        actionKind: "triggered_effect",
        chainId: "test-factored-manual-core",
        actingPlayerId: "alice",
        cardInstanceId: holder.instanceId,
        cardDefinitionId: normalCard.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      },
    } satisfies StackWindow;
    const preDeclarationStackWindow = {
      kind: "attack",
      actingPlayerId: "alice",
      sourceInstanceId: holder.instanceId,
      previousWindow: "none",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
    } satisfies PreDeclarationStackWindow;
    const activeAttack = {
      attackId: "attack:test-factored-manual-core",
      primaryEntityId: "battle-entity:draft-holder",
      participantEntityIds: ["battle-entity:draft-holder"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:draft-holder",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:draft-holder"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    } satisfies ActiveAttack;
    const battleEntities = [
      {
        entityId: "battle-entity:draft-holder",
        memberInstanceIds: [holder.instanceId],
        resolvedBp: 1000,
        resolvedSymbols: ["red"],
        attackState: "attacking" as const,
      },
    ];
    const expectResponsePass = (
      responseState: GameState,
      expectedKind: LegalAction["kind"]
    ) => {
      const responseNode = getNextTrainingDecision(responseState, e, options);
      expect(responseNode?.actingPlayerId).toBe("bob");
      expect(
        responseNode?.choices.some(
          (choice) => choice.action?.kind === expectedKind
        )
      ).toBe(true);
      expect(
        responseNode?.choices.some(
          (choice) =>
            choice.systemAction?.kind === "commit_factored_manual_core_move"
        )
      ).toBe(false);
    };

    expectResponsePass(
      {
        ...drafted,
        window: "stack",
        stackWindow,
        preDeclarationStackWindow: null,
      },
      "pass_stack"
    );
    expectResponsePass(
      {
        ...drafted,
        window: "pre_declaration_stack",
        stackWindow: null,
        preDeclarationStackWindow,
      },
      "pass_pre_declaration_stack"
    );
    expectResponsePass(
      {
        ...drafted,
        step: "attack",
        window: "flash_before_block",
        stackWindow: null,
        preDeclarationStackWindow: null,
        battleEntities,
        activeAttack,
      },
      "pass_battle_flash"
    );
    expectResponsePass(
      {
        ...drafted,
        step: "attack",
        window: "stack_before_block",
        stackWindow: null,
        preDeclarationStackWindow: null,
        battleEntities,
        activeAttack: {
          ...activeAttack,
          flashWindowState: {
            ...activeAttack.flashWindowState!,
            pendingStackAction: stackWindow.pendingStackAction,
          },
        },
      },
      "pass_battle_flash"
    );
  });

  it("keeps every soul-core source available in a factored manual core draft", () => {
    const e = engine([normalCard]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(normalCard, {
            instanceId: "soul-a",
            ownerPlayerId: "alice",
            zone: "field",
            soulCoreCount: 1,
          }),
          createCardInstance(normalCard, {
            instanceId: "soul-b",
            ownerPlayerId: "alice",
            zone: "field",
            soulCoreCount: 1,
          }),
        ],
        playerOverrides: [
          {
            id: "alice",
            soulCoreLocation: { kind: "card", instanceId: "soul-a" },
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 64,
      factorManualCoreMovesThroughReserve: true,
    });
    const soulSources = node?.choices
      .flatMap((choice) => {
        const action = choice.systemAction;
        if (action?.kind !== "manual_core_move") return [];
        const draft = action.drafts[0];
        return draft?.kind === "soul" &&
          draft.from.kind === "card" &&
          draft.to.kind === "reserve"
          ? [draft.from.instanceId]
          : [];
      })
      .sort();

    expect(soulSources).toEqual(["soul-a", "soul-b"]);
  });

  it("rejects non-empty no-op manual core move choices through the shared helper", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ id: "alice", reserveNormalCoreCount: 1 }, {}],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node: TrainingDecisionNode = {
      nodeId: "manual-core-node",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "manual-core",
          label: "manual_core_move",
          systemAction: {
            kind: "manual_core_move",
            actingPlayerId: "alice",
            drafts: [
              {
                kind: "normal",
                from: { kind: "reserve", playerId: "alice" },
                to: { kind: "reserve", playerId: "alice" },
                amount: 1,
                purpose: "core_move",
              },
            ],
          },
        },
      ],
      truncated: false,
    };

    expect(() =>
      applyTrainingDecisionChoice(state, node, node.choices[0]!, engine())
    ).toThrow(/not useful/);
  });

  it("rejects stale manual core move choices whose endpoint left the actor field", () => {
    const staleCard = createCardInstance(normalCard, {
      instanceId: "stale-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [staleCard],
        playerOverrides: [{ id: "alice", reserveNormalCoreCount: 0 }, {}],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node: TrainingDecisionNode = {
      nodeId: "manual-core-node",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "manual-core",
          label: "manual_core_move",
          systemAction: {
            kind: "manual_core_move",
            actingPlayerId: "alice",
            drafts: [
              {
                kind: "normal",
                from: { kind: "card", instanceId: "stale-spirit" },
                to: { kind: "reserve", playerId: "alice" },
                amount: 1,
                purpose: "core_move",
              },
            ],
          },
        },
      ],
      truncated: false,
    };

    expect(() =>
      applyTrainingDecisionChoice(state, node, node.choices[0]!, engine())
    ).toThrow(/not useful/);
  });

  it("searches a TrainingDecisionNode and returns one of its choices", () => {
    const e = engine();
    const state = initializeGame({
      decks: [deck(), deck()],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 16,
    });
    expect(node).not.toBeNull();

    const result = searchTrainingDecisionMcts(
      state,
      node!,
      e,
      { iterations: 4, rolloutDepth: 2, maxGeneratedChoices: 16 },
      () => 0
    );

    expect(node!.choices.includes(result.choice)).toBe(true);
    expect(result.root.visits).toBe(4);
    expect(result.root.choices.length).toBeLessThanOrEqual(
      node!.choices.length
    );
  });

  it("wraps MCTS search as a TrainingPolicy", () => {
    const e = engine();
    const state = {
      ...initializeGame({
        decks: [deck(), deck()],
        skipPreGame: true,
        allowUnavailableDeckCards: true,
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      preGame: null,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 16,
    });
    expect(node).not.toBeNull();
    expect(node!.choices.length).toBeGreaterThan(1);

    const policy = makeMctsTrainingPolicy({
      iterations: 2,
      rolloutDepth: 1,
      maxGeneratedChoices: 16,
    });
    const selected: TrainingDecisionChoice = policy(state, node!, e, () => 0);

    expect(node!.choices.includes(selected)).toBe(true);
  });

  it("returns a forced single choice without serializing or exploring state", () => {
    const e = engine();
    const baseState = initializeGame({
      decks: [deck(), deck()],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });
    const node = getNextTrainingDecision(baseState, e, {
      maxGeneratedChoices: 16,
    });
    expect(node).not.toBeNull();
    expect(node!.choices).toHaveLength(1);
    const onlyChoice = node!.choices[0]!;
    let serializationCount = 0;
    const state = {
      ...baseState,
      toJSON: () => {
        serializationCount += 1;
        return baseState;
      },
    };

    const selected = makeMctsTrainingPolicy({
      iterations: 16,
      rolloutDepth: 12,
      maxStateSerializedChars: 128_000,
    })(state, node!, e, () => 0);

    expect(selected).toBe(onlyChoice);
    expect(serializationCount).toBe(0);
  });

  it("prefers progress over multi-option manual core surfaces under MCTS policy", () => {
    const e = engine([threeLevelSpirit]);
    const spirit = createCardInstance(threeLevelSpirit, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [spirit],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });

    expect(
      node?.choices.filter(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      ).length
    ).toBeGreaterThan(1);

    const policy = makeMctsTrainingPolicy({
      iterations: 4,
      rolloutDepth: 1,
      maxGeneratedChoices: 32,
    });
    const selected = policy(state, node!, e, () => 0);

    expect(selected.systemAction?.kind).toBe("advance_step");
  });

  it("keeps effect-debug random choices off manual core moves when a progress action exists", () => {
    const e = engine();
    const node: TrainingDecisionNode = {
      nodeId: "manual-random-node",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "manual",
          label: "manual_core_move",
          systemAction: {
            kind: "manual_core_move",
            actingPlayerId: "alice",
            drafts: [
              {
                kind: "normal",
                from: { kind: "reserve", playerId: "alice" },
                to: { kind: "card", instanceId: "spirit-1" },
                amount: 1,
                purpose: "core_move",
              },
            ],
          },
        },
        {
          choiceId: "advance",
          label: "advance_step",
          systemAction: { kind: "advance_step", actingPlayerId: "alice" },
        },
      ],
      truncated: false,
    };

    const selected = progressRandomTrainingPolicy(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node,
      e,
      () => 0
    );

    expect(selected.choiceId).toBe("advance");
  });

  it("prefers resolving a selected pending trigger over reselecting another pending under MCTS policy", () => {
    const e = engine();
    const selectAction: LegalAction = {
      chainId: "test:training-mcts-policy:1059",
      kind: "select_pending_to_resolve",
      actionId: "select-pending-a",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-a",
      ownerPlayerId: "alice",
      eventKind: "summon",
    };
    const resolveAction: LegalAction = {
      chainId: "test:training-mcts-policy:1069",
      kind: "resolve_pending_triggered_effect",
      actionId: "resolve-pending-b",
      can: true,
      reason: "test",
      actingPlayerId: "alice",
      pendingId: "pending-b",
      eventKind: "summon",
      executionMode: "mandatory",
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    };
    const node: TrainingDecisionNode = {
      nodeId: "pending-reselect-node",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "select-pending-a",
          label: "select_pending_to_resolve",
          action: selectAction,
        },
        {
          choiceId: "resolve-pending-b",
          label: "resolve_pending_triggered_effect",
          action: resolveAction,
        },
      ],
      truncated: false,
    };
    const policy = makeMctsTrainingPolicy({
      iterations: 0,
      rolloutDepth: 0,
      maxGeneratedChoices: 16,
    });

    const selected = policy(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      node,
      e,
      () => 0
    );

    expect(selected.action?.kind).toBe("resolve_pending_triggered_effect");
  });

  it("uses RNG instead of strategic priority for heuristic janken choices", () => {
    const e = engine();
    const state = waitingForBobJankenState(e);
    const node = getNextTrainingDecision(state, e);
    expect(node?.kind).toBe("pregame");
    expect(node?.actingPlayerId).toBe("bob");

    const selected = heuristicTrainingPolicy(state, node!, e, () => 0.99);

    expect(selected.choiceId).toBe("janken:paper");
  });

  it("does not let MCTS mirror the revealed first janken hand", () => {
    const e = engine();
    const state = waitingForBobJankenState(e);
    const node = getNextTrainingDecision(state, e);
    expect(node?.kind).toBe("pregame");
    expect(node?.actingPlayerId).toBe("bob");

    const policy = makeMctsTrainingPolicy({
      iterations: 16,
      rolloutDepth: 12,
      maxGeneratedChoices: 16,
    });
    const selected = policy(state, node!, e, () => 0.99);

    expect(selected.choiceId).toBe("janken:paper");
  });

  it("does not mutate the root state while exploring advance-step choices", () => {
    const e = engine();
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      log: [],
    };
    const node: TrainingDecisionNode = {
      nodeId: "advance-node",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "advance",
          label: "advance_step",
          systemAction: { kind: "advance_step", actingPlayerId: "alice" },
        },
      ],
      truncated: false,
    };

    searchTrainingDecisionMcts(
      state,
      node,
      e,
      { iterations: 1, rolloutDepth: 0, maxGeneratedChoices: 16 },
      () => 0
    );

    expect(state.log).toEqual([]);
    expect(state.step).toBe("main");
  });

  it("bounds MCTS simulations deterministically for oversized serializable states", () => {
    const e = engine();
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      preGame: null,
      log: ["large-state-budget"],
    };
    const node: TrainingDecisionNode = {
      nodeId: "bounded-advance-node",
      kind: "legal_action",
      actingPlayerId: "alice",
      fields: [],
      choices: [
        {
          choiceId: "advance",
          label: "advance_step",
          systemAction: { kind: "advance_step", actingPlayerId: "alice" },
        },
      ],
      truncated: false,
    };

    const result = searchTrainingDecisionMcts(
      state,
      node,
      e,
      {
        iterations: 8,
        rolloutDepth: 4,
        maxStateSerializedChars: 1,
      },
      () => 0
    );

    expect(result.root.visits).toBe(1);
  });

  it("does not mutate the root state while traversing a summon payment input node", () => {
    const e = engine();
    const handCard = createCardInstance(normalCard, {
      instanceId: "mcts-summon-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [handCard],
        playerOverrides: [
          { id: "alice", handCount: 1, reserveNormalCoreCount: 2 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
      preGame: null,
    };
    const root = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 16,
    });
    const summon = root?.choices.find(
      (choice) => choice.action?.kind === "summon"
    );
    expect(root?.kind).toBe("legal_action");
    expect(summon).toBeDefined();
    if (!root || !summon) return;

    const before = JSON.stringify(state);
    const telemetry = new AiWorkTelemetry();
    const result = searchTrainingDecisionMcts(
      state,
      { ...root, choices: [summon] },
      e,
      { iterations: 2, rolloutDepth: 1, maxGeneratedChoices: 16, telemetry },
      () => 0
    );

    expect(result.root.visits).toBe(2);
    expect(
      telemetry
        .snapshot()
        .measurements.find((row) => row.operation === "input_generation")!
        .returned
    ).toBeGreaterThan(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("does not mutate the root state while exploring generated manual core move choices", () => {
    const e = engine([threeLevelSpirit]);
    const spirit = createCardInstance(threeLevelSpirit, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [spirit],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };
    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });

    expect(
      node?.choices.some(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      )
    ).toBe(true);

    searchTrainingDecisionMcts(
      state,
      node!,
      e,
      { iterations: 4, rolloutDepth: 1, maxGeneratedChoices: 32 },
      () => 0
    );

    expect(
      state.cardInstances.find((card) => card.instanceId === "spirit-1")
        ?.normalCoreCount
    ).toBe(3);
    expect(
      state.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("keeps AI-facing manual core moves that lower a card's level", () => {
    const e = engine([levelNexus]);
    const nexus = createCardInstance(levelNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 16,
    });

    expect(
      node?.choices.some(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      )
    ).toBe(true);
  });

  it("keeps AI-facing manual core moves that raise a card's effective level", () => {
    const e = engine([levelNexus]);
    const nexus = createCardInstance(levelNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 1,
            reserveSoulCoreCount: 0,
            soulCoreLocation: null,
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });

    expect(
      node?.choices.some(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      )
    ).toBe(true);
  });

  it("can suppress manual core moves from the surface when regular legal actions exist", () => {
    const e = engine([normalCard, levelNexus]);
    const nexus = createCardInstance(levelNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const handCard = createCardInstance(normalCard, {
      instanceId: "hand-spirit-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, handCard],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 2,
            reserveSoulCoreCount: 0,
            soulCoreLocation: null,
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const defaultNode = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });
    const suppressedNode = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
      suppressManualCoreMovesWhenLegalActionsExist: true,
    });

    expect(
      defaultNode?.choices.some((choice) => choice.label === "summon")
    ).toBe(true);
    expect(
      defaultNode?.choices.some(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      )
    ).toBe(true);
    expect(
      suppressedNode?.choices.some((choice) => choice.label === "summon")
    ).toBe(true);
    expect(
      suppressedNode?.choices.some(
        (choice) => choice.systemAction?.kind === "manual_core_move"
      )
    ).toBe(false);
  });

  it("keeps reserve-recovery manual core moves even when further lowering remains legal", () => {
    const e = engine([threeLevelSpirit]);
    const spirit = createCardInstance(threeLevelSpirit, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [spirit],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 32,
    });

    const choice = node?.choices.find(
      (candidate) => candidate.systemAction?.kind === "manual_core_move"
    );

    expect(choice).toBeDefined();
    const next = applyTrainingDecisionChoice(state, node!, choice!, e);

    expect(
      next.cardInstances.find((card) => card.instanceId === "spirit-1")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      next.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(1);

    const nextNode = getNextTrainingDecision(next, e, {
      maxGeneratedChoices: 32,
    });
    expect(
      nextNode?.choices.some(
        (candidate) => candidate.systemAction?.kind === "manual_core_move"
      )
    ).toBe(true);
  });

  it("applies token-managed manual core moves through the forced-void projection", () => {
    const e = engine([tokenManagedSpirit, normalCard]);
    const token = createCardInstance(tokenManagedSpirit, {
      instanceId: "token-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const plain = createCardInstance(normalCard, {
      instanceId: "plain-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [token, plain],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 64,
    });
    const fromToken = node?.choices.find((candidate) => {
      const action = candidate.systemAction;
      return (
        action?.kind === "manual_core_move" &&
        action.drafts.some(
          (draft) =>
            draft.kind === "normal" &&
            draft.from.kind === "card" &&
            draft.from.instanceId === "token-1" &&
            draft.amount === 1
        )
      );
    });

    expect(fromToken).toBeDefined();
    const next = applyTrainingDecisionChoice(state, node!, fromToken!, e);

    expect(
      next.cardInstances.find((card) => card.instanceId === "token-1")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      next.cardInstances.find((card) => card.instanceId === "plain-1")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      next.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
    expect(
      next.players.find((player) => player.id === "alice")?.voidNormalCoreCount
    ).toBe(1);
  });

  it("does not offer manual core placement onto token-managed cards", () => {
    const e = engine([tokenManagedSpirit]);
    const token = createCardInstance(tokenManagedSpirit, {
      instanceId: "token-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [token],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 1 },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 64,
    });

    expect(
      node?.choices.some((candidate) => {
        const action = candidate.systemAction;
        return (
          action?.kind === "manual_core_move" &&
          action.drafts.some(
            (draft) =>
              draft.kind === "normal" &&
              draft.to.kind === "card" &&
              draft.to.instanceId === "token-1"
          )
        );
      })
    ).toBe(false);
  });

  it("suppresses inverse soul-core swap manual core moves after their distribution was visited", () => {
    const e = engine([levelNexus]);
    const soulHolder = createCardInstance(levelNexus, {
      instanceId: "soul-holder",
      ownerPlayerId: "alice",
      zone: "field",
      soulCoreCount: 1,
      everHadCorePlaced: true,
    });
    const normalHolder = createCardInstance(levelNexus, {
      instanceId: "normal-holder",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: true,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [soulHolder, normalHolder],
        playerOverrides: [
          {
            id: "alice",
            reserveNormalCoreCount: 0,
            reserveSoulCoreCount: 0,
            soulCoreLocation: { kind: "card", instanceId: "soul-holder" },
          },
          { id: "bob" },
        ],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main" as const,
      window: "none" as const,
    };

    const node = getNextTrainingDecision(state, e, {
      maxGeneratedChoices: 64,
    });
    const soulSwap = node?.choices.find((choice) => {
      const action = choice.systemAction;
      if (action?.kind !== "manual_core_move") return false;
      return (
        action.drafts.some(
          (draft) =>
            draft.kind === "soul" &&
            draft.from.kind === "card" &&
            draft.from.instanceId === "soul-holder" &&
            draft.to.kind === "card" &&
            draft.to.instanceId === "normal-holder"
        ) &&
        action.drafts.some(
          (draft) =>
            draft.kind === "normal" &&
            draft.from.kind === "card" &&
            draft.from.instanceId === "normal-holder" &&
            draft.to.kind === "card" &&
            draft.to.instanceId === "soul-holder"
        )
      );
    });

    expect(soulSwap).toBeDefined();
    const next = applyTrainingDecisionChoice(state, node!, soulSwap!, e);

    expect(
      next.players.find((player) => player.id === "alice")?.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "normal-holder" });
    expect(
      next.cardInstances.find((card) => card.instanceId === "soul-holder")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      next.cardInstances.find((card) => card.instanceId === "soul-holder")
        ?.soulCoreCount
    ).toBe(0);
    expect(
      next.cardInstances.find((card) => card.instanceId === "normal-holder")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      next.cardInstances.find((card) => card.instanceId === "normal-holder")
        ?.soulCoreCount
    ).toBe(1);
    const nextNode = getNextTrainingDecision(next, e, {
      maxGeneratedChoices: 64,
    });
    expect(
      nextNode?.choices.some((candidate) => {
        const action = candidate.systemAction;
        if (action?.kind !== "manual_core_move") return false;
        return (
          action.drafts.some(
            (draft) =>
              draft.kind === "soul" &&
              draft.from.kind === "card" &&
              draft.from.instanceId === "normal-holder" &&
              draft.to.kind === "card" &&
              draft.to.instanceId === "soul-holder"
          ) &&
          action.drafts.some(
            (draft) =>
              draft.kind === "normal" &&
              draft.from.kind === "card" &&
              draft.from.instanceId === "soul-holder" &&
              draft.to.kind === "card" &&
              draft.to.instanceId === "normal-holder"
          )
        );
      })
    ).toBe(false);
  });
});
