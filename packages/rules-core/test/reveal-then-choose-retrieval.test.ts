import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateTriggeredEffectRegistrations,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type GameState,
} from "../src";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
};
function reveal(no: string, deck: string[], reserve = 3, taxed = false) {
  const card = getCardDefinitionById(no)!;
  const effectIndex = no === "BSTH01-M03" ? 1 : 0;
  return executeEffect({
    chainId: "test:reveal-then-choose-retrieval:23",
    state: rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            { reserveNormalCoreCount: reserve, deckCount: deck.length },
            {},
          ],
          cardInstances: [
            ...(taxed
              ? [
                  createCardInstance(getCardDefinitionById("BSRK01-C02")!, {
                    instanceId: "tax",
                    ownerPlayerId: "bob",
                    zone: "field",
                    normalCoreCount: 1,
                  }),
                ]
              : []),
            createCardInstance(card, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            ...deck.map((id, i) =>
              createCardInstance(getCardDefinitionById(id)!, {
                instanceId: `top-${i}`,
                ownerPlayerId: "alice",
                zone: "deck",
              })
            ),
          ],
        }),
        activePlayerId: "alice",
        step: "main",
      },
      getCardDefinitionById
    ),
    effect: card.effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    ...lookups,
  });
}
function actions(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "alice", ...lookups });
}
function choose(state: GameState, index: number) {
  const action = actions(state).find(
    (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === index
  );
  expect(action, JSON.stringify(actions(state))).toBeDefined();
  state = applyLegalAction({ state, action: action!, ...lookups }).state;
  if (state.pendingCoreSourceAllocation) {
    const pay = actions(state).find(
      (a) => a.kind === "resolve_core_source_allocation"
    )!;
    state = applyLegalAction({
      state,
      action: pay,
      coreSourceAllocations: { reserve: 1 },
      ...lookups,
    }).state;
  }
  return state;
}
function target(state: GameState, ids: string[]) {
  const action = actions(state).find(
    (a) => a.kind === "resolve_pending_step_optional_target_selection"
  );
  expect(action, JSON.stringify(actions(state))).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    targetInstanceIds: ids,
    ...lookups,
  }).state;
}
function finish(state: GameState) {
  if (state.pendingDeckReveal) {
    const action = actions(state).find(
      (a) => a.kind === "resolve_pending_deck_reveal_order"
    );
    expect(action, JSON.stringify(actions(state))).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      deckRevealRemainderOrder: state.pendingDeckReveal.revealedCardInstanceIds,
      ...lookups,
    }).state;
  }
  expect(state.pendingDeckReveal).toBeNull();
  expect(state.pendingStepChoice).toBeNull();
  return state;
}
function zones(state: GameState) {
  return state.cardInstances
    .filter((c) => c.instanceId.startsWith("top-"))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map((c) => c.zone);
}

