import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildRevealedBurstSlotScenario } from "../../../apps/playground-web/src/scenario-revealed-burst-slot";
import {
  applyLegalAction,
  getLegalActions,
  buildTriggeredEffectLookup,
  createCardInstance,
  type GameState,
} from "../src";
import { generateActionInputChoices } from "../src/action-input-choices";

const byNo = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const options = {
  getCardDefinitionById: (id: string) => byNo.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};
const pick = (state: GameState, owner = "alice") =>
  getLegalActions({ state, actingPlayerId: owner, ...options }).find(
    (action) => action.kind === "resolve_pending_deck_reveal_pick"
  )!;
function finish(state: GameState): GameState {
  for (let n = 0; state.pendingDeckReveal && n < 5; n++) {
    const action = getLegalActions({
      state,
      actingPlayerId: state.pendingDeckReveal.actingPlayerId,
      ...options,
    }).find(
      (entry) =>
        entry.kind === "resolve_pending_deck_reveal_order" ||
        entry.kind === "resolve_pending_deck_reveal_pick"
    );
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...options,
      ...(action?.kind === "resolve_pending_deck_reveal_order"
        ? { deckRevealRemainderOrder: action.remainingCardInstanceIds }
        : { selectedDeckRevealCardIds: [] }),
    }).state;
  }
  expect(state.pendingDeckReveal).toBeNull();
  return state;
}

describe("BSTH09-M01 revealed burst slot", () => {
  it("2枚を同時にセットする入力を原子的に拒否し、C21回収とM01の1枚セットは両立する", () => {
    const state = buildRevealedBurstSlotScenario([...ALL_CARDS]);
    const action = pick(state);
    expect(action).toMatchObject({
      candidateCardInstanceIds: ["reveal-0", "reveal-1", "reveal-2"],
      maxPickCount: 2,
    });
    const before = JSON.stringify(state);
    for (const ids of [
      ["reveal-0", "reveal-1"],
      ["reveal-0", "reveal-0"],
    ]) {
      expect(() =>
        applyLegalAction({
          state,
          action,
          ...options,
          selectedDeckRevealCardIds: ids,
        })
      ).toThrow(/exclusive group/);
      expect(JSON.stringify(state)).toBe(before);
    }
    const after = finish(
      applyLegalAction({
        state,
        action,
        ...options,
        selectedDeckRevealCardIds: ["reveal-0", "reveal-2"],
      }).state
    );
    expect(after.setBurstStates).toEqual([
      { playerId: "alice", cardInstanceId: "reveal-0" },
    ]);
    expect(
      after.cardInstances.find((card) => card.instanceId === "reveal-1")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((card) => card.instanceId === "reveal-2")?.zone
    ).toBe("hand");
    expect(
      after.players.find((player) => player.id === "alice")!.handCount
    ).toBe(1);
  });

  it.each([2, 64])(
    "AI入力も排他制約を生成中に守り、上限%d件で不正入力を混ぜない",
    (limit) => {
      const state = buildRevealedBurstSlotScenario([...ALL_CARDS]);
      const action = pick(state);
      const choices = generateActionInputChoices(state, action, options, limit);
      expect(choices.values.length).toBe(limit === 2 ? 2 : 6);
      for (const input of choices.values) {
        expect(
          input.selectedDeckRevealCardIds?.filter(
            (id) => id === "reveal-0" || id === "reveal-1"
          ).length
        ).toBeLessThanOrEqual(1);
        expect(() =>
          finish(
            applyLegalAction({
              state: structuredClone(state),
              action,
              ...options,
              ...input,
            }).state
          )
        ).not.toThrow();
      }
      expect(choices.truncated).toBe(limit === 2);
    }
  );

  it("相手効果で開かれたBobの自己効果はBobが選び、保存復元後も元のAliceへ残札処理を戻す", () => {
    let state = buildRevealedBurstSlotScenario(
      [...ALL_CARDS],
      new URLSearchParams({ owner: "bob", foreign: "1" })
    );
    expect(state.pendingDeckReveal).toMatchObject({
      actingPlayerId: "bob",
      targetPlayerId: "bob",
      revealedChoiceParentPlayerId: "alice",
    });
    state = JSON.parse(JSON.stringify(state)) as GameState;
    const action = pick(state, "bob");
    expect(action).toMatchObject({
      actingPlayerId: "bob",
      candidateCardInstanceIds: ["reveal-0", "reveal-1"],
      maxPickCount: 1,
    });
    state = applyLegalAction({
      state,
      action,
      ...options,
      selectedDeckRevealCardIds: ["reveal-1"],
    }).state;
    expect(state.pendingDeckReveal).toMatchObject({
      actingPlayerId: "alice",
      targetPlayerId: "bob",
    });
    expect(
      state.pendingDeckReveal?.revealedChoiceParentPlayerId
    ).toBeUndefined();
    const after = finish(state);
    expect(after.setBurstStates).toEqual([
      { playerId: "bob", cardInstanceId: "reveal-1" },
    ]);
    for (const id of ["reveal-0", "reveal-2"])
      expect(
        after.cardInstances.find((card) => card.instanceId === id)
      ).toMatchObject({ ownerPlayerId: "bob", zone: "deck" });
    expect(after.players.map((player) => player.handCount)).toEqual([0, 0]);
  });

  it("公開後に自分の枠が埋まった古い入力を再検査して拒否する", () => {
    const before = buildRevealedBurstSlotScenario([...ALL_CARDS]);
    const action = pick(before);
    const state = {
      ...before,
      cardInstances: [
        ...before.cardInstances,
        createCardInstance(byNo.get("BSTH09-M01")!, {
          instanceId: "existing",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "existing" }],
    };
    expect(pick(state).candidateCardInstanceIds).toEqual(["reveal-2"]);
    expect(() =>
      applyLegalAction({
        state,
        action,
        ...options,
        selectedDeckRevealCardIds: ["reveal-0"],
      })
    ).toThrow(/Invalid deck reveal revealed choice candidate/);
    expect(state.setBurstStates).toEqual([
      { playerId: "alice", cardInstanceId: "existing" },
    ]);
  });

  it.each(["alice", "bob"])(
    "相手公開された%sは辞退でき、全札を元のデッキへ戻す",
    (owner) => {
      const before = buildRevealedBurstSlotScenario(
        [...ALL_CARDS],
        new URLSearchParams({ owner, foreign: "1" })
      );
      const afterChoice = applyLegalAction({
        state: before,
        action: pick(before, owner),
        ...options,
        selectedDeckRevealCardIds: [],
      }).state;
      expect(afterChoice.pendingDeckReveal?.actingPlayerId).toBe(
        owner === "alice" ? "bob" : "alice"
      );
      const after = finish(afterChoice);
      expect(after.setBurstStates).toEqual([]);
      for (const id of ["reveal-0", "reveal-1", "reveal-2"])
        expect(
          after.cardInstances.find((card) => card.instanceId === id)
        ).toMatchObject({
          ownerPlayerId: owner,
          zone: "deck",
        });
      expect(after.players.map((player) => player.handCount)).toEqual([0, 0]);
    }
  );
});
