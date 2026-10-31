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

function setupSummon() {
  const initial = SCENARIOS["patchouli-start-summon"].build(ALL_CARDS);
  const queued = advanceStep(
    initial,
    getDefinition,
    getRegisteredTriggeredEffectActions
  );

  const summonAction = getLegalActions({
    state: queued,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
  }).find(
    (legalAction): legalAction is Extract<LegalAction, { kind: "summon" }> =>
      legalAction.kind === "summon" && legalAction.sourceCardNo === "BSTH01-M01"
  );

  expect(summonAction).toBeDefined();
  return { state: queued, summonAction: summonAction! };
}

function passToPlacementPending(state: GameState): GameState {
  const passAction = getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
    getRegisteredFieldCardEffectActions: () => [],
  }).find((a) => a.kind === "pass_stack");
  expect(passAction).toBeDefined();

  return applyLegalAction({
    state,
    action: passAction!,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
  }).state;
}

function resolvePlacement(state: GameState, amount: number): GameState {
  const placementAction = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
  }).find((a) => a.kind === "resolve_pending_enter_field_placement");
  expect(placementAction).toBeDefined();

  return applyLegalAction({
    state,
    action: placementAction!,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredHandActivatedEffectActions,
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount }],
  }).state;
}

describe("P3-34 B: BSTH01-M01 summon input path", () => {
  it("uses normal summon paymentSources first, then enter-field placements after stack resolution", () => {
    const { state, summonAction } = setupSummon();
    const aliceReserveBefore = state.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;

    const declared = applyLegalAction({
      state,
      action: summonAction,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
      paymentSources: [{ kind: "reserve", amount: 1, includeSoulCore: false }],
    }).state;

    expect(declared.window).toBe("stack");
    expect(declared.pendingEnterFieldPlacement).toBeNull();
    expect(
      declared.stackWindow?.pendingStackAction?.summonPaymentSources
    ).toBeUndefined();
    expect(
      declared.stackWindow?.pendingStackAction?.summonEnterFieldCorePlacements
    ).toBeUndefined();

    const pending = passToPlacementPending(declared);
    expect(pending.pendingEnterFieldPlacement).toBeDefined();

    const resolved = resolvePlacement(pending, 2);
    const summoned = resolved.cardInstances.find(
      (c) => c.definitionId === "BSTH01-M01" && c.zone === "field"
    );
    expect(summoned).toBeDefined();
    expect(summoned!.normalCoreCount).toBeGreaterThanOrEqual(2);

    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(aliceReserveBefore - 3);
  });

  it("rejects missing normal summon paymentSources at declaration time", () => {
    const { state, summonAction } = setupSummon();

    expect(() =>
      applyLegalAction({
        state,
        action: summonAction,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions,
        getRegisteredHandActivatedEffectActions,
      })
    ).toThrow(/requires payment sources/);
  });

  it("rejects a payment amount that does not match the fixed cost", () => {
    const { state, summonAction } = setupSummon();

    expect(() =>
      applyLegalAction({
        state,
        action: summonAction,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions,
        getRegisteredHandActivatedEffectActions,
        paymentSources: [
          { kind: "reserve", amount: 2, includeSoulCore: false },
        ],
      })
    ).toThrow(/Payment does not match final cost/);
  });
});
