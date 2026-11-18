import { describe, expect, it } from "vitest";
import type { Effect, EffectStep } from "../src/dsl-types";
import type { CardDefinition, GameState, TriggerEventKind } from "../src/model";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  getLegalActions,
  restoreSnapshot,
  sanitizeStateForViewer,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { moveCardZone } from "../src/core/core-system";
import { trainingProgressFingerprint } from "../src/training-decision-surface";

const place: EffectStep = { action: { kind: "place" } };
const draw = (count: number): EffectStep => ({
  action: { kind: "draw", count },
});
const reward: EffectStep[] = [
  { action: { kind: "count_increase", player: "self", amount: 1 } },
];

function fixture(steps: EffectStep[]) {
  const effect: Effect = { timing: { kind: "activated", mode: "main" }, steps };
  const definition: CardDefinition = {
    cardNo: "OPERATION-OBSERVER",
    name: "operation observer",
    printedCategory: "nexus",
    cost: 0,
    colors: ["red"],
    reductionSymbols: [],
    symbolColors: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "game_event", event: "after_draw", player: "self" },
        steps: reward,
      },
      {
        timing: { kind: "game_event", event: "recover", player: "self" },
        steps: reward,
      },
      {
        timing: {
          kind: "game_event",
          event: "core_placed_on_life",
          player: "self",
        },
        steps: reward,
      },
      effect,
    ],
  };
  const target: CardDefinition = {
    ...definition,
    cardNo: "OPERATION-TARGET",
    name: "operation target",
    printedCategory: "spirit",
    levelDefs: [{ level: 1, requiredCores: 1 }],
    effects: [],
  };
  const definitions = [definition, target];
  const deps = {
    getCardDefinitionById: (id: string) =>
      definitions.find((card) => card.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          deckCount: 6,
          handCount: 1,
          reserveNormalCoreCount: 6,
          voidNormalCoreCount: 20,
        },
        {},
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "existing",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(definition, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(target, {
          instanceId: "target",
          ownerPlayerId: "alice",
          zone: "field",
          exhaustState: "exhausted",
          normalCoreCount: 1,
        }),
        ...Array.from({ length: 6 }, (_, i) =>
          createCardInstance(target, {
            instanceId: `deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    }),
    step: "main",
    turnNumber: 3,
  };
  const run = (state = before) =>
    executeEffect({
      state,
      effect,
      effectIndex: definition.effects!.indexOf(effect),
      sourceInstanceId: "observer",
      actingPlayerId: "alice",
      chainId: "operation-observation",
      promptUnresolvedChoice: true,
      summonEnterFieldCorePlacements: [],
      ...deps,
    });
  const finishPlacements = (input: GameState): GameState => {
    let state = input;
    for (
      let attempt = 0;
      state.pendingMultiPlacement && attempt < 4;
      attempt++
    ) {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...deps,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_multi_placement"
      );
      if (!action) throw new Error("Missing placement core choice");
      state = applyLegalAction({
        state,
        action,
        multiPlacementAllocations: state.pendingMultiPlacement.targets.map(
          (target) => ({
            destinationInstanceId: target.instanceId,
            placements: [],
          })
        ),
        ...deps,
      }).state;
    }
    expect(state.pendingMultiPlacement).toBeNull();
    return state;
  };
  const options = (afterState: GameState, beforeState = before) => ({
    beforeState,
    afterState,
    source: "action_resolution" as const,
    chainId: "operation-observation",
    causedByPlayerId: "alice",
    causedBySourceInstanceId: "observer",
    enterFieldCausedByPlayerId: "alice",
    ...deps,
  });
  const collect = (state: GameState, base = before) =>
    collectAndQueueTriggerReactions(options(state, base));
  const events = (state: GameState, base = before) =>
    collectTriggerEventsFromStateDelta(options(state, base));
  const responders = (state: GameState, event: TriggerEventKind) =>
    state.pendingTriggeredEffects
      .filter((pending) => pending.eventKind === event)
      .flatMap((pendingEffect) =>
        getAvailableTriggeredEffectSourceChoices({
          state,
          pendingEffect,
          ...deps,
        })
      )
      .map((choice) => choice.sourceCard.instanceId);
  const restore = (state: GameState) =>
    restoreSnapshot(
      JSON.parse(JSON.stringify(createGameSnapshot(state))),
      deps.getCardDefinitionById,
      deps
    ).state;
  return {
    before,
    run,
    collect,
    events,
    responders,
    restore,
    deps,
    finishPlacements,
  };
}

describe("operation-time evidence for existing non-entry trigger events", () => {
  it("a nexus placed after the draw cannot observe that earlier operation", () => {
    const f = fixture([draw(1), place]);
    const after = f.collect(f.run());
    expect(after.players[0]!.handCount).toBe(1);
    expect(f.responders(after, "after_draw")).toEqual(["existing"]);
  });

  it("a nexus placed before a later draw can observe it (B: distinct operations in one body)", () => {
    const f = fixture([place, draw(1)]);
    const after = f.collect(f.run());
    expect(f.responders(after, "after_draw").sort()).toEqual([
      "existing",
      "observer",
    ]);
  });

  it("keeps one aggregate draw event and its amount when an observer enters between draws", () => {
    const f = fixture([draw(1), place, draw(2)]);
    const resolved = f.run();
    const events = f
      .events(resolved)
      .filter((event) => event.eventKind === "after_draw");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      amount: 3,
      effectSourceInstanceId: "observer",
      chainId: "operation-observation",
    });
    expect(
      resolved.semanticTriggerEvents
        ?.filter(
          (event) => event.observationOnly && event.eventKind === "after_draw"
        )
        .map((event) => event.amount)
    ).toEqual([1, 2]);
    expect(f.responders(f.collect(resolved), "after_draw").sort()).toEqual([
      "existing",
      "observer",
    ]);
  });

  it("captures recovery after placement through the same native action boundary", () => {
    const f = fixture([
      place,
      {
        action: {
          kind: "recover",
          target: {
            kind: "filter",
            player: "self",
            filter: { category: ["spirit"] },
            count: "all",
          },
        },
      },
    ]);
    const after = f.collect(f.run());
    expect(
      after.cardInstances.find((card) => card.instanceId === "target")
        ?.exhaustState
    ).toBe("recovered");
    expect(f.responders(after, "recover").sort()).toEqual([
      "existing",
      "observer",
    ]);
  });

  it("preserves evidence and existing aggregate behavior across a real choice and formal restore", () => {
    const f = fixture([
      place,
      draw(1),
      {
        ...draw(2),
        choice: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    let current = f.run();
    expect(current.pendingStepChoice).not.toBeNull();
    expect(
      current.semanticTriggerEvents?.some((entry) => entry.observationOnly)
    ).toBe(true);
    const originalEvidence = current.semanticTriggerEvents;
    current = f.restore(current);
    expect(current.semanticTriggerEvents).toEqual(originalEvidence);
    const action = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...f.deps,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === 0
    );
    expect(action).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: action!,
      ...f.deps,
    }).state;
    expect(current.pendingStepChoice).toBeNull();
    expect(current.players[0]!.handCount).toBe(3);
    const pending = current.pendingTriggeredEffects.filter(
      (entry) => entry.eventKind === "after_draw"
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.amount).toBe(3);
    expect(f.responders(current, "after_draw").sort()).toEqual([
      "existing",
      "observer",
    ]);
    expect(
      current.semanticTriggerEvents
        ?.filter((entry) => entry.observationOnly)
        .every((entry) => entry.delivered)
    ).toBe(true);
  });

  it("does not fill an old operation snapshot from a source that entered only after that operation", () => {
    const f = fixture([place, draw(1)]);
    const resolved = f.run();
    const left = moveCardZone(resolved, "observer", "hand");
    const returned = moveCardZone(left, "observer", "field");
    const after = f.collect(returned);
    expect(f.responders(after, "after_draw")).toEqual(["existing"]);
  });

  it.each([false, true])(
    "after_triggers keeps the operation's parent-chain evidence (placedFirst=%s)",
    (placedFirst) => {
      const f = fixture([
        ...(placedFirst ? [place, draw(1)] : [draw(1), place]),
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          connector: "after_triggers",
        },
      ]);
      const after = f.run();
      expect(after.pendingAfterTriggersContinuations).toHaveLength(1);
      const drawPending = after.pendingTriggeredEffects.filter(
        (entry) => entry.eventKind === "after_draw"
      );
      expect(drawPending).toHaveLength(1);
      expect(drawPending[0]).toMatchObject({
        chainId: "operation-observation:after_triggers:2",
        amount: 1,
      });
      expect(f.responders(after, "after_draw").sort()).toEqual(
        placedFirst ? ["existing", "observer"] : ["existing"]
      );
      expect(
        after.semanticTriggerEvents
          ?.filter((entry) => entry.observationOnly)
          .every((entry) => entry.delivered)
      ).toBe(true);
      // The outer finalization must not repeat the inner segment or keep evidence pending.
      const final = f.collect(f.restore(after));
      expect(
        final.pendingTriggeredEffects.filter(
          (entry) => entry.eventKind === "after_draw"
        )
      ).toHaveLength(1);
      expect(f.responders(final, "after_draw").sort()).toEqual(
        placedFirst ? ["existing", "observer"] : ["existing"]
      );
    }
  );

  it.each([false, true])(
    "pending core commit is observed before later text and after_triggers (placedFirst=%s)",
    (placedFirst) => {
      const move: EffectStep = {
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "life", player: "self" },
          amount: { min: 0, max: 1 },
        },
      };
      const f = fixture([
        ...(placedFirst ? [place, move] : [move, place]),
        { ...draw(1), connector: "after_triggers" },
      ]);
      let current = f.restore(f.run());
      expect(current.pendingCoreCountSelection).not.toBeNull();
      const action = getLegalActions({
        state: current,
        actingPlayerId: "alice",
        ...f.deps,
      }).find((candidate) => candidate.kind === "resolve_pending_core_count");
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: action!,
        coreCountSelection: 1,
        ...f.deps,
      }).state;
      current = f.finishPlacements(current);
      expect(current.pendingCoreCountSelection).toBeNull();
      expect(current.players[0]!.lifeNormalCoreCount).toBe(
        f.before.players[0]!.lifeNormalCoreCount + 1
      );
      const pending = current.pendingTriggeredEffects.filter(
        (entry) => entry.eventKind === "core_placed_on_life"
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        chainId: "operation-observation:after_triggers:2",
        amount: 1,
      });
      expect(f.responders(current, "core_placed_on_life").sort()).toEqual(
        placedFirst ? ["existing", "observer"] : ["existing"]
      );
      expect(
        current.semanticTriggerEvents?.filter(
          (entry) =>
            entry.observationOnly && entry.eventKind === "core_placed_on_life"
        )
      ).toHaveLength(1);
      // The outer legal-action exit must retain delivered evidence while the
      // after_triggers body is suspended; restore and outer finalize still use it.
      expect(current.pendingAfterTriggersContinuations).toHaveLength(1);
      expect(
        current.semanticTriggerEvents?.some(
          (entry) =>
            entry.observationOnly &&
            entry.delivered &&
            entry.observationSnapshot
        )
      ).toBe(true);
      const restored = f.collect(f.restore(current));
      expect(f.responders(restored, "core_placed_on_life").sort()).toEqual(
        placedFirst ? ["existing", "observer"] : ["existing"]
      );
      expect(
        restored.pendingTriggeredEffects.filter(
          (entry) => entry.eventKind === "core_placed_on_life"
        )
      ).toHaveLength(1);
    }
  );

  it("releases delivered entry facts while keeping identity receipts and captured eligibility", () => {
    const f = fixture([place, draw(1)]);
    const after = f.collect(f.run());
    const entry = after.semanticTriggerEvents?.find(
      (event) => !event.observationOnly
    );
    expect(entry).toMatchObject({
      eventKind: "place",
      relatedInstanceId: "observer",
      delivered: true,
    });
    expect(entry?.observationSnapshot).toBeUndefined();
    expect(entry?.eventFactOccurrences).toBeUndefined();
    const pending = after.pendingTriggeredEffects.find(
      (event) => event.eventKind === "after_draw"
    );
    expect(pending?.timingSourceRegistrations).toBeDefined();
    expect(pending?.eventFactOccurrences).toBeUndefined();
    const restored = f.restore(after);
    expect(
      f.events(restored).filter((event) => event.eventKind === "place")
    ).toEqual([]);
    expect(f.responders(restored, "after_draw").sort()).toEqual([
      "existing",
      "observer",
    ]);
  });

  it("keeps 20 completed legal draws on an 80-card board below the snapshot API's 1 MiB input limit", () => {
    const f = fixture([draw(1)]);
    const baseDefinition = f.deps.getCardDefinitionById("OPERATION-OBSERVER")!;
    const definition: CardDefinition = {
      ...baseDefinition,
      effects: baseDefinition.effects!.filter(
        (effect) => effect.timing.kind === "activated"
      ),
    };
    const target = f.deps.getCardDefinitionById("OPERATION-TARGET")!;
    const definitions = [definition, target];
    const deps = {
      getCardDefinitionById: (id: string) =>
        definitions.find((card) => card.cardNo === id),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: () => [],
    };
    let current: GameState = {
      ...f.before,
      players: f.before.players.map((player) =>
        player.id === "alice" ? { ...player, deckCount: 77 } : player
      ),
      cardInstances: [
        ...f.before.cardInstances,
        ...Array.from({ length: 71 }, (_, index) =>
          createCardInstance(target, {
            instanceId: `extra-deck-${index}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    };
    expect(current.cardInstances).toHaveLength(80);
    for (let iteration = 0; iteration < 20; iteration++) {
      const use = getLegalActions({
        state: current,
        actingPlayerId: "alice",
        ...deps,
      }).find(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "existing"
      );
      expect(use).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: use!,
        ...deps,
      }).state;
      for (
        let passIndex = 0;
        current.stackWindow && passIndex < 4;
        passIndex++
      ) {
        const pass = getLegalActions({
          state: current,
          actingPlayerId: current.stackWindow.priorityPlayerId,
          ...deps,
        }).find((action) => action.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          ...deps,
        }).state;
      }
      expect(current.stackWindow).toBeNull();
      expect(current.players[0]!.handCount).toBe(iteration + 2);
      expect(
        new TextEncoder().encode(JSON.stringify(createGameSnapshot(current)))
          .byteLength
      ).toBeLessThan(1_048_576);
      current = restoreSnapshot(
        JSON.parse(JSON.stringify(createGameSnapshot(current))),
        deps.getCardDefinitionById,
        deps
      ).state;
    }
    expect(current.semanticTriggerEvents!.length).toBeGreaterThanOrEqual(40);
    expect(
      current.semanticTriggerEvents!.every(
        (event) =>
          event.delivered &&
          event.observationSnapshot === undefined &&
          event.eventFactOccurrences === undefined
      )
    ).toBe(true);
  });

  it("consumes unmatched evidence when the existing net delta has no event", () => {
    const f = fixture([
      { action: { kind: "count_increase", player: "self", amount: 1 } },
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
    ]);
    const resolved = f.run();
    expect(
      resolved.semanticTriggerEvents?.some((entry) => entry.observationOnly)
    ).toBe(true);
    expect(
      f
        .events(resolved)
        .filter(
          (event) =>
            event.eventKind === "count_increase" ||
            event.eventKind === "count_decrease"
        )
    ).toEqual([]);
    const closed = f.collect(resolved);
    expect(
      closed.semanticTriggerEvents
        ?.filter((entry) => entry.observationOnly)
        .every((entry) => entry.delivered)
    ).toBe(true);
    expect(f.events(closed, closed)).toEqual([]);
    expect(trainingProgressFingerprint(resolved)).toBe(
      trainingProgressFingerprint({
        ...resolved,
        semanticTriggerEvents: [],
        semanticTriggerSequence: 0,
      })
    );
  });

  it("keeps a committed split destination through a nested core allocation and restore", () => {
    const f = fixture([
      place,
      {
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          amount: 2,
          splitDestinations: {
            destinations: [
              { location: { kind: "life", player: "self" }, cap: 1 },
              {
                location: {
                  kind: "field_card",
                  player: "self",
                  filter: { category: ["nexus"] },
                },
                cap: 1,
              },
            ],
          },
        },
      },
      { ...draw(1), connector: "after_triggers" },
    ]);
    let current = f.restore(f.run());
    const split = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...f.deps,
    }).find((candidate) => candidate.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: split!,
      coreSplitDistribution: [1, 1],
      ...f.deps,
    }).state;
    expect(current.pendingCoreDistribution).not.toBeNull();
    expect(current.players[0]!.lifeNormalCoreCount).toBe(
      f.before.players[0]!.lifeNormalCoreCount + 1
    );
    expect(
      current.semanticTriggerEvents?.filter(
        (entry) =>
          entry.observationOnly && entry.eventKind === "core_placed_on_life"
      )
    ).toHaveLength(1);
    current = f.restore(current);
    const allocate = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...f.deps,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_core_distribution"
    );
    expect(allocate).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: allocate!,
      coreDistributionAllocations: { existing: 1 },
      ...f.deps,
    }).state;
    expect(current.pendingCoreDistribution).toBeNull();
    expect(
      current.pendingTriggeredEffects.filter(
        (entry) => entry.eventKind === "core_placed_on_life"
      )
    ).toHaveLength(1);
    expect(f.responders(current, "core_placed_on_life").sort()).toEqual([
      "existing",
      "observer",
    ]);
  });

  it.each(["alice", "bob", null])(
    "keeps operation evidence internal for viewer %s",
    (viewer) => {
      const f = fixture([place, draw(1)]);
      const state = f.run();
      expect(
        state.semanticTriggerEvents?.some((entry) => entry.observationOnly)
      ).toBe(true);
      expect(
        sanitizeStateForViewer(state, viewer).semanticTriggerEvents
      ).toBeUndefined();
      expect(f.restore(state).semanticTriggerEvents).toEqual(
        state.semanticTriggerEvents
      );
    }
  );
});
