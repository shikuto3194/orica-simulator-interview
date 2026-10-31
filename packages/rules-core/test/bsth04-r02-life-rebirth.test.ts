import { describe, expect, it } from "vitest";
import { applyLegalAction, getLegalActions, type GameState } from "../src";
import {
  lifeRebirthLookups,
  lifeRebirthState,
} from "./helpers/bsth04-life-rebirth";

function resolveRebirth(state: GameState, owner: string, skip = false) {
  const action = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lifeRebirthLookups,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      !candidate.skipOnly
  );
  expect(action).toBeDefined();
  let result = applyLegalAction({
    state,
    action: action!,
    skipOptionalEffect: skip,
    ...lifeRebirthLookups,
  }).state;
  for (let i = 0; result.stackWindow && i < 10; i++) {
    const pass = getLegalActions({
      state: result,
      actingPlayerId: result.stackWindow.priorityPlayerId,
      ...lifeRebirthLookups,
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: pass!,
      ...lifeRebirthLookups,
    }).state;
  }
  expect(result.stackWindow).toBeNull();
  return result;
}

describe("BSTH04-転醒R02(A) 太陽の畑: 人称指定のないライフ増減", () => {
  for (const owner of ["alice", "bob"]) {
    for (const changedPlayer of ["alice", "bob"]) {
      for (const change of ["increase", "decrease"] as const) {
        it(`${owner}: ${changedPlayer}のライフ${change}で転醒し、自分だけカウント+1`, () => {
          const state = lifeRebirthState(owner, changedPlayer, change);
          expect(
            state.players.find((p) => p.id === changedPlayer)
              ?.lifeNormalCoreCount
          ).toBe(change === "increase" ? 6 : 4);
          const result = resolveRebirth(state, owner);
          expect(
            result.cardInstances.find((card) => card.instanceId === "sun-field")
          ).toMatchObject({ definitionId: "BSTH04-転醒R02(B)", zone: "field" });
          expect(result.players.find((p) => p.id === owner)?.countValue).toBe(
            4
          );
          expect(result.players.find((p) => p.id !== owner)?.countValue).toBe(
            9
          );
        });

        it(`${owner}: ${changedPlayer}のライフ${change}でも自分のカウント4では転醒できない`, () => {
          const state = lifeRebirthState(owner, changedPlayer, change, 4);
          expect(
            getLegalActions({
              state,
              actingPlayerId: owner,
              ...lifeRebirthLookups,
            }).some(
              (action) =>
                action.kind === "resolve_pending_triggered_effect" &&
                !action.skipOnly
            )
          ).toBe(false);
          expect(state.cardInstances[0]?.definitionId).toBe(
            "BSTH04-転醒R02(A)"
          );
          expect(state.players.find((p) => p.id === owner)?.countValue).toBe(4);
        });
      }
    }
  }

  it("相手のライフ増加を受けても転醒を辞退できる", () => {
    const result = resolveRebirth(
      lifeRebirthState("alice", "bob", "increase"),
      "alice",
      true
    );
    expect(result.cardInstances[0]?.definitionId).toBe("BSTH04-転醒R02(A)");
    expect(result.players[0]?.countValue).toBe(3);
  });
});