describe("公開後に選ぶ回収の二択（2026-07-12確定裁定）", () => {
  it.each(
    ["BSTH01-M03", "BSTH02-C03"].flatMap((no) =>
      [0, 1].flatMap((branch) =>
        [true, false].map((pay) => ({ no, branch, pay }))
      )
    )
  )(
    "$no: 公開後分岐$branch の回収対価=$pay（本文の1コストと別）",
    ({ no, branch, pay }) => {
      let state = reveal(no, ["BSTH01-XX01", "BSTH02-C03"], 3, true);
      const action = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_step_choice" && a.choiceIndex === branch
      )!;
      state = applyLegalAction({ state, action, ...lookups }).state;
      const allocate = (allocations: Record<string, number>) => {
        const action = actions(state).find(
          (a) => a.kind === "resolve_core_source_allocation"
        )!;
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action,
          coreSourceAllocations: allocations,
          ...lookups,
        }).state;
      };
      if (branch === 1) allocate({ reserve: 1 });
      if (state.pendingStepOptionalTargetSelection) {
        const id =
          no === "BSTH01-M03" ? "top-1" : branch === 0 ? "top-1" : "top-0";
        state = target(state, [id]);
      }
      expect(state.pendingCoreSourceAllocation?.canDecline).toBe(true);
      allocate(pay ? { reserve: 1 } : {});
      state = finish(state);
      expect(zones(state).filter((z) => z === "hand")).toHaveLength(
        pay ? 1 : 0
      );
      // 03c/03d2: C03 requires exactly one successful hand gain. Refusing the
      // separate retrieval tax forbids that gain, so its own conditional cost
      // is refunded. M03 permits up to two (including zero), a different body.
      const refunded = no === "BSTH02-C03" && branch === 1 && !pay;
      expect(state.players[0]!.trashNormalCoreCount).toBe(
        refunded ? 0 : branch + Number(pay)
      );
      expect(state.pendingCoreSourceAllocation).toBeNull();
    }
  );
  it("別の効果で公開中のカードはこの公開からの全回収に含めない", () => {
    let state = reveal("BSTH01-M03", ["BSTH01-XX01", "BSTH02-C03"]);
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(getCardDefinitionById("BSTH01-XX01")!, {
          instanceId: "other-reveal",
          ownerPlayerId: "alice",
          zone: "revealed",
        }),
      ],
    };
    state = finish(choose(state, 0));
    expect(zones(state)).toEqual(["hand", "deck"]);
    expect(
      state.cardInstances.find((c) => c.instanceId === "other-reveal")?.zone
    ).toBe("revealed");
  });
  it("支払い可能なコアがなければ有料側を提示しない", () => {
    const opened = reveal("BSTH01-M03", ["BSTH01-XX01", "BSTH02-C03"], 0);
    const paid = actions(opened).find(
      (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1
    )!;
    expect(paid).toBeDefined();
    const state = {
      ...opened,
      cardInstances: opened.cardInstances.map((c) => ({
        ...c,
        normalCoreCount: 0,
      })),
    };
    expect(
      actions(state)
        .filter((a) => a.kind === "resolve_pending_step_choice")
        .map((a) => a.choiceIndex)
    ).toEqual([0]);
    expect(() => applyLegalAction({ state, action: paid, ...lookups })).toThrow(
      /not available/
    );
  });
  it.each(["BSTH01-M03", "BSTH02-C03"])(
    "%s: 登録時は回収モードを選ばず、公開した後に提示する",
    (no) => {
      const regs = generateTriggeredEffectRegistrations(
        getCardDefinitionById(no)!
      ).filter((r) => r.eventKind === "summon");
      expect(regs).toHaveLength(1);
      expect(regs[0]!.choices).toBeUndefined();
      const state = reveal(no, ["BSTH01-XX01", "BSTH02-C03", "BSTH02-C03"]);
      expect(zones(state)).toEqual(["revealed", "revealed", "revealed"]);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(3);
      expect(state.pendingStepChoice?.choices).toHaveLength(2);
    }
  );
  it("霖之助: 無料側は導界者すべてを回収し、幻想側は拾わない", () => {
    const state = finish(
      choose(
        reveal("BSTH01-M03", ["BSTH01-XX01", "BSTH01-XX01", "BSTH02-C03"]),
        0
      )
    );
    expect(zones(state)).toEqual(["hand", "hand", "deck"]);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(3);
  });
  it.each([[], ["top-1"], ["top-1", "top-2"]].map((ids) => ({ ids })))(
    "霖之助: 支払後は0〜2枚を選べる $ids",
    ({ ids }) => {
      let state = choose(
        reveal("BSTH01-M03", ["BSTH01-XX01", "BSTH02-C03", "BSTH02-C03"]),
        1
      );
      expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
      state = finish(target(state, ids));
      expect(zones(state)).toEqual([
        "deck",
        ids.includes("top-1") ? "hand" : "deck",
        ids.includes("top-2") ? "hand" : "deck",
      ]);
      expect(state.players[0]!.trashNormalCoreCount).toBe(1);
    }
  );
  it("霖之助: 幻想が0枚でも支払った1コストを戻さない", () => {
    const state = finish(
      choose(reveal("BSTH01-M03", ["BSTH01-XX01", "BSTH01-XX01"]), 1)
    );
    expect(zones(state)).toEqual(["deck", "deck"]);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
  });
  it("橙: 無料側の2枚は候補がある限りスキップ/1枚だけにできない", () => {
    const opened = choose(
      reveal("BSTH02-C03", [
        "BSTH02-C03",
        "BSTH02-C03",
        "BSTH02-C03",
        "BSTH01-XX01",
      ]),
      0
    );
    expect(() => target(opened, [])).toThrow();
    expect(() => target(opened, ["top-0"])).toThrow();
    const state = finish(target(opened, ["top-0", "top-2"]));
    expect(zones(state)).toEqual(["hand", "deck", "hand", "deck"]);
  });
  it("橙: 無料側が1枚しかなくてもその1枚を回収", () => {
    const opened = choose(
      reveal("BSTH02-C03", ["BSTH02-C03", "BSTH01-XX01"]),
      0
    );
    expect(zones(opened)).toEqual(["revealed", "revealed"]);
    expect(opened.pendingStepOptionalTargetSelection?.requiredTargetCount).toBe(
      1
    );
    const state = finish(target(opened, ["top-0"]));
    expect(zones(state)).toEqual(["hand", "deck"]);
  });
  it("橙: 有料側は1枚回収必須で無料側と混ぜられない", () => {
    const opened = choose(
      reveal("BSTH02-C03", ["BSTH02-C03", "BSTH01-XX01", "BSTH01-XX01"]),
      1
    );
    expect(() => target(opened, [])).toThrow();
    expect(() => target(opened, ["top-0"])).toThrow();
    const state = finish(target(opened, ["top-2"]));
    expect(zones(state)).toEqual(["deck", "deck", "hand"]);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
  });
});
