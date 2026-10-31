import { describe, expect, it } from "vitest";
import type { CardDefinition, CollectedTriggerEvent } from "../src";
import {
  advanceStep,
  applyLegalAction,
  buildResolutionItems,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queueEffectActivationTriggers,
  queueInitialStartStepTrigger,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

function makeSpirit(
  cardNo: string,
  zone: "field" | "hand",
  executionMode: "mandatory" | "optional" = "optional"
): CardDefinition {
  return {
    cardNo,
    name: `P3-28 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone },
        executionMode,
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return (definitionId: string) => map.get(definitionId);
}

function makeStartStepEvent(): CollectedTriggerEvent {
  return {
    actingPlayerId: "alice",
    eventKind: "start_step",
    source: "step_transition",
    chainId: "test:p3-28-private-declaration:53",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId: null,
    amount: null,
    step: "start",
    subPhase: "start",
  };
}

function makePrivateMultiTargetResponder(cardNo: string): CardDefinition {
  return {
    ...makeSpirit(cardNo, "hand"),
    effects: [
      {
        timing: { kind: "game_event", player: "self", event: "targeted" },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: { source: { kind: "trigger_related_instances" } },
            },
          },
        ],
      },
    ],
  };
}

function makePrivateEffectActivationLatchResponder(
  cardNo: string
): CardDefinition {
  return {
    ...makeSpirit(cardNo, "hand"),
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "effect_activated",
          latchSourceAtEffectActivationStart: true,
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makePublicMultiTargetResponder(cardNo: string): CardDefinition {
  return {
    ...makeSpirit(cardNo, "field"),
    effects: [
      {
        timing: { kind: "game_event", player: "self", event: "targeted" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: { source: { kind: "trigger_related_instances" } },
            },
          },
        ],
      },
    ],
  };
}

function makeTargetedEvent(
  relatedInstanceId: string,
  relatedPlayerId = "alice"
): CollectedTriggerEvent {
  return {
    actingPlayerId: relatedPlayerId,
    eventKind: "targeted",
    source: "action_resolution",
    chainId: "chain:multi-target-private",
    attackId: null,
    relatedPlayerId,
    relatedInstanceId,
    amount: null,
    cause: "opponent_effect",
    effectSourceInstanceId: "opponent-effect-1",
    effectSourceDefinitionId: "P3-28-MAGIC",
    effectActionKind: "magic",
  };
}

describe("P3-28 private triggered declaration", () => {
  it("queues optional hand-source triggers as private declarations instead of public pending effects", () => {
    const handDef = makeSpirit("P3-28-HAND", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "hand-source-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(next.pendingTriggeredEffects).toHaveLength(0);
    expect(next.pendingPrivateDeclarations).toHaveLength(1);
    expect(next.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "hand-source-1",
      sourceDefinitionId: "P3-28-HAND",
      sourceZone: "hand",
      eventKind: "start_step",
    });

    const aliceActions = getLegalActions({
      state: next,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const bobActions = getLegalActions({
      state: next,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });

    expect(aliceActions.map((action) => action.kind)).toEqual([
      "declare_private_triggered_effect",
      "skip_private_triggered_effect",
    ]);
    expect(bobActions).toEqual([]);
  });

  it("declare moves the private prompt to a public pending effect and suppresses optional skip at resolution time", () => {
    const handDef = makeSpirit("P3-28-HAND", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "hand-source-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declareAction).toBeDefined();
    if (
      !declareAction ||
      declareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing declare action");
    }

    const declared = applyLegalAction({
      state: queued,
      action: declareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(declared.pendingPrivateDeclarations).toHaveLength(0);
    expect(declared.pendingTriggeredEffects).toHaveLength(1);
    expect(declared.pendingTriggeredEffects[0]).toMatchObject({
      declaredFromPrivateZone: true,
      declaredSourceInstanceId: "hand-source-1",
      declaredRegistrationIndex: 0,
      resolvedSourceInstanceIds: ["hand-source-1"],
    });

    const resolveActions = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0]).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      executionMode: "mandatory",
      sourceInstanceId: "hand-source-1",
    });
  });

  it("preserves effect-activation-start latch ids through private declaration", () => {
    const handDef =
      makePrivateEffectActivationLatchResponder("P3-28-HAND-LATCH");
    const activatedDef = makeSpirit("P3-28-ACTIVATED", "field");
    const lookup = makeLookup([handDef, activatedDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef, activatedDef]);
    const handSource = createCardInstance(handDef, {
      instanceId: "hand-latch-source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const activatedSource = createCardInstance(activatedDef, {
      instanceId: "activated-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [handSource, activatedSource],
    });

    const queued = queueEffectActivationTriggers({
      chainId: "test:p3-28-private-declaration:301",
      state,
      activatorPlayerId: "alice",
      relatedInstanceId: activatedSource.instanceId,
      eligibleSourceInstanceIds: [handSource.instanceId],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    });
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);
    expect(
      queued.pendingPrivateDeclarations[0]?.eligibleSourceInstanceIds
    ).toEqual([handSource.instanceId]);

    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declareAction).toBeDefined();
    if (
      !declareAction ||
      declareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing declare action");
    }

    const declared = applyLegalAction({
      state: queued,
      action: declareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(declared.pendingPrivateDeclarations).toHaveLength(0);
    expect(declared.pendingTriggeredEffects).toHaveLength(1);
    expect(
      declared.pendingTriggeredEffects[0]?.eligibleSourceInstanceIds
    ).toEqual([handSource.instanceId]);

    const resolveAction = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === handSource.instanceId
    );
    expect(resolveAction).toBeDefined();
  });

  it("preserves multiple trigger_related_instances through private declaration resolution", () => {
    const handDef = makePrivateMultiTargetResponder("P3-28-HAND-MULTI");
    const targetDef = makeSpirit("P3-28-TARGET", "field");
    const lookup = makeLookup([handDef, targetDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef, targetDef]);
    const handSource = createCardInstance(handDef, {
      instanceId: "hand-source-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const targetA = createCardInstance(targetDef, {
      instanceId: "target-a",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetB = createCardInstance(targetDef, {
      instanceId: "target-b",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [handSource, targetA, targetB],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        makeTargetedEvent(targetA.instanceId),
        makeTargetedEvent(targetB.instanceId),
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);
    expect(queued.pendingPrivateDeclarations[0]).toMatchObject({
      sourceInstanceId: handSource.instanceId,
      relatedInstanceIds: [targetA.instanceId, targetB.instanceId],
      relatedInstanceIdsBySourceRegistrationKey: {
        [`${handSource.instanceId}#0`]: [
          targetA.instanceId,
          targetB.instanceId,
        ],
      },
    });

    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declareAction).toBeDefined();
    if (
      !declareAction ||
      declareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing declare action");
    }

    const declared = applyLegalAction({
      state: queued,
      action: declareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(declared.pendingTriggeredEffects).toHaveLength(1);
    expect(declared.pendingTriggeredEffects[0]).toMatchObject({
      declaredFromPrivateZone: true,
      relatedInstanceIds: [targetA.instanceId, targetB.instanceId],
      relatedInstanceIdsBySourceRegistrationKey: {
        [`${handSource.instanceId}#0`]: [
          targetA.instanceId,
          targetB.instanceId,
        ],
      },
    });
  });

  it("filters trigger_related_instances per source when deferred public triggers resolve from stack", () => {
    const sourceDef = makePublicMultiTargetResponder("P3-28-FIELD-MULTI");
    const targetDef = makeSpirit("P3-28-TARGET", "field");
    const lookup = makeLookup([sourceDef, targetDef]);
    const triggerLookup = buildTriggeredEffectLookup([sourceDef, targetDef]);
    const aliceSource = createCardInstance(sourceDef, {
      instanceId: "alice-source",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const bobSource = createCardInstance(sourceDef, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const aliceTarget = createCardInstance(targetDef, {
      instanceId: "alice-target",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobTarget = createCardInstance(targetDef, {
      instanceId: "bob-target",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [aliceSource, bobSource, aliceTarget, bobTarget],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        makeTargetedEvent(aliceTarget.instanceId, "alice"),
        makeTargetedEvent(bobTarget.instanceId, "bob"),
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    const alicePending = queued.pendingTriggeredEffects.find(
      (pending) => pending.relatedInstanceId === aliceTarget.instanceId
    );
    expect(alicePending).toBeDefined();
    if (!alicePending) throw new Error("missing alice pending");
    expect(alicePending).toMatchObject({
      relatedInstanceIds: [aliceTarget.instanceId, bobTarget.instanceId],
      relatedInstanceIdsBySourceRegistrationKey: {
        [`${aliceSource.instanceId}#0`]: [aliceTarget.instanceId],
        [`${bobSource.instanceId}#0`]: [bobTarget.instanceId],
      },
    });

    const queuedAliceOnly: typeof queued = {
      ...queued,
      pendingTriggeredEffects: [alicePending],
    };
    const resolveAction = getLegalActions({
      state: queuedAliceOnly,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === aliceSource.instanceId
    );
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("missing alice resolve action");
    }

    const stacked = applyLegalAction({
      state: queuedAliceOnly,
      action: resolveAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).state;
    const passAction = getLegalActions({
      state: stacked,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();
    if (!passAction || passAction.kind !== "pass_stack") {
      throw new Error("missing pass action");
    }

    const resolved = applyLegalAction({
      state: stacked,
      action: passAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).state;

    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === aliceSource.instanceId
      )?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === bobSource.instanceId
      )?.normalCoreCount
    ).toBe(2);
  });

  it("uses declaredSourceDefinitionId for declared private effects even when the hand card instance is sanitized", () => {
    const handDef = makeSpirit("P3-28-HAND", "hand");
    const hiddenCard = {
      ...createCardInstance(handDef, {
        instanceId: "hand-source-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      definitionId: "_hidden_card_",
      originalDefinitionId: "_hidden_card_",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [hiddenCard],
      pendingTriggeredEffects: [
        {
          pendingId: "pending-declared",
          actingPlayerId: "alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:p3-28-private-declaration:578",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
          resolvedSourceInstanceIds: ["hand-source-1"],
          declaredFromPrivateZone: true,
          declaredSourceInstanceId: "hand-source-1",
          declaredSourceDefinitionId: "P3-28-HAND",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: 0,
        },
      ],
    });

    const items = buildResolutionItems({
      state,
      getCardDefinitionById: makeLookup([handDef]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        handDef,
      ]),
    });

    expect(items[0]?.sources[0]).toMatchObject({
      instanceId: "hand-source-1",
      definitionId: "P3-28-HAND",
      sourceKind: "spirit",
    });
  });

  it("keeps public field-source optional triggers on the existing pending queue", () => {
    const fieldDef = makeSpirit("P3-28-FIELD", "field");
    const lookup = makeLookup([fieldDef]);
    const triggerLookup = buildTriggeredEffectLookup([fieldDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(fieldDef, {
          instanceId: "field-source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(next.pendingPrivateDeclarations).toHaveLength(0);
    expect(next.pendingTriggeredEffects).toHaveLength(1);
    expect(next.pendingTriggeredEffects[0]?.resolvedSourceInstanceIds).toEqual(
      []
    );
  });

  it("uses the private declaration split through the initial start-step helper when lookups are provided", () => {
    const handDef = makeSpirit("P3-28-INITIAL", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "initial-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queueInitialStartStepTrigger(state, lookup, triggerLookup);

    expect(next.pendingTriggeredEffects).toHaveLength(0);
    expect(next.pendingPrivateDeclarations).toHaveLength(1);
    expect(next.pendingPrivateDeclarations[0]).toMatchObject({
      sourceInstanceId: "initial-hand-source",
      eventKind: "start_step",
    });
  });

  it("P3-36 Phase A: orders pendingPrivateDeclarations with non-turn-player declarations first", () => {
    const handDef = makeSpirit("P3-36-PHASE-A", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "alice-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "bob-hand-source",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    });
    expect(state.activePlayerId).toBe("alice");

    // alice / bob 両方の start_step が同時に発火する想定でイベントを 2 件流す。
    // alice 側の source は alice event でマッチ、bob 側の source は bob event でマッチ。
    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [
        makeStartStepEvent(),
        {
          ...makeStartStepEvent(),
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(next.pendingPrivateDeclarations).toHaveLength(2);
    // 非ターンプレイヤー (bob) が先頭、ターンプレイヤー (alice) が末尾
    expect(next.pendingPrivateDeclarations[0]?.ownerPlayerId).toBe("bob");
    expect(next.pendingPrivateDeclarations[1]?.ownerPlayerId).toBe("alice");

    // legal action は非ターン側に先に出る
    const aliceActions = getLegalActions({
      state: next,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const bobActions = getLegalActions({
      state: next,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(aliceActions.map((action) => action.kind)).toEqual([]);
    expect(bobActions.map((action) => action.kind)).toEqual([
      "declare_private_triggered_effect",
      "skip_private_triggered_effect",
    ]);
  });

  it("advanceStep refuses to progress while a pendingPrivateDeclaration is queued", () => {
    // Repro: 2026-05-03 snapshot で turn 3 alice の start_step 私的宣言が
    // 残ったまま start->core->draw まで進行した不具合。
    // GUI から `handleAdvanceStep` 経由で `advanceStep` を直接呼ぶと
    // legal-action ガードを通らず宣言が踏み越されていた。
    const handDef = makeSpirit("P3-28-LEAK", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "leak-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      baseState,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);

    expect(() => advanceStep(queued, lookup, triggerLookup)).toThrow(
      /pending private declaration/i
    );
  });

  it("P3-36 Phase A: existing turn-player declarations stay behind newly queued non-turn-player declarations", () => {
    const handDef = makeSpirit("P3-36-PHASE-A2", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const aliceCard = createCardInstance(handDef, {
      instanceId: "alice-hand-source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [aliceCard],
    });
    expect(state.activePlayerId).toBe("alice");

    // 1 周目: alice (turn) のみ private declaration を発生させる
    const afterAlice = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(afterAlice.pendingPrivateDeclarations).toHaveLength(1);
    expect(afterAlice.pendingPrivateDeclarations[0]?.ownerPlayerId).toBe(
      "alice"
    );

    // 2 周目: bob (non-turn) の private declaration を追加で enqueue
    const stateWithBob: typeof afterAlice = {
      ...afterAlice,
      cardInstances: [
        ...afterAlice.cardInstances,
        createCardInstance(handDef, {
          instanceId: "bob-hand-source",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    };
    const afterBob = queuePendingReactionsFromTriggerEvents(
      stateWithBob,
      [
        {
          ...makeStartStepEvent(),
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // bob (非ターン) が alice (ターン) より先に来る
    expect(afterBob.pendingPrivateDeclarations).toHaveLength(2);
    expect(afterBob.pendingPrivateDeclarations[0]?.ownerPlayerId).toBe("bob");
    expect(afterBob.pendingPrivateDeclarations[1]?.ownerPlayerId).toBe("alice");
  });

  it("collapses same-name private declarations sharing a per_card_name usageLimit", () => {
    // Repro: 2026-05-03 snapshot で alice 手札にパチュリー (BSTH01-M01) 2 枚があり、
    // 両方の start_step private 誘発が並列に積まれて GUI が詰む不具合。
    // effect.usageLimit (per_card_name turn=1) が triggered registration に伝搬する
    // 修正と組み合わせ、同名同効果の declaration はバッチ内 1 件に絞る。
    const handDef: CardDefinition = {
      ...makeSpirit("P3-28-USAGE-LIMIT", "hand"),
      effects: [
        {
          timing: { kind: "phase", step: "start", subPhase: "start" },
          applicability: { zone: "hand" },
          executionMode: "optional",
          usageLimit: {
            kind: "per_card_name",
            duration: "turn",
            maxCount: 1,
          },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "patchouli-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "patchouli-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // per_card_name=1 が同タイミング内で重複登録を抑止 → 1 件のみ
    expect(next.pendingPrivateDeclarations).toHaveLength(1);
    expect(next.pendingTriggeredEffects).toHaveLength(0);
  });

  it("defers declared-from-private triggered until the last sibling declaration is processed (declare path)", () => {
    // 同時誘発で2件の private declaration がある時、1件目を「発揮する」しても
    // pendingTriggeredEffects には入れず pendingDeferredTriggeredEffects に保留する。
    // 2件目が処理された瞬間にまとめて pendingTriggeredEffects に flush する。
    // リアルの「同時宣言」を再現し、UI のフォーカスズレ + 公開タイミング漏洩を防ぐ。
    const handDef = makeSpirit("P3-DEFER-DECL", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "alice-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "bob-hand-source",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        makeStartStepEvent(),
        {
          ...makeStartStepEvent(),
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingPrivateDeclarations).toHaveLength(2);
    expect(queued.pendingPrivateDeclarations[0]?.simultaneousGroupId).toBe(
      queued.pendingPrivateDeclarations[1]?.simultaneousGroupId
    );

    // 1件目: 非ターン(bob) が「発揮する」を選ぶ
    const bobDeclareAction = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((a) => a.kind === "declare_private_triggered_effect");
    if (
      !bobDeclareAction ||
      bobDeclareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing bob declare action");
    }
    const afterBob = applyLegalAction({
      state: queued,
      action: bobDeclareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    // bob 分は公開キューにまだ入らず deferred バッファで待機
    expect(afterBob.pendingPrivateDeclarations).toHaveLength(1);
    expect(afterBob.pendingPrivateDeclarations[0]?.ownerPlayerId).toBe("alice");
    expect(afterBob.pendingTriggeredEffects).toHaveLength(0);
    expect(afterBob.pendingDeferredTriggeredEffects).toHaveLength(1);
    expect(afterBob.pendingDeferredTriggeredEffects[0]).toMatchObject({
      actingPlayerId: "bob",
      declaredFromPrivateZone: true,
    });

    // 2件目: ターン(alice) が「発揮する」を選ぶ → 両方が一括で公開される
    const aliceDeclareAction = getLegalActions({
      state: afterBob,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((a) => a.kind === "declare_private_triggered_effect");
    if (
      !aliceDeclareAction ||
      aliceDeclareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing alice declare action");
    }
    const afterAlice = applyLegalAction({
      state: afterBob,
      action: aliceDeclareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(afterAlice.pendingPrivateDeclarations).toHaveLength(0);
    expect(afterAlice.pendingDeferredTriggeredEffects).toHaveLength(0);
    expect(afterAlice.pendingTriggeredEffects).toHaveLength(2);
    const owners = afterAlice.pendingTriggeredEffects.map(
      (p) => p.actingPlayerId
    );
    expect(owners).toContain("alice");
    expect(owners).toContain("bob");
  });

  it("flushes deferred declared-from-private triggered when the last sibling is skipped", () => {
    // 1件目を「発揮する」(deferred) → 2件目を「発揮しない」した場合も、
    // 同 group の最後の declaration が処理された時点で deferred 群を flush する。
    const handDef = makeSpirit("P3-DEFER-SKIP", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "alice-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "bob-hand-source",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        makeStartStepEvent(),
        {
          ...makeStartStepEvent(),
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // 1件目 bob declare → deferred
    const bobDeclareAction = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((a) => a.kind === "declare_private_triggered_effect");
    if (
      !bobDeclareAction ||
      bobDeclareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing bob declare action");
    }
    const afterBob = applyLegalAction({
      state: queued,
      action: bobDeclareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;
    expect(afterBob.pendingDeferredTriggeredEffects).toHaveLength(1);

    // 2件目 alice skip → group 完了 → bob 分が flush される
    const aliceSkipAction = getLegalActions({
      state: afterBob,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((a) => a.kind === "skip_private_triggered_effect");
    if (
      !aliceSkipAction ||
      aliceSkipAction.kind !== "skip_private_triggered_effect"
    ) {
      throw new Error("missing alice skip action");
    }
    const afterAlice = applyLegalAction({
      state: afterBob,
      action: aliceSkipAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(afterAlice.pendingPrivateDeclarations).toHaveLength(0);
    expect(afterAlice.pendingDeferredTriggeredEffects).toHaveLength(0);
    // alice は skip したので 1 件のみ (bob 分)
    expect(afterAlice.pendingTriggeredEffects).toHaveLength(1);
    expect(afterAlice.pendingTriggeredEffects[0]?.actingPlayerId).toBe("bob");
  });

  it("flushes a deferred bucket when leave flush prunes its final private sibling", () => {
    // A leave-field stay choice can discard other private prompts from the
    // same hand source while it flushes the pending leave. The declared
    // sibling must still be published once that pruning finishes.
    const handDef = makeSpirit("P3-DEFER-LEAVE-PRUNE", "hand");
    const victimDef = makeSpirit("P3-DEFER-LEAVE-VICTIM", "field");
    const lookup = makeLookup([handDef, victimDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef, victimDef]);
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "alice-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "bob-hand-source",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      initial,
      [
        makeStartStepEvent(),
        {
          ...makeStartStepEvent(),
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const bobDeclare = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    if (!bobDeclare || bobDeclare.kind !== "declare_private_triggered_effect") {
      throw new Error("missing bob deferred declaration");
    }
    const afterBobDeclare = applyLegalAction({
      state: queued,
      action: bobDeclare,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;
    expect(afterBobDeclare.pendingDeferredTriggeredEffects).toHaveLength(1);

    const aliceSibling = afterBobDeclare.pendingPrivateDeclarations[0];
    if (!aliceSibling) throw new Error("missing alice private sibling");
    const victim = {
      ...createCardInstance(victimDef, {
        instanceId: "leave-victim",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      pendingLeaveKind: "vanish" as const,
      pendingLeaveCause: "cost_payment" as const,
      pendingLeaveChainId: "chain:private-deferred-leave",
      deferZoneMoveUntilChainEnd: true,
    };
    const privateSibling = {
      ...aliceSibling,
      relatedInstanceId: victim.instanceId,
      relatedInstanceIds: [victim.instanceId],
      relatedInstanceIdsBySourceRegistrationKey: {
        [`${aliceSibling.sourceInstanceId}#${aliceSibling.registrationIndex}`]:
          [victim.instanceId],
      },
    };
    const declinedLeaveDeclaration = {
      ...privateSibling,
      declarationId: "decl:private-deferred-leave-prune",
      pendingId: "pending:private-deferred-leave-prune",
      simultaneousGroupId: "sim-group:private-deferred-leave-prune",
      registeredLeaveFieldStayOnFieldSourceKeys: [
        `${aliceSibling.sourceInstanceId}#${aliceSibling.registrationIndex}`,
      ],
    };
    const state = {
      ...afterBobDeclare,
      cardInstances: [...afterBobDeclare.cardInstances, victim],
      pendingPrivateDeclarations: [privateSibling, declinedLeaveDeclaration],
      pendingLeaveEntities: [
        {
          instanceId: victim.instanceId,
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          causePlayerId: null,
          chainId: "chain:private-deferred-leave",
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const afterPrune = applyLegalAction({
      state,
      action: {
        chainId: "test:p3-28-private-declaration:1192",
        kind: "skip_private_triggered_effect",
        actionId: `skip_private_triggered_effect:${declinedLeaveDeclaration.declarationId}`,
        can: true,
        reason: "test_private_deferred_leave_prune",
        actingPlayerId: "alice",
        declarationId: declinedLeaveDeclaration.declarationId,
        eventKind: declinedLeaveDeclaration.eventKind,
        sourceInstanceId: declinedLeaveDeclaration.sourceInstanceId,
        sourceDefinitionId: declinedLeaveDeclaration.sourceDefinitionId,
        sourceCardNo: handDef.cardNo,
        registrationIndex: declinedLeaveDeclaration.registrationIndex,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(afterPrune.pendingPrivateDeclarations).toHaveLength(0);
    expect(afterPrune.pendingDeferredTriggeredEffects).toHaveLength(0);
    expect(afterPrune.pendingTriggeredEffects).toHaveLength(1);
    expect(afterPrune.pendingTriggeredEffects[0]?.pendingId).toBe(
      afterBobDeclare.pendingDeferredTriggeredEffects[0]?.pendingId
    );
  });

  it("publishes single (no simultaneousGroupId) declaration immediately without deferral", () => {
    // 単独宣言 (events.length === 1 → simultaneousGroupId 未設定) は、
    // 従来通り即時 publish。deferred バッファを経由しない。
    const handDef = makeSpirit("P3-DEFER-SOLO", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "solo-hand-source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);
    expect(
      queued.pendingPrivateDeclarations[0]?.simultaneousGroupId
    ).toBeUndefined();

    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((a) => a.kind === "declare_private_triggered_effect");
    if (
      !declareAction ||
      declareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing declare action");
    }
    const declared = applyLegalAction({
      state: queued,
      action: declareAction,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(declared.pendingPrivateDeclarations).toHaveLength(0);
    expect(declared.pendingDeferredTriggeredEffects).toHaveLength(0);
    expect(declared.pendingTriggeredEffects).toHaveLength(1);
  });

  it("keeps multiple private declarations when no usageLimit is configured", () => {
    // 規制ルールが付いていない optional hand 誘発は、複数同名カードでも
    // それぞれ declare/skip 選択肢を提示するのが正しい挙動。
    // usageLimit ガード追加が、limit が無いカードまで巻き込んでいないことを担保する。
    const handDef = makeSpirit("P3-28-NO-LIMIT", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "no-limit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "no-limit-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(next.pendingPrivateDeclarations).toHaveLength(2);
  });

  it("同一オーナーが複数 private declaration を持つときは両方の declare/skip が並列 surface する", () => {
    // Repro: 2026-06-21 snapshot で bob が X05 (BSTH01-X05) を 2 枚同時誘発したが、
    // declare/skip が insertion 順 [0] 固定で出され、owner が解決順を選べなかった。
    // 修正: 同一オーナーの全宣言について declare/skip を並列 surface し、順序選択は
    // GUI 側の focus = ActionBar の front 絞り込みに委譲する (engine 側に明示の
    // select ステップは置かない。UI 即応、通信往復ゼロ)。
    const handDef = makeSpirit("P3-28-REORDER", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "alice-reorder-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handDef, {
          instanceId: "alice-reorder-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingPrivateDeclarations).toHaveLength(2);

    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    // 両宣言ぶんの declare/skip が同時に surface する (= insertion 順固定でない)。
    const declareActions = actions.filter(
      (a) => a.kind === "declare_private_triggered_effect"
    );
    const skipActions = actions.filter(
      (a) => a.kind === "skip_private_triggered_effect"
    );
    expect(declareActions).toHaveLength(2);
    expect(skipActions).toHaveLength(2);
    expect(declareActions.map((a) => a.sourceInstanceId).sort()).toEqual([
      "alice-reorder-1",
      "alice-reorder-2",
    ]);

    // owner 以外 (bob) には何も出ない (混在オーナー時は insertion 順 owner が先)。
    expect(
      getLegalActions({
        state: queued,
        actingPlayerId: "bob",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
      })
    ).toEqual([]);

    // owner が「2 番目に積まれた alice-reorder-2 を先に処理する」順序を選ぶ
    // = 単に alice-reorder-2 の declare action を実行するだけ。
    const reorder2Declare = declareActions.find(
      (a) => a.sourceInstanceId === "alice-reorder-2"
    );
    expect(reorder2Declare).toBeDefined();
    const afterDeclare2 = applyLegalAction({
      state: queued,
      action: reorder2Declare!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    // 残り 1 件のみになる → 自然に declare/skip が surface する (auto-select 相当)。
    expect(afterDeclare2.pendingPrivateDeclarations).toHaveLength(1);
    expect(afterDeclare2.pendingPrivateDeclarations[0]?.sourceInstanceId).toBe(
      "alice-reorder-1"
    );
  });

  it("単独 private declaration は auto-select で declare/skip が直接 surface する", () => {
    // 1 件しかないときは declare/skip がそのまま出る (旧挙動と同じ)。
    const handDef = makeSpirit("P3-28-AUTOSELECT", "hand");
    const lookup = makeLookup([handDef]);
    const triggerLookup = buildTriggeredEffectLookup([handDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handDef, {
          instanceId: "alice-only",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(
      actions.find((a) => a.kind === "declare_private_triggered_effect")
    ).toBeDefined();
    expect(
      actions.find((a) => a.kind === "skip_private_triggered_effect")
    ).toBeDefined();
  });
});
