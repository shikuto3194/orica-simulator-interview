import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildMakaiConditionalCostScenario } from "../../../apps/playground-web/src/scenario-makai-conditional-cost";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  getLegalActions,
  type GameState,
  type LegalAction,
  type ApplyLegalActionOptions,
} from "../src";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => [],
};
const actions = (state: GameState) =>
  ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...lookups })
  );
function apply(
  state: GameState,
  action: LegalAction,
  extra: Partial<ApplyLegalActionOptions> = {}
) {
  return applyLegalAction({ state, action, ...lookups, ...extra }).state;
}
function drain(state: GameState) {
  for (let n = 0; n < 30; n++) {
    const placement = actions(state).find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    if (placement) {
      state = apply(state, placement, { enterFieldCorePlacements: [] });
      continue;
    }
    const action = actions(state).find((a) =>
      [
        "pass_stack",
        "pass_pre_declaration_stack",
        "resolve_pending_burst_check",
      ].includes(a.kind)
    );
    if (!action) return state;
    state = apply(state, action);
  }
  throw new Error("Makai response loop");
}
function deployed(owner: string, mode: string) {
  let state = buildMakaiConditionalCostScenario(
    ALL_CARDS,
    new URLSearchParams({ owner, mode })
  );
  const deploy = actions(state).find(
    (a) => a.kind === "place_nexus" && a.sourceInstanceId === "makai"
  );
  expect(deploy).toBeDefined();
  state = drain(
    apply(state, deploy!, { paymentSources: [{ kind: "reserve", amount: 3 }] })
  );
  return state;
}
const resources = (s: GameState) => ({
  cards: s.cardInstances,
  players: s.players,
  usage: s.effectUsageRecords,
});
describe("BSTH002-転醒R01(A) 配置時の任意のことで", () => {
  it("static: effects[2] is optional discard then conditional draw", () => {
    const e = getCardDefinitionById("BSTH002-転醒R01(A)")!.effects![2]!;
    expect(e.executionMode).toBe("optional");
    expect(e.steps.map((s) => s.action.kind)).toEqual(["discard", "draw"]);
    expect(e.steps[1]!.connector).toBe("conditional_cost");
  });
  describe.each(["alice", "bob"])("%s", (owner) => {
    it("decline drains the real place pending without resources or usage", () => {
      const state = deployed(owner, "normal");
      const action = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "makai"
      );
      expect(
        action,
        JSON.stringify({
          actions: actions(state),
          pending: state.pendingTriggeredEffects,
          placement: state.pendingEnterFieldPlacement,
        })
      ).toMatchObject({ executionMode: "optional" });
      const result = drain(apply(state, action!, { skipOptionalEffect: true }));
      expect(resources(result)).toEqual(resources(state));
      expect(result.pendingTriggeredEffects).toHaveLength(0);
    });
    it("execute selects the second hand card then draws exactly one", () => {
      let state = deployed(owner, "normal");
      const action = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "makai"
      );
      expect(action).toBeDefined();
      state = drain(apply(state, action!));
      const select = actions(state).find(
        (a) => a.kind === "resolve_pending_zone_selection"
      );
      expect(select, JSON.stringify(state)).toBeDefined();
      state = drain(apply(state, select!, { selectedZoneCardIds: ["cost-1"] }));
      expect(
        state.cardInstances.find((c) => c.instanceId === "cost-1")?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find((c) => c.instanceId === "cost-0")?.zone
      ).toBe("hand");
      expect(
        state.cardInstances.find((c) => c.instanceId === "draw-0")?.zone
      ).toBe("hand");
      expect(state.players.find((p) => p.id === owner)).toMatchObject({
        handCount: 2,
        deckCount: 2,
      });
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingZoneSelection).toBeNull();
    });
    describe.each(["empty-hand", "empty-deck"])("%s", (mode) => {
      it("only permits decline and leaves the cost untouched", () => {
        const state = deployed(owner, mode);
        const action = actions(state).find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "makai"
        );
        expect(action).toMatchObject({
          executionMode: "optional",
          skipOnly: true,
        });
        const result = drain(
          apply(state, action!, { skipOptionalEffect: true })
        );
        expect(resources(result)).toEqual(resources(state));
        expect(result.pendingTriggeredEffects).toHaveLength(0);
      });
    });
  });
});
