import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  createActionInputDecisionNode,
  generateActionInputChoices,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import {
  applyChosenAction,
  advance,
  buildEngine,
  chooseSelfplayMainStepAdvance,
  legalActionsFor,
  mulberry32,
  playGame,
  playGameAsync,
  resolveActionInputs,
  type Engine,
} from "./selfplay-driver";

const NEXUS: CardDefinition = {
  cardNo: "SELFPLAY-TOP-LEVEL-PAYMENT",
  name: "Selfplay payment",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

describe("selfplay top-level input completion", () => {
  it.each([
    {
      candidates: ["other", "forced"],
      required: 1,
      duplicates: false,
      expected: ["forced", "nexus"],
    },
    {
      candidates: ["forced"],
      required: 2,
      duplicates: true,
      expected: ["forced", "forced", "nexus"],
    },
  ])(
    "keeps mandatory targets and duplicate slots within grouped input: $required",
    ({ candidates, required, duplicates, expected }) => {
      const state = createEmptyGameState();
      const action = {
        kind: "resolve_pending_effect_target",
        pendingId: "grouped-forced-target-input",
        actingPlayerId: state.players[0]!.id,
        can: true,
        candidateTargetInstanceIds: [...candidates, "nexus"],
        mandatoryTargetInstanceIds: ["forced"],
        requiredTargetCount: required + 1,
        maxTargetCount: required + 1,
        allowDuplicateTargets: duplicates,
        targetGroups: [
          {
            targetStepId: "first",
            requiredTargetCount: required,
            maxTargetCount: required,
            candidateTargetInstanceIds: candidates,
          },
          {
            targetStepId: "second",
            requiredTargetCount: 1,
            maxTargetCount: 1,
            candidateTargetInstanceIds: ["nexus"],
          },
        ],
      } as LegalAction;
      expect(
        [...(resolveActionInputs(state, action).targetInstanceIds ?? [])].sort()
      ).toEqual([...expected].sort());
    }
  );
  it("retains one complete grouped selection when the choice limit is one", () => {
    const state = createEmptyGameState();
    const action = {
      kind: "resolve_pending_effect_target",
      pendingId: "grouped-target-input",
      actingPlayerId: state.players[0]!.id,
      can: true,
      candidateTargetInstanceIds: ["spirit-a", "spirit-b", "nexus"],
      requiredTargetCount: 2,
      maxTargetCount: 2,
      targetGroups: [
        {
          targetStepId: "destroy-spirit",
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateTargetInstanceIds: ["spirit-a", "spirit-b"],
        },
        {
          targetStepId: "recover-nexus",
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateTargetInstanceIds: ["nexus"],
        },
      ],
    } as LegalAction;
    expect(
      [...(resolveActionInputs(state, action).targetInstanceIds ?? [])].sort()
    ).toEqual(["nexus", "spirit-a"]);
  });
  it.each([
    "resolve_pending_effect_target",
    "resolve_pending_step_optional_target_selection",
  ] as const)(
    "%s includes the mandatory target even when it is last",
    (kind) => {
      const state = createEmptyGameState();
      const action = {
        kind,
        pendingId: "forced-target-input",
        actingPlayerId: state.players[0]!.id,
        can: true,
        candidateTargetInstanceIds: ["other", "forced"],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        mandatoryTargetInstanceIds: ["forced"],
      } as LegalAction;
      expect(resolveActionInputs(state, action).targetInstanceIds).toEqual([
        "forced",
      ]);
    }
  );
  it("uses the alternate discard when Vwal has fewer than three hand cards", () => {
    const fullEngine = buildEngine();
    const vwal = fullEngine.getCardDefinitionById("BSTH01-C12")!;
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 1, handCount: 1 }, {}],
        cardInstances: [
          createCardInstance(vwal, {
            instanceId: "vwal",
            ownerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(vwal, {
            instanceId: "hand",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(vwal, {
            instanceId: "deck",
            ownerPlayerId: "alice",
            zone: "deck",
          }),
        ],
      }),
      activePlayerId: "alice",
      turnNumber: 2,
      step: "core",
    };
    const afterDraw = advance(state, fullEngine);
    const action = legalActionsFor(afterDraw, fullEngine).actions.find(
      (a) => a.kind === "resolve_pending_zone_selection"
    );
    if (!action || action.kind !== "resolve_pending_zone_selection")
      throw new Error("missing Vwal discard");
    expect(action.candidateCardInstanceIds).toHaveLength(2);
    expect(action.maxCount).toBe(3);
    expect(action.canSkip).toBe(false);
    const choices = generateActionInputChoices(
      afterDraw,
      action,
      { getCardDefinitionById: fullEngine.getCardDefinitionById },
      64
    );
    expect(choices.values).toHaveLength(2);
    expect(
      choices.values.every((c) => c.selectedZoneCardIds?.length === 1)
    ).toBe(true);
    const input = resolveActionInputs(
      afterDraw,
      action,
      fullEngine.getCardDefinitionById
    );
    expect(input.selectedZoneCardIds).toHaveLength(1);
    const final = applyChosenAction(afterDraw, action, fullEngine);
    expect(final.pendingZoneSelection).toBeNull();
    expect(final.players[0]?.handCount).toBe(1);
    expect(final.cardInstances.filter((c) => c.zone === "trash")).toHaveLength(
      1
    );
    expect(
      final.cardInstances.find(
        (c) => c.instanceId === input.selectedZoneCardIds![0]
      )?.zone
    ).toBe("trash");
    const impossible = generateActionInputChoices(
      afterDraw,
      {
        ...action,
        alternateSelections: [
          {
            count: 3,
            candidateInstanceIds: ["hand", "deck"],
            label: "unavailable",
          },
        ],
      },
      { getCardDefinitionById: fullEngine.getCardDefinitionById },
      64
    );
    expect(impossible.values).toHaveLength(0);
  });
  const engine: Engine = {
    ...buildEngine(),
    cards: [NEXUS],
    getCardDefinitionById: (id) => (id === NEXUS.cardNo ? NEXUS : undefined),
  };

  it("supplies payment sources and resolves the normal placement stack", () => {
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 3, reserveSoulCoreCount: 0, handCount: 1 },
        {},
      ],
      cardInstances: [
        createCardInstance(NEXUS, {
          instanceId: "nexus",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    state = { ...state, activePlayerId: "alice", step: "main" };
    const before = state;
    const action = legalActionsFor(state, engine).actions.find(
      (a) => a.kind === "place_nexus"
    );
    if (!action) throw new Error("expected legal placement");
    expect(
      resolveActionInputs(state, action, engine.getCardDefinitionById)
        .paymentSources
    ).toEqual([{ kind: "reserve", amount: 2 }]);
    state = applyChosenAction(state, action, engine);
    expect(before.players[0]?.reserveNormalCoreCount).toBe(3);
    expect(state.players[0]?.reserveNormalCoreCount).toBe(1);
    expect(state.players[0]?.trashNormalCoreCount).toBe(2);
    expect(state.stackWindow).not.toBeNull();
    expect(chooseSelfplayMainStepAdvance(state, "alice", [], () => 0)).toBe(
      false
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("in_use");
    const pass = legalActionsFor(state, engine).actions.find(
      (a) => a.kind === "pass_stack"
    );
    if (!pass) throw new Error("expected stack pass");
    state = applyChosenAction(state, pass, engine);
    expect(state.stackWindow).toBeNull();
    expect(state.pendingEnterFieldPlacement?.sourceInstanceId).toBe("nexus");
    expect(chooseSelfplayMainStepAdvance(state, "alice", [], () => 0)).toBe(
      false
    );
    const placement = legalActionsFor(state, engine).actions.find(
      (candidate) => candidate.kind === "resolve_pending_enter_field_placement"
    );
    if (!placement) throw new Error("expected pending placement");
    state = applyChosenAction(state, placement, engine);
    expect(state.pendingEnterFieldPlacement).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("field");
    expect(state.players[0]?.handCount).toBe(0);
    expect(state.players[0]?.reserveNormalCoreCount).toBe(1);
    expect(state.players[0]?.trashNormalCoreCount).toBe(2);
  });

  it("uses only granted normal trash cores for token maintenance in both input surfaces", () => {
    const gameEngine = buildEngine();
    const token = gameEngine.getCardDefinitionById("BSES01-T01")!;
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 0,
            reserveSoulCoreCount: 0,
            trashNormalCoreCount: 7,
            trashSoulCoreCount: 1,
          },
          {},
        ],
        cardInstances: [
          createCardInstance(token, {
            instanceId: "token",
            ownerPlayerId: "alice",
            zone: "field",
          }),
        ],
      }),
      pendingMultiPlacement: {
        pendingId: "token-maintenance",
        actingPlayerId: "alice",
        targets: [
          { instanceId: "token", minimumCoreCount: 1, maximumCoreCount: 1 },
        ],
        trashNormalCoreMax: 1,
      },
    };
    const action = legalActionsFor(state, gameEngine).actions.find(
      (a) => a.kind === "resolve_pending_multi_placement"
    );
    if (!action || action.kind !== "resolve_pending_multi_placement")
      throw new Error("expected token placement");
    const context = {
      getCardDefinitionById: gameEngine.getCardDefinitionById,
      limit: 128,
    };
    const choices = generateActionInputChoices(state, action, context);
    expect(choices.values).toEqual([
      {
        multiPlacementAllocations: [
          {
            destinationInstanceId: "token",
            placements: [{ kind: "trash_normal", amount: 1 }],
          },
        ],
      },
    ]);
    const input = resolveActionInputs(
      state,
      action,
      gameEngine.getCardDefinitionById
    );
    expect(input).toEqual(choices.values[0]);
    const after = applyChosenAction(state, action, gameEngine);
    expect(after.pendingMultiPlacement).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "token")?.normalCoreCount
    ).toBe(1);
    expect(after.players[0]?.trashNormalCoreCount).toBe(6);
    expect(after.players[0]?.trashSoulCoreCount).toBe(1);
    const training = createActionInputDecisionNode(state, action, context);
    expect(training?.choices).toHaveLength(1);
    expect(training?.choices[0]?.systemAction).toMatchObject({
      source: { kind: "trash", normalCap: 1, soulCap: 0 },
      normalAmount: 1,
      soulAmount: 0,
    });
    expect(
      generateActionInputChoices(
        state,
        { ...action, trashNormalCoreMax: 0 },
        context
      ).values
    ).toEqual([]);
    const soulOnly = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 0 } : p
      ),
    };
    expect(
      generateActionInputChoices(soulOnly, action, context).values
    ).toEqual([]);
    // One shared grant cannot fund both destinations.
    const multi = {
      ...action,
      targets: [
        ...action.targets,
        { instanceId: "second", minimumCoreCount: 1, maximumCoreCount: 1 },
      ],
    };
    const multiState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(token, {
          instanceId: "second",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    expect(
      generateActionInputChoices(multiState, multi, context).values
    ).toEqual([]);
    // A larger grant still cannot spend the same physical trash core twice.
    const shortage = {
      ...multiState,
      players: multiState.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 1 } : p
      ),
    };
    expect(
      generateActionInputChoices(
        shortage,
        { ...multi, trashNormalCoreMax: 2 },
        context
      ).values
    ).toEqual([]);
  });

  it.each(["none", "step_end"] as const)(
    "%s: offers main-step completion alongside unchanged legal normal actions",
    (window) => {
      const state = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(NEXUS, {
              instanceId: "nexus",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
          ],
          playerOverrides: [{ reserveNormalCoreCount: 3, handCount: 1 }, {}],
        }),
        turnNumber: 2,
        activePlayerId: "alice",
        step: "main" as const,
        window,
      };
      const actions = legalActionsFor(state, engine).actions;
      expect(actions.some((action) => action.kind === "place_nexus")).toBe(
        true
      );
      expect(
        chooseSelfplayMainStepAdvance(state, "alice", actions, () => 0)
      ).toBe(true);
      expect(
        chooseSelfplayMainStepAdvance(state, "alice", actions, () => 0.99)
      ).toBe(false);
      expect(
        chooseSelfplayMainStepAdvance(state, "bob", actions, () => 0)
      ).toBe(false);
      const declared = applyChosenAction(
        state,
        actions.find((action) => action.kind === "place_nexus")!,
        engine
      );
      expect(declared.stackWindow).not.toBeNull();
      expect(
        chooseSelfplayMainStepAdvance(declared, "alice", actions, () => 0)
      ).toBe(false);
      expect(
        chooseSelfplayMainStepAdvance(
          { ...state, step: "attack" },
          "alice",
          actions,
          () => 0
        )
      ).toBe(false);
      expect(legalActionsFor(state, engine).actions).toEqual(actions);
      const completed = advance(state, engine);
      expect(completed.step).toBe("attack");
      expect(
        completed.cardInstances.find((card) => card.instanceId === "nexus")
          ?.zone
      ).toBe("hand");
      expect(completed.players[0]?.reserveNormalCoreCount).toBe(3);
    }
  );

  it("keeps existing opponent core totals in both change distribution phases", () => {
    const gameEngine = buildEngine();
    const card = (
      cardNo: string,
      instanceId: string,
      owner: string,
      cores: number,
      zone: "hand" | "field" = "field"
    ) =>
      createCardInstance(gameEngine.getCardDefinitionById(cardNo)!, {
        instanceId,
        ownerPlayerId: owner,
        controllerPlayerId: owner,
        zone,
        normalCoreCount: cores,
      });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSKB01-R02", "change", "alice", 0, "hand"),
          card("BSKB01-C04", "bob-one", "bob", 1),
          card("BSKB01-C04", "bob-zero", "bob", 0),
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 4, reserveSoulCoreCount: 0 },
          { reserveNormalCoreCount: 0, reserveSoulCoreCount: 0 },
        ],
      }),
      step: "main",
      window: "none",
      activePlayerId: "alice",
      turnNumber: 3,
    };
    const apply = (kind: LegalAction["kind"]) => {
      const action = legalActionsFor(state, gameEngine).actions.find(
        (a) => a.kind === kind
      );
      if (!action) throw new Error(`missing ${kind}`);
      state = applyChosenAction(state, action, gameEngine);
    };
    apply("use_change");
    apply("pass_stack");
    expect(state.pendingCoreDistribution?.targetTotalSelection).toMatchObject({
      targetChooserPlayerId: "alice",
      sourceOwnerPlayerId: "bob",
    });
    apply("resolve_pending_core_distribution");
    expect(state.pendingCoreDistribution?.actingPlayerId).toBe("bob");
    const totals =
      state.pendingCoreDistribution?.targetTotalSelection?.fixedTargetTotals;
    expect(
      Object.values(totals ?? {}).reduce((sum, amount) => sum + amount, 0)
    ).toBe(1);
    apply("resolve_pending_core_distribution");
    expect(state.pendingCoreDistribution).toBeNull();
    expect(
      state.cardInstances
        .filter((c) => c.ownerPlayerId === "bob")
        .reduce((sum, c) => sum + c.normalCoreCount + c.soulCoreCount, 0)
    ).toBe(1);
    expect(
      state.players.find((p) => p.id === "bob")?.reserveNormalCoreCount
    ).toBe(0);
    expect(
      state.players.find((p) => p.id === "alice")?.trashNormalCoreCount
    ).toBe(4);
  });

  it.each(["alice", "bob"])(
    "%s: targeted response drains before the outer placement trigger",
    (owner) => {
      const gameEngine = buildEngine();
      const opponent = owner === "alice" ? "bob" : "alice";
      const card = (
        no: string,
        id: string,
        player: string,
        zone: "hand" | "field" | "trash" | "deck"
      ) =>
        createCardInstance(gameEngine.getCardDefinitionById(no)!, {
          instanceId: id,
          ownerPlayerId: player,
          controllerPlayerId: player,
          zone,
        });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            card("BSTH04-転醒R01(A)", "mirror", owner, "hand"),
            card("BSTH04-C01", "old", owner, "trash"),
            card("BSGE01-C13", "fenrir", opponent, "field"),
            ...[owner, opponent].flatMap((p) =>
              [1, 2].map((n) => card("BSTH04-C01", `${p}-deck-${n}`, p, "deck"))
            ),
          ],
          playerOverrides: ["alice", "bob"].map((p) => ({
            handCount: p === owner ? 1 : 0,
            deckCount: 2,
            reserveNormalCoreCount: 10,
          })),
        }),
        step: "main",
        window: "none",
        turnNumber: 3,
        activePlayerId: owner,
      };
      const apply = (predicate: (a: LegalAction) => boolean) => {
        const action = legalActionsFor(state, gameEngine).actions.find(
          predicate
        );
        if (!action) throw new Error("expected pending resolution action");
        state = applyChosenAction(state, action, gameEngine);
      };
      apply((a) => a.kind === "place_nexus");
      apply((a) => a.kind === "pass_stack");
      const outer = state.pendingTriggeredEffects.find(
        (p) => p.eventKind === "place"
      );
      expect(outer).toBeDefined();
      expect(state.pendingTargetedDisclosureContinuation).not.toBeNull();
      expect(
        legalActionsFor(state, gameEngine).actions.every(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "fenrir"
        )
      ).toBe(true);
      apply(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "fenrir"
      );
      apply((a) => a.kind === "pass_stack");
      expect(state.pendingStepOptionalChoice).not.toBeNull();
      expect(state.pendingTargetedDisclosureContinuation).not.toBeNull();
      apply(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      );
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingTargetedDisclosureContinuation).toBeNull();
      expect(state.pendingTriggeredEffects).toContainEqual(outer);
      const outerAction = legalActionsFor(state, gameEngine).actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.pendingId === outer!.pendingId
      );
      if (!outerAction) throw new Error("expected preserved outer trigger");
      state = applyLegalAction({
        state,
        action: outerAction,
        skipOptionalEffect: true,
        getCardDefinitionById: gameEngine.getCardDefinitionById,
        ...gameEngine.lookups,
      }).state;
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingEffectCompletions).toHaveLength(0);
      expect(state.pendingResolutionEndLogs).toHaveLength(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "mirror")?.zone
      ).toBe("field");
      expect(
        state.cardInstances.find((c) => c.instanceId === "fenrir")?.zone
      ).toBe("field");
      expect(
        state.players.find((p) => p.id === owner)?.reserveNormalCoreCount
      ).toBe(7);
      expect(
        state.players.find((p) => p.id === owner)?.trashNormalCoreCount
      ).toBe(3);
    }
  );

  it.each(["alice", "bob"])(
    "%s: draw-step discard returns an actionable optional trash retrieval",
    (owner) => {
      const gameEngine = buildEngine();
      const card = (no: string, id: string, zone: "field" | "deck") =>
        createCardInstance(gameEngine.getCardDefinitionById(no)!, {
          instanceId: id,
          ownerPlayerId: owner,
          controllerPlayerId: owner,
          zone,
        });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: ["alice", "bob"].map((p) => ({
            deckCount: p === owner ? 3 : 0,
            handCount: 0,
          })),
          cardInstances: [
            card("BSTH001-C03", "makai", "field"),
            card("BSTH11-X01", "retrieval", "deck"),
            card("BSTH04-C01", "discard", "deck"),
            card("BSTH04-C01", "remaining", "deck"),
          ],
        }),
        activePlayerId: owner,
        turnNumber: 3,
        step: "core",
        window: "none",
      };
      state = advance(state, gameEngine);
      expect(state.step).toBe("draw");
      expect(state.pendingTrashOptionalAdds).toHaveLength(0);
      expect(state.pendingDeckReveal).toMatchObject({
        origin: "trash",
        phase: "revealed_choice",
        actingPlayerId: owner,
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "retrieval")?.zone
      ).toBe("trash");
      const action = legalActionsFor(state, gameEngine).actions.find(
        (a) => a.kind === "resolve_pending_deck_reveal_pick"
      );
      if (!action) throw new Error("expected optional trash choice");
      state = applyLegalAction({
        state,
        action,
        selectedDeckRevealCardIds: ["retrieval"],
        getCardDefinitionById: gameEngine.getCardDefinitionById,
        ...gameEngine.lookups,
      }).state;
      expect(state.pendingDeckReveal).toBeNull();
      expect(
        state.cardInstances.find((c) => c.instanceId === "retrieval")?.zone
      ).toBe("set_aside");
      expect(
        state.cardInstances.find((c) => c.instanceId === "discard")?.zone
      ).toBe("trash");
      expect(state.players.find((p) => p.id === owner)?.deckCount).toBe(1);
      expect(advance(state, gameEngine).step).toBe("refresh");
    }
  );

  it.each([false, true])(
    "targeted response drains before forced-block confirmation (restored overlapping window: %s)",
    (overlappingWindow) => {
      const gameEngine = buildEngine();
      const card = (no: string, id: string, owner: string, cores: number) =>
        createCardInstance(gameEngine.getCardDefinitionById(no)!, {
          instanceId: id,
          ownerPlayerId: owner,
          controllerPlayerId: owner,
          zone: "field",
          normalCoreCount: cores,
          ...(id === "blocker" ? { exhaustState: "exhausted" as const } : {}),
        });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            card("BSLH01-C10", "attacker", "alice", 1),
            card("BSSA01-X01", "blocker", "bob", 1),
            card("BSGE01-C13", "fenrir", "bob", 0),
          ],
        }),
        activePlayerId: "alice",
        turnNumber: 3,
        step: "attack",
        window: "none",
      };
      const apply = (predicate: (a: LegalAction) => boolean, extra = {}) => {
        const action = legalActionsFor(state, gameEngine).actions.find(
          predicate
        );
        if (!action) throw new Error("expected forced-block resolution action");
        state = applyLegalAction({
          state,
          action,
          ...resolveActionInputs(
            state,
            action,
            gameEngine.getCardDefinitionById
          ),
          getCardDefinitionById: gameEngine.getCardDefinitionById,
          ...gameEngine.lookups,
          ...extra,
        }).state;
      };
      apply((a) => a.kind === "attack" && a.targetInstanceId === "blocker");
      apply((a) => a.kind === "pass_pre_declaration_stack");
      apply((a) => a.kind === "resolve_battle_immediate_effect");
      apply((a) => a.kind === "pass_stack");
      expect(state.preDeclarationStackWindow).toBeNull();
      expect(state.window).toBe("declare_attack");
      if (overlappingWindow) {
        // Restore the overlapping container from the failed integration seed.
        // The normal path above must now wait for the attack effect to finish.
        state = {
          ...state,
          window: "pre_declaration_stack",
          preDeclarationStackWindow: {
            kind: "forced_block",
            actingPlayerId: "bob",
            sourceInstanceId: "blocker",
            participantEntityId: "battle-entity:attacker",
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            previousWindow: "declare_attack",
            stackResponseSourcePlayerId: "bob",
            pendingStackAction: null,
          },
        };
      }
      apply((a) => a.kind === "resolve_pending_effect_target", {
        targetInstanceIds: ["fenrir"],
      });
      apply(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "fenrir"
      );
      apply(
        (a) =>
          a.kind ===
          (overlappingWindow ? "pass_pre_declaration_stack" : "pass_stack")
      );
      expect(state.pendingStepOptionalChoice?.sourceInstanceId).toBe("fenrir");
      expect(state.pendingTargetedDisclosureContinuation).not.toBeNull();
      expect(
        state.activeAttack?.blockAssignments[0]?.blockedByEntityIds
      ).toEqual([]);
      apply(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      );
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingTargetedDisclosureContinuation).toBeNull();
      expect(state.pendingPreDeclarationConfirmation).toBeNull();
      if (!overlappingWindow) {
        expect(state.preDeclarationStackWindow?.kind).toBe("forced_block");
        expect(
          state.activeAttack?.blockAssignments[0]?.blockedByEntityIds
        ).toEqual([]);
        apply((a) => a.kind === "pass_pre_declaration_stack");
      }
      expect(
        state.activeAttack?.blockAssignments[0]?.blockedByEntityIds
      ).toEqual(["battle-entity:blocker"]);
      expect(
        state.cardInstances.find((c) => c.instanceId === "fenrir")?.zone
      ).toBe("field");
      expect(
        state.cardInstances.find((c) => c.instanceId === "blocker")
          ?.exhaustState
      ).toBe("exhausted");
      expect(
        state.log.filter((l) => l.startsWith("block:forced:"))
      ).toHaveLength(1);
    }
  );

  it.each([
    1_558_703_219, 1_558_703_230, 1_558_703_246, 1_558_703_276, 1_558_704_452,
    1_558_705_581, 1_558_706_828, 1_558_706_842, 1_558_706_866, 1_558_709_111,
    958_147_760, 926_912_505, 1_498_498_078, 1_558_764_185,
  ])(
    "integration failure seed %i reaches the same natural result in both drivers",
    async (seed) => {
      const gameEngine = buildEngine();
      const result = await playGameAsync({
        engine: gameEngine,
        rng: mulberry32(seed),
      });
      expect(result.outcome, result.lastError).toBe("natural");
      expect(playGame({ engine: gameEngine, rng: mulberry32(seed) })).toEqual(
        result
      );
    }
  );
});
