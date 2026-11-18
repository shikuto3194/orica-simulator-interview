import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import {
  materializeDeferredTrashOptionalAdds,
  processMovedToTrashEffects,
} from "../src/effect/structured-trash-ops";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);

function recover() {
  const state = createEmptyGameState({
    cardInstances: [
      createCardInstance(lookup("BSTH10-R03")!, {
        instanceId: "magic",
        ownerPlayerId: "player-1",
        zone: "trash",
      }),
      ...["first", "chosen"].map((id) =>
        createCardInstance(lookup("BSTH10-X03")!, {
          instanceId: id,
          ownerPlayerId: "player-1",
          zone: "field",
        })
      ),
    ],
  });
  const pending = materializeDeferredTrashOptionalAdds(
    processMovedToTrashEffects(state, ["magic"], lookup, {
      sourcePlayerId: "player-1",
      sourceColors: ["black"],
      fromZone: "deck",
    })
  );
  const action = getLegalActions({
    state: pending,
    actingPlayerId: "player-1",
    getCardDefinitionById: lookup,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
  return applyLegalAction({
    state: pending,
    action,
    selectedDeckRevealCardIds: ["magic"],
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
  }).state;
}

describe("BSTH10-R03 回収後の任意コア追加", () => {
  it("回収してもコア追加を辞退できる", () => {
    const state = recover();
    expect(
      state.cardInstances.find((c) => c.instanceId === "magic")?.zone
    ).toBe("hand");
    expect(state.pendingStepOptionalChoice).toBeTruthy();
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      getCardDefinitionById: lookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    )!;
    const result = applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(
      result.cardInstances
        .filter((c) => c.zone === "field")
        .map((c) => c.normalCoreCount)
    ).toEqual([0, 0]);
  });
  it("追加先を選び、選んだ創界神だけに1コア置く", () => {
    let state = recover();
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      getCardDefinitionById: lookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const pending = state.pendingStepOptionalTargetSelection;
    expect(pending?.candidateInstanceIds).toEqual(["first", "chosen"]);
    const choose = getLegalActions({
      state,
      actingPlayerId: "player-1",
      getCardDefinitionById: lookup,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    state = applyLegalAction({
      state,
      action: choose,
      targetInstanceIds: ["chosen"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "chosen")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      state.cardInstances.find((c) => c.instanceId === "first")?.normalCoreCount
    ).toBe(0);
  });
});
