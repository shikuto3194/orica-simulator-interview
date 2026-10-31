import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src/index";
import {
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const M01 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-M01")!;
const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const handActivatedLookup = buildHandActivatedEffectLookup(ALL_CARDS);
const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

function baseState(overrides?: Partial<GameState>): GameState {
  const empty = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...empty,
    activePlayerId: "alice",
    step: "start",
    players: empty.players.map((p) =>
      p.id === "alice" ? { ...p, reserveNormalCoreCount: 5 } : p
    ),
    cardInstances: [
      createCardInstance(M01, {
        instanceId: "patchouli-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    ...overrides,
  };
}

function legalActionsFor(state: GameState, playerId: string) {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    getRegisteredHandActivatedEffectActions: handActivatedLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  });
}

function findPatchouliSummonAction(state: GameState) {
  return legalActionsFor(state, "alice").find(
    (action): action is Extract<LegalAction, { kind: "summon" }> =>
      action.kind === "summon" &&
      action.sourceCardNo === "BSTH01-M01" &&
      action.sourceInstanceId === "patchouli-1"
  );
}

function passStackAsBob(state: GameState): GameState {
  const passAction = legalActionsFor(state, "bob").find(
    (action) => action.kind === "pass_stack"
  );
  expect(passAction).toBeDefined();
  return applyLegalAction({
    state,
    action: passAction!,
    getCardDefinitionById,
    getRegisteredHandActivatedEffectActions: handActivatedLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function resolvePlacementAsAlice(state: GameState, amount = 1): GameState {
  const placementAction = legalActionsFor(state, "alice").find(
    (action) => action.kind === "resolve_pending_enter_field_placement"
  );
  expect(placementAction).toBeDefined();
  return applyLegalAction({
    state,
    action: placementAction!,
    getCardDefinitionById,
    getRegisteredHandActivatedEffectActions: handActivatedLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount }],
  }).state;
}

describe("BSTH01-M01 start-step summon permission", () => {
  it("lists a fixed-cost summon action, not use_hand_card_effect", () => {
    const actions = legalActionsFor(baseState(), "alice");
    const summonAction = findPatchouliSummonAction(baseState());
    expect(summonAction).toMatchObject({
      sourceCardNo: "BSTH01-M01",
      sourceInstanceId: "patchouli-1",
      finalCost: 1,
      fixedPaymentCost: 1,
      summonPermissionEffectIndex: 1,
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "use_hand_card_effect" &&
          action.sourceCardNo === "BSTH01-M01"
      )
    ).toBe(false);
  });

  it("does not list the permission outside its start-step timing scope", () => {
    const actions = legalActionsFor(baseState({ step: "main" }), "alice");
    expect(
      actions.some((action) =>
        action.actionId.startsWith("legal:summon-permission:")
      )
    ).toBe(false);
  });

  it("does not list when a same-name spirit is already on the field", () => {
    const state = baseState({
      cardInstances: [
        createCardInstance(M01, {
          instanceId: "patchouli-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(M01, {
          instanceId: "patchouli-field",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    expect(findPatchouliSummonAction(state)).toBeUndefined();
  });

  it("pays the fixed cost and opens the normal summon stack window", () => {
    const state = baseState();
    const summonAction = findPatchouliSummonAction(state)!;

    const applied = applyLegalAction({
      state,
      action: summonAction,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    expect(applied.window).toBe("stack");
    expect(applied.stackWindow?.priorityPlayerId).toBe("bob");
    expect(applied.stackWindow?.pendingStackAction?.actionKind).toBe("summon");
    expect(applied.pendingEnterFieldPlacement).toBeNull();
    expect(
      applied.cardInstances.find((c) => c.instanceId === "patchouli-1")?.zone
    ).toBe("in_use");
    expect(
      applied.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(4);
  });

  it("creates enter-field placement after the stack resolves", () => {
    const state = baseState();
    const afterDeclare = applyLegalAction({
      state,
      action: findPatchouliSummonAction(state)!,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    const pending = passStackAsBob(afterDeclare);
    expect(pending.window).toBe("none");
    expect(pending.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "patchouli-1"
    );
    expect(
      pending.cardInstances.find((c) => c.instanceId === "patchouli-1")?.zone
    ).toBe("in_use");

    const resolved = resolvePlacementAsAlice(pending);
    const patchouli = resolved.cardInstances.find(
      (c) => c.instanceId === "patchouli-1"
    )!;
    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(patchouli.zone).toBe("field");
    expect(patchouli.zoneRoleName).toBe("spirit");
    expect(patchouli.normalCoreCount).toBe(1);
    expect(
      resolved.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(3);
  });
});
