import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
  type PendingBurstCheck,
} from "../src";
import { generateActionInputChoices } from "../src/action-input-choices";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";

const hina = ALL_CARDS.find((card) => card.cardNo === "BSTH05-M02")!;
// Keep the actual burst intact; inert opposing spirits isolate target allocation.
const vanilla: CardDefinition = {
  ...hina,
  cardNo: "TEST-GROUP-ORDER-SPIRIT",
  name: "Group order fixture",
  effects: [],
  keywordTags: [],
  textLines: [],
};
const definitions = [hina, vanilla];
const getCardDefinitionById = (id: string) =>
  definitions.find((card) => card.cardNo === id);
const noLookup = (_: string) => undefined;
const lookups = {
  getCardDefinitionById,
  getRegisteredBurstActions: buildBurstEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: noLookup,
  getRegisteredTriggeredEffectActions: noLookup,
  getHandWrittenEffectResolver: noLookup,
};

function actions(state: GameState) {
  return ["bob", "alice"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...lookups })
  );
}

function advance(state: GameState): GameState {
  for (let i = 0; i < 32; i++) {
    if (state.pendingEffectTargetSelection) return state;
    const action = actions(state).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "resolve_pending_multi_placement" ||
        (candidate.kind === "resolve_pending_burst_check" &&
          candidate.sourceInstanceId === undefined)
    );
    if (!action) return state;
    state = applyLegalAction({
      state,
      action,
      ...(action.kind === "resolve_pending_multi_placement" &&
      state.pendingMultiPlacement
        ? {
            multiPlacementAllocations: state.pendingMultiPlacement.targets.map(
              (target) => ({
                destinationInstanceId: target.instanceId,
                placements: [
                  {
                    kind: "reserve_normal" as const,
                    amount: target.minimumCoreCount,
                  },
                ],
              })
            ),
          }
        : {}),
      ...lookups,
    }).state;
  }
  throw new Error("Burst resolution did not reach a stable state");
}

function targetScenario() {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 6 },
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
    ],
  });
  const initial: GameState = {
    ...base,
    turnNumber: 4,
    activePlayerId: "bob",
    step: "main",
    window: "none",
    cardInstances: [
      createCardInstance(hina, {
        instanceId: "hina-burst",
        ownerPlayerId: "alice",
        zone: "burst",
      }),
      createCardInstance(vanilla, {
        instanceId: "left-spirit",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      ...["a", "b"].map((instanceId) =>
        createCardInstance(vanilla, {
          instanceId,
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        })
      ),
      createCardInstance(vanilla, {
        instanceId: "deck-existing",
        ownerPlayerId: "bob",
        zone: "deck",
      }),
    ],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "hina-burst" }],
    pendingBurstChecks: [
      {
        checkId: "leave-1",
        actingPlayerId: "alice",
        eventKind: "leave_field",
        source: "action_resolution",
        chainId: "test:group-order",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "left-spirit",
        amount: 1,
        step: "main",
        window: "none",
        resolvedBurstCardInstanceIds: [],
        event: {
          family: "leave_field",
          validationMode: "snapshot_only",
          cause: "opponent_effect",
        },
      } as PendingBurstCheck,
    ],
  };
  const declaration = actions(initial).find(
    (action) =>
      action.kind === "resolve_pending_burst_check" &&
      action.sourceInstanceId === "hina-burst"
  );
  expect(declaration).toBeDefined();
  const state = advance(
    applyLegalAction({ state: initial, action: declaration!, ...lookups }).state
  );
  const action = actions(state).find(
    (
      candidate
    ): candidate is Extract<
      LegalAction,
      { kind: "resolve_pending_effect_target" }
    > => candidate.kind === "resolve_pending_effect_target"
  );
  expect(action).toBeDefined();
  expect(action!.targetGroups).toHaveLength(2);
  expect(
    new Set(action!.targetGroups!.map((group) => group.targetStepId)).size
  ).toBe(2);
  return { state, action: action! };
}

function expectBurstResult(state: GameState, selected: readonly string[]) {
  expect(
    state.cardInstances.find((card) => card.instanceId === selected[0])?.zone
  ).toBe("hand");
  expect(
    state.cardInstances
      .filter((card) => card.ownerPlayerId === "bob" && card.zone === "deck")
      .map((card) => card.instanceId)
  ).toEqual(["deck-existing", selected[1]]);
  expect(
    state.cardInstances.find((card) => card.instanceId === "hina-burst")
  ).toMatchObject({ zone: "field", normalCoreCount: 1 });
  expect(state.setBurstStates).toEqual([]);
  expect(state.pendingEffectTargetSelection).toBeNull();
  expect(state.pendingMultiPlacement).toBeNull();
  expect(state.stackWindow).toBeNull();
  expect(state.pendingBurstChecks).toEqual([]);
  expect(state.pendingTriggeredEffects).toEqual([]);
  expect(state.pendingEffectCompletions).toEqual([]);
  expect(state.pendingLeaveEntities).toEqual([]);
}

describe("BSTH05-M02 ordered action input choices", () => {
  it.each([
    ["a", "b"],
    ["b", "a"],
  ])(
    "accepts %s to hand and %s to deck bottom through full burst resolution",
    (hand, bottom) => {
      const { state, action } = targetScenario();
      const selected = [hand, bottom];
      const final = advance(
        applyLegalAction({
          state,
          action,
          targetInstanceIds: selected,
          ...lookups,
        }).state
      );
      expectBurstResult(final, selected);
    }
  );

  it("generates both legal allocations and completes their distinct boards", () => {
    const { state, action } = targetScenario();
    const choices = generateActionInputChoices(
      state,
      action,
      { getCardDefinitionById },
      128
    );
    expect(choices.truncated).toBe(false);
    expect(choices.values.map((input) => input.targetInstanceIds)).toEqual([
      ["a", "b"],
      ["b", "a"],
    ]);
    for (const input of choices.values) {
      const final = advance(
        applyLegalAction({ state, action, ...input, ...lookups }).state
      );
      expectBurstResult(final, input.targetInstanceIds!);
    }
  });
});
