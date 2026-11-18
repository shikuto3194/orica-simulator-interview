import { describe, expect, it } from "vitest";
import { createEmptyGameState, type PreGameState } from "@orica/rules-core";
import {
  recordedPreGameInputs,
  replayPreGameUiPhase,
} from "../src/preGamePresentation";

function state(pg: Partial<PreGameState> = {}) {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    preGame: {
      phase: "waiting_janken" as const,
      firstPlayerId: null,
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: null,
      mulliganDone: {},
      ...pg,
    },
  };
}

describe("recorded pregame presentation", () => {
  it("shows both recorded hands, viewer-relative results and the winner's order button", () => {
    const before = state();
    const after = state({
      phase: "waiting_order_pick",
      jankenHands: { alice: "rock", bob: "scissors" },
      jankenWinner: "alice",
    });
    const original = JSON.stringify([before, after]);
    expect(
      recordedPreGameInputs(before, after).map((input) => [
        input.actor,
        input.controlTestId,
      ])
    ).toEqual([
      ["alice", "pregame-janken-rock"],
      ["bob", "pregame-janken-scissors"],
    ]);
    expect(replayPreGameUiPhase(before, after, "alice", 1)).toEqual({
      kind: "janken",
    });
    expect(replayPreGameUiPhase(before, after, "bob", 3)).toEqual({
      kind: "janken_result",
      myHand: "scissors",
      oppHand: "rock",
    });
    const picked = state({
      ...after.preGame,
      phase: "waiting_mulligan_first",
      firstPlayerId: "bob",
    });
    expect(recordedPreGameInputs(after, picked)).toEqual([
      {
        actor: "alice",
        controlTestId: "pregame-order-second",
        uiPhase: { kind: "pick_order" },
      },
    ]);
    expect(JSON.stringify([before, after])).toBe(original);
  });

  it("keeps the second player's hand on a draw and recognizes the same hand in a new round", () => {
    const before = state({ jankenHands: { alice: "rock" } });
    const draw = state({
      phase: "janken_resolved",
      jankenHands: { alice: "rock", bob: "rock" },
      jankenRound: 1,
    });
    expect(
      recordedPreGameInputs(before, draw).map((input) => input.actor)
    ).toEqual(["bob"]);
    expect(replayPreGameUiPhase(before, draw, "alice", 3)).toEqual({
      kind: "janken_result",
      myHand: "rock",
      oppHand: "rock",
    });
    const retry = state({ jankenHands: { alice: "rock" }, jankenRound: 1 });
    expect(
      recordedPreGameInputs(draw, retry).map((input) => input.actor)
    ).toEqual(["alice"]);
    expect(replayPreGameUiPhase(draw, retry, "bob", 1)).toEqual({
      kind: "janken",
    });
    expect(recordedPreGameInputs(draw, draw)).toEqual([]);
  });

  it("never invents missing local-game hands or modifies a snapshot when seeking", () => {
    const before = state();
    const after = state({
      phase: "waiting_mulligan_first",
      firstPlayerId: "alice",
    });
    expect(recordedPreGameInputs(before, after)).toEqual([]);
    expect(replayPreGameUiPhase(before, after, "alice", 3)).toEqual({
      kind: "mulligan_self",
    });
    expect(replayPreGameUiPhase(before, after, "alice", 0)).toEqual({
      kind: "janken",
    });
    expect(recordedPreGameInputs(after, { ...after, preGame: null })).toEqual(
      []
    );
  });
});
