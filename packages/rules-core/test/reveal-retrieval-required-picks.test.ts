import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { collectCardFaces } from "../../../scripts/card-text-accountability-core.mjs";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type DSL,
  type GameState,
} from "../src";
const definitions = ALL_CARDS.flatMap(collectCardFaces).map(({ face }) => face);
const getCardDefinitionById = (id: string) =>
  definitions.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
};
function open(no: string, deck: string[]) {
  const source = getCardDefinitionById(no)!;
  const effect =
    no === "BSTH01-XX01"
      ? source.grandwalkerData!.divineSkills[0]!.effects[0]!
      : source.effects![
          no === "BSAZ02-TX01(A)"
            ? 1
            : no === "BSES01-C02"
              ? 2
              : no === "BSKB01-C02"
                ? 1
                : 0
        ]!;
  const reveal = effect.steps.find((s) => s.action.kind === "deck_reveal")!
    .action as DSL.DeckRevealAction;
  // 借用等の移動前効果はカード別の順序テストで検証し、ここでは回収枠の必須性を検証。
  const isolated = {
    timing: effect.timing,
    steps: [{ action: { ...reveal, beforeMoveSteps: undefined } }],
  };
  let state = executeEffect({
    chainId: "test:reveal-retrieval-required-picks:41",
    state: {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: deck.length, handCount: 0 }, {}],
        cardInstances: [
          createCardInstance(source, {
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
    // 公開を選んだ後の回収部分を実カードのDSLで検証。発揮前提・別手順はこの回帰の対象外。
    effect: isolated,
    optionalStepResumeEffectOverride: isolated,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    ...lookups,
  });
  if (state.pendingDeckReveal?.phase === "revealed_choice") {
    // 公開されたカード自身の「加えられる」を辞退しても、元効果の回収は別に解決する。
    expect(action(state).canSkip).toBe(true);
    state = pick(state, []);
  }
  return state;
}
function action(state: GameState) {
  const result = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  if (!result || result.kind !== "resolve_pending_deck_reveal_pick")
    throw new Error("missing pick");
  return result;
}
function pick(state: GameState, ids: string[]) {
  return applyLegalAction({
    state,
    action: action(state),
    selectedDeckRevealCardIds: ids,
    ...lookups,
  }).state;
}
function finish(state: GameState) {
  while (state.pendingDeckReveal?.phase === "revealed_choice")
    state = pick(state, []);
  if (state.pendingDeckReveal) {
    const order = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    if (!order || order.kind !== "resolve_pending_deck_reveal_order")
      throw new Error("missing order");
    state = applyLegalAction({
      state,
      action: order,
      deckRevealRemainderOrder: order.remainingCardInstanceIds,
      deckRevealPlacement: "bottom",
      ...lookups,
    }).state;
  }
  return state;
}
describe("強制回収の指定漏れと全枚数の退行", () => {
  it.each([
    {
      no: "BSLH01-TR01(A)",
      deck: ["BSLH01-TR01(A)", "BSLH01-TR01(A)", "BSTH01-C21"],
      picks: [["top-1"]],
    },
    {
      no: "BSSA01-C02",
      deck: ["BSSA01-C02", "BSSA01-C02", "BSTH01-C21"],
      picks: [["top-0"]],
    },
    {
      no: "BSTH01-C02",
      deck: ["BSTH01-XX01", "BSTH01-C01", "BSTH01-R02", "BSTH01-R03"],
      picks: [["top-0"], ["top-1"], ["top-2", "top-3"]],
    },
    {
      no: "BSTH01-C04",
      deck: ["BSTH01-C04", "BSTH01-C22", "BSTH01-C21"],
      picks: [["top-0"], ["top-1"]],
    },
    {
      no: "BSTH01-R04",
      deck: ["BSTH01-C04", "BSTH01-C22", "BSTH01-C21", "BSTH01-C21"],
      picks: [["top-0", "top-1"]],
    },
    {
      no: "BSTH01-XX01",
      deck: ["BSTH01-C01", "BSTH01-C02"],
      picks: [["top-1"]],
    },
    {
      no: "BSAZ01-X01",
      deck: ["BSAZ01-C03", "BSAZ01-C03", "BSTH01-C21"],
      picks: [["top-0"]],
    },
    {
      no: "BSAZ02-TX01(A)",
      deck: ["BSAZ02-TX01(A)", "BSAZ02-TX01(A)", "BSTH01-C21"],
      picks: [["top-0", "top-1"]],
    },
  ])("$no: 対象がある各回収枠をスキップできない", ({ no, deck, picks }) => {
    let state = open(no, deck);
    for (const ids of picks) {
      expect(action(state).canSkip, JSON.stringify(action(state))).toBe(false);
      expect(action(state).maxPickCount).toBeGreaterThanOrEqual(ids.length);
      expect(() => pick(state, [])).toThrow(/requires/);
      if (ids.length > 1)
        expect(() => pick(state, ids.slice(0, 1))).toThrow(/requires/);
      state = pick(state, ids);
    }
    state = finish(state);
    expect(state.pendingDeckReveal).toBeNull();
    for (const id of picks.flat())
      expect(state.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        no === "BSAZ01-X01" ? "field" : "hand"
      );
    expect(state.players[0]!.handCount).toBe(
      no === "BSAZ01-X01" ? 0 : picks.flat().length
    );
  });
  it("指定2枚に対し候補1枚なら1枚を必ず回収、候補0枚だけ0枚で進む", () => {
    const one = open("BSTH01-R04", ["BSTH01-C04", "BSTH01-C21"]);
    expect(() => pick(one, [])).toThrow(/requires 1/);
    expect(finish(pick(one, ["top-0"])).players[0]!.handCount).toBe(1);
    const zero = open("BSTH01-R04", ["BSTH01-C21", "BSTH01-C21"]);
    expect(action(zero).canSkip).toBe(true);
    expect(finish(pick(zero, [])).players[0]!.handCount).toBe(0);
  });
  it.each([
    { no: "BSES01-C02", target: "BSES01-C02" },
    { no: "BSKB01-C02", target: "BSKB01-C02" },
    { no: "BSTH02.7-C03", target: "BSAZ01-C03" },
  ])(
    "$no: 「加えられる」「まで」は対象があっても0枚を選べる",
    ({ no, target }) => {
      const state = open(no, [target, target]);
      expect(action(state).candidateCardInstanceIds.length).toBeGreaterThan(0);
      expect(action(state).canSkip).toBe(true);
      expect(finish(pick(state, [])).players[0]!.handCount).toBe(0);
    }
  );
});
