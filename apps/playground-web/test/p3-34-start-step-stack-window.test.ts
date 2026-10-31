import { describe, expect, it } from "vitest";
import {
  advanceStep,
  applyLegalAction,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { SCENARIOS } from "../src/scenarios";

const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredHandActivatedEffectActions =
  buildHandActivatedEffectLookup(ALL_CARDS);

function buildQueuedStartStep(): GameState {
  const initial = SCENARIOS["patchouli-start-summon"].build(ALL_CARDS);
  return advanceStep(
    initial,
    getDefinition,
    getRegisteredTriggeredEffectActions
  );
}

function findPatchouliSummonAction(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
  }).find(
    (legalAction): legalAction is Extract<LegalAction, { kind: "summon" }> =>
      legalAction.kind === "summon" && legalAction.sourceCardNo === "BSTH01-M01"
  );
}

function passStackAsBob(state: GameState): GameState {
  const passAction = getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
    getRegisteredFieldCardEffectActions: () => [],
  }).find((legalAction) => legalAction.kind === "pass_stack");
  expect(passAction).toBeDefined();

  return applyLegalAction({
    state,
    action: passAction!,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
  }).state;
}

function resolvePlacementAsAlice(state: GameState): GameState {
  const placementAction = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
  }).find(
    (legalAction) =>
      legalAction.kind === "resolve_pending_enter_field_placement"
  );
  expect(placementAction).toBeDefined();

  return applyLegalAction({
    state,
    action: placementAction!,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
  }).state;
}

describe("P3-34 A: BSTH01-M01 start step stack window", () => {
  it("opens a normal summon stack window after the fixed cost is paid", () => {
    const queued = buildQueuedStartStep();

    expect(queued.step).toBe("start");
    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    expect(queued.pendingPrivateDeclarations).toHaveLength(0);

    const summonAction = findPatchouliSummonAction(queued);
    expect(summonAction).toMatchObject({
      sourceCardNo: "BSTH01-M01",
      finalCost: 1,
      fixedPaymentCost: 1,
    });

    const declaredSummonState = applyLegalAction({
      state: queued,
      action: summonAction!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    expect(declaredSummonState.window).toBe("stack");
    expect(declaredSummonState.stackWindow).not.toBeNull();
    expect(declaredSummonState.stackWindow?.actingPlayerId).toBe("alice");
    expect(declaredSummonState.stackWindow?.priorityPlayerId).toBe("bob");
    expect(
      declaredSummonState.stackWindow?.pendingStackAction?.actionKind
    ).toBe("summon");
    expect(declaredSummonState.pendingEnterFieldPlacement).toBeNull();
  });

  it("closes the stack via bob's pass, then asks alice for enter-field cores", () => {
    const queued = buildQueuedStartStep();
    const afterDeclare = applyLegalAction({
      state: queued,
      action: findPatchouliSummonAction(queued)!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    const pendingPlacement = passStackAsBob(afterDeclare);
    expect(pendingPlacement.window).toBe("none");
    expect(pendingPlacement.stackWindow).toBeNull();
    expect(pendingPlacement.pendingEnterFieldPlacement).toMatchObject({
      actingPlayerId: "alice",
    });
    expect(
      pendingPlacement.cardInstances.find(
        (card) => card.definitionId === "BSTH01-M01"
      )?.zone
    ).toBe("in_use");

    const resolved = resolvePlacementAsAlice(pendingPlacement);
    const summonedPatchouli = resolved.cardInstances.find(
      (card) => card.definitionId === "BSTH01-M01" && card.zone === "field"
    );
    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(summonedPatchouli).toBeDefined();
    expect(summonedPatchouli?.normalCoreCount).toBe(1);
  });
});
