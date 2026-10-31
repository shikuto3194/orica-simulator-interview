import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { GameState } from "../src";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const registries = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function board() {
  const make = (no: string, id: string, zone: "field" | "deck", cores = 0) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: "player-1",
      zone,
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    cardInstances: [
      make("BSTH10-X01", "domain", "field", 3),
      make("BSTH10-C04", "top", "deck"),
      make("BSTH10-X03", "nexus", "deck"),
      make("BSTH10-X02", "ultimate", "deck"),
      make("BSTH10-C01", "next", "deck"),
    ],
  });
  return rebuildContinuousEffectsFromField(
    {
      ...state,
      step: "main",
      window: "none",
      activePlayerId: "player-1",
      players: state.players.map((p) => ({
        ...p,
        handCount: 0,
        deckCount: 4,
        reserveNormalCoreCount: 12,
      })),
    },
    lookup
  );
}
function closeStack(state: GameState) {
  for (let n = 0; n < 12 && state.stackWindow; n++) {
    const action = getLegalActions({
      state,
      actingPlayerId: state.stackWindow.priorityPlayerId,
      ...registries,
    }).find((a) => a.kind === "pass_stack")!;
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action, ...registries }).state;
  }
  return state;
}
describe("BSTH10-X01 デッキ上からの通常操作", () => {
  it("デッキ上のスピリットを通常召喚し、物理手札数を減らさない", () => {
    const state = board();
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      ...registries,
    }).find((a) => a.kind === "summon" && a.sourceInstanceId === "top");
    expect(action).toBeDefined();
    if (action?.kind !== "summon") throw new Error("summon missing");
    let result = closeStack(
      applyLegalAction({
        state,
        action,
        paymentSources: [{ kind: "reserve", amount: action.finalCost }],
        ...registries,
      }).state
    );
    const placement = getLegalActions({
      state: result,
      actingPlayerId: "player-1",
      ...registries,
    }).find((a) => a.kind === "resolve_pending_enter_field_placement");
    expect(placement).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: placement!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...registries,
    }).state;
    expect(
      result.cardInstances.find((c) => c.instanceId === "top")?.zone,
      JSON.stringify(result.log)
    ).toBe("field");
    expect(result.players[0]!.handCount).toBe(0);
    expect(result.players[0]!.deckCount).toBe(3);
    expect(result.players[0]!.trashNormalCoreCount).toBeGreaterThan(0);
  });
  it("デッキ上の創界神を通常配置する", () => {
    const state = board();
    const actions = getLegalActions({
      state,
      actingPlayerId: "player-1",
      ...registries,
    });
    const action = actions.find(
      (a) => a.kind === "place_nexus" && a.sourceInstanceId === "nexus"
    );
    expect(action, actions.map((a) => a.kind).join(",")).toBeDefined();
    if (action?.kind !== "place_nexus") throw new Error("place missing");
    const result = closeStack(
      applyLegalAction({
        state,
        action,
        paymentSources: [{ kind: "reserve", amount: action.finalCost }],
        ...registries,
      }).state
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("field");
    expect(result.players[0]!.deckCount).toBe(3);
  });
});
