import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type Effect,
  type GameState,
} from "../src";
import { materializeDeferredTrashOptionalAdds } from "../src/effect/structured-trash-ops";
const lookup = (no: string) => ALL_CARDS.find((c) => c.cardNo === no);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
};
function board(recover = false): GameState {
  const make = (no: string, id: string, zone: "field" | "hand" | "deck") =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: "player-1",
      zone,
      normalCoreCount: zone === "field" ? 3 : 0,
    });
  return rebuildContinuousEffectsFromField(
    createEmptyGameState({
      cardInstances: [
        make("BSTH10-X01", "domain", "field"),
        make("BSTH10-C04", "hand", "hand"),
        ...Array.from({ length: 4 }, (_, i) =>
          make(
            recover && i === 0 ? "BSTH10-R03" : "BSTH10-C04",
            `d${i}`,
            "deck"
          )
        ),
      ],
      playerOverrides: [{ handCount: 1, deckCount: 4 }, {}],
    }),
    lookup
  );
}
function discard(
  state: GameState,
  pending: boolean,
  destination?: "deck_bottom"
) {
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "discard",
          player: "self",
          count: pending ? 2 : "all",
          ...(destination ? { destination } : {}),
        },
      },
    ],
  };
  let result = executeEffect({
    chainId: "test:bsth10-deck-discard:63",
    state,
    effect,
    sourceInstanceId: "domain",
    actingPlayerId: "player-1",
    ...options,
  });
  if (pending) {
    const action = getLegalActions({
      state: result,
      actingPlayerId: "player-1",
      ...options,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    expect(action).toBeDefined();
    result = applyLegalAction({
      state: result,
      action,
      selectedZoneCardIds: ["d0", "hand"],
      ...options,
    }).state;
  }
  return result;
}
describe("BSTH10-X01 手札扱いの破棄は物理移動元を保持", () => {
  it("R03 の自己回収は物理的なデッキ起点を明示する", () => {
    expect(lookup("BSTH10-R03")!.effects![0]!.condition).toContainEqual({
      kind: "trigger_physical_from_zone",
      zones: ["deck"],
    });
  });

  it.each([false, true])("選択待ち=%s の deck/hand→trash", (pending) => {
    const result = discard(board(), pending);
    expect(result.players[0]!.deckCount).toBe(pending ? 3 : 1);
    expect(result.players[0]!.handCount).toBe(0);
    expect(result.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(
      result.players[0]!.deckCount
    );
  });
  it.each([false, true])("選択待ち=%s の deck/hand→deck_bottom", (pending) => {
    const result = discard(board(), pending, "deck_bottom");
    expect(result.players[0]!.deckCount).toBe(5);
    expect(result.players[0]!.handCount).toBe(0);
    expect(result.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(
      5
    );
  });
  it.each([false, true])(
    "選択待ち=%s でもR03を回収して神にコアを置ける",
    (pending) => {
      let state = materializeDeferredTrashOptionalAdds(
        discard(board(true), pending)
      );
      const act = (kind: string, inputs = {}) => {
        const action = getLegalActions({
          state,
          actingPlayerId: "player-1",
          ...options,
        }).find(
          (a) => a.kind === kind && (!("choice" in a) || a.choice === "execute")
        )!;
        expect(action, JSON.stringify(state.log)).toBeDefined();
        state = applyLegalAction({
          state,
          action,
          ...inputs,
          ...options,
        }).state;
      };
      act("resolve_pending_deck_reveal_pick", {
        selectedDeckRevealCardIds: ["d0"],
      });
      act("resolve_pending_step_optional_choice");
      if (state.pendingStepOptionalTargetSelection)
        act("resolve_pending_step_optional_target_selection", {
          targetInstanceIds: ["domain"],
        });
      expect(state.cardInstances.find((c) => c.instanceId === "d0")?.zone).toBe(
        "hand"
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "domain")
          ?.normalCoreCount
      ).toBe(4);
      expect(state.players[0]!.handCount).toBe(1);
      expect(state.players[0]!.deckCount).toBe(pending ? 3 : 1);
    }
  );
});
