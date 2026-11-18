import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src/runtime";

function definition(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function fixture(
  effect: Effect,
  reserve = 0,
  extraDefinitions: CardDefinition[] = [],
  sourceOverrides: Partial<CardDefinition> = {}
) {
  const source = definition("TEST-CHOICE-SOURCE", {
    effects: [effect],
    ...sourceOverrides,
  });
  const filler = definition("TEST-CHOICE-FILLER");
  const definitions = [source, filler, ...extraDefinitions];
  const getCardDefinitionById = (id: string) =>
    definitions.find((card) => card.cardNo === id);
  const lookups = {
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
    getHandWrittenEffectResolver: () => undefined,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: reserve, deckCount: 2, handCount: 0 },
        {},
      ],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
        ...[0, 1].map((i) =>
          createCardInstance(filler, {
            instanceId: `deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
  };
  return { source, filler, state, lookups };
}

function declineFirst(
  f: ReturnType<typeof fixture>,
  effect: Effect,
  effectSourceDefinitionId?: string
) {
  const initial = executeEffect({
    chainId: "test:continuation-choice-availability",
    state: f.state,
    effect,
    effectIndex: 0,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    promptUnresolvedChoice: true,
    ...(effectSourceDefinitionId ? { effectSourceDefinitionId } : {}),
    ...f.lookups,
  });
  const decline = getLegalActions({
    state: initial,
    actingPlayerId: "alice",
    ...f.lookups,
  }).find(
    (action) =>
      action.kind === "resolve_pending_step_optional_choice" &&
      action.choice === "decline"
  );
  expect(decline).toBeDefined();
  return applyLegalAction({
    state: JSON.parse(JSON.stringify(initial)),
    action: decline!,
    ...f.lookups,
  }).state;
}

function selectPayload(
  state: GameState,
  f: ReturnType<typeof fixture>,
  targetInstanceIds?: string[]
) {
  const choices = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...f.lookups,
  }).filter((action) => action.kind === "resolve_pending_step_choice");
  expect(choices.map((action) => action.choiceIndex)).toEqual([1]);
  return applyLegalAction({
    state,
    action: choices[0]!,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
    ...f.lookups,
  }).state;
}

describe("accepted-effect continuation choice availability", () => {
  it.each([0, 1, 2])(
    "non-cost destroy-2 preserves partial/empty activation with %i targets",
    (targetCount) => {
      const watcher = definition("TEST-DESTROY-WATCHER", {
        effects: [
          {
            timing: {
              kind: "game_event",
              event: "effect_steps_resolved",
              player: "self",
              actionKinds: ["destroy"],
            },
            steps: [
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
        ],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        steps: [
          { executionMode: "optional", action: { kind: "draw", count: 1 } },
          {
            action: { kind: "noop" },
            choice: [
              {
                action: {
                  kind: "destroy",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: 2,
                  },
                },
              },
            ],
          },
        ],
      };
      const f = fixture(effect, 0, [watcher]);
      const enemies = Array.from(
        { length: targetCount },
        (_, i) => `enemy-${i}`
      );
      f.state.cardInstances.push(
        createCardInstance(watcher, {
          instanceId: "watcher",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...enemies.map((instanceId) =>
          createCardInstance(f.filler, {
            instanceId,
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          })
        )
      );
      let state = selectPayload(declineFirst(f, effect), f, enemies);
      for (let guard = 0; guard < 12; guard++) {
        const actingPlayerId = state.stackWindow?.priorityPlayerId ?? "alice";
        const actions = getLegalActions({
          state,
          actingPlayerId,
          ...f.lookups,
        });
        const action =
          actions.find((a) => a.kind === "pass_stack") ??
          actions.find(
            (a) =>
              a.kind === "resolve_pending_triggered_effect" &&
              a.sourceInstanceId === "watcher"
          );
        if (!action) break;
        state = applyLegalAction({ state, action, ...f.lookups }).state;
      }
      expect(
        state.cardInstances.filter(
          (card) => enemies.includes(card.instanceId) && card.zone === "trash"
        )
      ).toHaveLength(targetCount);
      expect(state.players[0]!.countValue).toBe(1);
      expect(state.players[0]!.handCount).toBe(0);
      expect(state.pendingStepChoice).toBeNull();
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.stackWindow).toBeNull();
    }
  );

  it.each([0, 2])(
    "pay_cost-2 uses the same legal payment gate with reserve=%i",
    (reserve) => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        steps: [
          { executionMode: "optional", action: { kind: "draw", count: 1 } },
          {
            action: { kind: "noop" },
            choice: [{ action: { kind: "pay_cost", amount: 2 } }],
          },
          {
            connector: "conditional_cost",
            action: { kind: "recover", target: { kind: "self" } },
          },
        ],
      };
      const f = fixture(effect, reserve);
      let state = declineFirst(f, effect);
      if (reserve === 0) {
        expect(state.pendingStepChoice).toBeNull();
        expect(state.cardInstances[0]!.exhaustState).toBe("exhausted");
        expect(state.players[0]!.trashNormalCoreCount).toBe(0);
      } else {
        const action = getLegalActions({
          state,
          actingPlayerId: "alice",
          ...f.lookups,
        }).find(
          (candidate) =>
            candidate.kind === "resolve_pending_step_choice" &&
            candidate.choiceIndex === 1
        );
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          payCostPaymentSources: [{ kind: "reserve", amount: 2 }],
          ...f.lookups,
        }).state;
        if (state.pendingCoreSourceAllocation) {
          const allocation = getLegalActions({
            state,
            actingPlayerId: "alice",
            ...f.lookups,
          }).find(
            (candidate) => candidate.kind === "resolve_core_source_allocation"
          );
          expect(allocation).toBeDefined();
          state = applyLegalAction({
            state,
            action: allocation!,
            coreSourceAllocations: { reserve: 2 },
            ...f.lookups,
          }).state;
        }
        expect(state.cardInstances[0]!.exhaustState).toBe("recovered");
        expect(state.players[0]!.reserveNormalCoreCount).toBe(0);
        expect(state.players[0]!.trashNormalCoreCount).toBe(2);
      }
      expect(state.pendingStepChoice).toBeNull();
      expect(state.pendingStepOptionalChoice).toBeNull();
    }
  );

  it("conditional-cost destroy-2 cannot pay with only one target", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      executionMode: "optional",
      steps: [
        { executionMode: "optional", action: { kind: "draw", count: 1 } },
        {
          action: { kind: "noop" },
          choice: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 2,
                },
              },
            },
          ],
        },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    const f = fixture(effect);
    f.state.cardInstances.push(
      createCardInstance(f.filler, {
        instanceId: "enemy",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const after = declineFirst(f, effect);
    expect(after.pendingStepChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "enemy")!.zone
    ).toBe("field");
    expect(after.players[0]!.handCount).toBe(0);
    expect(after.players[0]!.deckCount).toBe(2);
  });

  it.each([true, false])(
    "borrowed combine uses physical eligibility=%s independently of the donor",
    (physicalAllows) => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        steps: [
          { executionMode: "optional", action: { kind: "draw", count: 1 } },
          {
            action: { kind: "noop" },
            choice: [
              {
                action: {
                  kind: "brave_combine_effect",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["spirit"],
                      cardNameContains: ["Allowed Host"],
                    },
                    count: 1,
                  },
                },
              },
            ],
          },
        ],
      };
      const donor = definition("TEST-CHOICE-DONOR", {
        printedCategory: "brave",
        braveCondition: {
          cardNameContains: [
            physicalAllows ? "Forbidden Host" : "Allowed Host",
          ],
        },
        effects: [effect],
      });
      const host = definition("TEST-CHOICE-HOST", { name: "Allowed Host" });
      const f = fixture(effect, 0, [donor, host], {
        printedCategory: "brave",
        braveCondition: {
          cardNameContains: [
            physicalAllows ? "Allowed Host" : "Forbidden Host",
          ],
        },
      });
      f.state.cardInstances.push(
        createCardInstance(host, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        })
      );
      const pending = declineFirst(f, effect, donor.cardNo);
      const after = physicalAllows
        ? selectPayload(pending, f, ["host"])
        : pending;
      expect(
        after.cardInstances.find((card) => card.instanceId === "source")!
          .attachedToInstanceId
      ).toBe(physicalAllows ? "host" : null);
      expect(
        after.cardInstances.find((card) => card.instanceId === "host")!
          .normalCoreCount
      ).toBe(physicalAllows ? 2 : 1);
      expect(after.pendingStepChoice).toBeNull();
    }
  );
});
